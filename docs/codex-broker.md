# Explicit Codex wake transport

This transport tells one bound Codex chat to inspect its durable Theseus work.
It does not deliver message bodies, acknowledge a delivery, or prove that an
agent has read or acted on anything. SQLite remains the sole record authority.

The generic invocation owner calls `bin/aim-next-codex-broker --config PATH`
with its committed attempt hint on stdin. The executable records its deadline
before importing repository modules and disables Python bytecode caches, so a
read-only installation is sufficient. Interpreter startup and any surviving
process group remain bounded by the outer invocation owner.

## Explicit configuration and binding

There is no default root, executable, profile, route search or actor fallback.
All paths below are absolute, existing canonical spellings. The map, route and
config are private regular files owned by the current user, at most 65536 bytes.
Duplicate and extra fields are refused.

- Map: `{ "v": 1, "routes": { "ACTOR": "/absolute/route.json" } }`.
- Route: `{ "v": 1, "profile": "/absolute/actor.profile.json", "argv":
  ["/absolute/bin/aim-next-codex-broker", "--config", "/absolute/config.json"] }`.
- Config: `{ "v": 1, "profile": "/absolute/actor.profile.json",
  "codex_executable": "/absolute/installed/codex", "destination":
  { "kind": "codex-queue-stdio", "protocol_version": 1,
  "codex_home": "/absolute/codex-state", "thread_id": "lowercase-uuid" } }`.

The effects runner loads its explicit map once and must restart to change it.
`load_route_map` checks all selected routes at startup. `preflight_route` checks
the selected route again immediately before dispatch, including its captured
claim. Map actor, route profile, config profile, claim recipient and stored pin
must agree. Within this map, route/config paths and root/thread destinations
cannot be shared by two actors. This is not a scan of every instance or chat.

The child independently validates the exact stdin shape: `v`, `binding`,
`wake_generation`, and `attempt_id`. Binding contains the instance ID, actor ID,
database path, authority ID and authority epoch. It opens the explicit profile
and compares the persistent Core route pin before starting any API process.
It captures the destination returned by that comparison. Later config changes
cannot redirect the invocation; ambient `CODEX_HOME` never selects a root.
The child neither provisions a pin nor repairs or rebinds a profile.

Startup failure refuses startup. After a claim, the effects runner distinguishes
a missing/changed pin from ordinary configuration absence and storage
uncertainty, as specified in its plan. `broker_routes` preserves Core's typed
pin/storage errors for that caller. The child reports an ordinary nonzero
transport error and performs no storage settlement of its own.

## Installed executable trust

The generic broker executable still uses the existing strict invocation policy.
The selected Codex child has a separate policy: a canonical regular executable,
owned by root or this user, with no group/world-write permission; every ancestor
must also be owned by root or this user and not world writable. The only allowed
group-writable ancestor is exactly `/Applications`, root:admin with exact mode
040775. A firmlink spelling or another writable directory gets no exception.

This trusts local administrators as well as root and the current user. It is
neither a signature check nor protection from a trusted operator swapping the
installation between path validation and execution. No binary is discovered,
copied or chmodded by this transport. An app update to an unreviewed transport
version stops queue operations until that version is explicitly reviewed.

## Bounded protocol

The child runs the selected executable with `app-server --listen stdio://`,
without a shell, detach or new session. Its explicit environment contains only
the invocation allowlist (`HOME`, `LANG`, `TMPDIR`, a fixed system `PATH`) plus
the root captured from the pin as `CODEX_HOME`.

Initialization enables the experimental API. Before queue operations, the
first ASCII-space-delimited `userAgent` token must be exactly
`theseus_wake_broker/0.167.0-alpha.3.2`, followed by a nonempty tail. The effective
`codexHome` must resolve to the compared root. This is a compatibility guard,
not evidence that a malicious executable is authentic. The version is one
constant, `VERSION` in `aim_next/codex_broker.py`; the Codex host applies the
same guard (`handshake_refusal`) with its own client name.

Only initialize, initialized, queue/list and queue/add are sent. Incoming server
requests cannot obtain approval. Duplicate JSON fields, unexpected response IDs,
RPC errors, partial responses, EOF and malformed pages fail the invocation.

- One absolute four-second budget starts at executable entry, including config,
  pin lookup and cleanup. At least 500 ms is reserved for cleanup, and at least
  one second must remain in the RPC budget before starting an add.
- At most two list pages, 100 entries each, with bounded nonrepeating cursors.
  A valid incomplete scan may add once. An incomplete RPC is never absence.
- At most 1 MiB of aggregate inbound bytes, including notifications. Nonblocking
  pipe operations share the same deadline; partial I/O cannot renew it.
- At most one add, with a namespaced client ID derived from the committed attempt
  ID and full binding. A later attempt gets a new ID. There is no local ledger
  or reliance on lifetime client-ID deduplication.

