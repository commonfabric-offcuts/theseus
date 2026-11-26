# Fenced board export (1305)

This judged local tool prepares a cross-host handoff. It never starts a service,
changes a profile, activates a destination, or restores a retired source.
Warp alone executes the real source cutover after readiness. Development uses
isolated records. Destination bootstrap is the separate 1306 deliverable.

`aim_next.transfer.export_source(request)` accepts exactly:

```json
{
  "v": 1,
  "handoff_id": "canonical-lowercase-UUID",
  "source": {
    "instance_id": "same-instance", "db_path": "/private/source/data.sqlite3",
    "authority_path": "/private/source/authority.json",
    "authority_id": "source-authority", "authority_epoch": "source-epoch"
  },
  "destination": {
    "machine_id": "destination-machine-identity",
    "reservation_id": "canonical-lowercase-UUID",
    "activation_id": "canonical-lowercase-UUID",
    "authority_path": "/private/destination/authority.json",
    "candidate_path": "/private/destination/new/data.sqlite3"
  },
  "transport": {"mount_path": "/Volumes/secretsky", "volume_uuid": "E899C601-EF65-4C1E-9F0B-4D90AD6A7ABC",
                "folder_path": "/Volumes/secretsky/theseus-move"},
  "bundle_path": "/Volumes/secretsky/theseus-move/private-handoff/new-bundle"
}
```

Paths must be canonical, with no symlink component. Local parents are private,
owned by the executing account; new files are 0600 and directories 0700.
Transport must be the explicitly named, mounted, unlocked external APFS volume,
pinned to both the observed VolumeUUID and approved folder. Tony27713 overrides
the earlier encryption requirement for `/Volumes/secretsky/theseus-move` only.
Record encryption and ownership policy; ownership-ignored transport supports
the different local UIDs. Existing files elsewhere on secretsky stay untouched.
Local source and activation files retain strict private ownership/mode checks.
Probe actual mount/device/UUID facts before
and after copying. Never infer readiness from a volume label or a numeric UID.
The destination machine/reservation/activation/path tuple is immutable under
the handoff ID. It is a trusted operator input, not an authenticated remote
claim; 1306 must match it to actual destination observations before use.

The source claim lives at `<authority_path>.transfers/<handoff_id>`, outside the
bundle. It exclusively records the complete request and stable claim-lock facts.
Changed input under the ID refuses. Partial claim creation is retained and
refuses; no guessed reconstruction, automatic new ID or garbage collection.

Backup and hash work use the existing verified backup/inspect implementation
outside authority EX. Then authority EX and runner EX exclude every cooperating
writer and retained child. Recheck source binding, stable lock/DB identities and
the exact final metadata/commit pair against the bundle. A racing commit refuses
retirement and remains in the current source. Busy or a setup failure proves
neither retirement nor writer refusal.

Before publication, durably record the complete intended retirement and receipt.
Atomically replace the source anchor with the same pinned record in state
`transferred`, retaining recovery history and the handoff digest. Both old
Authority callers and recovery require `active`, so old server, runner, CLI and
autostart callers remain refused after reopen/reboot. No source epoch/pin edit
can reactivate it through this tool. This is cooperative exclusion; a privileged
operator restoring an old anchor or a writer bypassing Core is outside it.

Only after checked full flush and readback of retirement does the tool publish
matching `handoff.json` in both the local claim and the SSD bundle. The result
has v1, status `retired`, durability_confirmed true, handoff_id, request_digest,
source, source_commit, history_complete, destination, transport, bundle_digest
and retired_anchor_digest, plus transport_observation (including actual UID,
device, encrypted and ownership_enabled). Its canonical SHA256 is `source_handoff_digest` for
1306. Existing history gaps remain false/unknown; they never default to true.

`source_readback(request)` never creates or flushes anything and always returns
durability_confirmed false. Its observations are not_started, incomplete,
prepared, retired_observed, stale, busy, request_mismatch or unconfirmed. It
never returns a usable destination binding. A matching `export_source` retry
freshly confirms the exact retirement and both receipts; it can complete after
retirement interrupted receipt publication without reactivating the source.
An uncertain publication stays TRANSFER_UNCONFIRMED with its phase/cause.

The CLI is `python3 -I tools/transfer_board.py export-source REQUEST.json` or
`source-readback REQUEST.json`. Requests are operator files, not actor profiles;
old board operation requests remain byte-for-byte unchanged. Retain stdout,
stderr, exact request, receipts and partial paths off-board after the final
snapshot. The tool does not erase transport or source data. Warp prepares a new
0700 handoff parent inside the approved folder before this command; it never
changes the ownership/mode or contents of Tony's other files. Any later cleanup
by Tony/Warp after1311 is limited to this folder after receipts survive.

1306 must copy SSD input into fresh local files as the actual destination
commonfabric account, without preserving source UID/GID, verify every ready
media/database/manifest/receipt byte and actual host/reservation, then bootstrap
new stable locks/epoch. The proposed 27643 activation envelope remains the
downstream interface; 1305 does not implement activation. Readback cannot replace
a freshly durability-confirmed activation result for 1307.

Proof must include positive real Store commits, retained/reopened/subprocess old
callers refused without record/commit changes, retirement-before-receipt crash,
same-ID recovery/collision, surviving racing commit, both legacy recovery and
Authority refusal, real media preservation, and applied fault/red/restoration.
Mocked transport observations prove control behavior only; actual SSD mount,
cross-UID readability and physical power-loss survival need separate receipts.
