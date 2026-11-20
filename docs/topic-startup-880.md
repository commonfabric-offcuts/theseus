# Topic startup reads (880, 886)

Once the topic is confirmed, all independent startup reads begin together:
workspace, wake state, outcome members, the initial message page, memory page
and recovery journal. The join also includes the existing color read, which
still starts before the topic; there is no duplicate color load. Their join
at the first answer use keeps a refused list/journal from waiting on a held
optional read. Workspace, wakes, members and colors retain their existing
nonfatal fallback behavior. No late workspace/member answer paints topic content after that
join has failed; the shared wake-status owner retains its own status painting.

The message query remains newest 30 (`audience: all`, `direction: before`)
and memory remains 20 for the topic's existing scope. Every checkedView and
instance check remains. The existing feed and actor baselines precede these
list reads. No editor or clickable source is created until both list bodies
arrive; the required startup promises must succeed before the normal startup
continuation adopts the journal and wires the page. Color failure retains
its existing nonfatal fallback.

A refused list or journal still refuses startup. A journal opened for a
failed join is closed even if it arrives later, without touching a newer
attempt's journal. No new durable state, owner or query is introduced.

Checks use the actual page initialization and rendering with in-memory
transport/journal substitutes: held reads, every completion order, unchanged
bounds and identities, refusal and late cleanup. They establish ordering and
fences, not a measured production speedup or native browser click behavior.

Item 886 also batches missing dossier heads in `DossierHeads`: one request for
up to 100 wanted IDs, one background request in flight and one repaint per
completed batch. A larger set takes serial chunks. A Core-refused batch falls
back to one request per still-wanted head, serially, retaining individual
available/refused/missing/error states and repainting the completed result
once. A transport or malformed-response error does not fan out. Both queued
reads and returned rows check the existing current-visit and exact-record
identity guards; invalidated, already loaded or retired heads never repaint.
Fetched heads remain presentation-only and do not alter loaded runs or paging
frontiers. Checks establish these request/repaint counts, not browser timing.

A named-head answer can stop at Core's 131072-byte summary limit even when
fewer than 100 IDs were requested. When `next_cursor` is non-null, omitted
IDs stay loading and are read again as a smaller named-ID batch, without a
cursor (Core forbids mixing named IDs and page arguments). Only an omission
from a complete answer becomes missing. Each continuation rechecks visit and
record identity and shares the same serial background lane; one repaint
settles the original batch. An incomplete answer making no progress becomes
an error, never a missing head or an unbounded retry.

The Landing-shaped in-memory opening check (Warp 12147) uses 30 replies in four
unloaded dossiers and observes the actual app paintViews and full StackFeed
arrangements. The first paint is followed by one full arrangement for the
batched heads; marks and thumbnail completion add none. Separate, explicit
freshness probes preserve existing behavior: unchanged data adds none, changed
cover positions add one, and combined changed acts/positions add two (each
owner completion paints acts). That last result is a separate finding, not a
change made by 886 or evidence that those updates occurred on Tony's screen.
The fixture drives freshness deterministically; no browser timing is claimed.
