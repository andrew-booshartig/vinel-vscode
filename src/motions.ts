import * as vscode from 'vscode';
import { consumeCount, repeatCommand } from './state';

/**
 * Core NORMAL-mode motions — the vim-standard set, count-aware.
 *
 * Reused wherever VSCode already has the right native command (mirrors an
 * earlier Emacs-based prototype's own philosophy: "Most POWER motions are
 * plain built-in commands... they need no wrappers" — same idea, just
 * VSCode's builtins instead of Emacs's). Custom logic only where VSCode has
 * no equivalent, or where matching REAL vim semantics (not that prototype's
 * Emacs-specific workarounds) requires it — see the `0`/`$`/`^` notes below.
 */

function activeEditor(): vscode.TextEditor | undefined {
  return vscode.window.activeTextEditor;
}

async function move(editor: vscode.TextEditor, command: string): Promise<void> {
  const n = consumeCount(editor);
  await repeatCommand(command, n);
}

export const moveLeft = () => activeEditor() && move(activeEditor()!, 'cursorLeft');
export const moveRight = () => activeEditor() && move(activeEditor()!, 'cursorRight');
export const moveUp = () => activeEditor() && move(activeEditor()!, 'cursorUp');
export const moveDown = () => activeEditor() && move(activeEditor()!, 'cursorDown');

export const wordForward = () => activeEditor() && move(activeEditor()!, 'cursorWordStartRight');
export const wordBackward = () => activeEditor() && move(activeEditor()!, 'cursorWordStartLeft');
export const wordEnd = () => activeEditor() && move(activeEditor()!, 'cursorWordEndRight');

/**
 * `0` — REAL vim: always column 0 of the current line. (The Emacs port
 * remaps this to `,` because Emacs's `suppress-keymap` hard-binds every
 * digit to a numeric-argument prefix, so `0` was never available as a
 * motion there — an Emacs-platform constraint, not a vim one. VSCode has no
 * such constraint; our own digit-count buffer disambiguates `0` the same
 * way real vim does — see `zeroIsMotion()` in state.ts — so `0` can be the
 * real vim motion here.)
 */
export function lineStart(): void {
  const editor = activeEditor();
  if (!editor) return;
  consumeCount(editor); // 0 as a motion takes no count; keep buffer well-formed
  const line = editor.selection.active.line;
  const pos = new vscode.Position(line, 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos));
}

/** `^` — first non-whitespace character on the line (vim). */
export function firstNonBlank(): void {
  const editor = activeEditor();
  if (!editor) return;
  consumeCount(editor);
  const line = editor.selection.active.line;
  const text = editor.document.lineAt(line).text;
  const firstNonWs = text.search(/\S/);
  const col = firstNonWs === -1 ? 0 : firstNonWs;
  const pos = new vscode.Position(line, col);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos));
}

/**
 * `$` — end of line. Uses VSCode's own `cursorEnd` (lands AFTER the last
 * character, the conventional between-characters model VSCode/Emacs both
 * use). Real vim's cursor occupies a character CELL and `$` lands ON the
 * last character, never past it — a deeper model difference that would
 * touch nearly every motion (h/l at line boundaries, etc.) if adopted
 * fully. Deliberately NOT doing that in this milestone; flagging it as its
 * own future decision rather than a silent partial implementation.
 */
export const lineEnd = () => activeEditor() && move(activeEditor()!, 'cursorEnd');

export const bufferTop = () => activeEditor() && move(activeEditor()!, 'cursorTop');
export const bufferBottom = () => activeEditor() && move(activeEditor()!, 'cursorBottom');

/** `{` / `}` — previous/next paragraph. Vim's definition: a paragraph
 * boundary is a blank line (a run of blank lines counts as one boundary)
 * or a buffer edge. VSCode has no built-in for this, so it's a real scan. */
function isBlank(document: vscode.TextDocument, line: number): boolean {
  return document.lineAt(line).text.trim() === '';
}

function paragraphBoundary(
  document: vscode.TextDocument,
  fromLine: number,
  direction: 1 | -1,
): number {
  let line = fromLine;
  const lastLine = document.lineCount - 1;
  // Step off a boundary we're already sitting on, so repeated presses advance.
  while (
    line + direction >= 0 &&
    line + direction <= lastLine &&
    isBlank(document, line) === isBlank(document, line + direction)
  ) {
    line += direction;
  }
  line += direction;
  return Math.min(Math.max(line, 0), lastLine);
}

async function paragraphMove(direction: 1 | -1): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  const n = consumeCount(editor);
  let line = editor.selection.active.line;
  for (let i = 0; i < n; i++) {
    line = paragraphBoundary(editor.document, line, direction);
  }
  const pos = new vscode.Position(line, 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos));
}

export const paragraphBackward = () => paragraphMove(-1);
export const paragraphForward = () => paragraphMove(1);

/** `/` — VSCode's own native Find, not a hand-built vim search reimplementation.
 * Same call the Emacs port made for isearch: when the host platform already
 * has an excellent, idiomatic search experience, use it rather than
 * reimplementing vim's search-and-jump as a leaky abstraction on top. */
export const search = () => vscode.commands.executeCommand('actions.find');
