# 740 frozen builder return

This is a browser planner/measurement correction from live98
`851471193d72f88312d428bb9e0383dae887a4e0`, on `fable/740-sizing9235`.
It is ready for the coordinator's independent review, **not installation**.
No self-approval, PR, push, install, dispatch, cancellation, deployment, store
mutation or delegation occurred. Pool/browser starts: prior0, allocated0, actual0.
The final commit/tree/parent/path receipt is external `FROZEN-RETURN.json` in
`/Users/commonfabric/.local/share/theseus/fable-tools/checks/740-sizing9235`.

## Result

`tools/unit_shards.py` keeps item734's conservative selection and adds deterministic
whole-step packing within a named capacity. Old scalar browser weights no longer
supply completion bounds or a median for new modes. Eligible observations bind
committed complete input fingerprints, source commits, complete `(phase, name)`
case inventories, actual step wall times, final summaries and reported cleanup.
The planner uses the maximum fitting observation and retains its provenance.
Different inventories for the same input fingerprint refuse. Failed completed
steps may inform timing, without changing any raw verdict.

The proposed policy is `browser-90m-refuse-unmeasured-v1`: 90 configured minutes,
5 minutes reserved for setup/upload, and 1.5 times the measured whole-step wall
sum. Extra whole-step bins replace overfilling a requested four-bin deal. Unknown,
stale, incomplete or individually oversized steps refuse the entire browser plan.
No prefix acceptance, case truncation/splitting, automatic limit escalation or new
continuation acceptance route exists. CLI refusal exits2 and emits no matrix.

**There are no eligible seeded observations.** The retained tested merge objects
for PR86 and train49 are absent from this clone; complete source-input equivalence
cannot be established. Old durations are retained as history, not relabelled as
live98 measurements. Thus a full browser plan currently refuses. This is the named
conservative fallback, not a claim that a fresh run will finish or that the
throughput problem is fully solved. The measurement API/schema is documented in
`docs/shard-budgeting.md`; the original early contract is `SPEC-NOTE.md`.

## Measurements and retained truth

The external `SOURCE-BOUND-MEASUREMENTS.json`, `CASE-INVENTORIES.json`,
`LIVE98-INVENTORY.json`, and `RETAINED-CUT-RECEIPTS.json` retain source and step
identities, inventory hashes, per-step timestamps/durations, original artifact
hashes and explicit fit limitations. No large artifacts enter the repository.
The live98 inventory has48 native steps and52 required logical steps.

| Record | Source | Observation | Fit/limit |
| --- | --- | --- | --- |
| Train44 reading | 4b565b2a18d63724491c8db058dc07d927f6e1d0 | 1694.395223s;259 cases | Original summary directly read; historical comparison only |
| Train45 reading | 63a1ad488da90a4e0e55fec11a9c8ca15e4ee158 | 3845.305875s;412 cases | Release-command/result delta includes preflight; not exact inner step upper bound |
| Train45 WebKit reading | same tested source | 2872.871818s;400 cases | Same log-delta limitation |
| PR86 reading | 5896b1312642199a8717cd3398dda97accf2f4f3 | 2995.354952s;398 cases | Finished step; complete input fit unproven |
| PR86 WebKit reading | same tested source | 2399.549841s;386 cases | Finished step; complete input fit unproven |
| Train49 reading | 0790c718c87ad9aee4d1e07e93b7c8ccedbe6089 | 2576.011557s;495 cases | Finished step; additions absent from live98, no unchanged-source claim |
| Train49 rail | same tested source | 2251.169542s;226 cases | Finished step; complete input fit unproven |

There are59 completed step observations across PR86 check0/1/2 and train49
check0/1, each with its complete named inventory. `fit_live98:null` means unproven,
not equivalence. Reader mutation phases are preserved distinctly. All failures
remain in original evidence. The train45 logs retain their two partial artifacts
and exact missing inventories. Train49's check2/3 have no final summary; final
reports for individual completed modes are diagnostic and are not imported as
whole-shard completion bounds. Its unfinished pipeline and compose have no final
native report and are never counted complete.

`CONTINUATION-UNION.json` checks only the disjoint step set: browser3 six completed
report steps plus seven frozen continuation steps; browser4 one plus eleven.
It does not grant coverage, source equivalence or cleanup acceptance. Frozen
runs44348385545/44348397828 and their wrappers were neither modified nor controlled.
The 650/721 own-case receipts named by PREPARED.json are retained context:
49m31s and17m29s are job wall times, not measurements of the entire compose step.
No complete expanded-compose duration is asserted.

