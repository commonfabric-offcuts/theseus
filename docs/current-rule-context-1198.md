# Current rule and next action (1198, delivery 1)

Authority is Fable's assignment22719, accepted Fast lane revision8 and the
current-rule Notebook n-85ea0961d1fd4e5791fed9024aa9b720. Its revision7 was the
assignment's starting source; revision20 is the final read used by this bootstrap, including adopted404 execution,
per-file continuations, scoped1194/1184 exceptions, installed1196, explicit
process-versus-coverage accounting, completed406/407 states, the explicit1200 fixture-ownership handoff and the five-feature postmortem. The bootstrap keeps those exact sources and scoped
exceptions, rather than treating a snapshot of resource occupancy as a grant.
Flex's full contract is at3eeaf824833969ce4c4e7ec48af8544457cb1f93,
`docs/fast-lane-runtime-contract.md`. This contract precedes product/test code.

## Durable rule

`current_rule.update` targets one workspace and requires `rule_revision` and
the rendering Notebook's `item_revision`. Only the existing workspace owner or
coordinator records it. It uses the ordinary bound command/operation boundary;
a retry keeps its original outcome, including a revision conflict. No DDL or
schema version changes.

The record lives at one exact versioned metadata key per workspace. It has a
stable policy ID, capability version, revision, recorder/time/operation, its
Notebook ID/revision, typed page/Core/database requirements, step owners,
sources and explicit item/piece overrides. Requirements have stable IDs and
explicit supersession references. Source references name readable public
message revisions/passages or published Notebook revisions in that workspace;
no whisper or draft becomes shared policy. Text is never parsed into authority.

The update generates a readable Notebook revision in the same transaction as
the machine record. Prior Notebook revisions and immutable command outcomes
retain the previous records and their sources. A bounded history follows exact
prior operation identities, with workspace access checked on every read.
Direct changes to a managed rendering cannot silently substitute new policy.
Nothing installs a policy by reading it or by starting an instance.

The checked-in bootstrap describes the current building-team policy and its
scoped exceptions. A coordinator applies it through the new bound command
after deployment; the builder does not impersonate that coordinator or write
live metadata directly. Other workspaces start explicitly unconfigured.

## Context

`current_rule` reads the complete current record. `work_context` accepts an
explicit workspace/piece/topic scope, or a bounded set of delivered topic IDs.
It returns the current policy revision/source, actual piece/stage/revision,
recorded own/carry/base/live heads, relevant exact-head check results and read
findings, next existing action/owner, blockers and resource uncertainty. Reads
use exact keys and indexed scoped facts, never all topics or Notebook history.

Action derives from canonical stage/freeze/approval/release/check records and
the recorded typed requirements. An item description, old stage prose,
ordinary mechanical classification or unrelated conversational ask cannot
add a requirement. Effective Core requirements survive an ordinary flag;
database work retains its judged route. A failed required reading or an
unresolved current-source read finding remains a concrete stop, with its
record identity. Clearing it with a real successor result returns the existing
action. This view creates no approval event and never moves a stage.

Missing facts are visible. A missing lane record remains unavailable until1199;
the view does not guess a builder from the topic's creator. An unrecorded push,
carry or source relationship is unknown, not a SHA inferred from chat. A live
advance yields source reconciliation while preserving the work and operation
identity; overlap/conflict remains for the existing source tool to establish.
Missing check evidence is not a pass or a product failure. A cancelled run or
setup barrier is not behavior proof, and this context does not infer a normalized diagnostic comparison from a
check name; installed1196 and its actual comparison evidence remain separate facts.

Resource admission remains the adopted execution tool's authority. Optional telemetry
is labelled unknown; context does not acquire a slot, lift a hold, manufacture
capacity or replace1195. Scoped1028 and1184 limitations remain sourced rules.

## Existing adapters

The normal CLI exposes the context beside scoped work commands and inbox/read
results; raw bound views/immutable operation outcomes retain their contracts.
The existing hosted wake path reads the same bounded Core view under the
recipient's binding and passes a compact context with its notice. Generated
notice text contains validated IDs and fixed action labels; source prose stays
data. An unavailable/truncated context is explicit and does not masquerade as
an empty rule or permission to ship. Existing pending-delivery pagination and
Stop/Continue controls remain their owners' facts.

1199's clock/lane/forecast records,1180's structured wake diagnostics and
interrupted-operation recovery, and1200's durable browser jobs are separate,
explicitly unavailable capabilities. This delivery does not create a scheduler,
perform a seat restart or claim those follow-ons installed.

## Proof

Isolated Core fixtures exercise authority, access, expected/source revisions,
atomic rendering rollback, explicit supersession/history and identical
same-operation recovery after a lost reply. Actual piece/check/read records
exercise1161's obsolete packet prose,1169's ordinary/Core contradiction, a
real required failing result and its resolution, source/live changes,
unrelated asks and unknown resource facts. Test routes use synthetic actors,
records and scratch stores only.

Adapter checks prove CLI and wake context share that Core answer, bounded
topic selection and safe untrusted text handling. A load-bearing mutation
removes the actual contradiction/failure behavior, produces a failure, then
restores exact bytes. The new tests run once on old code and pass on candidate;
every importing/source-reading consumer file runs unfiltered. Receipts identify
assertion reachability, completed/interrupted files and restoration/cleanup.

Bootstrap arguments are in `docs/current-rule-fast-lane-1198.json`. Before applying,
the coordinator rereads its named sources and current rendering revision, updates any
stale source revision/supersession in the arguments, then uses:

```sh
aim-next current-rule-update OUTCOME docs/current-rule-fast-lane-1198.json --expected 0 --notebook-expected CURRENT
aim-next current-rule OUTCOME
aim-next work-context --piece PIECE
```

The checked-in seed is evidence-backed input, not an automatically installed rule.
Core refuses a stale source/rendering fence; the original attempted operation remains
recorded and a reconciled update is a new act. Follow exact `previous` operation
references with `current-rule OUTCOME --history JSON` to read prior machine records.

Manual red/green, coverage and writing/repair timing proof stay explicit requirements,
not inferred passes. Context reports recorded typed check IDs and source approval;
there is no automatic claim that a prose report established those other proofs.

When1199 is carried with this independent delivery, replace the unavailable clock
projection with its optional `_piece_clock_context(db, actor, piece_id)` capability.
That compact clock grants no policy, queue or shipping-action authority. Preserve
1180's pending-read refusal stop before any optional context lookup, and1200's
additive job notice branch. These are explicit carry resolutions, not installed
capabilities or completion dependencies of this standalone source.

An explicit freeze-size exception routes to the existing carry/read landing path.
The view names the configured freezer as the required carry reader and labels
that external exact-head read unavailable here. It never manufactures a carry
SHA or approval, and required failures/source findings still take priority.
