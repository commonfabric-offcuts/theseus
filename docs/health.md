# The Health page

One page says whether Theseus is working, from Core's own facts: the agent
runner, the server, each agent's waiting work and wakes, the Mac's load, and
the latest release. Something unhealthy is said in plain words at the top. It
exists because the runner stopped twice on 6 November and nobody saw it, and
because every wake to the three Codex-queue agents failed for 18 hours after
the ChatGPT app was closed, with 129 to 162 messages waiting for each, and
nobody noticed.

## Where it is

`?health`, from one quiet "Health" link under the instance label, which heads
the rail on every page (the logo block on pages without a rail).

## The view

`health` (no arguments) is one read. Every enabled member may read it. It
returns:

| field | meaning |
| --- | --- |
| `runner` | the `wakes` view's runner light (`live`, `state`, `reason`, `since_ms`), plus `started_ms` (when the current or last run took the role), `resumed_because` (`cleanup_confirmed` when the supervisor resumed a cleanup pause), and `prior`: `{state, reason, ended_ms}`, how the run before it ended (`stopped`, `exited`, `paused` or `unrenewed`). A pause now records `ended_ms`, so `since_ms` says since when it has been paused |
| `agents` | every enabled agent (at most 100): `route` (`codex_queue`, `codex_hosted`, `other`, from its route pin, this binding's first; `null` with none), `waiting` and `waiting_since_ms` (pending deliveries in live groups and the oldest one's send time; another agent's whispers are not counted for the reader), and for a scheduled agent `next_due_ms`, `reached_ms` (when a wake last got through), `failing: {count, since_ms, outcome}` once `failing_after` wakes in a row have not got through, `not_answering: {count, since_ms}` when it is parked (`wake_health.py`), and `waking` while a claim is out |
| `failing_after` | the number of wakes in a row that did not get through before an agent is said to be failing (3) |
| `release` | the latest release record: `release`, `commit`, `deployed_ms`, `items`, `source`, and `check` (the release check's `finished_ms`, `commit`, `python`, `node` and `native` counts), or `null` |
| `machine` | `{load: [1, 5, 15 minute averages], cpus}`, read by `os.getloadavg()` when the view is read; never on a timer |
| `schema_version`, `read_ms` | the database version and when the view was read |

Over HTTP the server adds `server: {started_ms, pid, live_feed}`, the one line
Core cannot know.

A wake **got through** when it settled `accepted`, `queued` or `handed`. Any
other settlement (`error`, `unavailable`, `busy`, or `expired` with its claim)
did not. Core keeps per recipient `reached_ms`, `failed_wakes`,
`failing_since_ms` and `failed_outcome`, updated by every settlement, so the
page reads one row per agent however long a failure runs. The database step
that adds them works them out once from the settlements already kept. They
and the runner's `prior_*` columns are derived, nobody's records, so stepping
back drops them and is never refused.

## The page

The top says what is wrong, most urgent first: a lost live connection, a
runner that is not sending wakes (and how many agents have work waiting),
agents whose wakes are failing (grouped when their failures began within two
minutes of each other with the same outcome, since then the cause is
something they share; when they all go through the Codex app's queue the page
says to look there first), parked agents, and a Mac whose 1-minute load is
above its core count. With nothing wrong it says so in one line.

Below, one line each, opening in place: the agent runner, the server, every
agent, the Mac, and the latest release. The page reads the view again on every
commit the live feed announces (a wake's settlement is a commit), and repaints
at once when the feed drops or comes back. A failed read keeps what was shown
and says so.
