# Required-step inventory reconciliation (1099)

Core8 builds this judged fix from actual release348,
`1ce8b275d12fd853d1725955c2af7ad073411903`, schema66, in its own
`core-lane8/1099-shard-plan-348-17705` worktree. Fable17705 binds
piece `p-e6d93a420a444d8bb6709b17`. No implementation preceded this contract.

## Authenticated fault

Producer run45072395285/attempt1 checked merge
`decd736cf90c621fd8ac3eca3ac1fa6d09a8ce77` (tree
`9b91f0c2dbae65159d50b5daeb6696d7d2301a7f`), head
`8bf0d830feeb1eb87e903ac6c1d27d6f1661a972` onto347. Verdict137382283783
at controller `e46cb262cf9e09129569df61cfc8439b56003320` reports
`shard required plan differs`. The retained failed conclusion stays failed.

The aggregate artifact14776455930 and first shard `check-0`,
artifact14774400548, were downloaded from that run. Their archive sizes and
SHA256 match GitHub artifact metadata. The shard's raw summary hashes to its
producer receipt, which equals its aggregate provenance entry. Both required
arrays contain the same52 distinct names, with no missing or extra step.
The aggregate is alphabetic; the shard keeps `release_check.REQUIRED` order.
`combine_unit_results` builds a sorted inventory, while the judge compares
the transported arrays as ordered lists. `check-12` independently has the same
complete inventory and ordering difference. Exact arrays, API bindings and raw
bytes are retained in the intake evidence. Full-run replay is still owed.

This is an order mismatch within one run. The evidence does not establish a
candidate-versus-base comparison or a test-file-addition cause.

## Rule and boundaries

The `required` field is a complete inventory. A shard may transport it in a
different order from its aggregate if each is a list without duplicates and
both contain exactly the same required steps. Reuse the judge's existing
unique-list validation; missing, extra, duplicated and malformed inventories
still refuse. The aggregate must still match the authoritative required plan.

This changes only required-inventory comparison. Actual assigned shard steps,
partition file coverage, case identities, execution/completion and raw verdicts
retain their existing checks. Run, attempt, event, source, receipt digests and
protected-controller bindings remain mandatory. No historical artifact is
rewritten or projected into a green run. Candidate-added/removed test files
retain complete source/inventory review and execution coverage; transport order
does not grant a source-definition exception.

Initial implementation owner is `tools/ci_known_reds.py` and its Core evidence
tests/fixtures. Core7's1100 classification/restart-recipe owners and frozen1087
remain untouched. Final actual paths determine classification. No installed
guard, active recipe, SPEC, runtime, real records, stage or publication change.
Fable owns canonical stages; Warp owns independent review/carry.

## Proof

Retain actual-old red checks, corrected checks, whole relevant actual-old owner
application, exact restoration and controls with direct exits, source maps and
all failed/held attempts. Replay the authenticated Links inventory through the
real validator boundary; preserve any subsequent independent refusal rather
than claiming whole-run success. Exercise complete reordered inventories and
refusals for missing/extra/duplicate inventories, foreign/stale/cancelled
evidence and run/attempt/source mismatch. Legitimate reviewed added/removed
test-file cases keep their own complete coverage checks.

Use isolated scratch Git/record data and bounded relevant Core/CLI tests with
fresh Python caches and load checks. No browser, native gesture or live-probe
claim; Page6 owns the1060 private slot. Freeze when meaningful checks are green,
push only the exact own branch, and hand off HEAD/tree/path and raw proof for
one independent diff/test read. Current guard publication gates remain in force.
