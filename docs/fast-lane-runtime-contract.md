# Fast lane runtime contract

The existing commands and wakes must give a fresh seat the current rule, the
actual next action and an honest clock. This is the first implementation slice
assigned to Flex in Landing22621; the first free Core lane builds it. It adds no
scheduler, packet, permission exchange or dependency to today's pieces.

Authority: Tony22471/22491/22603; operator red team22508/22519/22521; Warp22621
and22665; Fast lane Notebook n-1bd3c6374c7341b0a1d8a7ed2edc1b1f; Fable's
current-rule Notebook n-85ea0961d1fd4e5791fed9024aa9b720 revision2. Later
accepted rulings revise the record below, rather than requiring this document
or an agent's conversation to remember a new rule.

## Scope and ownership

Core owns durable policy, lane binding, estimates, waits and operation results.
Fable records rulings and the pipeline queue. Warp owns the landing kit and the
shared execution locks (1195/1196).1194 owns bounded same-operation busy retries.
The steward owns consumer discovery. The auditor evaluates timing after landing.
This slice connects those facts; it does not implement their work a second time.

Implement this contract as three small Core deliveries, not one combined gate:
(1) current-rule/next-action context in the existing commands and wakes, with the
1161/1169 contradiction checks; (2) lane/forecast/clock records and their view;
(3) structured wake diagnostics and restart reconciliation. Each can land when
its own behavior and consumers pass. An unimplemented later capability is
explicitly unavailable and cannot delay the earlier shipping action. The first
free Core lane starts with (1) and supplies its own estimate; this spec does not
invent an implementation forecast for that lane.

The first version requires no database DDL. Small current records may use a
versioned Core metadata namespace, with every successful write's complete record
and source in the existing immutable operation outcome. Read them by exact key,
not a scan. Do not put authority in a seat file, a home-directory JSON file or a
client cache. Existing piece/stage/release records remain the work authority.
If implementation finds that existing storage cannot preserve these contracts,
report the concrete gap rather than smuggling in a migration or bypassing the
1028 hold. That does not hold any unrelated piece.

## One effective rule

Add a bound current-rule view and a coordinator/owner rule-update command to the
existing Core/CLI boundary. Names below describe the contract; integrate with
existing command naming rather than introduce a separate service.

A current record contains:

- workspace, stable policy ID, revision and capability version;
- typed paths for page, Core and database work, plus explicit scoped overrides;
- for each rule, its stable ID, source message/revision/passage or Notebook
  revision, the rule it supersedes, and the authorized recorder;
- the existing current-rule Notebook ID as its human rendering.

Fable writes a ruling once with an expected revision and the normal operation ID.
Core checks existing authority and scope, preserves history, and generates the
human rendering of that same record. Direct prose in an item, a stage's old note,
an agent's suggested procedure or a stale mechanical flag is not another policy.
Do not infer precedence by timestamp or parse free text into new requirements.
The coordinator explicitly records which rule supersedes which. Keep the earlier
words readable as history; do not erase the evidence of the contradiction.

Bootstrap from Fable's cited current record. Until the capability is installed,
that readable record and existing commands still govern; publishing this spec
is not installation. After installation, the CLI update writes the machine fact
and its human rendering together, so the two cannot silently diverge.

Current defaults are the red/green, complete consumer-file coverage, one source
read, carry/freeze and landing comparison in that record. Core changes also
compare their Python consumers with live. Database pieces retain judged checks
and real-data rehearsals. An ordinary deployment flag does not override an
explicit Core requirement. Preserve explicit piece decisions such as1184's
failed sequence and1028's no-preparation condition.

## Current action, without a new gate

Existing piece/start/read/push/carry/freeze/landing commands and every wake expose
a compact context with policy revision/source, piece and lane, exact own/carry
head, actual live head, next action, its owner, actual blockers and resource waits.
The full current record is separately readable; never inject its entire history
into every wake. Missing or truncated context is labelled, not treated as proof
that no requirement exists.

