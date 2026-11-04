# Wake adapter: bounded first implementation

Status: initial adapter boundary confirmed by Fable in `m-b3888405` at
`4b6a437` / SHA256 `99bcf9beb99b`. Route preparation is implemented at
`48b6e95`, with the literal-argv correction `e344852` independently bound in
`m-64d61d0d`; invocation is not implemented or enabled. The subsequent
held-process guard and authority interfaces are confirmed by Fable in
`m-d8c0ae60` and lead in `m-caac4621`: wake contract SHA256 `a30aff1efbd5`,
authority contract `12214d25fb77`. Exact snapshots are retained in
`work/evidence/runtime-contracts-final`. Implementation and integration remain.
Lead owns the adapter. Core owns delivery eligibility, runner ownership,
attempt claims, acknowledgement and durable retry scheduling. This complements
the canonical first-build plan; it does not change product scope. Tony separately
resumed UX with the preserved message/Notebook modal as the first checkpoint.

## Current code and missing seam

At lead revision `47add47`, `aim_next/profile.py:25` opens the explicitly bound
Store; `:42` validates the instance, active actor and absolute resolved database
path, and `:61` reads a private, current-user-owned regular profile without
following its final symlink. There is no default profile or old-AIM fallback.
`aim_next/conversation.py:154` creates one durable delivery per recipient and
`:213` resolves effective reasons. No wake is dispatched by opening Store.
There is no effects runner or route adapter in this repository yet.

Core proposed acquire/renew singleton ownership, claim_wakes and finish_wake
in AIM `m-3f597ba3`. Lead's timing refinement is `m-d6be30d6`. Fable's critique
`m-c5c8edc3` and lead's disposition `m-8419f7b1` replace per-delivery wakes with
one coalesced wake per recipient. The revised exact claim/status/resume shapes
and restore-authority seam are now fixed in the reviewed contracts. This implementation is a small
route adapter tested against isolated bindings and child commands. Runner
integration and activation wait for Core's actual claim/authority contract.
Do not install a service or register a real agent route for these tests.

Core's follow-up contracts live in
`/Users/commonfabric/aim-worktrees/aim-core-evidence/aim-next-20261103/wake-contract.md`
and `authority-contract.md` beside it. Lead critiques `m-ebb1e606` and
`m-4381e792`, with agreed dispositions `m-e617a628` and `m-2405cf23`, require a
live guard that spans parent/child lifetime, strict authority-epoch binding,
and no post-snapshot commit loss at recovery activation. Wall-clock lease expiry
does not authorize a second runner or cutover while the old broker survives.
The guard uses stable external lock inodes, explicit descriptor inheritance and
close-only lifetime; an explicit unlock can release a child's inherited lock.
The isolated Mac probes in `work/evidence/wake-guard-probe-01` and
`work/evidence/wake-guard-probe-02` demonstrate that distinction and actual parent
exit with a surviving child. They are mechanism evidence, not the future
adapter/guardian or restore integration proof. This dependency must be resolved
before enabling the otherwise reviewed adapter boundary below. That contract
dependency is resolved; actual Core/adapter integration is still required.

Profile v2 pins authority_path, authority_id and authority_epoch in addition to
instance/actor/database. Store takes expected_binding explicitly. The actual
RunnerGuard owns authority-SH then runner-EX descriptors; all runner mutators
take it, and the child/guardian inherits guard.pass_fds. Guard close never calls
LOCK_UN. Claims, stdin and queued hints retain the captured authority epoch;
reloading a profile cannot upgrade an old hint after cutover. Guard binding also
contains instance_id and db_path. Neither a lease token nor diagnostic PID is a
substitute for this held guard. The caller validates the same live guard before
launch and settlement; startup never discovers an alternate binding.

## What a route means

