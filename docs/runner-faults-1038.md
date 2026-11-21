# Runner faults and contention (1038)

Fresh Fable15840 delegation, piece p-cfb7a041af6f44b8815f756a. Intake is
live314,99bbe6a776d41c15f3fadba33de1f359214220f9. This contract precedes
product edits.1041 remains immutable at da5fd466d1af.

The runner retries only an exact recognized Core DATABASE_BUSY refusal whose
rollback/close completed and which confirms no committed mutation. At most six attempts
at the existing250ms SQLite busy timeout, with100/200/400/800/1000ms backoffs,
provide a4.0s configured contention wait budget; a monotonic4s deadline also
prevents starting another retry after that budget. Operation execution, cleanup
and OS scheduling are not claimed to have a hard real-time bound. Existing
preclaim lease-aware scheduling remains the owner after a busy call exhausts;
postclaim and pause-write exhaustion faults with its safe cause. Unknown errors,
failed rollback/close and possible committed mutations are never replayed.
SQLite primary busy/locked codes identify contention; CPython3.9 uses canonical
SQLite messages when those numeric attributes are absent. An unrelated missing
table with busy or locked in its name is still a non-busy fault.

Every exception-driven runner pause keeps the originating exception class and a
bounded safe diagnostic in emitted/result fault fields and in the Core pause transaction.
Messages are selected from fixed diagnostic phrases, never
arbitrary exception prefixes. Unknown text is withheld. A code-unknown/dynamic
exception class name is generalized to Exception rather
than admitting a possible secret as a class name. Original cause and a
pause-write failure are separately named. If the database remains unwritable
after the bounded pause attempt, pause_unsaved/fatal_unsaved retain both causes
in the normal process output; no successful Core persistence is claimed and no
file shadow authority is introduced. Health shows the safe kept cause alongside
the pause reason, and the previous run retains its cause on resume/acquisition.
Pause versions, ownership, guard/child cleanup and operator resume rules stay.
Startup failures before ownership return the safe fault without inventing a
Core pause. Their reason admits only fixed codes from exact known exception
types; unknown codes default to no reason and an unknown busy-shaped exception
does not authorize retry. A later cleanup exception returns a separate cleanup_fault and
preserves the original cause and actual pause_saved value; it cannot promise a
new Core write after ownership/cleanup is uncertain. Startup profile/route
validation retains its one-shot typed refusal policy; this does not replay a
whole adapter or an external effect whose outcome could be uncertain.

Core stores the optional structured fault with the current/previous runner in
namespaced metadata, in the same transaction as the existing runner record;
the existing guard generation's hash fences its owner, including after an
older-code reacquisition. No guard/token/path is copied into the diagnostic.
There is no schema-layout migration. This IS a new kept diagnostic fact and a
Health view shape addition: Fable classifies the final source accordingly,
including any judged/runtime boundary. No installation/restart/live replay here.

source_add notifies only the message sources actually added, independent of the
item's prior source history. Its256-source command limit stays. Incoming IDs
drive indexed existence checks, rather than walking duplicate historical links.
Within an
affected reader/topic, at most32 per-source freshness keys plus one coalesced
topic key are written; larger groups use the existing opaque bulk topic clock
instead of per-source keys. That coarsens freshness within the affected
reader/topic and may refresh other dossiers there. Required reader/topic notifications still scale
with the readers/topics actually affected; there is no constant bound on audience
size. Source relations, take facts, item revision and invalidation commit
atomically. No deferred partial mutation or new notification queue is added.
Private/addressed-only readers and source/destination access remain enforced.

The409-row observation is not a measured lock duration or a proven cause of
either outage. DELETE/EXTRA/fullfsync/foreign_keys remain unchanged. WAL remains
an explicit Core decision for Warp; this proposal does not enable it.

Tests use scratch Core authorities only: actual pre-edit contention/fault/fanout
reds, short contention recovery and exhaustion, ambiguous commit/cleanup refusal,
safe-message adversarial cases, retained current/prior Health detail and exact
source-add facts/notification coverage. Below-browser owners and paired affected
cohorts precede isolated native Health presentation if needed. Applied routing/
recovery removals must fail, then restore exact bytes with fresh Python caches.
One own workload/load<=12 on18cores; strict cleanup for owned fixtures/browsers.
