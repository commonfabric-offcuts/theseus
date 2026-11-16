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
  the star in its header (docs/reply-stacks.md) and its bar's buttons, ⋯ last, then on from the message (Shift-Tab from the
  bar's first button comes back to it). Moving the pointer off the messages
  and their bar, or focusing another pane, clears the feed's light. Its last
  message is still remembered for returning with the keys. A rail's old DOM
  focus never draws a second ring while the pointer selects a message;
  using the rail keys gives the light back to that rail. A click on a lit message opens
  it in the Reader.
  A click or a tap in a message, or on its bar, moves the keys' place to that
  message, and one on a dossier's header to the dossier, so ↑ ↓, Return and the
  stack keys go on from there; the pointer moving onto a message or a header
  does the same. Neither scrolls the page. Neither takes the focus from
  writing, a composer's own controls and panels (its who chip and Who sees
  this message, say), an open menu or the Reader, the places the page's keys
  leave alone (`writing` in `web/pane-keys.mjs`); a press on a message's bar
  there acts and leaves the focus where it was. A press that ends selecting words
  leaves them selected. The pointer gives the keys' place only when it really
  moves: the keys moving the page under a still pointer keep theirs, and a
  finger gives it by its tap alone. On a phone a tap lights a message and shows its bar, a
  second tap opens it, and a tap anywhere but a message, its bar or a pop-up lets the
  light go; scrolling keeps it. The bar stays inside the window while any of
  its message is on screen and scrolls away with it. Where a finger presses,
  each of its buttons, and each item of the ⋯ menu, is at least 44px. (`web/message-menu.mjs`)
- **What the keys select comes into view.** Wherever the keys move what is
  selected (the messages' light and a stack act's message, a dossier's
  chevron, the rails' rows, the panes, a deck's cards, an image's choices),
  the whole of what shows as selected comes into view, at once, with no
  animation: a message is its card; a dossier's header (its chevron, or its
  compact header) is the whole dossier, its header and whatever of its body
  shows, or just the header row when it is closed. One that fits the
  scrolling area scrolls the least that shows all of it with a gap of a tenth
  of the area's height on the side it came in from, so what comes next is in
  sight; one fully in view but inside that gap at an edge still scrolls the
  little that opens it; one that fits but not with the whole gap shows whole
  with the gap there is room for; one already a tenth inside does not move.
  One taller than the area lands with its top a tenth below the area's top.
  Going up and going down read the same rule. The scrolling area is the
  nearest box that scrolls (a rail, a drawer), else the window; a page may
  leave a bar it keeps at an edge out of it with CSS `scroll-padding`, which
  nothing sets today. A click, a tap or the pointer resting on a message or a
  dossier selects what it already shows, and the page stays where it is. Scrolls that
  are not the keys moving a selection, such as a page opening at a message or
  the phone's drawer opening on the topic being read, keep their own ways.
  (`web/reveal.mjs`, `shownSelected` in `web/reply-stacks.mjs`)
