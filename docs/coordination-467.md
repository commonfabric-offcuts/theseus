# Agent coordination for this tab (467)

The shipped default is **Off**. Only an explicit press changes the remembered
choice. It belongs to this instance and reader in the current tab's session,
survives a reload or a topic visit in that tab, and is not a Core preference.
A new tab or device starts Off. A link reveals only its target dossier for
that visit; it does not press the pill or save On. An explicit flip clears
those temporary reveals.

The pill shares the row below the composer with Archived: Archived on the
left when it has dossiers to show, coordination on the right whenever any
loaded coordination exists. The pill counts coordination dossiers. Under
Warp's corrected ruling11450, Archived keeps its existing count of dossiers
it would show: archived coordination counts only while coordination is On.
Archived still opens those archived dossiers; the pill does not open it.
When On, coordination retains its existing interleaved position. Moving all
coordination below the row is excluded by11437.

New agent replies update the count and news colour without changing the
choice. News uses the feed's existing unread/visit-new predicate, including
a new reply inside a dossier whose count has not changed. Human- or
room-directed replies keep the existing classification rule and can make a
dossier ordinary. No grouping, order, saved placement, unread or delivery
record is changed by these controls.

The tab choice uses sessionStorage, scoped by instance, reader and a random
tab nonce. The nonce is appended to the browsing context's name on the first
explicit flip, retaining any existing name prefix. This avoids inheriting On
from a copy of the opener's sessionStorage in a new window. A reload uses the
same context name and storage. No nonce or preference is written by a link.
If storage cannot save, the visit still responds; the module attempts to
remove only its own stale key so a reload defaults Off. No broad storage
clear, localStorage, database write, new Core command or schema change.

Links retain their revealed message IDs in the feed's visit state, so a
dossier reheading does not transfer the reveal to unrelated coordination.
CSS and the keyboard's shown-view policy both honor the target reveal. The
shared control row is also the boundary used by the New line. Left/right
move between its buttons; vertical navigation can leave the row even when
the feed has no visible messages.

## Evidence and limits

Eight checks in `ui_coordination_467` exercise the actual StackFeed and
dossier renderer, tab reload/new-tab storage objects, links, archived links,
arrival updates and human-directed replies, Archive count/open state, the
New line, storage failure, and the shared-row keyboard handler. The original
four failed against untouched133 at their intended assertions. Fixture
rectangles and direct handler calls are not native input or layout evidence.

The existing composer-placement check now recognizes the shared row rather
than a standalone Archive button, and asserts that it contains Archived (1).
Existing focused families are compared against the exact live133 tree.
The eight existing families pass324/324 on live. With the eight new checks,
the final nine-family candidate passes332/332, zero failures or skips. The
families cover coordination classification, stack order/position, Archive601,
the New line, rails, actual app wiring, arrow reach, and467. Seven applied
source mutations break the default, persistence, opener-copy isolation,
target-only reveal, arrival news, hidden Archive count, and New-line boundary;
each fails an assertion and restores byte-exact source with8/8 passing.
Raw results and hashes are in `fable-tools/coordinator-20261117/467-build11431`.
No preview, browser, screenshot, native suite, full suite or CI claim;
this follows11437/11450 and today's Ship now path.
