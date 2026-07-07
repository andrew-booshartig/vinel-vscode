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
