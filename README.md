# Ultra Instinct

A ground-up modal editing engine for VSCode. Not a Vim emulation — vim
emulations always end up fighting VSCode's own engine at the edges (snippets,
suggestions, brackets). This is meant to feel native.

Ported from a heavily custom Emacs modal setup (POWER/EDIT modes).

## What's here so far

**A general Tab/snippet fix** (declarative, no code): `tabout`'s own default
keybinding only checks `!suggestWidgetVisible` — it doesn't exclude
`inSnippetMode`. So while you're on a snippet tabstop and the completion
dropdown just isn't open at that instant (common — punctuation fields, the
first keystroke before suggestions populate), both "jump to next tabstop" and
"tabout" become eligible for Tab, and tabout tends to win, yanking you out of
the snippet. This extension unbinds tabout's unqualified defaults and
re-declares them with `!inSnippetMode` added, so snippet-tabstop navigation
always wins while a snippet is active — VSCode's own built-in
`jumpToNextSnippetPlaceholder`/`jumpToPrevSnippetPlaceholder` handle the rest,
untouched. Tab also never accepts a suggestion — only Enter does.

(Anything tied to a *specific* snippet body — e.g. "tab out of a particular
snippet's brace" — is a personal workflow detail, not general modal-editor
behavior, and lives outside this repo.)

**The modal engine — Milestone 1 (`src/state.ts`, `src/motions.ts`,
`src/extension.ts`).** POWER/EDIT modes, following standard vim semantics as
the target — the Emacs source (`ultra-instinct.el` et al.) is a reference for
*mechanism*, not a spec to copy verbatim, since some of its choices exist only
to work around Emacs-specific constraints (see the `0`/`$`/`^` notes in
`motions.ts`). Where VSCode already does something excellently, this uses it
directly rather than reimplementing vim on top of it — the same call the
Emacs port made keeping native `isearch` instead of hand-building vim search;
here `/` opens VSCode's own Find.

- **Mode state**, per editor (like real vim — each buffer is independently
  Normal/Insert): context key (`ultraInstinct.power`), status-bar indicator,
  cursor shape sync (block ↔ line). Fresh editors default to POWER.
- **Escape → POWER** (spammable), **`i` → EDIT** while in POWER.
- **Digit-count prefix system** — VSCode has no built-in equivalent to
  Emacs's numeric prefix-arg, so this is hand-built: digits buffer into a
  pending count, shown in the status bar, consumed by the next motion
  (`5j` moves down 5 lines) and reset after. `0` is real vim: a motion
  (column 0) unless a count is already in progress, in which case it extends
  the count — matching vim exactly, not the Emacs port's `,`/`.` workaround
  (that only existed because Emacs's `suppress-keymap` hard-claims every
  digit; VSCode has no such constraint).
- **Core motions**, all count-aware: `h j k l` + arrows, `w b e` (word),
  `0 ^ $` (line), `g g` / `G` (buffer top/bottom), `{` / `}` (paragraph,
  vim's own blank-line-boundary definition — VSCode has no built-in for
  this), `/` (native Find).

**Known, deliberate v1 simplification:** real vim's cursor occupies a
character *cell* (can't move past the last character on a line; `$` lands ON
it, not after). This milestone uses the conventional between-characters
model VSCode/Emacs both use (`$` = `cursorEnd`, lands after the last char).
Adopting the full character-cell model would touch nearly every motion —
worth its own deliberate decision later, not bundled in silently here.

**Not yet ported** (future milestones): operators (`c`/`d`/`y` × line/word/
text-object/selection), VISUAL select mode, marks/registers, the SPC leader
system.

**The modal engine — Milestone 2 (`src/operators.ts`, `src/registers.ts`).**
Vim's operator grammar: `[count1] operator [count2] motion` — the effective
repeat is count1 × count2 (`2d3w` deletes 6 words), or a doubled operator
letter (`dd`/`cc`/`yy`) meaning "N whole lines" from count1 alone. Scoped to
the highest-frequency subset first — text objects (`ci"`, `da(`) and
generalizing to *any* motion (`dG`, `d}`) are follow-ons; the range-based
architecture here already supports them once wired up.

- **`d` / `c` / `y`** — open a pending operator (status bar shows e.g. `d…`),
  cancelled by Escape.
- **`dd` / `cc` / `yy`** — N whole lines. Delete/yank remove them entirely;
  `cc` instead empties down to ONE line (keeping the first line's
  indentation) and drops into EDIT — real vim's `cc`, verified against an
  offset-based splice simulation (11/11 cases: first/middle/last line,
  multi-line counts, the true-end-of-buffer edge case, single-line docs).
- **`dw` / `cw` / `yw`** — word-target, via the raw cursor-move command run
  `count1 × count2` times (not composed from the plain-motion functions,
  which each consume their own count once and would double-count if reused
  here as a black box).
- **`D` / `C`** — delete/change to end of line. **`Y`** — standard vim: means
  `yy` (yank the whole line), not "yank to end of line" — that reading is a
  non-default remap some configs add.
- **`x`** — cut N characters. **`p` / `P`** — paste after/before, register-
  aware: a linewise register (from `dd`/`yy`) pastes as new line(s); a
  charwise one (`dw`/`x`) pastes inline.
- **`o` / `O`** — open a line below/above, auto-indent, drop into EDIT.
- **`u` / `Ctrl+R`** — VSCode's native undo/redo directly.
- **The unnamed register** (`registers.ts`) — vim's default `"` register,
  what every op above reads/writes. Named registers (`a`-`z`) are a distinct,
  larger feature, not built here.

## ⚠️ Testing this requires VSCodeVim disabled

VSCodeVim is very likely still installed and active in your VSCode profile.
It claims the exact same keys this extension does (`h j k l i` Escape,
digits…) via its own `vim.mode` context, completely independent of this
extension's `ultraInstinct.power` context — so with both active, the same
keypress can satisfy two unrelated extensions' keybindings at once, and which
one actually fires becomes unpredictable. Disable or uninstall VSCodeVim
before testing:

```
code --disable-extension vscodevim.vim
```

(Re-enable with `--enable-extension` if you want to compare behavior
side-by-side, but not both live in the same window at the same time.)

## Building

```
npm install
npm run compile
npm run package        # produces a .vsix
code --install-extension ultra-instinct-0.0.1.vsix --force
```
