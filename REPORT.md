# 740 corrected fit-first builder return

Ready for independent review of warp9266's corrected contract; not installed or
self-approved. This fresh builder started exactly at
`9c7bf7cc0a69c7bf14c529ae9b94592dbee546e5`, tree
`5d09bd68bb0630dcaf8ee2d14b81eb04413f9404`. Its parent is live98
`851471193d72f88312d428bb9e0383dae887a4e0`. The corrected commit's exact head,
tree, parent chain, paths and diff hashes are in external `FROZEN-RETURN.json`.
No old session was resumed or earlier frozen evidence edited.

## Delivered behavior

The runnable default is `browser-120m-fit-first-v1`: 120-minute browser capacity,
5-minute setup/upload reserve, 1.25 times the maximum retained observation by
step name. Long steps (over46 measured minutes), partial observations and unknown
steps run alone. Unknowns use full capacity with null timing, never a median.
Stale observations remain useful timing; `replace_browser_observations` replaces
those steps after the next run while preserving other steps and leaving raw
verdicts alone. Source/runtime/inventory equivalence is retained as provenance,
not reinstated as a timing gate. An actually observed padded step that exceeds
120 alone refuses explicitly, without emitting an incomplete plan.

The default full plan has **18 browser bins plus seven unit/replay jobs**:
48 native steps exactly once, 52 logical required steps exactly once after
combining Python's four partitions. Of38 observed native step names, four bins
are isolated by long/partial observations; ten unknown modes each run alone.
No observed maximum exceeds the capacity. The requested four initial bins are a
packing preference. The resulting25 jobs are a plan, not permission or dispatch;
the future18-start piece ceiling grants this builder no starts.

Python runs exactly its existing four file partitions, each alone with a
49-minute job capacity, including Python4. Before/after receipts prove identical
partition indices and file membership. Historical estimates still include setup;
discovery/import/load hooks remain in the runner's wall accounting. Existing
allocation fallback is unchanged to preserve inventory, with no new-file timing
promise. Node5, deploy-refusals3 and replay45-minute limits remain independent.
Conservative item734 selection, raw collector, continuation and cleanup code
retain their semantics. The workflow consumes each matrix job's actual capacity.

Run the full default without a server, profile or hosted workload:

```sh
/usr/bin/python3 -I tools/unit_shards.py --plan
```

For GitHub transport, append `--github-output`; the existing workflow invokes it.
The external `DEFAULT-PLAN.json` contains every runnable job, Python file and
observation provenance; `COVERAGE.json` names every required step, all ten unknowns,
partial bins and the deterministic reversed-input check. No cases are removed,
truncated, split, or accepted as a completed prefix.

## Original measurements and cut truth

Evidence root:
`/Users/commonfabric/.local/share/theseus/fable-tools/checks/740-fit9266`.
`retain-timing.py` independently reads original ZIP summary/report/log members
and compares their bytes/hashes with retained files. Eight browser ZIP receipts
and the original Python cut/completion ZIP members were read. The earlier ledger,
case inventories, retained cut receipts, ZIP-byte check and continuation union
were read without modification. Current compact timing metadata has81 rows:
59 original PR86/train49 completed summary observations, seven browser3 completion
observations, two original partial-job final-report case-time sums, one compose
progress lower bound, and twelve train45 completed log intervals. Five further
original partial-job final reports retain their named inventories without timings;
their missing durations are never invented.

`SOURCE-BOUND-MEASUREMENTS.json` and `CASE-INVENTORIES.json` retain source, case
count/hash, runtime provenance, raw failure/exit where recorded, original ZIP and
summary/report/log hashes, and explicit timing qualifications. These inputs are
not acceptance certificates. Train45 intervals include preflight/transition and
lack complete named inventories; those inventory hashes stay null. Original
partial jobs still lack final summaries. Browser3's returned completion was read;
browser4 run44348397828 remains untouched, with no completion inferred. The
650/721 own-case job walls were read as context and are never whole-compose bounds.

The compose progress receipt has768 case rows, only two of eight planned phases
complete, and `harnessCompleted:false`. Successful-case times sum to1955.686s
(32.595m), excluding failed-case times and overhead; that is the seeded lower
bound, isolated in its own120-minute bin. The original rail-result-to-cancellation
interval is2786.362902s (46.439m), including transition. `COMPOSE-TRUTH.json` retains
both timestamps and the exact log hash. **No completed82-minute compose receipt
was located or asserted.** Warp's reference is not converted into a measurement.
The lower bound cannot promise that the complete expanded compose fits.

