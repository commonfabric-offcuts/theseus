# Cold ready managed-seat requests (1332)

`stage_destination_seats(store, publication_receipt, request)` is a dormant
internal library with no runtime caller. It exclusively writes
`seats/SEAT/request.json` and last `manifest.json` for1–8 already-ready managed
seats. Nothing installs a plan, selects a map or starts a consumer.

The exact v1 request keys are `v`, `output_root`, `output_dir`, `hosted_request`,
`hosted_result`, `hosted_manifest_bytes`, `hosted_manifest_digest`, `seats`.
A seat row has `seat_id`, `expected_version`, `seat_snapshot`, `seat_digest`,
`plan_bytes`, `plan_digest`, `control_bytes`, `control_digest`,
`source_request_path`, `source_request_bytes`, `source_request_digest`.
Snapshot includes all CURRENT hosted_seats columns except plan, including the
opaque historical runner_token as data, never permission. Digests cover exact
UTF-8 raw texts or canonical recovery_io snapshot encoding. Limits:8MiB request,
12MiB manifest,64KiB snapshot/plan,8KiB control,128KiB source/output request,
16KiB role and4096 UTF-8 bytes per normalized absolute path. Unknown/duplicate
fields, nonfinite values, invalid types, unsafe seat components and overflow
refuse without truncation.

Actual inputs are confirmed1326/current immediate lineage/original THREE
DB/authority-lock/runner-lock pairs, exact nested1327 profiles and1329 HOSTED
request/result/manifest/files.1331 broker output is not an input. Unchanged
inspectors validate actual new files, hashes/modes/identities/empty outboxes;
manifest text/digest, requests/results and publication must agree. Historical
profile/config/request/CLI/executable/home/cwd strings are data, never resolved
or opened. Supplied source-request digest is consistency, not independent
historical filesystem authentication.

In one short CURRENT-DB transaction, byte-bound selected row/role/plan/control
fetches BEFORE allocation/decoding; read only explicit seat IDs, actor/workspace
access and control keys and strictly derived predecessor pin keys. Match exact
CURRENT snapshot/version/raw plan/control digests, enabled agent, enabled human
controller and current workspace-owner/member access conditions. These are the
same access predicates as _seat_access/_actor with bounded column reads, not
changes to those runtime validators. Normal Store/lineage/identity checks stay.
Connection closes before any output. The SELECT-only application callgraph
uses unchanged _connect mode=rw, not engine-enforced readonly.

Entire selected batch must have state/stage ready, no end state, positive
ready_seq, first_message_id, a full supported nine-field plan and canonical
recorded thread. Nonready/ending/missing/stale/malformed/conflicting or already
rebound control holds the batch; no skipping, empty success or invented plan.
Full plan/thread/pin at delivery is not ready. Exact predecessor control binding,
actual human owner, desired running/stopped, revision and changed_ms are retained;
inviter/invitation owner/current workspace owner are separate fields. Never
provision defaults, relax current-bound control parsing or follow recovery.

Both source profile/config references, old request seat_id/plan and old plan
CLI/cwd/home/executable/model/permission/effort/thread must match1327/1329 and
CURRENT row/plan/pin. Source v2 instructions must equal CURRENT role literally.
Template identity (including None), first task and ready sequence remain exact.
Recovered thread/config ambiguity refuses for separate supported work.

Output request keeps `{seat_id,plan}`; plan has exactly profile,config,cwd,cli,
codex_home,codex_executable,model,reasoning_effort,permission_mode. Only
profile/config/CLI references are projected from actual1327/1329. Other fields,
thread and role/settings relationships remain exact. Full permission is the
existing supported managed-plan shape, never a policy widening.

Use one exclusive new0700 private direct child, N+1 private0600 files and exact
bounded directories. Protect authority/media/control,1327/1329 and old
profile/config/request/home/cwd contexts. Never write beside plan.profile,
create a cwd/outbox or replay SeatHost._profile/_published_config/_adopt.
Existing/partial output is held, never overwritten/repaired/deleted/redirected.
Flush/recheck identities, rows/control/pins/artifacts, publish manifest LAST,
flush/read back/recheck through confirmation. Uncertainty retains artifacts
without confirmation. Manifest retains complete provenance/witnesses/projection
relationships and exact file/directory hashes/modes/identities.

Success is cold_seats_staged,durability_confirmed:true,requires_adoption:true.
`inspect_destination_seats(request)` is bounded/read-only: not_started,
seats_incomplete,cold_seats_observed; durability always false, adoption required.
Observation grants no current-authority or startup permission. Existing stored
immutable plans/thread/identity/role, controls, settings, pins, profiles,
outboxes and requests remain unchanged. A future explicit overlay/adoption
must avoid the old _profile write path; no such integration is present.
Real transitions retain separately judged CURRENT-live full-copy rehearsal,
revert, independent run read and Tony authorization. D finishes publication
before chown, proves stopped writers and fixes the complete artifact set before
actual ownership capture. Inventory/fence metadata is not process closure.
