# Booting Theseus with fresh agents

Tony will physically reboot the Mac, discard scratch files, and open new Claude
terminal sessions and Codex threads disconnected from the previous conversations.
Every building agent starts fresh, including Warp. The proof is that Fast lane
then ships with low prediction error using repository instructions and durable
Theseus records, without agent memory. An idle-seat or hosted-batch refresh is
preparation only; it cannot satisfy this whole-system test.

Flex owns this plan and its team review. Core7 owns hosted refresh (1213), Core8
owns removing stale hosted role input (1216), Fable coordinates durable readiness,
and Warp owns the repository instructions for service/runner startup and landing.
After the physical reboot **fresh Warp** performs that role; no old agent remains
as observer or rescuer. Tony initiates and witnesses the reboot. Fresh Warp and
Auditor reconstruct timing from durable records, not a surviving stopwatch.

This revision follows Tony's clarifications 23423 and 23438 and is awaiting
focused review of that wider scope. The [review log](fresh-agent-boot-review.md)
keeps the eight reviews of the original draft separate from this review and
from runtime/trial evidence.

## Tony's first terminal after reboot

Fresh external Warp boots Theseus. Tony’s local copy of the launch command and
first message is `/Users/commonfabric/warp-seat/KICKOFF.txt` (Warp 23471). Warp 23462 supplies this concrete launch
procedure; install and verify its seat-file version before the physical test.
The service and runner have no automatic launch agent on the observed Mac.

Open a new terminal and run:

```sh
cd /Users/commonfabric/warp-seat && claude --dangerously-skip-permissions
```

Warp created that empty durable directory for the trial. Start there rather than
`/Users/commonfabric/aim-next`, whose Claude project memory is populated. Also
complete the broader memory-input audit; an empty starting directory alone does
not prove that no global or attached memory was loaded. Do not resume an old
Claude session. Paste the owner-supplied first message:

```text
/loop You are warp, the landing seat of Theseus on this Mac. Your instructions are /Users/commonfabric/aim-next/docs/seats/warp.md. Read it and follow it, starting with its After a reboot section.
```

That role file must contain the same boot entry, persistent helper/config
locations and checks. Fresh Warp starts the service and then the safely gated
runner using it. The proposed cold-stop drill must test this exact directory,
launch, input and commands, including availability of the supplied `/loop`
mechanism. No remembered command, restored terminal state or old watcher supplies
missing boot instructions. Warp's 23454 forecast is docs at14:45, dry run about14:50,
physical reboot15:15 Pacific, contingent on the named prerequisites; it is not
proof that any of these has happened.

## Current capability and prerequisites

The inspected baseline is release 418,
`e0423628964aafea8389d11a29ec4ab38fc13da8`. Release 419,
`ce13ce60ce08adb63a83ade879cc637a4efbe4d9`, subsequently shipped item 1214's
landing-tool validation. Neither release establishes the new manual refresh. The subsequently observed
release420 (`1e6c6d788ed49c82e75b32b62361e2475cd882c6`) is the web-only1217
Undo repair; it also does not establish1213/1216 installation.
An ordinary runner restart resumes the pinned thread. Existing automatic 1104
recovery can replace one under its qualifying conditions. Installing repository
seat files did not configure agents to read them.

Item 1213 adds owner-authorized hosted refresh and the seat-file pointer.
It preserves configured role bytes. The separate 1216 successor changes assembly
to use the repository role when the verified seat file exists, retaining trusted
binding instructions and explicit missing-file behavior. Both must land before
claiming the stale-role problem is resolved. No hand edit of generated managed
route files repairs their durable source coherently. Its
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
before execution. This inventory covers every building actor named in Tony's request; other
globally registered actors are not silently added. Health's lack
of a route is not proof of Stop or proof that no external session exists.

