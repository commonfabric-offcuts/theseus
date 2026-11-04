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

**Refresh** remains available and joins the same coalesced update work. Hidden
pages stop scheduling checks and catch up when visible again. The healthy
visible cadence starts at 500 ms; slower reads and retries reduce the rate.
This cadence is not a promise that every update arrives within 500 ms.

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

## Work bounds and rollout

The default server reserves one Store-read slot for foreground acts and one for
background work, with bounded queues and no borrowing. A source open and its
neighbor queries share the foreground slot. The split protects foreground reads
from background occupancy, at the cost of serializing their own paired queries.
An active Store callback owns its slot through close, even after its browser
request is cancelled. Slow storage, foreground overload and browser connection
limits can still delay work. Sends retain their separate command path.

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
