# Same-owner retirement and publication (1326)

`aim_next.relocation_cutover.publish_relocation(request)` consumes a completed
1325 stage. `relocation_readback(request)` only observes. Neither is wired to a
CLI, server, broker or runner. Library deployment invokes no authority operation.

Request: `{v: 1, stage_request: EXACT_1325_REQUEST, stage_digest: SHA256,
journal_root: EXISTING_PRIVATE_ROOT}`. The digest is the canonical completed
stage record digest. Identity is `(journal_root, move_id)`; all original nested
requests, the stage's already persisted epoch and actual same UID are retained.
Cutover journal roots must be separate from all source, destination and earlier
preparation/intent/stage roots. No epoch, request or operation ID is reallocated.

The immutable claim pins the complete verified stage/claim, original predecessor
and actual journal/lock identities. An incomplete initial claim is held, never
reconstructed. A private journal lock serializes retries. Before retirement,
complete stage hashing/verification and checked flush run under its stable
journal/destination locks outside global fences. Then source authority/runner EX
and destination authority/runner EX are acquired nonblocking in that fixed order.
All named/held lock identities, destination parent/media/DB facts and metadata
are checked again. The exact old anchor/digest/epoch, DB inode and BOTH commit
fields must still match the 1324 observation. SQLite reads are short, read-only
and close before fences; no copying/hashing/network work is in those transactions.

Only the source anchor changes: its exact predecessor becomes `state=retired`
with request/stage/journal lineage. Source DB/media and stable lock inodes stay
unchanged. A complete private temporary record is flushed, atomically replaces
the exact old anchor, and the retired anchor/directory are freshly flushed and
read back before a durable retirement receipt. No destination is enabled before
that barrier. Existing active validators remain unchanged and reject retirement.
The new private reader accepts only this claim's exact retired record for resume.

Destination publication uses the claimed stage epoch and actual DB/authority-lock/
runner-lock pairs, retaining instance/authority IDs, original cutover commit and
history facts. No DB or media bytes are rewritten. An exclusive temporary anchor
is linked without replacing an occupied destination, then its own temporary alias
is removed and anchor/directory flushed. The one recoverable two-link interval is
recognized ONLY when the two exact private names identify the same inode and
contain the exact expected canonical record. Readback never removes an alias;
mutating retry can remove only that verified alias. Foreign/partial records and
unknown links remain held. No automatic source restoration exists.

| Observation / failure | Result and continuation |
| --- | --- |
| Missing journal | `not_started`, no mutation or inferred authority state |
| Missing/partial initial claim | `cutover_incomplete` or typed unconfirmed; no reconstruction |
| Stale source/commit, substituted file/lock/path, busy inherited guard | Refuse before retirement |
| Retire temp write/rename/flush/close loses its result | No destination; same-ID exact retired observation must be freshly flushed before advancing |
| Exact retirement, destination absent | `source_retired`; verify inactive stage again and continue forward |
| Destination link/unlink/flush/close loses its result | `published_observed`, never durability inferred; source restoration forbidden |
| Exact completed retry | Validate publication lineage/actual identities first, freshly confirm same records; no epoch/copy/old-operation replay |
| Unknown/conflicting/partial anchor or record | Typed held/unconfirmed, no overwrite, cleanup or rollback |

Readback is bounded/read-only and never creates, flushes or repairs. Observed
states have `durability_confirmed=false` and no usable `binding`. Only checked
confirmation returns `published`, durable true and the explicit destination
binding; it never saves that binding or starts a consumer. Matching published
retry uses shared authority read fences, so an active destination runner need
not stop. New destination commits are valid: verify current lineage/epoch/inodes,
not the old staged hash or commit. Keep original cutover and observed current
commit separate. No inactive payload oracle runs on active data.

Retirement/publication/resumption ship together and never enable two valid
writers. Incomplete states may leave neither side writable. Injected IO/process
exit tests are not hardware power-loss or external process-group guarantees.
Real-board execution still requires judged-first full-current-live-copy throwaway
rehearsal, revert proof, independent run read and Tony authorization. Cross-UID
transport/ownership/service/account operation, current route/control/plan adoption
and lineage-bound original-operation lookup remain separate. Old operation bytes,
human owner/Stop/Continue/revisions are preserved, never automatically adopted.
