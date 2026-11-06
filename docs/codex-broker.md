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
`theseus_wake_broker/0.163.0-alpha.10.2`, followed by a nonempty tail. The effective
`codexHome` must resolve to the compared root. This is a compatibility guard,
not evidence that a malicious executable is authentic.

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

## Proof and operational limits

Isolated stdio fixtures exercise the actual broker process through the real
invocation adapter. They record received requests, environment, process group,
EOF and exit, and verify that pending delivery state is unchanged. They do not
prove persistence or consumption in the installed Codex app.

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