A queued canonical Theseus hint coalesces only when its complete binding,
destination, profile and fixed instruction match. Generation and attempt are
validated historical context, not filters on what the agent should read now.
Plaintext, unknown protocol shapes, extra inputs and foreign bindings cannot
coalesce. A matching item beyond the two-page window may produce a duplicate
hint; this bounded duplicate is deliberate.

An add requires a nonempty returned queue item ID and the exact client ID and
input. Losing its response is an error, even if the add might have committed.
There is no retry inside the broker. A validated add exits 0 (accepted) and a matching
queued hint exits 10 (queued: nothing new reached the agent), each only after
closing stdin and confirming this API child exited zero within the budget. Otherwise the generic invocation owner confirms owned-group
cleanup before settling the attempt. The broker sends no signals to discovered
processes and never uses the legacy pending exit code.

## Why a wake was refused

A refusal names its reason. Before exiting 1, the broker writes one line to its
standard output, `{"refused": CODE}`, and nothing else; it never names a
request, profile, body or credential. The invocation owner reads that output
as it comes (so a broker never blocks on a full pipe), and when it is exactly
one such line of at most 1024 bytes, `CODE` becomes the settled wake's reason
(`finish_wake(..., reason=CODE)`), which Health keeps and says in words
(docs/health.md). Fields it does not know are ignored. Any other output, or
none (an older broker), is the anonymous `broker_exit`, as before; an older
owner that discards output sees exit 1, as before.

| code | when |
| --- | --- |
| `codex_version:<found>:<reviewed>` | the app-server is this client at another version: the version it reported and `VERSION` |
| `codex_home` | its `codexHome` resolves to another directory than the pinned root, or does not resolve |
| `codex_protocol` | an RPC error, a server request, a malformed `userAgent` (no tail, another client, a version that is not a plain version), a missing or relative `codexHome`, an unexpected response ID, too many inbound bytes, or a page, item or receipt the broker refuses |
| `codex_spawn` | the selected executable could not be started |
| `codex_no_answer` | the app-server's output ended, it stopped reading, or the budget ran out before its answer (including too little time left to add) |
| `codex_exit` | the add was validated, but the app-server did not exit zero within the budget |
| `broker_config` | the broker's own arguments, stdin hint or config were refused before Codex started |

A version mismatch is the expected refusal after the app updates: the gate
stays shut until the new version is reviewed, and Health says which version
the app is now and which one was reviewed, rather than asking whether the app
is open.

## Reviewed version

`0.167.0-alpha.3.2` (the ChatGPT app's bundled Codex,
`/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`,
dated 6 Nov 2026), reviewed 11 Nov 2026 for item 328, replacing
`0.163.0-alpha.10.2`. The review compared every method and shape the broker
and the Codex host send and parse with the schema the binary generates
(`codex app-server generate-json-schema --experimental` and `generate-ts
--experimental`), then probed the live binary on this Mac.

- Methods: `initialize`, `account/read`, `thread/queue/list`, `thread/queue/add`,
  `thread/resume`, `thread/turns/list`, `thread/start`, `thread/compact/start`,
  `turn/start`, `turn/steer` and `turn/interrupt` are client requests;
  `initialized` the one client notification. Every server request the host
  answers or names (`item/commandExecution/requestApproval`,
  `item/fileChange/requestApproval`, `item/permissions/requestApproval`,
  `item/tool/requestUserInput`, `mcpServer/elicitation/request`,
  `item/tool/call`, `currentTime/read`, `account/chatgptAuthTokens/refresh`,
  `attestation/generate`, `applyPatchApproval`, `execCommandApproval`) and
  every notification it reads or opts out of exists under that name.
- `initialize`: `clientInfo {name, title?, version}` and `capabilities
  {experimentalApi, optOutNotificationMethods}` are accepted fields (none is
  required beyond `name` and `version`). The result is `{userAgent, codexHome,
  platformFamily, platformOs}`, all required; the broker reads only the first
  two. Live: `userAgent` was `theseus_wake_broker/0.167.0-alpha.3.2 (Mac OS
  26.7.1; arm64) unknown (theseus_wake_broker; 1)`, `codexHome` the pinned
  root, so the first-token rule holds unchanged.
- `thread/queue/list`: params `{threadId, cursor?, limit?}`; result `{data:
  QueuedSubmission[], nextCursor: string|null}` (`nextCursor` may be absent in
  the schema; the broker accepts absent or null). `QueuedSubmission` is `{id,
  input: UserInput[], clientUserMessageId}`, all required; a text input is
  `{type: "text", text, text_elements}`. Live: an empty queue answered `{data:
  [], nextCursor: null}`.
- `thread/queue/add`: params `{threadId, input, clientUserMessageId}`, all
  required; result `{queuedSubmission: QueuedSubmission}`. Live, one add on
  the auditor's thread: the receipt carried a 36-character `id`, the exact
  client ID, and the input echoed exactly (`text_elements: []` included); the
  broker's receipt check accepted it, and a following list returned the same
  entry with the same `id`, which the broker's page check accepted.
