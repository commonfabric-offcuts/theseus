# Landing on the first message (875)

A full landing on a dossier's first message shows that message whole without
opening its earlier-messages row. The starred-dossier rail, returning from a
cover request to its parent, and a restored full landing use the existing
landing and reveal owners.

For fourteen messages, the first message and newest seven are visible; the
row says **6 earlier replies**. Its count, new count, tooltip and first target
include only those hidden replies. When the first message is the only earlier
message, no empty row remains. The seven-message boundary is still held while
new messages arrive.

A deliberate landing on an earlier reply still opens the row and shows that
reply whole. Pressing the row still opens it. A full first-message landing does
not close a row the person already opened. Changing dossier level resets this
visit's full-message choice, as before. Saved folds and stars are unchanged.

`reveal` keeps `whole` separately from `earlier`; `paintStack` honors the first
message's whole choice, and `rowsOf` omits that visible head from the earlier
row. There is no Core, storage, navigation, or cover-request change.

`tests/ui_first_message_landing_875.test.mjs` exercises the real renderer,
starred rail handler and existing app landing functions with the small DOM.
These are source and handler checks, not native gestures, focus or geometry.
