import * as vscode from 'vscode';
import { Mode, isVisual, setMode } from './state';

/**
 * Ex-commands (`:`) — the command line.
 *
 * Input is VS Code's own `showInputBox` (not a hand-built status-bar line):
 * native editing, Enter submits, Escape cancels — the same "use the host's UI"
 * call as `/` → native Find. Supported: file/window (`:w`/`:q`/`:wq`/…), goto
 * (`:42`, `:$`), and substitution (`:[range]s/pat/rep/flags`).
 *
 * Substitution uses JS `RegExp` directly — patterns are JS-flavored, not full
 * vim regex (we deliberately don't hand-roll a vim→JS translator). The common
 * overlap covers most real use; `\v`/`\zs`/`\<` etc. are out of scope.
 */

interface Substitution { range: string; pat: string; rep: string; flags: string; }

// ── Pure parsing/transform helpers (unit-testable) ──────────────────────────

/** Split REST by unescaped SEP into at most [pat, rep, flags]. */
export function splitUnescaped(rest: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '\\' && i + 1 < rest.length) { cur += rest[i] + rest[i + 1]; i++; continue; }
    if (rest[i] === sep && out.length < 2) { out.push(cur); cur = ''; continue; }
    cur += rest[i];
  }
  out.push(cur);
  return out;
}

/** `:[range]s{sep}pat{sep}rep{sep}[flags]` → parts, or null if not a `:s`. */
export function parseSubstitute(cmd: string): Substitution | null {
  const m = /^([\d%.$,'<>]*)s([^A-Za-z0-9\s\\])(.*)$/.exec(cmd);
  if (!m) return null;
  const [pat, rep, flags] = splitUnescaped(m[3], m[2]);
  return { range: m[1], pat: pat ?? '', rep: rep ?? '', flags: flags ?? '' };
}

/** Translate a vim replacement into a JS `String.replace` replacement:
 * `\1`→`$1`, `&`→whole match, `\&`/`\\` literal, and escape literal `$`. */
export function translateRep(rep: string): string {
  let out = '';
  for (let i = 0; i < rep.length; i++) {
    const c = rep[i];
    if (c === '\\' && i + 1 < rep.length) {
      const n = rep[i + 1];
      if (n >= '0' && n <= '9') out += '$' + n;
      else out += n; // \&, \\, \/, … → the literal char
      i++;
      continue;
    }
    if (c === '&') { out += '$&'; continue; }
    if (c === '$') { out += '$$'; continue; }
    out += c;
  }
  return out;
}

/** Apply a substitution to ONE line's text (mirrors the runtime edit). */
export function substituteLine(text: string, pat: string, jsRep: string, flags: string): string {
  if (pat === '') return text; // empty pattern (last-search reuse) not supported
  const re = new RegExp(pat, (flags.includes('g') ? 'g' : '') + (flags.includes('i') ? 'i' : ''));
  return text.replace(re, jsRep);
}

// ── Runtime ─────────────────────────────────────────────────────────────────

/** `:` — open the command line and run what's entered. */
export async function promptEx(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const inVisual = isVisual(editor);
  const sel = editor.selection;
  const selRange: [number, number] | null = inVisual
    ? [Math.min(sel.start.line, sel.end.line), Math.max(sel.start.line, sel.end.line)]
    : null;

  // `:` from Visual drops the highlight but remembers the range as '<,'>.
  if (inVisual) {
    const pos = editor.selection.active;
    editor.selection = new vscode.Selection(pos, pos);
    setMode(editor, Mode.Normal);
  }

  const input = await vscode.window.showInputBox({
    prompt: ':',
    value: selRange ? "'<,'>" : '',
  });
  if (input === undefined) return; // Escape / cancelled
  await parseAndRun(editor, input.trim(), selRange);
}

async function parseAndRun(editor: vscode.TextEditor, cmd: string, selRange: [number, number] | null): Promise<void> {
  if (cmd === '') return;
  const run = (id: string) => vscode.commands.executeCommand(id);

  switch (cmd) {
    case 'w': case 'write': await run('workbench.action.files.save'); return;
    case 'wa': case 'wall': await run('workbench.action.files.saveAll'); return;
    case 'q': await run('workbench.action.closeActiveEditor'); return;
    case 'q!': await run('workbench.action.revertAndCloseActiveEditor'); return;
    case 'qa': case 'qa!': case 'quitall': await run('workbench.action.closeAllEditors'); return;
    case 'wq': case 'x': await run('workbench.action.files.save'); await run('workbench.action.closeActiveEditor'); return;
    case 'sp': case 'split': await run('workbench.action.splitEditorDown'); return;
    case 'vs': case 'vsp': case 'vsplit': await run('workbench.action.splitEditor'); return;
    case 'noh': case 'nohlsearch': await run('closeFindWidget'); return;
  }

  if (/^\d+$/.test(cmd)) { gotoLine(editor, parseInt(cmd, 10)); return; }
  if (cmd === '$') { gotoLine(editor, editor.document.lineCount); return; }

  const sub = parseSubstitute(cmd);
  if (sub) { await runSubstitute(editor, sub, selRange); return; }

  vscode.window.setStatusBarMessage(`ViNEL: not an editor command: ${cmd}`, 3000);
}

function gotoLine(editor: vscode.TextEditor, oneBased: number): void {
  const last = editor.document.lineCount - 1;
  const line = Math.min(Math.max(oneBased - 1, 0), last);
  const col = Math.max(0, editor.document.lineAt(line).text.search(/\S/));
  const pos = new vscode.Position(line, col);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos));
}

function resolveRange(editor: vscode.TextEditor, range: string, selRange: [number, number] | null): [number, number] {
  const cur = editor.selection.active.line;
  const last = editor.document.lineCount - 1;
  if (range === '') return [cur, cur];
  if (range === '%') return [0, last];
  if (range === "'<,'>") return selRange ?? [cur, cur];
  const one = (tok: string, dflt: number): number => {
    if (tok === '.') return cur;
    if (tok === '$') return last;
    if (/^\d+$/.test(tok)) return Math.min(Math.max(parseInt(tok, 10) - 1, 0), last);
    return dflt;
  };
  const parts = range.split(',');
  if (parts.length === 1) { const l = one(parts[0], cur); return [l, l]; }
  const a = one(parts[0], cur);
  const b = one(parts[1], last);
  return [Math.min(a, b), Math.max(a, b)];
}

async function runSubstitute(editor: vscode.TextEditor, sub: Substitution, selRange: [number, number] | null): Promise<void> {
  const [startLine, endLine] = resolveRange(editor, sub.range, selRange);
  const jsRep = translateRep(sub.rep);
  const edits: [vscode.Range, string][] = [];
  let lastChanged = -1;
  for (let ln = startLine; ln <= endLine; ln++) {
    const line = editor.document.lineAt(ln);
    let replaced: string;
    try {
      replaced = substituteLine(line.text, sub.pat, jsRep, sub.flags);
    } catch {
      vscode.window.setStatusBarMessage(`ViNEL: bad pattern: ${sub.pat}`, 3000);
      return;
    }
    if (replaced !== line.text) { edits.push([line.range, replaced]); lastChanged = ln; }
  }
  if (edits.length === 0) return;
  await editor.edit((eb) => { for (const [range, text] of edits) eb.replace(range, text); });
  if (lastChanged >= 0) {
    const pos = new vscode.Position(lastChanged, 0);
    editor.selection = new vscode.Selection(pos, pos);
  }
}
