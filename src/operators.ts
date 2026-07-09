import * as vscode from 'vscode';
import { Mode, afterMotion, consumeCount, getMode, isVisual, setActive, setMode, setPendingOperatorLabel } from './state';
import { setRegister, getRegister, setPendingRegister, clearPendingRegister } from './registers';
import { textObjectRange, type TextObjectId } from './textobjects';
import { beginInsertChange, recordChange } from './dotrepeat';

/** Route a completed operator to the dot-repeat recorder: a `change` opens an
 * insert session (it's already in Insert, so REPLAY reproduces edit + typed
 * text), a `delete` records a re-run thunk, a `yank` isn't a change. Call
 * AFTER the operator has applied. */
function recordOp(op: OperatorKind, replay: (count?: number) => Promise<void>): void {
  const editor = activeEditor();
  if (!editor) return;
  if (op === 'change') beginInsertChange(editor, () => replay());
  else if (op === 'delete') recordChange(replay);
}

/**
 * Vim's operator grammar: `[count1] operator [count2] motion`, where the
 * effective repeat is count1 × count2 (`2d3w` deletes 6 words), OR a
 * doubled operator letter (`dd`/`cc`/`yy`) meaning "N whole lines" using
 * count1 alone. This module is the pending-operator state machine plus the
 * actual text mutation (delete/change/yank), operating on either a
 * charwise range or N whole lines.
 *
 * VISUAL mode reuses this machinery directly: an operator pressed with a
 * selection live applies immediately to that selection (no pending-operator
 * wait) — charwise via `applyCharwiseRange`, linewise via `applyLinewise` —
 * see `applyVisualOperator`.
 *
 * NOTE — known simplification: charwise visual selection uses VS Code's own
 * (exclusive-end) selection model, so a selection shows/affects exactly what's
 * highlighted. Real vim's visual is INCLUSIVE of the cell under the cursor
 * (one char more). This is the same between-characters vs character-cell
 * model difference already documented for `$` in motions.ts, and is deferred
 * to that same future decision rather than partially emulated here.
 */

export type OperatorKind = 'delete' | 'change' | 'yank';

let pendingOperator: OperatorKind | null = null;
let operatorCount = 1;

const LABEL: Record<OperatorKind, string> = { delete: 'd', change: 'c', yank: 'y' };

export function hasPendingOperator(): boolean {
  return pendingOperator !== null;
}

export function cancelPendingOperator(): void {
  pendingOperator = null;
  operatorCount = 1;
  setPendingOperatorLabel(null);
}

/** Consume the pending operator (kind + count) and clear it, or null if none.
 * Used by mark targets (`` d`a ``) — same capture find-char does internally. */
export function takePendingOperator(): { op: OperatorKind; count: number } | null {
  if (pendingOperator === null) return null;
  const taken = { op: pendingOperator, count: operatorCount };
  cancelPendingOperator();
  return taken;
}

function activeEditor(): vscode.TextEditor | undefined {
  return vscode.window.activeTextEditor;
}

/** The `d` / `c` / `y` key itself: opens a pending operator, or — pressed
 * twice in a row with nothing in between — triggers the linewise shorthand
 * (`dd`/`cc`/`yy`) over `operatorCount` lines. */
export function operatorKey(op: OperatorKind) {
  return async () => {
    const editor = activeEditor();
    if (!editor) return;

    // In visual mode the operator applies immediately to the selection —
    // there's no motion to wait for.
    if (isVisual(editor)) {
      await applyVisualOperator(editor, op);
      return;
    }

    if (pendingOperator === op) {
      const n = operatorCount;
      cancelPendingOperator();
      await applyLinewise(editor, op, n);
      // dd / cc dot-repeat: re-apply N whole lines at the cursor's line.
      recordOp(op, async (count) => {
        const e = activeEditor();
        if (e) await applyLinewise(e, op, count ?? n);
      });
      return;
    }

    // A different operator was already pending (e.g. `d` then `c`): real vim
    // treats this as an undefined combo and drops back to a clean slate —
    // cancel the stale one and start fresh with the one just pressed.
    operatorCount = consumeCount(editor);
    pendingOperator = op;
    setPendingOperatorLabel(LABEL[op]);
  };
}

/**
 * Word-motion targets for a pending operator (`dw`/`cw`/`yw`). Runs the RAW
 * cursor-move command `operatorCount × motionCount` times (both counts
 * multiplied, per vim) to find the target position, then applies the
 * operator over [start, target) — rather than composing the higher-level
 * motion functions in motions.ts, which each consume their own count once
 * and would double-count when composed here.
 */