| Actor | Route being replaced / current observation | **Target at the reboot** |
| --- | --- | --- |
| **Flex** (`flex`) | Hosted, managed seat | Included in the eligible hosted batch; 1213 uses the actor ID. |
| test-steward | Hosted, managed seat | Included when controls and current work permit refresh. |
| core-lane7 | Hosted, operator-mapped lane | Included after 1213's own work is safely handed over; no managed seat-request row required. |
| core-lane8 | Hosted, operator-mapped lane | Included; a possible dry-run candidate only if actually idle then. |
| page-lane5 | Hosted, operator-mapped lane | Included after preserving current piece/worktree/producer state. Building 1215; not assumed idle. |
| page-lane6 | Hosted, operator-mapped lane | Included; another possible candidate subject to the same live checks. |
| Auditor (`auditor`) | Runner dispatches `codex_queue` jobs to an existing Codex thread | **Hosted under the runner**, migrated after 1216 lands. Retire the queued consumer through the supported migration. At reboot use 1213 for a fresh same-actor thread with repository instructions. |
| Fable (`fable`) | Codex desktop chat outside the runner | **Hosted under the runner from the reboot onward**, with supported same-actor migration and coordinator/watch handoff. Starts fresh through the hosted bootstrap/refresh; no external Fable chat after reboot. |
| Warp (`warp`) | Claude Code session on this Mac, outside the runner | Required: Tony opens a new Claude terminal session from the durable Warp seat file after reboot, without resume/history or private memory. Fresh Warp starts service/runner, observes from records and lands. |
| Team / team-agent (`team` in bound Health) | External Codex Team chat identified by Fable 23434 | Required: new Codex chat/thread plus `docs/seats/team.md`, trusted binding and single coordinator/watch ownership. Old chat continuity does not prove Stop state or authorize replacing automation. |
| designer | External Claude Code remote-control session in the Loom project, identified by Warp 23437 | Required: new terminal/remote-control session plus `docs/seats/designer.md`; isolate the project memory too. Reusing its old session is not the final test. |

All eleven rows need a verified fresh boot. A missing launcher or role file is
a prerequisite to finish, not a route-based exclusion. Previously stopped work
remains stopped; if the required cohort conflicts with a recorded Stop, resolve
that explicit control with Tony before execution. A missing or failed actor
makes the whole-system trial incomplete. Fable prepared Team/designer files in `5868996c`; the combined docs carry
PR509 includes them. Their actual installation and owner review precede boot.

### Fable and Auditor move inside

Tony 23459 accepts hosting both, and Warp 23486 states the target: one wake/refresh/Stop lifecycle,
repository role input and supported activation receipts simplify cold boot.
Auditor's separate authority and independent evidence reads remain intact.
Auditor is the simpler first migration; Fable also needs coordinator/subscription/
watch parity and a single-owner handoff. The tradeoff is a shared runner failure
domain and loss of desktop conveniences; external Warp and human-readable Health
must expose service/runner failure. This planning decision does not itself perform or grant an unsupported route mutation. The current-route column is historical input to retire; the target column is
what this test requires. A supported conversion preserves identity, permissions,
unread work, private-message boundaries and original operations. No double route
or coordinator may remain. Lock the chosen architecture before the physical test.

## What may survive the physical reboot

Only the durable installation/configuration, repository and Theseus records are
the operating manual. Preserve authentication and bound identity without copying
credentials into documentation. Preserve original history for audit, but do not
resume it or inject a summary from it into fresh contexts.

Before the reboot each owner audits its dependency closure: scripts, hooks,
profiles, kit configuration, outboxes, source/evidence and startup entrypoints.
Move required scripts out of temp into a supported durable location, with tracked
source/integrity evidence and repository instructions. Commit/push unfinished
source and attach durable evidence/checkpoints to the existing work; a pointer
to a disappearing scratch worktree is insufficient. Record reconstructible
branch/head and exact evidence identities. Recreate temporary worktrees/fixtures
from those records after boot; never depend on an old PID or shell variable.

Disable or set aside every auto-loaded personal/project memory store before new
sessions open: Claude's memory index, Fable's private STATE/MODEL files, and any
Codex startup/compaction/continuation input. Each owner names the actual mechanism
and checks the effective new input. Do not erase authentication, board data or
history as a substitute. Missing operating knowledge goes into reviewed repository
role/runbook files or current canonical Theseus work records **before** boot.
No private outgoing recap, old transcript, scratch file or human-supplied task
answer may bridge a gap during the test; record the gap and failed dimension.

