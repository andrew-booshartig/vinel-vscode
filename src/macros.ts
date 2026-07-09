import * as vscode from 'vscode';
import { Mode, consumeCount, getMode, setMode } from './state';

/**
 * Native macros (`q` / `@`) — a faithful keystroke recorder.
 *
 * A macro is the ordered stream of what you actually DID, so replay reproduces
 * it literally and the surrounding environment reacts exactly as it did live:
 *   • ViNEL command invocations (motions, operators, mode changes) — captured by
 *     the registration wrapper in extension.ts.
 *   • The literal characters you TYPED in Insert/Replace — captured by a `type`
 *     command override installed ONLY while recording and disposed the instant
 *     you stop (so there's still no always-on hijack; Insert typing is native at
 *     all other times). This records the keystroke you pressed (`'`), NOT the
 *     transformed result (`'a'` after auto-surround).
 *   • Built-in Insert-mode navigation you used (arrows, Backspace, Home/End) —
 *     captured via `vinel.recExec` wrappers bound to those keys ONLY while
 *     `vinel.recordingMacro` is set (see package.json). Without this, native
 *     arrow/Backspace keys in Insert (which aren't ViNEL commands) were invisible
 *     to the recorder, so replays never moved the cursor.
 *
 * Replay re-runs commands and re-issues typed characters through the editor's
 * real `type` pipeline (not `editBuilder.insert`), so auto-indent, auto-closing
 * pairs, auto-surround, and LSP edits all fire on replay just like recording.
 *
 * `q{a-z}` record · `q` stop · `@{a-z}` replay · `@@` last · `{count}@a`.
 */

type MacroEvent =
  | { kind: 'command'; id: string; args: unknown[] }
  | { kind: 'type'; text: string };

// A recorded macro carries the mode it was recorded FROM, so replay can restore
// that starting mode first — this is what lets the global Cmd/Ctrl+F3 shortcut
// replay correctly no matter which mode you trigger it from.
type Macro = { startMode: Mode; events: MacroEvent[] };

// Reserved slot for the state-independent Cmd/Ctrl+F2 toggle. A space can never
// be a `q{letter}`/`@` named slot, so it can't collide.
const DEFAULT_SLOT = ' ';

const macros = new Map<string, Macro>();
let recording: string | null = null; // slot being recorded, or null
let current: MacroEvent[] = [];
let currentStartMode: Mode = Mode.Normal;
let replaying = false;
let replayDepth = 0;
let lastReplayed: string | null = null;
let lastRecordedSlot: string | null = null; // what Cmd/Ctrl+F3 replays
let pending: { action: 'record' | 'replay'; count: number } | null = null;

// The scoped `type` override — live only while recording.
let typeRecorder: vscode.Disposable | undefined;

let recIndicator: vscode.StatusBarItem | undefined;

function setAwaiting(on: boolean): void {
  vscode.commands.executeCommand('setContext', 'vinel.awaitingMacro', on);
}

/** Gates the Insert-mode navigation keybindings that route through `recExec`. */
function setRecordingContext(on: boolean): void {
  vscode.commands.executeCommand('setContext', 'vinel.recordingMacro', on);
}

function showRecIndicator(on: boolean): void {
  if (!recIndicator) {
    recIndicator = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    // A red record indicator. Status-bar items can only be coloured as a whole
    // (and `backgroundColor` is restricted to the error/warning theme colours),
    // so force a literal red on the whole item — reliably red across themes.
    recIndicator.text = '$(record) REC';
    recIndicator.tooltip = 'ViNEL is recording a macro — press the record key again to stop';
    recIndicator.color = '#f7768e';
  }
  if (on) recIndicator.show(); else recIndicator.hide();
}

/** (Re)install the scoped `type` capture. Registering `type` REPLACES the
 * built-in, which disables its interceptors while ours is active, so we remove
 * ours again the moment we forward (see onRecordType). */
function installTypeRecorder(): void {
  if (typeRecorder) return;
  try {
    typeRecorder = vscode.commands.registerCommand('type', onRecordType);
  } catch {
    // Another handler owns `type` (e.g. an active Replace session) — typed text
    // won't be captured this session, but commands/navigation still are.
    typeRecorder = undefined;
  }
}

