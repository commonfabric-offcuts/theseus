# Reply stacks

A topic page reads as stacks: a message, every loaded reply to it, and the
replies to those, gathered into one stack. A stack reads as a chat does, its
first message on top and its replies under it oldest first. The topic's
stacks sit newest activity on top, unless the reader has put one somewhere
else; the reader's own reply never moves its stack. This page holds the
contract: what Core records, how the page orders and folds what it shows,
and the one layer that decides how a stack looks.
docs/topic-reading.md says how a card reads inside a stack, and
docs/interaction.md has the keys.

The code:

- `aim_next/stacks.py`: Core's records, commands and views.
- `web/stack-order.mjs`: the pure decisions about what goes where (no page).
- `web/reply-stacks.mjs`: draws those decisions into the page, keeping each
  card's node.
- `web/stack-feed.mjs`: what the person does to a stack. It shows the act at
  once, sends it to Core in order, and holds ⌘Z, the keys, the ⋯ items and
  the swipe.
- `web/stack-look.css`: how a stack looks, and nothing else does.

## What Core records

A message never changes. Each act about a message is a new row in
`message_acts`, recording who acted, when, and what the act now stands at.
Nothing is overwritten, so every rename and every join can be read back.
Schema version 35 adds the table. Stepping back to 34 is refused once any
row exists, because dropping rows would restart their revisions.

| Act | Command | Value | Whose |
| --- | --- | --- | --- |
| star | `message.star` | `{"starred": true}` | the reader's own |
| deal | `message.deal` | `{"dealt": true}` | the reader's own |
| place | `stack.place` | `{"key": 1.5}` or `{"key": null}` | the reader's own |
| name | `stack.name` | `{"name": "Cabin week"}` (empty gives back the first line) | the topic's |
| join | `stack.join` | `{"into": "m-…"}` or `{"into": null}` (split back out) | the topic's |

Each act names one message, `target: {"message_id": "m-…"}`, and is fenced on
the revision its sender read: `expected: {"star_revision": 3}` (and likewise
`deal_revision`, `place_revision`, `name_revision` and `join_revision`). An
act's revision counts its rows for that message, kind and owner. A late
request is refused with `REVISION_CONFLICT`, and the refusal carries the
current revision. Sending a value the act already stands at records nothing
and answers `changed: false`. An answer carries the value, the new revision,
`changed` and, when it recorded a row, `acts_version`.

These rules refuse an act:

- `FORBIDDEN` for a message the sender cannot read: a whisper they are not
  in, or a topic they are not on.
- `INVALID_ARGUMENT` for a value of the wrong shape. This covers a name that
  runs over 200 characters (its spaces and line breaks are first folded to
  single spaces), and a place that is not a finite number within ±10¹⁵.
- `INVALID_ARGUMENT` for a join into another topic, into the stack itself, or
  into a stack inside it (a loop, followed through joins and replies).
- `OUTCOME_REACHED` for a name or a join once the topic's outcome is reached;
  a star, a deal or a place is still the reader's to make.

Who hears of an act depends on whose it is. A personal act reaches only its
reader. A shared act reaches everyone who reads the message, so a whisper's
acts reach its two people only. Either way it arrives as an actor-scoped
change, `acts`, keyed by the topic, at the act's row id. Nothing moves in a
topic's or outcome's scope, so no count, light, activity time or "new"
changes.

Reads:

- Each `topic_messages` item carries `acts`: `starred`, `dealt`, `placed`,
  `name` (`{text, by, at_ms}` or null) and `joined` (`{into, by, at_ms}` or
  null), each with its revision.
- `message_acts {topic_id, cursor?, limit?}` pages the topic's messages that
  have any act, newest first, with `version`, the newest act the reader hears
  of. The page reads it when an `acts` change arrives.
- `stars {cursor?, limit?}` lists the reader's starred messages in every
  place they read, newest star first. The right rail's Starred is drawn from
  it.

## Display order

All of this is decided in `web/stack-order.mjs`, from the messages loaded and
their acts.

- **Gathering.** A message's parent is the message it was joined into, when
  that one is loaded. Otherwise it is the message it answers, when loaded.
  Otherwise it heads its own stack. A loop, which joins made by different
  people can form, is cut at its newest message.
- **Inside a stack.** The replies run oldest first, by sequence. A joined
  stack's messages follow, as one run, in the order the joins were made, its
  first message preceded by a line: "Joined from its own stack by …, time"
  with Split back out.
