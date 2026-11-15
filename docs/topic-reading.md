# How a topic reads

A topic reads like an inbox: newest on top, each message answered in the
Reader. This page says how each card shows where the person stands with it
(pipeline items 31, 102, 103, 11 and 475). Nothing here changes a record; Core
says three more facts per message, and the page shows them.

## What Core says

`topic_messages` items carry three fields, read for the page's own messages
only, through indexes keyed by message. The first two come from
`aim_next/topic_reading.py`:

- `unread`: true while the message waits in one of the reader's unread groups,
  the same deliveries the counts and the New line read. The reader's own
  messages are never unread. Marks are not folded in: the page has its own
  (`web/marks.mjs`).
- `replied`: the reader's newest reply to the message, `{id, sent_ms}`, or
  null. A reply is in its parent's topic, and the reader always sees their own
  messages, whispers included, so it never names a message they cannot read.

The third, from `aim_next/stacks.py` (`awaiting_fields`), once each message
is placed in its dossier:

- `awaiting_reply`: true on a message of the reader's own, on the record (not
  a whisper), posted from where the rule begins (below), in a topic that is
  not an outcome's conversation, that an agent received, until the first
  reply from anyone else ("Waiting for a reply", below). An agent received it when Core delivered its first
  revision to an agent: one it was addressed to, or one taking part and
  switched on when it was sent (the deliveries `message.send` and
  `message.post` write). The correction an edit queues to an agent that
  read the old words is a later revision's delivery (docs/message-edit.md),
  so it is no receipt: a message no agent was handed when it was sent does
  not wait because it was edited after an agent read it. False on every
  other message, the reader's own included. It is read from the messages and
  deliveries as they stand, never stored, so a reload, another device and
  the CLI all read the same.

Where the rule begins is the sequence of the first message posted by a
release that holds it: that post writes it once into the store's metadata
(`reply_wait_from_seq`, `record_wait_start` in `aim_next/stacks.py`, called
from every post in the same transaction), and no later post moves it. A
message before it was already in the store when the rule shipped and never
waits, so nothing there starts pulsing on deploy; a store no such release has
posted to has no value and reads as before, with no message waiting. It is a
sequence, not a time, so neither Core nor the page compares clocks.

Messages naming the reader are read only between the reader's oldest message
on the page and the newest message on the record by anyone else, which the
topic's summary already keeps (`topic_summaries`, work.py), and replies and
thumbs-up by the page's own messages, so the read does not grow as the topic
grows after them.

No table, command or schema step: the metadata table holds the one value.

## Waiting for a reply (475)

After the person posts, their message shows the Conversation's three quiet
dots (docs/conversation.md: the same element, `waitingDots` in
`web/outcome-conversation.mjs`, pulsing in turn in the card's own ink and
still under reduced motion), at the foot of the card, until the first reply
from anyone else, a person or an agent. Named "Waiting for a reply" for a
screen reader and the pointer; they are a mark, not a control.

- A reply is what Theseus already reads as answering a message, by someone
  else:
  - a message in the same dossier, after the person's message: a reply to it,
    to a reply under it, or anywhere in a stack joined to it;
  - a message whose `reply_to` names it, wherever it is stacked (a reply
    someone joined to another stack still answers it, as the Conversation
    reads an answer by its `reply_to`, docs/conversation.md);
  - a message on the record after it that names the person, an Ask or a Tell
    to them, in a subject of its own or anywhere (a message for them,
    docs/attention.md); it answers each of their messages before it;
  - an agent's thumbs-up on it, its "got it". One given counts after it is
    taken back: the first reply was made.
