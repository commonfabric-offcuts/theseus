# What waits for the reader

Unread counts come from the deliveries Core already keeps, plus the messages
a person has marked unread to come back to (below). A message is unread for a
reader while its delivery to them is pending, or while they have it marked.
Reading through it on screen, or acknowledging it, settles the delivery; only
opening the message to read it clears a mark.

- `workspace_topics` items carry `unread` and `addressed`: the reader's
  pending deliveries and marked messages in that topic, and how many of the
  pending deliveries name the reader.
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
save for a message sent by name to someone with no list of the outcome's
topics (below).
Archiving settles nothing. `workspace_topics` with `archived: true` still
shows each archived topic's own `unread`, `addressed` and `waiting_on`, and
when the topic is unarchived its counts return everywhere.

A person sent a message by name keeps reading that message after they lose
its topic, but can no longer read through the topic; `topic_readable` is
false, and they settle it with `delivery.ack`. When the topic is archived, a
message sent by name stays in the totals and `latest_addressed` of anyone who
is neither the outcome's owner nor a member: someone who lost the topic, or a
participant from outside the outcome. No list of the outcome's topics, archived
or not, ever held the topic for them, so attention is the one place they can
read and settle it.

A list view counts only the topics or outcomes on its page. The topic list
finds each topic's subscription group by its key, so its cost follows the
page; the outcome list starts from the reader's eligible groups, indexed by
recipient, so its cost follows the number of topics with something pending.
A subscription group keeps its own pending total. The one direct group per
reader is found by its key and counted row by row, so that part of every
count follows the number of pending messages that name the reader.
`latest_addressed` reads the newest five of them in index order, passing over
any in archived topics of outcomes the reader owns or belongs to.

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

## Marked unread

A person can mark a message unread so that they can come back to it. The mark
is theirs alone, durable, and counted as one unread message; it changes no
delivery, schedule or wake, so it never sends a notification or wakes anyone.

Core keeps one row per person and message in `message_marks`: the message's
topic and sequence, copied from the message (which never changes), and a
`revision`. The revision is the whole state: an odd revision means marked, an
even one means not marked, and no row means revision 0. Every change adds to
it and rows are never deleted, so a revision is never reused. Schema version
13 adds the table and an index on (person, topic, sequence) over the marked
rows. Stepping back to 12 is refused while any row exists, cleared rows
included: dropping them would restart revisions at 0, and a stale clear could
then remove a fresh mark.

### `message.mark`

- `target`: `{message_id}`. `args`: `{marked}`, true or false. `expected`:
  `{mark_revision}`, required, beside the captured authority.
- It needs access to the message's topic; otherwise it is a recorded
  `FORBIDDEN` (a message sent to someone by name after they lost its topic
  can be read but not marked).
- Every new operation is fenced: `expected.mark_revision` must equal the
  current revision, or the answer is a recorded `REVISION_CONFLICT` whose
  `current_versions.mark_revision` names the current revision, and with it the
  state. A retry of the same `operation_id` returns its original receipt and
  applies nothing.
- When the fence holds, marking from a not-marked revision r makes r+1.
  Marking an already marked r makes r+2: a renewal, so an open that saw r can
  no longer clear the newer reminder. Clearing a marked r makes r+1. Clearing
  a message that is not marked answers `changed: false` and writes nothing
  but the operation's receipt: no mark row and no change row.
- The result is `{message_id, topic_id, seq, marked, mark_revision, changed}`.
  A real change writes an actor-scope change of kind `mark`, keyed by the
  message at its new revision, and `affected` names the same.
- Mark and clear (and Undo) are the one command. A request that reaches Core
  late carries the revision its sender saw, so it is refused after any newer
  mark or clear: a delayed mark at 0 cannot bring back a reminder that was
  marked and cleared meanwhile, and a clear at r cannot remove a renewal.
  A stale sender reads the current state before offering a new act.

### Counting a mark

A marked message adds one to `unread` in `workspace_topics`, `workspaces` and
`attention`, and never to `addressed`, `latest_addressed` or
`capabilities.attention.after`. It counts only while the person has no
eligible pending delivery for the same message (pending in an active group,
which the delivery terms already count), so a message is counted once.
Leaving a topic cancels its subscription group and leaves that group's pending
rows uncounted, so a marked message there counts through its mark: marking,
leaving and rejoining shows one. Acknowledging a delivery leaves the mark, and
the count stays at one.

A mark follows the same scope as the rest of the count: a topic page counts
its own topics, archived or not; outcome rows and totals leave archived topics
out. A mark in a topic the person can no longer read lies dormant, uncounted,
and counts again if they regain the topic. The count reads the person's marked
rows through their index and probes each for an eligible delivery, so its
cost follows the person's marks, not history.

Reading through a topic and `delivery.ack` settle deliveries only; they never
clear a mark.

### Reading marks

- `editor_state` carries `mark: {marked, mark_revision}` for a message
  reference whose topic the person can read, and `mark: null` for any other
  reference.
- The `marks` view takes `{topic_id, cursor, limit}` and needs topic access.
  It lists the person's marked messages in that topic, oldest sequence first:
  `items: [{message_id, seq, mark_revision}]` and `next_cursor` (the last
  sequence returned, or `null` at the end). `cursor` is an exclusive sequence
  lower bound; `limit` defaults to 50, at most 100.
- A mark changes no topic version, so `topic_messages` and topic freshness are
  untouched; other pages learn of it from the commit announcement and read
  `attention` and `marks` again.

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
