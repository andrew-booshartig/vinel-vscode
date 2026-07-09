# ViNEL

**ViNEL Is Not an Emulation Layer** — Vim / Neovim modal editing for VS Code.
(An ode to Wine and Vi.)

## What it is

Vim's modal editing — Normal / Visual / Insert modes, operators, text objects,
dot-repeat, find-char, counts — built as a **native state machine** on top of
VS Code, not a Vim emulation and not a Neovim bridge.

- **Normal mode** does what Vim would do; **Insert mode** does what VS Code
  would do (typing is 100% native — ViNEL never touches it).
- Every command routes straight to VS Code's **own** commands (cursor moves,
  edits, undo, find). No `type`-command hijacking, no shadow undo tree — the
  two things that make other Vim extensions lag on big files and mangle undo.
- A status-bar badge shows the mode: **☯ NORMAL · ☯ INSERT · ☯ VISUAL ·
  ☯ V-LINE**. The block/line cursor tracks it.

Everything below is count-aware — prefix a number (`3dd`, `5j`, `2ci"`).

## Controls

### Modes & entering Insert
| Key | Action |
|-----|--------|
| `Esc` | Return to Normal (cancels a half-typed operator / find / text object) |
| `i` / `a` | Insert before / after the cursor |
| `I` / `A` | Insert at first non-blank / end of line |
| `o` / `O` | Open a line below / above and insert |
| `v` / `V` | Charwise / linewise Visual mode (press again or `Esc` to exit) |
| `Ctrl-V` | Blockwise (columnar) Visual — see the Blockwise section below |
| `R` | Replace (overtype) mode — typing overwrites; Backspace restores |

### Motions (Normal & Visual)
| Key | Action |
|-----|--------|
| `h` `j` `k` `l` / arrows | Left / down / up / right |
| `w` `b` `e` | Word forward / back / end |
| `W` `B` `E` | WORD (whitespace-delimited) forward / back / end |
| `0` `^` `$` | Line start / first non-blank / line end |
| `-` `+` `_` `g_` | First non-blank of prev / next line · first / last non-blank |
| `gg` `G` | Top / bottom of file (`{count}G` → line) |
| `{` `}` | Previous / next paragraph |
| `%` | Matching bracket |
| `H` `M` `L` | Top / middle / bottom of the screen |
| `f{c}` `F{c}` | Jump to next / previous `{c}` on the line |
| `t{c}` `T{c}` | Jump just before / after next / previous `{c}` |
| `;` `,` | Repeat last `f`/`t` forward / reversed |
| `/` | Find (VS Code's native search) |
| `n` `N` | Next / previous search match |
| `*` `#` | Search word under cursor forward / backward |
| `Ctrl-D` `Ctrl-U` | Half page down / up |
| `Ctrl-F` `Ctrl-B` | Page down / up |
| `zz` `zt` `zb` | Scroll current line to center / top / bottom |

### Operators & edits (Normal)
| Key | Action |
|-----|--------|
| `d` `c` `y` + motion | Delete / change / yank over the motion (`dw`, `c$`, `y%`, `dt,`) |
| `dd` `cc` `yy` | Whole line(s) |
| `D` `C` `Y` | To end of line · change to end of line · yank line |
| `x` `X` | Delete char under / before the cursor |
| `s` `S` | Substitute char / whole line (delete + insert) |
| `r{c}` | Replace char(s) with `{c}` |
| `~` | Toggle case of char(s) |
| `J` | Join lines |
| `>>` `<<` | Indent / outdent line(s) |
| `p` `P` | Paste after / before |
| `u` `Ctrl-R` | Undo / redo |
| `.` | **Repeat the last change** (incl. text typed in an insert change; `N.` overrides the count) |
| `:` | **Ex command line** (see below) |

### Marks & registers
| Key | Action |
|-----|--------|
| `m{a-z}` | Set a mark at the cursor (per-file) |
| `` `{a-z} `` | Jump to the mark (exact position) — also an operator target (`` d`a ``) |
| `'{a-z}` | Jump to the mark's line (first non-blank) — linewise target (`d'a`) |
| `` `` `` / `''` | Jump back to where you were before the last jump |
| `"{a-z}` + op | Use a named register (`"ayy` yanks to `a`, `"ap` pastes from it) |
| `"{A-Z}` + op | Append to a register (`"Ayy`) |
| `"_` + op | Black-hole register (delete without clobbering the yank) |

