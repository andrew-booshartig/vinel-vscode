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

**The modal engine itself is next** — POWER/EDIT modes ported from the Emacs
source, starting with the basics: mode state, a status-bar indicator, cursor
feedback, and a first batch of key bindings.

## Building

```
npm install
npm run compile
npm run package        # produces a .vsix
code --install-extension ultra-instinct-0.0.1.vsix
```

## Status

Day one. More modal-engine commands to come.
