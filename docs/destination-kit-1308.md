# Destination kit preparation (1308)

`tools/destination_kit.py` prepares proposed config bytes and a read-only
preflight. It never imports or invokes deployment, changes a profile, activates
authority, starts a service, or moves production data. Warp adopts separately
under1315 after exact judged review. Existing kit/guard bytes remain unchanged.

`inventory --landing-config FILE --repo REPO` reads the selected installed guard,
approved source manifest, verified code, current landing/deploy config and kit.
It checks their declared hashes and reports exact file hashes; paths are source
observations, not destination authority. Profile files are never opened.

On the inventoried SOURCE host, `prepare --request FILE --output NEW_PRIVATE_DIRECTORY`
takes v1 JSON with a
canonical UUID `packet_id`, the complete `inventory` result, and `destination`:
`home`, `host`, complete proposed `landing` and `deploy` config objects. All
destination absolute config paths must be canonical descendants of `home`;
the host differs from the source. Release branch/repository/workspace/seat and
guard source identity remain unchanged. Service profile/route names stay local
relative file names. No binding/activation observation is accepted as an input.
When tailnet_origin is supplied its HTTPS host/port must name the explicit
destination. The complete deploy admission group (outcome, instance, exactly
one broker/profile) is preserved. Source hashes are rechecked before any output.
The pack contains only proposed
landing/deploy JSON, unchanged inventory and a canonical request/receipt.

The output parent must be owned by the actual uid and private, with no symlink
component. Pack directories use0700, files0600; hard-linked files are refused.
Each file is created exclusively and fsynced. The exact request is written first,
the manifest last, with directory sync. A partial same-request retry verifies
existing bytes and fills missing files; changed requests/occupied bytes refuse.
A matching-file retry reflushes the file and its containing pack directory;
failed confirmation still fails the retry, even when all bytes are present.
A missing manifest means incomplete, not success. `--disabled` writes nothing.

On the DESTINATION, `preflight --pack DIRECTORY` verifies every sealed byte,
private local ownership and proposed request/config/inventory schemas. Original
source paths are provenance only: this command never opens or rehashes those
paths there. Its report explicitly leaves source freshness unchecked. It reports
dependencies1306 durable activation,1307 supported rebinding, destination account,
staged kit/tool versions and Warp1315 adoption as pending. It cannot clear these
from copied JSON or fixture results. Python3.9/native arm64 architecture,
Node v26.12.1, gh and
pinned Codex0.167.0-alpha.3.2 need fresh destination receipts in1315. Existing
permanent enforcement remains; this new tool is report-only with `--disabled`
as the off switch and the reviewed manual config process as fallback.

Relay: Warp supplies the reviewed request and runs `inventory`/`prepare` on the
source while its inputs are available. Copy the sealed pack into fresh private
LOCAL destination scratch through the reviewed staging procedure. cf-hands,
running as actual local commonfabric, runs only `preflight` there; theseus under
tonyespinoza only relays. Retain both JSON answers and exact argv/terminal.
Destination staged kit/runtime compatibility is separately owed by1315, using
real staged-input receipts. A lost answer resumes the same packet/request,
never a new id. A timeout or partial pack is not adoption. Do not run old SPECs.
Bulk material follows the current sourced transport decision. Rule19 selects
only /Volumes/secretsky/theseus-move on observed VolumeUUID
E899C601-EF65-4C1E-9F0B-4D90AD6A7ABC, with ownership ignored and encryption
facts recorded without requiring encryption. Other secretsky files stay untouched.
Import remains into fresh private actual-user-owned LOCAL files. This pack
authorizes no transfer, recursive ownership change, deletion or live authority
on removable media;1315 consumes the reviewed staging/activation receipts.
