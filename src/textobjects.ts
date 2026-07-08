import * as vscode from 'vscode';

/**
 * Text-object range engine — pure: (document, position, object, inner/around)
 * in, a Range out (or null when there's no such object under the cursor, so
 * `ci"` off any quotes is a no-op like vim). No VS Code commands, so it's
 * trivially unit-testable. The operator/Visual application and the `i`/`a`
 * input stage live in operators.ts; this module only answers "what span?".
 */

export type TextObjectId =
  | 'word' | 'WORD'
  | 'dquote' | 'squote' | 'backtick'
  | 'paren' | 'brace' | 'bracket' | 'angle'
  | 'paragraph';

export interface TextObjectResult {
  range: vscode.Range;
  linewise: boolean;
}

const BRACKET_PAIR: Record<string, [string, string]> = {
  paren: ['(', ')'],
  brace: ['{', '}'],
  bracket: ['[', ']'],
  angle: ['<', '>'],
};

const QUOTE_CHAR: Record<string, string> = {
  dquote: '"',
  squote: "'",
  backtick: '`',
};

export function textObjectRange(
  doc: vscode.TextDocument,
  pos: vscode.Position,
  id: TextObjectId,
  around: boolean,
): TextObjectResult | null {
  if (id === 'word' || id === 'WORD') return wordObject(doc, pos, id === 'WORD', around);
  if (id in QUOTE_CHAR) return quoteObject(doc, pos, QUOTE_CHAR[id], around);
  if (id in BRACKET_PAIR) return bracketObject(doc, pos, BRACKET_PAIR[id][0], BRACKET_PAIR[id][1], around);
  if (id === 'paragraph') return paragraphObject(doc, pos, around);
  return null;
}

// ── word / WORD ─────────────────────────────────────────────────────────────
// A "word" is a maximal run of one character class; WORD collapses the classes
// to non-space vs space. `aw` adds trailing whitespace (or leading if none).

function wordClass(ch: string, big: boolean): 'word' | 'punct' | 'space' {
  if (/\s/.test(ch)) return 'space';
  if (big) return 'word'; // WORD: everything non-space is one class
  return /\w/.test(ch) ? 'word' : 'punct';
}

function wordObject(doc: vscode.TextDocument, pos: vscode.Position, big: boolean, around: boolean): TextObjectResult | null {
  const text = doc.lineAt(pos.line).text;
  if (text.length === 0) return null;
  const col = Math.min(pos.character, text.length - 1);
  const cls = wordClass(text[col], big);
  let start = col;
  let end = col;
  while (start > 0 && wordClass(text[start - 1], big) === cls) start--;
  while (end < text.length - 1 && wordClass(text[end + 1], big) === cls) end++;
  let sCol = start;
  let eCol = end + 1; // exclusive

  if (around && cls !== 'space') {
    let te = eCol;
    while (te < text.length && /\s/.test(text[te])) te++;
    if (te > eCol) {
      eCol = te; // trailing whitespace
    } else {
      let ts = sCol;
      while (ts > 0 && /\s/.test(text[ts - 1])) ts--;
      sCol = ts; // else leading whitespace
    }
  }
  return {
    range: new vscode.Range(new vscode.Position(pos.line, sCol), new vscode.Position(pos.line, eCol)),
    linewise: false,
  };
}

// ── quotes ───────────────────────────────────────────────────────────────────
// Pairs quotes left-to-right on the current line; picks the pair the cursor is
// inside, or the next pair after it. (Escaped quotes are not special-cased.)

