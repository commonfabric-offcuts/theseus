# Notebook card hover actions (1157)

Tony asks for a card Copy button that becomes a check after copying, and a +
button that adds a child card and opens it for editing. This item changes the
Notebook Cards display only. Its base is release 372, `ab4d0d826`; 1158 title
fences, 1151 Return focus, page-title editing and 1028 remain separate.

## Copy

Each displayed card has a named Copy card text button alongside its existing
controls. Pointer hover, the picked card and keyboard focus reveal it. It uses
the existing card-copy command and plain-text projection: this card's title and
visible words, without hidden metadata, controls or descendants. It does not
allocate a card ID or save the page. Read-only pages may copy.

The glyph becomes a check only after the clipboard reports success. A refused
copy keeps the Copy glyph and the existing actionable copy error. A pending
click cannot start a second copy. A late result cannot update a closed page or
an old, replaced button. The check lasts until that row is redrawn; no timer
changes the card's geometry. Pointer copying keeps writing and text selection.

## Add child

The named Add child card button shows +. It opens the existing fresh-card
editor at the parent's depth plus one, after its existing descendants and
before its next peer. The parent is unfolded locally so the editor is visible.
Typing uses the existing NotebookWriting add/edit and Undo path. An empty new
editor is not a new durable card. Existing unfinished writing is finished
through its current owner before the new editor opens.

The handler re-resolves the card reference and current write authority when
pressed. Read-only, unavailable, deleted, closed, pending page actions/conflicts and
the existing deepest card depth cannot add. A depth-four card has a disabled
Add child button with an explanatory name. The new controls do not become
card text, consume a card-body click, or replace the existing menu/stack links.

## Evidence and limits

Prepare bounded unit checks for the actual rendered controls, plain-text copy,
success/refusal/late completion, child placement and write/depth guards. Keep a
real missing-control red before applying the pinned product body, then the
same assertions on the candidate. Existing card-menu and Notebook key cases
remain unchanged.

One separately routed Chromium cell must use native pointer/keyboard input,
observe actual clipboard text, add and write the child through isolated HTTP
and Core, confirm its depth/order, and retain cleanup and source/runtime pins.
Unit handler checks do not establish native focus, hover geometry or timing.
No test, fixture or browser run is authorized by this source contract.

1157 is expected to be web-only with no schema or guarded-tool change. Each
actual changed-path map establishes that classification. Compose separately
with 1028's retained `notebook-page.mjs` change against the then-current base;
1028's own colour migration 69→70 is not part of this item.