### Macros
| Key | Action |
|-----|--------|
| `q{a-z}` … `q` | Record a macro into a slot, stop with `q` |
| `@{a-z}` | Replay the macro (`{count}@a` replays N times) |
| `@@` | Replay the last macro |
| `Cmd/Ctrl+F2` | **Toggle recording — works in *any* mode** (incl. Insert), into a default slot |
| `Cmd/Ctrl+F3` | **Replay the last-recorded macro** — prefix a count in Normal (`3`+`Cmd/Ctrl+F3` = 3×) |

Macros are **entirely ViNEL's own** — no companion extension, ever. They record
**literal keystrokes**: ViNEL commands, the characters you type in Insert, and
the Insert-mode navigation keys you press (arrows, Backspace, Home/End). Replay
re-issues typed characters through VS Code's real typing pipeline, so
**auto-indent, auto-closing pairs, auto-surround, and LSP edits all react on
replay exactly as they did while recording** — e.g. selecting a word and typing
`'` to wrap it replays as a wrap, not a literal quote. Replay honors a numeric
**prefix** with no pop-up dialog — type the count, fire the chord, done.

(How, without the always-on `type` hijack that makes other Vim extensions lag:
the keystroke capture — a scoped `type` override plus recording-only navigation
keybindings — is installed only while the red badge is showing and torn down the
instant you stop. Off the record path, Insert typing is 100% native.)

`Cmd+F2` (Mac) / `Ctrl+F2` (Windows/Linux) and `F3` are state-independent:
unlike `q`/`@` (Normal-only), they fire in every mode — start recording
mid-Insert, keep typing, stop without leaving home row. A red **⏺ REC** badge
sits in the status bar while recording. `Cmd/Ctrl+F3` replays whatever you
recorded most recently (a `q{letter}` macro or an F2 one) and restores the mode
you recorded *from*, so playback is correct wherever you trigger it.

The one place ViNEL touches `type` is Replace mode, and only while `R` is active
(the handler is disposed the instant you leave it) — Insert-mode typing is
always 100% native.

