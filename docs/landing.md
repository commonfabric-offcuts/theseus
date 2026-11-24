# Landing a change

This is the canonical landing rule, incorporating Warp's November 18, 2026
rulings through #9924 and the auditor's #9909–9910. It supersedes the historical
cadence, routing and recovery policy in [trains.md](trains.md). Deployment
mechanics and evidence guards remain in [tools.md](tools.md#deploy-toolsdeploypy);
the immutable record is described in [releases.md](releases.md).
The commands that carry out an ordinary landing, for any seat, are in
[landing-kit.md](landing-kit.md).

## Choose the route from the complete change

Classify the assembled diff against the **actual live predecessor**, including
shared helpers, tooling dependencies and conflict resolutions. Record the exact
source commit/tree, predecessor, approved piece heads, review references and
check evidence. A path label alone cannot establish the route; neither all
`web/` changes nor all Core changes belong to one class. Uncertain classification
goes to independent review before proceeding.

**Ordinary:** an approved interface change that does not change judged-first
semantics or guarded inputs follows this sequence:

1. Keep the piece's own approved checks in front of landing.
2. Open its pull request immediately. One approved piece is enough. Two or
   three is a convenient maximum batch, never a minimum or a waiting queue.
   There is no thirty-minute wait or hourly-cut prerequisite.
3. Before merge, the independent auditor reads the combined diff from the
   predecessor to the candidate, including shared helpers and any resolutions. Route
   admission is not approval of that composition.
4. Guarded merge and deploy proceed with broad judgment pending; no additional
   hosted broad run is required before the ordinary merge or deploy.
5. Check the actual changed surface on live immediately, then complete the
   broad checks on the deployed source and attach their judgment to the record.

**Judged first:** complete judgment before deployment for changes to stored
data or its meaning, including rewrites of existing records, semantic backward
compatibility or values the previous code cannot read or safely use after a
revert; migrations or `SCHEMA_VERSION`; server permission policy or admission
rules; release, check or landing tools and their dependencies; guarded input
declarations and classifier code; or `.github/`. A filename-only
guard is a minimum, not proof that other changes are ordinary.

Item1071 makes three exact planning paths ordinary: `tools/unit_shards.py`,
`.github/check-weights.json` and `tools/ci-input-reads.json`. This exception
does not include neighbouring files or directories. Judge/deploy code,
validators, controller workflows and migrations remain guarded; the shared
Core/train policy is `aim_next/judgment.py`. Changing that policy itself is
judged first. Complete-diff semantic review still applies.

A client control that reflects permission Core already enforces, without
changing who may do what and with Core's refusal intact after revert, is
ordinary (Warp #9924). Keep that guard with its product. Only standalone input
declaration changes may stay on the judged-first train while the product takes
the ordinary route, and only if the complete product stands without those
declarations. Never strip dependent authority to obtain an ordinary label.
The auditor's combined read can overturn a classification when it finds a
server policy or other judged-first change.

## Approval and source identity

- **Piece approval** covers the exact isolated source and evidence reviewed.
- **Composition approval** covers that source assembled onto its actual
  predecessor, including overlaps and shared helpers. A new composition needs
  its own combined-change read; isolated approvals do not transfer silently.
- **Verified live behaviour** requires release/runtime evidence and observation
  of the changed live surface. Neither an open PR nor a merged PR proves it.

Re-read the actual predecessor before landing. A base move, recut, renumbering
or resolution changes the candidate identity: retain the original source and
receipts, review the resulting diff and check the changed chain before deploy.
Pending broad judgment stays explicitly pending; it is never called passed.

Assign migration numbers when preparing the landing candidate against its
actual predecessor, not on isolated build branches. Renumbering is a source
change. Check the whole resulting migration chain, stored-data compatibility
and rollback semantics, and obtain review of that candidate. An earlier piece's
approval cannot approve a differently numbered or ordered chain. Current piece
orders and assigned numbers belong in the candidate's evidence, not this rule.

## Live check and recovery

Every landing names the seat responsible for the immediate live check and the
seat deciding recovery, with exact release source and evidence. Fable, the
coordinator, owns both by default and records any named handoff. Read back the
release record and runtime revision and inspect the actual changed surface;
record the observation and its time. If record and runtime disagree, report
that state explicitly rather than claiming verified live completion.

For a confirmed person-facing fault, the recovery owner immediately reverts
the responsible piece without waiting for a train or the broad run. Target
**15 minutes from confirmation to verified recovery**; this is a recovery
target, not a guarantee. Verify the restored runtime and affected surface and
retain the fault, revert and restoration evidence. A broken harness alone does
not prove a product fault: preserve the original red and receipts, distinguish
tool failure from product failure, and repair the check while the feature stays.

Ship a routine reversible choice with its sensible default and name that
default in the release line; do not create another permission wait. Questions
that cross rulings go through the coordinator to Warp.

## Introduce landing and check tools reversibly

The order is **796 preflight → 794 route → 795 immediate PR → 797 numbering**.
Introduce one tool at a time between landings, never during a landing.

1. **Freeze and independently review before installation.** Bind exact source,
   report-only default, enforcement switch and hand-process fallback. Exercise
   recorded good and bad cases below the expensive runner: missing evidence,
   wrong source, duplicate invocation, timeout, partial completion, and the
   one-step off switch itself. Simulations must never dispatch a run, post a
   real reply, create a PR or allocate a migration number.
2. **Install report-only by default.** Record installed source and mode. The
   tool reports what it would do while the hand process continues shipping.
   New enforcement is off, including 796's new broad-run refusal; a failed
   preflight warns with the seed or route. This does not waive a known fixture
   failure, an existing review hold or the coordinator's run-budget rules.
3. **Compare with real hand decisions.** Retain shadow evidence for ordinary
   and judged-first landings and the relevant failure paths. Agreement only
   on successful ordinary landings is insufficient. Keep original receipts.
4. **Activate explicitly.** Fable owns the tested one-step off switch and the
   hand fallback. Enforcement requires an explicit recorded decision against
   the agreed evidence and independent review of exact source and rollout
   evidence. No timer or count of green runs promotes it automatically. First
   enforcement covers one bounded eligible landing with the hand process ready.
5. **Switch off and investigate** a false refusal, wrong route, duplicate
   action, lost evidence or tool-caused delay. Compare the separate timing
   measures below. Turning off numbering restores manual numbering for future
   candidates; it cannot undo an already applied migration.

## Keep the measures separate

Keep these observations per landing, with exact timestamps, source/evidence
references and a reason for every wait:

| Measure | Start and endpoint |
| --- | --- |
| Approval to PR | Exact piece approval → PR opened; retain each piece's approval time in a batch |
| PR to verified live | PR opened → release/runtime read-back and changed-surface verification |
| Postship faults | Faults discovered after shipping, with source, detection and confirmation times, and product/tool attribution |
| Recovery | Confirmed person-facing fault → verified restoration, with revert and restoration times |

Report observed durations and unresolved states separately. A record's deploy
time or a PR merge time cannot substitute for changed-surface verification.
These measurements establish what happened; they promise no median or fixed
landing time.
