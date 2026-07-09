import * as vscode from 'vscode';
import {
  Mode, afterMotion, appendDigit, consumeCount, createStatusBarItem, getMode,
  getVisualLineAnchor, isVisual, setMode, setVisualLineAnchor, syncActiveEditor,
  zeroIsMotion,
} from './state';
import * as motions from './motions';
import * as operators from './operators';
import * as dotrepeat from './dotrepeat';
import * as excommand from './excommand';
import * as marks from './marks';
import * as replace from './replace';
import * as macros from './macros';
import * as blockwise from './blockwise';

/**
 * ViNEL — a native modal-editing state machine for VSCode. Not an
 * emulation (VSCodeVim: hijacks the `type` command to parse every keystroke
 * through the extension host, then re-syncs a shadow undo tree against
 * VS Code's own — the root cause behind its two most-upvoted complaints:
 * lag/dropped-keystrokes and `u` undoing the wrong thing) and not a Neovim
 * bridge (vscode-neovim: two engines fighting over one buffer, chronic
 * desync). NORMAL-mode keys are discrete `contributes.keybindings`, each
 * routed straight to a specific command; INSERT mode has zero custom
 * keybindings — typing is 100% native VS Code, never touched.
 *
 * Follows standard vim semantics as the target, not a verbatim port of any
 * prior prototype's own choices (an earlier Emacs-based prototype's `0`/`,`
 * split, for instance, only existed to work around an Emacs-specific
 * constraint — see motions.ts). Where VS Code already does something
 * excellently (its own Find, cursor-move commands, undo/redo), this uses
 * that directly rather than reimplementing vim on top of it — e.g. `/` opens
 * VS Code's own Find instead of a hand-built vim search.
 *
 * package.json also contributes a general keybinding fix: `tabout`'s own
 * default binding doesn't exclude `inSnippetMode`, so it can hijack Tab away
 * from snippet-tabstop navigation. That's fixed declaratively (no code here)
 * — see the `contributes.keybindings` block.
 */

function enterNormal(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  // Leaving Insert → finalize the dot-repeat change (captures the typed text).
  if (getMode(editor) === Mode.Insert) dotrepeat.finishInsertChange(editor);
  if (getMode(editor) === Mode.Replace) replace.exitReplace(); // drop the scoped type handler
  // Leaving a block insert (I/A/c) with several cursors: collapse to the primary,
  // like vim returning to a single caret after Ctrl-V insert.
  if (getMode(editor) === Mode.Insert && editor.selections.length > 1) {
    const pos = editor.selection.active;
    editor.selection = new vscode.Selection(pos, pos);
  }
  operators.cancelPendingOperator();   // Escape cancels a half-typed d/c/y, like vim
  operators.cancelPendingChar();       // …and a half-typed f/t/r
  operators.cancelPendingTextObject(); // …and a half-typed i/a text object
  operators.cancelPendingRegister();   // …and a dangling " register prefix
  marks.cancelPendingMark();           // …and a half-typed m/`/'
  macros.cancelPendingMacro();         // …and a half-typed q/@
  // Leaving visual: collapse the selection back to a caret (vim's Escape).
  if (isVisual(editor)) {
    const pos = editor.selection.active;
    editor.selection = new vscode.Selection(pos, pos);
  }
  setMode(editor, Mode.Normal); // also clears the linewise anchor
}

// Each insert-entry positions the cursor + enters Insert. The `…Core` form is
// what dot-repeat re-runs (reproduces the pre-typing position, ends in Insert);
// the command runs it, then registers it — recording AFTER so the session's
// start is the actual insertion point.
function active(): vscode.TextEditor | undefined { return vscode.window.activeTextEditor; }

function enterInsert(): void {
  const editor = active();
  if (!editor) return;
  setMode(editor, Mode.Insert);
  dotrepeat.beginInsertChange(editor, () => { const e = active(); if (e) setMode(e, Mode.Insert); });
}

