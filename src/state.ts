import * as vscode from 'vscode';

/**
 * Mode + digit-count state — the foundation everything else builds on.
 *
 * Uses vim's own mode names throughout, so vim users never have to translate
 * a made-up vocabulary:
 *   NORMAL — every key is a command; digits are numeric counts
 *   INSERT — a normal text editor; you just type
 *
 * (Originally prototyped against a hand-built Emacs modal engine — "Ultra
 * Instinct" — which called these POWER/EDIT; renamed here to vim's real
 * terminology since that's the audience.)
 *
 * Mode is tracked PER EDITOR (keyed by document URI), matching real vim —
 * each buffer is independently Normal/Insert. Fresh editors default to
 * NORMAL.
 */

export enum Mode {
  Normal,
  Insert,
}

const modeByDocument = new Map<string, Mode>();
let pendingCount = '';
let pendingOperatorLabel: string | null = null;

let statusBarItem: vscode.StatusBarItem;

function keyFor(editor: vscode.TextEditor): string {
  return editor.document.uri.toString();
}

export function getMode(editor: vscode.TextEditor): Mode {
  return modeByDocument.get(keyFor(editor)) ?? Mode.Normal;
}

export function isNormal(editor: vscode.TextEditor): boolean {
  return getMode(editor) === Mode.Normal;
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
  const isNormalMode = mode === Mode.Normal;

  // A STRING context key (not a boolean) so a future VISUAL mode slots in
  // as a third value ('visual') without another rename pass across every
  // `when` clause in package.json.
  vscode.commands.executeCommand('setContext', 'betterVim.mode', isNormalMode ? 'normal' : 'insert');

  editor.options = {
    ...editor.options,
    cursorStyle: isNormalMode
      ? vscode.TextEditorCursorStyle.Block
      : vscode.TextEditorCursorStyle.Line,
  };

  renderStatusBar(mode);
}

function renderStatusBar(mode: Mode): void {
  const label = mode === Mode.Normal ? '☯ NORMAL' : '☯ INSERT';
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
 * editor's own remembered mode (context key, cursor, status bar). Never
 * touches cursor POSITION, only presentation — switching tabs can't cause
 * an unwanted cursor jump. */
export function syncActiveEditor(editor: vscode.TextEditor | undefined): void {
  if (!editor) {
    statusBarItem.hide();
    return;
  }
  applyToEditor(editor);
}

// ── Digit-count buffer (NORMAL's "2000 <right>", vim's real 0 vs count) ────
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
 * every NORMAL-mode motion/command exactly once, after digits, so the count
 * applies to the NEXT command and resets afterward — matching vim. */
export function consumeCount(editor: vscode.TextEditor): number {
  const n = pendingCount === '' ? 1 : parseInt(pendingCount, 10);
  pendingCount = '';
  renderStatusBar(getMode(editor));
  return Math.max(1, n);
}

/** Run COMMAND N times in sequence — the fallback repeat path for commands
 * that have NO native count argument (word motions `cursorWordStartRight`
 * etc., `cursorLeft`/`cursorRight`). A loop keeps it unconditionally correct
 * regardless of whether the command supports a repeat value.
 *
 * SCALING: this is O(N) sequential command dispatches, so it's reserved for
 * motions whose counts are in practice tiny (`3w`, `5l`). Where a large
 * count is realistic — vertical `j`/`k` (`500j`) — motions.ts uses VS Code's
 * native `cursorMove` `value: N` instead, collapsing N dispatches into one.
 * Don't route a plausibly-large-count motion through this loop. */
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
