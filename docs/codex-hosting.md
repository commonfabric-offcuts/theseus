# Hosted Codex agents

Names and shapes that Core and the host (the effects runner process holding a
`codex app-server` child) agree on, then what the host does with them. The
host is `aim_next/codex_host.py`; the notice text is `aim_next/hosted_notice.py`.

## Schema 10

`bin/aim-next-admin migrate` moves a schema-9 instance to 10 and back. The
step back runs only while `hosted_turns` and `hosted_children` are empty,
every `handed_seq` (schedule and attempt) is NULL and no hosted pin exists;
otherwise it refuses with `RECORDS_WOULD_BE_LOST` and changes nothing.

- `recipient_schedule.handed_seq INTEGER`: NULL, or the delivery sequence up
  to which the recipient's pending work has been handed to a running turn.
- `wake_attempts.handed_seq INTEGER`: the recipient's `handed_seq` when the
  attempt was claimed, the point its notice starts from.
- `hosted_turns`: one row per handed wake, keyed by `attempt_id`
  (`wake_attempts.id`). Fields: `recipient_id`, `thread_id`, `turn_id`,
  `mode` (`start`|`steer`), `client_id`, `announced_seq`, `handed_ms`,
  `seen_ms`, `final_status` (`completed`|`interrupted`|`failed`|`lost`),
  `error_code`, `finished_ms`, `input_tokens`, `cached_input_tokens`,
  `output_tokens`, `reasoning_output_tokens`, `cli_calls`. A column moves
  only from NULL to a value, once; rows are never deleted.
- `hosted_children`: `id`, `runner_token`, `codex_home`, `pid`, `started_at`,
  `user_agent`, `spawned_ms`, `exited_ms`, `exit_status`, `cleanup`
  (`confirmed`|`unconfirmed`). Same write-once rule.

## Settling a claim as handed

`finish_wake(guard, runner_token, claim_token, "handed", turn=TURN)`, where
`TURN` is exactly:

```
{"thread_id": "<lowercase uuid>", "turn_id": "<Codex turn id>",
 "mode": "start" | "steer", "client_id": "theseus:<attempt_id>",
 "announced_seq": <int, at most the recipient's last delivery seq>}
```

`thread_id` must be the recipient's pinned `codex-hosted-stdio` thread.
`turn` is required for `handed` and refused for every other outcome. The
result is `{"status": "settled", "wake_status": "handed", "next_due_ms",
"pending_count", "handed_seq"}`, or `{"status": "stale"}`.

Schedule effect, in the same transaction as the `wake_results` row and the
`hosted_turns` row:

- `handed_seq` becomes the claim's `captured_seq` (NULL if nothing is pending).
- `next_due_ms` is now if a delivery arrived after the claim, otherwise NULL:
  handed work does not re-wake on its own.
- `retry_count` is kept. A clean turn end resets it (below).

Two hands record the turn row but hand nothing (`handed_seq` NULL), so the
next claim names every pending delivery again:

- The turn had already ended (Core holds finished rows for it): an input
  answered after its turn's end. The row is written finished, with that turn's
  status and error code. If that status is not `completed`, or the row is a
  `steer` (whose input may have been dropped), the turn-end re-arm applies:
  `retry_count` grows by one and `next_due_ms` is now plus the backoff. A
  `start` into a turn that completed holds its work as usual.
- The claim's `handed_seq` was set but the schedule's is now NULL: a turn
  ended under the live claim and Core handed its work back, so this notice
  (which named only newer deliveries) left that work out. `next_due_ms` is now.

`accepted`, `busy`, `unavailable` and `error` behave as before.

Each claim from `claim_wakes` also carries `handed_seq`, the recipient's value
when it was claimed (NULL or an integer), so the notice can name only what is
newer. A broker route accepts the field and never sends it to its child.

## Arrivals and acknowledgments

