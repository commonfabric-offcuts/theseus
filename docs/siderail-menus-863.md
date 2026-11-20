# Outcome and dossier menus

The outcome title and its left-rail row consume `outcomeMenuItems`.
The dossier title, message and Reader menus, and the starred-dossier row
consume the existing shared message list and `stackMenuItems`. Right-click,
Context Menu/Shift-F10, and a stationary phone hold open these menus. Taps,
scrolling, links, selected text and writing keep their existing behavior.
No menu is added to the right-rail section headers.

Opening a rail menu leaves the current page and address alone. It reads the
named outcome, or one named message through `topic_messages(message_ids)`.
The latter includes Core's dossier identity, positions and revision fences.
A late read cannot reopen a dismissed menu or follow a reused row, a retired
page or lost access. Unknown feed-dependent choices are offered and checked
again by the destination owner.

Complete/Archive/Bring back use `sendEnd`; outcome ordering uses the existing
outline owner. Dossier star/fold/archive commands use the same revision
envelope as `StackFeed`, and marks use `Marks`. They run against the named
record without navigating. Unconfirmed command results retain their exact
operation for another explicit choice; refusals are said in words. Commands
cannot report success into a different page run.

Unstar on a dossier head removes the reader's stars from every member of
that dossier. This applies even when only a reply was starred. Named member
reads are capped at 100, validate current dossier membership, and send each
member's `message.star` through its existing revision owner. Reply menus
retain their individual toggle. Star for me on an unstarred head stars its
first message. Archive still refuses a dossier held by a star.

Rename and other UI-only choices travel through the ordinary guarded route
with an address act; Onboarding does the same on an outcome. Arrival clears
the act with `history.replaceState` before opening UI and rechecks current
eligibility. Reload cannot replay it. An address never runs a record-changing
command: feed-dependent move/join/undo choices instead open the exact dossier
menu with that choice focused. Only a new explicit press changes the record.
Outcome navigation remains a document load; no continuation store is added.

Checks are in `tests/ui_siderail_menus_863.test.mjs`,
`tests/ui_message_menus_861.test.mjs`, and `tests/ui_message_menu.test.mjs`.
They exercise actual rendered headers and rail rows, descriptor owners,
guarded routes, one-time address consumption, stale reads and commands,
revision fences, retries and focus. These are DOM/handler and owner checks;
they do not claim native browser gestures, layout or phone evidence.