function appendCore(editor: vscode.TextEditor): void {
  const pos = editor.selection.active;
  const line = editor.document.lineAt(pos.line);
  const p = new vscode.Position(pos.line, Math.min(pos.character + 1, line.text.length));
  editor.selection = new vscode.Selection(p, p);
  setMode(editor, Mode.Insert);
}
/** `a` — append: one char right (clamped to line end), then INSERT. */
function append(): void {
  const editor = active();
  if (!editor) return;
  appendCore(editor);
  dotrepeat.beginInsertChange(editor, () => { const e = active(); if (e) appendCore(e); });
}

function appendEolCore(editor: vscode.TextEditor): void {
  const end = editor.document.lineAt(editor.selection.active.line).range.end;
  editor.selection = new vscode.Selection(end, end);
  setMode(editor, Mode.Insert);
}
/** `A` — append at end of line, then INSERT. */
function appendEol(): void {
  const editor = active();
  if (!editor) return;
  appendEolCore(editor);
  dotrepeat.beginInsertChange(editor, () => { const e = active(); if (e) appendEolCore(e); });
}

function insertFirstNonBlankCore(editor: vscode.TextEditor): void {
  const line = editor.document.lineAt(editor.selection.active.line);
  const i = line.text.search(/\S/);
  const p = new vscode.Position(line.lineNumber, i === -1 ? 0 : i);
  editor.selection = new vscode.Selection(p, p);
  setMode(editor, Mode.Insert);
}
/** `I` — insert at first non-blank of the line, then INSERT. */
function insertFirstNonBlank(): void {
  const editor = active();
  if (!editor) return;
  insertFirstNonBlankCore(editor);
  dotrepeat.beginInsertChange(editor, () => { const e = active(); if (e) insertFirstNonBlankCore(e); });
}

/** `i` — context-dependent: a text-object prefix (inner) when an operator is
 * pending (`diw`) or in Visual (`viw`); otherwise enter INSERT. */
function iKey(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  if (operators.hasPendingOperator() || isVisual(editor)) {
    operators.textObjectStart(false);
  } else {
    enterInsert();
  }
}

/** `a` — context-dependent: a text-object prefix (around) when an operator is
 * pending (`daw`) or in Visual (`vaw`); otherwise append. */
function aKey(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  if (operators.hasPendingOperator() || isVisual(editor)) {
    operators.textObjectStart(true);
  } else {
    append();
  }
}

/** `v` — charwise visual. Toggles off if already charwise; switches from
 * linewise to charwise (keeping the current span). */
function enterVisual(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const m = getMode(editor);
  if (m === Mode.Visual) { enterNormal(); return; }
  if (m === Mode.VisualLine) { setMode(editor, Mode.Visual); return; }
  // From Normal: anchor at the current caret; motions extend from here.
  const pos = editor.selection.active;
  editor.selection = new vscode.Selection(pos, pos);
  setMode(editor, Mode.Visual);
}

/** `V` — linewise visual. Toggles off if already linewise; switches from
 * charwise to linewise. Anchors on the selection's fixed end and reshapes to
 * whole lines immediately. */
function enterVisualLine(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const m = getMode(editor);
  if (m === Mode.VisualLine) { enterNormal(); return; }
  const anchorLine = m === Mode.Visual
    ? editor.selection.anchor.line
    : editor.selection.active.line;
  setMode(editor, Mode.VisualLine);
  setVisualLineAnchor(anchorLine);
  afterMotion(editor); // reshape the anchor line to a full-line selection now
}

/** `o` in visual — jump the caret to the other end of the selection. */
function swapEnds(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const m = getMode(editor);
  if (m === Mode.Visual) {
    const s = editor.selection;
    editor.selection = new vscode.Selection(s.active, s.anchor);
  } else if (m === Mode.VisualLine) {
    const anchor = getVisualLineAnchor();
    if (anchor === null) return;
    const active = editor.selection.active.line;
    setVisualLineAnchor(active);
    const pos = new vscode.Position(anchor, 0);
    editor.selection = new vscode.Selection(pos, pos);
    afterMotion(editor);
  }
}

/** `o` key — opens a line below in NORMAL, swaps selection ends in VISUAL. */
function oKey(): void | Thenable<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  if (isVisual(editor)) { swapEnds(); return; }
  return operators.openBelow();
}

