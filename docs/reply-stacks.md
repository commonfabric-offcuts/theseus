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

Up and Down visit each dossier header as well as its visible messages. In
the fully expanded state the header is a separate stop before the original
message; at latest plus unread the compact header already serves as that stop.
Down from the page header enters the first dossier header. The dossier owns
the strong outline there, and message actions appear only on message stops.
A chevron that holds the focus without being a stop (Tab or a click onto it,
or Space that just folded the dossier) stands for the dossier's
compact header, so Up and Down move on from that dossier.

The code:

- `aim_next/stacks.py`: Core's records, commands and views.
- `web/stack-order.mjs`: the pure decisions about what goes where (no page).
- `web/reply-stacks.mjs`: draws those decisions into the page, keeping each
  card's node.
- `web/stack-feed.mjs`: what the person does to a stack and its messages. It
  shows the act at once, sends it to Core in order, and holds ⌘Z, the keys,
  the ⋯ items, the phone's swipe and the trackpad's.
- `web/stack-look.css`: how a stack looks, and nothing else does.
- `web/message-preview.mjs`: a message shown by one line (below).

## What Core records

A message never changes. Each act about a message is a new row in
`message_acts`, recording who acted, when, and what the act now stands at.
Nothing is overwritten, so every rename and every join can be read back.
Schema version 35 adds the table. Stepping back to 34 is refused once any
row exists, because dropping rows would restart their revisions. Version 37
lets the table hold a fold. SQLite changes the kinds a table takes only by
building it again, and the step keeps every row, its id, and where the next
id goes on from. Stepping back to 36 is refused once anyone has folded a
message, even one unfolded since.

| Act | Command | Value | Whose |
| --- | --- | --- | --- |
| star | `message.star` | `{"starred": true}` | the reader's own |
| deal | `message.deal` | `{"dealt": true}` | the reader's own |
| fold | `message.fold` | `{"folded": true}` | the reader's own |
| place | `stack.place` | `{"key": 1.5}` or `{"key": null}` | the reader's own |
| name | `stack.name` | `{"name": "Cabin week"}` (empty gives back its first message's line), or an agent's `{"name": "Cabin week plan", "minted": true}` (below, "Minted names") | the topic's |
| join | `stack.join` | `{"into": "m-…"}` or `{"into": null}` (split back out) | the topic's |

Each act names one message, `target: {"message_id": "m-…"}`, and is fenced on
the revision its sender read: `expected: {"star_revision": 3}` (and likewise
`deal_revision`, `fold_revision`, `place_revision`, `name_revision` and
`join_revision`). An
act's revision counts its rows for that message, kind and owner. A late
request is refused with `REVISION_CONFLICT`, and the refusal carries the
current revision. Sending a value the act already stands at records nothing
and answers `changed: false`. An answer carries the value, the new revision,
`changed` and, when it recorded a row, `acts_version`.

`message.fold_through` (item 472) folds a message and every message before it
in its dossier, for the reader, as Option with a swipe right does. It names one
message, takes no args, and is fenced on that message's `fold_revision`, as its
fold is. Core finds the dossier's first message, as it does to place and name
the dossier, and folds the first message, every message the reader can see
that is older than the named one, and the named one, whether or not the
reader's page has loaded them. Each fold is the row `message.fold` writes, at
that message's next revision, all in one transaction. A starred message, and
one already folded, gets no row. The messages after it, a whisper the reader
is outside, and everyone else's folds are untouched. The reader alone is told,
once, at the last row. The answer gives the named message's `folded` and
`fold_revision`, `changed`, and `folds`: each message it folded, oldest first,
with the `fold_revision` that left it folded, so ⌘Z can unfold each one.

These rules refuse an act:

- `FORBIDDEN` for a message the sender cannot read: a whisper they are not
  in, or a topic they are not on.
- `INVALID_ARGUMENT` for a value of the wrong shape. This covers a name that
  runs over 200 characters (its spaces and line breaks are first folded to
  single spaces), and a place that is not a finite number within ±10¹⁵.
- `INVALID_ARGUMENT` for a join into another topic, into the stack itself, or
  into a stack inside it (a loop, followed through joins and replies).
- `STACK_CHANGED` for a name on a message that is not the first message of
  its dossier, as the sender's Core finds it through joins and replies. A
  name is the dossier's, wherever it was typed: the page sends it to that
  first message, loaded or not, fenced on the name revision Core sent with
  the position of each message in the dossier (docs/dossier-below-more.md).
- `OUTCOME_REACHED` for a name or a join once the topic's outcome is reached;
  a star, a deal, a fold or a place is still the reader's to make.
- For a minted name: `INVALID_ARGUMENT` unless it is two to five words and
  `minted` is `true`; `ALREADY_NAMED` once anyone ever named the dossier, a
  mint included; `NOT_THE_NAMER` from anyone but its namer, or before a reply
  on the record has landed in it. Each is checked after the revision fence.

Who hears of an act depends on whose it is. A personal act reaches only its
reader. A shared act reaches everyone who reads the message, so a whisper's
acts reach its two people only. Either way it arrives as an actor-scoped
change, `acts`, keyed by the topic, at the act's row id. Nothing moves in a
topic's or outcome's scope, so no count, light, activity time or "new"
changes.

Reads:

- Each `topic_messages` item carries `acts`: `starred`, `dealt`, `folded`,
  `placed`, `name` (`{text, by, at_ms}`, with `minted: true` for a minted
  name, or null) and `joined`
  (`{into, by, at_ms}` or null), each with its revision.
- `message_acts {topic_id, cursor?, limit?}` pages the topic's messages that
  have any act, newest first, with `version`, the newest act the reader hears
  of. The page reads it when an `acts` change arrives.
- `stars {cursor?, limit?}` lists the reader's starred messages in every
  place they read, newest star first. The right rail's Starred is drawn from
  it.
- `stack_namer {message_id}` says who names the dossier a message is in:
  `root_id`, `name`, `name_revision` (the fence a mint is sent on), `namer`
  (an actor or null) and `why` (below).

## Minted names (479)

When the first reply on the record lands in a dossier nobody has named, its
namer writes a short name for it, two to five words for what it is about, as a
`stack.name` act with `minted: true`. The namer is the outcome's coordinator
when Core sends it the dossier's replies: an agent, enabled, taking part in
the dossier's topic. Otherwise (no coordinator, a person coordinating, a
coordinator switched off, or one outside the topic, as in one started with
`start OUTCOME --with`) it is the first agent that replied, whose own reply
tells it. With no agent reply the dossier keeps its first line. A name a
person types wins and is never replaced: once anyone has named a dossier, even if they cleared the
name since, it is never minted, and a dossier is minted once, so a second
reply mints nothing more. A whisper counts as no reply, since a name is
everyone's, and a dossier whose first message is a whisper is never minted.
A minted name is a deliberate act of its agent, never a side effect of
showing a dossier: Core stores nothing else for it.

Core decides it all (`dossier_namer` in `aim_next/stacks.py`): `why` is
`named`, `unreplied`, `coordinator`, `first_agent` or `no_agent`, and a mint
from anyone but the namer is refused as above. A mint is fenced on the name
revision its agent read when it was told to name the dossier, so a person's
rename that lands while the agent is choosing its words refuses the mint
(`REVISION_CONFLICT`), and the person's name stays on the dossier's first
message; sent again on the new revision, it is `ALREADY_NAMED`. A mint names
the dossier's first message only (`STACK_CHANGED` otherwise), as any name does.
Names stored before minting existed carry no `minted` and read exactly as they
did. The schema is unchanged.

