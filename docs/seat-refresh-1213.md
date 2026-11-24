# Refresh a hosted seat (1213)

`seat-refresh OUTCOME ACTOR [ACTOR ...] [--operation ID]` requests one fresh
thread for each named hosted actor, including operator-mapped seats that have
no managed seat-request row. This is CLI-only, without schema changes. The
current outcome's human owner alone may request it, as `_seat_owner` already
requires for End/Retry. Coordinator status adds no authority. Existing actor,
profile, authority binding, human control owner, Stop/Continue revision, model,
permissions, configured role and old thread/history remain unchanged.

`workspace.hosted_seat_refresh` targets `{workspace_id}` and supplies a bounded
`seats` array (1–32 distinct actors, with their captured execution revision and
thread ID). Its expected workspace revision fences ownership. The scoped
owner-only `hosted_seat_refresh` read captures these inputs for the CLI and
reports each latest intent. A stopped/ending/disabled/nonmember/unpinned seat
refuses the whole batch before any intent is recorded. Exact operation replay
returns the original receipt; a second request while the same old pin has an
unfinished intent reuses that intent. Another explicit request after a
completed refresh can replace the now-current thread.

`seat-refresh OUTCOME ACTOR [ACTOR ...] --status` reads the latest phase,
intent ID, old/new thread IDs, request time and activation time (`committed_ms`).
It takes no operation ID and remains readable after Stop cancels an intent.
An overlapping manual batch joins the same unfinished intent for the shared
actor; an unfinished automatic recovery or changed guard refuses the whole
batch. Native effects after admission are independent per actor, so a batch
receipt does not assert simultaneous activation.

Each request creates the existing bounded1104 metadata intent, with a separate
`trigger` naming the refresh operation/author/outcome. The existing `origin`
retains its route-origin meaning. Manual refresh needs no qualifying turns,
pending delivery or absence of CLI activity. The runner captures its immutable
configuration fingerprint when it first handles the request under its guard.
Control changes, owner changes, binding/pin changes and ending still fence
creation/activation. An open old turn returns waiting, retaining the intent;
it is never interrupted or cancelled merely for being open. No model turn or
delivery is fabricated: replacement runs when actual work next reaches the
host, then that same pending delivery starts the fresh thread.

The host reuses1104's ready/creating/created/prepared/committed protocol,
created-ID journal, persistence/settings checks and crash/late-answer handling.
An uncertain native creation remains uncertain, never authority to create
again. Pending work and native/Core history survive. Ordinary runner restart
still resumes the committed pin; it is not a refresh.

Every fresh thread/start (provisioning, automatic1104 recovery and refresh)
receives a factual bootstrap in its startup developer input: first read
`docs/seats/ACTOR.md` in the repository rooted at the selected live CLI, then
recover current work from the board. The configured role remains byte-for-byte
unchanged. Resume retains that same bootstrap so thread settings stay
consistent. No seat file is silently copied into metadata or interpreted as
restart authority. Failure to read its seat file is a visible agent limitation,
not permission to change identity or invent work.

Verification uses scratch Core and the real runner/host against the scripted
fake app-server: exactly one replacement and immutable identities/settings,
batch all-or-none refusal, stopped/owner/coordinator/pin/revision guards, open
turn waiting, lost answer/retry, all fresh-start bootstrap paths and ordinary
same-thread restart. Synthetic protocol evidence proves neither model behavior
nor live restart timing. The builder performs no live seat operation; landing
restarts the runner separately, and dry-run authorization/execution remains
with its named owners.
