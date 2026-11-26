# Destination staging pack (1304)

This is an offline file preparation tool, not a board transfer or authority
tool. Warp owns execution in 1313; the destination executor must actually be
logged in as its local `commonfabric` account. No Core import, service start,
profile/route installation, autostart, final database export or deletion occurs.

`tools/stage_destination.py` snapshots an explicit selection of files/directories
into a private manifest. Each selection root has a unique label, canonical
absolute path and `private` boolean. It records every regular file's bytes,
SHA256, source mode/owner and executable bit; directories are recorded too.
Symlinks, multiply linked files, special files, cross-mount children, writable
group/other permissions, unowned source files and changing inputs refuse.
Private roots additionally require no group/other permissions. Unsupported
links must be resolved by the responsible owner, never silently followed.

The entire pinned Codex package is one selected root, launched as `bin/codex`;
not a single executable or app bundle. Select exact checked-out code/tool SHAs,
private configuration, original outboxes/receipts and all retained raw evidence
explicitly. Preserve historical path strings and request bytes. A source-side
file inventory is not a consistent database backup. Never select the live DB,
authority anchor/locks, sockets or active services here. The old 18:02 bundle is
staging only. Core8's 1305/1306 protocol owns final bundle, reservation, exclusion
and activation. This manifest cannot satisfy that protocol's reservation.

Manifest and private receipt contents stay off-board. Share only their digest,
totals, tool/source identity and status. Pin the manifest SHA256 separately on
each leg. `copy` creates a new inactive directory, copies bytes under the
executing user's ownership (never source numeric UID/GID), normalizes directories
to 0700 and files to 0600/0700, verifies the full resulting tree and then writes
`complete.json`. Existing/partial targets refuse and are retained. A completion
marker is staging evidence only. A lost response is reconciled with `verify`
against the original target/digest; never delete or overwrite that target.
No automatic partial-copy resume is provided. Reject extras, missing entries,
changed bytes, modes, ownership, hardlinks and symlinks on verification.

Run all commands with CPython 3.9 and `-I`. First prepare a private selection JSON:

```json
{"v":1,"selection_id":"a locally minted canonical UUID","roots":[
  {"label":"codex-runtime","path":"/Users/commonfabric/.local/share/theseus/runtimes/codex-0.167.0-alpha.3.2","private":false},
  {"label":"selected-private-input","path":"an explicitly reviewed canonical path","private":true}
]}
```

The following is the command template; Warp supplies and records the exact
reviewed paths, digests and byte budgets before execution. Angle-bracket values
are required inputs, not runnable defaults. Never use another actor's profile
to run these commands. They do not call Theseus at all.

1. As source commonfabric: `snapshot --selection <private-selection.json>
   --manifest <new-private-manifest.json>`. Record selected byte/file totals.
2. Tony plugs/unlocks the encrypted APFS SSD. Run `preflight --account
   commonfabric --volume <SSD-mount> --volume-uuid <observed-volume-UUID>
   --parent <existing-private-stage-parent>
   --selected-bytes <measured> --extra-bytes <candidate-media-final-bundle-budget>
   --reserve-bytes <explicit-reserve> --receipt <new-private-receipt.json>` on
   each Mac. It validates actual account, Python/architecture, encrypted mounted
   external APFS, ownership policy and refreshed local/transport capacity.
   Unsupported/ambiguous mount facts refuse. It does not change mount policy.
3. Source: `copy --manifest <manifest> --digest <pinned-sha256>
   --destination <new-SSD-pack> --account commonfabric --volume <SSD-mount>
   --volume-uuid <observed-volume-UUID> --extra-bytes <budget>
   --reserve-bytes <reserve>`. Source roots must remain stable during this leg.
   Copy the private manifest separately to the SSD; verify its pinned digest on
   the destination. Retain a complete verification receipt before detach.
4. In the destination commonfabric session, run the preflight again. Run
   `verify --manifest <SSD-manifest> --digest <pinned-sha256> --directory
   <SSD-pack> --transport` to prove that this account can read every transport
   byte. It checks private modes, links and hashes but permits the source UID on
   transport. A UID/access refusal is a stop for Warp/Tony, not permission to
   sudo, chown broadly or relax modes.
5. Destination: `copy --manifest <SSD-manifest> --digest <pinned-sha256>
   --from-directory <SSD-pack> --destination <new-private-LOCAL-stage>
   --account commonfabric --volume <SSD-mount> --volume-uuid <observed-volume-UUID>
   --extra-bytes <budget> --reserve-bytes <reserve>`.
   Then `verify` without `--transport`; every local inode must belong to the
   actual destination account. Confirm stage parent is on local storage by its
   recorded preflight/device facts; live authority never resides on the SSD.

At each step prefix the subcommand with `/usr/bin/python3 -I
<reviewed-checkout>/tools/stage_destination.py`. This script copies normal file
bytes and executable status; it does not promise ACL/xattr/resource-fork/signature
preservation. Verify the copied full package with `codesign --verify --deep
--strict <stage>/data/codex-runtime/CodexCLI.app`, then its reviewed `bin/codex
--version`, and confirm node/gh/dependencies and exact code SHAs through 1308's
preflight. Any unsupported package metadata is a staging blocker, not an excuse
to launch a partial runtime. Do not execute profiles, routes or copied scripts.

1304 runs only isolated synthetic controls. Actual external APFS encryption,
mount/UID access, selected totals, throughput, destination binaries/signatures
and space are 1313 execution receipts, not claims from these tests. The 124 GiB
19:06 report is historical; refresh immediately before copying. Account/login is
a Tony dependency. Use the dedicated encrypted `theseus-move` volume after Tony
creates/unlocks it, pinned by observed VolumeUUID rather than a transient disk
number. `secretsky` is unencrypted with ownership disabled and contains Tony's
other files: never copy private material there or alter its mode/files. This
pack requires ownership enabled on the dedicated transport; enabling it or
resolving cross-account readability is a separate Tony/Warp access step. No
password, sudo or mount-policy command is embedded. CLI `copy` rechecks encrypted
external APFS, ownership, UUID, device placement and capacity immediately before
creating the target; the destination leg additionally requires internal storage.
SSD erasure belongs to the separately confirmed 1311/Tony/Warp
step after receipts/archives and round trip are preserved; no erase command is
included here. Off switch: do not invoke the pack; no installed hooks exist.
