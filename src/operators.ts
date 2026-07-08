import * as vscode from 'vscode';
import { Mode, consumeCount, getMode, isVisual, setMode, setPendingOperatorLabel } from './state';
import { setRegister, getRegister } from './registers';

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
    const start = editor.selection.active;
    for (let i = 0; i < opCount * motionCount; i++) {
      await vscode.commands.executeCommand(rawCommand);
    }
    const end = editor.selection.active;
    await applyCharwiseRange(editor, op, start, end);
  };
}

/** Apply OP to the charwise range between A and B (order-independent). */
async function applyCharwiseRange(
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

export async function deleteToEol(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  consumeCount(editor); // vim's D/C don't take a useful count in the common case
  const pos = editor.selection.active;
  await applyCharwiseRange(editor, 'delete', pos, editor.document.lineAt(pos.line).range.end);
}

export async function changeToEol(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  consumeCount(editor);
  const pos = editor.selection.active;
  await applyCharwiseRange(editor, 'change', pos, editor.document.lineAt(pos.line).range.end);
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

export async function cutChar(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  // In visual, `x` deletes the selection (same as `d`).
  if (isVisual(editor)) {
    await applyVisualOperator(editor, 'delete');
    return;
  }
  const n = consumeCount(editor);
  const pos = editor.selection.active;
  const line = editor.document.lineAt(pos.line);
  const end = new vscode.Position(pos.line, Math.min(pos.character + n, line.text.length));
  if (pos.isEqual(end)) return;
  const text = editor.document.getText(new vscode.Range(pos, end));
  setRegister(text, false);
  await editor.edit((eb) => eb.delete(new vscode.Range(pos, end)));
}

export async function pasteAfter(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  // In visual, `p` pastes OVER the selection (replace it with the register).
  if (isVisual(editor)) {
    await visualPasteOver(editor);
    return;
  }
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
    const insertAt = pos.character < line.text.length
      ? pos.translate(0, 1)
      : pos;
    await editor.edit((eb) => eb.insert(insertAt, text));
    const after = insertAt.translate(0, text.length);
    editor.selection = new vscode.Selection(after, after);
  }
}

export async function pasteBefore(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
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

// ── o / O — open a line below/above and enter INSERT ────────────────────────

export async function openBelow(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  const line = editor.selection.active.line;
  const end = editor.document.lineAt(line).range.end;
  await editor.edit((eb) => eb.insert(end, '\n'));
  const pos = new vscode.Position(line + 1, 0);
  editor.selection = new vscode.Selection(pos, pos);
  await vscode.commands.executeCommand('editor.action.reindentselectedlines').then(undefined, () => {});
  setMode(editor, Mode.Insert);
}

export async function openAbove(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  const line = editor.selection.active.line;
  const start = new vscode.Position(line, 0);
  await editor.edit((eb) => eb.insert(start, '\n'));
  editor.selection = new vscode.Selection(start, start);
  await vscode.commands.executeCommand('editor.action.reindentselectedlines').then(undefined, () => {});
  setMode(editor, Mode.Insert);
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