- Not a reply: the person's own next message, which waits in its turn; a
  message someone else starts as a new subject that names nobody or only
  others; a whisper to the person (an agent's whisper answers their whisper);
  a person's thumbs-up, which says they read it and understand
  (docs/thumbs.md).
- Never on a whisper.
- Not at all when no agent receives the message: with nobody named and no
  agent taking part, or only people named in a topic no agent takes part in.
- Not in an outcome's conversation, where each item already shows its own
  dots until something settles it.

Core says it (`awaiting_reply`, above), so a reload keeps it and nothing on
the page starts none. A message or a thumbs-up arriving while the page is
open ends the dots at once by the same rule (`learnAnswered`,
`web/card-reading.mjs`): a message by someone else after the waiting one in
its dossier (its `stack_position.root_id`), replying to it, or on the record
naming the person; or a thumbs-up on it by someone the page knows is an
agent. A message with no sequence is after nothing, and one with no dossier
root is in no dossier, so neither ends a wait by those. A message folded to
one line shows only that line, without its dots.

Checks: `tests/test_topic_reading.py` (Core: addressee, taking part, whisper,
conversation, a person's reply, the reader's own reply, a message outside the
dossier, a reply joined to another stack, a Tell naming the reader, an
agent's thumbs-up and its taking back, a person's thumbs-up, a message to
nobody or to others and an agent's whisper, a message from before where the
rule begins, an edit's correction to an agent that read the topic, and
nothing stored by reading it), `tests/ui_card_reading.test.mjs` (the page's
rule, outside the dossier too, a message with no dossier root or sequence,
and the dots), and `tests/topic_reading_native.mjs` (`native-reading`,
`native-webkit-reading`): "reading dots after the person posts to an agent
…", "reading dots end on a reply joined to another stack, an agent's
thumbs-up and a message naming the person …", "reading dots never show where
no agent receives the message …" and "reading dots on a waiting message sit
inside its card …" (320, 375 and 390 wide and a laptop, light and dark).

## Read cards (31)

A card the person has read sits back on a quieter fill (`--read-card`, light
and dark; an agent's tint is mixed toward it, and its name keeps the full
tint). The person's own black cards do not change. A card keeps how it read
when the topic opened, so cards do not change under the person's eyes while
they scroll; it reads as read at once when they open it in the Reader, reply
to it or thumb it up (here or on another page or device: a 👍 reads its
message in Core, docs/thumbs.md, clearing a mark on it, and taking it back
leaves it read), and as unread while it is marked unread (`readNow`, `web/card-reading.mjs`). The read fill keeps a quarter of an agent's tint in
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

## Reply stacks (103, 283)

A message and every loaded reply to it, and to those replies, read as one
stack. The full contract is in docs/reply-stacks.md: what Core records, the
order and folds, and the one file that sets the look. In short:

- A stack reads as a chat. Its first message is on top as one compact row,
  with who began it, its short name, and who replied. The replies run under
  it oldest first.
- The topic's stacks sit newest activity on top, unless the reader moved
  one (⌘↑ ⌘↓). That order is theirs alone.
- Folded, a stack shows its newest reply, every reply the person had not
  read, and any they starred. Each run folded away is one line where it
  sits ("3 earlier replies"), with how many in it are new in red. A click or
  tap opens them in place, and again folds them.
- A message whose parent is not loaded heads its own stack until the parent
  loads.
- The conversation page stacks its replies by the same rule. There a folded
  stack also keeps in view an item nothing has settled and an ask waiting
  on the reader, so a card's New tag and "Asks you" are never folded away
  (docs/conversation.md).
- A link to a message a stack folds away opens the stack first and lands on
  the message. That holds for a tag's link, the reply arrow's, a message's
  address and a link written inside a message, which then opens the Reader
  as before. A row of the right rail's Starred lands without opening it.

The one New line goes under the lowest stack holding anything new, never
inside one. What the page reports as read (`topic.read_through`) is only
what was on screen. A range runs over messages in the topic's order and
ends at a loaded message that was not seen (`seenRanges`). So a folded
reply, or a message between a stack and its new place, is never reported
read.

## Formatted words (11)

Cards and the Reader show a message's Markdown (`web/message-format.mjs`):
headings, lists and task lists, tables, quotes, code blocks and rules, with
bold, italics, struck words (`~~`), inline code and links in the lines. It
builds nodes, never markup, so nothing in a message becomes HTML; only http
and https addresses become links (docs/links.md). A backslash before any ASCII
punctuation shows it as written, and before anything else stays.

- **Tables.** A table with a dash row keeps its columns' alignment. A table an
  agent writes as rows of bars with no dash row is a table too: three or more
  cells a row, two or more rows of one width, at most one blank line between
  them; a row of another width ends it. A table drawn in box lines, as a
  terminal prints one, is kept as drawn, in a monospace block. A wide table
  scrolls inside its own box, never the card or the page, under a finger as
  under a trackpad; each cell keeps its words on one line up to a measure, so
  a table wider than a phone scrolls rather than crushing to a word a line.
  While more of it is off to one side, that edge fades, repainted as it
  scrolls or changes size. A row draws the cells it was written with; a row
  shorter than the widest ends in one empty cell across the rest. An
  excerpt's cut last table row stays as words.
- **Lists.** Items nest by indent, and each keeps its own number or bullet.
  `- [ ]` and `- [x]` show ☐ and ☑, a mark rather than a control, since a card
  is a button; a ticked item's words are quieter.
- **Code.** A fence closes only on a line of its own marker, at least as long,
  with nothing after it, so a line like `` ```js `` inside it stays code; its
  language is kept on the block (`data-lang`). Lines ending in CR LF read as
  lines.
- **Quotes** hold blocks (lists, headings, code, quotes) up to nine deep;
  deeper, the words are one paragraph.
- **In a line** (a paragraph, a heading, a list item or a table cell) the
  words are read once, from the left, as CommonMark reads them: an escape
  first, then inline code, then `[words](address)`, a bare address or a
  topic's id (GFM's autolinks), then bold, italics and struck words. Whether
  a `[` opens a link is read before anything after it, by matching brackets
  past escapes and code as CommonMark finds a link's words; any other `[` is
  words. An address ends at an escape, so `https://a.example/my\_page` links
  to `https://a.example/my`, followed by `_page`, or code, and holds
  brackets, inside a `[` that is words as anywhere else (docs/links.md). Which `*`, `_` and `~~`
  open and close follows CommonMark's rules for runs of them: by the
  whitespace and punctuation (symbols included) on either side, in any
  script, with `_` opening and closing nothing inside a word
  (`card__header and card__body`, `café_menu_` stay as written) and the rule
  of three; `~~` is two tildes exactly. A mark holds a link or code whole and
  never cuts one, and a link's words may hold marks and code. Inline code may
  run over a line end within a paragraph, which it shows as a space, and one
  space comes off each end of code that has one at both. `characters.mjs` says
  what is whitespace, punctuation or part of a word, for the marks and for
  where an address or id may start alike.

In the Reader each heading, list item, quote, code block and table is one
passage, and a paragraph's passages are its sentences. A paragraph is read
once, as its card reads it, and a sentence that ends inside a link, inline
code or a mark joins the next, so the Reader draws what the card draws. The
passages cover the whole message, so what lights is what Return quotes, from the message's own
words; whitespace at its end is no words and is not drawn, though the last
passage still covers it. A Notebook page opened in the Reader is drawn the
same way. A link in any block (a paragraph, a list item, a heading, a table
cell, a quote) opens as it does in plain words (docs/links.md). Every drawn node knows which characters of the message it shows, so a
selection quotes the author's Markdown for what it covers: a whole bold word
with its marks, a list item from its box with its `- [ ]`, a table as it was
written, a link it partly covers whole.

Reading a message is linear in its length: every search for a closing mark
or code remembers where it stopped, whether each `[` opens a link is found
in one pass before the words are read, a link's words are read once,
and a link's target is read as an address once (brackets that share a target
that is no address, or sit inside one, are words), so a
hostile message costs work in proportion to its length, not to its square. What it draws is too: a table draws no more cells
than were written, plus one a short row, never its rows times its columns.
