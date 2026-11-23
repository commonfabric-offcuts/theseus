# Hosted thread recovery (1104)

Default: replace a hosted seat's context after **three consecutive qualifying
completed turns** leave deliveries pending without a real CLI call. This is
same-actor recovery, not a new seat. No work is inferred from a chat sentence,
an empty first tool yield, a running tool, a timeout or silence.

## Executing source and scope

Intake is actual353 `488381d2de0becb68d2adab48f02bf9862b516ea`, schema66.
The observed supervisor/runner execute the immutable
`runner-sources/e3aaf7bc619c81ce18bf2f8228485ac19875456c/bin/aim-next-runner`,
not the mutable live entrypoint. Its entrypoint prepends that snapshot's
package root. The relevant host/Core/route owners are compared byte-for-byte
with immutable353 in the intake;353's intervening change is a test.
The selected seat's real CLI is `/Users/commonfabric/aim-next/bin/aim-next`.
Current initial provisioning is `codex_host.provision`; the coordinator's
external13216 provisioning helper is retained as an external owner, not edited.
Shipping and selecting a replacement runner snapshot remain deployment work.

This piece owns the CLI observation boundary, Core's recovery decision and
receipt, host creation/adoption, route resolution and Health. The same actor,
profile path/bytes, authority binding, human owner, model, permission policy,
writable roots and standing instructions survive. Only the hosted thread
changes. Ordinary provisioning/strict pin mismatch refusals remain intact;
there is a specific guard-held, expected-old-thread recovery transition.
Final changed paths determine ordinary versus judged. No schema migration is
planned; bounded actor/recovery records can use existing metadata.

## Evidence and count/reset rules

A qualifying turn is one unique, fully observed `completed` native turn for
this seat's current pin, with deliveries still pending at its end. Multiple
steers count once. Three qualifying zero-call turns must be consecutive.
Real actor-bound CLI entry/transport activity supplies a monotonic observation;
merely mentioning the CLI path in a command or agent message is not a call.
The existing command-text counter alone cannot prove this property.
A cursor captured before the first hand/request also covers a CLI call arriving
before the host receives the turn/start answer. Counts do not depend on a
client-supplied wall clock or a model's claim that it ran a command.

A real CLI call resets the streak. No pending deliveries, an unknown or lost
observation, a non-completed turn, an old/foreign pin, a stopped/ending seat,
an owner-control revision change or a changed binding cannot trigger recovery.
Unknown legacy/incompatible telemetry is not zero. Only instrumentation the
current runner can verify is eligible. A same-actor CLI call made outside the
model during the observed interval also resets conservatively; this is activity
observation, not proof of the model process's intent. No retrospective recovery
is inferred from old nullable CLI counts.

## Replacement and interruption

Core derives eligibility from its bounded current records while holding the
runner guard/lease and records an intent tied to the old pin, owner-control
revision, pending work and three exact triggering turns. External work never
runs inside Core's transaction. The host creates and persists one new native
thread, using the same settings and instructions plus a factual one-line
recovery reason. It does not fabricate a user answer or acknowledge work.
The old native context and Core turn/history rows remain available.

The new id is retained by the same intent before installation. Activation
rechecks the current pin, authority, control revision, pending work and CLI
observation, then atomically records the new pin and replacement receipt.
No unfinished old turn may be displaced. Stop/Continue and seat ending win
races; changed authority/profile is a refusal, never a rebind.

Route loading follows only an explicit committed, binding-matching recovery
from the configured origin to the current thread. This allows crash-safe
restart without rewriting the selected profile or silently editing a live
configuration. The normal strict pin reader and old transport remain fenced.
The host adopts only the committed destination and re-reads pending deliveries
for its next real notice. Other actors/homes and in-flight work are unchanged.

Each intent has one created/new-thread identity and one activation. A duplicate
completion, retry, late callback or runner restart must reuse or reconcile that
intent rather than start a second replacement. A definite failed creation may
be retried only after its owned child/context outcome is known. An uncertain
external result is retained and reconciled before replay; it is not permission
to invent a second context. Partial failure leaves pending work intact and
exposes the recorded failure rather than hiding a pin/config disagreement.

Health exposes the last committed replacement for **24 hours**: time, old/new
thread ids, triggering turns and reason. Expiry hides the indicator, not the
retained receipt/history. An unfinished or refused intent is distinguishable
from a successful replacement. No message body/tool output enters the reason.

## Focused proof

Use isolated scratch instances and the existing scripted app-server/real-runner
fixture path. No model, real seat, live profile/route, active installation or
user browser is exercised. Show actual CLI entry versus a path-only command;
three zero-call completed turns with pending work; positive/reset/unknown,
steer, Stop/Continue, no-pending and foreign/stale boundaries; exactly one
new-thread/pin/receipt; unchanged identity/profile/authority/old history;
pending work delivered through the replacement; 24-hour Health visibility;
and partial creation/commit/adoption failure plus restart/retry reconciliation.
Use real scratch Core effects/files and protocol/process fixtures, not booleans
standing in for a route change. Apply the relevant original owners, observe
failure, restore exact bytes and retain raw exits, source maps and all failures.
The fake app-server proves the host protocol/effect path, not native Codex
service behavior or exhaustive process history. No timing/performance claim.
