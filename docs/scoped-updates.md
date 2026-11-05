# Scoped updates in the reader

This guide describes the matching reader and HTTP server. The retained instance's
release receipt identifies what is installed and running. The original
[implementation plan](scoped-updates-plan.md) remains the design and review record.

## Reading and writing

While the page is visible, it checks for changes to the open topic and updates
its loaded message and Notebook lists. Incoming replies appear without pressing
Refresh. **More** still loads older messages or further Notebook items; automatic
updates do not load the whole history or scan every topic.

An open source stays on the revision you chose. A newer Notebook revision offers
**Open revision**. Opening it is an explicit act; updates preserve your current
writing, quotes, image selection, focus and selection. Incoming changes do not
send, acknowledge a delivery, or silently choose a replacement source for you.

While automatic updates are running, **Refresh** joins the same coalesced work.
If updates are disabled or stopped by a diagnostic, it rereads the lists without
restarting automatic checks. A refused topic stays hidden until **Retry updates**
restores access; writing parked for authority review cannot be replaced by a
Refresh. Hidden pages stop scheduling checks and catch up when visible again.

### The live stream

When the server offers it (`transport.live` in `/api/bootstrap`), the page keeps
one `GET /api/live` stream open, with the same session token as every other
request. The server watches its database file; every commit writes that file, so
each new commit number is sent as one line of JSON, `{"seq": N}`, the first line
being the current number. The stream names no records: the page reads the open
topic's changes through the usual views, so the stream adds no new way to see
anything. A last line `{"end": reason}` says the server stopped (`stopped`), the
database or authority anchor moved (`database_moved`, `binding_changed`), or the
commit number could not be read (`unconfirmed`).

While the stream is up, the page reads only after a commit, so an idle page
reads nothing and a new message shows as soon as it is saved. A pass that fails
in a retryable way keeps its own retry timer. While the stream is down, the page
checks on the 500 ms cadence it used before, slowed by retries. A stream that
closes after delivering, or that ends with `stopped`, reconnects after a second;
any other ending backs off from one to thirty seconds, so a broken feed is not
asked in a loop. A page that becomes visible or comes back online reconnects at
once. A server without a native watch answers `LIVE_UNAVAILABLE`, and the page
does not ask again. The server holds at most eight streams; a ninth is refused
`SERVER_BUSY` and retried with the same back-off.

The outcome pages reload their topic and outcome lists after each commit; the
lists already merge overlapping loads and keep unchanged rows in place.

## When updates cannot continue

- **Updates delayed** means a retryable read failed. Background checks back off;
  your writing is kept. **Retry updates** requests another check.
- **Reload to reconnect** is an explicit reconnection after the HTTP session
  becomes unavailable. The page does not reload itself or erase its journal.
- **Review saved writing** handles a changed runtime authority. Automatic
  updates pause; recovery proceeds through the existing review controls.
- If a topic becomes unavailable, its lists are hidden and sending to it is
  disabled. A directly readable source can remain open. If that source is also
  refused, its body and attachments are hidden while private writing is kept.
  **Retry access** checks that source explicitly; it does not resume updates
  for the refused topic.

A server without the supported read-admission capability keeps automatic updates
off and says that they need the updated server. Manual Refresh remains available.
An unexplained read failure stops with a diagnostic rather than silently showing
an empty, apparently current topic.

After reviewing saved writing following a runtime authority change, use the
browser's Reload to reconnect. The update controls are outside the modal
reader; close the reader to inspect them. Further recovery, long-history
painting and evidence limits are recorded in
[review follow-ups](scoped-updates-followups.md).

## Work bounds and rollout

The default server reserves one Store-read slot for foreground acts and one for
background work, with bounded queues and no borrowing. A source open and its
neighbor queries share the foreground slot. The split protects foreground reads
from background occupancy, at the cost of serializing their own paired queries.
An active Store callback owns its slot through close, even after its browser
request is cancelled. Slow storage, foreground overload and browser connection
limits can still delay work. Sends retain their separate command path.

The reviewed workload measured the cost of that partition with an artificial
25 ms delay inside each Store read: paired source-open p95 rose from 44.0 ms
to 79.7 ms, and neighbor p95 from 42.4 ms to 78.3 ms (40 observations per
side). In separate browser scale checks, keyed Notebook-read p95 was 4.6 ms
with 1,000 unrelated records and 5.5 ms with 10,000. Both scales performed
the same reads for ten message/revision pairs; an unrelated commit triggered
no dependent list reads. These are measurements of the stated workloads,
not bounds on production latency or slow-storage behavior.

Publish the reviewed reader and HTTP revision together. For the retained
instance, follow [first-use process ownership](first-use.md): verify the owned
server's PID, start identity, executable and arguments before stopping it, then
start that server with the same profile and loopback port in a new private run
record. Preserve its database, authority, profiles, effects runner and browser
journal. Do not repeat initialization, copy session tokens or clear writing.

Coordinate the restart with Tony at a pause between sends, outside an in-flight
Send. After the owned server restarts, the handoff asks Tony to reload the same
URL once to receive its new in-memory session and reader files. A connected
reader with automatic updates shows **Reload to reconnect** until he does.
Locally saved unsent writing survives the reload; preserve the journal and honor
the page's unload protection for writing not yet durable. The agent verifies
process/log state and scoped views through its own profile, without fetching
Tony's HTML or reloading his page as a probe. The handoff names the exact
published revision, observed runtime and measured limits. Automatic process
restart and remote access remain outside this increment.
