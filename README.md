<div align="center">

<img src="images/icon.png" alt="ViNEL logo" width="128" height="128" />

# ViNEL

### ViNEL Is Not an Emulation Layer

**Native Vim / Neovim modal editing for VS Code — fast, faithful, and built on VS Code's own commands.**

<sub>(an ode to Wine and Vi)</sub>

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/andrew-booshartig.vinel?label=Marketplace&color=1a1b26)](https://marketplace.visualstudio.com/items?itemName=andrew-booshartig.vinel)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/andrew-booshartig.vinel?label=installs&color=1a1b26)](https://marketplace.visualstudio.com/items?itemName=andrew-booshartig.vinel)
[![License: MIT](https://img.shields.io/badge/license-MIT-1a1b26)](LICENSE)

</div>

---

ViNEL gives you Vim's whole grammar — modes, operators, motions, text objects,
counts, registers, macros, Ex-commands — **without the two problems every other
Vim extension has:**

- It **never hijacks the `type` command** to parse your keystrokes. That hijack
  is what makes other Vim extensions lag and drop keys on big files. In ViNEL,
  Normal-mode keys are ordinary keybindings routed straight to VS Code's own
  commands, and **Insert mode is 100% native** — it's just VS Code.
- It keeps **no shadow undo tree**. Other extensions maintain a parallel undo
  history that fights VS Code's own, so `u` undoes the wrong thing. ViNEL uses
  VS Code's real undo, so it's always correct.

The result: it's quick even on huge files, your undo history behaves, and there's
**no companion extension, no Neovim install, and no config file required.** A
status-bar badge (**☯ NORMAL · INSERT · VISUAL · V-LINE · V-BLOCK · REPLACE**)
and the block/line cursor always show the mode.

## ✨ Highlights

- **Every mode** — Normal, Insert, Visual (charwise / linewise), **blockwise
  Visual** (`Ctrl-V`) with block-insert `I`/`A`, and Replace.
- **The full operator grammar** — `d` / `c` / `y` over any motion or text object,
  with counts (`3dd`, `2ci"`) and **dot-repeat** (`.`).
- **Text objects** — words, quotes, brackets, **HTML/JSX tags** (`it` / `at`),
  **sentences** (`is` / `as`), and paragraphs.
- **Surround built in** — `ysiw"`, `cs"'`, `ds(`, Visual `S)` (vim-surround), no
  plugin needed.
- **Native macros** — record & replay with a count prefix and a red recording
  badge; never depends on a second extension.
- **Marks, named registers, and Ex-commands** — `:%s/…/…/g`, ranges, `:w`, `:sp`,
  plus find-char (`f`/`t`/`;`/`,`) and search (`/`, `?`, `*`, `#`, `n`/`N`).
- **IDE power under Vim keys** — go-to-definition (`gd`), references (`gr`), hover
  (`K`), folding (`za`…), splits (`Ctrl-W`…), tab switch (`gt`), comment (`gcc`),
  and the jump list (`Ctrl-O` / `Ctrl-I`).
- **The little things** — increment/decrement (`Ctrl-A` / `Ctrl-X`), case
  operators (`gUiw`), `gv`, `ge`/`gE`, `{count}G`, and more.
- **Leader mappings** you script with plain VS Code keybindings — nothing bespoke
  to learn.

## 🚀 Install

Search **"ViNEL"** in the Extensions view (`Cmd/Ctrl+Shift+X`), or
[open it on the Marketplace](https://marketplace.visualstudio.com/items?itemName=andrew-booshartig.vinel).

> ⚠️ **Disable VSCodeVim first** if you have it installed — two modal engines
> fighting over the same keys is unpredictable
> (`code --uninstall-extension vscodevim.vim`).

Then just start editing — press `Esc` to drop into Normal mode. Everything below
is the full reference.

## Why not VSCodeVim or vscode-neovim?

Both are great — ViNEL just makes a different architectural bet.

- **VSCodeVim** emulates Vim by intercepting the `type` command and pushing every
  keystroke through the extension host, then reconciling its own undo tree with
  VS Code's. That's the root of its two most-reported issues: input lag / dropped
  keystrokes on large files, and `u` undoing more (or less) than you meant. ViNEL
  never intercepts typing and keeps no shadow undo, so neither happens.
- **vscode-neovim** embeds a real Neovim process — maximum fidelity, but you have
  to install and manage Neovim, and two editors sharing one buffer can desync.
  ViNEL needs nothing but VS Code.

The trade-off: ViNEL targets **standard Vim behavior mapped onto VS Code's native
features**, not a byte-for-byte port of every obscure Vim quirk. If you want the
common 95% to feel instant and correct with zero setup, that's the bet it makes.

## Controls

Everything here is **count-aware** — prefix a number (`3dd`, `5j`, `2ci"`).

### Modes & entering Insert
| Key | Action |
|-----|--------|
| `Esc` | Return to Normal (cancels a half-typed operator / find / text object) |
| `i` / `a` | Insert before / after the cursor |
| `I` / `A` | Insert at first non-blank / end of line |
| `o` / `O` | Open a line below / above and insert |
| `v` / `V` | Charwise / linewise Visual mode (press again or `Esc` to exit) |
| `gv` | Reselect the last Visual selection |
| `Ctrl-V` | Blockwise (columnar) Visual — see the Blockwise section below |
| `R` | Replace (overtype) mode — typing overwrites; Backspace restores |

### Motions (Normal & Visual)
| Key | Action |
|-----|--------|
| `h` `j` `k` `l` / arrows | Left / down / up / right |
| `w` `b` `e` | Word forward / back / end |
| `W` `B` `E` | WORD (whitespace-delimited) forward / back / end |
| `ge` `gE` | Back to the end of the previous word / WORD |
| `0` `^` `$` | Line start / first non-blank / line end |
| `-` `+` `_` `g_` | First non-blank of prev / next line · first / last non-blank |
| `gg` `G` | Top / bottom of file (`{count}G` → line) |
| `{` `}` | Previous / next paragraph |
| `%` | Matching bracket |
| `H` `M` `L` | Top / middle / bottom of the screen |
| `f{c}` `F{c}` | Jump to next / previous `{c}` on the line |
| `t{c}` `T{c}` | Jump just before / after next / previous `{c}` |
| `;` `,` | Repeat last `f`/`t` forward / reversed |
| `/` `?` | Search forward / backward (VS Code's native Find) |
| `n` `N` | Repeat the search in the same / opposite direction |
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
| `gu{m}` `gU{m}` `g~{m}` | Lower / upper / toggle case over motion `{m}` (`guiw`, `gU$`, `g~j`) |
| `Ctrl-A` `Ctrl-X` | Increment / decrement the number at/after the cursor (`{count}` too) |
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
| `it` `at` | Inner / around an HTML/XML/JSX tag pair |
| `is` `as` | Inner / around a sentence |
| `ip` `ap` | Inner / around paragraph |

Use `a` instead of `i` for the "around" (delimiters-included) form: `ci"`,
`da(`, `yi{`, `vip`, …

### Surround (vim-surround)
| Key | Action |
|-----|--------|
| `ys{motion}{c}` | Surround the motion / text object with `{c}` — `ysiw"`, `ysa(`, `ys$)` |
| `yss{c}` | Surround the whole line |
| `S{c}` (in Visual) | Surround the selection |
| `ds{c}` | Delete the surrounding `{c}` — `ds"`, `ds)`, `dst` (a tag) |
| `cs{old}{new}` | Change surrounding `{old}` → `{new}` — `cs"'`, `cs)]` |

`{c}` is one of `)( b` · `][` · `}{ B` · `>< ` · `"` `'` `` ` `` · `t` (tag). The
"open" variants add inner spaces: `ysiw(` → `( word )`, `ysiw)` → `(word)`.
Tip: `ys` must be followed straight away by a motion/object (as in vim).

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

### Editor & IDE (VS Code's own power, under Vim keys)
These route straight to VS Code's built-in commands, so you get full IDE
features with Vim muscle memory. All are ordinary keybindings you can change —
see [Customizing keybindings](#customizing-keybindings).

| Key | Action |
|-----|--------|
| `Ctrl-O` / `Ctrl-I` | Jump back / forward through navigation history |
| `gd` / `gD` | Go to definition / declaration |
| `gr` | Peek references |
| `K` | Show hover docs |
| `gcc` / `gc` (Visual) | Toggle line comment (current line / selection) |
| `gt` / `gT` | Next / previous editor |
| `Ctrl-W h` `j` `k` `l` | Focus the split left / down / up / right |
| `Ctrl-W s` / `Ctrl-W v` | Split down / right |
| `Ctrl-W q` / `Ctrl-W w` | Close / cycle split |
| `za` `zo` `zc` | Toggle / open / close fold |
| `zR` / `zM` | Open all / close all folds |
| `==` | Re-indent the current line |

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

A **leader mapping** is simple: press a *leader* key, then a short letter
sequence, to run any command — e.g. `Space` then `f` opens the file picker.
It's how Neovim users bind their most-used actions. ViNEL doesn't invent a
mapping language for this; you use **native VS Code chord keybindings** gated to
Normal mode, so they sync with the Keyboard Shortcuts UI like everything else.
`Space` is the conventional leader and ViNEL keeps it free (bare `Space` in
Normal does nothing), but any first key works.

Command Palette (`Cmd/Ctrl+Shift+P`) → *Preferences: Open Keyboard Shortcuts
(JSON)*. Each entry reads as: `"key"` = your leader sequence · `"command"` = what
to run · `"when"` = `vinel.mode == 'normal'` (so it only fires in Normal):

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

### Finding the command to bind
Every action in VS Code has a **command id** — the string you put in
`"command"`. To find one:

1. Open **Keyboard Shortcuts** (`Cmd/Ctrl+K Cmd/Ctrl+S`).
2. Search in plain words — *"save"*, *"find files"*, *"toggle terminal"*,
   *"format document"*, or *"ViNEL"* for ViNEL's own.
3. **Right-click the matching row → Copy Command ID** and paste it as `"command"`.

That's the whole trick — anything you can find in Keyboard Shortcuts, you can put
behind a leader key: built-in commands, other extensions' commands, or ViNEL's
(`vinel.macroPlayLast`, `vinel.exCommand`, …).

- **Change your leader** by swapping the first key (`,`, `\`, …) in each entry.
- **Sequences** are just multi-key chords — `space g g`, pressed in order.
- Your `keybindings.json` outranks ViNEL's defaults, so these take over `Space`
  in Normal automatically (see [Customizing keybindings](#customizing-keybindings)).

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

## Uninstalling & resetting

Uninstalling removes ViNEL and all of its commands and default keybindings
automatically. It contributes **no settings** and writes nothing to disk, so a
reinstall always starts clean — handy if anything ever gets into a weird state.
Your own `keybindings.json` (leader mappings, custom binds) is *your* file and is
left untouched; keep a copy (or track your VS Code config in git) so you can
restore it after a reinstall.

## Not built yet

A few niceties remain: numbered / system-clipboard registers (`"0`, `"+`), the
`(` / `)` sentence *motions*, and treesitter function/class objects (`if`/`af`).
Everything else documented above — modes, motions, operators, text objects,
marks & named registers, Ex-commands, macros, leader mappings, surround, and case
operators — is built and native, with no companion extension required.

## Feedback & bug reports

- **Bugs / feature requests:** open an issue at
  <https://github.com/andrew-booshartig/vinel-vscode/issues>.
- **On the Marketplace:** the extension page's **Q&A** tab and **Ratings &
  Review** section both reach the publisher.
- Please include your OS, VS Code version, and steps to reproduce.

## Support

If ViNEL saves you time, you can support development ☕
**[Buy me a coffee](https://buymeacoffee.com/andrewbooshartig)**
