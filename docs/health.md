# The Health page

One page says whether Theseus is working, from Core's own facts: the agent
runner, the server, each agent's waiting work and wakes, the Mac's load, and
the latest release. Something unhealthy is said in plain words at the top,
with why. It exists because the runner stopped twice on 6 November and nobody
saw it, and because every wake to the three Codex-queue agents failed for 18
hours after the ChatGPT app was closed, with 129 to 162 messages waiting for
each, and nobody noticed.

## Where it is

`?health`, from one quiet "Health" link under the instance label, which heads
the rail on every page (the logo block on pages without a rail). While
anything is red the link says so: "Health · needs attention", in the alert
colour, with no edge or box of its own. What it shows is the answer to its
latest read, and only while the live feed can say that answer still stands:
it is quiet only after a read that says nothing is red. Until its first read
answers it says "Health · checking". After a read that fails (the server sheds
background reads under load) or answers without a list of what is red, and
for as long as the live feed is down, it says "Health · couldn't check", also
in the alert colour, since something may be red that it cannot see; the page
says the same at its top while the feed is down. Its reads run one at a time:
a commit that comes while one runs asks for one more, and an answer read
before the latest commit is never shown, so an older "nothing is red" never
stands for a newer read that failed. On a server that offers no live feed the
link, like the page, is read when the page opens and when it comes back into
view. Agents read the same thing with `aim-next health` (docs/agent-cli.md).

## What is red

One rule in Core (`_health_reds` in `health.py`) decides what is red; the page,
the link and the notices all read it, so they cannot disagree:

| key | red while |
| --- | --- |
| `runner` | no runner sends wakes: it paused, ended (killed, failed, lost its lease, or the server saw it go), was stopped and no runner has taken the role since, stopped renewing without saying so, or never ran here while a woken agent has work on the record |
| `failing:<agent>` | `failing_after` (3) wakes in a row to that agent did not get through |
| `parked:<agent>` | it has left its last three wakes unanswered (`wake_health.py`) and work on the record waits for it |

The Mac's load is read when the page reads it, not recorded by any act, so it
is said at the top of the page when it is above the core count but never
lights the link or posts.

## Why a wake did not get through