- A new delivery whose seq is greater than a non-NULL `handed_seq` makes the
  recipient due now (or at the live claim's end), so a follow-up steers into a
  running turn within one claim cycle.
- When the recipient's pending count reaches 0, `handed_seq` becomes NULL.

## Turn records

`hosted_turn_seen(guard, runner_token, client_id)` records `seen_ms` (Core's
clock) when the `userMessage` item carrying `client_id` completes. Results:
`recorded`, `already`, or `unknown` (no handed row carries this client id).

`end_hosted_turn(guard, runner_token, thread_id, turn_id, status,
error_code=None, usage=None)` finishes every open row of that turn:

- `status`: `completed`|`interrupted`|`failed`|`lost`; `error_code` is a
  `codexErrorInfo` key (letters, digits, `_`; at most 64), refused with
  `completed`.
- `usage`: a subset of `input_tokens`, `cached_input_tokens`, `output_tokens`,
  `reasoning_output_tokens`, `cli_calls`, each a non-negative integer. It is
  written once, on the turn's first handed row (the `start` row when there is
  one).
- Re-arm: if `status` is not `completed`, or a `steer` row of the turn was never
  seen, and the recipient still has a pending delivery at or below
  `handed_seq`, then `handed_seq` becomes NULL, `retry_count` grows by one and
  `next_due_ms` is now plus the backoff (1 s doubling to 60 s), or the live
  claim's end. A clean end (completed, every steer seen) resets `retry_count`
  to 0 and leaves the schedule quiet.
- Result: `{"status": "ended", "final_status", "rows", "unseen", "rearmed"}`,
  or `{"status": "unknown"}` when no open row has that thread and turn.

`open_hosted_turns(guard, runner_token, thread_ids)` lists `{thread_id,
turn_id}` for every turn of those threads with an unfinished row, from any
run. It changes nothing.

## Child records

- `record_hosted_child(guard, runner_token, codex_home, pid, started_at)` at
  spawn, before any request reaches the child: `{"status": "recorded",
  "child_id": "hc-…"}`. A runner that is not running gets its ownership status
  and no row.
- `hosted_child_ready(guard, runner_token, child_id, user_agent)` once the
  handshake passed: `recorded`, `already` or `stale`.
- `end_hosted_child(guard, runner_token, child_id, exit_status, cleanup)` once
  the child is reaped: `exit_status` is its return code (negative for a
  signal), `cleanup` is `confirmed` or `unconfirmed`. A paused runner still
  records its own children's exits. A row whose runner died stays open: no
  later runner can confirm an exit it did not reap.

## Route pin

The pin destination keeps its fields `{kind, protocol_version, codex_home,
thread_id}`; `kind` is `codex-queue-stdio` or `codex-hosted-stdio`. An actor
has one pin, so it is either a queue route or a hosted route.

## Hosted route config

A private file (owner-only, at most 65536 bytes, no duplicate or extra fields),
read by `broker_routes.load_hosted_config(path, expected_binding=None)`:

```
{"v": 1, "kind": "codex-hosted-stdio", "actor_id": "agent-x",
 "profile": "/abs/agent-x.json", "cli": "/abs/bin/aim-next",
 "codex_executable": "/abs/installed/codex",
 "codex_home": "/abs/codex-home", "thread_id": "<lowercase uuid>",
 "cwd": "/abs/agent-x/work", "model": null | "<model>",
 "writable_roots": ["<db dir>", "<profile dir>/agent-x.outbox"]}
```

Every path is an existing canonical spelling. `profile` is bound to
`actor_id`; `cli` passes the invocation executable policy and
`codex_executable` the installed-Codex policy. `codex_home` is never the
owner's own `~/.codex` (from the password database, not `$HOME`) or a
directory inside it (`invalid_codex_home`): the desktop app keeps its sessions
and token refresh there. `writable_roots` holds exactly the database's
directory and the actor's outbox directory (an existing directory, not a
symlink, at its own canonical path), in either order; anything else refuses
with `invalid_writable_roots`. The config's destination is compared with Core's
pin, and the returned `HostedConfig.destination` is the pin's.

