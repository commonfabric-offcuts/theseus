# Expanded outcome unread badge (1164)

Owner page-lane6, existing Build1 `p-312ef27c02a948e481cddef5`, topic
`t-e22e58935e9846019e68fa9b67643837`. Fable21259 resumes source preparation
from release382 `75ee1639a1eddbdacf5eaa1d76d314cc1bcd3559` in a new own
worktree and branch, preserving1162 and parked1028.

An expanded outcome shows no outcome-level unread badge, including when its
Build topics have unread messages. Its accessible name has no residual unread
count or Build-count wording. Folding restores the latest sanitized outcome
unread/addressed total. Expansion, asynchronous Topic loading, live count
refreshes and repeated paints use the existing OutlineRail owners; they do not
mark anything read, navigate, replace Topic owners or reset selection.

Topic and dossier unread marks, the outcome's standing/light, New/Waiting
filters and totals, and the right rail's Build counts keep their existing
owners. The phone's Pipeline & pages header still carries the Build count.
This is a page-only change with no Core, data or schema step.

The changed owner is `web/outline-rail.mjs`: `rowCount`, `paint`, `setOpen`
and `setAll`. Badge nodes and accessible words are painted by the existing
`paintUnread` in `web/topic-navigation.mjs`. Meaningful modeled checks run
the real outcome construction, paint, disclosure and Topic-row owners with
bounded DOM, transport and unrelated projection ports. They cover initial
expansion, folded/expanded transitions, pending Topic reads, count refreshes,
repeated paints, all-open/all-fold, phone/desktop and adjacent counts. A
deliberate restoration of the old open Build-count branch must produce the
named badge failures before restored green; unrelated controls stay intact.
These checks do not prove native gestures, layout, timing or actual Core read
mutations. Ordinary-page browser disposition follows Warp20514; no browser
entry is proposed here.

Steward21305 identifies contradictory expanded badge/spoken-count oracles in
`tests/outline_empty_945_native.mjs` and `tests/outcome_rail_native.mjs`.
Their narrow source correction aligns those expectations and descriptions
with1164, retaining positive Build facts and existing folded-total, child,
header/right-rail and navigation controls. These two files are explicitly
unexecuted source corrections under the existing browser disposition; broader
pre-existing native-harness staleness is outside this correction. The modeled
12/119 selection and its expected11-badge-failure red are unchanged.

Preparation has actual0/current allowance0 tests, helpers, fixtures and
browsers. Before any child: concrete source/runtime/input pins, complete finite
registration inventory, exact caller/argv/exclusive outputs/bounds, cumulative
ledger, independent coverage/caller read and Fable's exact grant. Fresh entry
uses Warp20874's up-to-three lane entries on18 cores below load12 and observes
any whole-node landing hold. Fable owns stages and carry; Warp owns independent
read and landing. Page6queue1164→1165→1161→1160 remains;1028 waits until the
queued non-database work is live.