A route is a trusted, explicitly selected local configuration for one recipient.
It starts a short-lived wake broker, not the agent's work process or a browser.
The broker accepts a hint to inspect durable recipient work. Its successful
exit means that its own durable queue owns that hint. It does not mean that
the recipient read, acknowledged, answered or completed the message.

One protected JSON file contains exactly:

```json
{"v":1,"profile":"/absolute/recipient-profile.json","argv":["/absolute/wake-broker","fixed-argument"]}
```

Read at most 64 KiB from a current-user-owned regular file with no group/other
permissions and O_NOFOLLOW on its final component. Reject duplicate fields,
unknown fields, invalid versions, non-absolute profile/executable paths, empty
argv, NULs, more than 32 arguments or more than 16 KiB of UTF-8 argument bytes.
The protected profile is loaded through the existing profile API. Compare its
actor, canonical instance, resolved database path, authority ID and epoch with the claimed binding;
any mismatch returns unavailable and starts nothing. No config directory scan,
recipient-name path construction, actor override or route discovery is added.
The caller supplies the exact route path, or none when no route is configured.

Resolve the executable and require a regular executable owned by this user or
root, with no group/other write permission. Check the resolved parent directories
for that ownership and no group/other write permission too. This protects the
selected entrypoint path; it is not a sandbox or proof about arbitrary scripts,
plugins or files that an explicitly configured interpreter might load. The real
selected broker and its loaded code need their own source/review binding.

Preserve the configured argv array literally, including argv[0]. Carry the
validated resolved executable separately to Popen(executable=...), so symlink or
multi-call entrypoint naming keeps its configured meaning. The executable and
fixed arguments run with shell=False. No message text is appended to argv or interpolated. One bounded JSON object
on stdin carries schema 1, the validated binding, the captured wake generation
and attempt_id. The generation represents due recipient work and is not an
acknowledgement cursor. It does not carry message bodies or an unbounded delivery
list. The selected broker reads the recipient's durable, paged inbox. Core must
publish the precise generation/token shape before adapter code. Reject malformed
claim IDs/shape before launch. The child environment is an explicit allowlist:
PATH=/usr/bin:/bin plus HOME, LANG and TMPDIR from the launcher if present. No
arbitrary inherited variables or per-route environment expansion in this first
adapter. Any later broker-specific environment needs an explicit scoped choice.
HOME may still permit configured code to discover files; the selected broker
must require the stdin binding and must not resolve a default instance. Standard output
and error go to DEVNULL; the adapter's result contains only the classification
and exit code/timeout reason, never child output, profile contents or tokens.

The selected broker must coalesce (instance_id, actor_id, captured wake generation)
only while that hint remains in its own durable queue. attempt_id distinguishes
invocations and is not a new work identity. Once a hint is drained/handed off,
the same key can enqueue a fresh hint: permanent seen-key suppression would
strand an agent that crashed after taking the first hint. These are at-least-once
hints, not exactly-once work execution. A broker must validate the explicit binding in stdin and must not
resolve a default instance or change it by rereading unrelated configuration.
An arbitrary executable cannot prove this contract: generic adapter tests prove
argument/identity preservation and at-least-once invocation only. Real-agent
delivery requires a separately tested broker with durable acceptance/dedup.

## Trigger to result

- No route, unreadable/invalid profile/config, mismatched binding or failed
  executable start: unavailable, no acknowledgement and no permanent failure.
  Core suspends wake eligibility for a disabled recipient. An unavailable route
  response is not evidence that the recipient will automatically recover.
- Broker exits 0: accepted hint. Core schedules a retry no sooner than 60 seconds
  if the recipient still has eligible unacknowledged work. Repeat accepted hints
  for the same generation are coalesced by the broker's stable key.
- Recipient, not delivery, is the scheduling unit. Five hundred pending messages
  for one recipient produce at most one invocation per due turn, not 500 children.
  New arrivals update the pending generation without bypassing that recipient's
  accepted cooldown/backoff or creating a concurrent attempt. A captured old
  generation cannot acknowledge or erase new arrivals; per-delivery ack remains
  a distinct Core command. Claim selection cannot compute a whole-inbox hash or
  enumerate history to derive its bounded generation/high-water token.
