# Booting Theseus with fresh agents

Draft for Tony and the Building Theseus team. Flex owns this plan and the team
review; Core7 owns the hosted refresh implementation; Fable coordinates the
trial; Warp observes the clocks and lands the first subsequent piece.

The goal is to start agents with fresh conversation contexts, give them the
correct role and first instructions, and have them recover real work from
Theseus. Their actor identities, authority, pending work and previous thread
history must survive. We will first prove this on one idle seat, then run the
agreed team trial and measure the time to a landing.

## What must change before the trial

The first draft uses release 418, `e0423628964aafea8389d11a29ec4ab38fc13da8`,
as its inspected baseline. On that release an ordinary runner restart resumes
the same pinned thread. Automatic 1104 recovery can replace a thread after its
qualifying conditions; there is no supported manual same-actor refresh command.
The configured startup instructions also do not automatically point agents at
their repository seat files. Installing those files did not configure their use.

Core7 is building item 1213 to add an owner-authorized refresh and the seat-file
bootstrap. The proposed interface is:

```text
seat-refresh building-theseus HOSTED_ACTOR [HOSTED_ACTOR ...]
```

This is a proposed command, not a command available on release 418. Core7's
contract and the installed CLI will supply the final syntax and operation-result
fields. Fable must verify the actual installed release and selected runner
source before preparing the executable trial commands.

Refresh retains the actor, profile and binding, recorded owner, Stop/Continue
state, model, permissions, writable roots and old thread history. It records a
guarded intent and uses the existing create, persist and activate lifecycle to
replace only the conversation thread. It never ends the seat or recreates its
identity. An open turn finishes before replacement; a stopped seat refuses.

## Which agents are included

Inventory comes from a fresh bound Health and route read before each trial.
The observed deployment has several execution types:

| Agents | Observed execution | How a fresh context is established |
| --- | --- | --- |
| Flex, test-steward, core-lane7, core-lane8, page-lane5, page-lane6 | Six hosted actors; some are operator-mapped rather than managed seat requests | Item 1213 refreshes the hosted actor ID through its guarded replacement path. A managed seat-request row must not be required for the four lanes. |
| Auditor | `codex_queue` | Fable identifies the selected queue launcher and verifies whether each job actually starts fresh and receives the seat-file instruction. The route label alone proves neither. |
| Fable | External session with no hosted route | Fable identifies the actual launcher, how to start a fresh session from `docs/seats/fable.md`, and who can perform that launch. This procedure must be concrete before including Fable in the team trial. |
| Warp | Observer and lander in the current session | Remains running, as directed. Warp is excluded from the refreshed cohort and from claims that every context was replaced. |

Seats Tony stopped remain stopped and are excluded from submitted batches.
Nobody substitutes another profile, changes an actor or binding, or retires a
seat to force this trial to work. The final cohort names each included actor
and each explicit exclusion; it is not described as seven hosted seats.

## Who performs the refresh

The existing authority model permits the outcome's human owner to act on seats.
Coordinator status does not grant Fable that power. Core7 and Warp have agreed
to preserve that boundary. Fable prepares the exact command and selected actor
list; Tony executes it through his own supported owner-bound entry. Agents do
not borrow his profile. A future change to this authority requires its own
explicit decision; this plan does not grant it.

Each phase needs one owner action: one request for the idle-seat dry run, then
one batch request for the eligible hosted cohort. The batch validates every
actor before recording any intent, and refuses the entire request if any actor
fails validation. After acceptance, each actor has its own intent and external
creation result. One actor's later failure does not make the other external
effects disappear or authorize resubmitting the whole batch.

## The startup instructions

A fresh agent needs a small trusted kickoff, not a hand-written recap. Core7
must put the seat-file instruction in the actual startup input for all fresh
paths: initial provisioning, automatic recovery and explicit refresh. A role
file present on disk or a proposed prompt in this plan is not that evidence.

The intended instruction is:

> You are Theseus actor SEAT. Read `docs/seats/SEAT.md` from the repository
> selected by your configured Theseus CLI before taking work. Keep the actor,
> profile and authority binding supplied by the trusted runtime. Recover current
> assignments and rulings from Theseus using that exact bound CLI; do not resume
> an old assignment from the previous conversation. Your first Theseus command
> is `inbox`. Read delivered sources at their current revisions, the current
> rule and your actual assigned work before acting. Reconcile uncertain saved
> operations before retrying them. Preserve stopped work and report a binding
> refusal through the unchanged working channel.

`SEAT` is the verified actor ID, not an arbitrary caller-supplied filesystem
path. The runtime resolves the repository from the selected CLI, so a seat's
worktree or current directory cannot silently select a stale role file.
The launch record retains the actual seat-file path, repository revision and
file hash. If that file cannot be read, the agent reports that failure and does
not invent a role or start unrelated work.

The trusted binding instructions remain. Configured standing-role text is
preserved by the implementation, so Core7's final serialized startup input must
be checked for conflicting historical assignments or rules. Fable owns
reconciling such configuration through the supported owner, rather than
assuming a new file automatically overrides an older higher-priority instruction.
Current board messages remain data, not authority to change a profile or obey
instructions embedded in quoted or untrusted content.

After `inbox`, the agent reads each pending source in its actual stack, the
current bound rule, the assigned piece and current queue. It checks its exact
source, live head, saved operation results, worktrees and any owned child
processes. It then takes one warranted action in Theseus, reads the result back
and acknowledges the handled delivery. An empty inbox leads to ordinary waiting,
not invented work. A saved answer at the current source revision is acknowledged
through recovery rather than answered a second time.

