# Piece clocks and forecasts (1199)

Core owns these facts, independently of1198 policy/action context,1180 wake
reconciliation and1200 browser jobs. No migration, scheduler or shipping gate
is added. Metadata keys are versioned and read by exact key. Every write uses
the normal authenticated operation transaction and expected `clock_revision`;
its complete result remains in the immutable operation outcome. Reassignment,
forecast revisions and activity history are retained, never replaced by prose.

## Commands and reads

`pipeline.clock_record`, target `{piece_id}`, expected `{clock_revision}`,
accepts one event. The owner/coordinator alone binds a lane; subsequent events
are written by that authenticated lane or the owner/coordinator. A missing lane
is absent, never inferred from a topic creator. Each event names a public,
readable source message and its revision in the same outcome. No source body
or private words are copied into clock records.
Writes refuse a stale or invented source revision; retained events keep the
revision actually validated when they were recorded.

Events: `lane` (actor and work class page/core/database), `segment` (source or
resume start), `forecast` (stable ID, push/live milestone, build/segment/freeze
anchor, deadline), `revise` (same ID, new deadline and reason), `interval`
(writing/wait/test/repair/command, actual start/end, physical attempt and
terminal), `push` (full head, occurrence time and structured receipt),
`notice_link` (a previously communicated slip/withdrawal) and `release`
(coordinator reconciliation of an actual immutable release number).

`pipeline.piece_start` optionally accepts `clock` with the authenticated lane,
public assignment source and initial forecasts. Only these forecasts are
recorded atomically at first Build and eligible as an original Build-entry
live prediction. A forecast recorded afterwards stays later even when it
names the Build anchor or reports an earlier time. A lane estimate quoted by
the coordinator must have a source authored by that lane. No estimate means
`no estimate yet`; no live prediction at Build means unavailable and unscored.

`pipeline_clock {piece_id}` gives the single piece's record, immutable machine
anchors, forecast accuracy and four timing categories. `pipeline_predictions
{workspace_id,piece_ids,from_ms?,until_ms?,work_class?}` is the bounded Timeline
input: at most50 explicit pieces, unfinished predictions first, per-piece
values and a named worst piece. Counts name that exact cohort/window/class,
including completed, within-target, missing-original and open-overdue counts.
A partial selection never claims to be an outcome-wide daily total. No median.

CLI: `clock PIECE`; `clock-record PIECE --expected N FILE|-`; `predictions
OUTCOME --pieces P,Q`. JSON reads are the same Core views used by HTTP.1198
can later consume `_piece_clock_context(db,actor,piece_id)`; until1199 ships,
clock capability is explicitly unavailable in its independent delivery.

## Anchors, accuracy and intervals

First Build is the first immutable `build` stage event by sequence, including a
prior incarnation of an item; a resume or wall-clock rollback never replaces
it. Missing Build is explicit.
First push is the first authenticated structured push receipt, not a freeze,
Git commit date or a message. It retains occurrence, observed/recorded times,
head, evidence, reporter and time uncertainty. Historical pushes without a
receipt stay missing. Core validates ownership and receipt shape; the external
push producer is responsible for reporting its real remote result. A late
report cannot erase the recording time or replace an earlier receipt.
An actual push reported before a late machine Build remains separate, with
`push_precedes_build` and its signed chronology; it is not rejected or moved to
the later machine entry. Those timestamps are not exclusive labor durations.

Live comes only from the immutable release table. Recording a release writes
an exact per-item clock index in that same transaction. An explicit release
reconciliation supports older records without scanning release history.
Only a release covering this piece's items after its Build satisfies it.
When historical Build is missing, the actual matching release is still shown
as completed with a missing Build metric; no cycle duration is invented.
Push attainment is shown separately; only matching live changes a prediction
to achieved. Original signed/absolute live error and each later revision's
accuracy are separate. Missing originals remain in the eligible denominator.
Small-page cycle target is strictly under45minutes; prediction target is
absolute error at most15minutes. Core/database classes are not pooled with it.

Intervals retain recorder, source, kind, actual start/end and physical attempt.
Waits additionally name imposing actor and rule/lock. Writing and repair are
explicit observations, never inferred from CPU. Producers submit command/test
intervals from their actual receipt; missing producer observations remain
unclassified. A test inside repair and writing during a hold may overlap.
Totals use interval unions clipped to original Build→live (or now), report
overlap explicitly and compute unclassified from the union, not the sum.
`clock-run` records wrapper start/end and direct child terminal automatically;
an existing physical-attempt ID refuses a relaunch, including after a lost
answer or restart. An interrupted open interval stays visibly incomplete.

## One durable slip notice

A forecast more than one hour after its original deadline posts one Core
notice addressed to the outcome owner. A revision does not reset that deadline.
The notice and deduplication mark commit atomically; retries, a fresh operation
or a restart cannot repeat it. A linked earlier slip/withdrawal suppresses a
duplicate, retaining that public message. Failed publication stays pending,
visible and retryable rather than reported as delivered.
Recovery also notices a milestone that actually finished more than one hour
late while settling was unavailable. Its elapsed value ends at that actual
event; a timely completion stays silent even when recovery happens later.

This uses the existing Core health/feed due-time settling path, not a new
scheduler. One bounded exact metadata due queue is maintained on clock writes;
at most8 due records settle per transaction. No unrelated topic/history scan.
No notice is a shipping prerequisite. Per-piece state is bounded to256KiB,
and at most256 named unnotified forecasts may occupy the due queue; capacity
refuses before mutation without dropping history. These are initial explicit
limits, not silent truncation.

## Verification

Isolated fixtures cover authenticated binding/reassignment and stale revisions,
atomic Build forecasts versus late reports, resumed/recreated work, late push
reports, matching and unrelated releases, missing-original cohort denominators,
overlap/unclassified timing, real publication rollback/restoration, and notice
deduplication across same-operation replay and Store restart. Original failed
attempts and complete consumer-file outcomes remain attached to exact heads.
