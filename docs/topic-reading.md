# How a topic reads

A topic reads like an inbox: newest on top, each message answered in the
Reader. This page says how each card shows where the person stands with it
(pipeline items 31, 102, 103, 11, 127 and 475). Nothing here changes a
record; Core says a few more facts per message, and the page shows them.

## What Core says

`topic_messages` items carry four fields, read for the page's own messages
only, through indexes keyed by message. The first three come from
`aim_next/topic_reading.py`:

- `unread`: true while the message waits in one of the reader's unread groups,
  the same deliveries the counts and the New line read, by the one rule both
  read (`SUBSCRIBED` and `ADDRESSED`, docs/attention.md, "In the browser"). The reader's own
  messages are never unread. Marks are not folded in: the page has its own
  (`web/marks.mjs`). An agent's edit of its own message makes it unread again
  for each person who had read it where their delivery of it counts (not a
  message between others, nor a topic they left), and every person who had
  read it gets `struck` in their item, the words they had read that the edit
  took away
  ([message-edit.md](message-edit.md), "An agent's edit, for the people who
  had read it").
- `replied`: the reader's newest reply to the message, `{id, sent_ms}`, or
  null. A reply is in its parent's topic, and the reader always sees their own
  messages, whispers included, so it never names a message they cannot read.
- `yours`: what the reader has written privately on the message,
  `{note, reply, version}`, from their own notes and drafts only, so another
  reader's never shows. `note` is true while their private note on it holds
  words; `reply` while they have a reply from it that is not sent: a reply
  saved there holding words or an image, or the newest reply they prepared
  from it while its send has not been accepted. Preparing a reply empties its
  draft, so without the second a send refused after it (the authority
  changed, or the person left the topic) would leave the reply unsent and
  unmarked. A send is accepted when it made its message, which carries the
  send's operation id; a reply prepared again from a refused one, once
  accepted, answers for it. `version` is the note's revision, every such
  draft's and the count of replies from the message that were sent, added up:
  each save, preparation and accepted send raises one of them and none is
  ever lowered, so it grows with each, and a page keeps the newer of two
  reads. The prepared replies are read by the page's messages
  (`editor_submissions`), never by the reader's whole send history, so a
  page costs the same however many replies they prepared from other messages,
  in this topic or another; so does a save's version
  (`tests/test_reader_bounds.py`).

A save of a private note or a draft about a message, a reply's preparation and
its accepted send record a `yours` change in the writer's own scope, keyed by
the message and carrying that version, so a page showing the card reads the
message again (`topic_messages {topic_id, message_ids: [id]}`), on this
device or another. A refused send changes nothing, so the mark stays.

A fourth, from `aim_next/stacks.py` (`awaiting_fields`), once each message
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
(`reply_wait_from_seq.597`, `record_wait_start` in `aim_next/stacks.py`,
called from every post in the same transaction), and no later post moves it. A
message before it was already in the store when the rule shipped and never
waits, so nothing there starts pulsing on deploy; a store no such release has
posted to has no value and reads as before, with no message waiting. It is a
sequence, not a time, so neither Core nor the page compares clocks. The key
names the shipping that writes it (item 597, this rule's re-ship): the release
that first shipped the rule wrote `reply_wait_from_seq`, and the release that
took it out left that value in the store. Reading it would set waiting every
unanswered message posted since, so it is never read.

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

## Your note corner (649)

A message with your private note shows a small note corner; pressing it opens
the composer to that note. The shortcut is on the drawn message card, with the
existing note glyph and an “Open your private note” name and tooltip. Pointer,
keyboard and a phone's first tap all open the Reader directly to the exact note.
The reply and its destination stay as they were. A note saved without a caret
opens at the end of its words and can return to the reply without an error. The time's passive marks and
collapsed dossier rows keep their existing behavior.

The corner follows Core's reader-scoped `yours.note`: no corner for an empty
note or another actor's note. It disappears when your saved note is emptied.
Opening uses the existing foreground source/editor read, retains writing during
a slow or failed read, and permits retry from the same corner. Unavailable
sources retain the existing note recovery with saving held. No note text is put in the
feed or the shortcut's attributes. The `reading item 649` native cases in
`tests/topic_reading_native.mjs` cover these branches at 320, 375, 390 and laptop,
light and dark, in Chromium and WebKit. Measured bounds use a named 1px tolerance.

The corner takes its own 44px row in the card's normal flow, after the words
and other card content. The card painter adds it after reading controls, and
later reaction controls insert before it, so an author repaint cannot put it
between the author and the message. A dossier root stays static so its tab still belongs
to the folder. A covered reply keeps the card system's ordinary bottom padding
and overlap allowance below the corner: the next sheet covers no part of its
target. Root and last-reply notes remain distinct. The B1/B2 cases measure
containment and test points across the full target, including its bottom edge,
then press the actual corners and the message words separately. Their named
1px layout tolerance permits rounding, never covered hit area.

## What a card carries (127)

A card shows at a glance what its message carries: a small, quiet glyph in
its author line, just after the time, for an image (a picture; "Has 2 images"
for more than one), for the person's own private note (a page), and for a
reply they saved and have not sent (a pencil). They are marks, not controls:
no Tab stop and no press of their own, so a press on one opens the message
as a press anywhere on the card does. Each says its words as its accessible
name and its tooltip ("Has an image", "Your private note, which only you can
see", "Your reply, saved and not sent"), so a screen reader hears them with
the card; a whisper's card, whose name is set to say who it is to, says them
in that name after its time (`paintWhisperAuthor`, `web/whisper-choice.mjs`). They are drawn in the line's quiet color (`--muted`), which every
card face sets for light and dark, and held to the time (`.together`), so a
line that wraps keeps them beside it; a message from before times were kept
shows them after its name (`carriesOf` and `paintAuthor`, `web/marks.mjs`).
The card's star (item 376) shows only on a lit card but always has its place
after them. On a marked line that place is kept at the end of what comes
before the star (the time and its marks, or Edited), and the star sits in it
taking no width of its own (`aim.css`), so a line the marks fill wraps with
its star rather than leaving the star alone on a line that shows nothing.
A message that heads a reply stack shows them on the stack's head row too,
beside who started it, since that row stands for the message while its card
is folded into it (docs/reply-stacks.md, "The head"). The row's second line
never wraps: on a narrow tab who replied and what is new give way first, then
its marks, whole glyphs dropped from the end, then who started it, cut short;
the reply count always shows, as it did before the marks, so a phone may show
fewer marks there than the card does. The dossier's title bar glyphs (item
473) take none of that row's room while they are hidden: the tab reaches as far
as it does without them, and they stand on the folder's paper past its curved
corner, inside its right edge. Selected on a phone, ⋯ takes the few pixels it
needs there back from the tab (docs/reply-stacks.md, "The title bar and the
message bar").

They follow the person's writing as Core keeps it: a note saved in the
Reader, or a reply saved there or on another device, marks the card once its
`yours` change is read (`TopicViews`, key `yours:<id>`); a note emptied, a
reply emptied or a reply whose send is accepted takes its mark away. A reply
whose send is refused keeps its mark until a reply from that message is sent.
Another reader's note or draft never marks a card. `tests/card_marks_native.mjs` (`native-card-marks`)
checks them in Chrome and Safari's engine at 320, 375 and 390 points with
touch and on a laptop, light and dark, and at every width that a marked line
holds no line showing nothing and the star's place stays inside the card,
that every head row shows its reply count whole and only whole marks, that
at 390 a dossier whose first message carries a picture alone keeps its image
mark and who started it whole once a tap selects it and its title bar shows ⋯
("picture-only head row at 390px …"), and that a whisper's card says its marks in the name the browser gives it. In
Safari's engine that name is read from Playwright's accessibility snapshot,
whose line for the card is quoted whole when the name holds ": ", as an image's
"Image: screen.png" puts there; the check reads either form back to the exact
name.

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
- Open, a dossier of more than seven messages shows its newest seven and one
  row for the rest, "8 earlier messages", which shows them all as rows in
  place for this visit, recording nothing (item 476).
- The page groups messages by the dossier Core names for each, so one
  dossier is one stack whatever of it is loaded (item 550,
  docs/reply-stacks.md, "One dossier, one stack"): its name shows once.
  Earlier messages shows what it loads where its button was, so no stack
  higher up takes another head or another card.
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

## Images in a card (474)

A message's images show as thumbnails in its card, after its words, on the
topic page, in the Conversation and in a dossier (`web/card-images.mjs`). Each
verified inline image (PNG, JPEG, GIF, WebP) is a square the right rail's
thumbnail size (4.2rem, `.things-thumbs`), in the order it was sent; the
squares wrap on a phone and never run past the card. Each is named for a
screen reader ("Image: screen.png"); its displayed image names its
“Open image in a new tab” action under the pointer. A square holds its place, blank, from the moment it is drawn until
its picture comes, also while it waits to come near the window before its
picture is asked for; only one whose read brings nothing shows the image's
name instead, so a picture on its way never looks refused.

Each thumbnail reads its bytes through the message that carries it
(`/api/media/read` with that message as its source), so Theseus gives them
only to someone who may read the message, and the reads
take turns with every other image read on the page (docs/images.md), behind
the composer's own thumbnails, the Reader's and the right rail's. A thumbnail
is read only once its card is drawn as a card within half a window of the
window: a card shown as one row (folded, between others, or behind a dossier's
earlier-messages row) or further away reads nothing, so a long topic's load
reads only the pictures near where the reader is. Scrolling a card near,
unfolding it, or showing an earlier message whole reads its pictures then. When
the topic becomes one the reader can no longer read, the thumbnails go at once
with the right rail's pictures, and the page holds none of their bytes. A press
on a displayed thumbnail opens its image in a new tab (item 651,
docs/images.md); a press elsewhere on the card opens the Reader, where each
attachment keeps its Open. A message with no image, a file that is not an image
and a message shown as one row (folded, between others, or an earlier message's row) draw no
thumbnails.

- `tests/stack_native.mjs` (`native-reading`, `native-webkit-reading`):
  "reading thumbnails a message's images show in its card …", at a laptop's
  width and 390, 375 and 320 on a phone, light and dark, with a refused image
  showing its name.
- Read only near the window: `tests/stack_native.mjs` (`native-reading`,
  `native-webkit-reading`), "reading card thumbnails are read only for cards
  drawn near the window …", on a topic of thirty messages each with an image,
  which counts the reads at load and after a scroll, an unfold, the dossier
  and its earlier-messages row opened, and an earlier message shown whole.
  The same case samples every frame before it is painted, at load and after
  a jump to the card furthest from the window, and no square in view draws
  its image's name while its picture is on the way.
  Behind the composer's own: `tests/ui_image_pick.test.mjs`, "a card thumbnail
  waits behind every other image read …".
- A topic no longer readable keeps none of the bytes: `tests/outcome_rail_native.mjs`
  (`native-rail`), "rail a topic the page can no longer read leaves the right rail at once …",
  which counts every picture's bytes the page holds.
- Who may read an attachment: `tests/test_media.py`,
  `test_exact_attached_source_grants_read_but_id_or_unattached_source_does_not`.

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

## New arrivals above the reading place (785)

At document top, an outside arrival that would enter between the visible
header and the card being read waits behind the existing New above marker.
Its real card stays connected but hidden, outside dossier layout; its record
still contributes to header New and Only new. Nothing in view moves. The
marker draws it and takes the reader to it. Scrolling until the insertion
point is above the window draws it through the same reading hold. A deliberate
view change draws it explicitly at its destination: opening a message,
a confirmed own send to this topic, New, either More, or feed navigation.
Feed navigation keys draw it only with focus in the feed, outside writing,
inputs and contenteditable elements. Typing, caret movement, selection and
ordinary clicks do not draw it; neither do star, unstar or card-menu actions,
which retain their pre-action card hold. Traversing controls to reach the marker
does not itself draw the waiting arrival. Access and current-view checks still
apply, and a held card is never reported as seen.

New above remembers arrivals by message identity. Activating it retires the
arrival actually reached, after its current topic, message and connected card
are confirmed and focus lands inside it visibly. A fractional scroll edge
within one CSS pixel counts as a landing. Other arrivals still above sight
keep their offers. The pill centres on the message column when CSS anchor
positioning is supported; its fallback keeps the legacy inline left edge.

More new below follows the New line's oldest unread message, loads the real
older pages until it is available and gives that message visible focus.
Generic More messages retains its existing first-loaded-card landing rule.
The focused item 785 native checks distinguish these destinations. Their
document-top control waits for observed scroll completion or a bounded quiet
frame fallback before introducing an arrival; the same-card drift limit stays
one CSS pixel. This control does not change product anchoring.

The continuous reading hold belongs to recorded outside arrivals and edited
message repaints above the reading place. It absorbs only their own height
changes. It retains the actual message and entry identities, and checks the
arrival height against the displacement of the reading place and the other
cards. A later page or person scroll invalidates the hold before any restore;
so does unrelated layout, including the sheet, Reader or composer. A whole-page
observer does not grant arrival ownership. Existing synchronous writing,
caret/selection, acted-card/title and More repaint owners keep their rules.
Generic writing and card acts still do not accept waiting arrivals.
