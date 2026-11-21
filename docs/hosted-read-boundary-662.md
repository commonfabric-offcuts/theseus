# Hosted sandbox read boundary (662)

Base: release 248 `b949e1f38780967c93526117aaa2117533aaa00e` under Warp
14216; review corrections follow 13982 and 14172. This changes workspace-mode hosted
routes. Explicit full-access routes keep their original policy and are outside
this boundary. No schema, live route or installation change.

A host-authored named permission profile applies on thread/start, thread/resume
and every turn/start. Its identity hashes the definition. Missing, wider or
unsupported selection refuses work, with no unsandboxed fallback.

The filesystem denies the instances/profile directory, every validated startup
Codex home (including legacy queue and full-access routes' homes), the account runtime's
`.local/share/theseus/codex-home`, `.codex`, `.config`, `.ssh`, `.aws`, `.kube`,
`Library/Keychains`, and the selected authority file wherever it lives.
Canonical paths are used. The raw store is denied: broker commands never need
to open it, and raw read-only SQLite would bypass Core's actor authority for
whispers, pins and receipts. This supersedes the original item's store-read
negative, explicitly narrowed by Warp 13982. Authorized reads use Core.

Only the actor's outbox and work directory remain writable. Temporary writes
stay excluded by overriding inherited `:tmpdir` and `:slash_tmp` rules; an
absolute read rule at the same resolved path loses to the inherited write.
The native echo must confirm both exclusions. Tools and source outside the
protected paths stay readable. Workspace containment is validated while
loading the route, including the broker's temporary root; invalid routes
settle unavailable rather than pausing the runner. An attachment under a prior
permission mode cannot accept or steer a differently configured claim.

The network-enabled bit is required by this Codex to activate its single Unix
socket allowlist. It is insufficient evidence of proxy enforcement. Workspace
children receive the named profile definitions and `features.network_proxy`
as explicit startup overrides, with a read-only default before selection.
Before provisioning or resuming, the host reads effective configuration and
checks the exact profile's filesystem, parent, empty domain map and socket
allowlist. It then runs a bounded sandboxed `command/exec` through that same
profile: direct loopback TCP must be denied and an HTTP request for a loopback
name through the proxy must return 403. No model turn or external destination
is involved. Only a successful configuration check and active probe permit
thread selection and later work. Unsupported/ignored configuration, an absent
proxy, a different definition or failed probe refuses that route.

Full-access children retain their original startup arguments. A workspace
route sharing a child home with a full-access route refuses proxy verification
rather than changing the full-access child's behavior. A mode edit on an
already attached thread also refuses; restarting with a consistently selected
configuration is the operator's act.

The trusted host owns one Core socket per workspace route, in a private
host-owned temporary directory outside the agent's writable roots. Every
request retains the fixed actor, instance, authority and Core route pin.
A client cannot choose another profile, actor, store, route or filesystem path.
Only bounded Core view/command requests and media bytes cross the socket.
Attachment input/output and the saved outbox stay inside the sandbox.

`aim-next --broker SOCKET` uses existing CLI verbs and exact saved-outbox
operations. Typed busy/authority/pin/storage failures preserve their codes and
retry status. A view exceeding its response frame refuses `RESPONSE_TOO_LARGE`.
An unsuccessful binding or read does not invent an operation to reconcile.
A genuinely uncertain command retains its saved operation, including when Core
committed before its response was lost; retry returns that same operation once.
Long `watch` refuses in broker mode. Bounded `inbox` remains, and standing work
arrives through the existing hosted delivery owner. Direct profile CLI remains
available outside protected workspace routes.

Wire messages have bounded headers/binary bodies, deadlines and bounded
concurrent clients. Shutdown reaps Codex children before closing endpoints;
partial clients are closed and owned service workers joined. A broker directory
already removed is harmless. 938 classifies these Core module changes as a full
host restart; compatible later web releases keep the same host and endpoints.

Proof uses synthetic records and credential canaries, never real credentials.
The recurring cases include native relative/symlink/future-file denial,
peer/runtime homes outside an instances ancestor, raw-store denial, worktree
write/tool reads, Core reads/publication/media/retry, ignored/failed proxy
refusal without a model turn, active-turn mode changes, typed errors, oversized
views, and removed-directory child cleanup. The host's native start/resume and
loopback-name probe run without an authenticated model turn. Applied mutation
and exact restoration evidence is retained with the source receipt.

Limits: this bounds local sandboxed commands, not unsandboxed apps/MCP servers,
remote tools, a full-access seat, other same-user processes, secrets copied into
readable source/context, or arbitrary unknown secret locations. It is not a
second macOS user or VM. No current live permissions or installation change is
claimed before guarded landing and operator selection of workspace mode.

Protocol facts were checked against installed `0.167.0-alpha.3.2` generated
schema, actual sandbox/app-server calls, and the [official Permissions
documentation](https://learn.chatgpt.com/docs/permissions). Historical first-round
100-case and wider 64-case results remain in the original review receipt;
they do not substitute for round-two verification on this base.

Historical round-two verification on release242: 114/114 passed in 66.844 seconds across the four
explicit boundary classes (27 cases), CLI, route, notice and 938 deploy/runtime
checks. Applied peer/runtime-home, raw-store, active-proxy and actor-binding
mutations each failed their behavior check and restored byte for byte to green.
The proxy mutation handed work to a turn and was caught immediately; an earlier
mutation-harness timeout is retained separately and is not counted as that red.
No browser, authenticated model turn or live credential/configuration change
was used. The earlier broad host/control failures remain disclosed in the
original review; that wider suite was not rerun for this round.

Round three contract (Warp14172), carried to release248: the startup deny
inventory includes validated legacy queue-route homes as well as hosted homes.
The broker Store adapter preserves the existing local Store result/error
contract so post-commit readback, naming hints and attachment handlers keep the
recorded outcome and their established retry instructions. A pre-send Unix
connection failure is explicitly unavailable, with nothing sent by that attempt;
it is not evidence about an earlier operation with the same identity.

Resume requests capture their configuration and selected permission identity
before asynchronous calls. A changed route is refused locally; responses never
recompute policy from a mutable current config or dereference a newly absent
bridge. Endpoint construction failures are local route refusals. GONE during
configuration/probe follows the existing child-exited successor path. No new
Core authority or side facts are introduced. Each returned scenario retains an
actual failing check; the previous six corrections and full-access behavior hold.

Round-three verification: 125/125 passed in 64.642 seconds across the four
explicit boundary classes (38 cases), CLI, route, notice and 938 deploy/runtime
checks. All five returned findings have retained pre-fix failures. Five applied
controls (Store adapter, mutable resume, GONE successor, capacity frame and JSON
uncertainty) failed their behavior checks, then restored byte for byte to green.
An actual committed write with an uncertain response keeps its saved operation
without falsely printing `recorded:false`; exact retry publishes it once.

Optional empty broker paths now refuse as usage, the ninth concurrent client
gets a named busy frame, and broker cleanup runs even if child cleanup raises.
The first capacity harness exposed its own mock/admission mistakes; those logs
remain diagnostic, separate from the corrected applied/restored capacity proof.
No browser or authenticated model turn was used. The wider host/control suite
was not rerun; its earlier disclosed failures remain outside this green claim.
