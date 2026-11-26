# Inactive destination staging (1325)

Internal `stage_relocation(request)` and `inspect_relocation_stage(request)` in
`aim_next.relocation_stage` prepare a same-owner destination. Neither creates an
authority anchor, retires a source, publishes a binding, changes a profile, starts
a consumer or invokes the real board. No adapter calls these functions.

Request: `{v: 1, intent_request: EXACT_1324_REQUEST, intent_digest: SHA256,
journal_root: EXISTING_PRIVATE_DIRECTORY}`. The digest binds the canonical JSON
bytes of the exact completed 1324 intent. Original preparation/request bytes are
retained, not rebound. Source UID, destination UID and actual UID must match;
otherwise return `OWNERSHIP_HANDOFF_REQUIRED`. All paths are canonical and private.
Journal, source, preparation, intent and destination roots must be separate.
Target parents may be existing private directories or created one level beneath
an existing private parent. Existing target files/locks/media are never adopted.

Identity is `(journal_root, move_id)`, with no global search. A stable private
`intent.lock` serializes the journal. `claim.json` binds exact request, root/lock
identities and ONE fresh proposed epoch, durably before any target metadata write.
The independent destination DB/media copy never changes the 1322 payload.
The destination metadata whitelist is exactly `authority_path, authority_epoch`;
instance/authority ID, schema, both commit fields and all other records remain.
Stable destination authority/runner locks are created exclusively and held while
building. The final `staged.json` binds request/claim, epoch, source and destination
metadata, verified payload, parent/media identities and all three destination
device/inode pairs. Checked Darwin full flush has no weaker fallback.

Every target read/retry holds the destination authority fence and verifies the
stable lock identities plus anchor absence before touching the DB. Creating or
confirming staging also holds runner EX. An anchor appearing after handoff means
`STAGE_DESTINATION_CHANGED`; never report inactive or flush an active database.
The future publisher must use this journal and these same stable fences. Reads
and retries are observations, not publication leases.

| State / interruption | Behavior |
| --- | --- |
| Missing journal | Read-only `not_started`, creates nothing |
| Invalid/mismatched intent or candidate | Refusal before target creation |
| Existing claim without final marker | `stage_incomplete`; mutating retry refuses repair/recopy |
| Changed request under same identity | Request mismatch, original bytes retained |
| Copy/metadata/marker/flush/close failure | Retain exact attempt/cause/paths; no new active authority |
| Complete matching retry | Verify and freshly full-flush same payload/epoch; never recopy |
| Read-only complete inspection | `staged_observed`, durability unconfirmed, no flush |
| Destination anchor present or identities changed | Refuse; no active-data flush/rewrite |
| Competing journal/destination fence | Typed retryable busy, no second attempt inferred |

Only a checked successful create/retry returns `staged`, `inactive=true` and
`durability_confirmed=true`. No usable binding is returned. Partial artifacts
are retained, never deleted or reconstructed, and no new epoch/ID is inferred
from a lost response. Completed retry need not reopen historical source/intent/
preparation roots. Staging does not establish current source freshness.

1326 must verify the entire stage again, then exclusively recheck predecessor,
commit and source/destination identities before any retirement. Retirement and
publication/resumption remain together. Published retry must check its own
publication lineage first; a newer destination commit must not be rolled back
by this inactive-payload oracle. Existing Store/authority validators remain
unchanged and must reject an unpublished destination under either binding.
Real-board execution, cross-UID ownership/service/account transfer, current
route/control/plan adoption and original-operation reconciliation are separate.
The first real execution retains judged-first full-copy rehearsal, revert proof,
independent read and Tony authorization. Library landing alone grants none of it.
