import * as vscode from 'vscode';
import { Mode, appendDigit, createStatusBarItem, setMode, syncActiveEditor, zeroIsMotion } from './state';
import * as motions from './motions';

/**
 * Ultra Instinct — ground-up modal editing engine for VSCode. Not a Vim
 * emulation: those consistently fight VSCode's own engine at the edges
 * (snippets, suggestions, brackets). This is a real port of a from-scratch
 * modal editor (POWER/EDIT modes), following standard vim semantics as the
 * target — the Emacs source (ultra-instinct.el et al.) is a REFERENCE for
 * mechanism, not a spec to copy verbatim, since some of its choices exist
 * only to work around Emacs-specific constraints (see motions.ts's note on
 * `0`/`,`). Where VSCode already does something excellently (its own Find,
 * its own cursor-move commands, undo/redo), this uses that directly rather
 * than reimplementing vim on top of it — the same call the Emacs port made
 * keeping native isearch instead of a hand-built vim search.
 *
 * package.json also contributes a general keybinding fix: `tabout`'s own
 * default binding doesn't exclude `inSnippetMode`, so it can hijack Tab away
 * from snippet-tabstop navigation. That's fixed declaratively (no code here)
 * — see the `contributes.keybindings` block.
 */

function enterPower(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  setMode(editor, Mode.Power);
}

function enterEdit(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  setMode(editor, Mode.Edit);
}

/** `0` — real vim: a motion (column 0) unless a count is already being
 * typed, in which case it extends the count (so `50` means fifty, not
 * "five, then column 0"). See state.ts / motions.ts for the full rationale. */
function digitZero(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  if (zeroIsMotion()) {
    motions.lineStart();
  } else {
    appendDigit(editor, '0');
  }
}

function digit(n: string): () => void {
  return () => {
    const editor = vscode.window.activeTextEditor;
    if (editor) appendDigit(editor, n);
  };
}

export function activate(context: vscode.ExtensionContext): void {
  createStatusBarItem(context);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(syncActiveEditor),
  );
  // Editors already open when the extension activates.
  syncActiveEditor(vscode.window.activeTextEditor);

  const commands: [string, (...args: unknown[]) => unknown][] = [
    ['ultraInstinct.enterPower', enterPower],
    ['ultraInstinct.enterEdit', enterEdit],

    ['ultraInstinct.digit0', digitZero],
    ['ultraInstinct.digit1', digit('1')],
    ['ultraInstinct.digit2', digit('2')],
    ['ultraInstinct.digit3', digit('3')],
    ['ultraInstinct.digit4', digit('4')],
    ['ultraInstinct.digit5', digit('5')],
    ['ultraInstinct.digit6', digit('6')],
    ['ultraInstinct.digit7', digit('7')],
    ['ultraInstinct.digit8', digit('8')],
    ['ultraInstinct.digit9', digit('9')],

    ['ultraInstinct.moveLeft', motions.moveLeft],
    ['ultraInstinct.moveRight', motions.moveRight],
    ['ultraInstinct.moveUp', motions.moveUp],
    ['ultraInstinct.moveDown', motions.moveDown],
    ['ultraInstinct.wordForward', motions.wordForward],
    ['ultraInstinct.wordBackward', motions.wordBackward],
    ['ultraInstinct.wordEnd', motions.wordEnd],
    ['ultraInstinct.firstNonBlank', motions.firstNonBlank],
    ['ultraInstinct.lineEnd', motions.lineEnd],
    ['ultraInstinct.bufferTop', motions.bufferTop],
    ['ultraInstinct.bufferBottom', motions.bufferBottom],
    ['ultraInstinct.paragraphBackward', motions.paragraphBackward],
    ['ultraInstinct.paragraphForward', motions.paragraphForward],
    ['ultraInstinct.search', motions.search],
  ];

  for (const [id, handler] of commands) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }
}

export function deactivate(): void {
  // nothing to clean up
}