export function operatorAwareWordMotion(rawCommand: string) {
  return async () => {
    const editor = activeEditor();
    if (!editor) return;

    if (!hasPendingOperator()) {
      const n = consumeCount(editor);
      for (let i = 0; i < n; i++) await vscode.commands.executeCommand(rawCommand);
      return;
    }

    const op = pendingOperator!;
    const opCount = operatorCount;
    cancelPendingOperator();
    const motionCount = consumeCount(editor);
    const times = opCount * motionCount;
    await applyWordMotionOp(editor, op, times, rawCommand);
    // dw / cw dot-repeat: re-run the word motion + operator at the cursor.
    recordOp(op, async (count) => {
      const e = activeEditor();
      if (e) await applyWordMotionOp(e, op, count ?? times, rawCommand);
    });
  };
}

/** Move RAWCOMMAND `times` from the cursor, then apply OP over the span —
 * the core shared by live `dw`/`cw` and their dot-repeat. */
async function applyWordMotionOp(editor: vscode.TextEditor, op: OperatorKind, times: number, rawCommand: string): Promise<void> {
  const start = editor.selection.active;
  for (let i = 0; i < times; i++) {
    await vscode.commands.executeCommand(rawCommand);
  }
  const end = editor.selection.active;
  await applyCharwiseRange(editor, op, start, end);
}

/** Apply OP to the charwise range between A and B (order-independent). */
export async function applyCharwiseRange(
  editor: vscode.TextEditor,
  op: OperatorKind,
  a: vscode.Position,
  b: vscode.Position,
): Promise<void> {
  const beg = a.isBeforeOrEqual(b) ? a : b;
  const end = a.isBeforeOrEqual(b) ? b : a;
  const range = new vscode.Range(beg, end);
  const text = editor.document.getText(range);
  setRegister(text, false);

  if (op === 'yank') {
    editor.selection = new vscode.Selection(beg, beg);
    return;
  }
  await editor.edit((eb) => eb.delete(range));
  editor.selection = new vscode.Selection(beg, beg);
  if (op === 'change') setMode(editor, Mode.Insert);
}

/** `dd` / `cc` / `yy` — N whole lines from the cursor's line. Delete/yank
 * remove the lines entirely (newlines included); change instead empties
 * the lines down to ONE, re-indents it correctly, and drops into INSERT —
 * matching real vim's `cc`, not a strict "delete then normal delete-
 * semantics" pass. */
async function applyLinewise(editor: vscode.TextEditor, op: OperatorKind, n: number): Promise<void> {
  const doc = editor.document;
  const startLine = editor.selection.active.line;
  const endLine = Math.min(startLine + n - 1, doc.lineCount - 1);
  const isLastLine = endLine === doc.lineCount - 1;

  const beg = new vscode.Position(startLine, 0);
  const end = isLastLine
    ? doc.lineAt(endLine).range.end
    : new vscode.Position(endLine + 1, 0);

  const fullRangeText = doc.getText(new vscode.Range(beg, end));
  setRegister(fullRangeText, true);

  if (op === 'yank') return; // cursor stays put

  if (op === 'change') {
    // Match real vim's `cc` (autoindent): the new empty line KEEPS the
    // changed line's own indentation. Copying that leading whitespace is
    // exact and cheap for the common case — an indented CONTENT line like
    // `    foo` becomes an empty line still indented to column 4. The one
    // case copying can't handle is an ALREADY-BLANK line, which has no
    // indent to copy (VSCodeVim #1017): only THERE do we fall back to VS
    // Code's own language-aware reindenter to compute the block's indent
    // (the same mechanism `o`/`O` use). Reindenting unconditionally was
    // wrong — on a content line the reindenter often recomputes to zero and
    // eats the indent the user actually had.
    const firstLineText = doc.lineAt(startLine).text;
    const lineIsBlank = firstLineText.trim().length === 0;

    if (lineIsBlank) {
      const replacement = isLastLine ? '' : '\n';
      await editor.edit((eb) => eb.replace(new vscode.Range(beg, end), replacement));
      const blankPos = new vscode.Position(startLine, 0);
      editor.selection = new vscode.Selection(blankPos, blankPos);
      await vscode.commands.executeCommand('editor.action.reindentselectedlines').then(undefined, () => {});
    } else {
      const indent = firstLineText.match(/^[ \t]*/)?.[0] ?? '';
      const replacement = isLastLine ? indent : indent + '\n';
      await editor.edit((eb) => eb.replace(new vscode.Range(beg, end), replacement));
    }
    // Land at the end of the (now whitespace-only) line — correct for both
    // branches, since the line's entire content is its indentation.
    const line = editor.document.lineAt(startLine);
    const pos = new vscode.Position(startLine, line.text.length);
    editor.selection = new vscode.Selection(pos, pos);
    setMode(editor, Mode.Insert);
    return;
  }

  // delete: remove the lines entirely. On the true last line there's no
  // trailing newline to consume forward, so consume the PRECEDING newline
  // instead — otherwise a dangling blank line is left behind (vim doesn't
  // do this: deleting the last line shrinks the file, it doesn't leave an
  // empty line where it used to be).
  let rangeBeg = beg;
  if (isLastLine && startLine > 0) {
    rangeBeg = doc.lineAt(startLine - 1).range.end;
  }
  await editor.edit((eb) => eb.delete(new vscode.Range(rangeBeg, end)));
  const landingLine = Math.min(startLine, doc.lineCount - 1);
  const pos = new vscode.Position(landingLine, 0);
  editor.selection = new vscode.Selection(pos, pos);
}

