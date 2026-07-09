import * as vscode from 'vscode';

/**
 * Mode + digit-count state — the foundation everything else builds on.
 *
 * Uses vim's own mode names throughout, so vim users never have to translate
 * a made-up vocabulary:
 *   NORMAL      — every key is a command; digits are numeric counts
 *   INSERT      — a normal text editor; you just type
 *   VISUAL      — charwise selection (`v`); motions extend it
 *   VISUAL-LINE — linewise selection (`V`); motions extend it by whole lines
 *
 * (Originally prototyped against a hand-built Emacs modal engine — "Ultra
 * Instinct" — which called Normal/Insert POWER/EDIT; renamed here to vim's
 * real terminology since that's the audience.)
 *
 * Mode is tracked PER EDITOR (keyed by document URI), matching real vim —
 * each buffer is independently Normal/Insert/Visual. Fresh editors default to
 * NORMAL.
 */

export enum Mode {
  Normal,
  Insert,
  Visual,
  VisualLine,
  VisualBlock,
  Replace,
}

const modeByDocument = new Map<string, Mode>();
let pendingCount = '';
let pendingOperatorLabel: string | null = null;

// The anchor LINE for linewise visual (`V`). Charwise visual (`v`) needs no
// stored anchor — it rides VS Code's own selection anchor. Null outside
// VisualLine.
let visualLineAnchor: number | null = null;

// The fixed corner (anchor) for blockwise visual (`Ctrl-V`) — a 2D position, so
// the rectangle spans between it and the moving corner. Null outside VisualBlock.
let visualBlockAnchor: vscode.Position | null = null;

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

/** Any visual sub-mode (charwise `v`, linewise `V`, or blockwise `Ctrl-V`). */
export function isVisual(editor: vscode.TextEditor): boolean {
  const m = getMode(editor);
  return m === Mode.Visual || m === Mode.VisualLine || m === Mode.VisualBlock;
}

/** The fixed corner for blockwise visual — set by `Ctrl-V`, read by the reshape. */
export function getVisualBlockAnchor(): vscode.Position | null {
  return visualBlockAnchor;
}
export function setVisualBlockAnchor(pos: vscode.Position | null): void {
  visualBlockAnchor = pos;
}

/** The anchor line for linewise visual — set by `V`, read by the reshape. */
export function getVisualLineAnchor(): number | null {
  return visualLineAnchor;
}
export function setVisualLineAnchor(line: number | null): void {
  visualLineAnchor = line;
}

/** Move the caret to POS as a motion result, respecting the current mode:
 * - charwise Visual → extend the selection (keep VS Code's own anchor);
 * - Normal / VisualLine → collapse to POS (VisualLine then reshapes to full
 *   lines in `afterMotion`, so the collapse is just a staging step).
 * Used by the CUSTOM motions (`0`, `^`, `{`, `}`) that build a Position by
 * hand rather than calling a native cursor command. */
export function setActive(editor: vscode.TextEditor, pos: vscode.Position): void {
  if (getMode(editor) === Mode.Visual) {
    editor.selection = new vscode.Selection(editor.selection.anchor, pos);
  } else {
    editor.selection = new vscode.Selection(pos, pos);
  }
}

/** Called at the end of every motion. In VisualLine it reshapes the selection
 * to cover whole lines between the stored anchor line and the current active
 * line; in every other mode it's a no-op (charwise `…Select` commands already
 * produced the right selection). */
export function afterMotion(editor: vscode.TextEditor): void {
  if (getMode(editor) !== Mode.VisualLine) return;
  const anchorLine = visualLineAnchor ?? editor.selection.active.line;
  const activeLine = editor.selection.active.line;
  const top = Math.min(anchorLine, activeLine);
  const bot = Math.max(anchorLine, activeLine);
  const topPos = new vscode.Position(top, 0);
  const botPos = editor.document.lineAt(bot).range.end;
  // Keep the caret (active) on the MOVING side so the next j/k continues in
  // the same direction: moved down from the anchor → anchor=top, active=bot;
  // moved up → anchor=bot, active=top. The anchor line is always the STORED
  // `visualLineAnchor`, not VS Code's own selection anchor (which the native
  // `…Select` commands scribble over) — that's what keeps linewise stable.
  editor.selection = activeLine >= anchorLine
    ? new vscode.Selection(topPos, botPos)
    : new vscode.Selection(botPos, topPos);
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
  // The linewise anchor only makes sense inside VisualLine; any other mode
  // drops it, so it can't leak into a later, unrelated visual session.
  if (mode !== Mode.VisualLine) visualLineAnchor = null;
  if (mode !== Mode.VisualBlock) visualBlockAnchor = null;
  applyToEditor(editor);
}

// A STRING context key (not a boolean) — the four values gate every `when`
// clause in package.json. 'visual'/'visual-line' were designed in from the
// start (that's why this was a string, not the old boolean `power`).
const CONTEXT_VALUE: Record<Mode, string> = {
  [Mode.Normal]: 'normal',
  [Mode.Insert]: 'insert',
  [Mode.Visual]: 'visual',
  [Mode.VisualLine]: 'visual-line',
  [Mode.VisualBlock]: 'visual-block',
  [Mode.Replace]: 'replace',
};

const STATUS_LABEL: Record<Mode, string> = {
  [Mode.Normal]: '☯ NORMAL',
  [Mode.Insert]: '☯ INSERT',
  [Mode.Visual]: '☯ VISUAL',
  [Mode.VisualLine]: '☯ V-LINE',
  [Mode.VisualBlock]: '☯ V-BLOCK',
  [Mode.Replace]: '☯ REPLACE',
};

function applyToEditor(editor: vscode.TextEditor): void {
  const mode = getMode(editor);

  vscode.commands.executeCommand('setContext', 'vinel.mode', CONTEXT_VALUE[mode]);

  // Line cursor while typing (Insert); underline in Replace (vim's overtype
  // cue); block everywhere else. Cursor COLOR is a known future addition;
  // shape is the per-editor-safe signal for now.
  editor.options = {
    ...editor.options,
    cursorStyle: mode === Mode.Insert
      ? vscode.TextEditorCursorStyle.Line
      : mode === Mode.Replace
        ? vscode.TextEditorCursorStyle.Underline
        : vscode.TextEditorCursorStyle.Block,
  };

  renderStatusBar(mode);
}

function renderStatusBar(mode: Mode): void {
  const count = pendingCount ? ` ${pendingCount}` : '';
  const op = pendingOperatorLabel ? ` ${pendingOperatorLabel}…` : '';
  statusBarItem.text = STATUS_LABEL[mode] + count + op;
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

/** Whether a numeric count is currently buffered — lets `G`/`gg` tell
 * `{count}G` (absolute line) apart from a bare `G` (last/first line). */
export function hasPendingCount(): boolean {
  return pendingCount !== '';
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

/** Preload the count buffer to N — used by dot-repeat replay thunks to
 * re-invoke a count-consuming handler with the recorded count (the handler's
 * own `consumeCount` then reads it back). */
export function setPendingCount(n: number): void {
  pendingCount = n > 1 ? String(n) : '';
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