The agent harness produces the mint. A delivery of a reply to an agent that
names its dossier carries `name_it: {root_id, name_revision}` (the dossier's
first message's own delivery leaves it to its replies', and with an agent
coordinating, finding the namer reads two rows, not the dossier), so the hosted
notice adds to that delivery's line `its dossier has no name and you name it:
mint ROOT --expected N "two to five words"`, and `inbox` and `watch` add
`[you name its dossier: mint …]`, `inbox` and the notice once per dossier
(`aim_next/hosted_notice.py`, `aim_next/cli.py`). A coordinator is told on
the first reply it is sent. An agent whose own `reply` makes it the namer is
told the same after `posted …`. The agent runs `mint MESSAGE --expected N
WORDS` (docs/agent-cli.md), whose words its model writes. The checks drive this
with a fake coordinator that reads the notice and mints fixed words through the
CLI (`tests/test_dossier_names.py`, `FakeCoordinator`), so no live model is
needed.

On the page the tab's second line says "Named by" and the agent, after who
began the dossier and the marks of what its first message carries
(`.stack-named`), whole at every width down to 320 pixels: short of room who
replied, what is new, the marks and who began it give way first, and the count
always shows (The head, below). The name's tooltip says it was named
when the first reply landed. Renaming starts from the minted name; a name the
person types replaces it and the mark goes, and their name says who typed it
in its tooltip, as any typed name does. ⌘Z after such a rename gives the
dossier back the minted words as the person's own name: only its agent mints.

## Display order

All of this is decided in `web/stack-order.mjs`, from the messages loaded and
their acts.

- **Gathering.** A message's parent is the message it was joined into, when
  that one is loaded. Otherwise it is the message it answers, when loaded.
  Otherwise it heads its own stack. A loop, which joins made by different
  people can form, is cut at its newest message.
- **One dossier, one stack (item 550).** Where a dossier's fork sits above
  what the page has loaded, each reply made under the fork (every reply
  straight under the dossier's first message is one) heads a branch of its
  own by the rule above. Core's position on each message names the
  dossier's first message (docs/dossier-below-more.md), and the branches
  that name one are one stack: one tab, one name, one count, every loaded
  reply in it oldest first. They go into the stack that holds that first
  message where the page has loaded it (two runs of the page with a gap
  between them can hold it and not the fork), and otherwise gather under
  the oldest of their heads. A dossier whose first message heads its stack
  reads as it did, two dossiers are two stacks whatever is loaded of each,
  and Earlier messages, loading the fork and then the first message, leaves
  the dossier one stack under the oldest message loaded. A stack whose own
  join or split the page has not had answered carries the positions Core
  read before it, which name the dossier it left: it gathers nothing by
  them and takes none of that dossier's name (`moving` in the page's shown
  messages, `stack-feed.mjs`). A reader's own reply among the branches
  leaves the stack where it was, as in any stack (The stacks, below).
  The stack is the dossier's whichever message heads it: when Earlier
  messages loads a reply older than its head made under the first message,
  or the first message itself, that message heads it from then on, and the
  stack stays as the reader left it, open or folded, its earlier-messages
  row opened or not, the seven it shows held (`reheaded`,
  `stack-order.mjs`), and where the reader placed it (The stacks, below).
- **Inside a stack.** The head stays first. Every other message in the
  stack runs oldest first, by sequence, as one run: the head's replies, each
  joined stack's messages, the replies to those, and stacks joined to a
  joined stack. A join makes two stacks one, so a new reply to any message
  in it lands at the bottom. A joined stack's first message keeps a line
  just before it, wherever it falls: "Joined from its own stack by …, time"
  with Split back out. The latest reply in latest plus unread, the New
  line, what counts as new, the Reader's ↑ and ↓ and the phone all read
  this one run. A join changes no message, only the display, so Split back
  out puts both stacks back exactly as they were. A stack's key is unchanged:
  its newest message that lifts it (below), whichever stack it came from.
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
  A place is the dossier's, as its name is (item 550): it is kept on its
  first message, loaded or not, fenced on the place revision Core sends with
  each message's position (docs/dossier-below-more.md), so the dossier holds
  it whatever of it the page loads. A page whose Core sends no place in the
  positions places the stack's head. Before item 550 a stack headed by a reply
  was placed on that reply; while the first message carries no place, such a
  place still places the stack, and "Let new replies move it" takes it away
  with the first message's.
  When no number fits between two places, the two stacks trade keys. A
  placed stack says "Placed here by you", and "Let new replies move it"
  takes the place away.
- **Folding.** A stack has exactly two states, shared by its chevron,
  keyboard commands, header and menu (item 394 took away the header-only
  state, now that a swipe moves a dossier out of the way):
  - Folded (→): the latest reply plus unread replies, each shown once.
    The original message is not shown here. The reader's own starred
    replies also show here, read or not (item 413). Joins do not force
    additional read messages into this view; a join the reader makes opens
    the stack it went into instead (see Doing it).
  - Open (↓): the original message and every reply; a dossier of more than
    seven messages shows its newest seven and one row for the rest
    (Earlier messages, below).

  A stack whose replies are all read shows its latest reply and the reader's
  starred replies when folded. A quiet agent dossier (below, 359) still begins as its header
  alone; its first step opens it to latest plus unread, and only ⌘Z right
  after takes it back there. A stack left at its header that is no longer
  agents' alone (a reply to the person arrived, say) shows latest plus
  unread (`levelOf`).

  Replies that were unread or starred when drawn stay in view while being
  read or unstarred, so reading them or taking a star off them, here or on
  another device, does not make them vanish under the reader: the keys and
  the light stay on such a reply. Explicitly changing state, or coming back
  to the page with a stack off screen, lets go of that snapshot.
  A newer reply replaces the previous latest if that previous reply was
  already read and not starred. The reader's starred replies remain visible
  in their chronological places in latest plus unread, including after a
  reload; once the star is off, an older read reply hides again at the next
  change of the stack's state, on coming back, or after a reload. This uses
  that reader's existing acts, never another reader's stars. Read asks do not
  add an exception. An agent-only dossier's explicit header-only state is
  unchanged; opening it to latest plus unread applies the same star rule.
  Coming back also returns off-screen fully open stacks to the partial view.
- **Folded messages.** A message the reader folded stays folded for them, on
  every device and after a reload, until they unfold it; nobody else's view
  changes. Wherever its stack shows it, at every state, fully open included,
  and on its own, it is one row: who wrote it, its line (One line of a
  message, below), a 👍, and "Folded". The row is all of the card that draws,
  on a phone by touch as on a laptop: nothing of its words, a cut-off message's
  excerpt and its cue included, shows past it (item 546). The 👍 is the message's thumbs-up,
  as its bar's: pressed once given, with the count once anyone has, and a press gives or takes it back
  without unfolding the message (none on the reader's own message). It is a
  button named "Thumbs up" or "Remove thumbs up" (with the count), with that
  tooltip; on a laptop Tab from the selected row reaches it (Safari's
  Option-Tab is left to the browser, as for the bar's buttons), and on a phone
  it is 44 pixels square. A fold never shows or hides a message; the stack's state alone
  does that, and changing the state leaves every fold as it was. A press on
  the row unfolds it (one tap on a phone, where a tap on a card otherwise
  lights it first). A star keeps a message in view: a starred message is
  never folded, ⋯ offers it no Fold, and starring a folded message unfolds
  it. In a dossier (item 471) the row is who wrote it and its line alone:
  "Folded" is said to a screen reader but not drawn, the 👍 shows only once
  someone has given one, and the message bar does not attach to the row (a
  right-click opens its ⋯, and a press unfolds it). A message on its own, a
  placed one included, keeps its "Folded" and its 👍.
- **Inside a dossier (item 471).** A message shown whole keeps its agent
  name's badge, as it had before; a folded row's name is plain words. A press on the header
  of a message the dossier shows whole (who wrote it and when) folds it for
  the reader alone, as x does; a starred message stays open, and says so. Its
  words, its bar and Return open the Reader, and a control in the header (the
  star, the reply arrow) answers its own press. On a phone the first tap
  lights the message, as on any card, and a tap on the header after it
  folds it. On a message on its own a press on the header opens it, and on
  an agent's name opens its colour picker, as before; inside a dossier the
  colour is chosen from the participants.
- **Dealt with, folded (item 377).** A person's reply to a message (its
  `reply_to` names the message, ✅ or 🚫 on a go-ahead ask included, and
  their reply to their own message too), or their thumbs-up on it, folds it
  for them, as their Fold would: Core records their own `message.fold` in
  the same transaction as the reply or the thumb (`Stacks._fold_answered`),
  so every page, device and the CLI agree. Nobody else's view changes, and
  an agent's reply or thumb folds nothing. A starred message never folds
  this way, and one already folded stays as it is (no new row). Taking the
  thumb back unfolds nothing; a message unfolded later folds again on the
  person's next reply or thumbs-up. On the page the row shows where the
  message was, the feed keeps its place and the keys stay where they were;
  a Reader open on the message keeps showing it whole, and closing it
  leaves the keys on the folded row. ⌘Z does not take back a fold a reply
  or a thumbs-up made: ⌘Z puts back the page's own acts (a move, a step, a
  Fold), and sending a reply or giving a 👍 is not one of them, so the fold
  goes with what caused it. A press on the row, x, or Unfold in ⋯ unfolds
  it.
- **Earlier messages (item 476).** Open, a dossier of more than seven
  messages shows its newest seven as cards and one row at the top of the
  folder for the rest: "8 earlier messages", with how many of them are new
  in red. The seven are the last seven as the dossier reads (its first message,
  then every other oldest first), so the first message is among the earlier
  ones; until the row is opened it shows as the tab alone. They are counted
  when the page draws the dossier open, and the page holds the first of them:
  a message arriving after that joins the cards below and hides nothing, so
  what is being read stays where it is (Your place holds, in
  `docs/experience-guidelines.md`), and one loaded from before goes behind the
  row. Any other state lets go of that, so the next opening counts again. The row is a button,
  a short line as wide as its words and 44px to touch, reached by Tab, with a
  tooltip saying what it does. A press (a tap, Return or Space) shows every
  earlier message as one row in its place, oldest first, who wrote it and its
  line, as a folded message reads but saying nothing of a fold, since none is
  made; the first message's row sits under the tab. The keys go on to the
  first of them when they were on the row; a tap lights nothing, so on a phone
  the dossier's tab still lights at its first tap and acts at the next, as on
  any open dossier. A message the reader folded keeps
  its own row and a starred one shows whole. A press on a row (one tap on a
  phone) shows that message whole in its place, its images with it, and from
  there it opens in the Reader as any card does. Under Only new, which shows
  such a message as a whole card with no row in it, a press on it acts as on
  any card. A link, search or Starred
  that lands on an earlier message opens the row and shows that message whole.
  All of this is the page's own for this visit: nothing is sent, nothing
  moves below More, and a reload, changing the dossier's state, or coming back
  to it off screen closes the row again (`earlierOf` and `rowsOf` in
  `web/stack-order.mjs`, `earlier`, `whole` and `held` in the page's stack
  state, `onEarlierRow` for where a press falls).
  Latest plus unread, and a dossier of seven or fewer, are unchanged.
- **First messages.** A dossier's first message is a message like any other
  (item 471): with the dossier fully open it folds to its own row under the
  head row, by its header, x, a swipe or Fold in ⋯, and its row, x or Unfold
  unfolds it; shown whole it has its bar. The head row stays the dossier's
  title, the one special row, and says nothing of the fold. At latest and
  unread the head shows only that title row, and x there does nothing, as on
  the chevron. Among an open dossier's earlier messages (Earlier messages,
  above), it is that title row alone until their row is opened, then its
  folded row if the reader folded it, else an earlier message's row. A link, search or the rail's Starred that lands on a folded
  message opens it whole for that view without unfolding it; changing its
  stack's state folds it to its row again.
- **Expand and collapse.** One chevron beside the title switches between
  latest plus unread (→) and every message (↓).
  It is a button reachable by Tab and operable by
  Space, with `aria-expanded` and a label naming the stack. The header already
  gives the reply and new counts; no repeated count or fold bar sits between
  the messages. Its accessible label describes the current state and next
  action; `aria-expanded` is false only on a quiet agent dossier's header alone.
- **The head.** The first message is one compact row: its short name, ✎,
  who began the stack and the marks of what that message carries (an image,
  the reader's own note and saved reply, docs/topic-reading.md), "New" when
  the message itself is new, ★ if starred,
  how many replied and who, and how many replies are new. The tab is two
  lines high: the short name, then the rest on one line that never wraps to
  a third (`stack-look.css`). When that line is short of room, who replied
  and what is new give way first, then the marks, whole glyphs dropped from
  the end, then who began it, cut short with its whole name in its tooltip;
  a minted name's "Named by", after the marks, keeps its width ahead of them,
  and "New", ★ and the count always show. The short name is the
  one someone typed for the dossier, or minted for it (Minted names, above),
  or else the first message's line (One line of a message, below). A page that holds only some of a dossier's replies
  shows the name too, and a rename typed there names the whole dossier.
  Renaming starts from the name shown, and Return on it unchanged names
  nothing. Pressing
  the row opens the entire stack; pressing it again returns to latest plus
  unread. The original message has no independent open/closed state.
  A message that stops
  heading a stack, joined into another or left with no replies, loses the
  row at once and reads as a card.
- **Replying.** Use Reply on the message's bar, or Return on the selected
  message, to open the Reader with its reply composer. Return on a selected
  dossier (its header or chevron) edits its title instead, as ✎ does:
  Return saves the title, Escape cancels, and Return while writing in a
  field types there. Stacks have no
  input-looking reply strip: that control opened the modal rather than
  accepting writing in place, so Tony asked to remove it.
  A reply of yours that arrives while this page is open, sent here or from
  another device, stays visible when its answer arrives, even in the same
  update, just as unread replies already in view stay visible. Only your
  own replies are held so; another person's read reply is replaced by a
  newer one as usual. Changing the stack's state lets go of it, and so does
  coming back to the page (the tab shown again) while that stack is off
  screen, exactly as for unread replies kept in view; a stack on screen
  when you come back keeps it. A later visit starts without it. The
  latest/unread state then shows its usual selection again. Switching Only
  new on and off changes a filter, not this reading snapshot: your newly
  arrived replies remain in view when the filter is switched off.
- **Stable presses.** Anything that arrives while a press is held—a new
  message, a stack repaint, reactions or the New line—waits until the press
  ends, then shows at once (`web/press-hold.mjs`). The header and people
  repaint in place. A finger's tap that a waiting repaint lands under keeps
  the light where the tap landed: the message it was in is read from the
  path the release was sent along, so the tap is not taken for one outside
  the messages.
- **The bar.** A head showing only its row has no message bar, nor has a
  dossier's folded row (item 471); Return still replies to it, and the bar
  comes back once its whole message shows.
  In a stack the bar stays below the head row's bottom edge while that row
  is in the window; where that leaves no room above a card's reply arrow, the
  bar sits under the card rather than over its words and answers. It never
  covers a folded row's 👍 either: it sits above the row, or under it. Once the
  row has gone above the window, the bar scrolls away with its card, as any
  message's bar does. A lit reply that its stack folds away loses its light
  and its bar, so no message bar is left over the stack's chevron. A card a
  finger tapped keeps its light and bar while the page scrolls: the first
  mouse move after a tap only places the pointer (WebKit sends one after a
  scroll that follows a tap), and the moves after it light what they pass
  over, or let the light go over nothing, as a pointer's moves do.
- **One New line.** It goes under the lowest stack that holds the line's
  message or anything newer that is not the reader's own (`lineUnder`). It is
  never inside a stack, and nothing new sits below it. While the line's
  message is not loaded, the line waits at the bottom (docs/topic-reading.md).
- **Reading order.** The Reader's ↑ and ↓ follow the page from top to
  bottom (`readingOrder`). They go down a stack through its replies to its
  newest, then on to the stack below.
- **Fold steps.** → steps from latest plus unread to all messages, and ←
  goes back, whether the keys are on the header or a reply or the chevron.
  Another → when fully open moves to the right siderail; another ← at
  latest plus unread moves to the left siderail. A hidden rail
  stays hidden. Each stack step can be undone with ⌘Z.
- **One line of a message (item 447).** Where the feed shows a message by
  one line (a folded message's row, and a stack's short name until someone
  types one), the line is the author's own words: the first line of the
  first block that is not a quote, read as the card reads the message,
  without the marks that begin it (a list's dash or number, a task's box, a
  heading's #s) or emphasis marks. A reply that begins by quoting what it
  answers shows the words after the quote. A message that is only quotes
  shows its first quoted line inside quote marks (“…”), so it reads as a
  quote and not as the author's words; one with only attachments says
  "Attached:" and their names; an empty one shows nothing. The line is never
  cut at a colon or a full stop: the row's ellipsis shortens a line too long
  for it, and a line over 200 characters (a short name's limit) ends at a
  word with "…". The message itself is unchanged, and a pipeline item's
  title keeps its own rule (docs/pipeline.md). The line saying what a reply
  answers ("Replying to …") and the line of a message between others are
  not this rule yet.

Each viewer has their own order and folds, because they come from that
viewer's places, folded messages and the page's own state. Names and joins
are the topic's, the same for everyone. A star and a folded message are the
reader's alone, and only they see them; a star shows on the card and in the
rail. The star sits at the right of the message's header: an outline ☆
while the message is lit or hovered, a filled ★ once starred, and a press on
either stars or unstars it for the reader alone. Its place in the line is
kept while it is hidden, so lighting a message moves nothing under a finger
(a tap on the reply arrow beside it lands on the arrow), and under a finger it
answers 44px each way. It is not a Tab stop of its own; Tab from a lit message
reaches it before the bar's buttons. Like the 👍 on a folded row, it names no
message of its own: only the card carries the message's `data-id`, so what
finds a card finds it alone, and the star acts on the card it sits in. It is
put back each time the author line is painted again (a mark from another
device, the time's words changing).

## Doing it

On a message (its card focused, never in writing), these keys work:

| Keys | Act |
| --- | --- |
| ⌘↑ ⌘↓ | move its stack up or down, for you alone |
| → ← | show every message of its stack, or only its latest and unread; past either, move to the siderail at that end |
| ⇧⌘↑ ⇧⌘↓ | join its stack to the stack above or below, for everyone |
| Return | reply to it; on a dossier's header or chevron, edit the dossier's title (Return saves, Escape cancels) |
| x | fold it to its row, for you alone, or unfold it, a dossier's first message as any other; a starred message stays open, and on a dossier as a whole (its chevron, or its title row at latest and unread) x does nothing yet |
| ⌘Z | undo the last of these, or the last Fold or Unfold (not a fold a reply or a 👍 made) |

The keys come from the shared key map (`web/pane-keys.mjs`), so the
outline and the messages read one set of keys. What ↑ ↓ and these acts leave
selected comes into view by the one rule (docs/interaction.md, "What the keys
select comes into view"): a message is its card, and a dossier's chevron or
compact header is the whole dossier, its header and whatever of its body
shows, which lands with its top a tenth below the window's top when it is
taller than the window.

The ⋯ menu offers:

- Star for me (or Unstar)
- Fold (or Unfold), for you alone; a starred message offers no Fold
- Rename (on a head)
- Show or Hide the full message
- Split back out (on a joined stack's first message)
- every move above, each naming its keys; of Fold its stack (←) and Open its
  stack (→), only the step there is from where the stack stands

A join makes the two stacks one: after it every message of both reads as
one run under the head, oldest first, and a new reply to any of them lands
at the bottom. The joined stack's first message keeps its "Joined from its
own stack" line, with Split back out there and in ⋯.

A dossier joins as a whole, as it is named and put aside (item 550). Where
the page has not loaded its first message, its stack is its branches
gathered (Gathering, above), and the join is sent for that first message,
loaded or not, fenced on the `join_revision` Core sends with each message's
position (docs/dossier-below-more.md): the whole dossier joins, its
messages the page has not loaded included. Its loaded messages show in the
stack it joins at once, taking that stack's position until Core's answer
and the positions read after it land, and ⌘Z shows them back where they
were at once. Its "Joined from its own stack" line is on that first
message, so it shows once Earlier messages loads it.

The right rail's Starred lists the reader's stars, this place's first and
then Elsewhere. A press lands on the message, opening its stack if it is
folded, and Unstar beside each takes the star off.

On a phone, ⋯ opens as a sheet from the bottom, and the moves sit behind
"Move or join…", which opens a second sheet. A message swiped to the right
folds to its row, in any state of its stack, fully open included, the
dossier's last visible message too, and a message placed on its own, which
has no title bar and stays where it was placed (item 472); its row swiped to
the left, or tapped, unfolds it. A drag that starts on
something scrolling sideways, such as a wide table or a block of code,
scrolls it instead. A long message that scrolls up and down inside its card
(item 381) is not such a thing: its card scrolls only up and down, and a
box a rounding pixel or two wider than it shows (`SIDEWAYS_SLACK`) does not
count, so a swipe over it folds it, by a finger on a phone and by two
fingers on a trackpad alike. A right-click (a long press on Android) opens the same
menu.

On a laptop, two fingers on the trackpad do the same: swiped right over a
message they fold it to its row, and swiped left over its row they unfold
it. The browser hears a two-finger swipe as wheel events. One swipe is a
run of them less than 250 ms apart by the events' own times; once it has
gone 80 pixels across, and further across than down, it folds or unfolds
the message under where it began, once, and the rest of it, its momentum
included, does nothing more. With macOS's natural scrolling, the default,
fingers moving right scroll the page's content left, a negative deltaX:
that is "swiped right" (`swipeFolds` in `web/stack-feed.mjs` is the one
place that says so; with natural scrolling turned off the two ways change
places). While a swipe over a message goes further across than down, the
page keeps its events from the browser, and with the pointer over the
messages a sideways overscroll does nothing, so the browser never goes back
or forward a page. A scroll that goes further down than across, a swipe
over something that scrolls sideways, and the wheel with Ctrl or ⌘ held
(zoom) are the browser's, as they were. Each event is judged on its own as
well (item 393): one that goes further down than across ends the swipe and
is the browser's, so a scroll begun right after a swipe folded a message,
still inside its 250 ms, scrolls the page at once.

With Option held, two fingers swiped right over a message in a dossier fold
it and every message before it in the dossier, its first message included
(item 472): each for the reader alone, as a plain fold is, a starred message
staying whole and the messages after it untouched, and ⌘Z right after
unfolds them all. In a dossier longer than the page has loaded, the earlier
messages it has not loaded fold too, so loading them shows them folded. The
page sends one `message.fold_through` and shows the messages of the stack in
front of the reader folded at once; Core's answer says every message it folded.
Without Option only the message under the fingers folds.
Safari's engine in the test harness turns the wheel with no keys held, so
this is checked in Chrome.

A card that a join, a move or a new reply carries to another place keeps
where it was scrolled: a table scrolled sideways, or a long message scrolled
in its card, stays as it was, and the page keeps its place.

A join the reader makes, by ⇧⌘↑ or ⇧⌘↓, from ⋯ or from the phone's sheet,
shows where it went (`joinShown`). The stack it went into, which now heads
the two, is drawn open: its own message whole, then every other message as
one run, oldest first, a joined stack's first message under its "Joined from
its own stack" line. The keys stay on the
message the reader acted on, in its new place, and the page scrolls only as
far as it needs to bring that message into view, with its join line above it
where both fit, each by the one rule for what the keys select: a tenth of the
window beyond the edge it came in at (docs/interaction.md). Drawn folded, as any stack is, the stack showed its head as
one row and only its newest reply, so a joined stack whose replies were read
seemed to vanish. ⌘Z puts back the join and how far the stack it went into
was folded, with the keys on the joined stack's first message, as before.
A join made by someone else, or on another device, opens nothing and moves
nothing under the reader: the stack is drawn as it would be.

Every act shows at once, then goes to Core with the revision the page holds.
Acts are sent one at a time, in order. Until Core answers an act, the page
draws it over what Core holds, so a quick run of presses always shows the
last one. Each act the page holds is the later by its revision of what it
knew and what it reads, so an answer read before a commit puts back nothing,
whenever it lands. An answer goes to the message as the page holds it when
the answer lands: a read that landed while the act was out (a 👍's reactions,
a page of messages) may have put a new copy of the message in the page, and
the answer is not lost on the copy it began with (item 433). So a message
unfolded never folds again when its answer lands, a star never goes out, and
the next act is fenced on the revision the answer gave. When an answer changes
what a stack shows, the page draws it again. A refusal reads the acts back and draws what Core holds. A screen reader hears each act said ("Moved up",
"Joined to the stack above").

### When an answer is lost

An act whose answer does not say whether Core recorded it is not settled, and
the page says so on its status line, by the act and the card it was made on,
until Core answers that same request (`web/stack-feed.mjs`, item 547):

- The connection dropped, or the answer could not be read: "Not known yet
  whether folding “The card's first line” was saved: the connection was
  interrupted. The page asks Theseus again." Theseus answered that it could not
  confirm it (`REQUEST_UNCONFIRMED`): "… Theseus could not confirm it."
- Theseus answered that it took nothing yet (its request lane busy, a busy
  database or authority, a receipt to try again): "Folding “…” is not saved
  yet: Theseus was busy. The page sends it again." A session the server
  refused, as a restarted server does: "… Theseus restarted." None of these is
  called a lost connection.

The acts are read again at once the first time, so the card shows what Core
holds meanwhile. The act is kept with its exact request, and once Theseus has
answered anything since (that read, another command, a commit on the live
feed; never a timer of its own) it goes again under the same operation. Core
answers an operation it recorded with what it recorded, and records one it
never saw, so the act is made once. That answer settles it, and its words go.
They go whatever follows: when the read after it of where a moved, renamed or
joined stack now stands fails, that failure says itself, and the act is no
longer said as not known.
An ask that fails, or a read that fails, settles nothing: an ask that got no
answer at all reads the acts again, paced as the page's reads are when they
fail, and a busy or unconfirmed answer waits for Theseus to answer something
else. Each act not settled is said, in the order made, so settling one leaves
the others said. The page's own acts (a stack dealt with as the reader's reply
arrives) are settled the same way without a word. An act not settled when the
page moves on in place still goes, from the page it was made on, until Core
answers it.

A refusal is said in words of its act: "Folding “…” was not saved: it changed
on another tab or device. The card shows what Theseus holds." The acts are read
again at once, and the words go when a read of the acts begun after the refusal
lands, so the card shows what Core holds as they go. A read begun before it
(one a commit on another device started, say) or a read that fails ends
nothing; a failed read is read again as the page's reads are. The status line
is left alone when something else has written on it since.

The other commands a person makes on a card, which the page does not send
again itself (a 👍 or a go-ahead answer on the card's bar or a folded row,
Mark unread or Mark read in its ⋯), say what Theseus answered the same way and
only that: "The thumbs-up on “…” was not saved: Theseus was busy. Press again:
Core keeps one of each.", "Marking unread “…” was not saved: Theseus
restarted. Choose it again to send the same request.", "Not known whether …
was saved: Theseus could not confirm it. …", or a refusal as above. Each goes
when a read of what shows the card, begun after it was said, lands: the
message's reactions, read again right after the answer, for a 👍 or an answer;
the topic's marks, read again then, for a mark. Only a command that met no
answer of Theseus's at all is said as a lost connection ("Connection
interrupted; whether that was saved is unknown. …"), which goes once Theseus
answers (`web/lines.mjs`). In the Reader, its 👍 and its Mark unread say what
Theseus answered in the Reader's notice the same way.

## The look

`web/stack-look.css` is the only place where stacks get their look. It reads
the semantic colour tokens of `web/aim.css` and only the names that
`web/reply-stacks.mjs` sets:

- `.reply-stack`: a stack. It carries these attributes:
  - `data-stack`: its head's id
  - `data-seq`
  - `data-fold`: folded or open, or head for a quiet agent dossier not yet opened
  - `data-head-open`, `data-placed`, `data-single`, `data-renaming`
- Inside the stack:
  - the head's entry, with its card marked `.stack-head-card` and holding
    `.stack-head`. The row's parts are `.stack-name`, `.stack-pen`,
    `.stack-who`, `.card-carries`, `.stack-named` (a minted name's "Named by"), `.stack-new`, `.stack-star`, `.stack-meta`
    (with `.stack-count`, `.stack-repliers` and `.stack-fresh`, each a part of
    the tab's line of its own) and `.stack-hide`.
  - `.stack-rename`, holding `.stack-rename-input` and `.stack-rename-hint`.
  - `.stack-toggle`, the header's native expand/collapse button, a sibling of
    the message button, with `aria-expanded` and `aria-controls`.
  - `.stack-replies`, with each reply's entry and `.stack-join-line`
    (`.stack-join-words` and `.stack-split`).
  - `data-stack-overlap` and `data-stack-covered` on message entries: visual
    hooks for adjacent visible faces. Hidden entries do not separate faces;
    a join line does. These attributes carry no saved fold or order state.
  - `.stack-placed-line`, with `.stack-placed-words` and `.stack-unplace`.
- `[data-starred=true]` on any card the reader starred, and `.card-star`,
  the header's star, outlined or filled.
- `[data-folded=true]` on any card the reader folded, a dossier's first
  message included (its row follows the head row), holding its one row,
  `.message-folded` (`.folded-author`, `.folded-words`, `.folded-thumb`,
  the row's 👍, whose `data-count` says how many have given one, and
  `.folded-cue`).
- `.stack-earlier` first in `.stack-replies` of an open dossier of more than
  seven (`.stack-earlier-words`, `.stack-fresh`), and `[data-earlier=true]` on
  a card shown as an earlier message's row, holding `.message-earlier`
  (`.folded-author`, `.folded-words`).

Another look replaces that one file. Nothing in the drawing code chooses a
colour, a border or a spacing. The look now is the Dossier: a stack is one
folder pressed into the page. Its head row is the folder's tab, two lines high,
with the short name on the first and who started it, how many replied, who
and what is new on the second; the tab and the body are one cut, joined by a
curved corner. A compact chevron sits beside the name. The replies are the
sheets inside, each card in its own colours; folded replies draw no extra bar.
Later visible cards overlap the previous card's bottom edge by 12px, with a
soft top contact shadow. At latest and unread, read replies hidden above the
first visible reply give it no overlap, so it never rises over the folder's top
edge, and a hidden reply between two visible ones neither separates them nor
takes the covered padding. Extra bottom padding keeps that overlap clear of
words and controls. The root remains statically positioned so its folder tab
keeps the same containing block, including when a message-fold wraps the root.
Join and placement lines remain clear of the cards. A join line's gap from
the cards is outside its box, so a join that brings the line into view
measures the line itself, not blank space above it: with the line a tenth
inside the window, the page stays where it was. No arrival or fold motion
is part of this static treatment (item 429; motion remains item 412).

The first author letter aligns with the body text. An agent's badge
protrudes 4px to the left, in a dossier as in a placed message's folder, and
only the first name fragment moves when an Unread pill holds the final
grapheme; a folded row's name in a dossier is plain words (item 471). A folded message keeps its author and words at full
contrast, including quiet agent talk. In a dossier, a saved fold gives its
card the existing read material even before its read marker catches up; this
presentation writes no read command, and it holds for a person's card as for
an agent's. Nothing else does: a thumbs-up on a card it does not fold (anyone
else's, or the reader's own on a starred card) leaves the card's material to
its read state, and so does a fold outside a dossier, a placed single message
included. Own messages
retain black. Folded words keep at least 4.5:1 contrast across all agent palettes in
light and dark.

A folded face is 44px tall on a laptop. On a phone or coarse pointer it is
56px tall: its successor covers 12px, leaving a reachable 44px strip and the
folded thumbs-up. A hit box hidden under the successor does not count toward
that 44px. Normal single messages keep their original box; stars still
prevent an individual message fold. Starred replies stay visible in the recent-replies view through the
reader's existing star act (item 413).
Shown whole, the head's card is the first
sheet; while the stack is renamed, the field takes the tab's place. Only one
current target has the strong ring: a message, or the whole folder when its
compact header or a stack control is selected. The ring is the lit card's
or fold line's own, drawn on its own box, so it stays on that box as a card
read in place scrolls inside itself, as the page scrolls, as the window
resizes and as the card grows: one outline, never a second. The next card
overlaps the lit one's bottom edge and covers the ring's bottom side with it;
the ring's top side and its sides show (item 430). A message between others
stacks as a card does, in front of the card before it and behind the one
after. A fold line over the card before it keeps its words below that
card's edge, as a card's padding does. A message between others keeps its quiet fold line in a dossier,
and the line answers the pointer and shows when it is open, as anywhere. The enclosing stack does not
also light up for a selected message. Stale keyboard focus, unread state and
hover on an unselected message do not get another strong border. A placed message
on its own is a folder with no tab. The folder ends after its messages and
any placement control, with no reply strip or empty footer. Under Only new
the stacks draw nothing.

## Checks

The item 429 checks in `tests/stack_native.mjs`, named "reading dossier look",
run under native-reading and native-webkit-reading at laptop and phone widths
in both themes. They measure overlap, at all messages and at latest and
unread with hidden replies around the first visible one, text clearance,
first-letter alignment, folded palette contrast including quiet states, and the
exposed phone strip with a real folded-thumb press. The negative cases retain
the full open messages, a normal single card and the star's fold protection,
and the unread material of a starred card with the reader's own thumbs-up,
which the thumbs-up does not fold (inside a dossier and out), and of a fold
outside a dossier (in the feed and placed). A saved fold's read material is
checked on an agent's reply and a person's. A saved fold the reader then
marks unread keeps the read material; the check records it beside an unread
twin without judging it, as the rule for that case is still open (item 430).

| What | Where |
| --- | --- |
| Core's acts | `tests/test_stacks.py` (a fold: `FoldCase`) |
| the migrations | `tests/test_migrations.py` (`StacksStepCase`; the fold's step, `FoldStepCase`) |
| the display order | `tests/ui_stack_order.test.mjs` |
| what a join the reader makes shows | `tests/ui_stack_order.test.mjs` (`joinShown`); in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks a join you make shows where it went …" |
| a join makes one stack: every message oldest first under the head, a new reply at the bottom, a join of a join, Split back out | `tests/ui_stack_order.test.mjs`; in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks a join makes one stack …" |
| on the page, in Chrome and in Safari's engine | `tests/stack_native.mjs`, the "reading stacks …" cases of `--reading` |
| a fold: in a fully open stack, through every state, a reload and another device, unfolded by a press and ⌘Z, a link, Starred and the first message | `tests/stack_native.mjs`, "reading stacks a message folded in a fully open stack …"; on a phone, swiped right, swiped left and tapped, "reading stacks on a phone a message swiped right …" (Chrome only: Safari's engine in the harness has no finger drag) |
| the trackpad: two fingers right fold a reply once, momentum and all, and left unfold it after a reload; a scroll, a swipe on a wide table and a starred message fold nothing; the page goes nowhere | `tests/stack_native.mjs`, "reading stacks on a laptop two fingers swiped right on the trackpad …", in Chrome and Safari's engine |
| a reply or a thumbs-up folds the message for the person alone, in Core: a page's reply, an answer, their own message, a thumb taken back, a starred or already folded message, an agent | `tests/test_stacks.py` (`AnsweredFoldCase`) |
| on the page: the row where the message was, the place and the keys kept, the Reader whole, ⌘Z, another reader and another device | `tests/stack_native.mjs`, "reading stacks replying to a message or a thumbs-up on it folds it …", in Chrome and Safari's engine |
| a swipe folds a long message that scrolls up and down in its card | `tests/stack_native.mjs`, "reading stacks a swipe folds a long message …" (a finger on a phone in Chrome only) |
| a scroll right after a trackpad swipe folded a message | `tests/stack_native.mjs`, "reading stacks a scroll right after two fingers fold a message …" |
| x folds and unfolds the selected message; a starred one, a dossier and writing | `tests/ui_outline_order.test.mjs` (the key map); `tests/stack_native.mjs`, "reading stacks x folds the selected message …" |
| the 👍 on a folded row | `tests/stack_native.mjs`, "reading stacks a folded message's row carries its 👍 …" |
| inside a dossier: a message shown whole keeps its agent name's badge (its computed corner, fill, border and padding those of a message on its own), folded rows with a plain name, no pill and a 👍 only once given, a message on its own unchanged, at 320, 375 and 390 pixels and on a laptop, light and dark, and a reload finding order, names and folds as they were | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks inside a dossier a message shown whole keeps its agent name's pill …" |
| inside a dossier: a header press folds, the words open the Reader, no bar on a folded row, the first message folded and unfolded as any message, the title row still the dossier's, a message on its own opened from its header | in Chrome and Safari's engine, at 320, 375 and 390 pixels and on a laptop, `tests/stack_native.mjs`, "reading stacks inside a dossier a press on a shown message's header …" |
| Option and a swipe right fold the message and every one before it, later and starred ones whole, ⌘Z, and a plain swipe folding one | in Chrome, `tests/stack_native.mjs`, "reading stacks Option held with two fingers right on the trackpad folds the message …" |
| in a dossier longer than the loaded page, the messages not loaded fold too, by one request, another reader's folds stand, ⌘Z unfolds every one, and Earlier messages on a new document shows them folded | in Chrome, `tests/stack_native.mjs`, "reading stacks Option held with two fingers right on the trackpad folds every message before it in a dossier longer than the loaded page …"; in Core, `tests/test_stacks.py` (`FoldThroughCase`) |
| a swipe on a dossier's last visible message folds it in place; the title bar alone moves the dossier below More and back | in Chrome (a finger's drag), `tests/stack_native.mjs`, "reading stacks below More uses a real swipe …"; the trackpad, "reading stacks on a laptop two fingers swiped right on the trackpad …" |
| a message placed on its own folds in place under a swipe right, unfolds under a swipe left on the same page, stays placed and goes nowhere below More | the trackpad in Chrome and Safari's engine, each gesture beginning 300 ms after the last as a real trackpad's does, a finger's drag in Chrome, `tests/stack_native.mjs`, "reading stacks a message placed on its own folds in place …" |
| the lit message's ring: its bottom side under the card in front (no ring colour in the strip it would take there, and the card in front topmost by a hit test), its top side and sides shown, one outline on its own edges, none below the last card and the next card's words clear, a reply's and the first message's, short and long (read in place, at its top and scrolled inside), and a fold line, read from the screen | in Chrome and Safari's engine, at 320, 375 and 390 pixels and on a laptop, light and dark, `tests/stack_native.mjs`, "reading stacks the lit message's ring has its bottom side under the card in front …" |
| a passage lit under the pointer on a lit dossier card keeps its fill over the words (and none over the words before it) while the card keeps its own ring, its bottom under the card in front, read from the screen | in Chrome and Safari's engine, on a laptop at 1280 and 900 wide, light and dark, `tests/stack_native.mjs`, "reading stacks a passage lit under the pointer on a lit dossier card …" |
| a lit message read in place keeps one ring on its own box, within a pixel, as it scrolls inside to its middle and its end, as the page scrolls, as the window resizes and as it grows (Show full message), each read once the scroll has ended, the first message, a reply and the latest reply (its bottom side shown, nothing in front), read from the screen | in Chrome and Safari's engine, at 320, 375 and 390 pixels and on a laptop at two widths, light and dark, `tests/stack_native.mjs`, "reading stacks a lit message read in place keeps one ring on its own box …" |
| a fold line in a dossier under the pointer and open | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks a fold line in a dossier answers the pointer …" |
| a tap's light and bar through the first mouse move after it, and the moves after it lighting another card or letting the light go | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks a tap's light stays through the first mouse move after it …" |
| one line of a message: the author's words after a quote, colon and all, a quote alone, list and heading marks, an attachment alone, an empty message, a long line | `tests/ui_message_preview.test.mjs` |
| on the page: folded rows, a dossier's name folded and not, and a message on its own show the author's own words on one line, at 320, 375 and 390 pixels and on a laptop; renaming starts from that name and Return unchanged names nothing | `tests/stack_native.mjs`, "reading stacks a folded message's row shows its author's own words …", in Chrome and Safari's engine |
| an act's answer that lands after a 👍's reactions read put a new copy of the message in the page: x never refolds it and a second x is not refused, a star stays | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks x unfolds a folded message while its 👍's read is out …" and "reading stacks Star for me on a folded message while its 👍's read is out …" |
| two states, by the chevron, the header, → ← and ⋯; a stack left at its header | `tests/ui_stack_order.test.mjs` (`LEVELS`, `foldStep`, `levelOf`); `tests/stack_native.mjs`, "reading stacks use exactly two states …" and "reading stacks a dossier left at its header alone …" |
| a press held, and each way it ends | `tests/ui_press_hold.test.mjs`; in Chrome, `tests/stack_native.mjs`, "reading stacks a press ends however it ends …" |
| a phone's tap on a go-ahead ask's one-row head keeps the ask lit with its bar while the page hears of a star made on another device, on a message it has not loaded (which draws nothing again) and on one it shows (whose repaint lands under the finger) | `tests/ui_stack_position.test.mjs`; in Chrome and Safari's engine, `tests/topic_reading_native.mjs`, "reading a phone's tap on a go-ahead ask's one-row head …" (Safari's engine in the harness taps whole, so there the star is read just before the tap) |
| a link followed again after another device's Bring back and Move below More | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks below More: on a laptop/phone, the link followed again …" |
| a scroll carrying on with the page at a long message's edge | `tests/topic_reading_native.mjs`, "reading a cut-off message scrolls in place …" |
| the star in a message's header: an outline while lit, filled once starred, for the reader alone, opening nothing | `tests/stack_native.mjs`, "reading stacks a star in a message's header …", in Chrome and Safari's engine |
| a minted name, in Core: the coordinator once the first reply lands, two to five words, minted once, never over a typed name (cleared or not), a person's rename while the agent prepares its mint, not the coordinator's agent, the first agent with no coordinator, a whisper, a message that is not the first, an old name read unchanged | `tests/test_dossier_names.py` (`CoreCase`) |
| the harness: `name_it` on the namer's delivery alone, the notice and `inbox` saying the mint once, a fake coordinator minting through `mint`, the hint after `reply`, a coordinator switched off told nothing while the first agent to reply is told and mints through the notice, `mint` refused after a person's rename | `tests/test_dossier_names.py` (`HarnessCase`, `NoticeCase`) |
| one dossier, one stack: the branches of a dossier whose fork sits above the loaded page gathered under the oldest head with one name, one count and every reply oldest first; another dossier its own; a loaded first message unchanged; the fork, then the first message, loaded; the first message loaded and the fork not; the reader's own reply; a split not yet answered | `tests/ui_stack_order.test.mjs`, "the branches of one dossier whose fork sits above the loaded page are one stack …" |
| on the page: the dossier's minted name once, with its mark and its count, every loaded reply in its stack, another dossier above the page under its own first line, a loaded dossier as before, and Earlier messages pressed twice leaving it one stack, at 320, 375 and 390 by a finger and on a laptop, light and dark | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks one dossier whose fork sits above the loaded page is one stack …" |
| the dossier's place on its first message, its stack's head changing as more of it loads (`reheaded`), what the page keeps of it going to that head, a stack joined into a branch that does not head the one stack keeping its join line; a place on the reply heading the stack, set before item 550, holding while the first message carries none, the first message's winning where both exist | `tests/ui_stack_order.test.mjs`, "a dossier whose first message is above the page keeps the reader's place …", "a place the reader set on a reply heading the stack …" and "a stack joined into a branch that is not the head's …"; the position's place, in Core, `tests/test_stack_aside.py` (`test_a_position_carries_the_readers_own_place_on_its_first_message_so_a_page_of_replies_keeps_it`) |
| on the page: a dossier opened, its newest seven held as a reply arrives and its earlier-messages row opened, staying so as Earlier messages loads an older reply to its first message and then that first message, each heading it in turn, at 320, 375 and 390 by a finger and on a laptop | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks a dossier whose first message is above the page stays as the reader left it …" |
| on the page: ⌘↑ placing that dossier on top at once, its first message holding the place in Core and every frame keeping it there as the answers land, the place holding through Earlier messages twice and a reload, Let new replies move it; placed on another device, on top with its place line at 320, 375 and 390 | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks a dossier the reader placed, its first message above the page, keeps its place …" |
| on the page: a dossier placed on the reply heading its stack, as places were set before item 550, on top with its place line; Let new replies move it taking that place away in Core and after a reload | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks a dossier placed on the reply heading its stack …" |
| on the page: a stack joined into a branch of that dossier that does not head its stack, its join line and Split back out inside the one stack at 320, 375 and 390 and on a laptop, Split back out reaching Core | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks a stack joined into a branch of a dossier above the page …" |
| the head says who minted its name | `tests/ui_stack_order.test.mjs` (`mintedBy`); in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks a minted name says Named by …", at 320, 375 and 390 pixels and on a laptop, light and dark, folded and open |
| Return on a dossier edits its title; Escape cancels; Return in writing types; Return on a message replies | `tests/stack_native.mjs`, "reading stacks Return on a selected dossier edits its title …", in Chrome and Safari's engine |
| the view filter at the right of the Read it row, at a laptop's and a phone's width | `tests/stack_native.mjs`, "reading stacks the feed's view filter sits at the right of the row …" |
| the older stack case | `tests/topic_reading_native.mjs`, "reading replies gather into a stack …" |
| earlier messages: which they are, the row's words and count of new, opened rows in place, a fold and a star among them, a join line, seven or fewer showing none | `tests/ui_stack_order.test.mjs` (`earlierOf`, `rowsOf`) |
| on the page: the newest seven and the row, opened to rows in place, a row shown whole with its image and opened in the Reader, the first message's row, nothing sent, nothing below More, a reload closing the row with the order, the name and the folds Core holds unchanged, at a laptop's width and 390, 375 and 320 on a phone, light and dark | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks an open dossier of more than seven …" |
| an earlier message the reader folded opening in the Reader by presses alone: the earlier-messages row, then the message as it shows (its folded row, its earlier message's row, then the message whole), each press showing more of it until one opens it, within three, on a laptop | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks an earlier message the reader folded opens in the Reader …"; the native harnesses' `p.open` reach a message the same way, so the Reader cases that find their source among a dossier's earlier messages (`tests/reader_live_native.mjs`, "live restart: … (reader …)", when `native-live` runs whole and its earlier cases have put the source there; run alone, the source is not among them) open it as a person does |
| under Only new: the row, closed or opened, giving way to the New messages among the earlier ones as whole cards with no row inside them, and back when it is off, at a laptop's width and 390, 375 and 320 | `tests/conversation_native.mjs`, "conversation Only new: an open dossier's earlier-messages row …" |
| the row reached by Tab and opened by Return, the keys going on to the first earlier message; a link to an earlier message opening the row and showing it whole; the rail's Starred landing on the dossier's first message, an earlier one, opening the row and showing it whole; the row's count of new in red on its one line at a laptop's width and 390, 375 and 320; a dossier of seven showing no row | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks the earlier-messages row is reached by Tab …" |
| the seven counted when the dossier is drawn open: which is held, a message arriving after that hiding nothing, held gone counted afresh | `tests/ui_stack_order.test.mjs`, "the newest seven are counted when the dossier is drawn open …" |
| on the page: a reply arriving in an open dossier of seven, or of ten with the reader on its oldest card, then on an earlier message's row once the row is opened, leaving each shown where it was; folded and opened again, counted afresh; at a laptop's width and 390, 375 and 320 | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks a message arriving in an open dossier hides nothing being read …" |
| on a phone the dossier's tab lighting at its first tap and folding at its next, its first message whole (seven), its tab alone behind the closed row, or that row opened by a tap, at 390, 375 and 320 | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks on a phone the first tap on an open dossier's tab lights it …" |
| under Only new a press on an earlier message's whole card, or on the first message's words, opening the Reader | `tests/conversation_native.mjs`, "conversation Only new: an open dossier's earlier-messages row …" |
| an act whose answer is lost: said with its card until Core answers the same request again, then gone; made once; the page's own deal says nothing | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks an act whose answer is lost …" |
| an act Theseus was too busy to take: said as busy, never as a lost connection, after the acts are read again; sent again under its operation | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks an act Theseus was too busy to take …" |
| two acts not settled: each said; a failed read or ask clears neither; one answered leaves the other | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks two acts not settled …" |
| an act refused for a session the server no longer holds, as after a deploy restarts it | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks an act refused for a session …" |
| an act Core refuses: said in words of its act and card until a read of the acts begun after it lands; one begun before, or one that fails, ends nothing | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks an act Core refuses …" |
| a 👍 Theseus was too busy to take: said as busy with its card, never as a lost connection, until its reactions read again after it land; a failed read ends nothing | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks a thumbs-up Theseus was too busy to take …" (two cases) |
| Mark unread from a card's ⋯ that Theseus was too busy to take: said as busy with its card until the marks read again after it land | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks Mark unread from a card's menu …" |
| an act asked again that Core takes, the positions read after it failing: no longer said as not known, nor said again with a later act's words | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks an act asked again that Core takes …" |
| a busy 👍's line in the rail at a laptop's width and in the drawer at 320, 375 and 390, light and dark, and gone once its reactions read again land | in Chrome and Safari's engine, `tests/outcome_rail_native.mjs`, "rail a thumbs-up Theseus was too busy to take …" |
| a 👍 or an answer, and the Reader's mark, say what Theseus answered, never a lost connection unless none answered | node units, `tests/ui_reactions.test.mjs` and `tests/ui_inline_wiring.test.mjs` ("… item 547") |
| a busy star and a reply in doubt together, as on live: no notice over another, no hold on leaving, the star made once from the page that has gone | in Chrome and Safari's engine, `tests/outcome_rail_native.mjs`, "rail a star Theseus was too busy to take and a reply whose send is lost …" |

`tests/acts.json` names the break each act must catch.

Not yet:

- On iPhone a long press opens no menu, because Safari sends no context menu
  for it; ⋯ is the way there.
- A head shown as one row has no room for its reply arrow. The reply sits
  in the stack under it.
- Archive, Make it a heading, Edit and Lift out come with the next piece.

## Put a dossier aside

A right swipe on its title bar (its head row, or the chevron) moves the
dossier below More messages for you, on every device. Every message keeps
its own fold gesture, the last one shown included, and so does a message
placed on its own: it has no title bar, so a right swipe folds it where it
was placed and moves nothing below More (item 472). The menu offers Move below More and Bring back above More,
and so does the Reader's archive button beside the star, labelled with how
many messages move with it, those of every stack drawn from the dossier
(item 378, docs/reader.md);
Command-Z undoes a move. The page's New message composer at rest sits just
above More, under the last dossier shown above it (item 465). Existing unread messages and your own replies leave
it there; a newer visible reply from someone else brings it back. Links can
show its messages without clearing your choice. More is a boundary for the
stack keys and their menu items: ⌘↑ ⌘↓ move a stack past, and ⇧⌘↑ ⇧⌘↓ join
it to, the stack shown beside it on its own side of More (`sideOf`), so a
stack above More steps over a dossier put aside, and none moves or joins
across More into or out of one. The Reader's ↑ and ↓ (and a phone's
↑ Previous · ↓ Next) read the same page order (`shownOrder`): they step over a
dossier below a closed More, reach it below More once More is open, and stop
at the end of what the page shows rather than going on into one put aside.
Agent coordination hidden by Show agent coordination is passed over the same
way. Every such step leaves through one exit (`stepTarget`): a message the
page shows, never one it has loaded and does not show, however the Reader came
to be open (Read it on a message below More, a link, search, Starred, another
pane, a move on another device). Core's neighbour beyond what the page loaded
leaves too, unless the page knows it is not on show: it belongs to a dossier
the page holds hidden (a reply loaded below a closed More whose first message
is older than the page), or Core's position for it puts it below More while
More is closed. The Conversation's Only new is its own view: it draws just the
New items, wherever they sit (put below More, or a reply folded in a closed
dossier), and the Reader's ↑ and ↓ step along those; beyond what the page
loaded, a step goes on only to a message the page knows as New. The stacks
hide what that one view hides each time they are drawn, so an act or a
reaction that redraws them keeps the same messages drawn. Whether a message
is drawn is one rule (`drawn`, from that view and the stack's level); the
keys' focus and the card a repaint holds ask it, never the DOM. The keys reach
every card the page draws, and ↑ and ↓ from More (or another control between
cards) go to the card drawn just above or below it. A repaint holds the card
in view; when it stops drawing that card (put below More on another device),
it holds the next card drawn below it instead. The Reader on a message the
page does not draw (Read it below a closed More, a link to one Only new does
not draw) steps from where that message sits to the nearest one drawn each
way. On another topic's message, opened from an About link, it steps as Core
has it: this page's More and Only new are not its view. A dossier below More
that a link, search or Starred drew where it sits stays there through →, ←,
Fold and the page reading the topic again, while Core holds it at the place it
held then (`drawnBelow`, by `placeOf`: the dossier and the revision of its
Move below More). A Move below More or Bring back made on another device is a
new place only when it changes Core's value, which raises that revision; the
dossier is then drawn as Core holds it, and a link followed again draws it
where it sits again. One that finds the place unchanged leaves it drawn where
it is. One made here ends it at once, and also when Core finds the place
unchanged. The page draws the stacks again for the positions it reads only
when what places a dossier changed (its first message, through, below and
aside revision): every act in the topic raises the snapshot a position is
read at, and that alone draws nothing. Each time the page's stacks are drawn again (More opened
or closed, Only new turned on or off, an act or a reaction, a move on another
device) everything placed by what the page shows is placed again: the Reader's
↑ and ↓ while it is open, the New line, and Earlier messages. The New line,
when the oldest new message is in a dossier below a closed More, takes the
first place shown after it. Earlier messages shows wherever the dossiers put
aside are on show, under Only new as with More open; under Only new it shows
even while the New line says more new messages lie below, since Only new does
not draw that line. Moving a dossier below More hands focus to More when the
page draws More (with More open too); under Only new, which hides More, the
dossier keeps focus, on the first of its messages Only new draws. Wherever the
keys are put on a message the page does not draw, they go to the first message
of its stack that it does. See [the Core contract and checks](dossier-below-more.md).

## Agent coordination (359)

A dossier entirely between known agents starts as one quiet title row, with
its reply count. The same up/right/down control still opens latest/unread and
then all messages, and goes on between those two; only ⌘Z right after
opening takes it back to its row. Explicitly opening it stays open as new agent replies arrive.
This presentation is not the reader's saved message fold or saved placement.

Show agent coordination above either feed is on initially; turning it off
hides these rows (including standalone agent coordination). It is a page-local
view, changes no unread or delivery records, and can always be turned back on.
A message link reveals its target even with this filter off. The keys
reach Show agent coordination in the row of filters, one of the rows of
buttons at the top of the feed (docs/interaction.md): ↓ from it goes to the
first dossier or message the feed shows, on or off, ↑ from there comes back
to it, and ↑ from it goes on up to the header's buttons (item 403).

Classification uses addressing, not inferred intent: every message must be
from a known agent and explicitly addressed only to known agents. Room posts,
messages to the reader, direct replies to the reader, unknown people, missing
ancestry and any mixed joined dossier stay visible. Further agent-only replies
stay quiet; a human or room-directed reply brings the dossier back immediately.

An agent coordination row is a dossier too: a right swipe on its row, or the
menu, moves it below More messages like any other dossier ([Put a dossier
aside](#put-a-dossier-aside)), and it keeps its quiet row
there. With Show agent coordination off, agent coordination below More is
hidden as well and More counts only the dossiers it would show.
