import * as vscode from 'vscode';
import { afterMotion, consumeCount, isVisual, repeatCommand, setActive } from './state';

/**
 * Core motions — the vim-standard set, count-aware, shared by NORMAL and
 * VISUAL. In visual mode the SAME motion extends the selection instead of
 * just moving the caret: native cursor commands have a `…Select` variant
 * (`cursorRight`→`cursorRightSelect`) and `cursorMove` takes `select: true`,
 * so we get selection extension for free — no hand-rolled selection math.
 * Custom motions (`0`/`^`/`{`/`}`) route through `setActive`, which extends
 * or collapses per mode. Every motion ends with `afterMotion`, which reshapes
 * a linewise (`V`) selection to whole lines.
 *
 * Reused wherever VSCode already has the right native command. Custom logic
 * only where VSCode has no equivalent, or where matching REAL vim semantics
 * requires it — see the `0`/`$`/`^` notes below.
 */

function activeEditor(): vscode.TextEditor | undefined {
  return vscode.window.activeTextEditor;
}

async function move(editor: vscode.TextEditor, command: string): Promise<void> {
  const n = consumeCount(editor);
  // In visual mode, the `…Select` variant extends the selection natively.
  const cmd = isVisual(editor) ? command + 'Select' : command;
  await repeatCommand(cmd, n);
  afterMotion(editor);
}

/**
 * SCALING: vertical motion with a NATIVE count — one `cursorMove` carrying
 * `value: N`, not N separate `cursorDown` dispatches. Vim counts are
 * effectively unbounded (`500j`), and the repeat-loop is the one place this
 * engine could add latency that grows with the count; collapsing it to a
 * single native call keeps even a huge count to one round-trip. `j`/`k` are
 * the common large-count motions, and `by: 'wrappedLine'` reproduces VS
 * Code's own `cursorUp`/`cursorDown` exactly (goal column preserved), so
 * this is a pure speedup with no behavior change.
 *
 * `h`/`l` (below) intentionally stay on the repeat-loop: horizontal counts
 * are almost always tiny, and looping `cursorLeft`/`cursorRight` preserves
 * their exact line-wrap semantics without having to re-derive them here.
 *
 * In visual mode, `select: true` makes the same single call EXTEND the
 * selection down/up by N lines — same one-round-trip speedup.
 */
async function moveVertical(editor: vscode.TextEditor, to: 'up' | 'down'): Promise<void> {
  const n = consumeCount(editor);
  await vscode.commands.executeCommand('cursorMove', {
    to, by: 'wrappedLine', value: n, select: isVisual(editor),
  });
  afterMotion(editor);
}

export const moveLeft = () => activeEditor() && move(activeEditor()!, 'cursorLeft');
export const moveRight = () => activeEditor() && move(activeEditor()!, 'cursorRight');
export const moveUp = () => activeEditor() && moveVertical(activeEditor()!, 'up');
export const moveDown = () => activeEditor() && moveVertical(activeEditor()!, 'down');

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
  setActive(editor, pos);
  afterMotion(editor);
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
  setActive(editor, pos);
  afterMotion(editor);
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
  setActive(editor, pos);
  afterMotion(editor);
  editor.revealRange(new vscode.Range(pos, pos));
}

export const paragraphBackward = () => paragraphMove(-1);
export const paragraphForward = () => paragraphMove(1);

/** `/` — VSCode's own native Find, not a hand-built vim search reimplementation.
 * Same call the Emacs port made for isearch: when the host platform already
 * has an excellent, idiomatic search experience, use it rather than
 * reimplementing vim's search-and-jump as a leaky abstraction on top. */
export const search = () => vscode.commands.executeCommand('actions.find');
