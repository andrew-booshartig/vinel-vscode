# BetterVim

A native modal-editing state machine for VSCode. Not an emulation, and not a
Neovim bridge — the two existing approaches, and the two root causes behind
nearly every real, verified complaint about them (see "Why this should avoid
VSCodeVim's worst problems" below).

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
`src/extension.ts`).** NORMAL/INSERT modes — vim's own names, not an invented
vocabulary — following standard vim semantics as the target. (An earlier
Emacs-based prototype used its own POWER/EDIT terminology and had a few
Emacs-specific workarounds baked in — e.g. its `0`/`,` split; that prototype
is a reference for *mechanism*, not a spec copied verbatim — see the `0`/`$`/
`^` notes in `motions.ts`.) Where VSCode already does something excellently,
this uses it directly rather than reimplementing vim on top of it — `/` opens
VSCode's own native Find instead of a hand-built vim search.

- **Mode state**, per editor (like real vim — each buffer is independently
  Normal/Insert): a string context key (`betterVim.mode`, `'normal'` |
  `'insert'`), status-bar indicator, cursor shape sync (block ↔ line). Fresh
  editors default to NORMAL.
- **Escape → NORMAL** (spammable), **`i` → INSERT** while in NORMAL.
- **Digit-count prefix system** — VSCode has no built-in equivalent to
  Emacs's numeric prefix-arg, so this is hand-built: digits buffer into a
  pending count, shown in the status bar, consumed by the next motion
  (`5j` moves down 5 lines) and reset after. `0` is real vim: a motion
  (column 0) unless a count is already in progress, in which case it extends
  the count.
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
  `cc` instead empties down to ONE line and drops into INSERT, keeping vim's
  `autoindent` behavior: the new empty line preserves the changed line's own
  indentation (`    foo` → an empty line still indented to column 4). The one
  case that has no indent to preserve — an *already-blank* line inside an
  indented block (VSCodeVim #1017) — falls back to VS Code's own language-
  aware reindenter (the same mechanism `o`/`O` use) to compute the block's
  indent. (Reindenting *unconditionally* was wrong: on a content line the
  reindenter often recomputes to zero and eats the indent you had — so it's
  scoped to only the blank-line case.) Verified the range math against an
  offset-based splice simulation (both the indent-preserving and blank-line
  paths, plus first/middle/last line, multi-line counts, the true-end-of-
  buffer edge case, and single-line docs).
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
- **`o` / `O`** — open a line below/above, auto-indent, drop into INSERT.
- **`u` / `Ctrl+R`** — VSCode's native undo/redo directly.
- **The unnamed register** (`registers.ts`) — vim's default `"` register,
  what every op above reads/writes. Named registers (`a`-`z`) are a distinct,
  larger feature, not built here.

**Not yet built** (future milestones): text objects (`ci"`, `da(`), VISUAL
select mode (including a deliberate QoL deviation from strict vim — pressing
Delete/Backspace in VISUAL mode deletes the selection directly, faster than
`d`), marks/named registers, ex-commands, macros.

## Why this should avoid VSCodeVim's worst problems

Researched against VSCodeVim's own GitHub issue tracker (real issue titles
and vote counts, not secondhand summaries) plus a from-scratch architectural
analysis. These are locked-in design invariants, not incidental — they're
the actual reason a native state machine should sidestep the community's
most-upvoted complaints, and they need to stay true as more gets built:

- **Never hijack the `type` command.** VSCodeVim's approach — parsing every
  keystroke through the extension host before it reaches the screen — is the
  root cause behind its top complaints: typing lag, dropped keystrokes on
  large files, and broken IME/CJK composition. NORMAL-mode keys here are
  discrete `contributes.keybindings`, each routed straight to one specific
  command; INSERT mode has **zero** custom keybindings — typing is 100%
  native VS Code, untouched, so none of that class of bug can occur.
- **Never build a shadow undo/text model.** "Pressing `u` will undo all the
  stack" is VSCodeVim's single most-upvoted open issue (177 votes) — a
  desynced shadow undo tree. `undo`/`redo` here call VS Code's own commands
  directly; there is no parallel undo history to fall out of sync.
