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
types; codes outside the fixed grammar default to no reason and an unknown busy-shaped exception
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

## Second head: review16184 / Build2

Fable16197 orders this second head before the next preserved1043 step. The
first head d690a696 and its published packet stay immutable. This new own
branch parents that head on the same314 intake; Warp carries and lands it.

Startup must preserve the existing fixed BrokerConfigError reasons
invalid_host_dir and conflicting_codex_executable through run_foreground,
including failures before ownership. No arbitrary code/text becomes trusted.
CLI Health prints the optional safe class/fixed phrase on current paused
runners and the previous paused run, using the same state rule as the page;
old no-fault answers remain readable. Exited runners have no attached fault.

The source-key threshold is an explicit bounded-write default, not measured
from the outage:32 added sources per reader/topic use32 source keys and one
topic key;33 use only the topic key plus the existing bulk clock. Tests cover
both sides. Rename the shadowed message collection and scope the native
fixture directory override to its own imported HTTP module, leaving the
process-global tempfile module intact.

Retain pre-fix assertion failures for the two startup paths and actual
current/prior CLI commands, then run the affected owner checks and the
existing Health/native controls with exact source identities and cleanup.
The retained first-head74-file results remain attributed to that head; new
verification states its own scope. DELETE and the stand-alone restart rule
from Warp16141 remain. No approval/carry/live installation act here.

## Third head: review16493 / Build3

The second head054ced31 and first headd690a696, their freezes and evidence,
stay immutable. This new own branch parents054ced31 on original314. Fable16500
clears the completed1043 handoff boundary; this contract precedes product edits.

Startup reasons use exact trusted exception types, including Core Refusal,
and314's fixed-code grammar `[A-Za-z_]{1,64}`. There is no hand-copied code
list. Actual broker binding changes, Store instance/schema refusals propagated
through ProfileError, and runner-ID Refusal retain their reason before ownership.
Unknown types/subclasses and codes outside that grammar yield no reason. This
trust is scoped to the startup call chain, not input-derived Refusal constructors
in hosted_cli.exchange or pipeline._entry_write, which startup does not call.
Startup remains one-shot; no new retry or arbitrary exception text is admitted.

Storage deadlines and sleeps use the same injected clock as the scheduler.
Production sleep remains time.sleep; controlled fixture sleep advances that clock
and runs scheduled external events without rewinding it. Real SQLite timeout and
OS execution time remain distinct from virtual-time evidence. Existing real
contention tests will assert their exact deterministic inner attempt sequence.
Route pin read contention uses the shared SQLite busy classifier, retaining
failed-close uncertainty. The persisted runner_fault.v1 exception class names
are a fixed tuple, independent of the writer's or reader's Python exception set;
new runtime or dynamic names default to Exception until the contract changes.

The source-add VM assertion compares the absolute increase after4000 duplicate
history rows: at most100 additional instructions. The former relative bound's
behavior on314 is still unobserved at intake; retain that actual measurement
and the tightened test's red before claiming sensitivity. Read-site enumeration,
real startup refusals, clock injection, route pin non-busy lookalikes and record
contract changes get retained red/green evidence. DELETE/EXTRA/fullfsync/FKs,
six-attempt/four-second configured budget,32-source key default and uncertain
mutation no-replay remain. Formal approval still needs actual1021LIVE; Warp
owns standalone landing after1050 and runner restart/Health/rollback observation.
