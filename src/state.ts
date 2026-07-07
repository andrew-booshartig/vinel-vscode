import * as vscode from 'vscode';

/**
 * Mode + digit-count state — the foundation everything else builds on.
 *
 * Ported from the Emacs "Ultra Instinct" engine (ultra-instinct.el):
 *   POWER (yang) — every key is a command; digits are numeric counts
 *   EDIT  (yin)  — a normal text editor; you just type
 *
 * Mode is tracked PER EDITOR (keyed by document URI), matching both real vim
 * (each buffer is independently Normal/Insert) and the Emacs source (a
 * buffer-local minor mode). Fresh editors default to POWER, mirroring
 * `ultra-default-to-power`.
 */

export enum Mode {
  Power,
  Edit,
}

const modeByDocument = new Map<string, Mode>();
let pendingCount = '';
let pendingOperatorLabel: string | null = null;

let statusBarItem: vscode.StatusBarItem;

function keyFor(editor: vscode.TextEditor): string {
  return editor.document.uri.toString();
}

export function getMode(editor: vscode.TextEditor): Mode {
  return modeByDocument.get(keyFor(editor)) ?? Mode.Power;
}

export function isPower(editor: vscode.TextEditor): boolean {
  return getMode(editor) === Mode.Power;
}

/** Apply MODE to EDITOR: context key (gates keybindings), cursor shape,
 * status bar. Cursor COLOR (not just shape) is a known future addition —
 * it requires a global `workbench.colorCustomizations` write, which is a
 * heavier, visibly-async operation done poorly; shape (block/line) is the
 * verified, per-editor-safe signal for now, same as vim's own convention. */
export function setMode(editor: vscode.TextEditor, mode: Mode): void {
  modeByDocument.set(keyFor(editor), mode);
  pendingCount = '';
  pendingOperatorLabel = null;
  applyToEditor(editor);
}

function applyToEditor(editor: vscode.TextEditor): void {
  const mode = getMode(editor);
  const isPowerMode = mode === Mode.Power;

  vscode.commands.executeCommand('setContext', 'ultraInstinct.power', isPowerMode);

  editor.options = {
    ...editor.options,
    cursorStyle: isPowerMode
      ? vscode.TextEditorCursorStyle.Block
      : vscode.TextEditorCursorStyle.Line,
  };

  renderStatusBar(mode);
}

function renderStatusBar(mode: Mode): void {
  const label = mode === Mode.Power ? '☯ POWER' : '☯ EDIT';
  const count = pendingCount ? ` ${pendingCount}` : '';
  const op = pendingOperatorLabel ? ` ${pendingOperatorLabel}…` : '';
  statusBarItem.text = label + count + op;
  statusBarItem.show();
}

/** Show/clear an operator-pending indicator (e.g. "d…" while an operator is
 * waiting for its target). Purely a status-bar cue — does not affect count
 * or mode state. */
export function setPendingOperatorLabel(label: string | null): void {
  pendingOperatorLabel = label;
  const editor = vscode.window.activeTextEditor;
  if (editor) renderStatusBar(getMode(editor));
}

/** Called whenever focus moves to a different editor — re-apply that
 * editor's own remembered mode (context key, cursor, status bar). */
export function syncActiveEditor(editor: vscode.TextEditor | undefined): void {
  if (!editor) {
    statusBarItem.hide();
    return;
  }
  applyToEditor(editor);
}

// ── Digit-count buffer (POWER's "2000 <right>", vim's real 0 vs count) ─────
// Real vim: `0` with no count yet pending means "column 0" (a motion);
// `0` AFTER at least one digit is already buffered means "append to the
// count" (so `50` is a count of 50, not "5, then column 0"). Every OTHER
// digit 1-9 always starts/extends the buffer.

export function appendDigit(editor: vscode.TextEditor, digit: string): void {
  pendingCount += digit;
  renderStatusBar(getMode(editor));
}

/** True when `0` should be treated as "go to column 0" (no count pending
 * yet) rather than appended to a count in progress. */
export function zeroIsMotion(): boolean {
  return pendingCount === '';
}

/** Read the pending count (default 1) and clear the buffer. Call this from
 * every POWER motion/command exactly once, after digits, so the count
 * applies to the NEXT command and resets afterward — matching vim. */
export function consumeCount(editor: vscode.TextEditor): number {
  const n = pendingCount === '' ? 1 : parseInt(pendingCount, 10);
  pendingCount = '';
  renderStatusBar(getMode(editor));
  return Math.max(1, n);
}

/** Run COMMAND N times in sequence — the uniform way every count-aware
 * motion repeats itself. A loop (not a native `value` arg) so it's
 * unconditionally correct regardless of whether a given command happens to
 * support a repeat argument; cursor motions are cheap, so looping even a
 * large N is imperceptible. */
export async function repeatCommand(
  command: string,
  times: number,
  args?: unknown,
): Promise<void> {
  for (let i = 0; i < times; i++) {
    await vscode.commands.executeCommand(command, args);
  }
}

export function createStatusBarItem(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  context.subscriptions.push(statusBarItem);
}
