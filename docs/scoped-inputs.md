# Item 734: input reachability and scoped deployment

This candidate is build only. It does not activate workflows, change repository
variables, install a controller or replace the live tools. Installation requires
independent clearance and a quiet interval with no train in flight.

`tools/ci_input_reads.py` computes a version 2 plan from the complete committed
base..source diff. Both trees contribute readers. Static imports, literal reads,
declared dynamic reads, harness input lists, test discovery and runner inputs
are edges. A generated/system/product declaration conservatively includes every
product file; it cannot classify product as external. Product server/client
inputs reach every native step and wake replay, and all units conservatively.
Unknown changed paths or undeclared read expressions refuse scope. New/deleted
inputs use the union of both trees. Discovery/declaration/runner/controller
changes select all steps; declarations in both trees must still pass the audit.
Omitted steps carry an empty changed-input intersection and complete input hashes.
The verifier recomputes this record; a producer-selected path subset is never used.

PR planning retains mandatory units, deploy refusals and replay. Unavailable scope
falls back to a full run with a reason, never an empty green. Existing local
small-fix scope is retained as a legacy format and cannot authorize the new plan.

A version 2 scoped deployment requires an explicit train evidence reference and
an authenticated completed PR producer, tested merge and tree, source head,
event base, workflow commit/ref, run/attempt, independent controller publication,
raw per-step inventory, logs, results and cleanup. The evidence guard rechooses
coverage against the current live base before deployment. Missing/dirty/partial
or stale evidence refuses. Source and workflow heads are distinct fields.
Ordinary/no-record/base-move rules and privacy remain unchanged. No raw red is
rewritten. A synthetic all-green fixture proves validator behavior only.

The historical candidate's proposed nightly workflow is retained in the source
archive only. This composition changes no schedule or controller. It retains the
current installed job layout; no unit runner or 665/666 sharding is activated.
The scoped evidence reader can reconcile original complete Python partitions
without changing the ordinary complete-source reader or the release runner.

Retained train41/42 archives are data. The actual three-step train41 dispatch
cannot become green: shared helper readers require additional steps. The
complete computed correction scope is admissible only with exact valid evidence.
Train42's undeclared reads remain refusals until a reviewed declaration fixes
them. No historical refusal is renamed success.

## Exact evidence envelope

A train retains all existing keys and adds only `scoped: {path, sha256}`; it must
be judged-first with an exact judgment. The reference names duplicate-free JSON:

```
{version: 2, live_base: SHA, source_head: SHA, scope: computed_pr_record,
 source: {run: ID, attempt: 1, tested_merge: {sha, tree, first_parent, second_parent},
          base_at_run: {ref, sha}, workflow_head: SHA,
          archives: [{id, name, archive: {path, sha256}}],
          inventory: {path, sha256}, audit: {path, sha256},
          controller: {run, attempt, current_base: {ref, sha},
                       verdict_artifact: {id, archive: {path, sha256}},
                       published_artifact: {id, archive: {path, sha256}}}}}
```

Archives contain the original release-check and every check-N ZIP. Their API
digests, names, source run and source head must match. Native/unit inventory rows
are exactly `{name, phase, engine, expectedFailure}`. Replay retains its routed
actor inventory. The independent audit is `{version: 2, reviewer, record,
source_head, scope_sha256, source_sha256, inventory}`. `record` equals the train's
judgment audit; `source_sha256` hashes canonical source excluding only `audit`.
Canonical JSON sorts keys and uses comma/colon separators with no spaces. An
asserted reviewer string is attribution, not automatic approval: the auditor
must own and freeze this record and the inventory after reading exact source,
workflow and raw results. A builder-created synthetic record proves code paths
only and cannot approve a candidate.

`workflow_head` is retained separately from `source_head`. This PR format admits
only a workflow commit bound to its source head or tested merge. Historical manual
dispatches, including train41's separate tooling head, cannot masquerade as PR
runs. The actual train41 run remains failed and under-scoped. The complete
computed correction scope is admissible with separately valid PR evidence;
synthetic proof of that possibility is explicitly labelled.

## Tooling ownership (warp 8532)

The existing closed deploy-tool ownership contract remains exact. Input graph
and read declarations belong to `tools/ci_input_reads.py`; shard planning belongs
to `tools/unit_shards.py` (`--plan`); authenticated scoped train evidence belongs
to `tools/train.py`. These owners import their dependencies explicitly. No new
guard module or Core ownership exception is introduced. The rehome preserves
the full graph, evidence and live recheck rules above, including product inputs.
Installation is a separate decision after midnight, after the last active train
has landed, during a quiet interval, and after independent review.

## Composition onto installed 10aea (warp8817)

