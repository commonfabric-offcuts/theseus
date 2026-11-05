# Foreground effects runner

`bin/aim-next-runner` runs one explicitly configured Theseus effects process.
It does not start the web server, install a service, find routes, create pins,
or acknowledge deliveries. Configuration follows `docs/codex-broker.md`.

```
bin/aim-next-runner --profile /absolute/runner-profile.json \
  --runner-id chosen-runner --routes /absolute/routes.json
```

A map with a hosted Codex route (see [codex-hosting.md](codex-hosting.md)) also
needs `--host-dir /absolute/private-dir`; the process then hosts those agents'
`codex app-server` children itself.

All configured routes and pins must validate before ownership is acquired. The
mapping is loaded once; changing its membership requires a restart. Each claim
gets a fresh comparison of the selected route, config and Core pin. The first
entry selects only this checkout's `bin/aim-next-codex-broker`. Missing config
at startup refuses the start; ordinary disappearance after startup settles
unavailable. Post-claim binding or pin failures instead pause the runner and
leave that claim unsettled. Post-claim storage busy is a storage fault, not a
new retry policy or evidence that nothing happened.

One actual guard acquisition owns the entire process. The singleton lease is
30 seconds, renewed every nine elapsed seconds or before a 20-second claim
would lack coverage. Claims are taken one at a time, only when a successful
schedule read or claim response reports due work. Both read only the actors the
route map names, one primary-key probe each: a person or an agent without a
route is never due here, never claimed and never attempted, and its deliveries
stay pending and visible. After settlement the runner reads the schedule again;
one recipient's cooldown cannot delay another due recipient. The adapter separately checks launch budget, binding
and guard, registers the actual child, and confirms owned cleanup. Only its
confirmed result is settled. Acceptance never acknowledges the recipient's
delivery; that remains the recipient's separate act.

An O_EVTONLY, non-inherited descriptor and kqueue provide write hints and stop
signals on macOS. A hosting runner adds each child's stdout and PID to the same
kqueue; a wait returns `{dirty, stop, readable, exited}`, and child output and
exits are handled before any claim work. A hosted claim stays outstanding
while its RPC runs, bounded only by the claim lease; renewals and reads
continue beside it. A hint is not a commit: SQLite decides what is visible. The
first dirty event sets a fixed 100 ms read deadline; further hints do not
postpone it. Reads have independent retry gates and a 60-second reconciliation
deadline. Idle operation has no periodic claim/write polling. Database
replacement, deletion, revocation or watcher failure refuses further work.
There is no generic-open or polling fallback.

Known, clean pre-claim DATABASE_BUSY in acquire, renew, claim or schedule uses
independent 1, 2, 4, 8, 16, 32, 60 second pacing. A successful action resets only
its own gate. Returned acquire-busy instead waits for the returned lease end.
Lost idle ownership exits and requires a fresh process with bounded supervisor
backoff; it never silently reacquires. A short-lease refusal gets one immediate
renewal and retry, with subsequent cycles paced at least one second apart.
Monotonic renewal deadlines remain active across a backward wall-clock change.

SIGINT and SIGTERM stop new claims. A hosting runner then interrupts its live
turns, closes its children's input and waits for each exit before it exits; a
second signal sends SIGTERM to the captured child PIDs, a third SIGKILL. An already running invocation keeps its
original cleanup deadline; its confirmed outcome is settled once before exit.
A stop just after a claim, before invocation, leaves that attempt unsettled
for Core's lease recovery. Unconfirmed child cleanup attempts a cleanup_failed
pause, even after lease expiry. Other fatal faults attempt their fixed pause
once; a failed pause reports fatal_unsaved without claiming it was saved.

No non-SQLite descriptor on the database may close while a SQLite connection
is open. On normal/known-refusal paths the watch closes last, after serial Core
calls have cleaned up. Core does not return a handle whose cleanup failed, so
unknown storage cleanup conservatively retains the watch until process exit
and reports `cleanup_confirmed:false`. The entry does not try garbage
collection, descriptor discovery or another invocation. A second cancellation
during the pause attempt reports fatal_unsaved and exits. This is a dedicated
process entry, not an embeddable recovery mechanism.

Output consists of fixed JSON events for ownership, contention entry/recovery,
settlements, pause failure and exit. It excludes message bodies, route paths,
tokens and raw exception text. A `startup_failed` status carries `reason`, the
refusing error's own fixed code (such as `invalid_executable`), or `null`. Exit 0 means a graceful stop; 75 means idle
lease loss; 2 means a refusal or pause requiring inspection. A stored pause
survives restart. Explicit `--resume-version INTEGER` uses the observed pause
version with a fresh guard; there is no automatic resume. Service installation
and its restart policy require the separate activation review.

Focused proof lives in `tests/test_effects_runner.py`,
`tests/test_effects_watch.py` and, for hosted routes, `tests/test_codex_host.py`. It uses isolated real Stores, owned fixture
brokers, native signals, actual SQLite statements/locks and a controlled clock
for long retry horizons. The interference control is a fixed small burst, not
a production throughput guarantee. The descriptor-close mechanism observation
on this Mac kept the SQLite writer lock after O_EVTONLY close; it does not
establish lock loss. The close-order rule is enforced independently rather
than relying on that OS-specific observation. Fixture brokers are not real
agent delivery proof, and passing these checks does not activate this runner.


Post-claim profile reads in both parent checks preserve typed storage and
binding faults. Authority changes and profile/guard mismatches pause with the
claim unsettled; a busy storage read never becomes an unavailable settlement.
Known-clean refusals are restricted to traced Core exception classes and codes.
Coded ProfileError wrappers remain conservatively uncertain, including busy:
the current Core view can flatten a failed setup close into a busy result.
The runner therefore retains its watch and stops after one pause attempt.
Ordinary profile file/parse failures remain unavailable; storage-stage failures
carry STORE_OPEN_UNCONFIRMED at startup, in the parent and in the broker child.

Native signal checks cover arrival after the wait timeout is selected and
observe the actual signal kevent. Removing the signal filter must fail that
prompt-wake check; a pre-wait stop flag alone does not establish this property.
