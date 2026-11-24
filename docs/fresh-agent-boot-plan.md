# Booting Theseus with fresh agents

Start a fresh conversation for each included actor, give it the correct trusted
kickoff, and recover its real work from Theseus. Preserve actor identity,
authority, pending work and old history. Prove this on one idle hosted seat,
then run the declared team cohort through a landing that requires a fresh
agent's action.

Flex owns this document and review reconciliation. Core7 owns item 1213's hosted
refresh. Fable prepares and coordinates execution; Tony performs owner-only
requests and external launches; Warp observes and lands. This is a reviewed
plan, not a record of a completed boot trial. The [review log](fresh-agent-boot-review.md)
records all eight reviews of the original draft and their dispositions.

## Current capability and prerequisites

The inspected baseline is release 418,
`e0423628964aafea8389d11a29ec4ab38fc13da8`. Release 419,
`ce13ce60ce08adb63a83ade879cc637a4efbe4d9`, subsequently shipped item 1214's
landing-tool validation. Neither release establishes the new manual refresh.
An ordinary runner restart resumes the pinned thread. Existing automatic 1104
recovery can replace one under its qualifying conditions. Installing repository
seat files did not configure agents to read them.

Item 1213 adds owner-authorized hosted refresh and the seat-file pointer. Its
proposed interface is:

```text
seat-refresh building-theseus HOSTED_ACTOR [HOSTED_ACTOR ...]
```

This is a contract example, not an instruction to run an unavailable command.
Before execution, Core7 supplies the installed command/status/continuation
syntax and fields; Fable posts the exact owner-bound commands and verifies their
supported transport. The current Team UI does not establish a human entry for
operator-mapped lanes. Tony's actual shell or page entry must be confirmed; a
missing page entry is a separately owned implementation need, not permission
to borrow his profile.

Refresh replaces only conversation context. Compare actor, profile/binding,
owner, Stop/Continue state, model, permissions, writable roots and history
against the authorized effective configuration baseline. Any separate repair
to stale role text happens first, with its own owner and receipt. A stopped
actor refuses; an open turn finishes before replacement.

## Every actor and its route

Fable rechecks bound Health, outcome membership, selected route and controls
before execution. This inventory covers the building team discussed in Tony's
request; other globally registered actors are not silently added. Health's lack
of a route is not proof of Stop or proof that no external session exists.

| Actor | Observed route/session | Boot procedure and trial disposition |
| --- | --- | --- |
| **Flex** (`flex`) | Hosted, managed seat | Included in the eligible hosted batch; 1213 uses the actor ID. |
| test-steward | Hosted, managed seat | Included when controls and current work permit refresh. |
| core-lane7 | Hosted, operator-mapped lane | Included after 1213's own work is safely handed over; no managed seat-request row required. |
| core-lane8 | Hosted, operator-mapped lane | Included; a possible dry-run candidate only if actually idle then. |
| page-lane5 | Hosted, operator-mapped lane | Included after preserving current piece/worktree/producer state. Building 1215; not assumed idle. |
| page-lane6 | Hosted, operator-mapped lane | Included; another possible candidate subject to the same live checks. |
| Auditor (`auditor`) | Runner dispatches `codex_queue` jobs to an existing Codex thread | Known continuation, not fresh per job. 1213 does not cover it. Fable must provide a supported new queue destination plus bootstrap/handoff, or record an explicit cohort exclusion. Until then its refresh is unresolved. |
| Fable (`fable`) | Codex desktop chat outside the runner | Included through Tony opening a new chat with the prepared kickoff after coordinator handoff below. Continuing the goal or chat does not refresh it. |
| Warp (`warp`) | Claude Code session on this Mac, outside the runner | Explicit observer/lander exclusion for this trial; stays live. A future refresh needs its separate session/kickoff procedure. |
| Team / team-agent (`team` in bound Health) | No runner route; nothing waiting at the inventory read | In scope for the boot plan. External launcher and current controls unverified. Fable identifies the actual session/launcher and owner, supplies the kickoff and handoff, or records an explicit exclusion before cohort lock. |
| designer | No runner route; nothing waiting at the inventory read | Same unresolved external-launch prerequisite; included in plan, never silently omitted or assumed stopped. |

Tony-stopped actors remain stopped. The execution record names every included,
excluded and unresolved actor with its reason and owner. A narrower trial must
be called narrower; missing actors cannot be removed afterward to improve the
reported result. This document has not invented launch commands for unrouted
actors or changed any route, configuration, pin or control.