The boot entry must be installed in the durable repository, discoverable from
Tony's fresh terminal without Theseus or a running agent. A branch link or this
scratch worktree alone does not meet that requirement. Warp's seat file must
name the persistent local installation, bound CLI and service/runner startup
commands, supported config locations, health checks and failure recovery. Verify
those commands with no inherited environment or temp dependencies before reboot.

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

Correct prompting requires 1216's repository-role assembly and the reviewed seat
files, with trusted binding/permission instructions retained. Fable 23434 found
stale input across all six hosted seats; managed roles come from durable
`seat.role` and operator lanes from their configured instruction files. Core7's
1213 pointer alone does not fix those conflicts. Core8 owns the separate source
change; Fable and each role owner review the effective input and fix contradictory
seat-file instructions, including hosted watch loops. Retain the actual baseline
and serialized startup bytes, not merely a promise that the file exists.

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

1. **Finish the durable installation.** Land and verify 1213, 1216 and reviewed
   seat/runbook changes, including Team/designer files. Fable locks all eleven
   actors, their routes, controls, memory isolation and launch owner. Warp supplies
   service/runner start and graceful-stop commands from the installed release;
   Fable supplies exact owner refresh/status commands and external launch inputs.
   Existing deployment can keep a runner or resume old pins; neither proves this
   boot. Freeze the execution bundle and lock its source/config hashes.
2. **Prove the hosted path on one actually idle actor first.** Check bound
   Health, no open turn/piece, final producer manifests, Browser.close/fixture
   exits and PID/profile/port absence. Empty mail is insufficient. Choose another
   actor if ownership is uncertain; no basename kills. Tony submits once; send
   the identified harmless delivery **after acceptance, before waiting for
   activation**. Intent dispatch must replace before ordinary sending. Observe
   new identity, effective kickoff/file read and action. This is a dry run, not
   the physical reboot or final all-agent success.
3. **Make the pre-boot state durable and quiescent.** Owners finish or safely
   checkpoint outstanding work and reconcile original uncertain operations. Drain
   owned producers with complete receipts; do not cancel someone else's work.
   Record current worktree/branch/base/dirty state, pushed recovery head, durable
   evidence, original clocks/forecasts, unread gaps and operation IDs. Relieve old
   coordinator/watch ownership explicitly. Stop the old runner/supervisor and
   external watches/sessions through their supported owners. Record stop/cleanup
   facts and any uncertainty before Tony's physical reboot.
4. **Record time zero and physically reboot.** Tony records the initiating
   owner action and persistent trial ID before shutdown. He reboots the Mac and
   removes the agreed scratch/memory inputs. No old process/session or observer
   supplies continuity. Do not start a replacement from a remembered terminal
   command; use the installed repository boot entry.
5. **Start fresh Warp and the service.** Tony opens a new Claude terminal with
   the absolute Warp seat-file kickoff and trusted bound identity, no resume or
   old project memory. Fresh Warp follows repository instructions to start the
   service at the recorded live release, verifies bound reachability and records
   new service identity/start time. Warp 23440 reports no automatic service or
   runner startup on this Mac; this step cannot assume launch agents exist.
   Warp's proposed durable entry (branch `warp/seat-file-reboot`, `cfdf6102`)
   names `~/.local/share/theseus/warp/land/start-server.py`,
   `start-runner-with.py --seat-template core-lane7`, then
   `normalize-runner.py --check` expecting `VISIBLE`. These helpers/configs
   must pass the persistence/dependency audit and cold-stop drill; the next
   step's dispatch-order question must close before using runner startup.