/** Apply OP over the whole lines [startLine..endLine] — used by linewise mark
 * targets (`d'a`, `y'a`). Parks the cursor at the top line, reuses the dd/cc/yy
 * path so registers + cc-indent behave correctly. */
export async function applyLinewiseRange(editor: vscode.TextEditor, op: OperatorKind, startLine: number, endLine: number): Promise<void> {
  const top = Math.min(startLine, endLine);
  const bot = Math.max(startLine, endLine);
  const pos = new vscode.Position(top, 0);
  editor.selection = new vscode.Selection(pos, pos);
  await applyLinewise(editor, op, bot - top + 1);
}

// ── Register prefix `"` — retarget the next yank/delete/paste ────────────────

function setAwaitingRegister(on: boolean): void {
  vscode.commands.executeCommand('setContext', 'vinel.awaitingRegister', on);
}

/** `"` — the next key names a register for the following operation. */
export function registerPrefix(): void {
  setAwaitingRegister(true);
}

/** The register letter after `"` (delivered as arg). */
export function provideRegister(ch?: unknown): void {
  setAwaitingRegister(false);
  if (typeof ch === 'string' && ch.length > 0) setPendingRegister(ch);
}

/** Escape — drop a half-typed `"` and any pending register target. */
export function cancelPendingRegister(): void {
  setAwaitingRegister(false);
  clearPendingRegister();
}

// ── Visual-mode operators: apply d/c/y to the live selection ────────────────

/** Apply OP to the current visual selection, then return to NORMAL (except
 * `change`, which the underlying helpers already drop into INSERT). Charwise
 * reuses `applyCharwiseRange`; linewise reuses `applyLinewise` over the
 * selection's whole-line span — both already handle registers, cursor
 * landing, and the `cc`/`c` indent behavior. */
export async function applyVisualOperator(editor: vscode.TextEditor, op: OperatorKind): Promise<void> {
  const sel = editor.selection;
  const linewise = getMode(editor) === Mode.VisualLine;

  if (linewise) {
    // The selection already spans full lines (reshaped on every motion), so
    // its start/end lines are the range. Park the caret at the top line and
    // reuse the dd/cc/yy path over that many lines.
    const startLine = sel.start.line;
    const n = sel.end.line - sel.start.line + 1;
    const top = new vscode.Position(startLine, 0);
    editor.selection = new vscode.Selection(top, top);
    await applyLinewise(editor, op, n);
  } else {
    await applyCharwiseRange(editor, op, sel.start, sel.end);
  }

  if (op !== 'change') setMode(editor, Mode.Normal);
}

/** Delete/Backspace in visual mode — the requested QoL: delete the selection
 * directly (identical to visual `d`), faster than typing `d`. Bound only in
 * visual, so the selection is always live here. */
export async function visualDelete(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  await applyVisualOperator(editor, 'delete');
}

// ── Direct-target commands: D / C / Y (to-eol / whole-line yank) ───────────

async function toEol(editor: vscode.TextEditor, op: OperatorKind): Promise<void> {
  const pos = editor.selection.active;
  await applyCharwiseRange(editor, op, pos, editor.document.lineAt(pos.line).range.end);
}

export async function deleteToEol(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  consumeCount(editor); // vim's D/C don't take a useful count in the common case
  await toEol(editor, 'delete');
  recordOp('delete', async () => { const e = activeEditor(); if (e) await toEol(e, 'delete'); });
}