- The accepted cooldown applies while captured eligible work remains
  unacknowledged. Once that work is acknowledged or otherwise reconciled, a new
  arrival is immediately due. Contrast wake/ack/new message five seconds later
  with wake/no ack/new message five seconds later: only the latter waits for the
  cooldown. A maximum seen sequence is not sufficient evidence if earlier
  captured deliveries remain pending.
- Broker exits 75: busy. Other nonzero exits or a deadline: error. There is no
  implicit stop/disable interpretation for a child exit code in the new runtime.
- Busy/error use Core's durable 1,2,4,8,16,32,60-second capped backoff;
  unavailable uses 60 seconds. No retry-count cutoff discards recipient work.
- One broker child at a time; it gets a five-second execution deadline plus at
  most one second for owned-child cleanup. Launch only when at least seven
  seconds remain on the claim and singleton ownership is confirmed by Core.
  Core's proposed claim duration is 20 seconds and singleton lease 30 seconds.
  Claiming checks that the singleton lease extends through the entire claim.
  Late renewal must not leave an in-flight claim beyond its owner's lease.
  Encode at most 8 KiB of stdin metadata and write through a nonblocking pipe
  under the original deadline. Do not use communicate, poll or wait on the
  broker before group cleanup: these can reap its leader. The deadline covers
  registration and input even when the child never reads it; a small payload
  alone is not the proof of boundedness.
- Start the child in its own process group. On timeout terminate that owned
  group, then kill it if necessary and reap the child. Never signal a user's
  browser, a discovered process or another runner. Stopping a broker does not
  recall a hint it already accepted or prove external work stopped; retries
  retain the same captured wake identity. Observe exit without reaping and keep
  the zombie leader until group cleanup is confirmed, so its PID/PGID cannot be
  reused before a signal. The concrete Mac mechanism and its limits are below.
  This does not prove that a deliberately detached descendant or durable broker
  queue was recalled.
  If cleanup cannot be confirmed within the cleanup budget, pause the
  runner rather than starting a second child. Broker contracts forbid escaping
  the owned process group except for an explicitly accepted durable queue.
- A stale settlement cannot update a newer attempt. Recipient acknowledgement,
  changed eligibility and removal during a wake remain Core decisions. The
  adapter never calls delivery.ack, advances a cursor or rewrites a delivery.
- Unexpected internal exceptions pause the runner visibly; they are not a
  reason to mark delivery finished or repeatedly retry a programming error.
  Core persists runner status and a short nonsecret reason, exposed through its
  capabilities/status view. An explicit local resume after the fault is fixed
  reacquires ownership and reconciles due work. A supervised restart must not
  silently erase the pause. If status persistence itself fails, the foreground
  process reports failure and exits; it never claims that a pause was saved.

The adapter itself does not sleep or maintain scheduling state. It returns its
outcome to Core's token-fenced finish_wake. The future runner reconciles due
work at startup and periodically with bounded work; notifications are hints.
Its exact loop will be specified against Core's implemented API, not invented
around a fake implementation of delivery storage.

## Evidence before integration

### Concrete invocation seam (revised after Core/Fable critique; final readback pending)

Core confirmed the actual calling sequence in `m-43e1d4ff`: renew ownership,
claim due work, invoke the adapter, register the child after spawn, then settle
only after owned cleanup. No additional claim-validation method is planned.
The sole real guard holder owns internal token/claim changes; none of these
methods is in public command dispatch. Each token-bound call must match the
exact guard acquisition generation that created its token. Closing/reacquiring
a guard does not transfer the old token. The runner candidate `686ae92` violates
this boundary and is blocked by review `m-3bf4c85d`; its correction and review
are required before integration. Core's runner implementation is still
awaiting its own reviewed handoff. The route/encoding layer uses the already
integrated real `RunnerGuard` and v2 profile, not a replacement guard fixture.