6. **Tony admits refresh before the runner starts.** Fresh Warp posts the
   exact owner-bound command for all eight hosted actors, ready for Tony to
   paste. Tony submits it once and relays the saved result; neither Warp nor
   Fable submits on his behalf. The batch includes Flex, test-steward, four
   lanes, and the supported migrated Fable/Auditor. Use the installed contract:
   `seat-refresh building-theseus ACTOR [ACTOR ...] --operation SAVED_ID` and
   `seat-refresh building-theseus ACTOR [ACTOR ...] --status` through Tony's own
   invocation. Retain the operation ID, each intent and the receipt before
   starting the runner. Core7 23495 confirms owner admission while it is stopped
   in two executed real-host/scripted-app-server cases on `2f908c9f`. Startup
   may attach/resume an idle old pin; this is not a model turn. The next delivery
   must be intercepted for replacement before any old-context turn. Actual
   deployed/native behavior still needs the dry run. Fresh Warp then starts
   and verifies the runner, sends the identified first delivery to hosted Fable
   after acceptance, and fresh Fable seeds the other accepted actors before
   waiting for activation. Tony opens a new Team Codex chat and designer's new
   Claude terminal; no external Fable chat continues after reboot. Record each
   real new context and actual input. If admission or migration refuses, keep
   the runner stopped and report the exact result rather than resume old work.
7. **Recover ownership and useful work.** Fresh Fable verifies current pipeline,
   rules, original operations, unread gaps and watch/coordination ownership;
   starts no duplicate desktop watcher. Fresh actors recover assignments even
   with empty inboxes. Fresh Warp reconciles the landing lock, original landing/
   publication receipts and actual live source before any next landing. Auditor
   independently reads the same durable evidence. Tony observes; no old-agent
   instruction or private memory participates. Unknown identity/input/read facts
   stay unknown rather than being replaced by self-reports.
8. **Ship with the fresh team and measure forecasts.** Fresh Fable and Warp
   carry a real eligible piece through normal freeze/landing/publication, with
   supported attribution to new contexts. The earlier 1215 freeze-only hold can
   provide the first causal act, if its real failures and readiness permit. Then
   evaluate the predeclared forecast cohort below. Do not treat a preapproved
   piece, unchanged lander or correct-looking recovery post as the whole proof.

No physical reboot or fresh activation is established in the inspected records.
1215's revised LIVE forecast is15:35, separately sourced by Warp23480 and
Page523484 to the planned15:15 reboot; original14:40 remains. This is a forecast,
not proof of publication. Its freeze-only hold was applied at `2026-11-24T13:19:42.450000-08:00` (Fable
23422). It overlaps active proof and is not all idle labor. Preserve inspection
`12:51:24.239312`, construction `13:05:24.824831`, machine Build and original
PUSH `14:05` / HANDOFF `14:20` / LIVE `14:40`; record hold release and revised
forecasts separately. A newly reached product failure is not waived for the boot.

## Shipping and prediction acceptance

The aim is reliable Fast lane shipping from durable knowledge. Starting threads
is a readiness observation; one landing is initial recovery evidence, not a
claim of sustained low prediction error.

Warp23514 adopts a second reported result, **not a shipping gate**: take the
first five pieces that land after reboot, whatever their work type. Report all
five live within45 minutes of the first one's Build, and at least four within15
minutes of their lane's first LIVE prediction. A miss is reported, not a stop.
If fewer than five are ready, state the actual number and incomplete result;
do not select a favorable replacement cohort. This sourced disposition replaces
the earlier proposed next-five-product/per-piece45-minute interpretation.

Keep each original Build and first prediction, including continued pre-boot
work such as1215. Its deliberate hold must not be erased by a fresh Build clock;
if that first piece's original Build predates reboot, the45-minute interval
includes that time and may already miss. Show that fact and the hold separately,
rather than reinterpret “first one's Build” silently. Fable/Auditor reconcile the
recorded numeric result against the original canonical clocks.

For genuinely new work, record the fresh lane's first forecast before construction
at its actual original Build/source-inspection boundary, then actual source,
push, handoff and completed publication times. Keep later forecasts/reasons
separately. Signed error is actual publication minus that first prediction;
absolute error is its magnitude. Report each error, all target hits/misses,
completion rate and maximum error. Missing originals remain missing; no medians,
backfill, reset clocks or favorable reselection. Continued pre-boot work retains
its original forecast and a separately labeled fresh recovery forecast; it is
not silently substituted for a wholly post-boot prediction.

