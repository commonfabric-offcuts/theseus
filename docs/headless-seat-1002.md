# Add a headless Codex seat (1002)

Build contract, 21 November 2026. Owner: page-lane6. Coordinator: Fable.
Independent review and carry: Warp. Tony owns the seat's Stop/Continue control.
Starting source: live 295, `342f7facab8aebfa92b65ba19adbfc58418fb24a`.

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

Headless Codex uses one explicitly configured host template on the existing
home. There is no fallback to a desktop home, another home, another account,
an ambient model or a new sign-in. Missing host configuration, missing auth,
unsupported runtime/settings, path collision, pin conflict, route conflict
and uncertain thread creation each name the stage and cause. Page/CLI retries
preserve the operation identity and show the recorded partial result.

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

Live 295 is schema 60; corrected 987 supplies 61 and frozen 757 supplies 62.
The new durable state needs a coordinated successor migration, with no
renumbering of either predecessor. Resolve that source composition before
freezing. Build in parallel; 1002 lands judged, on its own gauntlet after
987 and 757 and the other queued work, and never holds an ordinary head.
Freeze when the meaningful owned checks are green, push only this exact
source branch, and send Warp one diff/test read with HEAD, test files,
pass/fail evidence and material limitations. Fable/Warp retain stage and
deployment authority; this contract is an implementation target, not another
approval gate.