Lead's intended Python seam is
`run_route(route_path, claim, guard, *, owner_lease_until_ms, record_child)`.
The caller must have just obtained Core's current successful acquire/renew and
claim results. The sequential adapter requests `limit=1`: after owned cleanup
and settlement, renew ownership and claim the next due recipient. Never hold a
batch of expiring claims while processing earlier children. Core's maximum-32
selection proof remains a storage API bound, not a sequential launch claim.
This disposition follows Fable `m-3bf4c85d` and lead `m-ea3ed541`.
`owner_lease_until_ms` is the returned singleton lease, not a configuration setting. The adapter validates the exact claim shape/binding and
route, obtains the actual guard's verified `pass_fds`, and checks current time
immediately before spawn: both leases have at least seven seconds remaining and
the singleton covers the whole claim. An old receipt after Mac sleep is not
permission to launch. A prepared route is ephemeral data, not cached dispatch
authority. Final runner integration must prove the real sequence.

One five-second elapsed deadline begins immediately before Popen, with no
reset for registration or stdin. Use Python 3.9's clock_gettime_ns with
CLOCK_MONOTONIC_RAW on this Mac, which advances through sleep; refuse invocation
if this required clock is unavailable. Python time.monotonic uses
mach_absolute_time here and excludes sleep. Wall time separately checks the
absolute Core leases before spawn and during the loop. A forward wall-clock
jump or elapsed expiry causes cleanup; a backward wall-clock jump cannot extend
the elapsed deadline. This is a cooperative bound around OS process creation
and the actual Core callback, not a promise to preempt arbitrary hanging Python
callbacks or blocked process creation.

`record_child(pid, started_at)` calls Core's token-bound diagnostic registration
and must return `status:recorded` for the exact expected instance. It runs just
after spawn, inside that same original deadline. Core's actual callback has a
250ms SQLite busy bound; a delayed-callback control proves its elapsed time is
charged. Stale status, wrong instance, exception or deadline exhaustion triggers
owned cleanup and a fixed fault requiring persistent pause. Missing registration
never releases the inherited guard or invents acceptance. No extra durable
lifecycle is introduced here.

The bounded adapter result contains only outcome, exit code and a fixed reason
code. No route/profile payload, token or child output is returned. On this
CPython 3.9.6 Mac os.waitid is unavailable. Use select.kqueue with KQ_FILTER_PROC
and KQ_NOTE_EXIT to observe the owned leader without reaping it. Retain the
Popen object and never call its poll/wait/communicate before group cleanup.
Before any launch require SIGCHLD's default disposition, returning a fixed
unavailable reason otherwise. The dedicated runner must not install another
child reaper or call waitpid(-1): it owns only its explicit children. Default
SIGCHLD alone cannot prove the absence of an unrelated reaper; that is a reviewed
runtime ownership requirement. A SIG_IGN control starts no broker.
Registration can race a fast exit: an ESRCH/missing exit event is not permission
to signal a remembered PGID or infer successful cleanup. A bounded process-list
observation must still show the unreaped owned leader, and only its Z state
establishes the fast-exit fallback; ambiguous/missing leader causes a fixed fault.
A focused control must exercise exit before watcher registration.