/** The scoped `type` handler: log the literal character(s) typed in
 * Insert/Replace, then forward through the REAL `type`. We can't get the type
 * interceptors (auto-indent on Enter, auto-close, auto-surround) while our
 * override is registered — `default:type` is the raw insert path and skips them,
 * which made typing look wrong WHILE recording (e.g. Enter ate the indent). So
 * we momentarily dispose our override, run the built-in `type` (interceptors
 * fire, exactly like normal typing), then reinstall. Human keystrokes are far
 * slower than this microtask, so nothing is missed. */
function onRecordType(args: { text?: string }): Thenable<unknown> {
  const text = args?.text;
  if (typeof text === 'string' && recording !== null && !replaying) {
    const ed = vscode.window.activeTextEditor;
    const m = ed ? getMode(ed) : Mode.Normal;
    if (m === Mode.Insert || m === Mode.Replace) current.push({ kind: 'type', text });
  }
  typeRecorder?.dispose();
  typeRecorder = undefined;
  const reinstall = () => { if (recording !== null) installTypeRecorder(); };
  return Promise.resolve(vscode.commands.executeCommand('type', args)).then(reinstall, reinstall);
}

/** Begin recording into SLOT, remembering the mode we started in, and install
 * the scoped typing capture + navigation-capture context. */
function startRecording(slot: string): void {
  const editor = vscode.window.activeTextEditor;
  currentStartMode = editor ? getMode(editor) : Mode.Normal;
  recording = slot;
  current = [];
  installTypeRecorder();
  setRecordingContext(true);
  showRecIndicator(true);
}

/** Stop recording and save. */
function stopRecording(): void {
  if (recording === null) return;
  typeRecorder?.dispose();
  typeRecorder = undefined;
  setRecordingContext(false);
  macros.set(recording, { startMode: currentStartMode, events: current });
  lastRecordedSlot = recording;
  recording = null;
  current = [];
  showRecIndicator(false);
}

/** Log a command invocation (called by the registration wrapper, after the
 * handler runs). No-op unless recording and not mid-replay. */
export function recordCommand(id: string, args: unknown[]): void {
  if (recording !== null && !replaying) current.push({ kind: 'command', id, args });
}

/** `vinel.recExec` — run a built-in command; because it's a ViNEL command it's
 * captured by the registration wrapper, so Insert-mode navigation keys
 * (arrows / Backspace / Home / End) become part of the macro. Bound to those
 * keys only while `vinel.recordingMacro` is set, so Insert stays 100% native
 * otherwise. */
export async function recExec(commandId?: unknown): Promise<void> {
  if (typeof commandId === 'string') await vscode.commands.executeCommand(commandId);
}

/** Full teardown for extension deactivate / uninstall: stop any in-flight
 * capture, remove the recording badge, and clear the recording context keys.
 * ViNEL keeps macros only in memory (never on disk), so nothing else lingers. */
export function disposeMacros(): void {
  typeRecorder?.dispose();
  typeRecorder = undefined;
  recIndicator?.dispose();
  recIndicator = undefined;
  recording = null;
  vscode.commands.executeCommand('setContext', 'vinel.recordingMacro', false);
  vscode.commands.executeCommand('setContext', 'vinel.awaitingMacro', false);
}

/** Escape — drop a half-typed q/@. (Does NOT stop an in-progress recording.) */
export function cancelPendingMacro(): void {
  pending = null;
  setAwaiting(false);
}

/** `q` — toggle recording: if recording, stop and save; else await the slot. */
export function macroRecordKey(): void {
  if (recording !== null) {
    stopRecording();
    return;
  }
  pending = { action: 'record', count: 1 };
  setAwaiting(true);
}

/** Cmd/Ctrl+F2 — state-independent record toggle. Works in ANY mode (unlike
 * `q`, which is Normal-only), recording into the reserved default slot. No slot
 * prompt, since a prompt can't work while in Insert. */
export function macroRecordToggle(): void {
  if (recording !== null) stopRecording();
  else startRecording(DEFAULT_SLOT);
}

/** Cmd/Ctrl+F3 — replay whatever was recorded most recently (whether via
 * `q{letter}` or the F2 toggle). Honors a Normal-mode count prefix ({count}). */