A wake gets through when it settles `accepted`, `queued` or `handed`. Any
other settlement (`error`, `unavailable`, `busy`, or `expired` with its claim)
did not. The runner settles each wake with its own fixed code for how it went
(`finish_wake(..., reason=)`: `broker_exit`, `deadline`, `route_unavailable`,
`child_exited`, `start_failed` and the others in `wake_adapter.py` and
`codex_host.py`; never local text), and a claim that expired with its runner
is `expired`. Core keeps, per recipient, in `wake_facts`: `reached_ms`,
`failed_wakes`, `failing_since_ms`, `failed_outcome` and `failed_reason` (the
latest failure's code), updated by every settlement, so the page reads one row
per agent however long a failure runs. `WHY` in `health.py` says each code in
words ("the helper that puts a wake in the Codex app's queue failed (it exited
with an error)"); the view sends those words as `failing.why`, and the page,
the command line and the notices all say them. Failures from before Core kept
the code say so.

## Telling the team

When what is red changes, Theseus posts one notice to the team, in the act
that changed it, or at the moment Core kept for it when no act comes; never
on a timer of its own, and never again while it stays red. A red is told once
it lasts: a fault at once, and a runner that is simply absent once no runner
has followed it within two minutes.

- **When.** Every act that changes what the reds are read from runs
  `_health_settle` in its own transaction: each recorded command, each runner
  act (a settlement, a claim that finds an expired one, a pause, an
  acquisition, a renewal, a stop), and each recorded runner exit (the
  supervisor's, or the server's when its live feed sees the runner process
  end), and the server's settling at Core's kept moment (below). It compares
  what is red now with what was last announced (metadata `health_announced`)
  and posts only the difference: what went red, and what went green again.
- **What, and when it lasts.** Whether a red is told is decided by whether it
  lasts, not by which state the runner is in. A fault is told at once: a
  pause, an exit, a runner that stopped renewing, wakes failing, a parked
  agent. A runner that is absent with no fault (stopped, or never run here
  while a woken agent has work on the record) is red on the page and the link
  at once, and told once no runner has taken the role for `HANDOVER_MS` (two
  minutes, the longest lease a runner may hold) since it stopped, or since the
  oldest work that waits for it. A deploy hands the role to the next runner
  within seconds, so its stop and start tell nothing; a stop that no runner
  follows (a deploy refused after it stopped the runner, a runner sent TERM,
  which the supervisor does not restart) is told ("The agent runner was
  stopped and no runner has taken its place"), and a runner that takes the
  role later is told once that wakes are going out.
- **With no act at all.** Some reds come with no act and no commit: a runner
  that stops renewing while its process lives (hung) has no exit to record,
  and a stop that lasts makes no more commits. Every settling keeps the next
  moment what is red would change by itself (metadata `health_due`: the
  running runner's lease's end, or when an absence will have lasted). Whatever
  act comes first settles it; with none, the server's live feed waits no
  longer than that moment and asks Core to settle what is red on a commit of
  its own (`settle_health_due`, docs/effects-runner.md), so the team is told
  and every page's link reads it. A hung runner is told as "The agent runner
  stopped answering (its lease ran out and it did not renew it)"; a recorded
  exit that follows is the same red thing and posts nothing more. A server
  that was down too (a refused deploy stops it) settles it when it starts, and
  so does any agent's act through the command line meanwhile.
- **Who.** Theseus itself, as the member `theseus` ("Theseus"), registered
  disabled with its first notice: never on a team, in a list of people, or
  woken, and never a person or agent who did not write the words. If someone
  registered a member under that name first, no notice is posted as them.
- **Where.** The conversation of each outcome the change concerns: an agent's
  change, every outcome that agent is on the team of or coordinates; the
  runner's, every outcome of an agent it wakes. One notice per outcome holds
  every change that concerns it, says what went red and why in plain words
  with no clock time in it, and points to the Health page and `aim-next
  health`. It is nobody's request, so it is not an item of the conversation.
- **Who is told.** The outcome's coordinator gets it as work, unless the
  notice is about the coordinator; whoever a notice is about gets it settled
  (it would only be more work that cannot reach them), and so do the people
  in the conversation, who see the link light.

## The views

`health_light` (no arguments) returns `red`, the sorted keys of what is red.
Every page reads it once and again on every commit, as attention is.

`health` (no arguments) is one read. Every enabled member may read it. It
returns:

| field | meaning |
| --- | --- |
| `red` | the keys of what is red, as `health_light` gives them |
| `runner` | the `wakes` view's runner light (`live`, `state`, `reason`, `since_ms`), plus `why` (an ended runner's verb, "was killed", or a pause's cause, "an operator paused it"), `started_ms` (when the current or last run took the role), `resumed_because` (`cleanup_confirmed` when the supervisor resumed a cleanup pause), and `prior`: `{state, reason, ended_ms, why}`, how the run before it ended (`stopped`, `exited`, `paused` or `unrenewed`), from `runner_prior`. A pause records `ended_ms`, so `since_ms` says since when it has been paused |
| `agents` | every enabled agent (at most 100): `route` (`codex_queue`, `codex_hosted`, `other`, from its route pin, this binding's first; `null` with none), `waiting` and `waiting_since_ms` (pending deliveries in live groups and the oldest one's send time; another agent's whispers are not counted for the reader), and for a scheduled agent `next_due_ms`, `reached_ms` (when a wake last got through), `failing: {count, since_ms, outcome, reason, why}` while `failing:<agent>` is red, `not_answering: {count, since_ms}` while `parked:<agent>` is, and `waking` while a claim is out |
| `failing_after` | the number of wakes in a row that did not get through before an agent is said to be failing (3) |
| `release` | the latest release record: `release`, `commit`, `deployed_ms`, `items`, `source`, and `check` (the release check's `finished_ms`, `commit`, `python`, `node` and `native` counts), or `null` |
| `machine` | `{load: [1, 5, 15 minute averages], cpus}`, read by `os.getloadavg()` and `os.cpu_count()` when the view is read; never on a timer. Either that could not be read is `null`, never left out, and the page and the command line say it could not be read |
| `schema_version`, `read_ms` | the database version and when the view was read |

Over HTTP the server adds `server: {started_ms, pid, live_feed}`, the one line
Core cannot know.

The database step that adds `wake_facts` and `runner_prior` works the counts
out once from the settlements already kept. They are derived, nobody's
records, so stepping back drops them, with what was announced and the moment
kept; it is refused once Theseus has posted a notice, which is on the record.

## The page

The top says what is wrong, most urgent first: a lost live connection, a
runner that is not sending wakes (and how many agents have work waiting),
agents whose wakes are failing and why (grouped when their failures began
within two minutes of each other for the same reason, since then the cause is
something they share; when they all go through the Codex app's queue the page
says to look there first), parked agents, and a Mac whose 1-minute load is
above its core count (never when either could not be read). With nothing
wrong it says so in one line.

Below, one line each, opening in place: the agent runner, the server, every
agent, the Mac, and the latest release. The page reads the view again on every
commit the live feed announces (a wake's settlement is a commit), and repaints
at once when the feed drops or comes back. A failed read keeps what was shown
and says so; an answer without `red`, `runner` and `agents` is a failed read,
never "Everything is working".