## Route map entry

A hosted route's map entry names its config file directly:
`{"v": 1, "routes": {"agent-x": "/abs/agent-x.hosted.json"}}`. An entry whose
file has `kind` `codex-hosted-stdio` is hosted; any other entry is a broker
route file. Only a map with a broker entry needs the trusted broker
executable. All homes' children of one process run one Codex executable per
home; two configs naming different executables for one home refuse startup
with `conflicting_codex_executable`. A map with any hosted entry needs
`--host-dir`, a private directory (owner only) that holds the host's
`events.jsonl` and `codex-stderr.log`.

## Provisioning (operator act)

```
bin/aim-next-runner host-provision --profile RUNNER.json --runner-id ID \
  --actor-profile AGENT.json --codex-executable /abs/codex --codex-home /abs/home \
  --cli /abs/bin/aim-next --cwd /abs/work [--model M] --config /abs/agent.hosted.json
```

It first checks everything that needs no child: the paths, the home (the same
`~/.codex` rule as the config), an outbox that already exists (the config's
outbox rule) and the config path. It then takes the runner guard (so it
refuses while a runner holds it), spawns one child, checks the handshake and
sign-in, creates the agent's outbox (0700) if it is missing, sends
`thread/start` with the thread settings below, and checks the echo: `cwd`,
`approvalPolicy: never`, and a `workspaceWrite` sandbox with exactly the two
writable roots, no network, and `/tmp` and `$TMPDIR` excluded. It then
provisions the pin, writes the config (new file, 0600), closes the child's
input and reaps it. A refusal before `thread/start` leaves nothing behind. It prints one JSON
line: `{"status": "provisioned", "actor_id", "thread_id", "config"}` (exit 0)
or `{"status": "refused", "reason"[, "orphan_thread_id"]}` (exit 2). A thread
started before a refusal is left behind and named; it is harmless. The runtime
never starts a thread.

## The host

### Children

One `codex app-server --listen stdio:// -c agents.enabled=false` child per
`codex_home`, spawned with no shell, in the runner's process group, with only
`HOME`, `LANG`, `TMPDIR`, `PATH=/usr/bin:/bin:/usr/sbin:/sbin` and
`CODEX_HOME`, stdin and stdout as pipes and stderr to the host's log. Its PID
is recorded in Core at spawn. Its stdout descriptor and its PID join the
runner's kqueue (`NativeWatch.watch_reader`, `watch_process`), and `wait`
returns `{dirty, stop, readable, exited}`. The host signals a child only by
the PID it captured, and only while the child is un-reaped, so that PID cannot
belong to another process.

Children start at acquisition (startup reattach) and again at the first claim
for a home whose child has exited. There is no restart loop: a failed spawn or
handshake settles that claim `unavailable`, and Core's backoff spaces the next.

### Handshake

`initialize` (client `theseus_host`, `experimentalApi`, the delta
notifications opted out), then `initialized`, then `account/read
{"refreshToken": false}`. The child is used only if the first token of
`userAgent` is `theseus_host/0.163.0-alpha.10.2` and `codexHome` resolves to
the pinned home (else `incompatible`), and only if `requiresOpenaiAuth` is
false or `account` is present (else `auth_missing`). A refused child's input is
closed; every claim on its home settles `unavailable` until it exits and a
later claim spawns a new one.

### Reattach

For each pinned thread: `thread/resume` with the thread settings and
`excludeTurns`, then `thread/turns/list {limit: 1, sortDirection: desc}`.
A resume refused as not found or `modelProviderMismatch`, or one that echoes
another thread id, pauses the runner with `route_binding_changed`; no
replacement thread is ever made. A resume whose echo differs from the
settings sent (checked as at provisioning) logs `resume_settings_refused`
and the thread is not used: its claims settle `unavailable`. Other resume
errors settle the waiting claim `unavailable`. The thread status kept and
logged is one of the schema's `idle`, `active`, `systemError`, `notLoaded`,
or `other`. Every open row of the thread is then settled from the last
turn: its final status if it ended, kept open if it is in progress on a thread
the resume reports active, otherwise `lost`.

