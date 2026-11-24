# Card editing keys at the text boundary (1156)

Tony's source is Backlog 20204, routed as item A by Warp 20208. Fable 21039
assigns source preparation on release 380, commit
`77c9237b7b81140126ae769f3e13f066d1adb71b`, schema 69. This is page work over
existing card placement and Notebook writing facts; no database change is needed.

## Interaction

A boundary is a collapsed textarea selection with both offsets exactly zero
or exactly `field.value.length`. These are offsets in the actual editable
title-and-body string, including whitespace, newlines and Unicode text, not
the start/end of a displayed line or a trimmed/rendered version. An empty
editor is at both boundaries. A nonempty selection touching either end is
still a selection, not a boundary caret.

With the card's own editor targeted, at either boundary:

| Key | Card operation |
| --- | --- |
| Tab without Command, Control or Option | Indent under the preceding sibling, taking its children. |
| Shift-Tab without Command, Control or Option | Outdent after the parent's child group, taking its children. |
| Command-Up / Command-Down | Move past the preceding/following sibling with its children. |

These use the same placement rules as Display mode. Editing stays open with
the same field, exact draft, caret and edit history. A blocked placement
(including the first card, a top-level outdent or the depth limit) retains
the writing and focus, as existing editing boundaries do. It does not fall
through to line indentation or make an empty card. Permission and unavailable
writing retain their existing refusal/retention owners.

Interior Tab/Shift-Tab and nonempty selections keep the current two-space line
indentation/outdent behavior, selection mapping and Undo/Redo. Existing
interior Command-Up/Down card moves remain available; this item does not
restrict that established shortcut. The existing Control-arrow counterpart,
modifier exclusions, consumed-key handling, IME `isComposing` / keyCode 229
guards, foreign-field and hidden-page guards remain in place. Shift-Command
arrows do not acquire a merge shortcut inside the editor. Plain arrows,
Option line moves, Return, quote/split commands and the Text view keep their
current owners.

## Existing owners and intended change

`DeckPage.key` already routes Tab/Shift-Tab at the start and Shift-Tab at the
end to `moveWriting`; Command-Up/Down already use `moveWriting` at either
end and in the interior. The missing route is plain Tab at the end, which
currently reaches `WritingInput.indentKey` and inserts spaces into the line.
Extend the collapsed end predicate for plain Tab and update its key hint and
the description in `docs/decks.md`.

Keep `DeckPage.moveWriting`, `applyAct` / `placeNew` in `deck.mjs`, and
`NotebookPage.moveWriting` / `save` as the placement and persistence owners.
Existing cards move through the normal card act; fresh editors use the same
placement model without fabricating a saved blank card. Retain the current
paint/refocus, `NotebookEditHistory`, `WritingInput` and Notebook caret reveal
owners. No new command, schema, storage representation or selection model is
proposed.

## Evidence to prepare after Build binding

Add a focused check that fails on the unchanged base when plain Tab at the
actual text end indents the line instead of the card. Check real key/act/save
owners for both boundaries and all four shortcuts; card and child order,
blocked moves, fresh/changed drafts, exact editor/selection retention,
interior/selected line behavior and input guards. Use existing boundary,
line-key, edit-history, Return-focus and caret controls where their actual
case bodies cover the changed path. Name the final cases, runtime inputs,
argv, caller, bounds and cumulative ledger before requesting execution.

Source preparation has started no test, helper, fixture or browser process.
The ordinary-page browser disposition in Fable 21039 applies: no browser entry
is proposed. Handler/DOM checks will not be described as native gestures,
physical-device evidence or durable Core proof. The shared guarded-run R3
tool is not a product dependency and has not been installed or adopted here.
