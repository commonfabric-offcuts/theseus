# How Theseus answers the pointer, keys and taps

One short page of the rules every screen follows. The page itself is in the
app: press ? anywhere outside writing, or the small "? Pointer, keys and taps"
under who you are at the top of the side rail, which on a phone "☰ Topics"
opens (`web/interaction-guide.mjs`, the same words). Each rule there names
the pointer's way, the keys' and the phone's.

## The topic page

- **The light.** The message under the pointer lights, as a passage lights in
  the Reader, and a bar sits over its top corner: 👍, ✅ and 🚫 when it asks you
  for a go-ahead, Reply, and ⋯, the message's menu (Copy Link, Mark read or
  unread; docs/links.md; in the Reader also Start a topic from this and Add to
  pipeline, as a sheet from the bottom on a phone), which a right-click on the
  message also opens. The bar is only as wide as its buttons, and never covers
  the reply arrow beside the card's time (docs/topic-reading.md): where it
  would, it sits above that line, or below it at the window's top. ↑ and ↓
  move the light; Tab onto a message lights it, and Tab again goes through
  its bar's buttons, ⋯ last, then on from the message (Shift-Tab from the
  bar's first button comes back to it). Moving the pointer off the messages
  and their bar, or focusing another pane, clears the feed's light. Its last
  message is still remembered for returning with the keys. A rail's old DOM
  focus never draws a second ring while the pointer selects a message;
  using the rail keys gives the light back to that rail. A click on a lit message opens
  it in the Reader. On a phone a tap lights a message and shows its bar, a
  second tap opens it, and a tap anywhere but a message, its bar or a pop-up lets the
  light go; scrolling keeps it. The bar stays inside the window while any of
  its message is on screen and scrolls away with it. Where a finger presses,
  each of its buttons, and each item of the ⋯ menu, is at least 44px. (`web/message-menu.mjs`)
