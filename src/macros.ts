import * as vscode from 'vscode';
import { consumeCount } from './state';

/**
 * Native macros (`q` / `@`) — the command-log recorder.
 *
 * A ViNEL action IS a command invocation, so a macro is just the sequence of
 * commands you ran (plus the text you typed in Insert, captured by dot-repeat's
 * `finishInsertChange` → `recordInsert`). No raw-keystroke capture, no global
 * `type` hijack — that's why this fits the engine instead of reintroducing the
 * lag other Vim extensions have.
 *
 * `q{a-z}` record · `q` stop · `@{a-z}` replay · `@@` last · `{count}@a`.
 * The recorder is wired by wrapping every command at registration
 * (see extension.ts); when not recording it's a single cheap branch, so
 * there's no cost off the record path.
 */

type MacroEvent =
  | { kind: 'command'; id: string; args: unknown[] }
  | { kind: 'insert'; text: string };

const macros = new Map<string, MacroEvent[]>();
let recording: string | null = null; // slot being recorded, or null
let current: MacroEvent[] = [];
let replaying = false;
let replayDepth = 0;
let lastReplayed: string | null = null;
let pending: { action: 'record' | 'replay'; count: number } | null = null;

function setAwaiting(on: boolean): void {
  vscode.commands.executeCommand('setContext', 'vinel.awaitingMacro', on);
}

/** Log a command invocation (called by the registration wrapper, after the
 * handler runs). No-op unless recording and not mid-replay. */
export function recordCommand(id: string, args: unknown[]): void {
  if (recording !== null && !replaying) current.push({ kind: 'command', id, args });
}

/** Log Insert-mode text (called from dot-repeat's `finishInsertChange`). */
export function recordInsert(text: string): void {
  if (recording !== null && !replaying && text.length > 0) current.push({ kind: 'insert', text });
}

/** Escape — drop a half-typed q/@. (Does NOT stop an in-progress recording.) */
export function cancelPendingMacro(): void {
  pending = null;
  setAwaiting(false);
}

/** `q` — toggle recording: if recording, stop and save; else await the slot. */
export function macroRecordKey(): void {
  if (recording !== null) {
    macros.set(recording, current);
    recording = null;
    current = [];
    return;
  }
  pending = { action: 'record', count: 1 };
  setAwaiting(true);
}

/** `@` — await the slot letter (or `@` = last), replay `{count}` times. */
export function macroReplayKey(): void {
  const editor = vscode.window.activeTextEditor;
  pending = { action: 'replay', count: editor ? consumeCount(editor) : 1 };
  setAwaiting(true);
}

/** The slot letter after q/@ (delivered as a command arg). */
export async function provideMacro(ch?: unknown): Promise<void> {
  const p = pending;
  pending = null;
  setAwaiting(false);
  if (!p || typeof ch !== 'string' || ch.length === 0) return;

  if (p.action === 'record') {
    recording = ch;
    current = [];
    return;
  }
  const slot = ch === '@' ? lastReplayed : ch;
  if (slot) await replay(slot, p.count);
}

async function replay(slot: string, count: number): Promise<void> {
  const events = macros.get(slot);
  if (!events || events.length === 0) return;
  if (replayDepth > 100) return; // runaway self-reference guard

  lastReplayed = slot;
  replaying = true;
  replayDepth++;
  try {
    for (let n = 0; n < count; n++) {
      for (const ev of events) {
        if (ev.kind === 'command') {
          await vscode.commands.executeCommand(ev.id, ...ev.args);
        } else {
          const ed = vscode.window.activeTextEditor;
          if (!ed) continue;
          const at = ed.selection.active;
          const endOff = ed.document.offsetAt(at) + ev.text.length;
          await ed.edit((eb) => eb.insert(at, ev.text), { undoStopBefore: false, undoStopAfter: false });
          const end = ed.document.positionAt(endOff);
          ed.selection = new vscode.Selection(end, end);
        }
      }
    }
  } finally {
    replayDepth--;
    if (replayDepth === 0) replaying = false;
  }
}
