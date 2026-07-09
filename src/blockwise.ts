import * as vscode from 'vscode';
import {
  Mode, getMode, setMode, getVisualBlockAnchor, setVisualBlockAnchor,
} from './state';
import { setRegister } from './registers';
import { beginInsertChange } from './dotrepeat';

/**
 * Blockwise Visual (`Ctrl-V`) — columnar selection, done with VS Code's own
 * multi-cursor.
 *
 * A block selection IS one selection per line spanning the same column pair —
 * exactly a VS Code `editor.selections` array. So the rectangle, its `d`/`c`/`y`,
 * and above all the block-insert broadcast (`I`/`A` type once → applied to every
 * row) are things VS Code already does natively; ViNEL just shapes the
 * selections and enters Insert. No per-keystroke code, no `type` hijack.
 *
 * The fixed corner lives in state (`visualBlockAnchor`); the moving corner is
 * `activeCorner` here. `toEol` (set by `$`) makes each row extend to its own
 * line end (a ragged right edge), like vim.
 */

let activeCorner: vscode.Position = new vscode.Position(0, 0);
let toEol = false;

function active(): vscode.TextEditor | undefined {
  return vscode.window.activeTextEditor;
}

/** Rebuild the rectangle from the fixed anchor + the moving corner. */
function reshapeBlock(editor: vscode.TextEditor): void {
  const anchor = getVisualBlockAnchor();
  if (!anchor) return;
  const top = Math.min(anchor.line, activeCorner.line);
  const bot = Math.max(anchor.line, activeCorner.line);
  const leftCol = Math.min(anchor.character, activeCorner.character);
  // Right edge is inclusive of the char under the moving corner (vim), so +1 to
  // VS Code's exclusive selection end.
  const rightCol = Math.max(anchor.character, activeCorner.character) + 1;

  const selections: vscode.Selection[] = [];
  for (let line = top; line <= bot; line++) {
    const len = editor.document.lineAt(line).text.length;
    const startChar = Math.min(leftCol, len);
    const endChar = toEol ? len : Math.min(rightCol, len);
    selections.push(new vscode.Selection(
      new vscode.Position(line, startChar),
      new vscode.Position(line, endChar),
    ));
  }
  // Keep the moving corner's row as the primary selection so it stays visible.
  editor.selections = selections;
  editor.revealRange(new vscode.Range(activeCorner, activeCorner));
}

/** `Ctrl-V` — enter blockwise visual, or toggle it off (back to Normal). */
export function enterVisualBlock(): void {
  const editor = active();
  if (!editor) return;
  if (getMode(editor) === Mode.VisualBlock) {
    const pos = activeCorner;
    editor.selection = new vscode.Selection(pos, pos);
    setMode(editor, Mode.Normal);
    return;
  }
  const start = editor.selection.active;
  setVisualBlockAnchor(start);
  activeCorner = start;
  toEol = false;
  setMode(editor, Mode.VisualBlock);
  reshapeBlock(editor);
}

// ── Motions: move the active corner, then reshape ──────────────────────────

function moveCorner(line: number, character: number): void {
  const editor = active();
  if (!editor) return;
  const lastLine = editor.document.lineCount - 1;
  const l = Math.max(0, Math.min(line, lastLine));
  const c = Math.max(0, character);
  activeCorner = new vscode.Position(l, c);
  reshapeBlock(editor);
}

export function blockDown(): void { moveCorner(activeCorner.line + 1, activeCorner.character); }
export function blockUp(): void { moveCorner(activeCorner.line - 1, activeCorner.character); }
export function blockLeft(): void { toEol = false; moveCorner(activeCorner.line, activeCorner.character - 1); }

export function blockRight(): void {
  const editor = active();
  if (!editor) return;
  toEol = false;
  // Cap growth at the active row's length so the corner tracks something real.
  const len = editor.document.lineAt(activeCorner.line).text.length;
  moveCorner(activeCorner.line, Math.min(activeCorner.character + 1, len));
}

export function blockLineStart(): void { toEol = false; moveCorner(activeCorner.line, 0); }

export function blockLineEnd(): void {
  const editor = active();
  if (!editor) return;
  toEol = true;
  const len = editor.document.lineAt(activeCorner.line).text.length;
  activeCorner = new vscode.Position(activeCorner.line, len);
  reshapeBlock(editor);
}

// ── Operators on the rectangle (selections already ARE the block) ──────────

/** Join the per-row selected text top→bottom for the register. */
function blockText(editor: vscode.TextEditor): string {
  return [...editor.selections]
    .sort((a, b) => a.start.line - b.start.line)
    .map((s) => editor.document.getText(s))
    .join('\n');
}

function topLeft(editor: vscode.TextEditor): vscode.Position {
  return [...editor.selections].sort(
    (a, b) => a.start.line - b.start.line || a.start.character - b.start.character,
  )[0].start;
}

/** `y` — yank the block (stored charwise as newline-joined rows). */
export async function blockYank(): Promise<void> {
  const editor = active();
  if (!editor) return;
  setRegister(blockText(editor), false);
  const pos = topLeft(editor);
  editor.selection = new vscode.Selection(pos, pos);
  setMode(editor, Mode.Normal);
}

/** `d` / `x` — delete the block. */
export async function blockDelete(): Promise<void> {
  const editor = active();
  if (!editor) return;
  setRegister(blockText(editor), false);
  const pos = topLeft(editor);
  const ranges = editor.selections.map((s) => new vscode.Range(s.start, s.end));
  await editor.edit((eb) => { for (const r of ranges) eb.delete(r); });
  editor.selection = new vscode.Selection(pos, pos);
  setMode(editor, Mode.Normal);
}

/** `c` — delete the block, then insert at each row's left edge (broadcast typing). */
export async function blockChange(): Promise<void> {
  const editor = active();
  if (!editor) return;
  setRegister(blockText(editor), false);
  const ranges = editor.selections.map((s) => new vscode.Range(s.start, s.end));
  await editor.edit((eb) => { for (const r of ranges) eb.delete(r); });
  // After deletion each selection collapses to its start — those are the insert
  // cursors. Enter Insert; VS Code broadcasts typing to all of them.
  beginInsertChange(editor, () => { const e = active(); if (e) setMode(e, Mode.Insert); });
  setMode(editor, Mode.Insert);
}

// ── I / A — block insert / append (the headline feature) ───────────────────

/** `I` — collapse to each row's LEFT edge and insert on every row at once. */
export function blockInsert(): void {
  const editor = active();
  if (!editor) return;
  editor.selections = editor.selections.map((s) => new vscode.Selection(s.start, s.start));
  beginInsertChange(editor, () => { const e = active(); if (e) setMode(e, Mode.Insert); });
  setMode(editor, Mode.Insert);
}

/** `A` — collapse to each row's RIGHT edge (or line end under `$`) and append. */
export function blockAppend(): void {
  const editor = active();
  if (!editor) return;
  editor.selections = editor.selections.map((s) => new vscode.Selection(s.end, s.end));
  beginInsertChange(editor, () => { const e = active(); if (e) setMode(e, Mode.Insert); });
  setMode(editor, Mode.Insert);
}