`PYTHON-CUT-TRUTH.json` preserves the original18-minute train49 Python4 cut with
no final summary, and the separate run44339276514 completion: sourcebed0a0d4,
1014 tests, raw `OK`, exit0, 809.845373s step wall, 809.019251041s runner wall.
Its exact4/4 inventory and per-file accounting remain recorded. The original
73755-minute cut has2624 terminal OK records and no `Ran …` terminal or final
summary; it remains incomplete. Raw hashd7e07ed2… was checked against its original
ZIP member. The retained actual PR86 whole-unit and train49 Python4 wrappers both
carry `timeout:49`; their exact workflow paths/hashes are in the truth receipt.
This change does not relabel either old cut complete or claim whole-suite49-minute
validation on the corrected source.

The recovered tested objects0790c718/5896b131 exist in coordinator's separate
`codex-740-sourcefit9264` clone; this clone does not contain them. That difference
was observed and is not a gate. No complete-input equivalence is asserted.

## Focused verification and limits

CPython3.9.6: **55 focused checks passed**, final run11.736s. Coverage includes
planner/default policy, item734 conservative selection, workflow matrix transport,
collector missing/duplicate/raw-red/partial truth, Python exact file union and
limits, and four existing continuation union/cleanup contracts. Bytecode prefixes
are unique and effective for each mutation/restored run, including instrumented
Python child processes. No browser/native case, whole Python/Node suite, Pool,
server, signal or hosted workload ran: prior0, allocated0, actual0.

`red.log` and `red-behavior.log` record the genuine inherited-policy failures for
stale/unknown and partial timing. `focused-final2.log` is the restored final run.
`MUTATIONS.json`, nine diffs and `mutation-*.log`/`restored-*.log` prove applied,
caught and exact-hash-restored source changes for missing step, duplicate step,
dropped unknown, overfilled bin, missing reserve, wrong factor, stale refusal,
rewritten raw failed result and hidden partial coverage. An initial weaker
cancellation-guard mutation survived; `attempt1-*` retains that attempt. The
replacement directly corrupts raw failed results, and a separate mutation drops
missing partial coverage; both are caught. No failure is waived as a product pass.
The input audit first refused symbolic HEAD, then found an undeclared read in
the new default-plan test. Its exact weights input is now declared; the final
exact-SHA audit passes in `INPUT-DECLARATIONS.json`/`input-audit-final.log`.

No newly measured host setup guarantee, full expanded-compose upper bound,
future-image stability, new source equivalence or hosted completion is claimed.
Unknown/stale timing requires the next run and metadata refresh; it does not
block planning. The bound CLI read attempt returned `AUTHORITY_CHANGED`; warp9266
was then read in full using `sqlite3 -readonly file:…?mode=ro`. No profile content,
identity key, session, token or credentials were read or printed.

## Coordinator install/revert proposal (not executed)

1. Independent auditor reads SPEC-NOTE.md, this corrected contract, exact diff,
   frozen source receipt, original measurement/cut truth and default plan.
2. In a separate clean coordinator-owned **future-cut source** worktree, apply
   the cumulative tooling change from live98 to the frozen corrected head. This
   requires both inherited9c7bf7cc and this correction, not this correction alone
   on live98. Use the exact cumulative patch in external`FROM-LIVE98.diff`, or
   cherry-pick those two exact commits in order when the receiving source permits
   it. Resolve conflicts against the future source; never copy a live tree over it.
   Carry `.github/check-weights.json`, `.github/workflows/checks.yml` and
   `tools/unit_shards.py` together, plus `tools/ci-input-reads.json`, docs and
   focused tests.
3. Before the next newly authorized cut, make that source the coordinator's
   installed base/ref for **future** train worktrees. `flight.py train-cut` selects
   names through installed`steps-for.py` and the candidate's committed source;
   actual shard planning runs from the candidate's own workflow/planner/weights.
   Therefore changing only an external helper or report would not install this
   policy: verify those three candidate files' hashes against the frozen receipt,
   run `--plan` at its exact commit, check48/52 coverage, then record the new cut.
   Do not amend any already-cut/in-flight source or frozen wrapper. No current
   landing waits for this installation. Live application deployment is not part
   of this tooling install; this builder touches neither live tree nor tools.
4. Retain the receiving source's prior commit and exact prior three file hashes
   as the install receipt. Revert via a new reviewed commit restoring that prior
   planner/workflow/weights coherently (or revert the two tooling commits in reverse
   order on a clean compatible branch). Verify the restored default at its exact
   source. Future cuts use the restored source; existing jobs and original evidence
   stay intact. Never reset live trees, overwrite later edits or rewrite history.

This builder made no store/board/stage/flight writes, install, push, PR, deployment,
credential access or delegation. The exact committed return is for independent
review; it grants no start allocation and no self-approval.
