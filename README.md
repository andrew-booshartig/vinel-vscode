# Ultra Instinct

A ground-up modal editing engine for VSCode. Not a Vim emulation — vim
emulations always end up fighting VSCode's own engine at the edges (snippets,
suggestions, brackets). This is meant to feel native.

Ported from a heavily custom Emacs modal setup (POWER/EDIT modes). Started
small: the first real command fixes a concrete, verifiable bug in how the
popular `tabout` extension interacts with snippet tabstops.

## What's here so far

**Smart Tab.** `tabout`'s own default keybinding only checks
`!suggestWidgetVisible` — it doesn't exclude `inSnippetMode`. So while you're
on a snippet tabstop and the completion dropdown just isn't open at that
instant (common — punctuation fields, the first keystroke before suggestions
populate), both "jump to next tabstop" and "tabout" become eligible for Tab,
and tabout tends to win, yanking you out of the snippet.

This extension unbinds tabout's unqualified defaults and replaces them with
`ultraInstinct.smartTab` / `ultraInstinct.smartShiftTab` — scoped **strictly**
to the `pf` snippet (Quick F-String Print, `print(f"$1")$0`), and **strictly**
to the moment the cursor sits right before a `}`. Every other snippet, and
this one everywhere else, gets 100% default VSCode behavior — untouched.

There's no VSCode API for "which named snippet is active," so this checks the
literal text shape only `pf` produces (the current line reads `print(f"...`
up to the cursor, string not yet closed) instead of guessing from bracket
type alone — an earlier version keyed off "any bracket/quote in any snippet"
and wrongly hijacked Tab in `dict`/`set`/`gd` too, which also have literal
`{`/`"` in their bodies. Scoped tight on purpose.

Priority, always:
1. In the `pf` snippet, cursor right before a `}` → tab **out** of it
2. Any other snippet, or `pf` not next to a `}` → tabstop-to-tabstop, as normal
3. Not in a snippet → tabout's own default behavior, untouched
4. Dropdown open → Tab never accepts a suggestion; only Enter does

## Building

```
npm install
npm run compile
npm run package        # produces a .vsix
code --install-extension ultra-instinct-0.0.1.vsix
```

## Status

Day one. More modal-engine commands to come.