Derive the action from current pipeline facts and exact-head check/read results.
Missing tests mean run the required tests; a missing read means request that one
read. When the required facts are satisfied, return the shipping action. Reading
or acknowledging the context is not a prerequisite, and policy consumption never
creates an approval event. The view does not itself move a pipeline stage.

The two semantic stops are a real new required-check failure and a fault in the
source read. Retain the exact failure/finding and its source. A harness dying
before navigation is zero UI evidence, not a product pass or a product finding;
route it to its owned repair/deferred-check action under the current rule.
A disjoint live advance calls for merge/rebind of the same work, not another
permission. An actual conflict preserves both changes and has a concrete read.

An ask in chat may remain a legitimate question. It cannot silently become a
shipping prerequisite merely because its words request a lease or packet. Any
recorded shipping wait must cite an effective requirement or actual check/read
finding; an unsupported request remains visible as a question with the shipping
action still available. Do not ban keywords, censor audit findings or use an LLM
judge to manufacture another approval. Purely conversational delay cannot be
made impossible by a stage guard: show its cited source, actor and elapsed time.

Resource waits are separate from those stops. Report the existing lock/holder or
capacity condition and useful source work while it applies.1195 owns acquisition,
release and recovery; this slice adds no queue. Optional stale/missing machine
telemetry is unknown. It creates neither a new prerequisite nor unlimited
capacity, and does not disable existing load/ownership limits or bounded fallback.
Use the execution tool's current resource facts, not an old policy-page snapshot.

All binding, author, operation, source-revision and cleanup safeguards still
apply. A refusal never authorizes another actor/profile or a different store.

## Lane and clock records

Add authenticated lane/start/forecast/activity/wait events through the existing
pipeline command boundary. Binding a lane is Fable's existing responsibility;
record its actor ID on the piece, not only in the topic or item description.
Reassignment preserves the previous binding and its time. An absent lane is
explicit, not guessed from the last person to post.

A forecast has an immutable ID, piece/work-segment and milestone, recorded actor
and time, original start anchor, expected duration or absolute deadline, and
source. A revision preserves the first forecast, reason and all earlier values.
A resumed segment is distinct from the piece's first Build entry. Never reset
elapsed work or an unsuccessful attempt when a source, actor or live head changes.

The estimate is the lane's explicit number. With none, show **no estimate yet**
and elapsed time without one. Historical statistics may describe performance;
never report a median as an unprovided forecast. A push forecast, a live forecast
and a conditional freeze-to-live forecast are different scopes and anchors.

Read push head/time and release/live time from their actual records. Distinguish
when an event occurred from when a later message reported it. Backfilled reports
keep their provenance and uncertainty; they do not silently replace machine times.
Return start-to-push, push-to-live, first-Build-to-live, original/current forecast
and signed error. An absent push receipt or original live forecast stays absent.

Record command/test time and known resource/tool wait intervals automatically.
Writing and own-test-repair activity require explicit events; CPU use is not
thought or writing. A wait names its source/rule, imposing actor or lock, start,
end and reason. Source work can overlap a hold. Preserve overlapping intervals;
unclassified time is the complement of their union, not elapsed minus a sum
that double-counts tests inside a repair or source work during a hold.

At push, expose the requested four timings: writing, waiting, test execution and
own-test repair. Include unclassified time and overlap rather than manufacture a
breakdown. Physical attempts and product attempts are distinct; a repaired test
retains the earlier physical attempt and its duration.

A named forecast more than one hour late emits one durable, deduplicated notice
to Tony with piece, original deadline, actual elapsed and current revision/cause.
A previously communicated withdrawal/slip is linked so recovery does not create
repeat notices. Forecast history remains even when a notice was already sent.
The current predictions view keeps unfinished named forecasts first and moves
them to achieved only from an actual live record; it never marks an estimate as
a release. Warp's Timeline consumes this view instead of a hand-copied queue.

## KPI contract

Warp22665 defines two per-piece measures:

1. First Build entry to recorded live. Target: under45minutes for a small page
   piece. Keep start-to-push and push-to-live as the diagnostic split. Never
   substitute a resumed start for the original Build entry without labelling it.
