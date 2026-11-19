# One fixed row and one current card (868)

Tony's Releases11680/11681; Warp11682/11686. This page-only follow-up to854
applies to the existing NotebookSheet in both docked and modal modes.

Only the title, docking, full-page and close glyphs remain outside the page's
scroller. They occupy one row, with an ellipsis on a long title and 40px glyphs
on a desktop. Phone controls retain the existing 44px minimum. Text/Cards,
Draft and the page menu share a wrapping toolbar with Choose dossier; the
save status and deck bar follow inside the same scroll owner as the cards.
The deck bar is no longer sticky. The existing page host remains the scroll
owner, so saved scroll positions and the NotebookPage/writing owner remain.
The save node retains its role=status; recovery words and buttons still wrap.
Keyboard handlers keep their document/sheet scope independently of the bar's
visibility. Opening, switching, docking and closing move the same controls
and editor rather than cloning them or making a second scroll state.

The two-ring cause is DeckPage.mark retaining aria-current on the picked
existing card while paint inserts a fresh deck-writing row after it. Both
selectors have the current-card ring. While writing, mark designates only
the writing row current; the previous picked index remains the navigation
anchor for finishing, Escape and Undo. Finishing an empty new card restores
that existing card as current. Selecting several cards keeps its distinct
selection treatment; this change does not discard selection or saved words.

Checks invoke the actual Command-Return/paint/mark path and count the rows
matching the current styling, including the fresh writing row. They exercise
next-card, empty-card finish, editing an existing card and repaint. Sheet
handler checks assert one fixed row, the same controls/status/picker inside
the active page host, retained status semantics and scroll ownership across
page switches and docking. Source CSS checks hold the no-sticky and single-row
contract. The regression checks fail on143 first. Applied mutations and
restored controls cover the current marker and scroll-owner invariants.

These are handler/source checks, not native gesture, geometry or focus proof.
No browser, preview, full suite, hosted CI, Core or schema change.
