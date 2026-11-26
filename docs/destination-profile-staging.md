# Destination profile staging (1327)

`stage_destination_profiles(store, publication_receipt, request)` is a dormant
internal library. It creates profiles, empty outboxes and a manifest in one
exclusive new folder. Nothing selects these files or starts a consumer.

The request has exactly `v:1`, `destination_root`, `output_dir`,
`publication_digest` (recovery_io.digest_record of the explicit 1326 result),
and `profiles`. There are 1–16 profile entries, each with `source_path`,
`source_bytes` (the exact UTF-8 JSON text), and `outbox_parent`. The complete
encoded request is at most 262144 bytes; each old profile is at most 65536.
Historical absolute paths are compared as supplied data, without resolving or
opening predecessor private paths. Duplicate/unknown JSON fields are refused.

Only a `published`, durability-confirmed receipt matching the current Store's
active binding and immediate relocation lineage is accepted. Move, request,
journal and both historical cutover commit fields must match. Current DB and
both stable lock identities are checked under a shared authority fence. Each
actor must remain enabled. The old exact-v2 snapshot must match the lineage's
predecessor instance/database/authority; the actor remains unchanged. Newer
destination commits are allowed. This does not invoke cutover retry/readback.

The output is a direct new child of the canonical private destination root,
separate from database/media/authority/control and historical profile/outbox
contexts. Safe actor components name `ACTOR.profile.json` and `ACTOR.outbox`.
Creation is exclusive: an existing or interrupted folder is held, never
overwritten, repaired, removed or replaced by another generated name. Files
are private 0600 and directories 0700. Profile serialization/validation uses
the unchanged profile writer. Files/directories are flushed, authority and
actors rechecked, and `manifest.json` is written last. A failed write, flush,
close or lost response is unconfirmed even when complete files are observable.

`inspect_destination_profiles(request)` is bounded and read-only. It returns
`not_started`, `profiles_incomplete` or `profiles_observed`, always with
`durability_confirmed:false`. It verifies exact request, receipt digest,
profile bytes/modes/identities and empty outboxes; it does not consult current
authority or confirm adoption/durability. A changed or conflicting manifest
is refused. An observed result never authorizes a retry over existing output.

Old profile/outbox/request/result bytes, owner, Stop/Continue and control/plan
revisions stay unchanged. Supplied historical snapshots are retained in the
private manifest with their original path/binding context, never replayed.
Routes, broker/hosted settings, seat files, route pins and plan/settings
adoption are separate 1329 work. Paths are JSON strings, not shell fragments.
Current authority may change after staging; normal profile loading must still
validate it. Real ownership/service/account operation and second-UID proof
remain separate from this library and its isolated fixtures.