- **The stacks.** Each stack sorts by its key, newest first. The key is the
  reader's place if they set one, or else the sequence of the newest message
  in it that lifts it: any message but a reply of the reader's own. A new
  stack therefore lands on top, the reader's own included, and a new reply
  by anyone else lifts its stack unless the reader placed it. The reader's
  own reply leaves its stack where it was, on every device and after a
  reload, so what they answered stays where they were reading it; for
  everyone else it lifts the stack as any reply does. A stack joined to
  another counts for it whoever began it, so a join still puts the two
  where the newer would sit. ⌘↑ and ⌘↓ set a place halfway past the neighbour.
  When no number fits between two places, the two stacks trade keys. A
  placed stack says "Placed here by you", and "Let new replies move it"
  takes the place away.
- **Folding.** A stack has exactly three states, shared by its chevron,
  keyboard commands, header and menu:
  - Head (↑): the header only, with no message body or reply line.
  - Folded (→): the latest reply plus unread replies, each shown once.
    The original message is not shown here. Stars and joins do not force
    additional read messages into this view.
  - Open (↓): the original message and every reply.

  Replies that were unread when drawn stay in view while being read, so
  reading them does not make them vanish. Explicitly changing state, or
  coming back to the page with a stack off screen, lets go of that snapshot.
  A newer reply replaces the previous latest if that previous reply was
  already read; read asks and stars do not add exceptions to latest plus unread.
  Coming back also returns off-screen fully open stacks to the partial view.
- **Expand and collapse.** One chevron beside the title cycles ↑ → ↓ → ↑.
  It is a button reachable by Tab and operable by Return or
  Space, with `aria-expanded` and a label naming the stack. The header already
  gives the reply and new counts; no repeated count or fold bar sits between
  the messages. Its accessible label describes the current state and next
  action; `aria-expanded` is false only in the header-only state.
- **The head.** The first message is one compact row: its short name, ✎,
  who began the stack, "New" when the message itself is new, ★ if starred,
  how many replied and who, and how many replies are new. On a phone the
  count, who replied and what is new sit on a second short line. The short name is the
  one someone typed, or else the first line of the first message. Pressing
  the row opens the entire stack; pressing it again returns to latest plus
  unread. The original message has no independent open/closed state.
  A message that stops
  heading a stack, joined into another or left with no replies, loses the
  row at once and reads as a card.
- **Replying.** Use Reply on the message's bar, or Return on the selected
  message, to open the Reader with its reply composer. Stacks have no
  input-looking reply strip: that control opened the modal rather than
  accepting writing in place, so Tony asked to remove it.
- **Stable presses.** Anything that arrives while a press is held—a new
  message, a stack repaint, reactions or the New line—waits until the press
  ends, then shows at once (`web/press-hold.mjs`). The header and people
  repaint in place.
- **The bar.** A head showing only its row has no message bar; Return
  still replies to it, and the bar comes back once its whole message shows.
  In a stack the bar stays below the head row's bottom edge while that row
  is in the window; where that leaves no room above a card's reply arrow, the
  bar sits under the card rather than over its words and answers. Once the
  row has gone above the window, the bar scrolls away with its card, as any
  message's bar does. A lit reply that its stack folds away loses its light
  and its bar, so no message bar is left over the stack's chevron.
- **One New line.** It goes under the lowest stack that holds the line's
  message or anything newer that is not the reader's own (`lineUnder`). It is
  never inside a stack, and nothing new sits below it. While the line's
  message is not loaded, the line waits at the bottom (docs/topic-reading.md).
- **Reading order.** The Reader's ↑ and ↓ follow the page from top to
  bottom (`readingOrder`). They go down a stack through its replies to its
  newest, then on to the stack below.
- **Fold steps.** → steps from header only to latest plus unread to all
  messages. ← goes back the same way, whether the keys are on the header
  or a reply or the chevron. Another → when fully open moves to the right
  siderail; another ← when closed moves to the left siderail. A hidden rail
  stays hidden. Each stack step can be undone with ⌘Z.

Each viewer has their own order and folds, because they come from that
viewer's places and the page's own state. Names and joins are the topic's,
the same for everyone. A star is the reader's alone, and only they see it,
on the card and in the rail.

## Doing it

On a message (its card focused, never in writing), these keys work:

| Keys | Act |
| --- | --- |
| ⌘↑ ⌘↓ | move its stack up or down, for you alone |
| → ← | open or fold its stack a step, then move to the siderail at that end |
| ⇧⌘↑ ⇧⌘↓ | join its stack to the stack above or below, for everyone |
| ⌘Z | undo the last of these |

The keys come from the shared key map (`web/pane-keys.mjs`), so the
outline and the messages read one set of keys.

The ⋯ menu offers:

