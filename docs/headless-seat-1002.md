# Add a headless Codex seat (1002)

Build contract, 21 November 2026. Owner: page-lane6. Coordinator: Fable.
Independent review and carry: Warp. Tony owns the seat's Stop/Continue control.
Starting source: live 295, `342f7facab8aebfa92b65ba19adbfc58418fb24a`.
Warp14954 orders the work onto 757's corrected source. The first green
successor freeze takes schema 63; the other takes 64 on that approved head.

## Result

From an outcome's Team panel, **+ Add** offers **Headless Codex**. The person
names the seat and describes its role, then adds it once. Core records the
invitation, outcome membership and durable provisioning request together.
The existing host provisions a native thread on its already authenticated
Codex home, installs the seat's route and makes its first delivery in the
outcome's Conversation. The actual seat writes its hello there. The page
shows preparation, refusal or confirmed readiness truthfully; an invitation
alone never means that a worker has started.

Tony opens no application, performs no new sign-in and supplies no runtime
paths. Nothing starts on his laptop. The existing manual Codex/Claude Code
invitation remains available.

## Core and adapters

The planned command is `workspace.hosted_seat_add`, with
`target: {workspace_id}`, `args: {name, role}`, and the existing authority and
workspace-revision fences. CLI `seat-add OUTCOME NAME --role TEXT` and the
page submit the same command. The command returns an actor and a stable
`seat_request_id`; the ordinary operation receipt remains the answer to
whether that submission committed. A scoped `hosted_seat` view returns the
current request state, stage and fixed refusal reason without credentials.
Final implementation names and shapes must stay synchronized here.

`seat-add OUTCOME NAME --role -` reads exact role text from standard input;
literal `--role TEXT` also works. `--operation ID` retains a caller's stable
operation, and a repeated invocation verifies and reuses its saved request
rather than rebuilding its workspace fence. `seat-status OUTCOME [ID]` reads
one seat or the bounded current team. The ordinary CLI outbox and `retry`
remain the recovery authority for an unconfirmed submission.

For a recorded, definite host refusal, `workspace.hosted_seat_retry` takes
`target: {workspace_id, seat_request_id}`, empty args and the authority plus
`seat_revision` fences. It keeps the actor, role, plan, known thread and
failure history, and resumes the same safe stage. The Team's Retry setup and
CLI `seat-retry OUTCOME ID [--operation ID]` share this act. Native starting
or persisting markers and refused settings require reconciliation; Retry
cannot create a replacement native context for an uncertain operation.

Only the outcome owner or coordinator may add a seat. Reuse the invitation
owner's name normalization, collision and team-capacity rules. Retrying the
same operation returns the same request and actor; recovery after a reload
finds that request rather than creating another thread. A changed role or a
different inviter must not silently adopt an existing actor or alter its pin.
Concurrent requests have one recorded winner or an explicit conflict.

Durable request states distinguish pending, preparing, ready and refused;
the stage identifies profile, thread, pin, route or first delivery. Actor,
request, thread and route identities stay linked through recovery. Core owns
each completed step and its failure evidence; no network or native RPC runs
inside a SQLite transaction. A lost answer is unknown until reconciled.
Membership follows the ordinary outcome/team/topic access policy and gives
the new seat its Conversation access; no private or unrelated topic access
is inferred.

## Host ownership and recovery

The current operator command takes an exclusive runner guard and the current
runner loads routes only at startup. The product door therefore needs an
explicit provisioning path in the owned running host and a guarded additive
route update. It must preserve every existing route, pin, active turn and
delivery. It must not stop the four live lanes as part of an Add action.

New seat routes live in Core's durable seat records and are added to the
runner's validated route set. The existing operator route-map file stays
byte-for-byte intact. Startup recovers these managed additions under runner
ownership; an actor collision with the operator map refuses adoption.
Managed routes have a write-once, indexed readiness sequence. Startup walks
them once; subsequent reads seek after that cursor rather than enumerating
all ready seats or supplying an ever-growing known-actor list. Public status
pages start from the bounded current team and omit large role text.

Host configuration explicitly selects the existing authenticated home,
reviewed executable, CLI, model, effort, permission mode and a dedicated seat
work root. These values come from trusted host configuration, never from a
browser-supplied path or copied actor profile. Each actor gets its own newly
written bound profile, outbox, empty work directory and native thread; none
is an alias of another actor. Keep the existing private-file, canonical-path,
runtime handshake, sign-in and echoed-settings checks. The declared role is
retained exactly within the existing 16 KiB hosted instruction limit.

The implementation must record durable intent before external effects,
capture each returned native identity before advancing, and reconcile the
same effect after interruption. Once thread creation may have happened, an
uncertain answer cannot justify another `thread/start`. Retain the orphan or
uncertain identity and a named recovery/refusal state. Never replace an
existing mismatched pin, route, profile or directory. A conflicting route-map
change preserves the other writer's bytes. Resume requires the current
runner ownership and the request's recorded fences; losing ownership stops
provisioning without adopting another host's effects.

