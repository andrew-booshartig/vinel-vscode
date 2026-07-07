import * as vscode from 'vscode';

/**
 * Ultra Instinct — ground-up modal editing engine for VSCode. Not a Vim
 * emulation: those consistently fight VSCode's own engine at the edges
 * (snippets, suggestions, brackets). This is a real port of a from-scratch
 * modal editor (POWER/EDIT modes), not a Vim clone.
 *
 * package.json also contributes a general keybinding fix: `tabout`'s own
 * default binding doesn't exclude `inSnippetMode`, so it can hijack Tab away
 * from snippet-tabstop navigation. That's fixed declaratively (no code here)
 * — see the `contributes.keybindings` block.
 */

export function activate(context: vscode.ExtensionContext): void {
  // Modal engine (POWER/EDIT) lands here.
}

export function deactivate(): void {
  // nothing to clean up yet
}