export async function changeToEol(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  consumeCount(editor);
  await toEol(editor, 'change');
  recordOp('change', async () => { const e = activeEditor(); if (e) await toEol(e, 'change'); });
}

/** `Y` — standard vim: equivalent to `yy` (yank the whole line), not
 * "yank to end of line" (that reading is a non-default remap some configs
 * add; real vim's default Y is yy). */
export async function yankLine(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  const n = consumeCount(editor);
  await applyLinewise(editor, 'yank', n);
}

// ── x / p / P — character cut, paste after/before ──────────────────────────

async function cutCharCore(editor: vscode.TextEditor, n: number): Promise<void> {
  const pos = editor.selection.active;
  const line = editor.document.lineAt(pos.line);
  const end = new vscode.Position(pos.line, Math.min(pos.character + n, line.text.length));
  if (pos.isEqual(end)) return;
  const text = editor.document.getText(new vscode.Range(pos, end));
  setRegister(text, false);
  await editor.edit((eb) => eb.delete(new vscode.Range(pos, end)));
}

export async function cutChar(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  // In visual, `x` deletes the selection (same as `d`).
  if (isVisual(editor)) {
    await applyVisualOperator(editor, 'delete');
    return;
  }
  const n = consumeCount(editor);
  await cutCharCore(editor, n);
  recordChange(async (count) => { const e = activeEditor(); if (e) await cutCharCore(e, count ?? n); });
}

async function pasteAfterCore(editor: vscode.TextEditor): Promise<void> {
  const { text, linewise } = getRegister();
  if (!text) return;
  if (linewise) {
    const line = editor.selection.active.line;
    const insertAt = new vscode.Position(line + 1, 0);
    const content = text.endsWith('\n') ? text : text + '\n';
    await editor.edit((eb) => eb.insert(insertAt, content));
    editor.selection = new vscode.Selection(insertAt, insertAt);
  } else {
    const pos = editor.selection.active;
    const line = editor.document.lineAt(pos.line);
    const insertAt = pos.character < line.text.length ? pos.translate(0, 1) : pos;
    await editor.edit((eb) => eb.insert(insertAt, text));
    const after = insertAt.translate(0, text.length);
    editor.selection = new vscode.Selection(after, after);
  }
}

export async function pasteAfter(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  // In visual, `p` pastes OVER the selection (replace it with the register).
  if (isVisual(editor)) {
    await visualPasteOver(editor);
    return;
  }
  await pasteAfterCore(editor);
  recordChange(async () => { const e = activeEditor(); if (e) await pasteAfterCore(e); });
}

async function pasteBeforeCore(editor: vscode.TextEditor): Promise<void> {
  const { text, linewise } = getRegister();
  if (!text) return;
  if (linewise) {
    const insertAt = new vscode.Position(editor.selection.active.line, 0);
    const content = text.endsWith('\n') ? text : text + '\n';
    await editor.edit((eb) => eb.insert(insertAt, content));
    editor.selection = new vscode.Selection(insertAt, insertAt);
  } else {
    const pos = editor.selection.active;
    await editor.edit((eb) => eb.insert(pos, text));
  }
}

export async function pasteBefore(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  await pasteBeforeCore(editor);
  recordChange(async () => { const e = activeEditor(); if (e) await pasteBeforeCore(e); });
}

// ── o / O — open a line below/above and enter INSERT ────────────────────────

async function openBelowCore(editor: vscode.TextEditor): Promise<void> {
  const line = editor.selection.active.line;
  const end = editor.document.lineAt(line).range.end;
  await editor.edit((eb) => eb.insert(end, '\n'));
  const pos = new vscode.Position(line + 1, 0);
  editor.selection = new vscode.Selection(pos, pos);
  await vscode.commands.executeCommand('editor.action.reindentselectedlines').then(undefined, () => {});
  setMode(editor, Mode.Insert);
}

export async function openBelow(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  await openBelowCore(editor);
  // Record AFTER the core: the cursor now sits where typing begins.
  beginInsertChange(editor, () => { const e = activeEditor(); return e ? openBelowCore(e) : undefined; });
}

async function openAboveCore(editor: vscode.TextEditor): Promise<void> {
  const line = editor.selection.active.line;
  const start = new vscode.Position(line, 0);
  await editor.edit((eb) => eb.insert(start, '\n'));
  editor.selection = new vscode.Selection(start, start);
  await vscode.commands.executeCommand('editor.action.reindentselectedlines').then(undefined, () => {});
  setMode(editor, Mode.Insert);
}

