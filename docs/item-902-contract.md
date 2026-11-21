# Outcome disclosure in the outline (902)

Each outline outcome has a separate disclosure chevron before its name. The
button is in the Tab order, names the outcome and exposes `aria-expanded` and
`aria-controls`. It opens or folds that outcome's existing topic list in place,
without navigation or reading the outcome page. It uses the existing topic,
Conversation and starred-child list owners; no second topic cache or read owner.
Several outcomes can stay open together.

The outline's existing `Opened` owner keeps explicit per-outcome booleans in
localStorage, keyed by the reader and instance on this device. A missing or
invalid preference starts folded except for the current outcome. If storage is
unavailable, choices still hold in this page. Arriving at any topic or outcome
opens its current outcome without folding another. A fold made while reading
the current outcome holds until the next arrival opens it again.

Outcome names navigate to their existing outcome-home target. On a phone
(at most 760 CSS pixels), the first pointer tap on a folded name still opens
the topics without moving or closing the drawer; the next navigates. Return on
the name navigates. The disclosure only changes expansion, including on phones.

The existing tree owns its arrows, Command arrows and Shift-Command arrows.
Right opens and Left folds; Command-Right/Left open/fold; Shift-Command-Right/Left
open/fold the known outcomes. Those choices are kept individually; outcomes
first encountered later use the new-outcome folded default. New/Waiting chips
temporarily open every outcome they show without overwriting remembered folds.
Leaving the filter restores those choices. The chevrons supplement the tree's
roving Tab stop; they do not turn outcome names into toggle-only controls.

Checks will instantiate the real outline and tree with in-memory DOM, storage
and bounded read adapters. They will cover two simultaneous opens; disclosure
activation without navigation/outcome-page reads; exact current-arrival and
reload restoration; reader/instance isolation; malformed/unavailable storage;
name and phone behavior; filter projection; existing keys; and the button's
DOM position, Tab eligibility and expanded state. Applied product faults must
fail meaningful assertions and be restored byte-exactly before controls.

This source-only preparation has run no tests. Red-on-release177, candidate
controls, mutations and dependency measurements require a separate runtime
grant. Handler fixtures do not prove native Tab, pointer, touch, layout or
screen-reader behavior. No Core policy/state, across-device dossier state
(858), or pending 905/891 source is included.