- Star for me (or Unstar)
- Rename (on a head)
- Show or Hide the full message
- Fold into earlier replies
- Split back out (on a joined stack's first message)
- every move above, each naming its keys

The right rail's Starred lists the reader's stars, this place's first and
then Elsewhere. A press lands on the message, opening its stack if it is
folded, and Unstar beside each takes the star off.

On a phone, ⋯ opens as a sheet from the bottom, and the moves sit behind
"Move or join…", which opens a second sheet. A reply swiped to the right
folds into the earlier replies; a drag that starts on something scrolling
sideways, such as a wide table or a block of code, scrolls it instead. A right-click (a long press on Android)
opens the same menu.

A card that a join, a move or a new reply carries to another place keeps
where it was scrolled: a table scrolled sideways, or a long message scrolled
in its card, stays as it was, and the page keeps its place.

Every act shows at once, then goes to Core with the revision the page holds.
Acts are sent one at a time, in order. Until Core answers an act, the page
draws it over what Core holds, so a quick run of presses always shows the
last one. Each act the page holds is the later by its revision of what it
knew and what it reads, so an answer read before a commit puts back nothing,
whenever it lands. When an answer changes what a stack shows, the page draws
it again. A refusal reads the acts back and draws what Core holds. A screen reader hears each act said ("Moved up",
"Joined to the stack above").

## The look

`web/stack-look.css` is the only place where stacks get their look. It reads
the semantic colour tokens of `web/aim.css` and only the names that
`web/reply-stacks.mjs` sets:

- `.reply-stack`: a stack. It carries these attributes:
  - `data-stack`: its head's id
  - `data-seq`
  - `data-fold`: head, folded or open
  - `data-head-open`, `data-placed`, `data-single`, `data-renaming`
- Inside the stack:
  - the head's entry, with its card marked `.stack-head-card` and holding
    `.stack-head`. The row's parts are `.stack-name`, `.stack-pen`,
    `.stack-who`, `.stack-new`, `.stack-star`, `.stack-meta` (with
    `.stack-repliers` and `.stack-fresh`) and `.stack-hide`.
  - `.stack-rename`, holding `.stack-rename-input` and `.stack-rename-hint`.
  - `.stack-toggle`, the header's native expand/collapse button, a sibling of
    the message button, with `aria-expanded` and `aria-controls`.
  - `.stack-replies`, with each reply's entry and `.stack-join-line`
    (`.stack-join-words` and `.stack-split`).
  - `.stack-placed-line`, with `.stack-placed-words` and `.stack-unplace`.
- `[data-starred=true]` on any card the reader starred.

Another look replaces that one file. Nothing in the drawing code chooses a
colour, a border or a spacing. The look now is the Dossier: a stack is one
folder pressed into the page. Its head row is the folder's tab, two lines high,
with the short name on the first and who started it, how many replied, who
and what is new on the second; the tab and the body are one cut, joined by a
curved corner. A compact chevron sits beside the name. The replies are the
sheets inside, each card in its own colours; folded replies draw no extra bar.
Shown whole, the head's card is the first
sheet; while the stack is renamed, the field takes the tab's place. Only one
current target has the strong ring: a message, or the whole folder when its
compact header or a stack control is selected. The enclosing stack does not
also light up for a selected message. Stale keyboard focus, unread state and
hover on an unselected message do not get another strong border. A placed message
on its own is a folder with no tab. The folder ends after its messages and
any placement control, with no reply strip or empty footer. Under Only new
the stacks draw nothing.

## Checks

| What | Where |
| --- | --- |
| Core's acts | `tests/test_stacks.py` |
| the migration | `tests/test_migrations.py` (`StacksStepCase`) |
| the display order | `tests/ui_stack_order.test.mjs` |
| on the page, in Chrome and in Safari's engine | `tests/stack_native.mjs`, the "reading stacks …" cases of `--reading` |
| a press held, and each way it ends | `tests/ui_press_hold.test.mjs`; in Chrome, `tests/stack_native.mjs`, "reading stacks a press ends however it ends …" |
| a scroll carrying on with the page at a long message's edge | `tests/topic_reading_native.mjs`, "reading a cut-off message scrolls in place …" |
| the older stack case | `tests/topic_reading_native.mjs`, "reading replies gather into a stack …" |

`tests/acts.json` names the break each act must catch.

Not yet:

- On iPhone a long press opens no menu, because Safari sends no context menu
  for it; ⋯ is the way there.
- A head shown as one row has no room for its reply arrow. The reply sits
  in the stack under it.
- Archive, Make it a heading, Edit and Lift out come with the next piece.