/** No-op for any printable key with no real binding in the current
 * (non-insert) mode: unbound keys do NOTHING instead of typing into the
 * buffer — exactly like vim, where an undefined Normal-mode key just beeps.
 * Real command bindings, declared AFTER the suppression block in package.json,
 * override this wherever they apply (VS Code resolves same-key conflicts by
 * last-match-wins). Drains a stray pending count so it can't leak. */
function suppressKey(): void {
  const editor = vscode.window.activeTextEditor;
  if (editor) consumeCount(editor);
}

/** `0` — real vim: a motion (column 0) unless a count is already being
 * typed, in which case it extends the count (so `50` means fifty, not
 * "five, then column 0"). See state.ts / motions.ts for the full rationale. */
function digitZero(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  if (zeroIsMotion()) {
    motions.lineStart();
  } else {
    appendDigit(editor, '0');
  }
}

function digit(n: string): () => void {
  return () => {
    const editor = vscode.window.activeTextEditor;
    if (editor) appendDigit(editor, n);
  };
}

/** `u` / Ctrl+R — VSCode's native undo/redo directly (no reimplementation).
 * Any stray pending count is cleared even though it's unused, so it can't
 * leak into a later, unrelated command. */
function undo(): void {
  const editor = vscode.window.activeTextEditor;
  if (editor) consumeCount(editor);
  vscode.commands.executeCommand('undo');
}
function redo(): void {
  const editor = vscode.window.activeTextEditor;
  if (editor) consumeCount(editor);
  vscode.commands.executeCommand('redo');
}

/** Run a VS Code command by id from a ViNEL key, draining any pending count
 * first so it can't leak into the next command. This is the bridge for the
 * "Vim key → native VS Code feature" bindings (jump list, go-to-definition,
 * folding, window/tab nav, comment toggle, re-indent) — no reimplementation,
 * just VS Code's own commands under Vim muscle memory. */
async function runCommand(commandId?: unknown): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor) consumeCount(editor);
  if (typeof commandId === 'string') await vscode.commands.executeCommand(commandId);
}

/** `.` — repeat the last change. `N.` overrides the recorded count. */
function repeat(): void | Thenable<void> {
  const editor = vscode.window.activeTextEditor;
  const count = editor ? consumeCount(editor) : 1;
  return dotrepeat.repeatChange(count > 1 ? count : undefined);
}