This is source for independent review only. The duplicate-rejecting train loader
and all existing base-move, continuation, original-source readers and own-case
receipt guards remain. `base_move` and `scoped` are mutually exclusive explicit
train keys; neither selects the other or bypasses its guard. Original complete
Python partitions are read only under the scoped evidence owner, including exact
plan/receipt/command/telemetry and complete file/case unions. No partition runner
or 665/666 workflow layout is installed by this composition.

The original nightly proposal is retained as history, without adding a schedule.
The uninstalled profile component 125e7da4fa512343111c6535cbe385252df3e46f is
excluded. Future composition must preserve all then-current approved profile and
guard fixes, including the pending final715/717 and fresh48 source bindings; this
candidate cannot preapprove those bytes. If deployed tooling moves from 10aea,
recompose and independently review before any separately authorized activation.
Installation remains forbidden here. The later gate is after midnight AND46 and
fresh48 landed AND no guard in flight, with quiet established after fresh48,
never retired47. Exact deployed rollback10aea remains unchanged.

## Recomposition onto installed 504 (warp8856)

The preceding warp8817 installation and profile status is historical. This
source-only recomposition applies its reviewed 08043-minus-10aea functionality
onto installed 50400937297be226e98cdfbc8ba03222d8472b47 (tree
625b02b548002cd32335785a791ed79dc4965ca9). Installed base-move and own-case
reader files, including all six inline profile assignments, current final715,
final717, train48 and exact adaptation bindings, remain byte-identical.
The complete graph and planner retain their existing owners. New installed
fixture reads require individually reviewed exact declarations; no wildcard
or ownership-list extension is permitted.

This head requires independent delta review and is never installed by this
job. A future quiet single installation requires both release97 and release98
recorded and no guard in flight; 648 is the first subsequent PR. If installed
tooling moves from 504 before that quiet interval, recompose and bind the
then-current source again. The current rollback is installed504, superseding
the historical10aea rollback in the preceding section. No current full-suite
pass, native measurement or runtime clearance is claimed.

## Actual36c rebind (warp8881/8891)

All earlier installation gates, profile status and rollback statements above
are historical. This bounded SOURCE rebind applies exactly e748e9c12f242e3636cf5b8bea3e985342e59ec3
minus sole parent50400937297be226e98cdfbc8ba03222d8472b47 onto actually installed
36c167bcd18df75caa535f5b62e74346319d9c3c, tree45b6d3a6bf5b0452306b01a5eaeced2f8b9f037b.
The tools/releases.py overlap adds only scoped train measurements to the current
file; its nested-count projection, _project_section, compact_measurements and
all bound/source/section verification helpers stay exact. Core16384 stays exact.
Current base_move, own_case_receipt, continuation, all six INLINE source spans,
both exact715 adaptations,717/48 source bindings, complete graph/planner,
mandatory units/refusals/replay and fail-closed declarations remain. Ordinary,
full, legacy, no-record, continuation and base_move keep their boundaries;
scoped and base_move remain exclusive. No module/ownership-list extension,
Core/web/schema/controller/schedule/toolrecord change is introduced.

Coordinator evidence records installed36c at01:32 and release97 at01:36:32,
commit3187c1bc851bdb256c272928a00dce974e2c8e48, guard exit0. Ruling8891
supersedes earlier waits: delta onto36c now, ONE independent DELTA source read,
ONE later commit-named installation, then648,738,721 PRs.48 is held until morning;
98 is no prerequisite. This job NEVER INSTALLS or dispatches. If tooling moves
before activation, rebind and independently review again. Actual36c is the
current rollback;504 and10aea remain historical only. No current full-suite
pass or independent approval is claimed by these builder checks.


## Actual97 plus item648 source bootstrap (warp8895)

This is source preparation for a later combined independent read, not approval or
activation of734. Actual97 is3187c1bc851bdb256c272928a00dce974e2c8e48;
item648 is the existing local merge b3879dc26cbd210e78eaa5c7d75ad1bae0b00d98.
The734 source candidate is63b13881bcabfca79cf6beb0ac371f060f101172 and its
installed guard/projection dependency is36c167bcd18df75caa535f5b62e74346319d9c3c.
The source common ancestor is45cee4d8d4eab3f1752e6fe3ba262f9c831ffd2b.

The planner's --plan entry lives in unit_shards.py alongside actual97's existing
unit runner. Complete input coverage replaces only PR selection. Four measured
browser bins, four Python partitions, independent Node/refusals, derived limits,
required inventory and cancellation/cleanup protection remain actual97's.
The authenticated guard owners and their existing exact source/profile bindings
are carried whole; ownership is the union of actual97 and installed36c lists,
with no new owner. Only the rehomed planner read declaration is reconciled to
its actual finite source list; all existing expression identities remain.

Readonly computation must use both actual97 and the final assembly. A refusal
is retained verbatim; no synthetic base, path subset or forced selector can
replace it. No current run, installation, PR, full suite or native proof is
created by this source assembly.734delta8899 remains a separate independent
review prerequisite; any later combined review binds both product and tooling.
