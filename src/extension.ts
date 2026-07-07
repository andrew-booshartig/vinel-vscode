import * as vscode from 'vscode';

/**
 * Ultra Instinct — ground-up modal editing for VSCode (not a Vim emulation).
 *
 * First command: a "smart Tab" scoped SPECIFICALLY to the "pf" (Quick
 * F-String Print) snippet — see ~/Library/Application Support/Code/User/
 * snippets/python.json, body: `print(f"$1")$0`.
 *
 * Inside that snippet's $1 field you type free-form f-string content,
 * including your own `{expr}` interpolations (auto-closed by the editor).
 * When the cursor sits next to the closing `}` of one of those, you want Tab
 * to hop over it (via `tabout`) rather than advance the snippet's own
 * tabstop. Everywhere else — every other snippet, and this one when NOT next
 * to a `}` — Tab must behave exactly as if this extension didn't exist.
 *
 * There's no VSCode API to ask "which named snippet is currently active," so
 * this deliberately does NOT try to generalize to "any bracket in any
 * snippet" (an earlier version did, and it wrongly hijacked Tab in `dict`/
 * `set`/`gd`, which also contain literal `{`/`"` in their bodies). Instead it
 * checks the literal TEXT SHAPE that only the pf snippet produces — the
 * current line reads `print(f"...` up to the cursor, string not yet closed —
 * combined with the pre-existing `inSnippetMode` gate (see package.json).
 * That combination is unique to being inside pf's $1 field; nothing else
 * matches it. If the pf snippet's body ever changes, update PF_PREFIX below
 * to match.
 */

const PF_PREFIX = /^\s*print\(f"[^"]*$/;

function isTaboutInstalled(): boolean {
  return vscode.extensions.getExtension('albert.tabout') !== undefined;
}

/** True ONLY inside the pf snippet's f-string field, with a `}` immediately
 * ahead of the cursor (the auto-closed brace of the interpolation you just
 * finished typing).  Checking only the character AHEAD (not behind) matters:
 * right after hopping over a `}`, the character BEHIND the cursor is still
 * `}` — if we checked that too, pressing Tab again with nothing typed in
 * between would wrongly fire a second time and skip past the closing quote. */
function isNextToClosingBraceInPfSnippet(editor: vscode.TextEditor): boolean {
  const pos = editor.selection.active;
  const line = editor.document.lineAt(pos.line).text;
  const before = line.slice(0, pos.character);
  if (!PF_PREFIX.test(before)) return false;

  const nextChar = pos.character < line.length ? line.charAt(pos.character) : undefined;
  return nextChar === '}';
}

async function smartTab(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  if (isTaboutInstalled() && isNextToClosingBraceInPfSnippet(editor)) {
    try {
      await vscode.commands.executeCommand('tabout');
      return;
    } catch {
      // tabout registered but failed for some reason — fall through to snippet jump.
    }
  }
  await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
}

async function smartShiftTab(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const reverseEnabled = vscode.workspace
    .getConfiguration('tabout')
    .get<boolean>('enableReverseShiftTab', true);

  if (reverseEnabled && isTaboutInstalled() && isNextToClosingBraceInPfSnippet(editor)) {
    try {
      await vscode.commands.executeCommand('tabout-reverse');
      return;
    } catch {
      // fall through
    }
  }
  await vscode.commands.executeCommand('jumpToPrevSnippetPlaceholder');
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ultraInstinct.smartTab', smartTab),
    vscode.commands.registerCommand('ultraInstinct.smartShiftTab', smartShiftTab),
  );
}

export function deactivate(): void {
  // nothing to clean up
}