export function activate(context: vscode.ExtensionContext): void {
  createStatusBarItem(context);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(syncActiveEditor),
  );
  // Editors already open when the extension activates.
  syncActiveEditor(vscode.window.activeTextEditor);

  const commands: [string, (...args: unknown[]) => unknown][] = [
    ['vinel.enterNormal', enterNormal],
    ['vinel.enterInsert', enterInsert],
    ['vinel.enterVisual', enterVisual],
    ['vinel.enterVisualLine', enterVisualLine],
    ['vinel.suppressKey', suppressKey],

    ['vinel.digit0', digitZero],
    ['vinel.digit1', digit('1')],
    ['vinel.digit2', digit('2')],
    ['vinel.digit3', digit('3')],
    ['vinel.digit4', digit('4')],
    ['vinel.digit5', digit('5')],
    ['vinel.digit6', digit('6')],
    ['vinel.digit7', digit('7')],
    ['vinel.digit8', digit('8')],
    ['vinel.digit9', digit('9')],

    ['vinel.moveLeft', motions.moveLeft],
    ['vinel.moveRight', motions.moveRight],
    ['vinel.moveUp', motions.moveUp],
    ['vinel.moveDown', motions.moveDown],
    // w/b/e double as operator targets (dw/cw/yw) — see operators.ts's note on
    // why these route through operatorAwareWordMotion instead of calling
    // motions.wordForward() etc. directly (count-multiplication semantics).
    ['vinel.wordForward', operators.operatorAwareWordMotion('cursorWordStartRight')],
    ['vinel.wordBackward', operators.operatorAwareWordMotion('cursorWordStartLeft')],
    ['vinel.wordEnd', operators.operatorAwareWordMotion('cursorWordEndRight')],
    ['vinel.firstNonBlank', motions.firstNonBlank],
    ['vinel.lineEnd', motions.lineEnd],
    ['vinel.bufferTop', motions.bufferTop],
    ['vinel.bufferBottom', motions.bufferBottom],
    ['vinel.paragraphBackward', motions.paragraphBackward],
    ['vinel.paragraphForward', motions.paragraphForward],
    ['vinel.search', motions.search],

    ['vinel.opDelete', operators.operatorKey('delete')],
    ['vinel.opChange', operators.operatorKey('change')],
    ['vinel.opYank', operators.operatorKey('yank')],
    ['vinel.deleteToEol', operators.deleteToEol],
    ['vinel.changeToEol', operators.changeToEol],
    ['vinel.yankLine', operators.yankLine],
    ['vinel.cutChar', operators.cutChar],
    ['vinel.pasteAfter', operators.pasteAfter],
    ['vinel.pasteBefore', operators.pasteBefore],
    ['vinel.openBelow', operators.openBelow],
    ['vinel.openAbove', operators.openAbove],
    ['vinel.oKey', oKey],
    ['vinel.undo', undo],
    ['vinel.redo', redo],
    ['vinel.repeatChange', repeat],
    ['vinel.exCommand', excommand.promptEx],

    // Marks + named registers
    ['vinel.setMark', marks.markSet],
    ['vinel.jumpMarkExact', marks.markJumpExact],
    ['vinel.jumpMarkLine', marks.markJumpLine],
    ['vinel.provideMark', marks.provideMark],
    ['vinel.registerPrefix', operators.registerPrefix],
    ['vinel.provideRegister', operators.provideRegister],

    // Replace mode + macros
    ['vinel.enterReplace', replace.enterReplace],
    ['vinel.replaceBackspace', replace.backspaceReplace],
    ['vinel.macroRecord', macros.macroRecordKey],
    ['vinel.macroReplay', macros.macroReplayKey],
    ['vinel.provideMacro', macros.provideMacro],
    ['vinel.macroRecordToggle', macros.macroRecordToggle],
    ['vinel.macroPlayLast', macros.macroPlayLast],
    ['vinel.recExec', macros.recExec],
    ['vinel.cmd', runCommand],

    // Blockwise Visual (Ctrl-V)
    ['vinel.enterVisualBlock', blockwise.enterVisualBlock],
    ['vinel.blockLeft', blockwise.blockLeft],
    ['vinel.blockRight', blockwise.blockRight],
    ['vinel.blockUp', blockwise.blockUp],
    ['vinel.blockDown', blockwise.blockDown],
    ['vinel.blockLineStart', blockwise.blockLineStart],
    ['vinel.blockLineEnd', blockwise.blockLineEnd],
    ['vinel.blockInsert', blockwise.blockInsert],
    ['vinel.blockAppend', blockwise.blockAppend],
    ['vinel.blockDelete', blockwise.blockDelete],
    ['vinel.blockChange', blockwise.blockChange],
    ['vinel.blockYank', blockwise.blockYank],

    // Visual-mode operators
    ['vinel.visualDelete', operators.visualDelete],
    ['vinel.visualIndent', operators.visualIndent],
    ['vinel.visualOutdent', operators.visualOutdent],
    ['vinel.visualJoin', operators.visualJoin],
    ['vinel.visualLower', operators.visualLower],
    ['vinel.visualUpper', operators.visualUpper],
    ['vinel.visualToggleCase', operators.visualToggleCase],

    // Insert-entry variants + text-object prefixes
    ['vinel.iKey', iKey],
    ['vinel.aKey', aKey],
    ['vinel.provideTextObject', operators.provideTextObject],
    ['vinel.append', append],
    ['vinel.appendEol', appendEol],
    ['vinel.insertFirstNonBlank', insertFirstNonBlank],
    ['vinel.substituteChar', operators.substituteChar],
    ['vinel.substituteLine', operators.substituteLine],
    ['vinel.deleteCharBefore', operators.deleteCharBefore],

    // Normal-mode line operations
    ['vinel.join', operators.normalJoin],
    ['vinel.toggleCase', operators.normalToggleCase],
    ['vinel.indentLines', operators.indentLines],
    ['vinel.outdentLines', operators.outdentLines],

    // Additional motions
    ['vinel.wordForwardBig', motions.wordForwardBig],
    ['vinel.wordBackwardBig', motions.wordBackwardBig],
    ['vinel.wordEndBig', motions.wordEndBig],
    ['vinel.matchBracket', motions.matchBracket],
    ['vinel.lineUp', motions.lineUp],
    ['vinel.lineDown', motions.lineDown],
    ['vinel.lineFirstNonBlank', motions.lineFirstNonBlank],
    ['vinel.lineLastNonBlank', motions.lineLastNonBlank],
    ['vinel.screenTop', motions.screenTop],
    ['vinel.screenMiddle', motions.screenMiddle],
    ['vinel.screenBottom', motions.screenBottom],

    // Search & scroll
    ['vinel.searchNext', motions.searchNext],
    ['vinel.searchPrev', motions.searchPrev],
    ['vinel.starSearch', motions.starSearch],
    ['vinel.hashSearch', motions.hashSearch],
    ['vinel.halfPageDown', motions.halfPageDown],
    ['vinel.halfPageUp', motions.halfPageUp],
    ['vinel.pageDown', motions.pageDown],
    ['vinel.pageUp', motions.pageUp],
    ['vinel.scrollCenter', motions.scrollCenter],
    ['vinel.scrollTop', motions.scrollTop],
    ['vinel.scrollBottom', motions.scrollBottom],

    // Find-char + replace (f/F/t/T/r/;/, + the provideChar keystroke layer)
    ['vinel.findForward', operators.findChar('f')],
    ['vinel.findBackward', operators.findChar('F')],
    ['vinel.tillForward', operators.findChar('t')],
    ['vinel.tillBackward', operators.findChar('T')],
    ['vinel.replaceChar', operators.replaceChar],
    ['vinel.repeatFind', operators.repeatFind(false)],
    ['vinel.repeatFindReverse', operators.repeatFind(true)],
    ['vinel.provideChar', operators.provideChar],
  ];

  // Macro recorder: every command logs itself (after it runs) while a macro is
  // recording — our commands ARE the vim actions. Off the record path it's one
  // cheap branch, so there's no overhead when not recording. Excludes the
  // macro controls themselves and the no-op suppressor.
  const MACRO_EXCLUDE = new Set([
    'vinel.macroRecord', 'vinel.macroReplay', 'vinel.provideMacro', 'vinel.suppressKey',
    'vinel.macroRecordToggle', 'vinel.macroPlayLast',
  ]);
  for (const [id, handler] of commands) {
    const recorded = async (...args: unknown[]): Promise<unknown> => {
      const result = await handler(...args);
      if (!MACRO_EXCLUDE.has(id)) macros.recordCommand(id, args);
      return result;
    };
    context.subscriptions.push(vscode.commands.registerCommand(id, recorded));
  }
}

export function deactivate(): void {
  // VS Code removes the extension's code, commands, and contributed keybindings
  // automatically on uninstall, and ViNEL persists NO settings or state (no
  // `contributes.configuration`, nothing written to disk / globalState) — so a
  // reinstall always starts clean. This just tidies transient UI + context keys
  // in case the extension is disabled without a reload. The user's OWN
  // keybindings.json (their leader mappings) is their file and is left untouched.
  macros.disposeMacros();
  for (const key of [
    'vinel.mode', 'vinel.awaitingChar', 'vinel.awaitingTextObject',
    'vinel.awaitingMark', 'vinel.awaitingRegister', 'vinel.awaitingMacro',
    'vinel.recordingMacro',
  ]) {
    vscode.commands.executeCommand('setContext', key, undefined);
  }
  // Best-effort: restore a normal line cursor in open editors.
  for (const editor of vscode.window.visibleTextEditors) {
    editor.options = { ...editor.options, cursorStyle: vscode.TextEditorCursorStyle.Line };
  }
}
