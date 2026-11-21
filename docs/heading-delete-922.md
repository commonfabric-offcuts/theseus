# Heading deletion in Text (922)

Deleting a lower card's heading merges its metadata into the surviving card
when that heading ceases to be a card boundary. This includes selecting only
the heading, leaving its line break, and Backspace through its characters.
Deleting title characters while a valid heading remains is still a rename.

Use the existing Cards merge contract: keep the survivor's primary identity
and color (including null), add the lower identities as aliases, and put one
hidden line last in the survivor. Preserve the exact visible edit, following
cards, and existing fence handling. Deleting an entire card removes its
identity instead of creating an alias. Text Undo/Redo restores exact raw
snapshots, including line endings and the intermediate single-key states.

Five retained 867 expectations described deleting the entire heading and
then manually retyping it as a rename that recovered the old lower identity
and color. Those were relying on the two-line representation corrected by
922. They now assert the existing merge/reinsertion rule in `docs/decks.md`:
the lower identity remains an alias on the survivor, and the newly typed
heading has no identity or color. The four cases are in `ui_card_menu_867`
(the two replacement headings, with and without upper words); the fifth is
`ui_card_text_r4_confirm_867` R4-C5, including a save during retyping. All
actions and persistence checks remain; no failure is skipped. Exact Undo and
Redo of every original single-key snapshot are checked separately.

The regression checks drive CardTextProjection and the real NotebookPage
input/history handlers with memory writing ports. They do not claim native
keyboard or browser behavior.
