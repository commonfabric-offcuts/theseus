# What waits for the reader

Unread counts come from the deliveries Core already keeps, plus the messages
a person has marked unread to come back to (below). A message is unread for a
reader while its delivery to them is pending, or while they have it marked.
Reading through it on screen, replying to it, or acknowledging it settles the
delivery; only opening the message to read it clears a mark. A person's reply
(a post whose `reply_to` names the message, including one written in the
Reader about it) settles their own delivery of that message, in the same act,
when it is pending in an active group; it settles nothing else and clears no
mark. An agent's deliveries are the work it is woken for, which it acknowledges
itself with `delivery.ack` ([agent-cli.md](agent-cli.md)), so an agent's reply
settles nothing.

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
- `attention` also returns `waiting_on_me`, how many topics wait on the
  reader, because someone said so or because a message asked them (below),
  and `latest_waiting`: up to five of them, newest first, each with its `id`,
  `title`, `title_truncated`, `note`, `state_by` and `state_ms`, `said`
  (whether the topic's state names them) and `ask` (`{message_id, by,
  since_ms}` for the oldest unanswered ask, or `null`). A topic waits only on
  someone who can read it; whoever loses the topic is taken off its waiting
  list.

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

## Asked, and waited on

A message sent to someone by name says whether it asks or tells them
([agent-cli.md](agent-cli.md#asking-and-telling)); an agent must say which,
and a person's message that says neither is a tell. An asking message makes its
topic wait on each person it asks, in the same act that sends it, and the
wait ends by itself when that person next writes in the topic, whatever they
write and whoever they name: writing there answers every ask that waits on
them in that topic. Until replies record which message they answer, that is
the only rule. Agents asking agents wait the same way. Asking yourself waits
on nobody, and a tell waits on nobody.

There is one record of who a topic waits on: a row per topic and person in
`topic_waiting`, which holds either reason or both. `said` is a wait someone
gave with `topic.update` (the topic's state is waiting and names them);
`ask_message_id` is the oldest ask to them there that they have not answered,
so the wait shows how long they have been waited on. The row lives while
either holds, and ends with neither:

- a reply in the topic clears the ask and leaves a said wait as it was;
- `topic.update` changes only what was said: a new state ends the said waits
  and leaves each ask, and naming someone already asked makes the same row
  said as well;
- a second ask to someone already asked keeps the first;
- losing the topic ends both.

The row's order time is the state's time while it is said, else its ask's
time, so `latest_waiting` lists asks and said waits together, newest first,
from the same index, and `waiting_on_me` counts each topic once. An ask does
not change the topic's state. Topic reads keep `waiting_on` as the said list
(the one `topic.update` edits, so the state form never turns an ask into a
said wait) and add `asks`: `[{actor_id, message_id, by, since_ms}]`, one per
person asked, in actor order. `workspace_topics` items carry both. A change of
kind `waiting` reaches each person a topic starts or stops waiting on.

In the web app a reply to someone tells them unless the writer ticks Ask,
which shows in the Reader once the reply names someone and goes when the last
name does. A topic row is marked "Waiting on …" while anyone is said or asked,
whatever its state ("Ready for review · waiting on …" when it is ready), and
the mark's title says who asked whom and since when. The "Waiting on you" list
gives each topic's ask the same way and leaves out a state that was not said.

Schema version 14 adds `messages.intent` and, on `topic_waiting`, `said`
(1 for every row from before) and `ask_message_id`. Stepping back to 13 is
refused while any message asks or tells or any row holds an ask.

## Work observed

One server rule says whether anyone is seen working on a topic
(`aim_next/work.py`): work is observed when someone posted in the topic or took
a hosted turn in it within the last hour, or when the topic waits on someone
(said or asked). A hosted turn is in a topic when it was handed deliveries from
that topic; its activity is when it was handed and when it completed. A turn
that failed, was interrupted or was lost adds nothing when it ends. Theseus
sees only work that leaves a trace in it, so nothing says that nobody is
working: a topic without observed work reads "no activity seen since" its last
activity, or "no activity seen" when it has none.

Topic reads and `workspace_topics` items carry `work`: `{observed, seen_ms, by,
how, waits}`, where `how` is `posted` or `turn`, whichever was later. Each fact
is one keyed row per topic (the latest message through `topic_summaries`, the
latest turn in `topic_turns`, the waits in `topic_waiting`), so a page of
topics costs one lookup per topic on it, whatever their history. The value is
worked out when the page is read: a row read at 9:00 that saw activity at 8:30
still shows it until the list is read again, and its title always gives the
time. A turn's start or end does not itself make the list read again; the
posts a turn makes do. The pipeline's NOW list will count as observed work
once NOW is a record; `observed()` takes it as `in_now`.

In the web app a topic row with observed work carries a small hollow ring in
the quiet text color (`--muted`) and nothing else. It was the filled accent
dot that presence and unread use, beside the unread count, so it read as
unread (warp, item 91b). While any row has the ring, a key under the topics
says in words what it means ("Activity seen"), at every width, since a phone
shows no title; the key is hidden from screen readers, which hear each row's
own words. Every row's title and screen-reader text say what was seen:
"Activity seen <time> (<who> posted)", "No activity seen since <time>", or
"No activity seen". A waiting row's words begin with what its pill says,
"Waiting on you · last activity <time>", and say "Waiting on someone" only
when the server counts a wait the row does not name.

Schema version 15 adds `topic_turns` (the latest turn per topic) and
`hosted_turn_topics` (the topics each handed turn holds). Stepping back to 14
is refused once either holds a row.

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

## The New line

In each topic the reader sees a red line marked "New above" just below the oldest
message they have not read. Its job is to keep them from missing anything.
Messages are listed newest first, so everything the line sits under is either
newer than that message or that message itself.

Read is exactly what the counts above hold. A message is unread while its
delivery to the reader is pending in an active group or while they have it
marked unread; reading it on screen, opening it in the Reader, replying to it
or Mark read settles its delivery, and only opening it clears a mark. So the
line, the unread counts and the Unread pills never disagree:

- Reading a newer message leaves the line under the oldest unread one; when
  the oldest is read, the line moves up to just below the next; when nothing
  is unread, there is no line.
- Marking an older message unread moves the line down to just below it;
  clearing the mark (opening it, or Mark unread again) brings the line back.
- A message that arrives while the reader is caught up is unread, so the line
  appears just below it.
- An ask to the reader that they have read moves past the line. The topic
  still waits on them ("Waiting on you") until they answer; the line is only
  about reading.
- The reader's own messages never hold the line: they are never delivered to
  them, and a mark on one is passed over. A delivery left pending by a
  subscription that leaving the topic cancelled is not unread either.

`topic_messages` returns it on every page, in either direction, as
`oldest_unread`, `{seq, id, sent_ms}` or null, with `commit_seq`, the commit the answer
reflects (the view reads in one transaction). The `topic_unread` view takes
`{topic_id}`, needs topic access, and returns `{topic_id, oldest_unread,
commit_seq}`. Reading, marks and replies change no topic version, so a page
keeps the answer with the highest `commit_seq` it has seen, from either view.

Finding it does not read the topic. Each delivery keeps its topic, copied from
its message, and an index on (recipient, topic, delivery) over the pending ones
gives the reader's first pending delivery in the topic; deliveries are queued
in the transaction that writes their message, so that is the oldest message
delivered and unread. The reader's marked index gives their oldest mark in the
topic. Each read stops at its first row, passing over only rows a cancelled
subscription left pending or marks on the reader's own messages, so the cost
does not grow with the topic, other topics, or what the reader has read.

Schema version 18 adds each delivery's topic (copied on upgrade from its
message) and that index. Of what version 16 kept for the line's first form,
which followed replies, it drops the index of each message's replies, which
nothing reads any more. It keeps the reply horizons as the record of who has
written in each topic, which decides who may say where a topic stands
(docs/agent-cli.md, `state`): every author has a row in each topic they wrote
in, its `seq` one past their newest message there, set on upgrade and by each
post. Stepping back to 17 drops the column and the index, puts the reply
index back and works the horizons out again from the messages, so no record
is lost and version 17 code finds its line as before.

The page keeps the newest answer as said above. It draws the line under that
message's card when the card is loaded. The line is text ("New above": in a newest-first list the messages the
reader has not read are above it), with no message identity, in the alert
colour, so nothing that looks for cards finds it. Its label is an element of
its own (`.new-line-label`), apart from the time the line shows after it. The page reads `topic_unread` again after each announced commit (beside
its rails and marks, in the same reload), so the line follows reading live as
it happens, in this page or any other; a repaint keeps the card the reader is
looking at where it was.

The line says "New above" and when that message was sent, from
`oldest_unread`'s `sent_ms`, as every time on the page is shown
(docs/times.md): "New above · 4:40 AM", "New above · Yesterday 9:12 PM". The label and the time are separate spans, and the
time's title keeps the date. A message from before times were kept (`sent_ms`
null) gets the label alone.

When that message is further back than the page has loaded, which is when the
reader is most behind, the line sits at the bottom of what is loaded and reads
"More new below" and the time, saying which way the unread messages lie ("New
· older below" read as new above and older below, the opposite of what it
meant; warp, item 91b). There it is a button, framed and filled as the page's
other buttons are: pressing it, by pointer or keyboard, reads older pages one
after another, as More does, until that message's card is loaded or no older
page is left, and then gives that message the focus, with the line in its true
place just below it; once on screen the message is read, and the line moves on
as reading moves it. While it shows, it is the one way to load older messages:
More messages, which sat just below it doing much the same, is hidden, and
comes back once the line is in its place. A read that cannot go on (a review
pending, or a refusal, which the page reports) ends it with the line still at
the bottom. When no older page is left to read, there
is nothing the button could load, so no line is drawn. A message among the
loaded ones that has no card on the page has no line.

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
