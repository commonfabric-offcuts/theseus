# What waits for the reader

Unread counts come from the deliveries Core already keeps; nothing new is
stored. A message is unread for a reader while its delivery to them is
pending. Reading through it on screen, or acknowledging it, settles it.

- `workspace_topics` items carry `unread` and `addressed`: the reader's
  pending deliveries in that topic, and how many of those name the reader.
- `workspaces` items carry the same two counts summed over the outcome's
  topics.
- The `attention` view takes no arguments and returns the reader's totals,
  `unread` and `addressed`, and `latest_addressed`: up to five pending
  deliveries that name the reader, newest first, each with its message, its
  topic, and `topic_readable`. A topic the reader can reach only as a
  participant, outside any outcome they belong to, counts in the totals and
  never names its outcome.
- `attention` also returns `waiting_on_me`, how many topics say they wait on
  the reader, and `latest_waiting`: up to five of them, most recently said
  first, each with its `id`, `title`, `title_truncated`, `note`, `state_by`
  and `state_ms`. A topic waits only on someone who can read it; whoever
  loses the topic is taken off its waiting list.

An archived topic is out of the outcome's list, and the browser lists archived
topics nowhere, so it counts nowhere else either: the outcome row, the totals,
`latest_addressed`, `waiting_on_me` and `latest_waiting` all leave it out,
save for a message sent by name to someone who has lost the topic (below).
Archiving settles nothing. `workspace_topics` with `archived: true` still
shows each archived topic's own `unread`, `addressed` and `waiting_on`, and
when the topic is unarchived its counts return everywhere.

A person sent a message by name keeps reading that message after they lose
its topic, but can no longer read through the topic; `topic_readable` is
false, and they settle it with `delivery.ack`. This holds when the topic is
archived too: no list ever held the topic for them, so the message stays in
their totals and `latest_addressed`, the one place they can read and settle it.

A list view counts only the topics or outcomes on its page. The topic list
finds each topic's subscription group by its key, so its cost follows the
page; the outcome list starts from the reader's eligible groups, indexed by
recipient, so its cost follows the number of topics with something pending.
A subscription group keeps its own pending total. The one direct group per
reader is found by its key and counted row by row, so that part of every
count follows the number of pending messages that name the reader.
`latest_addressed` reads the newest five of them in index order, passing over
any in archived topics the reader can still open.

Each waiting row keeps a copy of its topic's state time and archive flag, so
what waits on a reader is read from one index on (reader, archived, state
time): `waiting_on_me` counts the reader's rows in that index, without reading
the topics, and `latest_waiting` reads the newest five in index order.
Schema version 12 adds those copies; the upgrade also drops any waiting row
for someone who had already lost its topic, and stepping back keeps the rest.
The first form of that upgrade timed messages without adding the copies, yet
stamped its databases 12. The store knows such a database by its missing
waiting index and refuses to open it; `bin/aim-next-admin migrate` finishes the
step, and finishes it before stepping back too.

## In the browser

The page reads `attention` at start, after each announced commit, when the
stream comes back and when it becomes visible again. It reads in the foreground
lane, which queues: the background lane sheds reads that keep a retry timer of
their own, and this one keeps none. Every open page asks after the same commit,
and the server lets identical waiting reads share one, so many pages cost one
waiting place. The tab title carries the unread total, and each topic and
outcome row shows its count, marked when part of it names the reader; the open
topic's row carries the count its list read for it. A visible page reloads its
outcome and topic lists after each commit, on topic pages as on outcome pages
and beside a new topic or outcome, keeping the rows loaded with More; a hidden
one reloads them when shown again.

Outcome pages list the newest messages sent to the reader by name. One in a
topic they can open links there, where reading it settles it; one in a topic
they have lost shows its words and a "Mark read" button. A Mark read that is
refused or whose answer is lost says so in the page's status, and the list is
read again either way.

A message that names the reader raises a system notification when it arrives
while the page is in the background, once the person has allowed
notifications. The page asks only when they press "Turn on notifications".
Delivery numbers only grow, so the page announces only deliveries newer than
any it has already seen: what was already waiting when the page opened is never
announced, even when it first comes into view after newer ones are read. The
page learns where it started from `/api/bootstrap`: `attention.after` is the
newest delivery naming the reader that waited then (the `capabilities` view's
`attention.after`, one read through the pending index), so a delivery that
arrives after the page opened is announced even when the page's first
`attention` read failed.
Clicking a notification opens the topic, or, for a topic the reader has lost,
the outcomes page. Neither the title, the counts nor a notification marks
anything read.
