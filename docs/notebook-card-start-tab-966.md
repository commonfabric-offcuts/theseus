# Tab at the start of a Notebook card (966)

In Cards, Tab with the caret collapsed at the very first text position
indents the card under its preceding card. Shift-Tab outdents it one level.
This includes the empty new card opened by Command-Return. A first card
cannot indent and a top-level card cannot outdent; those keys keep the box's
focus and words. A selection starting at zero is not a collapsed caret.

1058 also gives Shift-Tab at the collapsed very last text position the same
card outdent, retaining the editor and exact words/caret. Elsewhere in the
text, including nonempty selections, WritingInput keeps its line indentation.
Command, Control and Option modifiers, composition (including keyCode 229),
handled events and other fields retain their current routes. Read-only page,
field and writing owners cannot move a card. No pane or arrow routing changes.

DeckPage uses its existing moveWriting owner: placeNew retains the placement
of an unfinished fresh box; saved cards use the existing act, save and undo
path. Full page, sheet and dock share it. No Core command or schema change.

Checks retain the actual released266 failure, handler boundaries and line
controls, plus native Command-Return/Tab, saved-card moves, persistence,
focus and cleanup against isolated scratch Core/HTTP data. Native desktop
WebKit at phone width does not establish physical-phone behavior.