- **Return**, or **Reply** on the bar (a phone's way), opens the Reader on the
  lit message with the cursor in the reply and nothing quoted; to quote part of
  it, select that part in the Reader and press Return. Return on a selected
  dossier (its header or chevron) edits its title instead, as ✎ does: Return
  saves it and Escape cancels; Space folds and opens the dossier. Return in
  writing, on a folded line or on another control does what it does there.
- **⌘C** (Ctrl-C off a Mac, as ⌘A is, `web/writing-input.mjs`) with no words
  selected copies the lit message's words as written: the message the pointer
  or the keys lit last, the one Return answers, and a cut-off message whole.
  They are the words the Reader's ⇧⌘C copies of the message it shows. Words
  selected anywhere copy as the browser copies them, and in writing or a
  pop-up ⌘C is theirs; with nothing lit it does nothing of the page's. Nothing
  is said when it copies, as in the Reader; a refusal says how else to copy.
- **A cut-off message** (the first 1,024 bytes are shown) reads on in place:
  once the pointer rests on it, the keys light it or a finger taps it, the whole
  card scrolls under the wheel, trackpad or a finger, keeping its height (a
  press already held on its words when the whole message arrives still opens
  it: the words wait for the press to end). The
  author, timestamp and reply context scroll away with the words, in standalone
  messages and stack messages alike. The card's border and dossier title stay
  in place. At either end, scrolling carries on with the page. Where a finger
  scrolls, the excerpt is never taller
  than 60% of the window, so a drag outside the lit message still scrolls the
  page. In a topic or Conversation feed, its ⋯ also offers **Show full
  message**: the one card grows to the whole message, without opening the
  Reader, and the words the reader had scrolled to inside the card stay where
  they were on the screen (the page takes up the card's own scroll). This choice lasts through incoming updates on this page; leaving
  or reloading the page restores ordinary clipping. It is never saved or
  shared with another browser or device. Choosing it is the person's act, so
  a cut-off message is read whole on the server's foreground lane, as ⌘C reads
  it: a slow read ahead on the background lane never refuses it.
  (`web/card-scroll.mjs`, item 401)
- **New message.** A quiet ✎ beside the topic's title opens the topic's
  composer on its own, with no message above it and the cursor in the field;
  Escape, ✕ or a press outside puts it back at the page's end with the writing
  kept. (docs/reader.md)
- **A Notebook page** opens in that sheet, over the feed, from wherever it is
  listed or linked as it stands; ✕, Escape (a second one while a card is
  written) or a press outside closes it, keeping a card half written, and puts
  the feed and the focus back. While it shows the keys and the wheel are its
  own and never move the feed. (docs/decks.md, "Where it opens")
- **👍** means read and understood, never "do it"; pressing it again takes it
  back. It marks that message read at once, even one marked unread, and only
  that one: its card, the counts and the New line follow, here and on every
  page and device the person has open, and taking it back leaves it read
  (docs/thumbs.md). ✅ and 🚫 read their message the same way. The count on a
  message names who: on hover, or where nothing hovers (a
  phone), on the lit message, whose count then reads the names. A press on the
  count thumbs up; a tap on it on a phone lights the message and names who, and
  the bar's 👍 thumbs up. In the Reader 👍 sits on the quiet line and beside Send;
  it shows only your own pressed state, with no aggregate count or other
  readers' names. Those remain on the message: on its card, and in the
  Reader on a quiet line under its words ("👍 2 you, aim-ux"), whether or not
  its card is on the page, as for a message opened from a link (item 406).
  Pressed in either it is a reply of one thumb, and once Core holds it the
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

- **@names.** Writing in the Reader's reply or the topic's composer that
  starts with @ and the name of someone in the topic ("@auditor can you
  look?") goes to them alone by name, in place of the author a reply answers
  or everyone, and a quiet line under the who chip says so as the words are
  typed: "To auditor", or "To fable" and "To everyone here" with no @name.
  An @word naming nobody in the topic stays words and the default stands;
  the @names stay in the message as written. Core records whom the line
  showed, so the person named answers it in place. (docs/reader.md, "Naming
  who a message is to")

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
  topics, Done (N) and Archived (N) and the topics of one open, More and
  + New topic; past an open outcome's last row comes the next outcome, since
  the outline lists no Notebook (its pages are the right rail's). Home and End
  go to the first and last.
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
  opens the Reader. On a stack, → opens it to every message and ← folds it
  to latest plus unread first. Another → when fully open goes to the right
  rail; another ← at latest plus unread goes to the outline. On a message without replies they go
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
- **The buttons at the top of the feed.** These are rows: the
  header's buttons (Topic settings, New message, and the others drawn there,
  such as "Pipeline & pages" below 1181px), on a phone the line under the
  header saying what is new in the other outcomes, and under them the view filters
  in the row just over the messages ("Read it", Only new, Show agent
  coordination), when any of those shows. ↑ on the message at the top of the
  feed moves the keys onto the row just above it, the filters' when they
  show, else the header's, with the keys' ring on the button they are on.
  ↑ from the filters goes on up to the header's buttons, and ↑ there, the
  top row, goes on to what lies above it in the column, if anything (on a
  phone the header wraps, and ↑ from Topic settings or New message reaches
  "Pipeline & pages" above them); ↓ goes back down a row, and from the filters (or
  the header's buttons, with no filter shown) selects the first visible card
  or stack in the feed (with a filter on, the first it shows), or with no
  message yet goes on down the column to the reply. Coming to a
  row finds the button the keys were last on in it, else its first. ← and →
  move along a row; ← past its first goes to the outline and → past its
  last to the right rail, as from the messages, so → from New message goes
  to the right rail, not on to a filter; with no rail on screen that way
  they go on to the nearest control that way, if any. Tab or a click puts the keys on a
  filter as on any button, Return or Space presses the button, and no arrow
  does. The pointer is unchanged. The button the keys
  reach, and the message → or ↓ bring them back to, comes into view by the
  rule above.
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
  switch it between its two states (latest plus unread, and all messages), x
  folds the message to its row for the reader alone (x again unfolds it), ⇧⌘↑ and
  ⇧⌘↓ join it to the stack above or below for everyone, and ⌘Z puts the
  last of these back (docs/reply-stacks.md). The keys stay on the message
  that moved, and a screen reader hears what happened.
- **Put a dossier aside.** Swipe its header or last visible message right,
  on a phone or with two fingers on a trackpad, to move it below More messages
  for you on every device. The menu offers Move below More and Bring back
  above More; ⌘Z undoes it. Your own replies leave it there; a new reply from
  someone else brings it back. Other messages still swipe to fold individually.
- **Where the keys do nothing.** In writing (a text field, the Reader, a
  composer) and in a pop-up the keys are the writing's: ⌘← and ⌘→ are the
  line's start and end, ⌘↑ and ⌘↓ the writing's, and no stack moves. A pane not on screen (the
  outline behind "☰ Outcomes" on a phone, the right rail behind "Pipeline &
  pages" below 1181px) is passed over: the keys never open a drawer or a
  sheet. While one is open over the dimmed page, the keys never act on what
  it covers: ← on a folded section of the right rail's panel or sheet closes
  it and goes to the messages, and nothing under it takes the keys; with the
  keys on nothing, an arrow lands in the rail open over the page. Touch is unchanged; on an
  iPad with a keyboard the same keys work.

## The arrows everywhere

From anywhere outside writing, an arrow lands the focus somewhere that makes
sense, and the arrows reach everything a click reaches (item 301). Where a
pane's own keys above say what an arrow does, they decide. Everywhere else an
arrow that nothing used moves the focus to the nearest button, link or field
that way on screen, as the eye goes: ↓ to what is straight below before what
is a little nearer off to the side, ← and → along the row where something is
beside, else to the nearest that way. What it reaches comes into view by the
rule above. (`web/arrow-reach.mjs`)

- **Past a pane's edge.** ↑ above the outline's first row goes on up the side
  rail: New outcome, "N new" and "N waiting on you", then the logo block (the
  wordmark, "? Pointer, keys and taps", Health, Turn on notifications); ↓
  below its last row reaches Keys. ↑ above the right rail's first section
  reaches its name, "Just this topic" and "All of this outcome". ↓ past the
  last message goes on down the page: More messages, the People row, the
  Notebook and the reply; ↑ from there comes back to the last message. Into a
  tree from beside it (a pencil in a section's heading, the chips above it)
  the arrows land on the row nearest that way, which becomes its stop.
  A control set in a tree's row (the pencil in the right rail's Notebook
  heading) is the row's own, as a card's speech bubble is: → on the row, open,
  gives it the focus before the rows under it; from it → goes on to the first
  of them and ← comes back to the row. A row with no such control keeps the
  tree's → (open a folded row, else go to its first row).
  On a Notebook page's cards, ↑ above the first card and ↓ below the last go
  on to the page's controls (docs/decks.md).
  On a message's bar ← and → move along its buttons, and ↑ and ↓ go on to the
  message above or below, as from the message.
- **In a pane, off its keys.** On the logo block, the chips, Keys, the right
  rail's name and chips, People and the Notebook, ↑ and ↓ move within that
  pane, and ← and → too; past the pane's edge ← and → go on to the pane beside,
  as from the messages.
- **Every other page.** The Outcomes home, an outcome's own page, its pipeline,
  an item, Health and the measurements have no panes: the arrows move between
  their controls. With nothing focused, ↓ goes to the first control in view
  from the top, ↑ to the last, → to the first from the left and ← to the first
  from the right. So it is on a topic or a Conversation with no messages yet,
  where there is no message for ↓ to light. With messages, ↑ and ↓ light one,
  and ← and → go to the pane that way where it shows, else, as here, to the
  first control from the right or the left: on a phone both, and on an iPad
  with a keyboard → (the right rail is behind "Pipeline & pages" below 1181px).
- **On a phone**, in the side rail's drawer, the arrows move as they do beside
  the topic: the outline's rows, New outcome, the chips and the logo block,
  never the page behind the drawer. The drawer opens with the focus on the
  open topic where it shows and is live, never on a copy of it in a list not
  drawn or kept inert while the outline draws its own, so the arrows always
  start there.
- **In a pop-up** (the Reader, Topic settings, the guide, a sheet) the arrows
  move only through it, never to the page behind; a menu, a radio group and a
  picker keep their own arrows.
- **Reading is kept.** A focused box that can still scroll that way (a long
  message in the Reader) scrolls first, a third of what it shows at a time, the
  same in every browser; once at its end the arrows go on (at 390 ↓ through a
  long message reaches the reply below it). From the message's words, → goes
  to the first link in them in sight, and ← from a link with nothing more to
  its left comes back to the words. While the next control that way is out
  of sight, the arrow scrolls toward it, a third of a window at a time, so the
  words between are read on the way; once it shows, the next press lands on
  it. What a box that takes the focus itself has scrolled out of sight lies
  no way of a focus outside that box, as the eye sees: a link scrolled up out
  of the Reader's message is not above its header, and ↑ from the header
  leaves the message where it was read to. The arrows reach such a control
  from the box: the box scrolls, and → goes to the link once it shows. A box
  that takes no focus is no such way in, so what it has scrolled out of sight
  lies where it is drawn, and is scrolled toward: in a reply's review, with
  versions taller than its box, ↓ from Keep both for now below scrolls the
  versions toward the acknowledgement and Prepare this reply again, and ↑
  then reaches them. From a control
  in a box that scrolls, the box scrolls toward the next one out of sight in
  it, and the focus scrolled out of the box meanwhile is where it went out, on
  the box's edge, never over what lies past it.
- **A control pressed, not typed in.** A checkbox ("Mark it reached anyway"
  in the reach box, the acknowledgement in a reply's review) holds no arrow,
  as a button holds none: each goes on to the control that way. A select (the
  agent a card's ask goes to) keeps ↑ and ↓, which choose among its options;
  ← and → go on along its line. A radio group and a slider keep their own.
- **Never in writing.** In a field the arrows are the writing's, as everywhere
  above, but for ↑ and ↓ in a one-line field (a title, a name, a pipeline's
  "Add an item…"), which has no line above or below its own, and every arrow
  in a field with nothing written in it (an empty reply, an outcome's "Write
  the target"): they go on to the control that way, so a field the arrows land
  in never holds them, and the + beside an empty reply is a ← away. In words ←
  and → stay the writing's, and so do ↑ and ↓ in a box with words in it; a
  field that offers suggestions (a name to pick from a list) keeps its arrows
  for those.

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
  what the keys select coming into view: "reading ↓ and ↑ down a long feed
  bring each message fully into view …" (with the click, the tap and the
  pointer resting near the bottom scrolling nothing) and "reading a dossier
  taller than the window, its header selected by ↓ or by ↑, …" and "reading
  a dossier showing its whole first message, its chevron selected by ↓, …", at
  both widths in both engines; the #img list: "reading #img: ↓ and ↑ through a
  long list of images …"; the rails, the header's buttons and the way back
  into the messages: "rail what the keys select comes into view …"
  (`native-rail`, `native-webkit-rail`); a deck's cards, under every key that
  leaves a card picked, and a click scrolling nothing: "notebook on the cards
  page, every key that leaves a card picked …" (`native-notebook`,
  `native-webkit-notebook`); the rule's geometry, the scrolling area and its
  `scroll-padding`: `tests/ui_reveal.test.mjs`;
  a click, a tap or the pointer moving giving the keys' place, and not from
  writing or a composer's panel, nor by a press on the bar while writing,
  under keys moving a still pointer, or by touch: "reading stacks a
  click or a tap in a message moves the keys' place there …" and "reading
  stacks the pointer moving onto a message or a dossier gives it the keys'
  place …"; Return on a dossier: "reading stacks Return on a selected dossier
  edits its title …";
  Tab through the bar and the ⋯ menu: `tests/links_native.mjs` ("header Tab
  reaches a message's ⋯ …", "header a message's ⋯ copies its link …").
- A cut-off message: "reading a cut-off message scrolls in place …", and a
  press held on it as its whole message arrives: "reading a press held on a
  cut-off card while its whole message arrives still opens it …". Safari's
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
  head's row, rename, Star and the rail's Starred, Fold and Unfold, ⌘↑ ⌘↓, ⇧⌘↑ ⇧⌘↓ and Split
  back out, → ← and ⌘Z, the New line, the Reader's ↑ ↓, the phone's sheet
  and swipe, the trackpad's two-finger swipe): the "reading stacks …" cases in `tests/stack_native.mjs`
  (docs/reply-stacks.md).
- ⌘C: "reading ⌘C with nothing selected copies the lit message's words …",
  with a selection, the composer and no lit message left to the browser; a
  cut-off message's whole words are read as the person's act, so they copy
  while the server's background lane is busy.
- Show full message on a busy lane: "reading Show full message shows the whole
  message while the lit card's read ahead is slow …" holds that read ahead in
  the server and needs the whole message shown.
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
- @names: "reading a leading @name says who the writing goes to as it is
  typed …" (the line in the composer and the Reader, its default, an @word
  naming nobody) and "reading a reply to someone else's message that starts
  with @name is recorded to that member …" (what Core then holds); the rule:
  `tests/ui_at_names.test.mjs`, and in Core `tests/test_at_names.py`, both
  reading `tests/fixtures/at_names.json`.
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
the top message reaches the buttons at the top of the feed, …", and the
filters' row under them: "reading coordination the keys go on from Show agent
coordination: …" and "reading coordination ← and → move along the filters'
row, Read it among them, …" (`native-reading`, `native-webkit-reading`, at
both widths) and "conversation the keys go on from Only new: …"
(`native-conversation`); ⌘Return:
"rail ⌘Return starts a new message in the place the keys are on: …". What
each key means, and that none acts in writing: `tests/ui_outline_order.test.mjs`.

The arrows everywhere are pressed by `tests/outcome_rail_native.mjs`
(`native-rail`, `native-webkit-rail`), each case marking every control on show
and pressing every arrow from each, natively, to show the arrows reach them
all and none loses the focus to the page: past the outline's edges, "rail
arrows ↑ above the outline's first row goes on up the side rail …"; the right
rail's chips, "rail arrows ↑ above the right rail's first section reaches …";
below the messages, "rail arrows ↓ past the last message goes on down the page
…" (at 1280, 390, 375 and 320); the bar, "rail arrows on a message's bar ← and
→ move along its buttons, …"; the pages with no panes and a one-line field,
"rail arrows on the Outcomes home, an outcome's page, its pipeline and its
Conversation, …" (at
1280, 390, 375 and 320); a Notebook page's cards, "rail arrows on a Notebook
page's cards ↑ above the first card …"; a control out of sight, "rail arrows
a control out of sight is scrolled toward …"; the phone's drawer, "rail
arrows on a phone, in the side rail's drawer, …"; the pop-ups, "rail arrows in Topic settings and the
Reader move between their controls …"; writing, "rail arrows in writing
are the writing's: …"; a checkbox, "rail arrows from the reach box's
checkbox …" (and the review's acknowledgement in "navigation correction
retry chain …", `native-navigation`); a select, "rail arrows in a card's ask
form …"; and a topic and a Conversation at every width, the header's top row
and nothing focused among them, "rail arrows on a topic and a Conversation …"
(at 320, 375, 390, 820, 1024 and 1280). Each case that marks every control
also fails on a press that leaves the focus where it was while a control lies
straight that way (in sight, or out of sight only by the page or a box the
focus is in), unless the press acted there (opened or folded something,
switched a stack, or said so in a live region). Where an arrow lands by the geometry, and which arrows a
form control keeps: `tests/ui_arrow_reach.test.mjs`.
