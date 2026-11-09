# How a topic reads

A topic reads like an inbox: newest on top, each message answered in the
Reader. This page says how each card shows where the person stands with it
(pipeline items 31, 102 and 103). Nothing here changes a record; Core says
two more facts per message, and the page shows them.

## What Core says

`topic_messages` items carry two fields, read for the page's own messages
only (`aim_next/topic_reading.py`), through indexes keyed by message:

- `unread`: true while the message waits in one of the reader's unread groups,
  the same deliveries the counts and the New line read. The reader's own
  messages are never unread. Marks are not folded in: the page has its own
  (`web/marks.mjs`).
- `replied`: the reader's newest reply to the message, `{id, sent_ms}`, or
  null. A reply is in its parent's topic, and the reader always sees their own
  messages, whispers included, so it never names a message they cannot read.

No table, command or schema step.

## Read cards (31)

A card the person has read sits back on a quieter fill (`--read-card`, light
and dark; an agent's tint is mixed toward it, and its name keeps the full
tint). The person's own black cards do not change. A card keeps how it read
when the topic opened, so cards do not change under the person's eyes while
they scroll; it reads as read at once when they open it in the Reader or reply
to it, and as unread while it is marked unread (`readNow`,
`web/card-reading.mjs`). The read fill keeps a quarter of an agent's tint in
light and less than a third in dark, so read and unread differ at a glance on a
phone's screen as well as a laptop's.

## Talk between agents (31)

A message an agent wrote by name to agents only, with the reader not among
them, not its author and not the author of what it answers, is dimmed until
the pointer or focus is on it (`agentTalk`), unless the person marked it
unread, so its Unread pill reads at full strength. A tap or click on its line or card
lifts the dim for the rest of the visit (`wakeOnPress`), so a phone needs only a
tap. Such a message is also between
others, so on a person's page it is already folded into one quiet line
(docs/attention.md); the line and its opened card are both dimmed. A name the
page cannot place is never taken for an agent.

## You replied (102)

A card the person has replied to shows a reply arrow on its author line,
beside the time. It sits there rather than in the card's upper right so the
message bar, which floats over the lit card's top corner (docs/interaction.md),
never covers it. Under the pointer it says "You replied at …"
(the shown time, docs/times.md; its title has the date), and a click opens the
reply in the Reader, opening its stack first when the stack folds it away. On a
phone a first tap shows the same words, as the pointer would, and a second tap
on the arrow or its words opens the reply; a tap anywhere else puts the words
away. A reply written while the page is open moves the arrow at once
(`learnReply`).

## Reply stacks (103)

A message and every loaded reply to it, and to those replies, read as one
stack (`web/reply-stacks.mjs`): the message on top, its replies under it,
newest first. The stack sits where its newest message would, so the topic
still reads newest on top and a reply brings its stack up with it. Folded, a
stack shows its newest reply and every reply the person had not read, and one
line says how many more there are ("2 earlier replies"); a click or tap opens
them in place, and again folds them. A message whose parent is not loaded heads its own stack until the
parent loads. The conversation page keeps every message on its own.

The New line goes under the stack holding its message. What the page reports
as read (`topic.read_through`) is only what was on screen: a range runs over
messages in the topic's order and ends at a loaded message that was not seen
(`seenRanges`), so a folded reply, or a message between a stack and its new
place, is never reported read.

## Message words

A card and the Reader show a message's words as they were written: plain
text, with http and https addresses as links (`web/links.mjs`, docs/links.md).
Markdown marks, tables and lists stay as words; drawing them formatted is
pipeline item 11, a piece of its own.
