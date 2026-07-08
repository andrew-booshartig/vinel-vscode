import * as vscode from 'vscode';
import { Mode, setMode } from './state';

/**
 * Dot-repeat (`.`) — replay the last change.
 *
 * A change is recorded as a replay thunk. Two kinds:
 *   • non-insert (x, dd, dw, >>, …) — `recordChange(fn)`; `fn` RE-COMPUTES at
 *     the current cursor and re-applies, so `.` acts wherever you are now.
 *   • insert-entering (ciw…, o…, A…) — the command calls `beginInsertChange`
 *     with a `replayPrefix` (reproduces the pre-typing edit + position, ending
 *     in Insert). On Escape, `finishInsertChange` reads the document span from
 *     where insertion began to the cursor — that IS the typed text — and builds
 *     the full replay: prefix + insert-that-text + back to Normal.
 *
 * Capturing the typed text by reading the start→Escape span means NO
 * per-keystroke listener (no `onDidChangeTextDocument`) — consistent with the
 * scaling invariants. Linear typing is captured exactly; see the README note
 * on the mid-insert-navigation limitation.
 *
 * This module depends only on `vscode` + `state` (no operators/motions import),
 * so there's no cycle — the replay behavior lives entirely in the thunks that
 * the change commands hand in.
 */

/** A change replay. `count` lets `N.` override the recorded count (honored by
 * non-insert changes; insert changes ignore it and use what was typed). */
type ChangeThunk = (count?: number) => Promise<void> | void;

let lastChange: ChangeThunk | null = null;
let insertSession: { replayPrefix: () => Promise<void> | void; start: vscode.Position } | null = null;
// True while `.` is replaying — suppresses re-recording, since the replayed
// change commands call recordChange/beginInsertChange again as they run.
let replaying = false;

/** Record a non-insert change (called right after the edit). */
export function recordChange(fn: ChangeThunk): void {
  if (replaying) return;
  lastChange = fn;
  insertSession = null;
}

/** Begin an insert-entering change: REPLAYPREFIX reproduces the pre-typing
 * edit/position and ends in Insert; START is where typing begins. Call just
 * before `setMode(Insert)`. */
export function beginInsertChange(editor: vscode.TextEditor, replayPrefix: () => Promise<void> | void): void {
  if (replaying) return;
  insertSession = { replayPrefix, start: editor.selection.active };
}

/** Finalize an insert change on Escape (only when leaving Insert). Captures the
 * typed text as the span start→cursor and freezes the full replay. */
export function finishInsertChange(editor: vscode.TextEditor): void {
  if (!insertSession) return;
  const { replayPrefix, start } = insertSession;
  insertSession = null;
  const text = editor.document.getText(new vscode.Range(start, editor.selection.active));
  lastChange = async () => {
    await replayPrefix(); // reproduces the edit + position, ends in Insert
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    if (text.length > 0) {
      const at = ed.selection.active;
      const endOff = ed.document.offsetAt(at) + text.length;
      await ed.edit((eb) => eb.insert(at, text), { undoStopBefore: false, undoStopAfter: false });
      const end = ed.document.positionAt(endOff);
      ed.selection = new vscode.Selection(end, end);
    }
    setMode(ed, Mode.Normal);
  };
}

/** Drop a half-open insert session (e.g. leaving Insert some other way). */
export function abortInsertSession(): void {
  insertSession = null;
}

/** `.` — replay the last change, optionally with a count override. The
 * `replaying` guard stops the replayed commands from re-recording themselves
 * (and from opening a stray insert session that a later Escape would finalize). */
export async function repeatChange(count?: number): Promise<void> {
  if (!lastChange || replaying) return;
  replaying = true;
  try {
    await lastChange(count);
  } finally {
    replaying = false;
    insertSession = null; // any session opened during replay is not a real change
  }
}
