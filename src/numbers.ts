import * as vscode from 'vscode';
import { consumeCount } from './state';
import { recordChange } from './dotrepeat';

/**
 * `Ctrl-A` / `Ctrl-X` — increment / decrement the number at or after the cursor
 * on the current line, by `{count}` (default 1). Vim-faithful defaults: an
 * attached leading `-` counts as a negative sign, and zero-padding width is
 * preserved (`007` → `008`). Decimal integers only (the common case). The change
 * is dot-repeatable (`.`) and, being a ViNEL command, macro-recordable.
 */

function activeEditor(): vscode.TextEditor | undefined {
  return vscode.window.activeTextEditor;
}

async function applyDelta(editor: vscode.TextEditor, delta: number): Promise<void> {
  const pos = editor.selection.active;
  const line = editor.document.lineAt(pos.line);
  const text = line.text;

  // First number whose end is at or after the cursor column (vim: the number the
  // cursor is on, else the next one to the right on this line).
  const re = /-?\d+/g;
  let found: { start: number; end: number; str: string } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    if (pos.character < end) { found = { start: m.index, end, str: m[0] }; break; }
  }
  if (!found) return;

  const oldVal = parseInt(found.str, 10);
  if (Number.isNaN(oldVal)) return;
  const newVal = oldVal + delta;

  let newStr = String(newVal);
  // Preserve zero-padding width (e.g. 007 -> 008, 099 -> 100).
  const digits = found.str.replace('-', '');
  if (digits.length > 1 && digits[0] === '0') {
    const width = digits.length;
    newStr = (newVal < 0 ? '-' : '') + String(Math.abs(newVal)).padStart(width, '0');
  }

  const range = new vscode.Range(pos.line, found.start, pos.line, found.end);
  await editor.edit((eb) => eb.replace(range, newStr));
  // Leave the cursor on the last digit of the result, like vim.
  const c = new vscode.Position(pos.line, Math.max(found.start, found.start + newStr.length - 1));
  editor.selection = new vscode.Selection(c, c);
}

export async function increment(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  const n = consumeCount(editor);
  await applyDelta(editor, n);
  recordChange(async () => { const e = activeEditor(); if (e) await applyDelta(e, n); });
}

export async function decrement(): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  const n = consumeCount(editor);
  await applyDelta(editor, -n);
  recordChange(async () => { const e = activeEditor(); if (e) await applyDelta(e, -n); });
}
