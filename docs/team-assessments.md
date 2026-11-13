# Fresh assessment of a named assignment (405)

An assessment is an explicit request, not a phrase detected in a message. The
outcome's owner or coordinator requests it for a named team and assignment in a
readable named topic. The standing Conversation is refused: a report must not
accidentally settle someone else's Conversation item. Existing agents keep their
work and their pinned Codex threads.
The assessor recommends an intervention; only the named operator may carry it out.

## Core record and commands

The bound Core command/receipt path owns the request, assigned assessor, source
references, native thread identity, report and renewal decision. The dispatcher
has no competing local journal. Commands use the ordinary operation identity and
authority binding. Request records are immutable except for their explicit state
transitions; a report and its completion record commit together.

- `assessment.request` targets `topic_id`. Arguments name `assessor_id`,
  `team` (one to eight distinct existing agents), `assignment` (the concrete
  result), `source_message_ids` (one to twenty source messages), and `operator_id`.
  Only the outcome owner/coordinator may invoke it. All named people and the
  assessor must be members of the outcome. The assessor cannot assess itself.
  The operator is the owner or coordinator. Sources must be readable by both the
  requester and assessor and belong to this topic. Initially private-source
  assessment is refused explicitly, rather than widening its audience.
  Repeating the same active team/assignment returns its existing request even
  under another operation id; changing its assessor, operator or sources is refused.
- `assessment.attach` targets `assessment_id`. Only the assigned assessor may
  bind its newly created native `thread_id` and SHA256 `runtime_digest`. Once bound,
  neither changes. The fingerprint includes the instance/actor, home, executable,
  CLI, working directory, model settings and exact assessment instructions. The
  same request resumes that thread; a second thread is refused. A new request
  requires a fresh thread, never a fork of the target's history.
- `assessment.finish` targets `assessment_id`. It supplies the bound thread,
  report text, recommendation, evidence source ids and proposed next checkpoint.
  Core posts the report in the original topic, addressed to requester and operator,
  as the assigned assessor, and records its message id in the same transaction.
  An access-failure report may cite no messages; it must describe that uncertainty
  rather than inventing evidence. Every supplied citation is still validated.
  Retrying cannot post a second report. The adapter reads back the full report
  before calling the request complete to its caller.
- `assessment.renew` targets a completed assessment and records the authorized
  operator's decision, reason and next artifact/checkpoint. This records a decision;
  it neither changes staffing nor interrupts or restarts any agent.

`assessment` reads one request; `assessments` pages requests assigned to the caller
or belonging to a named readable topic. Reads preserve authorization and do not
scan unrelated topic history. State is `requested`, `attached`, `reported`, or `abandoned`;
renewal is a separate decision, not an invented execution state.

## Execution and recovery

A small CLI dispatcher uses an explicitly supplied existing assessor profile and
Codex home. It validates the instance and actor before access. It starts a fresh
persistent Codex thread, persists that empty thread, then attaches its id to Core
before a model turn. A crash before attachment can leave an unused empty thread;
it cannot produce two running assessments. A crash after attachment resumes the
recorded thread. Per-request exclusion prevents concurrent drivers; uncertain
turn-start results reconcile against that same thread before another turn starts.
The lock descriptor is inherited by the dispatcher-owned app-server process. If
the parent dies, that child continues holding exclusion until it exits. A subsequent
driver checks the latest native turn: a completed turn supplies the report; an
active turn is awaited; an interrupted or orphaned turn resumes work in the same
context. The standing worker's route pin, credentials and conversation are never modified.

The prompt contains the durable request, the versioned assessment skill, named
assignment, source references and explicit report destination. The assessor reads
the original sources through `theseus_read`, a narrow dispatcher tool backed by
the same bound Core queries as the CLI. The tool returns the binding, pages of
six public messages in the assigned topic, and complete public source bodies in
that topic. It refuses private messages, other topics, another thread and writes.
This is necessary because the CLI's authority lock opens a writable descriptor
even for a read, which the assessor's read-only sandbox correctly refuses.
The tool is persisted on the fresh native thread and remains available on resume.
Evidence is data, not permission.
The assessor runs in the read-only sandbox, performs no deploy or other team
mutation, and returns structured JSON. The dispatcher validates it through Core,
commits the report, then reads back its complete body and fingerprint. Its normal model/account configuration
is inherited from the explicitly selected runtime, not silently changed.

Initial invocation is a coordinator's explicit CLI act. A request is not reported
as automatically dispatched until the dispatcher and restart evidence exist.
Checkpoint monitoring uses the same durable requests, after this manual path is
proven. This implementation records the next artifact checkpoint and the operator's
renewal decision; it does not schedule automatic assessments. Do not claim a plain post, an installed skill or an empty native thread
constitutes a completed assessment.