## Authority, admission and partial results

The outcome's human owner can submit the hosted request; coordinator status
alone does not authorize Fable. Tony acts through his own supported bound entry.
One request starts the single-seat dry run; one later batch covers the eligible
hosted cohort. External chats have their separately named owner acts.

Core validates all members in one transaction before recording any new intent:
current membership, route, pin/control guards and existing intent. Duplicate
actors refuse. There is one unfinished replacement per actor across manual and
automatic recovery. Exact operation retry returns its original actor-to-intent
mapping. Core7's chosen contract coalesces a different manual request only onto
the same unresolved manual intent with the same old pin and control revision.
A conflicting automatic intent or changed guard refuses the whole batch. A
shared actor in overlapping batches never gets a second creation.

Admission is atomic; later external effects are per actor. An accepted request
with no pending work does not promise immediate activation. The next delivery
dispatch handles its refresh intent before ordinary sending. Fable sends the
identified harmless delivery **after acceptance and before waiting for
activation**. The old context must not consume that delivery first.

## Correct startup and work recovery

Use a short trusted kickoff that points to the role file. Every fresh path —
initial provisioning, automatic recovery and explicit refresh — must serialize
the resolved **absolute** `docs/seats/ACTOR.md` path derived from the selected
CLI script. No cwd or search fallback is permitted. For the inspected Page6
configuration this is `/Users/commonfabric/aim-next/docs/seats/page-lane6.md`;
other actors use their verified selected path.

The rendered instruction follows this template; placeholders must be resolved
before launch:

> You are Theseus actor ACTOR. Read ABSOLUTE_SEAT_FILE before taking work. Keep
> the actor, profile and authority binding supplied by this trusted runtime.
> Recover current assignments and rulings with this exact bound CLI. Follow
> your trusted actor/wake protocol for the first Theseus read: hosted seats
> start with inbox; a permitted paged wake exhausts its delivery cursors. Read
> full current sources, current rules and assigned work before acting. Reconcile
> uncertain saved operations before retrying. Preserve stopped work. Report a
> binding or unreadable-role refusal through the unchanged working channel.
> Idle hosted waiting means end the turn and let the runner wake you.

Fable and the supported configuration owner must reconcile contradictory
historical role/task/rule text **before** claiming correct prompting. Appending
a seat-file pointer cannot override stale higher-priority assignments. Preserve
trusted binding/permission instructions and retain the actual effective startup
bytes. Core7's pointer implementation preserves configured role bytes; that
implementation does not perform the separate configuration repair.

Record launch-time CLI root/runtime source, actual serialized kickoff, expected
seat-file path/commit/hash, and the path/revision/hash actually read. If the live
repository advances or bytes differ, reconcile that mismatch before counting a
correctly prompted agent. Missing/unreadable selected bytes produce a diagnosis,
not an invented role or alternate checkout.

The fresh actor reads delivered sources at their latest revisions, distinguishes
direct requests from subscriptions, keeps whispers private, and observes the
actual snapshot boundary. An exhausted snapshot does not rule out later mail;
do not filter deliveries by an old wake generation. Existing answers must match
the current source before their delivery is separately acknowledged.

Even with an empty inbox, recover the assigned piece/queue, owned worktree and
saved operation/producer state. Before refresh, Fable and each builder publish
a recovery pointer containing the exact worktree/branch/base, dirty/untracked
state, evidence/checkpoint locations, original inspection/construction/Build
clocks and forecasts, and uncertain write/producer operation IDs. The incoming
actor verifies these before creating, retrying, resetting or cleaning anything.
It acts in the original request stack, reads the result back, and acknowledges
only handled deliveries. Wait only when these reads establish no warranted
action; do not create a worktree or test merely to demonstrate recovery. Hosted
waiting follows the trusted runner instructions, not an inherited watch/goal loop.

## Execution sequence

1. **Close the prerequisites.** Core7 supplies focused proof and the installed
   1213 receipt/commands; Warp lands it and Fable verifies the actual deployed
   source. Fable resolves effective startup configuration, supported owner
   transport, evidence access and external-session procedures. Lock the explicit
   cohort and exclusions. Item 1214 already landed independently as 419. No
   runner-restart-policy landing occurs between 1213's landing and the trial's
   first landing.
