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
colour, with no edge or box of its own. Agents read the same thing with
`aim-next health` (docs/agent-cli.md).

### What the link shows

Every answer the link has is tied to the commit it is true at, and what it
shows is one pure function of what it has (`standing` in
`web/health-light.mjs`):

- Core keeps what is red with every commit, in the same transaction, as its
  last write (metadata `health_light`, `{red, seq}`): it is read after every
  other write the act made, the notices it posts included, and kept with the
  number of the commit it is true at, so it is what the views answer at that
  commit. The live feed sends it with that number:
  `{"seq": N, "health": {"red": [...], "seq": N}}`. On a current server the
  link follows the feed alone and reads nothing.
- A commit the feed sends without it (an older server, or a commit that did
  not settle what is red, such as a migration) is read through the
  `health_light` view, whose answer names the commit it was read at
  (`commit_seq`). Its reads run one at a time, one more for any commit that
  comes while one runs, and each answer is taken as it comes, by its commit:
  a commit during a read never throws an answer away. A server whose reads do
  not name their commit is taken as of the commit known when the read began.
- The link shows the answer with the highest commit it has: a feed answer
  only when it is newer than the one it has, a read when it is at least as
  new (a read at a commit is taken after Core kept what was red at it). It
  never shows an older one.
- While the live feed is down it says "Health · couldn't check", in the alert
  colour, since something may be red that it cannot see. When the feed comes
  back, its first number is the floor: an answer from before it is not shown
  as current, so until an answer at that commit or later arrives (on a
  current server, that first message itself) the link says "Health ·
  checking". If no commit was missed, the answer it has is at that commit and
  stands.
- Until its first answer it says "Health · checking". After a read that
  fails, or answers without a list of what is red, it says "Health ·
  couldn't check", unless the feed is live and the link already holds an
  answer at the latest commit it knows of, from the feed or from a read,
  whether that answer came before or after the read that failed.

On a server that offers no live feed, the link, like the page, is read when
the page opens and when it comes back into view.

## What is red

One rule in Core (`_health_reds` in `health.py`) decides what is red; the page
and the link both read it, so they cannot disagree. What the team is told is
drawn from the same facts by a rule of its own (below):

| key | red while |
| --- | --- |
| `runner` | no runner sends wakes: it paused, ended (killed, failed, lost its lease, or the server saw it go), was stopped and no runner has taken the role since, stopped renewing without saying so, or never ran here while a woken agent has work on the record |
| `failing:<agent>` | `failing_after` (3) attempts in a row to reach that agent did not get through (below) |
| `parked:<agent>` | it has left its last three attempts unanswered (below) and work on the record waits for it |

The Mac's load is read when the page reads it, not recorded by any act, so it
is said at the top of the page when it is above the core count but never
lights the link or posts.

An attempt is left unanswered when it got through to the agent with work
waiting (below) and the agent recorded no command after its wake began: a
notice accepted into its chat with work waiting, or a hosted turn that was
given work still pending and completed with no command from the agent while
it ran or while the claim that handed it was out. Core keeps that count per
agent in `wake_facts` (`unanswered_wakes`, `unanswered_since_ms`, and
`acted_ms`, when the agent last recorded a command while a claim of its was
out; each running turn keeps whether the agent acted while it ran), and only
two things move it: an attempt left unanswered adds one when it settles,
and the agent's own recorded command clears it. Each is final when it is
recorded, so the count is never taken back: a hosted turn is counted when it
ends, not when it is handed its work; a turn Codex ended failed, lost or
interrupted did not get through (below), so it is never filed as the agent
not answering, and never as the agent answering either; and a turn handed
nothing still pending (the owner took the work away between the claim and
the hand) left the agent nothing to answer. The scheduler keeps a count of
its own for when to stop waking a silent agent (docs/effects-runner.md,
"Unanswered wakes"), which also moves for its own reasons (it clears when
nothing waits, as when the owner takes the agent off a topic). Health never
reads it, and the page never says what the scheduler will do: it says how
many wakes reached the agent and since when.

A runner that stops gracefully keeps as its end when wakes last went out: the
stop itself, or, for a runner whose lease had already run out unrenewed (a
hung runner then sent TERM), that lease's end.

## Attempts, and why one did not get through

What Health counts is attempts to reach an agent, never the messages around
them. An attempt is one claim the runner settles itself, or one hosted turn
with every hand it took: the claim that started it and each claim whose work
was steered into it. However many messages were steered into a turn, it is one
attempt; a hand to a turn that had already ended joins an attempt already
settled. Each attempt counts at the moment it happened, never at the moment
something else happened to settle it.

Health never guesses which turn a claim came from or whether a turn still
runs: Core cannot tell either, and the rows it lists as running can outlive
the turns themselves. Who ends a turn in Core is whoever learns it ended:

