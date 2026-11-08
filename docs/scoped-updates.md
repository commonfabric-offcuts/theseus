# Scoped updates in the reader

This guide describes the matching reader and HTTP server. The retained instance's
release receipt identifies what is installed and running. The original
[implementation plan](scoped-updates-plan.md) remains the design and review record.

## Reading and writing

While the page is visible, it checks for changes to the open topic and updates
its loaded message and Notebook lists. Incoming replies appear on their own;
the page has no Refresh button. **More** still loads older messages or further Notebook items; automatic
updates do not load the whole history or scan every topic.

An open source stays on the revision you chose. A newer Notebook revision offers
**Open revision**. Opening it is an explicit act; updates preserve your current
writing, quotes, image selection, focus and selection. Incoming changes do not
send, acknowledge a delivery, or silently choose a replacement source for you.

Opening a Notebook page from its list shows its current revision. Writing keeps
the revision it was started on; when that differs from the one shown, the Reader
says the page has changed since you started writing. A reply or note with nothing
in it (as a sent reply leaves its place, or once you empty it) holds no revision:
it is about the revision you are reading, and Core moves an empty private slot to
the revision its next save names, while one that holds writing keeps its own.

If updates are stopped by a diagnostic, **Retry updates** restarts them, and
they bring what arrived meanwhile. A refused topic stays hidden until **Retry
updates** restores access: a commit arriving meanwhile never repaints it, and
writing parked for authority review is never replaced. Hidden pages stop
scheduling checks and catch up when visible again.

### The live stream

When the server offers it (`transport.live` in `/api/bootstrap`, version 2), the
page keeps one WebSocket open to `/api/live`. A browser cannot set an
Authorization header on a WebSocket, so the page offers two subprotocols,
`theseus-live.v1` and `bearer.<session token>`; the server requires the page's
own Origin and that token, and answers with `theseus-live.v1` alone. It is a
WebSocket rather than a streamed response because a browser holds only six HTTP
connections per host: with a streamed response in each of six open pages, no
page could read at all. WebSockets are kept apart from those six.

The server watches its database file; every commit writes that file, so each new
commit number is sent as one text message, `{"seq": N}`, the first being the
current number. The stream names no records: the page reads the open topic's
changes through the usual views, so the stream adds no new way to see anything.
A last message `{"end": reason}`, followed by a close, says the server stopped
(`stopped`), the database or authority anchor moved (`database_moved`,
`binding_changed`), or the commit number could not be read (`unconfirmed`). The
client sends only control frames: a ping is answered, and anything else closes
the socket, as does a control frame that is fragmented, longer than 125 bytes or
has a reserved bit set. The server writes one frame at a time: a newer number
replaces one not yet sent, and a newer ping replaces one not yet answered, so a
client that pings without reading is owed one answer, not one per ping.

The feed reads the commit number through the store's own connection settings,
kept from SQL writes. If another process died partway through a commit, that
read is what rolls its journal back, with the store's full sync. A read waits on
a writer's lock, in SQLite's own busy wait on one connection, for as long as the
writer holds it, so a slow commit never ends the feed. Nothing ends that wait
early, so a stopping server does not wait for it: the streams end at once, and
the feed's thread closes what it holds when the lock goes. The first number is
read the same way, on the feed's own thread, so a writer holding its lock while
the server starts delays the first message rather than leaving the instance
without a stream.

While the stream is up, the page reads only after a commit, so an idle page
reads nothing and a new message shows as soon as it is saved. A pass that fails
in a retryable way, is interrupted, or leaves work behind keeps its own timer.
While the stream is down, the page checks on the 500 ms cadence it used before,
slowed by retries. A socket that delivered and then ended with `stopped`, or
that closed after announcing a commit or after staying up for thirty seconds,
reconnects after a second; any other ending backs off from one to thirty
seconds, so a broken feed is not asked in a loop. A page that becomes visible
or comes back online reconnects at once. A socket that worked in one of those
ways resets the back-off, so a later ending backs off from one second again;
one that ends or closes soon after only its first number keeps counting. A
quiet instance announces nothing after the first number, so the thirty seconds
keep a healthy idle socket that drops from being counted as broken. A server without a native watch offers no stream and refuses one with
`LIVE_UNAVAILABLE`, after the same Origin and session checks as any stream. The
server holds at most eight streams; a ninth is refused `SERVER_BUSY` and retried
with the same back-off.