The inherited boot-speed target remains under20 minutes from the **earliest
initiating owner act of the physical trial**, including graceful shutdown/reboot
if that begins it, to completed first publication. Warp 23419/Fable 23422 revised
the earlier last-restart/last-activation definition. Retain each route's request,
acceptance, activation and first warranted action; service/runner stop/start;
first/last activation span; request-to-last-activation; first- and
last-activation-to-publication. Fresh Warp reconstructs these from receipts and
message/release times. Unknown timestamps and failed members remain visible.
The revised15:35 forecast is exactly20 minutes after15:15; it is not an
under20-minute result, and an earlier initiating shutdown makes the interval
longer. Preserve that forecast without scoring or shifting time zero to fit it.
Speed, product acceptance, forecast error and independence from memory receive
separate verdicts; a fast reboot cannot compensate for unreliable shipping.

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

These must close with actual supported procedures/receipts before the physical
test; missing mechanisms do not justify excluding their actors.

| Owner | Required next action |
| --- | --- |
| Core7 / Warp | Prove and land 1213; publish installed owner submission/status/continuation syntax, guards/coalescing and trace fields. Retain the confirmed admission-before-runner contract (23495) and verify its deployed/native dry-run behavior. |
| Core8 / Fable / Warp | Land separate 1216 after 1213 and verify repository-role assembly without stale configured instructions; preserve trusted binding and missing-file behavior. |
| Fable / role owners | Finish the eleven reviewed seat files and memory/dependency audit. Team/designer files and corrected hosted wait instructions are prepared in the combined carry and need verified installation; all required source/scripts/evidence must survive without scratch. |
| Warp / Tony | Install the repository boot entry, exact service/runner stop/start and verification commands; prepare fresh Claude terminal inputs with no auto-loaded memory. A new deploy/release is not fabricated for a same-release restart. |
| Fable / Tony / runtime owner | Supply supported hosted migrations for Auditor (after 1216) and Fable (at boot), plus fresh Team Codex and designer Claude launches. Preserve actor/binding/operations/controls; prevent duplicate routes/coordinators. |
| Fable / Warp / Auditor | Lock the all-agent manifest and trial clocks, causal first landing, forecast cohort and numeric interpretation; retain holds/failures and original delivery clocks. |

The separate native 1215 work and inherited six failure families retain their
owners; their results do not establish fresh boot. The two historical incomplete
worker histories retain unknown loss causes. This plan attributes neither loss
to runner restart without evidence.

## Sources and document status

Tony's request is Releases 23370; 23406 exposed omitted actors, 23423 states the
memory-independent Fast lane objective, 23438 requires physical reboot and loss
of scratch, and 23442 asks about hosted Fable/Auditor. Warp 23425/23426/23440
adopts all-agent/service/runner scope and repository-only cold startup. Fable
23434 identifies Team's external chat and all-six role conflicts; Warp 23437
identifies designer and the role-source follow-up. Core7 23439 selects separate
1216; Fable 23441 assigns it. Current inspected live is 419 / `ce13ce60`; runtime
work is not claimed deployed. Execution reads current policy afresh.

All eight requested reviewers read draft `3d27c16fe8da77c8b33360b839289ba578cc393f`.
Their findings are reconciled in the log; the material whole-system revision
requires its own focused review. Neither eight earlier replies nor this document
establish final operational approval, runtime readiness or successful reboot.

Repository contracts: [seat files](seats/fable.md),
[hosted thread recovery](hosted-thread-recovery-1104.md),
[bound startup instructions](hosted-binding-instructions-1069.md), and
[agent guide](agent-guide.md), subject to the trusted actor/wake instructions.
Inspected runtime owners are `aim_next/codex_host.py`, `seat_host.py`,
`hosted_recovery.py`, `hosted_seats.py` and `hosted_control.py`.
