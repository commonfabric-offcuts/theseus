# Shard cap and planning guard (1071)

Python job timeout is max(30, ceil((dealt file minutes + setup minutes) * 2)).
Setup is included once, as in the existing planner. Empty partitions retain
that floor. Each emitted Python matrix job carries that cap unchanged to
Checks timeout-minutes. Node/deploy-refusals retain their existing 1.5 factor;
browser's workflow override remains100 minutes and replay remains45 minutes.
Weights, refresh/fallback provenance, deterministic whole-file assignment and
candidate completeness/failure requirements retain their existing owners.
This is a budget default, not a guarantee a future shard completes within it.

Exactly tools/unit_shards.py, .github/check-weights.json and
tools/ci-input-reads.json are ordinary planning paths. Their directories and
similarly named controller paths are not exceptions. Every other existing
protected dependency remains guarded, including the judge, deploy tool,
validator, workflow files, source classifier code and migrations. Both train
admission and Core freeze classification use aim_next.judgment.guarded;
there is no second path policy. This guard-policy change itself is JUDGED.
Future changes still receive the complete-diff semantic route review.

Proof uses isolated synthetic inventories/weights and real scratch Git/Core
freeze records, never live account data. Named checks distinguish floor,
ceil/setup, per-deal budgets, matrix consumption, overflow refusal, ordinary
planning paths and guarded judge/deploy/neighbours. Retain original-product
red, corrected cohort, applied old cap/guard product bodies, exact restoration
and distinct bytecode caches/input maps. Existing directly superseded policy
expectations change explicitly; unrelated assertions remain. No browser or
hosted wall-time/performance acceptance is claimed.
