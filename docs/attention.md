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

### Marks in the page

- The topic page keeps, for each message, the highest mark revision anything
  told it: every page of the `marks` view, an open's `editor_state`, a
  receipt, a refusal's `current_versions`. A mark the page knew before a
  `marks` read began and that read no longer lists has been cleared since.
  It reads the marks at start, on Refresh, after each commit (beside the
  rails), and after any recorded answer to a mark it sent.
- Loaded cards show an Unread pill beside the author. When the person has
  marks in the topic, a line says how many ("1 message marked unread") and
  its Read it opens the oldest one in the Reader directly by its source,
  however old; after it clears, Read it names the next.
- The Reader's Mark unread button (pressed: Marked unread) marks and clears
  the message it shows. A refusal adopts the revision Core names and says so.
  Each request is kept per message, state and revision, and sent again as it
  was until Core records an answer.
- Only reading clears: a card's click or keypress, or Read it. That act
  captures the revision the page knew for the message, and the open sends a
  clear fenced on it only when the open succeeded with the source whole and
  the message still marked, it is still the one shown, and the page is in
  front; a page in the background sends it when shown again, if the same open
  is still shown. An open that is superseded, closed, cancelled by Escape
  before the Reader shows, or under way while the page leaves sends none, nor
  does any other open (a Reader step, the Notebook, a correction). A mark
  renewed while the open was under way survives, as its revision moved on.

## Not yet replied to

Unread is about reading; this is about answering. In each topic the reader
sees a red line marked "New" just below the oldest message they have not
replied to. Messages are listed newest first, so everything the line sits
under is either newer than that message or that message itself.

A message is not yet replied to when someone else wrote it after the reader's
last post to the whole topic (a post with no `reply_to`), and no reply of the
reader's has that message as its `reply_to`. A post to the whole topic answers
everything before it. A reply moves the line up to below the next message the
reader has not answered; when none is left, the line goes. Only the reader's
own posts move it: reading through, `delivery.ack`, a mark, and other people's
replies do not.

`topic_messages` returns it as `unanswered`, `{seq, id}` or null, on every
page in either direction, worked out in the same read as the page. It does not
depend on deliveries, so the value a page gets is the same before and after
that page's read-through. One indexed query finds it: the reader's last post
to the whole topic comes from an index on (topic, author, sequence) over posts
with no `reply_to`; the walk forward from there stops at the first message by
someone else that no reply of the reader's names, which an index on
(`reply_to`, author) answers per message. Every row it passes is the reader's
own reply or a message one of those replies answers, so its cost follows what
the reader wrote in the topic since their last whole-topic post, not the
topic's length, other topics, or anyone else's history. Schema version 14
adds the two indexes and nothing else; stepping back to 13 drops them.

The page keeps the boundary from the newest topic version any page said it
at, so an older page loaded with More never brings back a line a later reply
moved. It draws the line under that message's card when the card is loaded;
until More loads it, no line shows. The line is text ("New"), with no message
identity, in the alert colour, so nothing that looks for cards finds it.

When the reader is at the top of a topic, with the newest card showing from
its top edge, a message that arrives comes into view above it; the page does
not scroll to keep the old card in place. Further down the topic, the card the
reader is looking at stays where it was.

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
