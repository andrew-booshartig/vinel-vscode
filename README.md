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
`ultraInstinct.smartTab` / `ultraInstinct.smartShiftTab`, which check whether
the cursor is actually next to one of tabout's configured special characters
(bracket/quote/etc.) before deciding: adjacent → tab out; not adjacent →
normal snippet-tabstop navigation. No guessing block boundaries from
comments/blank lines — just "what's the character right next to the cursor."

Priority, always:
1. In a snippet, next to a bracket/quote → tab **out** of it
2. In a snippet, not next to one → tabstop-to-tabstop, as normal
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