- The host's shapes: `account/read {refreshToken?}` answers `{account|null,
  requiresOpenaiAuth, workspaceRouting|null}`; `thread/resume` and
  `thread/start` accept every setting the host sends (`cwd`, `approvalPolicy:
  "never"`, `approvalsReviewer: "user"`, `sandbox: "workspace-write"`,
  `config`, `developerInstructions`, `model`, and `excludeTurns`, or
  `ephemeral` and `serviceName`), and answer `thread {id, status}`, `cwd`,
  `approvalPolicy` and a `sandbox` whose `workspaceWrite` form still carries
  `writableRoots`, `networkAccess`, `excludeSlashTmp` and `excludeTmpdirEnvVar`;
  `thread/turns/list {threadId, limit, sortDirection: "desc"}` answers `{data:
  Turn[]}` with `Turn {id, status: completed|interrupted|failed|inProgress,
  error {codexErrorInfo}|null}`; `turn/start` (with `clientUserMessageId`,
  `additionalContext` of `{value, kind: "untrusted"}`, `approvalPolicy`,
  `sandboxPolicy`) answers `{turn}`; `turn/steer` (with the required
  `expectedTurnId`) answers `{turnId}`; `ThreadStatus` is still one of
  `notLoaded`, `idle`, `systemError`, `active`; the server-request answers the
  host sends match their response types (an elicitation's `_meta` is
  optional); `item/completed` still carries `userMessage {clientId}` and
  `commandExecution {command}` with `turnId`; `thread/tokenUsage/updated`
  still carries `tokenUsage.last` with the four token fields the host reads.
- Additions the code ignores: `platformFamily`/`platformOs`,
  `TokenUsageBreakdown.cacheWriteInputTokens`, `ThreadStatus.active.activeFlags`,
  `ItemCompletedNotification.completedAtMs`, `ThreadTurnsListResponse.backwardsCursor`,
  and new optional request fields. No shape the code sends or parses differs,
  so no parsing changed. Only `initialize`, `initialized`, `thread/queue/list`
  and one `thread/queue/add` were sent live; the host's methods were checked
  against the generated schema only, and the probes in docs/codex-hosting.md
  ("Choices that wait on a probe") are unchanged.

## Proof and operational limits

Isolated stdio fixtures exercise the actual broker process through the real
invocation adapter. They record received requests, environment, process group,
EOF and exit, and verify that pending delivery state is unchanged. They do not
prove persistence or consumption in the installed Codex app.

The fixture executables (the stand-in app-server, and the bootstrap that runs
the actual broker script) are written once per test process and run once to
completion before any case dispatches. macOS assesses an executable file the
first time it runs: a newly written script took 0.6 to 3.1 s to start on the
bench Mac under load, a repeat run 25 ms. Written fresh for each case, that
first run fell inside the broker's own four-second budget, and a correct broker
refused with `codex_no_answer`. The case for a late but valid list answers at a
point measured from the broker's deadline (half a second of the RPC budget
left, and, as its control, one and a half seconds left). The bootstrap converts
that deadline to `CLOCK_MONOTONIC_RAW`, the shared clock already used by the
trace. It must not compare `time.monotonic()` readings from different processes:
[macOS gained a common origin in Python 3.10](https://docs.python.org/3/library/time.html#time.monotonic),
while this project uses 3.9. The positive control also shifts the fake API's
monotonic origin by 750 ms; both origins must still yield an add with the true
reserve remaining. The trace records the broker's own remaining time when it
receives the list, and the below-reserve case still refuses without an add.

Before activation, the selected real recipient must explicitly enter a
non-consuming interval. A single exact hint must survive confirmed API-child
exit and be found by a fresh child. Actual desktop consumption, an attributed
reply through the bound Theseus CLI with the web server stopped, and a separate
delivery acknowledgment are distinct subsequent checks. Disappearance while a
recipient could consume is inconclusive. No unrelated queue is inspected or
modified, and no chat is created as part of this trial.

The startup-only probe established the selected root/version handshake and
ordinary process exit on this host. It did not perform queue RPCs. Real queue
latency, API-process persistence, desktop consumption and configured-process
lifecycle remain operational prerequisites; budgets must not be silently
extended to obtain a pass.

Startup map uniqueness compares the pinned root directory's device and inode
along with the thread ID, so case variants and macOS firmlink spellings cannot
map two actors to one destination. This is a startup check, not a persistent
inode pin or a guarantee against a trusted operator replacing files. Core owns
root resolution and typed pin refusal; missing or redirected roots do not become
ordinary missing-configuration results. A root stat failure after pin comparison
is a visible startup binding refusal. The future effects loop owns durable
post-claim pause classification; this broker slice does not prove that loop.