## Bound, ruling and remaining work

The old workflow feeds `matrix.timeout_minutes` into GitHub's job timeout. Its
browser formula was ceil(longest scalar load*1.5), yielding the observed76/77-minute
limits; Python file partitions yield18/19 minutes. Retained train49 annotation
explicitly identifies Python4's18-minute cut. The 737 wrapper's annotation names a
job-specific55-minute limit; no final summary exists after2624 terminal OK cases.
This evidence does not establish a universal77-minute hosted hard cap. Runtime
selection is macos-26, Chrome156.0.8078.47, Playwright1.63.0 and Node26; observed
completed artifacts record Python3.9.6 and Node26.13.1. The fingerprint binds the
declared workflow/runtime selection, not future runner-image/load stability.

Coordinator/warp ruling remains: the proposed90-minute default is a conservative
refusal policy, not inherited authority from PR86's100-minute planning allowance
or train49's one-off7/147-minute continuation capacity. It deliberately refuses
a64-minute step when1.5x+5 exceeds90. A different supported completion boundary or
capacity policy requires an explicit named, validated revision; this builder does
not borrow those one-off allowances or install a new default.

Python4 PR86/train49 and 737 are **not fixed** here. Python's historical whole-file
weights and new-file median remain unchanged. The original item sources8513,
8905,8968,9004,9047,9050,9235 and item notes were read; the live store was used only
through sqlite3 -readonly with mode=ro. No original prefix becomes acceptance.
The follow-up must cover Python discovery/import/setup costs and file/case source
fit, with an independently allocated bounded phase, not a larger blind whole-suite
rerun. Setup/upload reserve and the1.5 factor also lack new hosted validation.

## Validation

Final focused CPython3.9.6 run: **44 tests passed**,9.147s. It includes budget
refusals/coverage/determinism, item734 selection, workflow matrix transport,
collector missing/partial/raw-red truth, separate Python planning compatibility,
and four existing continuation cleanup/exact-union contracts. No real browser,
native case, server, whole Python/Node suite or hosted workload ran. Each Python
test/mutation/restored control used a unique effective bytecode-cache prefix.
Input declaration audit is complete; the scope/collector authority files are
unchanged. Existing workflow-test ResourceWarnings concern its unchanged inline
open calls; there are no test failures in the final run.

Raw evidence is external under the builder evidence directory:

- `red-public-plan.log`: two genuine old-planner failures, accepting scalar-only
  input and an oversized57-minute step despite the required setup reserve.
- `focused-final.log`: all44 final checks and the effective cache prefix.
- `MUTATIONS.json`, five `*.diff`, `mutation-*.log`, `restored-*.log`: actual source
  mutations for coverage loss, stale measurement, oversized step, omitted setup
  margin and missing new step. Every mutation is asserted applied, caught with
  nonzero exit, restored by exact source hash, then passes all9 budget checks.
- `INPUT-DECLARATIONS.json`: complete candidate input discovery and required set.

Earlier scaffold API errors and one reversed test-message regex remain in raw
logs; the API was implemented and the matcher corrected. Evidence extraction
attempts retain absent-source, phase-identity and seven-digit GitHub timestamp
parse errors; the final ledger uses phase identity and CPython3.9-compatible
log timestamp parsing. None is waived or converted into a passing product result.

## Precise install/revert proposal

Do not install this return or alter any flight. After independent review and the
coordinator/warp bound ruling, use a separately authorized complete-step measurement
phase at its exact committed source/runtime/inventory; authenticate original ZIP,
source, final summary/report and cleanup, then record all observations through the
documented API. Any source-fit failure or oversized whole step still refuses.
Prove a complete deterministic exactly-once plan and reserve accounting before
using the ordinary PR/landing path. No starts are allocated by this proposal.

Delivery consists only of this worktree's one frozen commit, whose sole parent is
live98. The coordinator may stage that exact commit after the missing validation;
this builder performs no push or PR. If the source change later needs reverting,
revert the entire frozen commit in a new reviewed commit through the same path,
restoring all listed paths together. Do not reset a live tree, rewrite original
measurements/failures, modify installed fable-tools or cancel an existing job.