Use a bounded `/bin/ps -A -o pid=,pgid=,stat=` observation, filter numeric PGID in
Python, and exclude zombie rows when finding live members. The helper has a
bounded output cap and runs only within the remaining cleanup/invocation budget;
malformed, truncated, timed-out or otherwise ambiguous observations fail closed.
This is a diagnostic helper, not a second broker. Do not use killpg(pgid, 0) as
an absence oracle: Fable's actual Mac probe returns PermissionError for a
zombie-only group. If descendants survive leader exit, terminate the owned group
while the unreaped leader still reserves its identity, escalate within the
one-second cleanup budget, confirm no live group members, then reap the leader.
A surviving descendant makes the invocation an error even when the leader exits
zero. Reap only after cleanup, and never signal that PGID after reap. Unconfirmed
cleanup raises a fault requiring the existing persistent pause. Unexpected
internal exceptions follow the same owned cleanup, then return a fixed fault;
they do not enter a hot retry loop. Guard/lease/settlement and acknowledgement
stay Core-owned.

The concrete mechanism evidence is Fable m-2ff52a7f: one zombie-only group and
one zombie leader with a live descendant, NOTE_EXIT observed before reap. Lead
read the raw probe and log; it is not the adapter implementation or a measured
sleep test. Fable m-b93f45e4/m-3c00952a and Core m-09115ed1 supply the critique.
An escaped setsid descendant is a trusted-broker contract violation, not a
claimed detectable live condition. Its inherited guard must independently block
a new acquire/cutover after the parent closes/exits; guard.verify in the parent
cannot establish absence. Tests may prove that blocking limit, not detection of
arbitrary escaped processes. A real broker's durable queue must still be reviewed
and proven separately.

Named adapter checks: exact literal argv/stdin and allowlisted parent environment;
real inherited guard descriptors; no child on missing/mismatched route or spent
lease; exit 0/75/other and exit before watcher registration; a broker that never
reads stdin, with the actual nonblocking write returning within the original
budget independently of the timeout verdict; nondefault SIGCHLD refusal;
delayed/stale/wrong-instance registration; finite 1MiB child output
going to DEVNULL; single original deadline; owned descendant cleanup before reap;
and independent process/group observations. Process-list failure must pause,
not infer absence. An order-control catches reap-before-signal without claiming
a forced PID reuse that was not observed. The escaped-child case checks only
independent guard blocking after parent exit. Applied mutants cover binding, captured identity, literal invocation,
descriptor inheritance and launch budget. No service, real agent route, browser
or old AIM record is touched. These are adapter proofs, not a real broker's
durable queue acceptance or the unfinished runner integration.

1. Red first: missing route adapter fails the focused contract checks before
   implementation. Use isolated real Store/profile files and temporary broker
   scripts; no live agent identity, old route, browser or application data.
2. Private route file / duplicate and malformed fields / absolute argv / actor,
   instance and resolved-path mismatch cases start no child. Include populated
   distinct instances and actors so a wrong binding cannot pass vacuously.
3. A real child records exact argv, stdin and sanitized environment; shell
   metacharacters stay literal. Two attempts carry the same captured wake identity
   and different attempt IDs. The fake broker's durable queue coalesces the key
   while queued, then accepts it again after drain. This proves only the fixture
   broker, not Codex or any external sink.
4. Real children cover accepted, busy, other exit, absent executable and timeout.
   Child cleanup and the refusal to start with insufficient claim budget are
   independently observed. No source or content is emitted in the result.
5. Applied mutations must demonstrate the actor/path binding, shell-free literal
   argv and preserved captured wake identity checks can fail. Assert changed bytes,
   give every Python mutation/control a fresh PYTHONPYCACHEPREFIX and restore
   exact bytes. Do not mutate a real external route or invoke a browser.
6. Independent review then concrete Core integration: lost acceptance reply,
   lease loss/stale settle, remove-during-wake, missing route and later recovery,
   acknowledged delivery suppressing retries, and a 10,000 fenced-old plus one
   fresh due-work bound. Also test 500 pending messages for one recipient,
   arrivals during cooldown, late renewal and a bounded reconciliation burst
   after system sleep expires leases. The adapter checks alone do not complete
   these claims.

Not claimed here: external exactly-once notification, durable broker acceptance
from an arbitrary exit-0 program, child effect recall, restore activation safety,
agent exchange completion or a shipped application.