- **Multi-count operators are already atomic.** `3dd`/`2d3w` compute the full
  target range *before* editing, so each is exactly one `editor.edit()` call
  = one undo entry — pressing `u` once undoes the whole thing.
- **Macro requirement (future milestone, not built yet, but locked in now):**
  when macro replay is built, it must batch every edit into a single undo
  transaction using `editor.edit()`'s `undoStopBefore`/`undoStopAfter` flags
  — only the first edit in a replay gets a normal undo-stop-before, only the
  last a normal undo-stop-after, everything between suppresses both — so `u`
  after a macro undoes the whole macro in one step, not one sub-edit at a
  time. Written down here specifically because "macro replay breaks undo" is
  the exact failure mode behind VSCodeVim's #1 complaint, and it's much
  easier to get right from day one than to retrofit.
- **Scoped strictly to `editorTextFocus`.** Every keybinding is gated on it,
  and mouse events are never touched — the sidebar, file tree, breadcrumbs,
  and mouse-driven cursor placement are structurally untouched, unlike
  VSCodeVim's reported breakage there. Staying scoped this way (not
  extending `hjkl` into the tree/sidebar) is an **intentional non-goal**,
  not an oversight — that kind of overreach is exactly what causes those
  complaints.
- **Native goal-column tracking for free.** Vertical motion goes through VS
  Code's own cursor primitives (`moveUp`/`moveDown` issue a `cursorMove` with
  `by: 'wrappedLine'`, identical to `cursorUp`/`cursorDown`) rather than
  reimplementing cursor movement, so "cursor loses its column moving through
  uneven lines" isn't a bug class that can occur here.
- **Mode state never touches cursor position.** Switching tabs re-applies
  the target editor's remembered mode (context key, cursor style, status
  bar) but never moves the cursor — "cursor jumps to start of file after
  switching tabs" isn't reachable by this code path.
- **Ex-commands** (future milestone), when built, will delegate to VS Code's
  native find/replace-with-regex rather than a hand-rolled vim-regex
  translator — the same precedent as `/` → `actions.find` here already.

### Performance on big codebases (explicit scaling invariants)

"Vim gets slow / freezes on large files" is one of VSCodeVim's most-upvoted
complaints. These are the properties that keep this engine flat regardless of
file or project size — treated as invariants that every future feature must
preserve:

- **No per-keystroke document processing.** There is deliberately **no**
  `onDidChangeTextDocument` handler — nothing re-parses or re-scans the buffer
  on every edit. The only event subscribed is `onDidChangeActiveTextEditor`
  (fires on *tab switch*, not on typing), and its handler is O(1): set a
  context key, cursor style, and status-bar text. This is the single biggest
  reason a 50k-line file feels the same as a 50-line one.
- **Edits are one atomic operation regardless of count.** `1000dd` computes
  the whole range first and issues exactly one `editor.edit()` — it does not
  loop a per-line delete 1000 times.
- **Large counts use a native count argument, not N dispatches.** Vertical
  `j`/`k` pass `value: N` to a single `cursorMove`, so `500j` is one
  round-trip. The generic repeat-loop (`state.ts`'s `repeatCommand`) is
  reserved for motions whose counts are always tiny in practice (`3w`, `5l`);
  a new motion that could plausibly take a large count must use the native
  count path, not the loop.
- **Future features must not regress this.** VISUAL mode and beyond must not
  add a per-keystroke document scan or re-render on every selection change,
  and must keep edits to a single `editor.edit()` per operation.

## ⚠️ Testing this requires VSCodeVim disabled

VSCodeVim is very likely still installed and active in your VSCode profile.
It claims the exact same keys this extension does (`h j k l i` Escape,
digits…) via its own `vim.mode` context, completely independent of this
extension's `betterVim.mode` context — so with both active, the same
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
code --install-extension bettervim-0.0.1.vsix --force
```
