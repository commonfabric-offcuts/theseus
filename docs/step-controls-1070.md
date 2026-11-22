# Step-wise history controls (1070)

The protected controller selects controls separately for each required step.
In descending creation-time/run-id order, it takes up to three authenticated
first-attempt pushes on the comparison branch, begun before the candidate,
that contain complete evidence for that step. A missing or cancelled shard
removes its steps from that run's eligible evidence. Other complete steps in
that run remain usable, and older runs can supply the omitted step's controls.
The manifest names each step's selected run ids and discloses fewer than three.
It retains the original run outcomes; completed evidence need not have passed.

The history reader verifies the selected steps against their committed catalog,
original plan, raw shard receipts, source identities, profiles, logs and counts.
All parts of a partitioned step must be complete, disjoint and accounted for.
A partially recovered log from a cancelled job is not a whole step. Native
failure comparisons retain case, assertion fingerprint and execution profile.
Other steps' failures never become exemptions for candidate unit/replay checks.

Candidate evidence keeps its existing whole-run completeness requirements.
History handling never changes a candidate's cancellation, missing-part,
source, receipt-format or provenance refusal. Missing history is disclosed;
malformed evidence, API read failures and digest mismatches remain refusals.
Expired history artifacts are named as unavailable evidence, and older eligible
runs may supply that step's controls. A run whose authenticated artifact listing
has no combined receipt proves no whole steps and is named as unavailable;
an existing receipt that cannot be read or authenticated remains a refusal.
No fixture or candidate code executes
while the protected workflow collects history.

This first piece starts at protected controller commit
33c5a2775e0e6e4d7e7708b9128cd6f7c2334d79 (1062). Its production surfaces are
tools/ci_known_reds.py and .github/workflows/verdict.yml. Isolated history
fixtures exercise the real workflow collector and validator; retained red,
corrected, applied-reversion and restored runs use distinct caches. Existing
1062 source/format checks remain. The old run-wide omission/counting policy
assertions are replaced by explicit per-step selection expectations.

The higher Python cap and guarded-path changes belong to the linked successor
on release 335, after this first piece is pushed. They are outside this source.
The first piece follows the protected-branch PR/review path; it does not install
a deploy guard or run a gauntlet. Retained 1067 PR failures remain failures.