function quoteObject(doc: vscode.TextDocument, pos: vscode.Position, quote: string, around: boolean): TextObjectResult | null {
  // A string is line-bound (quotes pair within a line), but the SEEK is not:
  // scan the cursor's line first, then subsequent lines, for the first pair —
  // so `ci"` finds the next string ahead regardless of what line it's on.
  const lastLine = doc.lineCount - 1;
  for (let line = pos.line; line <= lastLine; line++) {
    const text = doc.lineAt(line).text;
    const marks: number[] = [];
    for (let i = 0; i < text.length; i++) if (text[i] === quote) marks.push(i);
    for (let p = 0; p + 1 < marks.length; p += 2) {
      const open = marks[p];
      const close = marks[p + 1];
      // On the cursor's line, ignore pairs that already ended before it.
      if (line === pos.line && close < pos.character) continue;
      const sCol = around ? open : open + 1;
      let eCol = around ? close + 1 : close;
      if (around) {
        while (eCol < text.length && /\s/.test(text[eCol])) eCol++; // a" grabs trailing ws
      }
      return {
        range: new vscode.Range(new vscode.Position(line, sCol), new vscode.Position(line, eCol)),
        linewise: false,
      };
    }
  }
  return null;
}

// ── bracket pairs (balanced, whole-document) ─────────────────────────────────

function bracketObject(doc: vscode.TextDocument, pos: vscode.Position, open: string, close: string, around: boolean): TextObjectResult | null {
  const text = doc.getText();
  const cursor = doc.offsetAt(pos);

  // Find the opener, in priority order:
  let openOff = -1;
  if (text[cursor] === open) {
    // 1) cursor sits on the opening bracket.
    openOff = cursor;
  } else {
    // 2) enclosing pair — scan left, matching nested closes.
    let d = 0;
    for (let i = cursor - 1; i >= 0; i--) {
      if (text[i] === close) d++;
      else if (text[i] === open) {
        if (d === 0) { openOff = i; break; }
        d--;
      }
    }
    // 3) not inside one → seek FORWARD through the whole document for the next
    //    opener (nvim-faithful: `di[` finds the next bracket ahead regardless
    //    of what line it's on, then deletes inside its matched pair).
    if (openOff === -1) {
      for (let j = cursor; j < text.length; j++) {
        if (text[j] === open) { openOff = j; break; }
      }
    }
  }
  if (openOff === -1) return null;

  // Find its match to the right (may cross lines).
  let depth = 0;
  let closeOff = -1;
  for (let j = openOff + 1; j < text.length; j++) {
    if (text[j] === open) depth++;
    else if (text[j] === close) {
      if (depth === 0) { closeOff = j; break; }
      depth--;
    }
  }
  if (closeOff === -1) return null;

  const sOff = around ? openOff : openOff + 1;
  const eOff = around ? closeOff + 1 : closeOff;
  return { range: new vscode.Range(doc.positionAt(sOff), doc.positionAt(eOff)), linewise: false };
}

// ── paragraph ────────────────────────────────────────────────────────────────
// A run of same-blankness lines; `ap` extends over the adjacent opposite run
// (trailing preferred, else leading). Linewise.

function isBlankLine(doc: vscode.TextDocument, line: number): boolean {
  return doc.lineAt(line).text.trim() === '';
}

function paragraphObject(doc: vscode.TextDocument, pos: vscode.Position, around: boolean): TextObjectResult {
  const last = doc.lineCount - 1;
  const blank = isBlankLine(doc, pos.line);
  let start = pos.line;
  let end = pos.line;
  while (start > 0 && isBlankLine(doc, start - 1) === blank) start--;
  while (end < last && isBlankLine(doc, end + 1) === blank) end++;

  if (around) {
    let e = end;
    while (e < last && isBlankLine(doc, e + 1) !== blank) e++;
    if (e > end) {
      end = e;
    } else {
      let s = start;
      while (s > 0 && isBlankLine(doc, s - 1) !== blank) s--;
      start = s;
    }
  }

  const isLast = end === last;
  const begin = new vscode.Position(start, 0);
  const finish = isLast ? doc.lineAt(end).range.end : new vscode.Position(end + 1, 0);
  return { range: new vscode.Range(begin, finish), linewise: true };
}
