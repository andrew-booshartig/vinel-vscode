import * as vscode from 'vscode';

/**
 * Ultra Instinct — ground-up modal editing for VSCode (not a Vim emulation).
 *
 * First command: a "smart Tab" that fixes a real conflict between the
 * `tabout` extension and VSCode's own snippet-tabstop navigation. tabout's
 * own default keybinding only checks `!suggestWidgetVisible` — it does NOT
 * exclude `inSnippetMode` — so whenever you're on a snippet tabstop and the
 * completion dropdown just isn't open at that instant, tabout and the
 * built-in "jump to next tabstop" both become eligible for Tab, and tabout
 * (extension-contributed) frequently wins the tie, hijacking you out of the
 * snippet.
 *
 * This extension's package.json unbinds tabout's unqualified defaults and
 * replaces them with these two commands, which explicitly check whether the
 * cursor sits next to one of tabout's configured "special" characters
 * (bracket/quote/etc.) before deciding: if so, tab OUT of it; if not,
 * continue normal snippet-tabstop navigation. Comments and blank lines never
 * confuse it, because the check is purely "what's the character right next
 * to my cursor," not "guess the boundary of a block."
 */

interface CharPair {
  open: string;
  close: string;
}

// Mirrors tabout's own default (albert.tabout package.json) — used only if
// the user hasn't customized `tabout.charactersToTabOutFrom` themselves.
const DEFAULT_PAIRS: CharPair[] = [
  { open: '[', close: ']' },
  { open: '{', close: '}' },
  { open: '(', close: ')' },
  { open: "'", close: "'" },
  { open: '"', close: '"' },
  { open: ':', close: ':' },
  { open: '=', close: '=' },
  { open: '>', close: '>' },
  { open: '<', close: '<' },
  { open: '.', close: '.' },
  { open: '`', close: '`' },
  { open: ';', close: ';' },
];

function getCharPairs(): CharPair[] {
  const configured = vscode.workspace
    .getConfiguration('tabout')
    .get<CharPair[]>('charactersToTabOutFrom');
  return configured && configured.length > 0 ? configured : DEFAULT_PAIRS;
}

function isSpecial(ch: string | undefined, pairs: CharPair[]): boolean {
  if (!ch) return false;
  return pairs.some((p) => p.open === ch || p.close === ch);
}

/** True when the cursor is immediately next to (before or after) one of the
 * configured special characters — i.e. there's something real to tab out of. */
function cursorIsAdjacentToSpecialChar(editor: vscode.TextEditor): boolean {
  const pos = editor.selection.active;
  const line = editor.document.lineAt(pos.line).text;
  const before = pos.character > 0 ? line.charAt(pos.character - 1) : undefined;
  const after = pos.character < line.length ? line.charAt(pos.character) : undefined;
  const pairs = getCharPairs();
  return isSpecial(before, pairs) || isSpecial(after, pairs);
}

function isTaboutInstalled(): boolean {
  return vscode.extensions.getExtension('albert.tabout') !== undefined;
}

async function smartTab(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  if (isTaboutInstalled() && cursorIsAdjacentToSpecialChar(editor)) {
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

  if (reverseEnabled && isTaboutInstalled() && cursorIsAdjacentToSpecialChar(editor)) {
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