export async function openAbove(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  await openAboveCore(editor);
  beginInsertChange(editor, () => { const e = activeEditor(); return e ? openAboveCore(e) : undefined; });
}

// ── More visual-mode operators (indent / join / case / paste-over) ──────────
// Each acts on the live selection then returns to NORMAL. The indent/join/case
// ones delegate to VS Code's own selection-aware commands — same "let the host
// do what it does well" call as `/` → native Find.

/** `>` in visual — indent the selected lines once. */
export async function visualIndent(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  await vscode.commands.executeCommand('editor.action.indentLines');
  setMode(editor, Mode.Normal);
}

/** `<` in visual — outdent the selected lines once. */
export async function visualOutdent(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  await vscode.commands.executeCommand('editor.action.outdentLines');
  setMode(editor, Mode.Normal);
}

/** `J` in visual — join the selected lines. */
export async function visualJoin(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  await vscode.commands.executeCommand('editor.action.joinLines');
  setMode(editor, Mode.Normal);
}

/** `u` / `U` in visual — lowercase / uppercase the selection (real vim; note
 * `u` here is NOT undo — that's `u` in NORMAL). */
export async function visualLower(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  await vscode.commands.executeCommand('editor.action.transformToLowercase');
  setMode(editor, Mode.Normal);
}
export async function visualUpper(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  await vscode.commands.executeCommand('editor.action.transformToUppercase');
  setMode(editor, Mode.Normal);
}

/** `~` in visual — toggle the case of every character in the selection. VS
 * Code has no native toggle-case, so this is a single explicit edit. */
export async function visualToggleCase(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  const sel = editor.selection;
  if (sel.isEmpty) { setMode(editor, Mode.Normal); return; }
  const text = editor.document.getText(sel);
  const toggled = Array.from(text)
    .map((ch) => (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()))
    .join('');
  await editor.edit((eb) => eb.replace(sel, toggled));
  setMode(editor, Mode.Normal);
}

/** `p` in visual — replace the selection with the unnamed register, and (vim
 * behavior) swap the replaced text back into the register. */
async function visualPasteOver(editor: vscode.TextEditor): Promise<void> {
  const reg = getRegister();
  const sel = editor.selection;

  if (getMode(editor) === Mode.VisualLine) {
    const startLine = sel.start.line;
    const endLine = sel.end.line;
    const isLast = endLine === editor.document.lineCount - 1;
    const beg = new vscode.Position(startLine, 0);
    const end = isLast
      ? editor.document.lineAt(endLine).range.end
      : new vscode.Position(endLine + 1, 0);
    const replaced = editor.document.getText(new vscode.Range(beg, end));
    let content = reg.text;
    if (content && !content.endsWith('\n') && !isLast) content += '\n';
    await editor.edit((eb) => eb.replace(new vscode.Range(beg, end), content));
    setRegister(replaced, true);
    const pos = new vscode.Position(startLine, 0);
    editor.selection = new vscode.Selection(pos, pos);
  } else {
    const range = new vscode.Range(sel.start, sel.end);
    const replaced = editor.document.getText(range);
    await editor.edit((eb) => eb.replace(range, reg.text));
    setRegister(replaced, false);
    editor.selection = new vscode.Selection(sel.start, sel.start);
  }

  setMode(editor, Mode.Normal);
}

// ── s / S / X — substitute char / line, delete-before ───────────────────────

async function substituteCharCore(editor: vscode.TextEditor, n: number): Promise<void> {
  const pos = editor.selection.active;
  const line = editor.document.lineAt(pos.line);
  const end = Math.min(pos.character + n, line.text.length);
  if (end > pos.character) {
    const range = new vscode.Range(pos, new vscode.Position(pos.line, end));
    setRegister(editor.document.getText(range), false);
    await editor.edit((eb) => eb.delete(range));
  }
  setMode(editor, Mode.Insert);
}

/** `s` — delete `count` chars under the cursor and enter INSERT (= `cl`). */
export async function substituteChar(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  const n = consumeCount(editor);
  await substituteCharCore(editor, n);
  beginInsertChange(editor, () => { const e = activeEditor(); return e ? substituteCharCore(e, n) : undefined; });
}

/** `S` — substitute whole line, identical to `cc`. */
export async function substituteLine(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  const n = consumeCount(editor);
  await applyLinewise(editor, 'change', n);
  beginInsertChange(editor, () => { const e = activeEditor(); return e ? applyLinewise(e, 'change', n) : undefined; });
}