The initial Conversation delivery is recorded once only after the route is
confirmed. It contains the role and bound CLI instructions for that actor.
Only the real actor's reply establishes its hello; setup injection is not a
fabricated model response. Stop/Continue is bound to the outcome's human
owner, Tony for this instance, rather than whichever agent invited the seat.

## Defaults and limits

The device journal bounds one saved form plus its outstanding exact request
to256KiB, allowing two full16KiB roles including JSON escaping. A stale tab
cannot overwrite another tab's confirmed draft: its write is refused visibly,
publication stops and its unsaved writing remains in that page with a leaving
guard. No cached request is sent automatically on reopening.
An unreadable saved row is retained unchanged. Its device/outcome form names
the refusal and blocks Add, while fresh typing stays visible under the leaving
guard; it does not publish from an owner whose draft failed to load.

Headless Codex uses one explicitly configured host template on the existing
home. There is no fallback to a desktop home, another home, another account,
an ambient model or a new sign-in. Missing host configuration, missing auth,
unsupported runtime/settings, path collision, pin conflict, route conflict
and uncertain thread creation each name the stage and cause. Page/CLI retries
preserve the operation identity and show the recorded partial result.

The host can name an existing hosted actor as its `--seat-template`; without
that selection it uses the unique full-mode configuration by home,
executable, CLI, model and reasoning effort. Multiple matching routes are
one template; conflicting templates refuse as ambiguous. This lane's current
non-secret configuration confirms the existing hosted home, reviewed pinned
runtime, full mode, `gpt-6.1-sol` and `xhigh`; no account/profile contents were
read to obtain those settings. The new seat receives its own role and work
directory. This first door does
not hot-add workspace-mode permission profiles to a running shared native
child: a host with no full-mode template explicitly refuses that unsupported
configuration. Existing workspace-mode routes keep their current behavior.
The optional deploy configuration `seat_template` carries that same actor
selection into the owned runner; its default remains the unique full-mode
template. It does not select a new home or copy an account.

Each asynchronous callback is bound to its original seat and step version.
A late successful creation answer is retained as an orphan thread ID on the
original refused request, with no pin, route or first task. A confirmed route
that cannot be adopted is refused per seat while existing routes keep running;
a safe retry keeps its existing first-task ID and gets a fresh route cursor.
The existing read-only runner schedule carries an indexed pending-seat flag
and latest ready-route sequence. Idle reconciliation uses these facts before
any guarded seat act, so an empty host does not claim work or poll through
write transactions.

An invitation is durable before the host can finish. A failed host effect
therefore leaves a visible incomplete seat, not a false rollback claim.
Native fixture responses prove protocol and recovery behavior, not a live
authenticated seat or production timing. No tests use the live authenticated
home or copy credentials; a real activation proof belongs to the reviewed
carry through the owned host.

## Checks and landing

Retain actual reds before fixes. Isolated real Stores check authorization,
name/team limits, idempotency, concurrent adds, cross-outcome access, exact
role bytes and receipt/status reconciliation. Fixture native processes check
handshake/auth/settings refusal, thread persistence, every interrupted
boundary, duplicate suppression, orphan retention, owner-control binding,
additive route publication and dispatch while another seat is active.
Apply routing/recovery mutations, observe their failure, and restore exact
source bytes with unique Python bytecode directories.

Client checks cover lost answers, recorded refusal, reload and retry, retained
name/role and accessible progress. Isolated headless Chromium and WebKit
exercise the actual Team control by pointer, keyboard and available touch
input at phone/laptop widths, both themes; report native-input limits and
verify Browser.close, owned PIDs/profiles and fixture exit/port cleanup.
Run only the relevant owner cohort, compare unexplained baseline failures
honestly, and coordinate one substantial workload at a time in Landing.

Warp15019 clarifies the successor order: 987 supplies schema61 and approved
757 supplies62. This source builds directly on approved757
`e6049706c764285e89442b34e01dedb61687db2d` with the actual62→63 seat step.
1004 has no approved head as this step is registered; it does not block this
build. If1002 freezes green first,1004 rebases once onto its approved head
and takes64. Only an earlier1004 approval would move1002 onto that approved
head with64. No predecessor renumbering or placeholder migration. Each lands
judged on its own run after its predecessor is live, without holding an
ordinary head. The actual first approved successor determines the later base.
Freeze when the meaningful owned checks are green, push only this exact
source branch, and send Warp one diff/test read with HEAD, test files,
pass/fail evidence and material limitations. Fable/Warp retain stage and
deployment authority; this contract is an implementation target, not another
approval gate.
