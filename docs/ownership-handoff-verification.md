# Stopped ownership inventory (1330)

`capture_handoff_inventory(store, actor, request)` and
`verify_handoff_inventory(store, actor, snapshot, expected_snapshot_digest)`
are dormant internal, read-only APIs. They perform no ownership/mode change,
copy, repair, receipt persistence, profile selection or consumer start.

The exact v1 request contains `root`, `source_uid`, `target_uid`,
`publication_receipt`, `profiles_request`, `profiles_result`, `manifest_bytes`
(the exact UTF-8 1327 manifest) and its raw SHA256 `manifest_digest`.
The canonical root must contain the current DB, authority/locks and staged
1327 output. Historical paths in the retained inputs remain data, never reads.
Capture runs as the declared source real/effective UID. Its current shared
authority fence checks current publication lineage, enabled actors, unchanged
normal profiles and all THREE original DB/authority-lock/runner-lock pairs from
the confirmed 1327 manifest. Newer commits before capture are allowed.

Capture returns `{snapshot, snapshot_digest}`. The snapshot retains the exact
request/actor, current binding/lineage, original/current pairs, both stopped
commit fields, profile actors, root identity and complete sorted inventory.
Caller D must retain/pin its exact canonical bytes/digest outside the changing
root before transfer. This API neither writes those bytes nor proves retention
durability. A supplied digest alone does not authenticate a historical capture.

The no-follow descriptor walk includes the root and every descendant: at most
16384 entries, depth32, 4096 UTF-8 bytes per normalized relative path and8MiB
for the complete encoded snapshot. Overflow, unreadable/changed enumeration,
aliases, symlinks, regular-file hardlinks, special files and device escapes
refuse. No cache or other exclusion is applied. Directories are0700; regular
files0600 or private executable0700. Named/held directory identities and
before/after metadata are rechecked. DB bytes are never opened through raw
file descriptors; short normal SQLite reads close before directory walking.

Verification requires the externally pinned snapshot digest, real AND effective
process target UID, target ownership of root AND every descendant, exact
captured paths/types/device/inodes/modes/sizes/mtimes, original pairs, current
binding/lineage, both stopped commit fields, profiles and enabled actors.
UID and chown-related ctime changes between capture/verify are expected; within
each API observation, two full inventories and context checks must agree.
Busy/change/partial/missing/close uncertainty remains a typed refusal, never
successful or cached readiness. A live writer advancing after capture invalidates
this stopped window; no old cutover-commit or inactive-payload oracle is used.

Verification returns `ownership_observed`, actual process/entry UIDs, original
and current pairs, checked actors/count/root/digest, and `same_uid_control`.
Same-UID fixtures are never actual second-UID proof. Source/target501 acceptance
requires the genuine requested UID process/files in a separately prepared run.
Neither an inventory nor a shared fence proves external process-group closure,
copy-content hashes, hardware durability, account/service/control/plan adoption
or permission to start consumers. D owns stopping/reconciling publication before
chown and all eventual root artifacts must exist before its real capture.

Unchanged 1326 retry/readback remains bound to its old UID/private locks and is
not invoked here. Supported real handoff/adoption still requires the judged
current-live full-copy throwaway rehearsal, revert proof, independent run read
and Tony authorization. No admin hands or real transition accompanies this cut.