async function deleteCharBeforeCore(editor: vscode.TextEditor, n: number): Promise<void> {
  const pos = editor.selection.active;
  const begCol = Math.max(0, pos.character - n);
  if (begCol >= pos.character) return;
  const range = new vscode.Range(new vscode.Position(pos.line, begCol), pos);
  setRegister(editor.document.getText(range), false);
  await editor.edit((eb) => eb.delete(range));
}

/** `X` — delete `count` chars BEFORE the cursor (mirror of `x`). */
export async function deleteCharBefore(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  const n = consumeCount(editor);
  await deleteCharBeforeCore(editor, n);
  recordChange(async (count) => { const e = activeEditor(); if (e) await deleteCharBeforeCore(e, count ?? n); });
}

// ── J / ~ / >> / << — Normal-mode line operations ───────────────────────────

async function joinCore(editor: vscode.TextEditor, count: number): Promise<void> {
  const joins = Math.max(1, count - 1);
  for (let i = 0; i < joins; i++) {
    await vscode.commands.executeCommand('editor.action.joinLines');
  }
}

/** `J` — join `count` lines (native join; `count` lines means `count-1` joins,
 * with a bare `J` = current + next). */
export async function normalJoin(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  const n = consumeCount(editor);
  await joinCore(editor, n);
  recordChange(async (count) => { const e = activeEditor(); if (e) await joinCore(e, count ?? n); });
}

async function toggleCaseCore(editor: vscode.TextEditor, n: number): Promise<void> {
  const pos = editor.selection.active;
  const line = editor.document.lineAt(pos.line);
  const end = Math.min(pos.character + n, line.text.length);
  if (end <= pos.character) return;
  const range = new vscode.Range(pos, new vscode.Position(pos.line, end));
  const toggled = Array.from(editor.document.getText(range))
    .map((ch) => (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()))
    .join('');
  await editor.edit((eb) => eb.replace(range, toggled));
  const landing = new vscode.Position(pos.line, end);
  editor.selection = new vscode.Selection(landing, landing);
}

/** `~` — toggle the case of `count` chars under the cursor and advance. */
export async function normalToggleCase(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  const n = consumeCount(editor);
  await toggleCaseCore(editor, n);
  recordChange(async (count) => { const e = activeEditor(); if (e) await toggleCaseCore(e, count ?? n); });
}

async function indentOutdent(editor: vscode.TextEditor, command: string, n: number): Promise<void> {
  const startLine = editor.selection.active.line;
  const endLine = Math.min(startLine + n - 1, editor.document.lineCount - 1);
  editor.selection = new vscode.Selection(
    new vscode.Position(startLine, 0),
    new vscode.Position(endLine, 0),
  );
  await vscode.commands.executeCommand(command);
  // Land on the first non-blank of the first line, like vim.
  const text = editor.document.lineAt(startLine).text;
  const col = Math.max(0, text.search(/\S/));
  const pos = new vscode.Position(startLine, col);
  editor.selection = new vscode.Selection(pos, pos);
}

async function indentCommand(command: string): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  const n = consumeCount(editor);
  await indentOutdent(editor, command, n);
  recordChange(async (count) => { const e = activeEditor(); if (e) await indentOutdent(e, command, count ?? n); });
}

/** `>>` — indent `count` lines. */
export const indentLines = () => indentCommand('editor.action.indentLines');
/** `<<` — outdent `count` lines. */
export const outdentLines = () => indentCommand('editor.action.outdentLines');

// ── f / F / t / T / r / ; / , — find-char + replace ─────────────────────────
// The "await one keystroke" layer: f/F/t/T/r set a pending action and turn on
// the `vinel.awaitingChar` context key; the next printable key fires
// `provideChar` with its character (declarative, no `type` hijack — see the
// provideChar bindings in package.json). Find motions double as operator
// targets (`dt,`, `df)`, `cf"`) by capturing any pending d/c/y.

type FindKind = 'f' | 'F' | 't' | 'T';
const FLIP: Record<FindKind, FindKind> = { f: 'F', F: 'f', t: 'T', T: 't' };

let pendingChar: { kind: FindKind | 'r'; operator: OperatorKind | null; count: number } | null = null;
let lastFind: { kind: FindKind; char: string } | null = null;

function setAwaiting(on: boolean): void {
  vscode.commands.executeCommand('setContext', 'vinel.awaitingChar', on);
}

