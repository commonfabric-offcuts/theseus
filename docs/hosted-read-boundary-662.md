# Hosted sandbox read boundary (662)

Base: release 236 `96b286654ed3029af8c9c4bdf8afdc3af186aa6c`, rebased under
Warp 13899 from the original 938 carry `e2c21890032f0d817c8233e3999465a7737a4706`.
This changes workspace-mode hosted routes. Explicit full-access routes remain
outside the sandbox boundary. No schema, live route or installation change.

Use the installed Codex's named permission profiles on thread/start,
thread/resume and every turn/start, replacing legacy sandbox overrides. The
host constructs the profile and checks its selected identity in the response;
an unsupported or missing selection refuses work, with no unsandboxed fallback.
The profile identity includes a digest of its host-authored definition.

The filesystem denies the instances/profile directory, the thread's Codex
home, the account's .codex, .config, .ssh, .aws, .kube and Library/Keychains.
The selected authority file is denied explicitly even outside those folders.
The current store file has an exact read-only exception. The actor's outbox
and work directory have their existing write capability; no database-directory
write grant remains in the effective policy. A work directory cannot encompass
the protected roots. Canonical paths are used. Temporary directory writes stay
excluded as before, by overriding the inherited `:tmpdir` and `:slash_tmp`
grants themselves; a same-path absolute read rule loses to an inherited write.
The host also requires the corresponding exclusion flags in the selected
profile's native echo. Existing tools and source outside the protected paths stay
readable. Only this thread's local broker socket is allowed. Material Codex
default: its Unix allowlist activates only with network.enabled=true, so the
host also enables the network proxy with **no allowed domains**; direct TCP
and outbound destinations remain denied. Tests must prove this rather than
equating the enabled bit with isolation. No credential is copied into a prompt
or into a broker descriptor.

The trusted host owns one local socket transport per workspace-mode route.
It binds its actor, instance, authority and destination before serving it, and
checks the binding/pin on calls. A request cannot choose another profile, actor,
store, route or filesystem path. The socket lives in a private host-owned
temporary directory outside the agent's writable roots and ends with the host.
938's compatibility check already classifies these module changes as requiring
a full host restart; compatible later web releases keep the same host/socket.

`aim-next --broker SOCKET` uses the existing bounded CLI verbs and exact saved-outbox
requests through a Store adapter. Only view, command, media publication bytes,
and Core-authorized media reads cross the socket. Attachment input/output and
outbox file I/O remain inside the sandbox; the broker never opens a path named
by its client. All Core calls use the route's fixed actor and existing Core
authority. Lost replies use the existing operation lookup/retry, never a new
operation. A missing, stale or mismatched broker fails closed. Direct profile
CLI mode remains available outside protected workspace routes.
The long-lived `watch` verb refuses in broker mode; standing hosted work is
delivered by the existing host, and `inbox` remains the bounded pending read.
It does not silently drop the direct watch's authority-anchor companion.

Wire messages have bounded length-prefixed JSON headers and bounded binary
media bodies. Timeouts and bounded concurrent connections contain malformed
or stalled clients. Shutdown closes accepted sockets and reaps its owned
service workers. No network/model-service call is required by the tests.

Meaningful proof: actual installed Codex sandbox reads a synthetic credential
beside scratch profiles before the change and refuses it after; worktree/tool
reads and a real read-only SQLite query keep working. Check denied session/key
canaries, relative/symlink paths and files created after sandbox startup,
rejected store writes, and a real CLI command/read/attachment/retry through the
actor-bound broker while its profile is unreadable. Check cross-actor binding,
route changes, unsupported/wider policy echoes, and host/socket cleanup below
the browser. Apply/remove the read guard and actor binding separately, retain
the failure, and restore. Existing host lifecycle assertions remain.

Limits: this bounds local sandboxed file/command access, not unsandboxed apps,
MCP servers, remote tools, a full-access seat, other processes running as the
same OS user, secrets already copied into readable source/context, or arbitrary
secret locations not in the named roots. The explicitly readable raw store is
not an actor privacy boundary. It is not a second macOS user or VM. No claim
that currently running seats have changed permissions before guarded landing.

Protocol/config facts were checked against the installed
`0.167.0-alpha.3.2` generated schema and real sandbox executable, and the
[official Permissions documentation](https://learn.chatgpt.com/docs/permissions).
The initial native red/control evidence is in actor evidence/662; all canaries
and databases are synthetic scratch data, never real credentials or accounts.

Verification on release 236: 100/100 passed in the focused boundary, CLI,
route, notice and 938 deploy/runtime cohort. The boundary's 13 cases include
actual sandbox denial and read/write controls, native app-server start/resume
selection without a model turn, a real runner's broker-backed reply/ack,
media, committed-operation retry and partial-client shutdown. Applied removal
of the profile read deny made a synthetic credential readable; removal of the
binding comparison accepted a mismatched client. Both restored controls passed
with exact source hashes. The read mutation was repeated on the final policy.
The additional temporary-write control first failed with absolute read rules;
the symbolic override above fixes it. Raw failures remain in the evidence.

An earlier, wider 64-case host/control run on the original 938 carry had 38
passes and 26 failures. Its 24 host failure identities match the approved
938 baseline; the other two control failures were freshly reproduced on
untouched `e2c21890`. That wider run preceded the final authority/temp guards
and was not rerun on 236. The 100-case final cohort is green; this is not a
claim that the broader host suite is green. No authenticated model turn,
browser, live credential read or live permission change was used for proof.