Thread settings (provisioning and every resume): `cwd`, `approvalPolicy:
never`, `approvalsReviewer: user`, `sandbox: workspace-write`, `config` with
`sandbox_workspace_write` (exactly the two writable roots, no network,
`/tmp` and `$TMPDIR` excluded) and `agents.enabled=false`,
`developerInstructions` (`hosted_notice.developer_instructions`), and `model`
when the config names one.

### Dispatch

1. Preflight the config against the claim's binding and Core's pin.
2. Read the recipient's pending deliveries through its own profile (at most
   five pages of 100; this never acknowledges).
3. `hosted_notice.notice(items, claim.handed_seq, actor, attempt_id,
   complete)`: deliveries above `handed_seq` are listed as new, with a count
   of older pending ones; with no handed seq, or nothing above it, every
   pending delivery is listed. At most 20 lines, then a count to fetch with
   `inbox`. Each line is `N. topic T, from A, message M (seq S), delivery D`,
   where the message and delivery ids are Core's, and the topic and author ids
   appear only when they are plain tokens (letters, digits, `.`, `_`, `-`,
   starting with a letter or digit); otherwise the line says `(not shown: run
   inbox)`. A `Read: aim-next read T --after S` line is written for each plain
   topic id only. Titles (cut at 80 characters), the full ids and previews are
   other people's words: they never enter the text, and travel as
   `additionalContext` `theseus.previews.<attempt_id>` of kind `untrusted`, one
   line per delivery holding a JSON object `{topic, title, from, body}`. `announced_seq` is the
   largest listed delivery seq. Nothing pending settles `unavailable`.
4. If the thread was left uncertain (an abandoned or stale settlement), read
   its last turn first. After two consecutive `contextWindowExceeded` turns,
   send `thread/compact/start` once first.
5. If the thread is active with a known turn: `turn/steer` with
   `expectedTurnId`; otherwise `turn/start` with `approvalPolicy: never` and
   the `workspaceWrite` sandbox policy. Both carry
   `clientUserMessageId: theseus:<attempt_id>`. A refused steer falls back to
   one `turn/start` when the host has already seen that turn end, or the error
   text says there is no active turn or the id is stale.
   `activeTurnNotSteerable` settles `busy`; any other error `error`; a child
   gone before answering `unavailable`. A steer answered after the host saw its
   turn end is settled `handed`, logged `steer_late`, and that turn's end is
   applied to it, so Core re-arms it as an unseen steer; the host never guesses
   a second `turn/start` for it.
6. The answer settles `handed` at once, before any later message from the
   same read is handled, so the `seen` notification finds its row.

