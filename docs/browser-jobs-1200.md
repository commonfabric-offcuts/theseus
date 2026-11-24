# Durable browser jobs after a release (1200)

Recording a release and creating its required browser jobs are one Core
transaction. A retry of the release record cannot create another job. A job
names the release, the exact released source commit, the outcome and check
identity, its sourced check definition and owner mapping, and its retained
evidence. Jobs remain separate from the immutable release and from permission
to land. Pending, running, passed, failed and explicitly unrun are distinct.

## Authority and route

The release owner is `Store.record_release`; the existing runner wakes actors
from durable deliveries. The current delivery schema requires either a real
message or one of two typed refresh requests, with foreign keys and insert
guards. A release job is neither. It must not impersonate a message author or
masquerade as a cover refresh.

The proposed narrow database change is a browser-job table and a typed
browser-job reference in the existing delivery queue, with its recipient and
identity guards and occupied downgrade refusal. This takes the judged database
path. No live schema, records, runner installation or routes are changed by
implementation fixtures. The actual migration must be judged before deploy.

The existing metadata mechanism can keep a bounded, versioned owner/check
catalog; existing command operations retain exact idempotent command outcomes.
Job identity and queue reach use database constraints rather than an additional
scheduler, a parallel JSON store or a second wake loop.

## Creation, configuration and visibility

* A job identity is unique by release, exact commit, outcome and check. Snapshot
  the configured definition/mapping and their sources when the job is created.
* Required native checks come from the outcome's current check definitions and
  its explicit supplemental check catalog. A missing owner or unresolved
  mapping remains visibly pending/unassigned; it is never silently skipped.
  The outcome coordinator receives a mapping task when it has an eligible
  configured route. This is routing information, not a claim that the
  coordinator owns execution.
  A recipient must be able to read both the outcome and destination topic.
  Topic-only access leaves the bound owner's access problem explicit and
  routes the mapping task to an eligible coordinator until access returns.
* Catalog changes are sourced, version checked coordinator acts. A deliberate
  reconciliation may create missing jobs for an existing release, without
  modifying the release record or duplicating existing jobs/results.
* Concrete retained obligations to configure/reconcile are release398's1160
  final hotkey/Health cell and release399's1190 clipboard/selection/feedback.
  Their source is Fable22730, not an inference of native coverage from Node.
* Reads are outcome scoped and paged. A release's Done state never means its
  pending jobs passed. Retain exact commit identity and the configured pushed
  source recovery reference after deleting a worktree.

## One attempt survives replacement

A claim records its original operation and attempt identity before external
work starts. A second claimant cannot start another attempt while it is
running. Retrying the original command returns its recorded result. Register
the actual child PID and process start identity; never infer it from a PID
alone. A replacement seat sees that attempt and reconciles it, rather than
turning an unknown outcome into another spawn.

Record a result only for the matching attempt/version and exact source, with
evidence and confirmed child/fixture cleanup. A failed result may link to a
concrete fix-forward piece in the same outcome. Unknown, interrupted and
cleanup-unconfirmed attempts remain visible and prevent automatic replay.
An explicitly authorized continuation keeps the original attempt history.

Existing delivery scheduling and stopped-seat fences still govern wakes.
A delivery acknowledgment is not a browser result; unfinished work must keep
its durable queue reach across restart. No browser is launched by a Core read,
release record or job creation. Execution remains with the configured owner
under the existing isolated-browser and capacity rules.

## Interfaces and overlap

Use a dedicated `aim_next/browser_jobs.py` owner and additive Store/validation
registration. CLI exposes job read/list and sourced catalog/job state acts
through the existing command and operation-result library. Delivery rendering
and notices carry the typed job identity, its exact source and next recovery
command. They expose no profile contents or arbitrary child error text.

1198 owns current-rule/next-action context; it can report browser-job capability
absent until this delivery exists.1180 owns wake diagnostics and same-operation
reconciliation.1199 owns clocks. Coordinate only the additive registrations and
the precise job notice hook; these deliveries do not acquire each other's
authority or wait for unavailable follow-ons.

## Required isolated evidence

Check atomic release/job/notification rollback, exact release retry, retained
jobs after reopening and source-tree removal, explicit unknown mappings,
recipient/scope isolation, stopped-seat retention, competing claims, lost
committed answers recovered under their original operation, original child
identity, wrong-head/wrong-attempt refusals, unrun versus pass, evidence and
fix-forward linkage, pagination, and occupied migration rollback refusal.
Apply and restore a real creation/identity mutation to show the recovery
assertion detects its loss. Keep unique Python caches and all physical attempts.
No test runs against real accounts or launches a live-data browser.