2. **Choose an actually idle hosted actor.** Bound Health and current work must
   show no open turn, active piece or unfinished owned producer. Check final
   ownership manifests, Browser.close/fixture exit and PID/profile/port absence;
   empty mail alone is insufficient. If a survivor is unknown, choose another
   seat. Never kill by basename or manufacture a replacement receipt. Save its
   pin/control guards and recovery pointer; identify the harmless delivery.
3. **Run the one-seat dry run once.** Tony submits the prepared owner request.
   Retain the original operation and accepted intent. Fable sends the harmless
   delivery immediately after acceptance, then observes actual activation,
   first read and useful action. Reconcile old/new thread identity, unchanged
   effective controls/binding/history, correct role read and pending-work state.
   A forecast, ACK, runner start or accepted intent is not activation. Repair
   failures before the broader trial; preserve uncertain results for the same
   intent.
4. **Prepare the causal first landing and coordinator handoff.** Warp selects a
   ready piece whose remaining normal path requires an observed fresh agent's
   act. His current proposal is 1215: preserve its handoff, hold freeze for fresh
   Fable, then let Warp land. Fable records the deliberate hold/release in
   canonical work; it revises the earlier no-idle-hold disposition, preserves
   all original clocks and forecasts, and counts waiting in 1215's elapsed time.
   If that piece is unsuitable, name another and its required fresh act before
   starting. A preapproved piece landed wholly by unchanged Warp does not count.
5. **Transfer Fable, then start the cohort.** Outgoing Fable posts the exact
   hosted batch, resolved new-chat kickoff and durable handoff: board/read cursor,
   unread gaps, uncertain operations, work/forecast state and watcher ownership.
   Explicitly retire or relieve the outgoing goal/watch responsibility and stop
   that chat's work. Tony runs the batch and opens the fresh Fable chat in either
   order. New Fable reads and verifies the handoff, publishes its new chat ID and
   readiness, and assumes any legitimate existing watch once; no duplicate
   coordinator/watch survives. Warp records the transfer. Any other included
   external route follows its separately verified equivalent handoff.
6. **Recover and land.** The responsible coordinator sends each accepted hosted
   actor its identified delivery before waiting for activation. Incoming actors
   recover current work under their actual trusted wake protocol. Fable records
   each request, intent, new context and first action, including failures or
   exclusions. The selected piece then follows ordinary review/freeze/landing
   with the required fresh act identified in its evidence.
7. **Publish the measured result.** Warp reports the fixed cohort and completed
   publication, with each acceptance dimension below. The primary target is
   **under 20 minutes from the earliest included owner act to the completed
   first landing**. For hosted batch plus Fable launch, time zero is whichever
   happens first. This changes the earlier last-restart/last-activation definition
   (Warp 23353/23397, resolved by 23419); retain the old definition as history.
   Also report every route's request time, request-to-last-activation,
   first-to-last activation span, first-activation-to-landing,
   last-activation-to-landing and each activation-to-first-action interval.
   Failed/missing members make the declared trial incomplete.

No trial clock has started in the inspected records. Fable 23422 records the
1215 freeze hold applied at `2026-11-24T13:19:42.450000-08:00`; Page5 continues
proof/handoff. This interval can overlap active work and is not all idle time.
Its release remains to be recorded. The hold retains 1215's original inspection `12:51:24.239312`, construction `13:05:24.824831`,
machine Build, HANDOFF `14:20` and LIVE `14:40` forecasts, with revised forecasts
and reasons separate. The trial does not reset a delivery clock.

## Evidence, acceptance and reconciliation

Keep these dimensions separate. A review or synthetic fixture cannot establish
observed live behavior; a self-report cannot supply missing execution telemetry.

| Dimension | Required evidence / limit |
| --- | --- |
| Runtime protocol | Exact candidate and installed runner source; positive managed-seat **and** operator-lane refresh through activation and delivery. Reach valid setup before testing Stop/nonowner refusal. Retain ordinary same-pin restart control and inherited 1104/binding coverage. |
| Concurrency and interruption | Duplicate actors, overlapping `[A,B]`/`[B,C]`, automatic uncertain intent racing manual, zero-pending request followed by delivery, open turn, Stop/control/pin races, lost create/persist/activate responses and late callbacks. No second create. |
| Prompt and first read | Actual kickoff, expected file and actually read path/revision/hash; observed first command under that actor's protocol. Unsupported first-command telemetry is **unverified**, even if the later post says “I ran inbox.” Fable names the available supported trace before execution or states the narrower conclusion. |
| Durable recovery | New thread's warranted action and source revision; one positive unfinished-work case. A focused synthetic lost-write-plus-source-correction case reconciles the committed original operation, reads the correction, answers only what remains owed in the same stack and ACKs only handled deliveries. A harmless idle delivery alone proves neither lost-write nor unfinished-work recovery. |
| Invocation and cleanup | Direct invocation result and owned child cleanup/absence; distinguish setup death, assertion reachability and invocation completion. No producer receipt inferred from a recovery post. |
| Landing and time | Fresh agent's causal act, approved landing source and full publication receipts, fixed cohort and all request/activation/action/publication timestamps. |