> `F2`/`F3` are only the **defaults** — change the record/playback combos to
> whatever you like. See [Customizing keybindings](#customizing-keybindings).

### Blockwise Visual (`Ctrl-V`)
| Key | Action |
|-----|--------|
| `Ctrl-V` | Enter blockwise Visual (a *columnar* / rectangular selection) |
| `h` `j` `k` `l` / arrows | Grow / shrink the rectangle |
| `0` `$` | Left edge to column 0 · right edge to each line's end (ragged) |
| `I` | **Insert at the block's left edge on every selected line at once** |
| `A` | **Append at the block's right edge (or line end after `$`) on every line** |
| `d` `x` · `c` · `y` | Delete · change · yank the rectangle |

Blockwise selects the same **columns** across a range of **lines** — a tall box
instead of a run of text. Its signature move is block insert: make a column
selection down N lines, press `I` (or `A`), type once, `Esc` — and the text lands
on *every* line at that column. ViNEL does this with VS Code's own multi-cursor
(one cursor per row), so the broadcast typing is fully native.

> **`Ctrl-V` note:** on Windows/Linux `Ctrl-V` is normally Paste; ViNEL rebinds
> it to blockwise Visual while in Normal/Visual (matching vim). Paste on Mac is
> `Cmd+V` and is unaffected. To keep `Ctrl-V` as paste, remove/rebind
> `vinel.enterVisualBlock` in your keybindings.json (same mechanism as above).

### Ex-commands (`:`)
Opens VS Code's input box; Enter runs, Escape cancels.

| Command | Action |
|---------|--------|
| `:w` `:wa` | Save · save all |
| `:q` `:q!` `:qa` | Close · close discarding · close all |
| `:wq` `:x` | Save and close |
| `:sp` `:vs` | Split down · split right |
| `:42` `:$` | Go to line 42 · last line |
| `:s/pat/rep/[g][i]` | Substitute on the current line (`g` = all, `i` = ignore case) |
| `:%s/pat/rep/g` | Substitute across the whole file |
| `:10,20s/…` | Substitute over a line range |
| `:'<,'>s/…` | Substitute over the Visual selection (`:` from Visual prefills this) |
| `:[range]d` `:[range]y` | Delete / yank a line range (`:15,20y`, `:%d`) |
| `:[range]>` `:[range]<` | Indent / outdent a line range |
| `:[range]j` | Join a line range |
| `:noh` | Clear the search highlight |

Ranges: `%` (whole file), `n,m`, `.` (current), `$` (last), `'<,'>` (Visual
selection); no range = current line.

Substitution patterns are JavaScript `RegExp` (not full vim regex) — literals,
`\d`, groups, `\1` backrefs, `&` = whole match all work; `\v`/`\zs`/`\<` do
not. One `:%s` is a single undo.

### Text objects (after `d`/`c`/`y`, or in Visual)
| Key | Object |
|-----|--------|
| `iw` `aw` / `iW` `aW` | Inner / around word · WORD |
| `i"` `a"` `i'` `` i` `` | Inner / around a quoted string |
| `i(` `i)` `ib` | Inner / around `()` (`ib` alias) |
| `i{` `i}` `iB` | Inner / around `{}` (`iB` alias) |
| `i[` `i]` · `i<` `i>` | Inner / around `[]` · `<>` |
| `ip` `ap` | Inner / around paragraph |

Use `a` instead of `i` for the "around" (delimiters-included) form: `ci"`,
`da(`, `yi{`, `vip`, …

### Visual mode
| Key | Action |
|-----|--------|
| motions | Extend the selection |
| `d` `c` `y` `x` | Act on the selection |
| `Delete` / `Backspace` | Delete the selection (QoL — faster than `d`) |
| `p` | Paste over the selection |
| `>` `<` | Indent / outdent |
| `J` | Join |
| `~` `u` `U` | Toggle / lower / upper case |
| `o` | Jump to the other end of the selection |
| `i{obj}` `a{obj}` | Select a text object |

## Customizing keybindings

**Every key here is rebindable — nothing is locked.** ViNEL contributes plain VS
Code keybindings, so you override them the same way you'd override any built-in
shortcut. The macro **record** and **playback** combos are the ones people most
often want to change, so here's exactly how.

### The two macro shortcuts (defaults)
| Action | Default key | Command id (this is what you rebind) |
|--------|-------------|--------------------------------------|
| Start / stop recording | `Cmd+F2` (mac) · `Ctrl+F2` (Win/Linux) | `vinel.macroRecordToggle` |
| Replay last macro | `Cmd+F3` (mac) · `Ctrl+F3` (Win/Linux) | `vinel.macroPlayLast` |

### Option A — the Keyboard Shortcuts UI (no JSON)
1. Open the Command Palette (`Cmd/Ctrl+Shift+P`) → **Preferences: Open Keyboard Shortcuts**.
2. In the search box type **`ViNEL: Toggle macro recording`** (or **`ViNEL: Replay last macro`**).
3. Double-click the row, press your desired key combo, hit Enter. Done — your
   binding automatically takes priority over the default.

### Option B — edit `keybindings.json` directly
Command Palette → **Preferences: Open Keyboard Shortcuts (JSON)**, then add:

```jsonc
[
  // Pick any combos you like — these replace F2 / F3:
  { "key": "cmd+shift+2", "command": "vinel.macroRecordToggle", "when": "editorTextFocus" },
  { "key": "cmd+shift+3", "command": "vinel.macroPlayLast",     "when": "editorTextFocus" },

  // OPTIONAL — turn OFF the built-in F2 / F3 defaults (prefix the command with "-"):
  { "key": "cmd+f2", "command": "-vinel.macroRecordToggle" },
  { "key": "cmd+f3", "command": "-vinel.macroPlayLast" }
]
```

Notes:
- Keep `"when": "editorTextFocus"` so the shortcuts work in **every** mode
  (that's what lets you start/stop recording mid-Insert). To restrict a shortcut
  to Normal mode only, use `"when": "editorTextFocus && vinel.mode == 'normal'"`.
- A numeric **prefix** for playback works in Normal mode regardless of the key
  you choose: type the count, then fire your playback combo (`5` → replay 5×).
- Your `keybindings.json` always wins over ViNEL's defaults, so you don't have to
  disable a default before rebinding — the `-command` lines above are only if you
  want the old key to do nothing.

### Rebinding anything else
The same recipe works for **any** ViNEL command — search "ViNEL" in the Keyboard
Shortcuts UI to see them all, or bind by command id in JSON. A few handy ids:
`vinel.enterVisualBlock` (blockwise `Ctrl-V` — rebind if you want `Ctrl-V` back
as Paste on Windows/Linux), `vinel.exCommand` (`:`), `vinel.repeatChange` (`.`).

## Leader & custom mappings

ViNEL doesn't invent its own mapping language — you script leader commands with
**native VS Code chord keybindings**, gated to Normal mode. `Space` is the
conventional leader and ViNEL leaves it free (bare `Space` in Normal does
nothing), but any key works.

Command Palette → *Preferences: Open Keyboard Shortcuts (JSON)*, then add chords
whose `when` is `vinel.mode == 'normal'`:

```jsonc
[
  // <leader> = Space
  { "key": "space f",   "command": "workbench.action.quickOpen",  "when": "editorTextFocus && vinel.mode == 'normal'" },
  { "key": "space w",   "command": "workbench.action.files.save", "when": "editorTextFocus && vinel.mode == 'normal'" },
  { "key": "space g g", "command": "workbench.view.scm",          "when": "editorTextFocus && vinel.mode == 'normal'" },
  // a leader key can fire ViNEL's own commands too
  { "key": "space m",   "command": "vinel.macroPlayLast",         "when": "editorTextFocus && vinel.mode == 'normal'" }
]
```

- **Change your leader** by swapping the first key (`,`, `\`, …).
- **Sequences** are just multi-key chords — `space g g`, pressed in order.
- Your `keybindings.json` outranks ViNEL's defaults, so these take over `Space`
  in Normal automatically. The same works from the Keyboard Shortcuts UI (they're
  one synced store — see [Customizing keybindings](#customizing-keybindings)).

## Design note: text objects seek forward (across lines)

If the cursor isn't already inside/on a bracket or quote, `di[` / `ci"` **seek
forward through the document** to the next one and act on its matched pair — so
they work from anywhere, not only when you're on top of the delimiter. An
enclosing pair always wins over a later one.

This is a deliberate choice. Strict vanilla Vim only acts on an *enclosing*
pair (and beeps otherwise); ViNEL matches the plugin-augmented Neovim
experience (targets.vim / mini.ai style) instead, because it's more useful in
practice. So from far above a lone bracket, `di[` will travel down to that next
occurrence — by design.

## Requires VSCodeVim disabled

If VSCodeVim is installed it claims the same keys through its own context, and
which one fires becomes unpredictable. Disable or uninstall it:

```
code --uninstall-extension vscodevim.vim
```

## Building

```
npm install
npm run compile
npm run package                    # produces a .vsix
code --install-extension vinel-0.0.1.vsix --force
```

## Not built yet

Tag / sentence text objects (`it`/`at`, `is`/`as`). Everything else above —
marks, named registers, Ex-commands, Replace mode, blockwise Visual, macros, and
leader mappings — is built and native, with no companion extension required.

## Feedback & bug reports

- **Bugs / feature requests:** open an issue at
  <https://github.com/andrew-booshartig/vinel-vscode/issues>.
- **On the Marketplace:** the extension page's **Q&A** tab and **Ratings &
  Review** section both reach the publisher.
- Please include your OS, VS Code version, and steps to reproduce.

## Support

If ViNEL saves you time, you can support development ☕
**[Buy me a coffee](https://buymeacoffee.com/CHANGE-ME)**

<!-- Replace the link above with your real one (Buy Me a Coffee / Ko-fi / GitHub
     Sponsors). Setting "sponsor": { "url": "..." } in package.json also adds a
     Sponsor button to the Marketplace page. -->
