# Notebook colours, item 1028

Intake: release 314, head `99bbe6a776d41c15f3fadba33de1f359214220f9`,
tree `a1648b6bcd46c63f0b107fecd7160d131231ccc8`. This work starts in
`page-lane5/1028-notebook-colours-314`, separately from the frozen 1036 and
1039 branches. Fable's current assignment is 15829, piece
`p-89a0ba1a36a64e91be3bc83b`, medium, Build round 1.

The approved palette is the designer's public
[spec](http://100.85.219.84:5195/designer/card-colours/#spec) and
[stylesheet](http://100.85.219.84:5195/designer/card-colours/card-colours.css),
read at intake. The stylesheet SHA256 is
`3995a06ac0b8a2d44e788a164b6013068c0015c59e22d7e01083a2c5af480fcf`.
Soft in Bookends and Faint in Paper are the named defaults in both appearances.
Each of the eight existing palette names has a fill, edge and hover/current
fill. Paper's coloured cards are soft blocks. The picker shows those same
colours. Quiet/Vivid stays the agent preference.

## Kept page fact

Source inspection finds no kept page colour in `memory_items`,
`memory_revisions`, `memory_current` or `NotebookWriting`. The existing
`theseus-card` marker is an individual card's colour, not a page choice.
This is therefore a **judged change**, including a schema change.

Add nullable `color` to each immutable Notebook revision. Its value is one of
Core's existing eight palette names, or null for No color. `memory.create`
and `memory.revise` accept it as an optional content field: omission creates
an uncoloured page or preserves the preceding colour; explicit null clears
it. An invalid name/type is refused. The existing writer/access/Draft/deleted
page rules, authority fence, expected item revision and operation identity
apply. Delete/restore copies the colour into its new revision. Exact old
revisions keep their old colours. Current, source, list and status reads
carry the kept colour; no browser preference becomes record authority.

The migration starts from actual schema 65, with null for existing revisions.
An occupied downgrade refuses while any historical revision has a colour.
The candidate migration number must be reconciled at carry with 1021's
separate 65-to-66 candidate; this contract reserves no shared schema number.

`NotebookWriting` includes colour in its existing content comparison,
three-way merge, recovery journal and frozen `memory.revise` envelope.
Old device copies without the field read as null; old uncertain envelopes
remain byte-for-byte unchanged. A pending choice is drawn as pending, a
receipt settles only the request it names, and later colour/word edits survive
late responses. Independent colour and word edits merge; competing colour
edits use the existing conflict choice. Refused or unknown saves retain the
device copy and existing recovery controls without claiming a Core save.

## Menus and drawing

The existing This page menu gets Set color, using the shared colour picker
and No color. It remains one menu owner on full and sheet pages. The outcome
Notebook thumbnail gets the same appropriate page descriptors through its
secondary-click/keyboard menu; merely opening that menu does not write or
open a writer. Choosing Set color opens the existing page writer/picker,
with current access checked again. The right-rail page row and the thumbnail
draw the page's own kept colour. A page shown as Cards is the same kept page
as Text; changing the view changes no colour or revision. Separate page IDs
and individual card colours remain independent.

The designer settled the additional per-page rule in Warp's verbatim relay
15856 (`m-97eb6085ff47441abec3b3aeaa3da621`): the page hue goes on the Text
writing block and otherwise uncoloured cards, never an outer page wash or
frame. Explicit individual-card colours override it. The page host carries
`agent-<name>`, inheriting the same three variables; a coloured card resets
them locally. Hover/current uses the specified hover fill. In Paper the
blocks keep the specified .4rem radius and .2rem block margin. The thumbnail
and right-rail row take the same fill and hairline. Extend the palette's
container scope for surfaces outside the sheet/rail, without copying the
palette or changing agent colours. No color removes the page class and
restores its material while preserving each individual card's colour.

1021 also changes the outcome page. Its frozen fifth source is
`8c3b499807ee9e3a3f37f405c92d520614a128c2`; comparison against this intake
finds no change in `web/outcome-references.mjs`, the thumbnail owner. Keep new
app wiring narrow and preserve the separate 1021 owners; do not modify or
relabel its branch or evidence. Preserve Notebook editing,
selection, save, menu, image and navigation owners.

## Evidence to retain

Before product edits, retain actual Core/client reds for the absent page
fact and menu door, and native computed-colour/thumbnail-door reds on the
intake source. The first two do not substitute for native visibility proof.
Then retain Core migration/history/access/CAS/retry/clear and client recovery,
conflict and later-intent checks, plus native menu/pointer/keyboard/focus,
reload, page/stack/card independence and clear checks. Exercise both looks
and appearances on laptop and phone in isolated Chrome for Testing and the
installed WebKit. Emulation makes no claim about physical Safari.

Every phase names exact product, producer and served hashes. Apply meaningful
writer/routing faults and restore byte-for-byte. Compare the scoped base/head
full inherited diagnostics, preserving actual failures. One own workload at
a time, load below the current limit, with Browser.close/disconnected/PID,
profile, fixture EOF/exit/absence, empty-error and closed-port receipts.
Freeze only after meaningful checks pass; push the exact source branch and
give Fable/Warp the head/tree/base/manifest and retained packet. Fable owns
canonical stages and Warp independent approval/carry/landing.

Initial pre-edit execution on the intake product, with only this contract and
new checks added: four Core checks fail (missing field, valid colour refused),
and three client checks fail (missing menu door, colour ignored in content
comparison and read). Actual logs and the producer/product hashes are retained
in `artifacts/1028-build/pre-edit/`. No native colour/thumbnail result has been
claimed and no product file has been changed at this point.
