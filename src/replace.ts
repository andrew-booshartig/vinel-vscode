import * as vscode from 'vscode';
import { Mode, getMode, setMode } from './state';

/**
 * Replace mode (`R`) — overtype: each typed char replaces the one under the
 * cursor; Backspace restores the original.
 *
 * The overtype needs to intercept typing, which normally means the always-on
 * `type` hijack that makes other Vim extensions lag. ViNEL avoids that: the
 * `type` handler is registered ONLY while a Replace session is active and
 * **disposed on exit**. So Insert-mode typing is never intercepted — the
 * hijack exists only during the brief, deliberate `R` session, keeping the
 * scaling invariant intact. (Dot-repeat for `R` is deferred.)
 */

function active(): vscode.TextEditor | undefined {
  return vscode.window.activeTextEditor;
}

let typeHandler: vscode.Disposable | null = null;
// Per overtyped char: the ORIGINAL char we replaced, or null if it was an
// append (past EOL) / a newline — Backspace restores or deletes accordingly.
let replacedStack: (string | null)[] = [];

/** `R` — enter Replace mode; register the scoped overtype handler. */
export function enterReplace(): void {
  const editor = active();
  if (!editor) return;
  replacedStack = [];
  if (!typeHandler) {
    try {
      typeHandler = vscode.commands.registerCommand('type', onType);
    } catch {
      // Another extension owns `type` (e.g. VSCodeVim still active) — fall back
      // to a plain insert-like mode rather than crash.
    }
  }
  setMode(editor, Mode.Replace);
}

/** Called from `enterNormal` when leaving Replace — drop the type handler. */
export function exitReplace(): void {
  if (typeHandler) { typeHandler.dispose(); typeHandler = null; }
  replacedStack = [];
}

async function onType(args: { text?: string }): Promise<void> {
  const editor = active();
  // Only overtype in the active Replace-mode editor; everything else passes
  // through to VS Code's real typing (so a background editor is unaffected).
  if (!editor || getMode(editor) !== Mode.Replace) {
    await vscode.commands.executeCommand('default:type', args);
    return;
  }
  const text = args?.text ?? '';
  if (!text) return;
  const pos = editor.selection.active;

  if (text === '\n') {
    await editor.edit((eb) => eb.insert(pos, '\n'));
    replacedStack.push(null);
    return;
  }

  const line = editor.document.lineAt(pos.line);
  const overEnd = Math.min(pos.character + text.length, line.text.length);
  const overwritten = line.text.slice(pos.character, overEnd); // may be shorter (near EOL)
  await editor.edit((eb) => eb.replace(new vscode.Range(pos, new vscode.Position(pos.line, overEnd)), text));
  for (let i = 0; i < text.length; i++) replacedStack.push(overwritten[i] ?? null);
  const np = new vscode.Position(pos.line, pos.character + text.length);
  editor.selection = new vscode.Selection(np, np);
}

/** Backspace in Replace mode — move left and restore what was overtyped. */
export async function backspaceReplace(): Promise<void> {
  const editor = active();
  if (!editor) return;
  const pos = editor.selection.active;
  if (pos.character === 0) { await vscode.commands.executeCommand('cursorLeft'); return; }
  const prev = new vscode.Position(pos.line, pos.character - 1);
  const orig = replacedStack.pop();
  if (orig == null) {
    // appended char (or nothing recorded) → delete it
    await editor.edit((eb) => eb.delete(new vscode.Range(prev, pos)));
  } else {
    await editor.edit((eb) => eb.replace(new vscode.Range(prev, pos), orig));
  }
  editor.selection = new vscode.Selection(prev, prev);
}
