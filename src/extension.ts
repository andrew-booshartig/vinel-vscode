import * as vscode from 'vscode';
import {
  Mode, afterMotion, appendDigit, consumeCount, createStatusBarItem, getMode,
  getVisualLineAnchor, isVisual, setMode, setVisualLineAnchor, syncActiveEditor,
  zeroIsMotion,
} from './state';
import * as motions from './motions';
import * as operators from './operators';
import * as dotrepeat from './dotrepeat';

/**
 * BetterVim — a native modal-editing state machine for VSCode. Not an
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
  operators.cancelPendingOperator();   // Escape cancels a half-typed d/c/y, like vim
  operators.cancelPendingChar();       // …and a half-typed f/t/r
  operators.cancelPendingTextObject(); // …and a half-typed i/a text object
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
    ['betterVim.enterNormal', enterNormal],
    ['betterVim.enterInsert', enterInsert],
    ['betterVim.enterVisual', enterVisual],
    ['betterVim.enterVisualLine', enterVisualLine],
    ['betterVim.suppressKey', suppressKey],

    ['betterVim.digit0', digitZero],
    ['betterVim.digit1', digit('1')],
    ['betterVim.digit2', digit('2')],
    ['betterVim.digit3', digit('3')],
    ['betterVim.digit4', digit('4')],
    ['betterVim.digit5', digit('5')],
    ['betterVim.digit6', digit('6')],
    ['betterVim.digit7', digit('7')],
    ['betterVim.digit8', digit('8')],
    ['betterVim.digit9', digit('9')],

    ['betterVim.moveLeft', motions.moveLeft],
    ['betterVim.moveRight', motions.moveRight],
    ['betterVim.moveUp', motions.moveUp],
    ['betterVim.moveDown', motions.moveDown],
    // w/b/e double as operator targets (dw/cw/yw) — see operators.ts's note on
    // why these route through operatorAwareWordMotion instead of calling
    // motions.wordForward() etc. directly (count-multiplication semantics).
    ['betterVim.wordForward', operators.operatorAwareWordMotion('cursorWordStartRight')],
    ['betterVim.wordBackward', operators.operatorAwareWordMotion('cursorWordStartLeft')],
    ['betterVim.wordEnd', operators.operatorAwareWordMotion('cursorWordEndRight')],
    ['betterVim.firstNonBlank', motions.firstNonBlank],
    ['betterVim.lineEnd', motions.lineEnd],
    ['betterVim.bufferTop', motions.bufferTop],
    ['betterVim.bufferBottom', motions.bufferBottom],
    ['betterVim.paragraphBackward', motions.paragraphBackward],
    ['betterVim.paragraphForward', motions.paragraphForward],
    ['betterVim.search', motions.search],

    ['betterVim.opDelete', operators.operatorKey('delete')],
    ['betterVim.opChange', operators.operatorKey('change')],
    ['betterVim.opYank', operators.operatorKey('yank')],
    ['betterVim.deleteToEol', operators.deleteToEol],
    ['betterVim.changeToEol', operators.changeToEol],
    ['betterVim.yankLine', operators.yankLine],
    ['betterVim.cutChar', operators.cutChar],
    ['betterVim.pasteAfter', operators.pasteAfter],
    ['betterVim.pasteBefore', operators.pasteBefore],
    ['betterVim.openBelow', operators.openBelow],
    ['betterVim.openAbove', operators.openAbove],
    ['betterVim.oKey', oKey],
    ['betterVim.undo', undo],
    ['betterVim.redo', redo],
    ['betterVim.repeatChange', repeat],

    // Visual-mode operators
    ['betterVim.visualDelete', operators.visualDelete],
    ['betterVim.visualIndent', operators.visualIndent],
    ['betterVim.visualOutdent', operators.visualOutdent],
    ['betterVim.visualJoin', operators.visualJoin],
    ['betterVim.visualLower', operators.visualLower],
    ['betterVim.visualUpper', operators.visualUpper],
    ['betterVim.visualToggleCase', operators.visualToggleCase],

    // Insert-entry variants + text-object prefixes
    ['betterVim.iKey', iKey],
    ['betterVim.aKey', aKey],
    ['betterVim.provideTextObject', operators.provideTextObject],
    ['betterVim.append', append],
    ['betterVim.appendEol', appendEol],
    ['betterVim.insertFirstNonBlank', insertFirstNonBlank],
    ['betterVim.substituteChar', operators.substituteChar],
    ['betterVim.substituteLine', operators.substituteLine],
    ['betterVim.deleteCharBefore', operators.deleteCharBefore],

    // Normal-mode line operations
    ['betterVim.join', operators.normalJoin],
    ['betterVim.toggleCase', operators.normalToggleCase],
    ['betterVim.indentLines', operators.indentLines],
    ['betterVim.outdentLines', operators.outdentLines],

    // Additional motions
    ['betterVim.wordForwardBig', motions.wordForwardBig],
    ['betterVim.wordBackwardBig', motions.wordBackwardBig],
    ['betterVim.wordEndBig', motions.wordEndBig],
    ['betterVim.matchBracket', motions.matchBracket],
    ['betterVim.lineUp', motions.lineUp],
    ['betterVim.lineDown', motions.lineDown],
    ['betterVim.lineFirstNonBlank', motions.lineFirstNonBlank],
    ['betterVim.lineLastNonBlank', motions.lineLastNonBlank],
    ['betterVim.screenTop', motions.screenTop],
    ['betterVim.screenMiddle', motions.screenMiddle],
    ['betterVim.screenBottom', motions.screenBottom],

    // Search & scroll
    ['betterVim.searchNext', motions.searchNext],
    ['betterVim.searchPrev', motions.searchPrev],
    ['betterVim.starSearch', motions.starSearch],
    ['betterVim.hashSearch', motions.hashSearch],
    ['betterVim.halfPageDown', motions.halfPageDown],
    ['betterVim.halfPageUp', motions.halfPageUp],
    ['betterVim.pageDown', motions.pageDown],
    ['betterVim.pageUp', motions.pageUp],
    ['betterVim.scrollCenter', motions.scrollCenter],
    ['betterVim.scrollTop', motions.scrollTop],
    ['betterVim.scrollBottom', motions.scrollBottom],

    // Find-char + replace (f/F/t/T/r/;/, + the provideChar keystroke layer)
    ['betterVim.findForward', operators.findChar('f')],
    ['betterVim.findBackward', operators.findChar('F')],
    ['betterVim.tillForward', operators.findChar('t')],
    ['betterVim.tillBackward', operators.findChar('T')],
    ['betterVim.replaceChar', operators.replaceChar],
    ['betterVim.repeatFind', operators.repeatFind(false)],
    ['betterVim.repeatFindReverse', operators.repeatFind(true)],
    ['betterVim.provideChar', operators.provideChar],
  ];

  for (const [id, handler] of commands) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }
}

export function deactivate(): void {
  // nothing to clean up
}