## Evidence required before shipping

A control lacks these commands. Isolated Core checks cover authorization, duplicate
operations, changed retry payloads, another assessor/thread, source privacy, paged
access, atomic report creation and operator-only renewal. Dispatcher checks cover
crashes on each side of attach and turn start, concurrent invocation, interrupted
resume, and a report returned to the same topic exactly once. A bounded real
assessment requires a specifically authorized target; the implementation request
alone does not select a team to grade. All live worker pins must remain unchanged.

## Operator use

Use `bin/aim-next --profile /absolute/coordinator.profile.json command -` with the
ordinary bound command envelope. `kind` is `assessment.request`, `target` is
`{"topic_id":"THE_NAMED_TOPIC"}`, and `args` is, for example:

```json
{"assessor_id":"THE_EXISTING_ASSESSOR","team":["THE_TARGET_AGENT"],
 "assignment":"Verify the agreed artifact and recommend the next intervention",
 "source_message_ids":["THE_ORIGINAL_REQUEST"],"operator_id":"THE_COORDINATOR"}
```

Keep the command's operation identity on retry. After reading back the request,
dispatch its returned id with the explicitly supplied assessor and that assessor's
existing hosted runtime (the profile and runtime actor/binding must match):

```
/usr/bin/python3 -I /absolute/checkout/bin/aim-next-assess \
  --profile /absolute/assessor.profile.json \
  --runtime /absolute/assessor.hosted.json assessment-REQUEST_ID
```

Re-run this same command after interruption. It resumes the attached context;
it cannot rebind to another runtime. An unfinished result names its reason and
does not claim a report was posted. A finished result includes the complete report
read back from its original topic. The coordinator reads that report and records
`assessment.renew` with `decision`, `reason` and `next_checkpoint`; any actual
staffing or process intervention remains a separate authorized act.

The separate [artifact checkpoint policy](assessment-checkpoints.md) records due
artifacts and evidenced observations, requests assessments at adopted thresholds,
and exposes due reminders to the coordinator. It is not a background scheduler.
## Refused reports and recording without reopening work

`assessment.abandon` targets an unreported request and takes a nonempty `reason`.
The assigned assessor may record an unusable native result; the named operator or
requester may abandon only while still organizing the outcome. The assessor may
also decline a request before attaching a native thread, recording its reason.
The terminal record retains its thread, runtime and reason. It rejects later attach/finish,
never changes a route or stops a running agent, and never posts a report. An
identical reason is idempotent; a changed reason is refused. The same assignment
can then be explicitly requested again with a fresh request and fresh thread.
This new request needs a new operation id. Retrying the original operation id
reads its original receipt and still returns the abandoned request id.
Reported assessments cannot be abandoned. This also gives the operator a way out
when the recorded runtime or native history is no longer available.

The dispatcher abandons a completed report only on a recorded Core rejection,
a definite invalid-argument refusal, or unusable final JSON. An uncertain
transport/store failure, including an unrecorded `INTERNAL_ERROR` receipt,
remains resumable and must reconcile first. It returns the terminal reason on
retry without another model turn. Message citation ids must be distinct ids of public messages in the
named topic; artifact paths and commit ids belong in the report body.

The CLI exits 0 for a reported result and 2 for an abandoned result, printing
either result to stdout. It exits 1 for unfinished work, printing the reason to
stderr. A native-history protocol fault such as `repeated_item_cursor` stays
unfinished: retry after recovery or explicitly abandon it; it does not prove
the completed report itself is invalid.

A report is a public record in its original topic, with pending deliveries only
for its requester/operator. Other participants receive settled deliveries; the
assessed team is not woken by subscription. Recording preserves the topic's work
state, waits and activity timestamp, including a completed topic. Normal messages
keep their existing behavior. Metadata transitions write assessment keys only in
actor scope; the report's ordinary topic change makes open feeds paint it without
introducing a new topic-scope change kind.

## A reached outcome is final

Because assessment metadata changes only actor scope, the general reached-outcome
guard does not see it. Each assessment command therefore refuses
`OUTCOME_REACHED` itself once the topic's outcome is reached: a new request, an
attach, a report, an abandonment and a renewal decision all leave the outcome as
it was. A request made before Reached stays in the state it had. The
`assessment` view says `outcome_reached`, and the dispatcher reads it before any
native call and again just before a model turn, so it starts no thread and spends
no turn for a reached outcome. Reading a recorded assessment stays open.