The claim stays outstanding while its RPC runs; renewals and schedule reads go
on, and no other claim starts. Core's claim lease is the only bound: when it
ends first, the host abandons the claim (Core records `expired` at the next
claim), marks the thread uncertain, and logs a late answer without settling it.
An abandoned dispatch sends no further request: a step still waiting (the
thread's attach, its last-turn read, a compaction, a refused steer's fallback)
settles it as late instead. An answer the loop reads after Core's lease but
before its own abandon check gets `stale` from Core; that is also a late
answer (the runner's `settled` event carries `stale: true`), never a fault.

### Server requests

Answered at once from the same loop: command and file-change approvals
`decline`; permissions `{permissions: {}, scope: turn}`; user input
`{answers: {}}`; MCP elicitation `decline`; dynamic tool calls
`{contentItems: [{type: inputText, text: "not available"}], success: false}`;
`currentTime/read` the host clock in whole seconds; anything else error
`-32601`. Each is logged with its method (or `other`) and thread.

### Notifications

`thread/status/changed`, `turn/started` and `turn/completed` keep each
thread's status and active turn. `turn/completed` calls `end_hosted_turn` with
the turn's status, its `codexErrorInfo` key, the turn's tokens (the `last`
breakdown of its latest `thread/tokenUsage/updated`) and its CLI calls
(`commandExecution` items whose command names the config's CLI). A `userMessage`
item whose `clientId` starts `theseus:` calls `hosted_turn_seen`. An
`unauthorized` turn logs `auth_failed` and re-reads the account before the home
serves another claim. `error` is logged; `thread/closed` detaches the thread.
Everything else is dropped. No notification text is stored.

A message that breaks the framing or a shape the host relies on (a response
id that is not an integer or string, a `threadId` that is not a string in a
notification or server request, a turn status that is not a string) is a
`protocol_error`: that child alone is closed and terminated, and the claim it
was serving settles `error`. If the child's output ends while it was serving,
it is closed the same way (`child_refused` `output_closed`) and terminated by
its captured PID, so its waiting requests settle when it exits.

### Child exit

On NOTE_EXIT the host reads what is left, reaps the child, records the exit,
fails every request still waiting on it, detaches its threads (a thread still
attaching settles its waiting claims `unavailable`, so the next claim attaches
it through a fresh child), and settles each open turn of those threads `lost`,
which re-arms through Core's backoff.

### Stop

A stop signal stops new claims. The host waits for the outstanding RPC (or the
claim's lease), sends `turn/interrupt` for each active turn, handles the
resulting `turn/completed`, closes each child's input and waits for each exit.
A second stop signal sends SIGTERM to the captured child PIDs, a third
SIGKILL. After a fault or lost ownership, `Host.close` closes every child's
input and reaps each with the same escalation, before the guard and watch
close.

### Event log

`<host-dir>/events.jsonl`, one JSON object per line with `event` and `at_ms`:
`spawn {pid, child}`, `spawn_failed`, `initialized {pid}`, `child_refused
{pid, reason}`, `auth_failed {pid}`, `resume {thread, status}`,
`resume_refused`, `resume_settings_refused`, `resume_failed`, `dispatch
{attempt, outcome, reason, mode, ms}`, `dispatch_abandoned`, `dispatch_late`,
`settlement_stale`, `steer_refused {attempt, turn_ended}`, `steer_late
{attempt, thread, turn}`, `compact`, `seen {thread, status}`,
`turn_end {thread, turn, status, error_code, tokens, cli_calls, rearmed}`,
`turn_error`, `server_request {method, answer, thread}`, `interrupt`,
`protocol_error {pid, reason}`, `child_exit {pid, status, state}`. The runner
also prints each as `host_<event>` on stdout. No message bodies, previews,
titles or notification text.

### Choices that wait on a probe

Each is one named constant, set to the conservative option until its probe
(design §10) runs: `EXPERIMENTAL_API` (P15), `SPAWN_OVERRIDES` (P14),
`RESEND_INSTRUCTIONS_ON_RESUME` (P2), `STEER_REFUSAL` (P4),
`ORPHANED_IN_PROGRESS` and `LAST_TURN` (P8), `COMPACT_AFTER` (P12),
`LATE_STEER_REARMS` (P5(b)) and the exact-roots echo rule in `settings_applied`
(P2/P6) in `codex_host.py`; `PREVIEWS_IN_CONTEXT` (P11) in `hosted_notice.py`;
`UNSEEN_REARM_MODES` (P5) in `runner.py`.

Proof: `tests/test_codex_host.py` runs real runner processes against
`tests/fixtures/fake_codex_app_server.py`, a scripted stand-in that speaks the
schema's message shapes and runs the real CLI as the agent, covering design §9
S1-S6 and the failure rows above. No test runs Codex or calls a model.