- the Codex host, when Codex says so (`turn/completed`), when a resume finds
  the thread's last turn ended or gone, and when the Codex process running it
  exits or is ended (`lost`, for a turn still running then);
- Core itself, when Codex takes a hand into another turn on the same thread
  (`finish_wake` with `handed`: a turn started, or a steer into a turn a
  history read named): Codex runs one turn on a thread at a time, so every
  other turn Core still lists there ended, as far as anyone knows, by then.
  Core ends it `lost` at that hand, through the same path as a turn's end,
  before it records the new turn. This is how a turn the host gave up on
  ends: the host lost it and started another (a steer into it refused as "no active
  turn", or one the history listed in progress), or Codex ended it with a
  status the host does not know, or a re-read found it ended. Core ends it
  there rather than the host at each place it stops running a turn, because
  every such path reaches a hand into another turn on the same thread, and
  the hand is the one fact Core records for all of them: no path the host
  adds can leave the turn open past it, to be dated hours later when the
  process exits.

A turn the host stopped running without an end (Codex closed the thread
mid-turn, `thread/closed` or a status of `notLoaded` or `systemError`) stays
open until Codex takes a hand into another turn on its thread, a resume of
the thread settles it, the process exits, or the next runner ends it
(`lost`). So the facts come from who knows them:

- **Which turn a claim came from** is said by the Codex host when it settles
  the claim (`finish_wake(..., from_turn=)`), and only when the claim did come
  from a running turn: Codex said that turn cannot take more work (a compact
  or review turn refusing a steer into it, `busy`/`not_steerable`), or the
  Codex process running the thread exited or was ended for an answer Theseus
  does not understand (`child_exited`, `protocol_error`), which ends that
  process's turns `lost` in the same handling. Such a claim joins the turn it
  names while Core lists that turn as running: it is traffic to a turn already
  reaching the agent, the turn decides it, and one Codex fault is one attempt.
  Every other claim is an attempt of its own, whatever Core lists as running:
  Codex refused the steer without saying the turn runs (`steer_failed`),
  refused a turn/start (even as not steerable: that is a turn of Codex's own),
  would not resume the thread, resumed it with other settings, says it is not
  loaded, could not be started, or a notice went to the agent's chat. A claim
  that names a turn Core no longer lists joins nothing. A claim nobody
  settled (`expired`) named nothing, so it counts, at its lease's end.
- **Whether a turn got through** is said by the agent: only an agent a turn
  reached can act while it runs, so the first command the agent records while
  a turn of its runs gets that turn through, at that moment
  (`_health_acted`). An act recorded once Codex has started the turn but
  before the runner records the hand counts for that turn, when the hand is
  recorded: the claim was out, so it came after the wake began. A turn Codex
  completed got through when it ended. A turn that ended `failed`, `lost` or
  `interrupted` with no act while it ran did not get through, at its end; one
  the agent acted in already counted, so its end adds nothing, however late
  it comes.

Each attempt comes to one fact (`claim_attempt`, `act_attempt` and
`turn_attempt` in `health.py`):

| attempt | got through | did not, with why |
| --- | --- | --- |
| a claim that names no running turn | it settled `accepted` (its notice is in the agent's chat) or `queued` (an earlier one still waiting leads there), when it settled | it settled `error`, `unavailable` or `busy`, with the runner's own fixed code for how it went, when it settled; or `expired` with its claim, when its lease ended |
| a hosted turn | the agent first recorded a command while it ran, then; or it ended `completed`, then | it ended `failed`, `lost` or `interrupted` with no command from the agent while it ran, with Codex's own code for why |

A steer a completed turn never read is work the scheduler hands again
(docs/effects-runner.md), not an attempt that failed. A turn that did not
complete is an attempt that did not get through, not an agent that chose not
to answer: Codex did not run it. While a turn runs and the agent has not acted
nobody knows whether it gets through, and the page goes on saying what the
settled attempts say.

What Core keeps per recipient in `wake_facts` is a pure function of its
attempts by when each happened (`settled` in `health.py`): `reached_ms` (when
one last got through), `failed_wakes` (the attempts since that did not),
`failing_since_ms` and `failed_ms` (when the first and the latest of them
happened), `failed_outcome` and `failed_reason` (the latest failure's code),
and the unanswered count above. Every attempt that gets through is settled at
the moment it happens, so none is older than one already kept; only an
expired claim is settled after it happened, and one older than the last
attempt that got through is not one of the failures since. It is kept as
each attempt settles, so the page reads one row per agent however long a
failure runs. The runner
settles each claim with its own fixed code (`finish_wake(..., reason=)`:
`broker_exit`, `deadline`, `route_unavailable`, `child_exited`, `start_failed`
and the others in `wake_adapter.py` and `codex_host.py`; never local text), and
a turn that did not complete keeps Codex's code (`codexErrorInfo`, as
`serverOverloaded`), said in words after how the turn ended ("its Codex turn
failed (server overloaded)", `TURN_WHY`). `WHY` in `health.py` says each
runner code in words ("the helper that puts a wake in the Codex app's queue
failed (it exited with an error)"); the view sends those words as
`failing.why`, and the page, the command line and the notices all say them.
Failures from before Core kept the code say so.

## Telling the team

What the team is told is a second pure function of Core's facts and the time
(`_health_told` in `health.py`), never of what was told before: the
*conditions* of the runner and of each agent, not the traffic around them.
When it changes, Theseus posts one notice to the team with the difference, in
the act that changed it, or at the moment Core kept for it when no act comes;
never on a timer of its own, and never again while nothing changes.

| told | while |
| --- | --- |
| `runner` | it is paused or ended (killed, failed, lost its lease, or the server saw it go): at once. It was stopped, or stopped renewing, and no runner has taken the role for `HANDOVER_MS` (two minutes, the longest lease a runner may hold) since wakes last went out |
| `failing:<agent>` | `failing:<agent>` is red: its last `failing_after` attempts did not get through |
| `parked:<agent>` | it has left its last three attempts unanswered, whether or not work waits for it at the moment |

- **Why not the red keys.** Two of the reds depend on whether work waits:
  a runner that never ran is red only while a woken agent has work, and a
  parked agent only while work waits for it. Work comes and goes with every
  batch, so telling those reds would tell the team its own traffic back, a
  false "running again" when agents answer with no runner at all, and the
  same pair again with the next batch. What is told depends only on the
  subject's own facts, so it changes only when they do: for an agent, whether
  it is enabled, its attempts as each came out, and its own acts. How many
  messages were steered into a turn, or refused by it while it ran, is
  traffic too: a turn is one attempt.
- **A runner that never ran is not told.** It is red on the page and the
  link while a woken agent has work, since wakes that are needed are not
  going out. But nothing about it changed: the instance was never given a
  runner, so there is no stop to report, and the only thing that moves it is
  the work. When a runner first takes the role, nothing told ends.
- **When.** Every act that commits ends its own transaction with
  `_health_commit`: each recorded command, each runner act (a settlement, a
  claim that finds an expired one, a pause, an acquisition, a renewal, a
  stop), each recorded runner exit (the supervisor's, or the server's when its
  live feed sees the runner process end), each operator write, and the
  server's settling at Core's kept moment (below). It compares what is told
  now with what was last told (metadata `health_announced`, always what the
  rule gave at the last settling) and posts only the difference; then it
  advances the commit and keeps what is red, read after those notices, since
  a notice can be work that lights a red (below, "Who is told").
- **What it says.** What is told now and was not, then what was told and is
  not, in words drawn from the facts now: a runner back is "running again"
  (it is told only once it had run and stopped); an agent whose wakes get
  through "can be woken again"; one that acts "is answering again"; one
  disabled "was disabled, so it is no longer woken". A deploy hands the role
  to the next runner within seconds, so its stop and start tell nothing; a
  stop that no runner follows (a deploy refused after it stopped the runner,
  a runner sent TERM, which the supervisor does not restart) is told ("The
  agent runner was stopped and no runner has taken its place"), and a runner
  that takes the role later is told once that wakes are going out. A deploy
  whose stop, backup, migration and start take longer than the two minutes
  is told as a stop and then as running again: both are true.
- **With no act at all.** Some changes come with no act and no commit: a
  runner that stops renewing while its process lives (hung) has no exit to
  record, and a stop that lasts makes no more commits. Every settling keeps
  the next moment what is red or told would change by itself (metadata
  `health_due`: the running runner's lease's end, or when an absence will
  have lasted). Whatever act comes first settles it; with none, the server's
  live feed waits no longer than that moment and asks Core to settle on a
  commit of its own (`settle_health_due`, docs/effects-runner.md), so every
  page's link reads it from the feed and the team is told. A hung runner
  lights the link at its lease's end and is told two minutes later as "The
  agent runner stopped answering (its lease ran out and it did not renew
  it)"; a recorded exit or stop that follows is the same absence and posts
  nothing more. A server that was down too (a refused deploy stops it)
  settles it when it starts, and so does any agent's act through the command
  line meanwhile. A server whose live feed could not start (no native watch)
  has no one to settle a moment that passes with no act: the page and the
  link read it live whenever they read, and the team is told by the next act
  of anyone; the page's server line says it has no live updates and what
  that means.
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

`health_light` (no arguments) returns `red`, the sorted keys of what is red,
and `commit_seq`, the commit the answer was read at. The link reads it when
the page opens, when it comes back into view, and for a commit the live feed
sent without what is red.

`health` (no arguments) is one read. Every enabled member may read it. It
returns:

| field | meaning |
| --- | --- |
| `red` | the keys of what is red, as `health_light` gives them |
| `runner` | the `wakes` view's runner light (`live`, `state`, `reason`, `since_ms`), plus `why` (an ended runner's verb, "was killed", or a pause's cause, "an operator paused it"), `started_ms` (when the current or last run took the role), `resumed_because` (`cleanup_confirmed` when the supervisor resumed a cleanup pause), and `prior`: `{state, reason, ended_ms, why}`, how the run before it ended (`stopped`, `exited`, `paused` or `unrenewed`), from `runner_prior`. A pause records `ended_ms`, so `since_ms` says since when it has been paused |
| `agents` | every enabled agent (at most 100): `route` (`codex_queue`, `codex_hosted`, `other`, from its route pin, this binding's first; `null` with none), `waiting` and `waiting_since_ms` (pending deliveries in live groups and the oldest one's send time; another agent's whispers are not counted for the reader), and for a scheduled agent `next_due_ms`, `reached_ms` (when a wake last got through), `failing: {count, since_ms, outcome, reason, why}` while `failing:<agent>` is red, `not_answering: {count, since_ms}` while `parked:<agent>` is, and `waking` while a claim is out |
| `failing_after` | the number of attempts in a row that did not get through before an agent is said to be failing (3) |
| `release` | the latest release record: `release`, `commit`, `deployed_ms`, `items`, `source`, and `check` (the release check's `finished_ms`, `commit`, `python`, `node` and `native` counts), or `null` |
| `machine` | `{load: [1, 5, 15 minute averages], cpus}`, read by `os.getloadavg()` and `os.cpu_count()` when the view is read; never on a timer. Either that could not be read is `null`, never left out, and the page and the command line say it could not be read |
| `schema_version`, `read_ms`, `commit_seq` | the database version, when the view was read, and the commit it was read at |

Over HTTP the server adds `server: {started_ms, pid, live_feed}`, the one line
Core cannot know.

The database step (version 32) that adds `wake_facts`, `wake_turns` (each
hosted turn still running, as one attempt) and `runner_prior` works the facts
out once from the settlements already kept, by the same rule (`settled`) over
the same attempts, by when each happened: every claim the runner settled
itself, each its own, since which turn one came from was never kept (an
expired one at its lease's end), and every hosted turn. Before it, the only
acts whose time Core kept are the messages an agent wrote, so a turn got
through when the agent first wrote after its first claim began and before it
ended; one it only acknowledged in counts as it ended. A running turn the
scheduler's count says the agent acted in since is kept as acted in. The
unanswered count starts from the scheduler's own, the only record
of it, less each running turn the scheduler counted when it was handed work
(the rule counts it when it ends). They are derived, nobody's records, so
stepping back drops them, with what was announced and the moment kept; it is
refused once Theseus has posted a notice, which is on the record.

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
at once when the feed drops or comes back. When the feed comes back with a
newer commit than its answer, it says at the top that it is reading again,
never "Everything is working", until the read after it answers. A failed read
keeps what was shown and says so; an answer without `red`, `runner` and
`agents` is a failed read, never "Everything is working".

### Limits

- A hosted turn that Codex keeps running while its process goes on
  answering settles nothing until it ends, however many steers it takes and
  however many claims it refuses meanwhile. Core keeps no deadline for a turn
  (a turn may rightly run for many minutes), and a claim's deadline ends when
  its work is handed, so there is no fact that ends it sooner, and Health
  adds no timer of its own. Only claims the Codex host says came from that
  turn join it, so this holds only while Codex itself says the turn runs. A
  Codex process that stops answering is ended by the runner, and its turns
  end `lost`; a steer Codex never answers expires with its claim and counts;
  and a runner that stops or loses its role is red at once, and the next one
  ends the turns it left as `lost`. A turn the host stopped running without
  an end stays open in Core until Codex takes a hand into another turn on
  its thread, its process exits, or the next runner ends it, but no claim names it, so the claims
  that cannot reach the agent meanwhile count, and the agent goes red as its
  wakes fail. Its end, when the process exits, is dated then, and follows
  nothing that got through on its thread: a hand into another turn there
  would have ended it, and an act of the agent's meanwhile got it through already, so
  its end adds nothing.

- A WebSocket that stays open but has stalled (a half-open connection after
  the Mac sleeps or the network changes) still looks live to the page, so the
  link and the page trust the last answer the feed gave. This is a property
  of the transport and is shared with every view; the page reads the light
  again when it comes back into view, and that answer, being newer, is the
  one shown.
