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

`bin/aim-next-runner supervise` followed by the same arguments runs this
checkout's runner under a supervisor that brings it back when that is safe;
see "When the runner stops" below.

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

## Unanswered wakes

Core counts, per recipient, the wakes that reached it and were followed by
nothing from it: an `accepted` notice, or a hosted turn `start` handed its
work (a steer into a running turn is not counted, and a turn that fails or is
lost takes its count back). `busy`, `error` and `unavailable` never reached
the agent and are not counted. After three in a row the recipient is parked:
`claim_wakes`, the due reads and `due_count` skip it while nothing pending is
newer than its last wake named (`last_seq` not above `captured_seq`), so it is
not woken again for work it was told of, and nothing it was sent is dropped or
settled. A new delivery still wakes it once, and that notice names everything
pending; a hosted agent can act only in a turn a wake starts, so this is how a
parked hosted agent comes back. Any recorded command by the
recipient (a post, an acknowledgment, a read-through) is a sign of life: the
count clears, and a parked recipient with work waiting is due at once, unless
a hosted turn that holds its work is the one acting. Reaching nothing pending
clears the count too. Reads stay write-free, so a read is not a sign of life.
The counts are derived from wakes, not anyone's records, so stepping back to
version 17 drops them and is never refused for them.

The `wakes` view lists the agents whose wakes are not getting through: while a
runner holds a live lease, each parked agent with work, as `{actor_id,
waiting, since_ms, why: "not_answering"}` (`since_ms` is the first unanswered
wake); while none does, each agent with a route pin here and work waiting, as
`why: "wakes_paused"`, so no agent is blamed for wakes that are not being sent.
Proof: `tests/test_wake_health.py`.

## When the runner stops

Core records how the runner ended, so a page can say so from facts rather than
from silence. A graceful stop (TERM or INT, after the host has stopped its
children) calls `stop_runner`: the state becomes `stopped`, `ended_ms` is set
and the lease ends at once, so the next runner does not wait one out; the
result carries `stop_recorded`. A runner that ends any other way cannot say
so itself, so whatever started it reports the exit it reaped with
`record_runner_exit(pid, status)`. That write needs no guard (the process is
gone, and a broker child it left may still hold the guard) and lands only
while Core records that pid as running, so a later runner's record is never
touched and a paused runner stays paused. The state becomes `exited`, with
`reason_code` `lease_lost` (75), `stopped_unrecorded` (0: a clean stop Core
could not record), `killed` (a signal) or `failed`, and the lease ends no
later than now. Acquiring clears `ended_ms`. A runner that stops renewing
without either record is known gone when its lease ends.

The `wakes` view carries `runner`: `{live: true}`, or `{live: false, state}`
with `paused` and its reason, `stopped` or `exited` with `since_ms` (and the
exit's reason), `unrenewed` with `since_ms` the lease's end, or `never_run`.
While it is not live and work waits for an agent routed here, a reader who
owns an outcome also gets `notice: {waiting_agents}`: someone has to start
the runner again, or see why it stopped. The page says it under its header
("Wakes are not going out: the agent runner was killed at 8:23 PM. 2 agents
have work waiting."), on topic pages and the outcomes page, and drops it on
the commit that shows a runner holding the role again. Stepping back to version 17 turns a
`stopped` or `exited` row into `idle`, the only not-running state 17 knows.
Proof: `tests/test_runner_exit.py`, and for the loop's own stop
`tests/test_effects_runner.py`.

`bin/aim-next-runner supervise ARGS` starts the runner (`bin/aim-next-runner
ARGS`, in its own process group with no signal blocked), waits on the
kernel's exit event for it, and reports the exit with `record_runner_exit`.
TERM or INT is passed to the runner, the one process it started, and nothing
more is started. Otherwise it starts the runner again only when Core recorded
the exit (the runner still held the role, so no other runner took over and
nothing paused it), the runner neither stopped cleanly (0) nor refused or
paused (2), and fewer than three runs in a row ended within 30 seconds of
starting. An exit Core could not record is reported as `unrecorded`, not as
no role, and is not restarted. Before a restart it waits until no process
holds the runner guard, since the ended runner's broker children inherit it.
The runner's own output passes through, so its last stdout line is still its
result; the supervisor's events (`runner_started`, `runner_exited`,
`restarting`, `not_restarting` with why, `stopped`) go to stderr. It keeps no
timer and never polls. `tools/deploy.py` starts the runner this way and stops
it by stopping the supervisor. Proof: `tests/test_supervisor.py`.

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
