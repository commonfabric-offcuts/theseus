# Destination staging pack (1304)

This offline CPython3.9 file tool is preparation only. Warp owns real1313
execution through destination cf-hands, actually logged in as its commonfabric
account. No Core, service, profile/route installation, autostart, final database
export, authority change or deletion occurs.1305/1306 own final export,
reservation, exclusion and activation; this manifest supplies no authority.

Tony's27713 decision/current-rule19 selects ONLY `/Volumes/secretsky/theseus-move`
on external APFS VolumeUUID `E899C601-EF65-4C1E-9F0B-4D90AD6A7ABC`. Encryption is
observed/recorded, not required. The tool records ownership policy and requires
ownership ignored for this cross-UID route. Source501 private files would be
unreadable by destination502 with ownership enabled. Local destination files
remain strictly private and owned by its actual account; never apply source
numeric UID/GID. Other secretsky files stay outside all write targets. No volume
creation, mount-policy, password, sudo/chown or erasure command is embedded.

`tools/stage_destination.py` snapshots explicit selected roots into a private
manifest: relative path, bytes/SHA256, source mode/UID/GID and executable status.
It rejects symlinks, hardlinks, special files, cross-mount children, group/other
write, unowned or changing source inputs. `private:true` additionally rejects
all group/other mode bits. Existing0644 evidence/outbox/W roots need
`private:false`: that is source-mode classification, never public disclosure.
All resulting transport/local directories are0700; files0600 or0700 for executables.
Manifest/configuration/outbox contents remain opaque and off-board.

Selection JSON is private0600, under a private existing0700 parent:

```json
{"v":1,"selection_id":"a canonical locally minted UUID","roots":[
  {"label":"codex-runtime","path":"/Users/commonfabric/.local/share/theseus/runtimes/codex-0.167.0-alpha.3.2","private":false},
  {"label":"selected-evidence","path":"an explicitly reviewed canonical path","private":false},
  {"label":"selected-private-config","path":"an explicitly reviewed canonical path","private":true}
]}
```

Select exact code/tool SHAs, the ENTIRE pinned Codex package, private configuration,
original outboxes/receipts and all raw proof explicitly. Git refs do not replace
proof. Preserve original request bytes and historical path strings. Do not select
the live DB, authority anchor/locks, sockets or active services. The18:02 bundle is
staging only; this byte inventory is not a consistent database backup.

Warp fills each angle-bracket input with reviewed exact values and records them
before execution. Prefix each subcommand below with `/usr/bin/python3 -I
<reviewed-checkout>/tools/stage_destination.py`. No actor profile is used.

1. Source commonfabric: `snapshot --selection <private-selection.json>
   --manifest <new-private-local-manifest.json>`. Retain its SHA256 and full
   selected byte/file totals. Keep that digest pinned on both copy legs.
2. After Tony mounts the selected SSD, create an explicit new0700 staging parent
   INSIDE `/Volumes/secretsky/theseus-move`; never alter the folder or its siblings.
   Resolve `id -u`/`id -g` independently on each Mac. Run `preflight --account
   commonfabric --volume /Volumes/secretsky --volume-uuid
   E899C601-EF65-4C1E-9F0B-4D90AD6A7ABC --parent <existing-private-stage-parent>
   --selected-bytes <measured> --extra-bytes <candidate-media-final-bundle-budget>
   --reserve-bytes <explicit-reserve> --receipt <new-private-local-receipt.json>`.
   It validates actual user, Python3.9/arm64, unlocked external APFS UUID/mount,
   the exact selected folder, ownership policy and refreshed local/transport
   space. Unknown observations refuse.138GiB at19:29:14 is historical, not this check.
3. Source: `copy --manifest <local-manifest> --digest <pinned-sha256>
   --destination <new-pack-under-selected-private-transport-parent> --account
   commonfabric --volume /Volumes/secretsky --volume-uuid
   E899C601-EF65-4C1E-9F0B-4D90AD6A7ABC --extra-bytes <budget>
   --reserve-bytes <reserve>`. Copy the private manifest alongside the pack ONLY
   within that same selected private parent and verify its separately pinned
   digest. Before detach retain the completion/verification receipt.
4. Destination commonfabric: repeat preflight; `verify --manifest <SSD-manifest>
   --digest <pinned-sha256> --directory <SSD-pack> --transport` proves this account
   can read every selected transport byte. A real read/mode/link/hash barrier is
   a stop, never permission to relax local ownership checks.
5. Destination: `copy --manifest <SSD-manifest> --digest <pinned-sha256>
   --from-directory <SSD-pack> --destination <new-private-LOCAL-stage>
   --account commonfabric --volume /Volumes/secretsky --volume-uuid
   E899C601-EF65-4C1E-9F0B-4D90AD6A7ABC --extra-bytes <budget>
   --reserve-bytes <reserve>`. Then `verify` without `--transport` checks every
   local inode against the actual account. CLI copy repeats mount/capacity and
   exact folder placement checks immediately before copying; local import must
   be on internal storage, not removable media.

Copy creates targets exclusively, streams normal file bytes without numeric
ownership preservation, fsyncs files, verifies the complete tree and writes
`complete.json` last. Reject missing/extra entries, changed bytes/modes/type,
links and local wrong ownership. Existing/partial targets refuse and stay kept.
For a lost response, `verify` the SAME target/digest; do not overwrite/delete it.
There is no automatic partial-copy resume. Completion means staged files only,
not authority or durable cross-host handoff. Cooperative same-user operation is
assumed; hostile ancestor replacement is outside the guarantee.

This copier does not promise ACL/xattr/resource-fork/signature preservation.
Verify the copied full Codex package with `codesign --verify --deep --strict
<stage>/data/codex-runtime/CodexCLI.app`, its reviewed `bin/codex --version` and
all dependencies before adoption; an unsupported metadata need blocks execution.
1308 pins Nodev26.12.1, matching source `/opt/homebrew/Cellar/node/26.12.1/bin/node`
(SHA2564a8ab2181dd5648befd2d4932bd4ceb9782d8b81fad23ae758ecc4e170e972f9).
Stage a supported complete native package/dependencies, not that single Mach-O.
Destination22.17.1 was an earlier same-binary report under tonyespinoza, not a
cf-hands version read or compatibility verdict. cf-hands must directly verify
version/architecture/dependencies. Python3.9.x arm64 and
Codex0.167.0-alpha.3.2 remain pinned; installation/login/execution receipts belong
to1313/1308 and their adoption owners, not these synthetic controls.

Actual both-Mac mount/readability, selected totals, throughput, capacity and
runtime/signature proof remain execution obligations before any live fence.
1304's real-byte synthetic UID-fact model does not establish actual502 OS access.
After verified1311, Tony/Warp handle only the selected transfer folder under
Tony's chosen cleanup policy, preserving required receipts/archives; this pack
contains no deletion. Off switch: do not invoke it; no hooks are installed.