/** Clear a half-typed f/F/t/T/r (Escape). */
export function cancelPendingChar(): void {
  pendingChar = null;
  setAwaiting(false);
}

/** `f`/`F`/`t`/`T` — begin a find; the next key supplies the target char.
 * Captures a pending operator so `dt,` / `cf)` work. */
export function findChar(kind: FindKind) {
  return () => {
    const editor = activeEditor();
    if (!editor) return;
    const operator = pendingOperator;
    const opCount = operatorCount;
    if (operator) cancelPendingOperator();
    // count1 × count2 when an operator is pending, else just the motion count.
    const count = operator ? opCount * consumeCount(editor) : consumeCount(editor);
    pendingChar = { kind, operator, count };
    setAwaiting(true);
  };
}

/** `r` — replace the next `count` chars with the key supplied next. */
export function replaceChar(): void {
  const editor = activeEditor();
  if (!editor) return;
  pendingChar = { kind: 'r', operator: null, count: consumeCount(editor) };
  setAwaiting(true);
}

/** Column of the `count`-th occurrence of CHAR relative to the cursor, or
 * null if not found on this line. Forward (f/t) searches after the cursor;
 * backward (F/T) searches before it. */
function findCharColumn(text: string, startCol: number, kind: FindKind, char: string, count: number): number | null {
  const forward = kind === 'f' || kind === 't';
  let i = startCol;
  let remaining = count;
  while (remaining > 0) {
    i = forward ? text.indexOf(char, i + 1) : text.lastIndexOf(char, i - 1);
    if (i === -1) return null;
    remaining--;
  }
  return i;
}

/** Run a resolved find (from provideChar or from `;`/`,`): move / extend /
 * apply-operator over the current line. */
async function doFind(
  editor: vscode.TextEditor,
  kind: FindKind,
  char: string,
  count: number,
  operator: OperatorKind | null,
): Promise<void> {
  const line = editor.selection.active.line;
  const text = editor.document.lineAt(line).text;
  const startCol = editor.selection.active.character;
  const foundCol = findCharColumn(text, startCol, kind, char, count);
  if (foundCol === null) return; // not found → no-op, like vim
  lastFind = { kind, char };

  const forward = kind === 'f' || kind === 't';
  // Cursor landing: f/F land ON the char, t stops one before, T one after.
  const landCol = kind === 'f' ? foundCol
    : kind === 't' ? foundCol - 1
    : kind === 'F' ? foundCol
    : foundCol + 1;

  if (operator) {
    // f/F are inclusive of the found char; t/T stop short of it.
    let a: vscode.Position, b: vscode.Position;
    if (forward) {
      const endCol = kind === 'f' ? foundCol + 1 : foundCol;
      a = new vscode.Position(line, startCol);
      b = new vscode.Position(line, endCol);
    } else {
      const begCol = kind === 'F' ? foundCol : foundCol + 1;
      a = new vscode.Position(line, begCol);
      b = new vscode.Position(line, startCol);
    }
    await applyCharwiseRange(editor, operator, a, b);
    // dt,/df)/cf" dot-repeat: re-run the find + operator at the cursor.
    recordOp(operator, async () => {
      const e = activeEditor();
      if (e) await doFind(e, kind, char, count, operator);
    });
    return;
  }

  const target = new vscode.Position(line, landCol);
  setActive(editor, target);
  afterMotion(editor);
  editor.revealRange(new vscode.Range(target, target));
}

/** Replace `count` chars under the cursor with CHAR (all on the current line).
 * Cursor lands on the last replaced char, like vim. */
async function replaceChars(editor: vscode.TextEditor, char: string, count: number): Promise<void> {
  const pos = editor.selection.active;
  const line = editor.document.lineAt(pos.line);
  const end = Math.min(pos.character + count, line.text.length);
  if (end <= pos.character) return;
  const range = new vscode.Range(pos, new vscode.Position(pos.line, end));
  await editor.edit((eb) => eb.replace(range, char.repeat(end - pos.character)));
  const landing = new vscode.Position(pos.line, end - 1);
  editor.selection = new vscode.Selection(landing, landing);
}

/** The key pressed after f/F/t/T/r, delivered as a command argument (the
 * keybinding passes the character string). */