Every page reloads the topic and outcome lists it shows after each commit, the
new-topic and new-outcome pages included. When the stream comes back it reloads
them only if the last reload could not read them: anything saved while the
stream was down changes its first number, which arrives as a commit, so a feed
that keeps reconnecting does not reread every list. A page starts following
commits before its first read, so a commit that lands while that read is out is
read after it. A reload asked for while a list is loading, by a commit or
Retry, never settles with that load: the load was sent before the ask and may
not show the commit, so one more load runs once it ends, however many asks
arrive. A reload reads again every row the reader has loaded, the pages **More**
added included, in pages as large as the view allows, and changes the list once
all have arrived. A reload whose read fails says so, keeps the rows it had and
offers **Retry**; the next commit, the stream's return or showing the page reads
again. Where the server keeps its read lanes apart, these list reads take the
foreground lane without holding background reads back, so the open topic's own
check for the same commit runs beside them rather than after them.

## When updates cannot continue

- **Updates delayed** means a retryable read failed. Background checks back off;
  your writing is kept. **Retry updates** requests another check.
- **Reconnecting to Theseus** means the server refused the page's session, as
  a restarted server does (every deploy restarts it). The page reads the
  server's current session from its own address, as a Reload would, checks that
  it speaks for the same instance and person, and goes on in place: the writing,
  the lists and the Reader stay, saves the refusal held up go out under their
  own operations, and the stopped updates are tried once more for that session.
  A reply sent before the page had the new session is refused wherever the old
  session meets the server (its save, its preparation or its send); Core never
  read it, so it goes on by itself and is published once. A page reloaded
  before it reconnected holds the new session, and such a reply kept on the
  device goes on when its writing is opened there. A reply held for any other
  reason waits for the person, as before.
  A refused live stream starts the same renewal. **Reconnect** does it on
  demand; while the server is not answering, the page says so and renews when
  the stream or a read reaches it again. It never reloads itself or erases its
  journal.
- **Review saved writing** handles a changed runtime authority. Automatic
  updates pause; recovery proceeds through the existing review controls.
- If a topic becomes unavailable, its lists are hidden and sending to it is
  disabled. A directly readable source can remain open. If that source is also
  refused, its body and attachments are hidden while private writing is kept.
  **Retry access** checks that source explicitly; it does not resume updates
  for the refused topic.

A server without the supported read-admission capability keeps automatic updates
off and says so: `Automatic updates need the updated server. Reload this page to
see newer messages.` A reload runs the same first read.
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
request is cancelled. The server reads for one person, so pages that ask for the
same view, with the same arguments and read class, while a read of it still
waits for its lane share that read: a commit announced to many open pages takes
one waiting place per view, not one per page. A read that has begun is never
joined, since it may not show the commit the later request follows, and a shared
read is withdrawn only once every page in it has gone. Each page keeps its own
queue window, counted from when it asked, so it joins only a read asked for no
later than itself; if the lane refuses a shared read before it begins, because
the first page's window ran out or every page in it had gone, a page that joined
it later asks for itself. Slow storage, foreground overload and browser connection
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
Send. After the owned server restarts, an open page takes the new in-memory
session by itself and carries on; it keeps the reader files it loaded until it
is reloaded. Locally saved unsent writing survives either way; preserve the
journal and honor the page's unload protection for writing not yet durable. The agent verifies
process/log state and scoped views through its own profile, without fetching
Tony's HTML or reloading his page as a probe. The handoff names the exact
published revision, observed runtime and measured limits. Automatic process
restart and remote access remain outside this increment.