Core7 owns applicable focused runtime assertions; test-steward evaluates their
reachability. Fable owns live collection/procedure and identifies which synthetic
conditions actually occurred live. This coverage map adds no broad-suite or
native-test gate to the boot trial.

Use only supported bound status/receipt surfaces. Core7 reports that the committed
1104 Health receipt exposes old/new thread and `committed_ms` for 24 hours; Fable
must collect it within retention. Incomplete intent status and same-intent
continuation are separate. Before execution, publish the installed commands,
reader authority and fields for original operation, actor, intent, old/new pin,
control guard, phase, created ID and commit/adoption receipt. If Tony's operation
is actor-owned and Fable cannot read it, Tony performs the supported read and
relays the receipt. Coordinator status is not a grant. No private database read
substitutes for the supported surface.

For a partial batch, reconcile the original operation rather than submitting a
new batch. If A committed its pin but lost adoption/response, adopt its recorded
destination. If B has a created ID with uncertain persistence, continue only its
permitted phase under the same intent and recorded ID. If C has opaque creation,
leave it explicitly unresolved; no second `thread/start`. Do not resubmit A or
omit C. A late callback after Stop/Continue or a newer intent may update only its
old journal, never the newer intent/pin. Stop, owner-control and binding guards
win; retain their exact refusal and use the unchanged working channel.

## Remaining execution prerequisites

These are conditions for running the trial, not missing document-review replies.
They remain open until their owners attach the actual receipts:

| Owner | Required next action |
| --- | --- |
| Core7 / Warp | Finish, prove and land 1213; publish installed submission/status/continuation syntax, per-actor guards/coalescing and supported activation/trace fields. |
| Fable / supported configuration owner | Reconcile historical role instructions; retain the authorized effective startup baseline and actual read collection procedure. |
| Fable / Tony | Confirm Tony's supported owner entry; prepare one dry-run request, hosted batch, harmless-delivery ordering and owner-only result reads. |
| Fable / Tony / Warp | Prepare and transfer the external Fable chat; verify Auditor queue replacement and Team/designer launchers/controls, or record explicit exclusions before cohort lock. |
| Fable / Warp | Select the live idle candidate and causal landing, record any hold/release without resetting clocks, and prevent intervening restart-policy changes. |

The separate native 1215 work and inherited six failure families retain their
owners; their results do not establish fresh boot. The two historical incomplete
worker histories retain unknown loss causes. This plan attributes neither loss
to runner restart without evidence.

## Sources and document status

Tony's request is Releases 23370; his inventory correction is 23406. Runtime
scope comes from Warp 23369 revision 2, Core7 23377 and Warp 23378, refined by
Core7's review 23412. Route evidence includes Fable 23368/23387/23400, bound
Health read 1795554702517 and Warp 23411. Warp 23419 resolves the primary clock
and deliberate-hold disposition; Fable 23422 accepts the clock and records the
hold's application. Current policy was revision 3 / Notebook 39;
execution reads it fresh.

All eight requested reviewers read immutable draft
`3d27c16fe8da77c8b33360b839289ba578cc393f`. The accompanying review log maps every
finding to this revised document or an explicit owned execution prerequisite.
Document completion does not assert operational approval of revised claims,
runtime readiness, successful fresh activation or trial completion.

Repository contracts: [seat files](seats/fable.md),
[hosted thread recovery](hosted-thread-recovery-1104.md),
[bound startup instructions](hosted-binding-instructions-1069.md), and
[agent guide](agent-guide.md), subject to the trusted actor/wake instructions.
Inspected runtime owners are `aim_next/codex_host.py`, `seat_host.py`,
`hosted_recovery.py`, `hosted_seats.py` and `hosted_control.py`.
