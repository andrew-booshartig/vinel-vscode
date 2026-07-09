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

Marks (`m` / `` ` `` / `'`), named registers (`"a`), Ex-commands (`:`, `:%s/`),
blockwise Visual (`Ctrl-V`), Replace mode (`R`), macros, and tag/sentence text
objects (`it`/`at`, `is`/`as`). User-scriptable leader mappings are planned as
a companion.