2. Actual live time minus the live deadline first recorded at Build. Report both
   signed and absolute error. Target: absolute error within15minutes for4of5
   pieces. A missing initial prediction is reported as missing, not zero error. For the
   4-of-5 target its piece remains in the eligible denominator and is not an
   on-time success; report estimate coverage alongside the rate.

The daily view reports the day's median and worst observed duration/error,
completed piece count, cohort/window and missing-estimate count. Compare like
piece classes; database judged work is not silently pooled with small pages.
An on-time rate without estimate coverage invites missing-forecast gaming; an
on-time rate without cycle time invites padded deadlines. Show both measures.
Zero waits caused solely by a superseded rule remains an explicit guardrail,
not a measured claim until the wait sources have actually been checked.
The later restart drill measures restart-to-first-live against20minutes; it is
not a request to stop current seats as part of this implementation.

## Wake delivery and recovery

Every seat wakes through its unchanged own binding, reads its inbox, and gets
current policy/action/clock context. The runner owns continuing delivery; an
agent's private periodic watcher is not the authority that makes it reachable.
Do not treat an unavailable pending-deliveries view as an empty inbox.

Keep pending intent, committed-but-unseen result, running work, terminal result
and unknown state distinct. On a lost response, reconcile the existing operation
in the bound outbox/result surface before doing more work.1194's busy recovery
uses that same operation identity and exact request. For the separately ruled
ACK result DATABASE_BUSY/recorded:false with no operation ID, repeat the same
bound ACK under22600; do not invent an ID or mistake it for an uncertain write. Do not invent a new ID,
replay a completed producer or infer a missing terminal from silence.

A successful inbox view does not establish a successful wake. Record the actual
wake/delivery outcome and the recipient's existing answer separately. On a
redelivery of an already answered source revision, present the existing answer
and allow its delivery acknowledgment without generating another answer.

For a failed pending-delivery page, retain a bounded safe category, validated
Core error code/retryability where available, actor/attempt and page index.
Distinguish malformed output, a returned Core refusal, transport failure and
successful pagination. Do not log arbitrary error bodies, message text or
private content. Preserve a binding refusal exactly and stop that operation;
never investigate it through another profile or a raw database read.

## Acceptance cases and rollout

Use isolated Core/runner fixtures and meaningful before/after checks:

-1161's old packet description plus the current no-packet ruling yields the
  existing authorized action, with the obsolete requirement shown as superseded.
-1169's ordinary mechanical flag cannot erase its explicit Core path.
-A ready piece plus a new required failing test stops for that named failure;
  clear it with an actual result and the next existing action returns.
-A disjoint live advance preserves the work/attempt identity; an actual conflict
  names the resolution rather than silently discarding either change.
-After a simulated restart, a stale instruction, unseen committed write and stale
  optional sampler recover the same operation and shipping action, with honest
  uncertainty. They do not duplicate a post, test child or notice.
-Each pending-delivery failure shape above, multi-page success and an existing
  answer's redelivery retain distinct outcomes. Reading a view is not wake proof.
-Missing forecasts, changed forecasts, resumed segments and a late push report
  preserve the original anchors. A test inside repair and source work during a
  hold produce overlapping intervals and an honest unclassified remainder.
-A one-hour slip produces one notice across repeated wakes/restarts; an achieved
  forecast moves only when its matching release is recorded.
-An unrelated or non-authorized actor cannot replace the policy or lane; a stale
  expected revision cannot overwrite a newer rule.

Keep reads scoped/indexed and the wake context bounded. Do not scan all topics,
Notebook history, worktrees or processes once per message. Reuse existing Core
operation/revision machinery and1194/1195 interfaces. Prove a focused red/green,
run the importing and source-reading consumer files, and use the current ordinary
Core shipping path. No receipt audit, policy-summary approval or separate packet
becomes a prelanding requirement. The implementation reports its exact limits;
this document does not claim any of the mechanism is already installed.
