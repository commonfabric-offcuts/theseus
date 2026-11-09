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
for Core's lease recovery. Child cleanup waits on the exit events of its
process group's members and is bounded only by the runner's lease (at least
one second): a busy machine that lists processes slowly, or a group that
takes a while to go, delays the runner but does not pause it. A result
confirmed after the claim's own lease is late, not a fault: the `settled`
event says `stale: true`, Core records that attempt expired at the next claim,
and the work is woken again. A broker that had already reported `accepted`
before its result was confirmed late can therefore lead to a second notice
to the agent for the same work; before this, the runner paused instead.
Unconfirmed child cleanup attempts a
cleanup_failed pause, even after lease expiry; the pause records the child it
could not confirm (`child_pid`, `child_started_at`) and its `paused` event
names the step that did not confirm it (`detail`, a fixed code such as
`process_observation_failed`) and the `child_pid`. Other fatal faults attempt
their fixed pause once; a failed pause reports fatal_unsaved without claiming
it was saved.

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
version with a fresh guard. `--resume-reason cleanup_confirmed` (only with a
version, and only for a cleanup_failed pause) records why the resume is safe
on the running row, as `reason_code`, until the next pause or acquisition; the
supervisor passes it when it resumes a cleanup pause itself (below). Every
other pause is resumed by a person. Service installation and its restart
policy require the separate activation review.

## Unanswered wakes

Core counts, per recipient, the wakes that reached it and were followed by
nothing from it: an `accepted` notice (one the broker added), or a hosted turn
`start` handed its work (a steer into a running turn is not counted, and a turn
that fails or is lost takes its count back). `queued` (the earlier notice is
still waiting unread, as while the agent works through one long turn), `busy`,
`error` and `unavailable` put nothing new in front of the agent and are not
counted. After three in a row the recipient is parked:
`claim_wakes`, the due reads and `due_count` skip it while nothing pending is
newer than what the last wake that reached it named (`last_seq` not above
`named_seq`), so it is not woken again for work it was told of, and nothing it
was sent is dropped or settled. `named_seq` is set when a wake settles
`accepted` or `queued` (the waiting notice leads to the new work too) or hands
work to a turn, start or steer; it is never set by a claim, so a new-work wake
that settles `busy`, `error` or `unavailable`, or whose claim expires with its
runner, goes again by the usual backoff. A turn that hands its work back (it
failed, was lost or interrupted, or never saw a steer) clears it, and that work
is named again. A new delivery still wakes the parked agent, and that notice
names everything pending; a hosted agent can act only in a turn a wake starts,
so this is how a parked hosted agent comes back. Any recorded command by the
recipient (a post, an acknowledgment, a read-through) is a sign of life: the
count clears, and a parked recipient with work waiting is due at once, unless
a hosted turn that holds its work is the one acting. Reaching nothing pending
clears the count too. Reads stay write-free, so a read is not a sign of life.
The counts are derived from wakes, not anyone's records, so stepping back to
version 21 drops them and is never refused for them. This count is the
scheduler's: it counts a turn when it is handed and takes it back if it fails,
and clears when nothing waits, for the scheduler's own reasons. The Health
page keeps a count of its own, of attempts that got through (a hosted turn,
with every steer it took, once, when it completes), which only those attempts
and the agent's acts move, and it never says what the scheduler will do
(docs/health.md).

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
later than now. Acquiring clears `ended_ms`.