export async function provideChar(char?: unknown): Promise<void> {
  const editor = activeEditor();
  const pc = pendingChar;
  pendingChar = null;
  setAwaiting(false);
  if (!editor || !pc || typeof char !== 'string' || char.length === 0) return;

  if (pc.kind === 'r') {
    const n = pc.count;
    const ch = char;
    await replaceChars(editor, ch, n);
    // `r` dot-repeat: replace again at the cursor with the same char.
    recordChange(async (count) => { const e = activeEditor(); if (e) await replaceChars(e, ch, count ?? n); });
    return;
  }
  // doFind records its own dot-repeat when an operator is pending (dt,/cf").
  await doFind(editor, pc.kind, char, pc.count, pc.operator);
}

/** `;` (repeat last find) / `,` (repeat reversed). Neither changes the
 * canonical find — a later `;` still repeats the original `f`/`t`/… . */
export function repeatFind(reverse: boolean) {
  return async () => {
    const editor = activeEditor();
    if (!editor || !lastFind) return;
    const original = lastFind;
    const operator = pendingOperator;
    const opCount = operatorCount;
    if (operator) cancelPendingOperator();
    const count = operator ? opCount * consumeCount(editor) : consumeCount(editor);
    const kind = reverse ? FLIP[original.kind] : original.kind;
    await doFind(editor, kind, original.char, count, operator);
    lastFind = original; // doFind overwrote it; keep the canonical find
  };
}

// ── Text objects (iw/aw, i"/a", i(/a(, ip/ap …) ─────────────────────────────
// `i`/`a` after an operator (diw) or in Visual (viw) begin a text object; the
// next key names it, via the provideTextObject layer (same await-a-keystroke
// pattern as find-char). The span itself comes from the pure engine in
// textobjects.ts; here we just capture context and apply.

let pendingTextObject: { around: boolean; operator: OperatorKind | null } | null = null;

function setAwaitingTextObject(on: boolean): void {
  vscode.commands.executeCommand('setContext', 'vinel.awaitingTextObject', on);
}

/** Clear a half-typed text object (Escape). */
export function cancelPendingTextObject(): void {
  pendingTextObject = null;
  setAwaitingTextObject(false);
}

/** `i` (inner) / `a` (around) in operator-pending or Visual context. Captures
 * any pending operator, then waits for the object key. */
export function textObjectStart(around: boolean): void {
  const editor = activeEditor();
  if (!editor) return;
  const operator = pendingOperator;
  if (operator) cancelPendingOperator();
  // Count on text objects (`2iw`) isn't applied yet — drain it so it can't
  // leak into the next command.
  consumeCount(editor);
  pendingTextObject = { around, operator };
  setAwaitingTextObject(true);
}

/** The object key after `i`/`a` (delivered as arg): compute the span via the
 * engine and apply it — operator over the range, or set the Visual selection. */
export async function provideTextObject(id?: unknown): Promise<void> {
  const editor = activeEditor();
  const pt = pendingTextObject;
  pendingTextObject = null;
  setAwaitingTextObject(false);
  if (!editor || !pt || typeof id !== 'string') return;
  const objectId = id as TextObjectId;

  if (pt.operator) {
    const op = pt.operator;
    const around = pt.around;
    await applyTextObjectOp(editor, op, objectId, around);
    // diw/ciw/di(/… dot-repeat: recompute the object at the cursor + re-apply.
    recordOp(op, async () => {
      const e = activeEditor();
      if (e) await applyTextObjectOp(e, op, objectId, around);
    });
    return;
  }

  // Visual: set the selection to the object span.
  const result = textObjectRange(editor.document, editor.selection.active, objectId, pt.around);
  if (!result) return;
  editor.selection = new vscode.Selection(result.range.start, result.range.end);
}

/** Recompute a text object at the cursor and apply OP — shared by live
 * `diw`/`ciw`/… and their dot-repeat. Returns false if there's no object. */
async function applyTextObjectOp(editor: vscode.TextEditor, op: OperatorKind, id: TextObjectId, around: boolean): Promise<boolean> {
  const result = textObjectRange(editor.document, editor.selection.active, id, around);
  if (!result) return false; // no such object → no-op, like vim
  if (result.linewise) {
    // Route linewise objects (ip/ap) through the dd/cc/yy path so registers
    // and cc-indent behave correctly.
    const startLine = result.range.start.line;
    let endLine = result.range.end.line;
    if (result.range.end.character === 0 && endLine > startLine) endLine -= 1;
    const top = new vscode.Position(startLine, 0);
    editor.selection = new vscode.Selection(top, top);
    await applyLinewise(editor, op, endLine - startLine + 1);
  } else {
    await applyCharwiseRange(editor, op, result.range.start, result.range.end);
  }
  return true;
}
