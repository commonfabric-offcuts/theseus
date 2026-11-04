# Internal backup and recovery API

`aim_next.recovery` exposes four explicit local operations. These are Core
internals for the lead-owned command/profile/service workflow. Nothing here
starts a runner, provisions a route, saves a profile, discovers an instance,
activates existing AIM, or acknowledges a delivery.

```python
from aim_next.recovery import backup, inspect, activate, activation_readback

bundle = backup(db_path, instance_id, expected_binding=binding,
                bundle_path="/private/existing-parent/new-bundle")
manifest = inspect(bundle["bundle_path"], expected_digest=bundle["bundle_digest"])
request = {
    "authority_path": binding["authority_path"],
    "authority_id": binding["authority_id"],
    "instance_id": instance_id,
    "expected_epoch": binding["authority_epoch"],
    "activation_id": caller_minted_canonical_lowercase_uuid,
    "mode": "normal",  # or explicit "original_unavailable"
    "bundle_path": bundle["bundle_path"],
    "bundle_digest": bundle["bundle_digest"],
    "candidate_path": "/private/existing-parent/new-candidate/data.sqlite3",
}
observation = activation_readback(request)
result = activate(request)
```

Paths are canonical absolute strings. The bundle directory and candidate's
containing directory must be new. Their parent directories already exist and are
owned by the current user at mode 0700. The candidate's own media directory is
`<candidate_path>.media`. Files are exclusive, no-follow, regular, single-link,
current-user-owned mode 0600. Control stays outside bundle/candidate roots at
`<authority_path>.activations`. No destination is adopted because it looks empty.

A completed bundle has `data.sqlite3`, `media/`, and a final `manifest.json`.
The manifest records exact database bytes, fixed runtime/commit metadata and all
ready media, including private attachments. The manifest is capped at 16 MiB;
oversize fails rather than truncating. Inspection checks hashes and actual DB
metadata/media rows. Its SHA256 is a caller-pinned content identity, not a
signature against a malicious operator. Pending media bytes are not ready bytes.
Snapshot uses SQLite backup in 64-page steps; a busy backup attempt is bounded.
Initial source commits can continue, and any changed commit identity requires a
fresh backup before normal cutover.

Activation permanently binds the exact request to its UUID. Its reserved epoch
is `e-r-` plus the UUID's lowercase hex, disjoint from initial `e-` epochs. A
complete root header is flushed in a new sibling before root publication under
authority EX then runner EX. Existing roots are validated, never replaced.
Each ID exclusively creates its directory and stable lock; a complete request
marker follows lock flush. Partial IDs remain burned. `copied.json` identifies
the verified unstaged copy; it cannot authorize resumption. `staged.json` binds
the staged hash, metadata and retained file/directory identities. Stage changes
only `metadata.authority_epoch`. The bundle, canonical records, operation
fingerprints/receipts, commit pair and old route pins remain unchanged.

The per-ID lock spans preparation and cutover. Long copy/hash work holds no
authority EX or runner lock. The exclusive cutover does fixed metadata/identity
reads and checked publication only. Normal mode compares both commit sequence
and commit ID. Explicit unavailable mode still refuses a readable valid original,
even if its pair differs. Missing/changed/unreadable original history is recorded
as incomplete; busy, interruption and cleanup uncertainty cannot establish that
history is unavailable. Later normal recovery preserves any earlier history gap.

Only `activate` can return `durability_confirmed: true` with `binding` containing
`instance_id`, `db_path`, `authority_path`, `authority_id`, and `authority_epoch`.
The workflow may save/use that confirmed binding. A fresh cutover flushes every
candidate/control prerequisite and the temporary anchor before replacement,
then flushes the anchor directory and revalidates. Failure is never repaired by
republishing the predecessor. A matching current retry confirms the anchor and
parent with fresh full flush under SH, even with an active runner or absent old
DB/bundle; it does not enter EX bootstrap or compare to the old staged hash.

Readback never writes or flushes and never returns `binding`. Its statuses are
`not_started`, `preparation_incomplete`, `prepared`, `published_observed`, `stale`,
`request_mismatch`, `busy`, and `unconfirmed`. `published_observed` includes an
`observed_binding` with `durability_confirmed: false`. This is not authority to
save a profile or start dispatch. Partial staging refuses; the operator preserves
the artifacts and selects a fresh UUID and path. No root/claim/candidate/bundle
garbage collection or automatic repair is included. A completed matching retry
after a later activation is stale; changed inputs under the old ID refuse.

`RecoveryError` has `code`, `retryable`, and `evidence` (exact selected paths and
phase timings where available). Busy outcomes are bounded, not evidence of a
dead owner. Fixed mismatch/refusal codes describe known observations;
`RECOVERY_UNCONFIRMED` and `BACKUP_UNCONFIRMED` preserve uncertain outcomes.
Callers retain the full request and inspect before choosing a new attempt.
Never delete a candidate because a return or subsequent profile save failed.

Durability here requires checked Darwin `F_FULLFSYNC`, including directories;
there is no fsync/barrier fallback. The allocated probe showed syscall support
on device 16777229. Injection and process-exit tests establish ordering and
reconciliation, not physical power-loss survival or drive firmware behavior.
Ordinary initial-authority/media/profile durability code is unchanged. Same-user
writers that ignore the stable claim lock and hostile replacement/corruption
after verification remain outside the cooperative ownership guarantee.

Returned `timings_seconds` separates copy, verification, staging, fence
acquisition/validation, fence hold, publication and actual full-flush syscall
time. Flush time is nested in the other phases, so these are not additive.
Test collection, setup, execution, teardown and reporting are recorded separately
by the proof runner. No fixed real-time storage/fence duration is promised.
