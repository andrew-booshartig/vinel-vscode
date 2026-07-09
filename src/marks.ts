import * as vscode from 'vscode';
import { afterMotion, setActive } from './state';
import { applyCharwiseRange, applyLinewiseRange, takePendingOperator, type OperatorKind } from './operators';

/**
 * Marks — `m{a-z}` set, `` `{a-z} `` jump exact, `'{a-z}` jump to the mark's
 * line. Marks are PER BUFFER (keyed by document URI), like real vim. The auto
 * mark `` ` `` / `''` is the position before the last jump.
 *
 * Input rides the same await-a-keystroke layer as find-char: `m`/`` ` ``/`'`
 * set a pending action + turn on `vinel.awaitingMark`; the next key
 * (`provideMark`) supplies the letter. Jumps are visual-aware (extend via
 * `setActive`) and double as operator targets: `` d`a `` charwise, `d'a`/`y'a`
 * linewise.
 *
 * Known simplification: marks store a static Position — they don't shift when
 * you edit above them (that'd need a per-keystroke document listener, which
 * ViNEL avoids). Positions are clamped to the current buffer on jump.
 */

type MarkAction = 'set' | 'jumpExact' | 'jumpLine';

const marksByDoc = new Map<string, Map<string, vscode.Position>>();
let lastJump: vscode.Position | null = null;
let pending: { action: MarkAction; operator: { op: OperatorKind; count: number } | null } | null = null;

function activeEditor(): vscode.TextEditor | undefined {
  return vscode.window.activeTextEditor;
}

function docMarks(uri: string): Map<string, vscode.Position> {
  let m = marksByDoc.get(uri);
  if (!m) { m = new Map(); marksByDoc.set(uri, m); }
  return m;
}

function setAwaitingMark(on: boolean): void {
  vscode.commands.executeCommand('setContext', 'vinel.awaitingMark', on);
}

/** Escape — drop a half-typed m/`/'. */
export function cancelPendingMark(): void {
  pending = null;
  setAwaitingMark(false);
}

/** `m` — set a mark at the cursor (next key = the letter). */
export function markSet(): void {
  if (!activeEditor()) return;
  pending = { action: 'set', operator: null };
  setAwaitingMark(true);
}

/** `` ` `` — jump to a mark's exact position (or operate to it). */
export function markJumpExact(): void {
  if (!activeEditor()) return;
  pending = { action: 'jumpExact', operator: takePendingOperator() };
  setAwaitingMark(true);
}

/** `'` — jump to a mark's line (first non-blank). */
export function markJumpLine(): void {
  if (!activeEditor()) return;
  pending = { action: 'jumpLine', operator: takePendingOperator() };
  setAwaitingMark(true);
}

function firstNonBlankCol(doc: vscode.TextDocument, line: number): number {
  const i = doc.lineAt(line).text.search(/\S/);
  return i === -1 ? 0 : i;
}

function clampToDoc(doc: vscode.TextDocument, pos: vscode.Position): vscode.Position {
  const line = Math.min(Math.max(pos.line, 0), doc.lineCount - 1);
  const col = Math.min(pos.character, doc.lineAt(line).text.length);
  return new vscode.Position(line, col);
}

/** The letter after m/`/' (delivered as arg). */
export async function provideMark(letter?: unknown): Promise<void> {
  const editor = activeEditor();
  const p = pending;
  pending = null;
  setAwaitingMark(false);
  if (!editor || !p || typeof letter !== 'string' || letter.length === 0) return;

  const marks = docMarks(editor.document.uri.toString());

  if (p.action === 'set') {
    marks.set(letter, editor.selection.active);
    return;
  }

  // Jump. `` `` `` / `''` = the position before the last jump.
  const raw = (letter === '`' || letter === "'") ? lastJump : marks.get(letter);
  if (!raw) return; // unset mark → no-op
  let target = clampToDoc(editor.document, raw);
  if (p.action === 'jumpLine') {
    target = new vscode.Position(target.line, firstNonBlankCol(editor.document, target.line));
  }

  const from = editor.selection.active;
  lastJump = from; // remember where we jumped FROM

  if (p.operator) {
    if (p.action === 'jumpLine') {
      await applyLinewiseRange(editor, p.operator.op, from.line, target.line);
    } else {
      await applyCharwiseRange(editor, p.operator.op, from, target);
    }
    return;
  }

  setActive(editor, target);
  afterMotion(editor);
  editor.revealRange(new vscode.Range(target, target));
}
