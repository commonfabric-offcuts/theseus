# Broker refusals retain retry identity (978)

Base: release252 `3d8756b464971dd16b064591e4d6693564768fd5` under Warp14318.
This follows approved662 cc7834f5 under Warp14258. It changes
workspace broker edges only; the approved662 branch stays frozen.

When all eight execution slots are occupied, the acceptor drains one complete
bounded request frame before returning BROKER_BUSY. It never calls Core for
that attempt. The existing frame limits and deadline also bound the discard;
a stalled or malformed peer cannot promise a valid-frame receipt. This keeps a
large valid write from losing the busy answer to an unread Unix socket close.

Known command refusals use the Store receipt shape: instance_id, operation_id,
kind, status (retryable or rejected), recorded:false, result:null, affected:[],
and the typed error. This is an attempt result, not evidence that an earlier
operation did not commit. Retry preserves the saved operation identity. A
connect failure remains BROKER_UNAVAILABLE, exit75; uncertain responses remain
uncertain and never acquire a false not-recorded result.

A changed route pin returns ROUTE_PIN_MISMATCH and says nothing was sent by
this attempt. It cannot silently drop a connection or rebind the actor.
Failure to start the broker worker settles only that route unavailable, with
owned partial resources cleaned. The host's route/policy/proxy refusal codes
have specific Health words; the recurring Health gate recognizes either Python
quote style. Existing eight-slot execution, full-access policies and Core
authority remain the owners. No schema, live records or installation changes.

Each requested behavior gets an actual failing check before the correction.
Scratch socket/Core/host fixtures prove large-frame refusal, exact generated-id
JSON retry and route isolation; applied/restored controls hold recovery/routing.
The final receipt will name the actual source base, tests and limits.

Verification: the final coupled201/201 checks pass in76.430s: the six new
broker cases, the existing four662 classes, CLI, route, notice, Health and938
deploy/runtime fixtures. Default discovery runs exactly the six new cases,
all passing; fixture imports do not add their parents' cases to this module.
Five applied controls (drain, receipt identity, pin refusal, worker isolation
and Health words) fail and restore byte for byte to green. The actual pre-fix
failures are retained separately from the initial fixture-alias diagnostic.
No browser, authenticated model turn, live record/config or installation write
was used. Wider host/control failures previously disclosed for662 remain
outside this cohort; no broad all-suite claim is made.