- **Return**, or **Reply** on the bar (a phone's way), opens the Reader on the
  lit message with the cursor in the reply and nothing quoted; to quote part of
  it, select that part in the Reader and press Return. Return in writing, on a
  folded line or on another control does what it does there.
- **⌘C** (Ctrl-C off a Mac, as ⌘A is, `web/writing-input.mjs`) with no words
  selected copies the lit message's words as written: the message the pointer
  or the keys lit last, the one Return answers, and a cut-off message whole.
  They are the words the Reader's ⇧⌘C copies of the message it shows. Words
  selected anywhere copy as the browser copies them, and in writing or a
  pop-up ⌘C is theirs; with nothing lit it does nothing of the page's. Nothing
  is said when it copies, as in the Reader; a refusal says how else to copy.
- **A cut-off message** (the first 1,024 bytes are shown) reads on in place:
  once the pointer rests on it, the keys light it or a finger taps it, its words
  become a box of the same height that scrolls under the wheel, trackpad or a
  finger, and not the page. Where a finger scrolls, the excerpt is never taller
  than 60% of the window, so a drag outside the lit message still scrolls the
  page. (`web/card-scroll.mjs`)
- **New message.** A quiet ✎ beside the topic's title opens the topic's
  composer on its own, with no message above it and the cursor in the field;
  Escape, ✕ or a press outside puts it back at the page's end with the writing
  kept. (docs/reader.md)
- **👍** means read and understood, never "do it"; pressing it again takes it
  back. It marks that message read at once, even one marked unread, and only
  that one: its card, the counts and the New line follow, here and on every
  page and device the person has open, and taking it back leaves it read
  (docs/thumbs.md). ✅ and 🚫 read their message the same way. The count on a
  message names who: on hover, or where nothing hovers (a
  phone), on the lit message, whose count then reads the names. A press on the
  count thumbs up; a tap on it on a phone lights the message and names who, and
  the bar's 👍 thumbs up. In the Reader 👍 sits on the quiet line and beside Send;
  pressed in either it is a reply of one thumb, and once Core holds it the
  Reader closes as after Send, keeping what the reply holds. Refused, or
  taken back, it leaves the Reader and the reply open. **✅ and 🚫**
  answer an agent's go-ahead ask in one tap or click, on the message or its
  bar, and the agent hears it as a reply (docs/thumbs.md).

## Writing

- **The reply in the Reader** is one quiet line while you read (+, the field
  saying whom it answers, 👍) and opens to the who chip, the field and Send when
  you write, with 👍 beside Send until a word is typed, and again once it is deleted. The who chip and + open panels; Done, Escape or a press outside
  closes them and the writing stays. On a phone, naming someone is two
  steps: To shows who is named and + Someone, which opens the naming sheet
  over the screen; Done, ← or Escape comes back with the writing as it was,
  and names whoever was left typed in its field. A name typed and not
  named stays in To with its reply, and Send waits on it.
  A draft begun on one message is kept when the Reader moves on, and says
  so. Every control is reached with Tab, and on a phone each is at least
  44px. (docs/reader.md)

- **Images.** Paste, Add image, Paste image when the browser can tell the
  clipboard holds one, and `#img` to pick one of the topic's recent images
  from a short list (↑ ↓ and Return, or a tap). On an iPhone or iPad, press and
  hold in the writing and tap Paste. (docs/images.md)
- **⌥↑ and ⌥↓** move the line, list item or paragraph the cursor is on, or
  those selected, above or below its neighbour; ⌘Z puts it back. Where nothing
  can move the keys do what they normally do. A list item carries the lines
  indented under it and moves only past an item at its own depth; a plain line
  moves within its paragraph; a paragraph that is wholly the cursor's moves
  past the next one. A phone's keyboard has no such key. A card being written
  on the cards page has them too (docs/decks.md). (`web/line-move.mjs`)
- **The saving sign** says when the writing was last saved: "Saved to Theseus ·
  4:40 AM", or the time it was kept on this device (docs/times.md).

## Keys across the panes

A topic and a Conversation have three panes: the outline on the left, the
messages, and the outcome's things on the right (docs/rails.md). The keys
move through them as Finder's column view does: ↑ and ↓ within a pane, → and
← between them, and with ⌘ the same arrows open, fold and reorder. One key
map (`web/pane-keys.mjs`) says what each key means, and each pane decides
whether it acts; a pane that is a tree (`web/key-tree.mjs`) keeps one Tab
stop, a ring on the row the keys are on, and the words a screen reader needs
(tree, treeitem, level, place in its set, open or folded).

- **The outline.** ↑ and ↓ move between the rows shown: outcomes, their
  topics, Done (N) and Archived (N) and the topics of one open, More, + New
  topic and the Notebook's pages. Home and End go to the first and last.
  Return opens the row in place: a topic, or an outcome's Conversation with
  its topics, folding every other outcome. ⌘→ opens the focused outcome (or
  a focused topic's outcome) and ⌘← folds it, with the keys on its row; →
  opens a folded outcome, and on an open one goes on into the messages, as
  on a topic (↓ reaches its topics); on Done (N) or Archived (N) → opens the
  group or goes to its first row; ← goes to the row it is under or folds an
  open one. ⇧⌘→ opens every outcome and ⇧⌘← folds every
  one, from anywhere in the outline; the next place reached tidies back to
  one open. ⌘↑ and ⌘↓ move an outcome, or a topic within its outcome, one
  place, the reader's own order kept wherever they sign in
  (docs/outline-order.md); ⌘Z right after puts the last move back. "Keys"
  under the outline lists them.
- **Between the panes.** → on a topic, on an open outcome, or on a row that
  opens nothing moves into the messages, onto the message last lit there, else the oldest one not read (just above the New
  line), else the first in view; ↑ and ↓ then move the light, and Return
  opens the Reader. On a stack, → opens and ← folds it through its three
  states first. Another → when fully open goes to the right rail; another ←
  when closed goes to the outline. On a message without replies they go
  straight to those rails. The outline lands on the row of the place being read. In the right rail ↑ and ↓
  move between its sections and their rows, and → and ← open and fold as in
  the outline: → opens a folded section or goes to its first row, ← folds an
  open one and goes from a row to its section, and ← on a folded section
  goes back to the messages. ⌘→ and ⌘← open and fold a section too, and
  Return opens a row. Each pane
  keeps its place, so going there and back never loses it; after a move in
  place the outline keeps its place and the messages' is the new page's.
  Escape in the Reader gives the focus back to the message, so the arrows
  work again.
- **The buttons at the top of the feed.** ↑ on the message at the top of
  the feed moves the keys onto the header's buttons (Topic settings, New
  message, and the others drawn there, such as "Pipeline & pages" below
  1181px), with the keys' ring on the one they are on. ← and → move along
  them; ← past the first goes to the outline and → past the last to the
  right rail, as from the messages. ↓ selects the first visible card or
  stack in the feed, and Return or Space presses the button. Coming up again finds the
  button the keys were last on. The pointer is unchanged.
- **⌘Return** starts a new message in the place the keys are on, in the box
  the ✎ opens, with the cursor in it: on a topic's row in the outline, that
  topic (opened in place first when it is not the one being read); on an
  outcome's row, its Conversation; anywhere else on a topic or a
  Conversation, the right rail included, the page's own place. In writing
  it stays Send, and it never opens a second box.
- **Where a move leaves the focus.** Return on a row keeps the keys on that
  row, drawn again for the page reached. A press or a tap on a row in the
  outline or the right rail, a link in a message, and back and forward land
  as a load does: the focus is on the page reached, on its heading, which
  wears no ring, so the next key (one that scrolls, say) rings nothing in the
  rails. From there ↑ and ↓ light the messages and ← goes to the outline, as
  on a fresh page. A press on a row whose move goes nowhere (the place
  already being read, or a move the guard refuses) lands the same way, on
  the page's heading; Return on such a row keeps the keys on it.
- **The messages.** On a message (its card holding the keys), ⌘↑ and ⌘↓
  move its reply stack up or down in the reader's own order, → and ←
  open and fold it a step (closed, latest plus unread, then all messages), ⇧⌘↑ and
  ⇧⌘↓ join it to the stack above or below for everyone, and ⌘Z puts the
  last of these back (docs/reply-stacks.md). The keys stay on the message
  that moved, and a screen reader hears what happened.
- **Where the keys do nothing.** In writing (a text field, the Reader, a
  composer) and in a pop-up the keys are the writing's: ⌘← and ⌘→ are the
  line's start and end, ⌘↑ and ⌘↓ the writing's, and no stack moves. A pane not on screen (the
  outline behind "☰ Outcomes" on a phone, the right rail behind "Pipeline &
  pages" below 1181px) is passed over: the keys never open a drawer or a
  sheet. While one is open over the dimmed page, the keys never act on what
  it covers: ← on a folded section of the right rail's panel or sheet closes
  it and goes to the messages, and nothing under it takes the keys. Touch is unchanged; on an
  iPad with a keyboard the same keys work.

## Everywhere

- **Escape**, or ✕, closes the open pop-up and keeps the writing; a click or tap
  outside a pop-up closes it too (`web/dismiss.mjs`, docs/links.md).
- **?** opens this guide.

## The checks that hold these rules

Every act on this page has a row in `tests/acts.json`: the item it shipped
with, a break that stops the act where the code does it, and the check that
must then fail. `tools/acts.py tests/acts.json --evidence DIR` applies each
break, runs its check, and requires the check to fail on it and to pass once
the break is undone (docs/tools.md). A check is named for an act only when its
row is caught; a test file that sits near the act is not a check of it.

The topic page's and the writing's acts are pressed by
`tests/topic_reading_native.mjs`, in Chrome for Testing (`native-reading`) and
Safari's engine (`native-webkit-reading`), at 1280 wide with a pointer and keys
and at 390 wide with touch; each reads what Core then holds, not only what the
page painted. Its checks, by rule:

- The light, ↑ ↓, Return and a phone's two taps: "reading ↑ and ↓ move the
  light, …"; Reply on the bar: "reading Reply on the bar opens the Reader …";
  Tab through the bar and the ⋯ menu: `tests/links_native.mjs` ("header Tab
  reaches a message's ⋯ …", "header a message's ⋯ copies its link …").
- A cut-off message: "reading a cut-off message scrolls in place …". Safari's
  engine in the harness has no finger drag, so there the box is held to scroll
  and to stay under 60% of the window; the drag runs in Chrome.
- 👍: "reading the bar's 👍 and the card's 👍 count …", "reading 👍 in the
  Reader beside Send …" and "reading a thumbs-up an agent gives shows on the
  card …"; the Reader closing on a 👍 given on its quiet line (opened by a
  click, the cursor never in the reply) or with the cursor in the reply, and
  staying open when the 👍 is taken back or Core refuses it: "reading 👍 given
  in the Reader closes it as Send does …"; a 👍 reading its message, with the counts and the New line,
  on a second page and after a reload: "reading a 👍 on an unread message reads
  that message at once …"; a 👍 on a card marked unread, clearing its mark:
  "reading a 👍 on a message marked unread clears the mark …", and in Core
  `tests/test_reactions.py`; an agent's
  `thumb`: `tests/test_agent_verbs_reactions.py`. ✅ and
  🚫: "reading ✅ and 🚫 on a go-ahead ask …"; an agent's `--go-ahead` and what
  `read` says of both: `tests/test_agent_verbs_reactions.py`.
- How cards read (docs/topic-reading.md): "reading read cards sit back on the
  read fill …", "reading the reply arrow says "You replied at" …" and
  "reading replies gather into a stack …"; every act on a reply stack (the
  head's row, rename, Star and the rail's Starred, ⌘↑ ⌘↓, ⇧⌘↑ ⇧⌘↓ and Split
  back out, → ← and ⌘Z, the New line, the Reader's ↑ ↓, the phone's sheet
  and swipe): the "reading stacks …" cases in `tests/stack_native.mjs`
  (docs/reply-stacks.md).
- ⌘C: "reading ⌘C with nothing selected copies the lit message's words …",
  with a selection, the composer and no lit message left to the browser.
- ?: "reading ? and the rail's "? Pointer, keys and taps" open the guide …".
- Images: "reading #img in the topic's composer and in the Reader …" picks
  with ↓ and Return and with a tap, narrows by name, shows each thumbnail and
  takes the #img words out as one edit ⌘Z puts back; "reading Paste image: …"
  opens + and reads the button there, presses it, presses Choose file beside it
  and pastes with ⌘V in Chrome, and in Safari's engine, which tells a page nothing of the
  clipboard, reads Add image. A paste into the Reader and a row's thumbnail:
  `tests/reader_images_native.mjs`.
- ⌥↑ and ⌥↓: "reading ⌥↑ and ⌥↓ move the line …", in the composer and the
  Reader, and "notebook while a card is written, option-Up and option-Down …"
  on the cards page; which line moves: `tests/ui_line_move.test.mjs`.
- The saving sign's time: "reading the save status says when the writing was
  saved …".
- Escape and a press outside a pop-up: `tests/ui_links.test.mjs` and
  `tests/links_native.mjs`.

The keys across the panes are pressed by `tests/outcome_rail_native.mjs`
(`native-rail`, `native-webkit-rail`): "rail the arrows move through the
outline as a tree …", "rail ⇧⌘← and ⇧⌘→ fold and open every outcome …",
"rail ⌘↑ ⌘↓ move an outcome, and a topic within its outcome, …" and "rail
→ and ← move between the outline, the messages and the right rail, …"; where
a move leaves the focus: "rail a press on an outline row puts the focus on
the page reached, …" and "rail a press on a right-rail row that moves in place
puts the focus on the page reached, …", and "rail a press on the row of the
page being read leaves no ring: …"; the steps the arrows take: "rail → on an
open outcome goes into the messages, …" and "rail in the right rail → and ←
open and fold a section without ⌘: …"; the header's buttons: "rail ↑ from
the top message reaches the buttons at the top of the feed, …"; ⌘Return:
"rail ⌘Return starts a new message in the place the keys are on: …". What
each key means, and that none acts in writing: `tests/ui_outline_order.test.mjs`.