export async function macroPlayLast(): Promise<void> {
  if (lastRecordedSlot === null) return;
  const editor = vscode.window.activeTextEditor;
  const count = editor ? consumeCount(editor) : 1;
  await replay(lastRecordedSlot, count);
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
    startRecording(ch);
    return;
  }
  const slot = ch === '@' ? lastReplayed : ch;
  if (slot) await replay(slot, p.count);
}

async function replay(slot: string, count: number): Promise<void> {
  const macro = macros.get(slot);
  if (!macro || macro.events.length === 0) return;
  if (replayDepth > 100) return; // runaway self-reference guard

  // Collapse the whole replay into ONE undo step (so a single `u` removes the
  // entire macro output, not one word/space at a time). Only at the outermost
  // replay, on a real editor, and not while recording — and only if we can
  // cleanly reproduce it (see collapseToSingleUndo, which is bounded and falls
  // back to leaving the faithful result untouched).
  const editor = vscode.window.activeTextEditor;
  const wantCollapse = replayDepth === 0 && recording === null && !!editor;
  const beforeText = wantCollapse && editor ? editor.document.getText() : null;

  lastReplayed = slot;
  replaying = true;
  replayDepth++;
  try {
    // Restore the mode the macro was recorded from, so replay is correct no
    // matter which mode it was triggered from (only at the outermost replay).
    if (editor && replayDepth === 1) setMode(editor, macro.startMode);
    for (let n = 0; n < count; n++) {
      for (const ev of macro.events) {
        if (ev.kind === 'command') {
          await vscode.commands.executeCommand(ev.id, ...ev.args);
        } else {
          // Re-issue the literal keystroke through the real typing pipeline so
          // auto-close / auto-surround / auto-indent react as they did live.
          await vscode.commands.executeCommand('type', { text: ev.text });
        }
      }
    }
  } finally {
    replayDepth--;
    if (replayDepth === 0) replaying = false;
  }

  if (beforeText !== null && editor) {
    // Upper bound on undo stops the replay could have created (each type/edit is
    // ≤1 stop; cursor moves create none) — capping at this guarantees we never
    // undo past our own edits into the user's prior history.
    await collapseToSingleUndo(editor, beforeText, macro.events.length * count + 4);
  }
}

/** Re-fold the just-completed replay into a single undo stop: undo our own
 * edits (bounded, so pre-existing history is never touched), then re-apply the
 * net change as one edit. On any doubt it safely leaves the faithful result in
 * place (worst case: undo isn't bundled, but the content is correct). */
async function collapseToSingleUndo(
  editor: vscode.TextEditor,
  beforeText: string,
  maxSteps: number,
): Promise<void> {
  const doc = editor.document;
  const afterText = doc.getText();
  const afterSel = editor.selection;
  if (afterText === beforeText) return; // no net change

  try {
    // Undo only as many stops as we created; stop the instant we're restored or
    // an undo becomes a no-op (history exhausted).
    let steps = 0;
    while (doc.getText() !== beforeText && steps < maxSteps) {
      const t = doc.getText();
      await vscode.commands.executeCommand('undo');
      if (doc.getText() === t) break;
      steps++;
    }
    if (doc.getText() !== beforeText) {
      // Couldn't cleanly restore — redo back to the faithful result and bail.
      let r = 0;
      while (doc.getText() !== afterText && r < steps + 4) {
        const t = doc.getText();
        await vscode.commands.executeCommand('redo');
        if (doc.getText() === t) break;
        r++;
      }
      return;
    }
    // Restored to the pre-replay text; re-apply the net change as one edit,
    // touching only the region that actually differs (trim common ends).
    let p = 0;
    const minLen = Math.min(beforeText.length, afterText.length);
    while (p < minLen && beforeText[p] === afterText[p]) p++;
    let s = 0;
    while (s < minLen - p
      && beforeText[beforeText.length - 1 - s] === afterText[afterText.length - 1 - s]) s++;
    const range = new vscode.Range(doc.positionAt(p), doc.positionAt(beforeText.length - s));
    const middle = afterText.slice(p, afterText.length - s);
    await editor.edit((eb) => eb.replace(range, middle));
    editor.selection = afterSel;
  } catch {
    // Any failure: get back to the faithful result if we can, then leave it.
    let r = 0;
    while (doc.getText() !== afterText && r < maxSteps + 4) {
      const t = doc.getText();
      await vscode.commands.executeCommand('redo');
      if (doc.getText() === t) break;
      r++;
    }
  }
}