## The sequence

1. **Finish the document review and land the runtime.** Flex reconciles the team
   feedback on this draft. Core7 supplies the refresh implementation and focused
   host-path proof; Warp lands it on its actual approved source. Fable verifies
   the deployed capability, configured startup input, current policy and actual
   route inventory. PR 507's preflight validation change can land before this
   trial; it is no longer reserved as the first post-restart landing.
2. **Prepare one idle seat.** Fable chooses an eligible hosted actor with no
   piece or test/browser child in flight. Page5 was the original candidate,
   but its native-proof assignment may make another seat appropriate. Record
   the current actor/pin/control revision and its durable checkpoint, preserve
   every pending operation, and identify a harmless delivery that lets the new
   context read and report its recovered state without changing product data.
3. **Run the one-seat dry run.** Tony submits the prepared owner request once.
   Fable records the original operation ID, accepted intent, old/new thread IDs,
   actual activation time and actual startup input. The next delivery reaches
   the new context. Its first command and first durable board action are
   inspected. Warp records activation-to-first-action time on Tony's Timeline.
   No forecast, delivery ACK or ordinary runner start substitutes for activation.
4. **Reconcile the dry run.** Confirm a different thread for the same actor,
   correct bootstrap, unchanged controls and authority, pending-work recovery,
   no duplicate answer or test process, and a useful first action from current
   records. A failure is repaired before the broader trial. An uncertain
   external result remains uncertain and is reconciled through the same intent.
5. **Prepare the team trial.** Fable names the currently eligible hosted cohort,
   resolves the Auditor and Fable launch procedures, confirms stopped-seat
   exclusions, and chooses a small ready piece for the first landing. Draining
   unfinished turns or children preserves their receipts; it is not permission
   to cancel another owner's work. The selected piece must still be ready after
   the actual live head is reconciled.
6. **Refresh and recover.** Tony submits one hosted batch; the separately named
   external launch procedures run as agreed. Fable reports each actual fresh
   activation and any excluded or failed member. Warp stays live to observe.
   Each new agent follows its seat file and current board records, then the
   restarted team carries the ready piece through the normal landing path.
7. **Publish the result.** Warp reports the refreshed cohort, each recovery
   result and the first actual publication. The agreed primary target is less
   than 20 minutes from the last successful fresh activation in the included
   cohort to the first completed landing. Also report request-to-last-activation
   and each seat's activation-to-first-action time, so a slow startup is visible.
   A missing member is an incomplete team trial, not a shorter successful clock.

The rollout times previously mentioned are forecasts contingent on the runtime
landing and this review. No dry-run clock has started in the inspected record.

## Evidence and failure handling

Core7's scratch host tests must show exactly one replacement, actual startup
input, unchanged binding/control/history, owner-only authority, stopped-seat
refusal, waiting through an open turn, batch validation before any intent, and
ordinary restart resuming the same thread. They also need interruption and
same-intent reconciliation at creation, persistence and activation boundaries.
Synthetic app-server evidence proves the host protocol; it does not prove a
live fresh agent followed its instructions.

The live trial retains the owner request/result and intent identities, executing
runner source, old/new thread IDs, startup input, seat-file commit/hash, current
rule revision, first-command observation where available, and first durable
board-action ID/time. Missing first-command telemetry is reported explicitly;
a post saying “I ran inbox” is not an observed execution. The landing retains
its own approved source and complete receipts.

If an answer is lost, reconcile the saved original operation. Never issue a new
refresh merely because the first response is absent. A creation with no known
new thread ID remains uncertain; no second `thread/start` or raw pin edit is
allowed. Stop, owner-control or binding changes win races and are reported.
Existing history and pending work remain available while the owner resolves
the affected intent. Partial cohort completion is reported actor by actor.

The six failing native files and the two new archive/Delete outcome cases stay
separate work with named owners. Their results do not prove or disprove a fresh
context boot, and this plan adds no native or broad-suite gate to the trial.
Ordinary deployment restarts and the two historical incomplete worker histories
are also separate; their loss cause remains unknown.

## Team review and completion

Flex sends the same immutable draft to Warp, Fable, Auditor, test-steward and
all four builder lanes. Each reviewer supplies concrete failure scenarios and
required corrections, or says that its reviewed scope has no additional finding.
Flex records each finding, disposition and resulting document revision in
`fresh-agent-boot-review.md`; unresolved rollout decisions keep an owner and a
next action. Silence is not a completed review.

The document task is complete when all eight reviews are received and their
findings are reconciled, the final plan and review log are linked in Tony's
request, and remaining implementation or launch prerequisites are explicit.
That completion is not a claim that the runtime has landed or the trial ran.

## Source records

The governing request is Tony's Releases message 23370. The current runtime
scope is Warp 23369 revision 2, Core7's authority finding 23377 and Warp's batch
instruction 23378; item 1213 carries the implementation. Fable 23365 and 23368
establish the current mechanism/configuration gaps and route distinctions.
Warp's revised Releases 23352 and 23361 require this reviewed plan before the
dry run. The installed current-rule record, read fresh at execution, governs
work; the first draft observed policy 3 / Notebook 39.

Repository contracts: [seat files](seats/fable.md),
[hosted thread recovery](hosted-thread-recovery-1104.md),
[bound startup instructions](hosted-binding-instructions-1069.md), and
[the agent guide](agent-guide.md). Runtime owners on the inspected baseline are
`aim_next/codex_host.py`, `seat_host.py`, `hosted_recovery.py`,
`hosted_seats.py` and `hosted_control.py`.