The server watches too, so a runner that dies with its supervisor (or with no
supervisor) is not left for its lease to run out. Its live feed already reads
after every commit; with each read it learns which pid Core records as the
running runner and asks the kernel for that process's exit event. When the
process ends, or is already gone when the server first sees it (a server
started after the runner died), the server calls `record_runner_exit(pid,
None)` at once: reason `ended`, since it cannot know how. The record's commit
reaches every open page, which says so. The supervisor's own account of the
same process may follow; it names how (`killed`, `failed`, ...), keeps
`ended_ms`, and is `recorded`, so the supervisor still brings the runner back.
Once a runner is no longer running (stopped, paused, or its end recorded) the
server forgets its pid, so a clean stop is never said to have ended; an exit
is acted on by the read after it, so a stop committed just before it is seen
first. The server writes one `runner_gone` JSON line to stderr with Core's
answer. When Core could not take the account (`unrecorded`, for instance
`DATABASE_BUSY` while another writer held the lock past the store's wait), the
next commit's read finds the pid still recorded as running and gone, and the
server tells Core again; there is no timer. A
runner that is alive but stops renewing (hung) has no process event and makes
no more commits; its lease ending is the one sign. A stop that no runner
follows makes no more commits either, and is told once it has lasted
(docs/health.md). Core keeps the next moment what is red would change with no
act (metadata `health_due`: the running runner's lease's end, or when an
absence will have lasted), the same read learns it, and the feed's wait lasts
no longer than that. When it comes with no commit first the server calls
`settle_health_due(due_ms)`: Core settles what is red on a commit of its own,
so the team is told and every open page reads it, and records nothing of the
runner's (a runner that comes back finds its role lost, as before). Its
answer is `settled`, `unchanged` (nothing was due to change) or `early`; the
server writes one `health_due` line with it. Any act that moves the moment
is a commit, so the read after it moves the wait with it; when Core could
not be told, the next commit's read asks again. Proof:
`tests/test_http_live.py`, `tests/test_runner_exit.py`, `tests/test_health.py`.

The `wakes` view carries `runner`: `{live: true}`, or `{live: false, state}`
with `paused` and its reason, `stopped` or `exited` with `since_ms` (and the
exit's reason), `unrenewed` with `since_ms` the lease's end, or `never_run`.
While it is not live and work waits for an agent routed here, a reader who
owns an outcome where that work waits also gets `notice: {waiting_agents}`,
counting the agents with work waiting in the reader's outcomes: someone has to
start the runner again, or see why it stopped. The list holds routed agents
only, so agents without a route here never crowd one out of its 100 places. The page says it under its header
("Wakes are not going out: the agent runner was killed at 8:23 PM. 2 agents
have work waiting."), on topic pages and the outcomes page, and drops it on
the commit that shows a runner holding the role again. Stepping back to version 21 turns a
`stopped` or `exited` row into `idle`, the only not-running state 21 knows.
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

One pause it resumes on its own: `cleanup_failed`, saved by the runner process
it started (Core's `runner_pid`), which names the broker child whose group the
runner could not confirm gone. It logs `awaiting_child_group` with the pause
`version`, `child_pid` and `child_started_at`, then waits, with no timer and
without signalling anything, until two process listings in a row find no live
process whose process group is that child's: it arms each live member's exit
event and lists again when one fires. A member listed live whose exit event
the kernel will not arm (it is part-way through exiting) has no event to wait
on; it is listed again after a pause that starts at 10 ms and doubles up to
one second, so one stuck in its exit costs at most a listing a second. A
listing that fails (ps cannot be started, exits nonzero, or prints something
it cannot read) means gone is not known: the supervisor logs `not_restarting`
with why `child_group_unobserved`, the failed step as `detail`, and the pause
`version`, `child_pid` and `child_started_at`, and exits 2 for a person to
decide. Once the group is confirmed gone it logs `resuming` (reason
`cleanup_confirmed`), waits for the guard, and starts the runner with
`--resume-version` that exact version and `--resume-reason cleanup_confirmed`,
so status reads `running` with that reason. A pause anyone changed in the
meantime refuses the resume (`REVISION_CONFLICT`) and the supervisor stops.
Pauses for any other reason, or saved by another process, still need a person,
and three runs in a row that end within 30 seconds stop the resumes as they
stop restarts. Why this is safe: a live member of the child's group always
lists with that group's id, so finding none twice is the runner's own
confirmation, taken after the runner has exited and with unbounded patience.
PID reuse can only make the supervisor wait longer, never resume early: a new
process is never given an id equal to an active process group's id (POSIX
`fork`), so a later process can take the child's id, and lead a group of that
id, only once the original group has gone. The start time is recorded and
logged so a person can tell which process it was; it is not compared. The
limit that follows: if the original group empties and, before the
supervisor's next listing, the id is given to a new process that leads its
own group, the supervisor waits on that unrelated group until it ends, with
wakes paused and `awaiting_child_group` the last event. That listing comes as
soon as the last member's exit event fires (within a second for one that
could not be watched), and the id counter has only just passed that id, so
landing on it again in that window needs a full wrap of the pid space. Taking
a live leader of that id whose kernel start time is later than the runner's
exit as proof the original group has gone would close it. A member that left
the group (setsid) is the broker-contract breach the adapter cannot see
either; the inherited runner guard still fences it.
The runner's own output passes through, so its last stdout line is still its
result; the supervisor's events (`runner_started`, `runner_exited`,
`restarting`, `awaiting_child_group`, `resuming`, `not_restarting` with why,
`stopped` with what it was waiting for: `starting`, `waiting_for_child_group`
or `waiting_for_guard`) go to stderr. It keeps no timer and never polls; the
one timed wake is the doubling pause above, only while a member it cannot
watch is still listed live. `tools/deploy.py` starts the runner this way and stops
it by stopping the supervisor; it finds the supervised runner as the
supervisor's child, by parent rather than by command line, since the
supervisor starts it by its own interpreter and resolved checkout path. Proof: `tests/test_supervisor.py`.

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
