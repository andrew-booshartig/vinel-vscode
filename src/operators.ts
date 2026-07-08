import * as vscode from 'vscode';
import { Mode, consumeCount, setMode, setPendingOperatorLabel } from './state';
import { setRegister, getRegister } from './registers';

/**
 * Vim's operator grammar: `[count1] operator [count2] motion`, where the
 * effective repeat is count1 × count2 (`2d3w` deletes 6 words), OR a
 * doubled operator letter (`dd`/`cc`/`yy`) meaning "N whole lines" using
 * count1 alone. This module is the pending-operator state machine plus the
 * actual text mutation (delete/change/yank), operating on either a
 * charwise range or N whole lines.
 *
 * Scope (Milestone 2): dd/cc/yy (line), dw/cw/yw (word), D/C/Y (to end of
 * line / whole line), x/p/P (character), o/O (open line), undo/redo — the
 * highest-frequency vim edits. Text objects (`ci"`, `da(`) and generalizing
 * "any operator + any motion" (dG, d}, d/pattern, …) are follow-on
 * milestones; the architecture here (charwise range application) already
 * supports them cleanly once wired up.
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
    // Leave ONE truly empty line, then ask VS Code's own language-aware
    // indenter to fill it in — not a naive copy of the target line's own
    // literal whitespace, which is wrong exactly when it matters most: `cc`
    // on an ALREADY-BLANK line (e.g. inside an indented block) has zero
    // whitespace to copy, so the naive approach left the new line
    // unindented instead of matching the surrounding block. This is the
    // same mechanism openBelow/openAbove already use for `o`/`O`.
    const replacement = isLastLine ? '' : '\n';
    await editor.edit((eb) => eb.replace(new vscode.Range(beg, end), replacement));
    const blankPos = new vscode.Position(startLine, 0);
    editor.selection = new vscode.Selection(blankPos, blankPos);
    await vscode.commands.executeCommand('editor.action.reindentselectedlines').then(undefined, () => {});
    const indentedLine = editor.document.lineAt(startLine);
    const pos = new vscode.Position(startLine, indentedLine.text.length);
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
