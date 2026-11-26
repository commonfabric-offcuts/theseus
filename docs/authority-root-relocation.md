# Inactive authority-root relocation preparation (1322)

`aim_next.relocation.prepare(request)` stages a verified backup for inspection.
`inspect_prepared(request)` only reads that stage. Neither operation opens the
live Store, retires an authority, creates authority locks, edits a profile or
configuration, activates a destination, changes ownership, or starts a consumer.
This is not the later authority publication or account-move workflow.

The exact request has these fields:

```python
{
    "v": 1,
    "move_id": "a-canonical-lowercase-uuid",
    "staging_root": "/existing/private/staging-root",
    "bundle_path": "/existing/private/verified-backup",
    "bundle_digest": "64-lowercase-sha256-characters",
    "source": {
        "instance_id": "selected-instance",
        "db_path": "/original/data.sqlite3",
        "authority_path": "/original/authority.json",
        "authority_id": "selected-authority",
        "authority_epoch": "original-epoch",
    },
    "destination": {
        "db_path": "/proposed/data.sqlite3",
        "authority_path": "/proposed/authority.json",
    },
    "owners": {"source_uid": 502, "destination_uid": 501},
    "commit": {"seq": "123", "id": "32-lowercase-hex-characters"},
}
```

All paths are explicit canonical absolute strings; authority aliases are not
normalized. The source database path is a **caller-pinned assertion**: a backup
manifest records authority metadata, not its original database pathname. The
other source identity fields and both commit fields must match the inspected
backup. This API does not verify the current live authority or its three file
identities; that remains publication work. Database-directory alias behavior in
the existing profile/Store APIs is unchanged.

The staging root must already be a private, actual-user-owned directory. The
source UID must equal the process UID. The destination UID is recorded intent,
never a permission override or evidence of cross-UID execution. No destination
parent needs to exist. Staging must be separate from the bundle and both source
and destination database/authority directories. Database and authority target
paths must differ, and both must differ from the source paths.

A preparation's identity is `(staging_root, move_id)`. Its exclusively created
directory is `staging_root/move_id`; nothing searches other roots or creates a
global reservation. Keep that exact namespace when reconciling. A private
stable lock serializes writers. `request.json` permanently pins the exact
request before copying. Same-identity changed inputs refuse; an incomplete
attempt retains its files and is never resumed, deleted or overwritten.

The staged `data.sqlite3`, `media/` and `manifest.json` are exact independent
copies of the verified backup. The database metadata change whitelist is empty:
records, operation fingerprints/receipts, commit identity, old route/control/
seat-plan bindings and original authority path/epoch all remain unchanged.
Future destination paths/ownership appear only in the request and preparation
record. No new epoch or usable `binding` is returned.

`prepared.json` is written last, after the copied snapshot is independently
inspected and the source bundle is verified again. It pins the request digest,
snapshot digest, staging-directory and stable-lock identities. Payloads and
directories use the existing checked Darwin full-flush primitives without a
weaker fallback. `prepare` returns `status=prepared`, `inactive=true` and
`durability_confirmed=true` only after checked flushing and verification.
After a lost result, a matching complete retry verifies and freshly flushes the
same stage. It does not recopy or create another identity.

Read-only inspection returns `status=prepared_observed` and
`durability_confirmed=false`. A missing stage returns `not_started`; an exact
retained request without completion returns `preparation_incomplete`.
Inspection never creates a missing lock or flushes a file. Corrupt/replaced
payload, root or lock refuses. Busy, malformed, mismatched and uncertain
outcomes are distinct. Failures retain paths/cause for the caller, and no
failure authorizes cleanup, activation or a new move ID.

No CLI/operator move command is introduced. Later publication must establish
source retirement, current final commit/authority identities, a fresh epoch,
destination ownership and the three actual destination file identities. Runtime
adoption and lineage-bound saved-operation reconciliation are separate work.
Preparation alone proves none of those and does not authorize the account move.
