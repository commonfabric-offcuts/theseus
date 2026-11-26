# Reply stacks

A topic page reads as stacks: a message, every loaded reply to it, and the
replies to those, gathered into one stack. A stack reads as a chat does, its
first message on top and its replies under it oldest first. The topic's
stacks keep the reader's order: incoming replies never move an existing dossier.
New dossiers enter first, and reawakened dossiers enter last above More
([dossier-order.md](dossier-order.md), item 731). This page holds the
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
message, even one unfolded since. Version 46 lets it hold a dossier's cover the
same way; stepping back to 45 is refused once any cover was written.

| Act | Command | Value | Whose |
| --- | --- | --- | --- |
| star | `message.star` | `{"starred": true}` | the reader's own |
| deal | `message.deal` | `{"dealt": true}` | the reader's own |
| fold | `message.fold` | `{"folded": true}` | the reader's own |
| place | `stack.place` | `{"key": 1.5}` or `{"key": null}` | the reader's own |
| name | `stack.name` | `{"name": "Cabin week"}` (empty gives back its first message's line), or an agent's `{"name": "Cabin week plan", "minted": true}` (below, "Minted names") | the topic's |
| join | `stack.join` | `{"into": "m-…"}` or `{"into": null}` (split back out) | the topic's |
| cover | `stack.cover` | where the dossier stands, what waits on the outcome's owner and its payload, on the dossier's first message ([dossier-covers.md](dossier-covers.md)) | the topic's |

Each act names one message, `target: {"message_id": "m-…"}`, and is fenced on
the revision its sender read: `expected: {"star_revision": 3}` (and likewise
`deal_revision`, `fold_revision`, `place_revision`, `name_revision` and
`join_revision`). An
act's revision counts its rows for that message, kind and owner. A late
request is refused with `REVISION_CONFLICT`, and the refusal carries the
current revision. Sending a value the act already stands at records nothing
and answers `changed: false`. An answer carries the value, the new revision,
`changed` and, when it recorded a row, `acts_version` and `acts_before`: the
newest act in the topic its reader had heard of before this one (their own and
the topic's, never another reader's own).

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
  place they read, newest star first. Starred dossiers appear under their
  topics in the outline; the right rail has no Starred section.
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
- **One dossier, one stack (item 550).** Core's position on each message
  names its dossier's first message (`root_id`,
  docs/dossier-below-more.md), and the page groups the messages it holds by
  it, as Core says: one dossier, one stack, one tab, one name, one count,
  every loaded message of it oldest first, whatever of the dossier is
  loaded. The page never works a dossier out from what it holds, so loading
  more of one moves no message into another. A message the page holds under
  another (it answers it, or a join the page shows put it there) is in that
  one's dossier, as Core places it, so a join or a split shows at once,
  before Core's positions are read again; a message whose own join or split
  the page has not had answered (`moving` in the page's shown messages,
  `stack-feed.mjs`), and one from a Core that sends no position, is its own
  dossier's first message (`dossiersOf`, `stack-order.mjs`). The stack's
  head is the dossier's first message where the page holds it. Where it
  does not, the stack is gathered: its head is the oldest of its messages
  that hang under no message the page holds (each was a card of its own
  before 550), not a reply of the reader's own while another can be, so
  that reply stays a reply in the reader's own style; the others are its
  branches. Two dossiers are two stacks whatever is loaded of each. A
  dossier's stack takes another head only when the page is read again with
  more of it, and then stays as the reader left it, open or folded, its
  earlier-messages row opened or not, the seven it shows held (`reheaded`,
  `stack-order.mjs`), and where the reader placed it (The stacks, below).
- **Actual distant heads (item 799).** Gathering still uses only the loaded
  page for ordering, placement and branch visibility. When its real first
  message is above that page, the client reads that exact root through the
  existing admitted `topic_messages` named-message view. An available root
  decorates the gathered stack as its normal folded head, with its real words,
  author and dossier name; the former gathered head becomes a visible reply.
  These supplemental sources stay outside the loaded runs and older cursor,
  and contribute no sorting key or implied intervening history. More uses the
  loaded frontier and transfers a source root to the loaded page once, without
  repeating it or making that already displayed root an apart card. Other
  filled/apart messages keep item550's placement. Loaded heads and standalone
  messages retain their rendering. Loading is explicit; an unavailable source
  uses “Reply in <dossier name>” opening the canonical root, and a read error
  has Retry. A loading source is never called unavailable. Withheld/private
  bodies are not used. Revision/access changes discard old source bytes;
  obsolete root requests and retired page lifetimes cannot repopulate them.
- **What one stack never loses.** Each way of showing a dossier loses
  nothing in it, and every message stays reachable where it is. So a
  gathered stack keeps, folded, its head whole and each branch in view, as
  each was a card of its own before 550, read or not; a reply under one
  folds as any reply does, and a stack headed by its own first message folds
  it to its tab as ever (`paintStack`, `reply-stacks.mjs`).
  More messages shows what it loads where its button was
  (docs/experience-guidelines.md, "Your place holds"): of the older
  messages it loads, each of the dossier of the stack shown last above the
  button shows at that stack's end, newest first, each whole at every level
  and never behind the earlier-messages row, as a run of cards a sheet gap
  apart that neither overlap one another nor tuck under the card above; each
  of a dossier whose stack sits higher up shows there too, as a card of its
  own, so that stack keeps its head, its count and its place, and no card
  already shown moves (`fillFrom`, `reply-stacks.mjs`; `filled` and `apart`
  in `gather`). However often it is pressed: where the last card above the
  button is such a card of its own, its dossier's stack still sits higher
  up, so what the next press loads of that dossier shows below it as cards
  of their own too, never at that stack's end. The dossier's first message is no exception: loaded so, it
  heads nothing until the page is read again. Older messages of a dossier
  the page did not draw are that dossier's stack there, in time order.
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
- **The stacks (731).** Core's personal `order_key` places each dossier,
  including a partial page whose first message is not loaded. The migration
  preserves each existing reader's effective order, including saved and legacy
  placements. Incoming replies never change it. New dossiers enter first;
  reawakened dossiers enter last above More. ⌘↑ and ⌘↓, as the moves in ⋯, still place a dossier
  halfway past its neighbour, and ⌘Z restores its previous key. Reset position
  returns it to its last admission position and still permits no reply to lift
  it. A join uses its destination's position; a split restores the source.
  See [the record contract](dossier-order.md).
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
  change of the stack's state, on coming back, or after a reload.
  This uses that reader's existing acts, never another reader's stars. Read asks do not
  add an exception. An agent-only dossier's explicit header-only state is
  unchanged; opening it to latest plus unread applies the same star rule.
  Coming back also returns off-screen fully open stacks to the partial view.

  Closing the dossier after revealing older history hides unrelated loaded
  replies again and keeps their order for the next open. The latest and New
  replies can show their immediate loaded parent in one compact row. Saved
  individual message folds still apply to selected replies.
- **Folded messages.** A message the reader folded stays folded for them, on
  every device and after a reload, until they unfold it; nobody else's view
  changes. Wherever its stack shows it, at every state, fully open included,
  and on its own, it is one row: who wrote it, its line (One line of a
  message, below), a 👍, and "Folded". Consecutive folded messages from one
  sender show the name on the first alone (item 645); opening a message shows
  its name again. A different sender, a whole message, a dossier boundary or
  a separating line starts a new run. Only messages drawn by the current view
  count: Only new skips settled messages and hidden separator rows, and counts
  a new folded head even when its dossier is closed. Name grouping runs after
  the New line is placed, and again whenever the line alone moves or goes.
  Each folded message still names its sender to a screen reader. The row is all of the card that draws,
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
- **Dealt with, folded (items 377, 1244).** A person's reply to a message
  (`reply_to`, including ✅/🚫 and replies to their own words) folds it for
  them in Core, through `Stacks._fold_answered`. Starred or already folded
  messages keep their current choice. A thumb leaves the individual fold
  choice unchanged; confirmed reading, wait and dossier deal effects remain.
  Manual Fold/Unfold still records the person's own act. Agent answers follow
  item 955 below. The page keeps the folded row, reading place, keys and open
  Reader. ⌘Z restores page acts; it does not take back a reply's Core fold.
- **An agent's answer (item 955).** An agent replying publicly to a person's
  message in a topic dossier folds that message for its human author, leaving
  the answer open. A star, a private note with words, or an existing personal
  fold choice prevents this automatic fold; a manual unfold survives further
  agent answers and reloads. Core records and notifies the human's fold with
  the reply, attributed to the real agent. Other readers, human replies,
  agent thumbs, Conversations and whispers keep their existing behavior.
  There is no backfill. See [agent-answer-fold-955.md](agent-answer-fold-955.md).
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
  made. The first message instead shows whole under its tab, or as its saved
  personal folded row (1101), so its drawn fold and Fold menu agree. The keys go on to the
  first of them when they were on the row; a tap lights nothing, so on a phone
  the dossier's tab still lights at its first tap and acts at the next, as on
  any open dossier. A message the reader folded keeps
  its own row and a starred one shows whole. A press on a row (one tap on a
  phone) shows that message whole in its place, its images with it, and from
  there it opens in the Reader as any card does. Under Only new, which shows
  such a message as a whole card with no row in it, a press on it acts as on
  any card. A link, search or Starred
  that lands on an earlier reply opens the row and shows that message whole.
  A full landing on the first message instead shows it whole and keeps the
  earlier row closed (875, [first-message-landing-875.md](first-message-landing-875.md)).
  The row then counts only hidden replies: fourteen messages give the first
  message, the newest seven and "6 earlier replies". A row already opened
  stays open; pressing a closed row keeps its existing behavior.
  A topic's unread count lands the same way (item 613, docs/attention.md, "In
  the browser"), and draws the dossier open first whatever its level
  (`reveal`'s `open`), so a message waiting deep in a dossier at latest and
  unread, or at its first message alone, is shown whole in its open folder.
  All of this is the page's own for this visit: nothing is sent, nothing
  moves below More, and a reload, changing the dossier's state, or coming back
  to it off screen closes the row again (`earlierOf` and `rowsOf` in
  `web/stack-order.mjs`, `earlier`, `whole` and `held` in the page's stack
  state, `onEarlierRow` for where a press falls).
  Latest plus unread, and a dossier of seven or fewer, are unchanged.
- **First messages.** A dossier's first message is a message like any other
  (item 471): with the dossier fully open it folds to its own row under the
  head row, by its header, x, a swipe or Fold in ⋯, and its row, x or Unfold
  unfolds it; shown whole or folded it has its bar, which offers Unfold once
  it is folded. The head row stays the dossier's
  title, the one special row, and says nothing of the fold. At latest and
  unread the head shows only that title row, and x there does nothing, as on
  the chevron. Among an open dossier's earlier messages (Earlier messages,
  above), it is that title row alone until their row is opened, then its
  folded row if the reader folded it, else its whole message (1101). A link, search or the rail's Starred that lands on a folded
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
  the message itself is new, ★ if the reader starred any message of the
  dossier, not only its first (item 635: a later reply, or one the page has
  not loaded, which the dossier's position names), how many replied and who, and how many replies are new. The tab is two
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
- **Replying.** Use Reply on the message's bar, or Return on the visibly
  outlined message or dossier, to open the same shared reply bar in its card.
  A compact dossier's outline invokes its title-bar Reply (907: newest loaded message); Return does not rename it.
  Selected or lit words retain the existing Reader reply with those exact
  words quoted. With nothing outlined, Return opens New message on this page,
  without navigating; rail hover is not selection. A button or link showing
  its focus ring, and writing in a field, retain their own Return.
  Click the name or ✎ to rename: Return in its title field saves and Escape
  cancels. (Item 784 supersedes the Return-to-rename entry point.)
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
- **The bar.** A head showing only its row has no message bar; Return still
  replies to it, and the bar comes back once its whole message shows. A
  dossier's folded row keeps its bar, which offers Unfold (item 473 over item
  471's barless fold).
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
  over, or let the light go over nothing, as a pointer's moves do. That holds
  on the page a tap moved to as well: the page keeps how its last press was
  made across its moves, so a tap on a topic's count, which lands on its
  message (item 613), leaves the keys on that message, not on a card the
  landing's scroll brought under the finger.
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
| ⌘↑ | move its stack up, for you alone |
| ⌘↓ | move its stack down, for you alone |
| ⌘→ | archive the selected dossier; a selected message archives its containing dossier, with the current selection |
| → ← | show every message of its stack, or only its latest and unread; past either, move to the siderail at that end |
| ⇧⌘↑ ⇧⌘↓ | open a named Join choice for the stack above or below; explicitly confirm to join for everyone |
| Return | invoke the visibly outlined message or dossier’s current Reply; with nothing outlined, New message here. A ringed control and writing retain Return |
| x | fold it to its row, for you alone, or unfold it, a dossier's first message as any other; a starred message stays open, and on a dossier as a whole (its chevron, or its title row at latest and unread) x does nothing yet |
| ⌘Z | undo the last of these, or the last Fold or Unfold (not a fold a reply or a 👍 made) |

The keys come from the shared key map (`web/pane-keys.mjs`), so the
outline and the messages read one set of keys. What ↑ ↓ and these acts leave
selected comes into view by the one rule (docs/interaction.md, "What the keys
select comes into view"): a message is its card, and a dossier's chevron or
compact header is the whole dossier, its header and whatever of its body
shows, which lands with its top a tenth below the window's top when it is
taller than the window.

### The title bar and the message bar (item 473)

A dossier's title bar, its tab, shows three glyphs at its right, on the paper
beside the tab, where the tab never reaches:

- Reply (an arrow turning back): the Reader on the dossier's first message,
  the cursor in its reply, as Return on that message does.
- Move below More (a tray, the arrow going down), or Bring back above More
  (the arrow coming up) once the dossier is below More; none on a dossier
  Core has no place for yet.
- ⋯: the menu a right-click on the first message gives, opened under it.
  Item1091 gives it the same message palette: marks, action rows, separate
  Topic/Dossier starts, the offered destructive action and grouped key
  buttons. Rename stays on the dossier pencil.

They show while a pointer is over the dossier, and are there to be found
(invisible, never gone) as the pointer crosses to them; by touch, once the
dossier or one of its messages is selected; by the keys, as soon as one of
them holds the focus, or the dossier or one of its messages is selected. They
stand at the folder's right edge, on the paper past the tab's curved corner,
which holds no name and no mark, and never past the folder's edge into the
page's margin. Under a pointer their place is kept while they are hidden (the
pointer finds them there), so showing them moves nothing, and their room costs
the tab nothing: the tab reaches as far as it does without them (70% of the
folder in a wide window, 85% in a narrow one), its name and its marks as they
were. Hidden by touch they reserve nothing: the tab reaches its whole 85%, and
the name has that width. Once they show they take the room they need, and
where the folder's paper past the tab's corner is narrower than they are (a
phone's ⋯, 44px to touch, beside a tab of 85% of a 288 to 358px folder) the
tab gives it back: 14px at 320, 6px at 375, 4px at 390, so ⋯ stands on the
folder, inside its right edge. An agent-only dossier's one quiet row keeps no
room for ⋯ at its end either until ⋯ shows there.
Hidden by touch they take no press: a tap where ⋯ sits lands on the page beneath it, not on ⋯, until the dossier is
selected; the keys still reach them. However they come to show (the pointer, a selected dossier or message, the
focus, ⋯'s menu open), they show, take a press and take their room together: one switch holds all three. A message on its own has no title bar and no
glyphs; a dossier being renamed and Only new show none.

Each glyph is a real button beside the first message's card, after its
chevron, so Tab reaches them in order (Reply, Move below More, ⋯), then the
dossier's messages (an open dossier's earlier-messages row first), and
Shift-Tab comes back; each has its name as its accessible name and its
tooltip, and by touch each is 44px square. They stand in a row with the
chevron, as a message bar's buttons stand with each other, so ← and → go along
that row to the nearest control that way (from ⋯ to Move below More, Reply and
the chevron) and past its end on to the pane beside, as from the messages;
↑ and ↓ stay the messages' keys there.

On a phone, and in any window 760px or narrower, Reply and Move below More
fold into ⋯, which then shows alone: there the tab may reach 85% of the
folder, and the paper past its corner holds one glyph, not three (three 44px
glyphs and the corner need 146px of it, a 970px folder; three of a pointer's
28px, 106px, a 704px folder). ⋯ keeps its name, its
tooltip and its 44px, and its menu offers Reply to the first message and Move
below More (or Bring back above More) first, by those names, before what the
first message's own ⋯ offers. As every menu item (docs/links.md, "A message's
menu"), each shows the glyph of the button that does the same: Reply the title
bar's Reply, Move below More the Reader's archive tray and Bring back above
More the tray with an arrow out. Each does what its glyph does, by touch and by
the keys (Tab reaches ⋯ alone, Return opens its menu on Reply). The tab is
never narrower at rest than once selected: the two glyphs folded into ⋯
reserve nothing, and ⋯ takes only the room it needs once it shows.
A wider window, where the tab reaches 70% of the folder, keeps the three
glyphs.

The bar over a lit message shows Reply as its glyph, named Reply (Return), and
two more: Show full message (two arrows pointing out), only while the card
cuts the message off, showing it whole there as ⋯'s Show full message does;
and Fold (arrows pointing in to a line), Unfold once the message is folded,
none on a starred message, for the reader alone as ⋯'s Fold is. Tab goes
through them as through the rest of the bar. With these a go-ahead ask its
card cuts off has seven buttons, too wide for a 320px window by touch: the bar
puts Fold, then Show full message, behind its ⋯, which offers both, and keeps
to one row (docs/interaction.md, "The light").

Nothing a glyph does is new: each is an act the menu or the keys already make,
with the same record in Core, so how a dossier is shown stores nothing, and
every message stays reachable where it sits.

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

Starred dossier titles appear under their loaded topics in the outline
([starred-outline.md](starred-outline.md)). A title opens that dossier through
the writing guard. The message's own Star control takes its star off.

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
One capturing scroll listener on the feed remembers only boxes whose own
scroll events report a nonzero offset (item 888). Returning both axes to zero
forgets the box. Reconciliation moves nodes without reading scroll positions
or scanning their descendants; after all moves it restores only remembered
boxes still in that feed and inside a node reconcile actually moved (item 896).
An unmoved box receives no write. After one attempt the remembered entry is
consumed, even when a hidden box cannot take the write; the next scroll event
records fresh offsets. Detached boxes are forgotten. This is visit state,
never stored. `tests/ui_scroll_carry_888.test.mjs` exercises the actual renderer
with modelled detach resets and counts position reads/writes across moves,
joins and new replies. It does not measure browser layout or responsiveness.

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
  - `data-color`: `agent` on a dossier an agent began, with that agent's
    `agent-<colour>` class from `web/aim.css` (its `--agent-card` and
    `--agent-tag`); empty on a person's
- Inside the stack:
  - the head's entry, with its card marked `.stack-head-card` and holding
    `.stack-head`. The row's parts are `.stack-name`, `.stack-pen`,
    `.stack-who`, `.card-carries`, `.stack-named` (a minted name's "Named by"), `.stack-new`, `.stack-star`, `.stack-meta`
    (with `.stack-count`, `.stack-repliers` and `.stack-fresh`, each a part of
    the tab's line of its own) and `.stack-hide`.
  - `.stack-rename`, holding `.stack-rename-input` and `.stack-rename-hint`.
  - `.stack-toggle`, the header's native expand/collapse button, a sibling of
    the message button, with `aria-expanded` and `aria-controls`.
  - `.stack-tools`, the title bar's glyphs, each a `.stack-tool` button with
    `data-tool` `reply`, `aside` or `menu`, holding a `.glyph` svg
    (`web/glyphs.mjs`) or ⋯.
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
curved corner. A compact chevron sits beside the name, and the title bar's
glyphs at the far right. A dossier an agent began (the author of its first
message, an agent other than the reader) wears that agent's colour, in the
colour the reader sees it in, across the whole face of its folder and its tab:
a step deeper than its cards, so its sheets still read on it, with the tab's
words, meta, star and New kept at 4.5:1 or better on it and under the pointer,
in light and dark. A person's dossier, and the reader's own, keep the neutral
folder. No coloured edge or bar marks a dossier (item 477). The replies are the
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
| a reply folds; a thumb preserves the fold choice, in Core: a page's reply, an answer, their own message, a thumb taken back, a starred or already folded message, an agent | `tests/test_stacks.py` (`AnsweredFoldCase`) |
| on the page: the row where the message was, the place and the keys kept, the Reader whole, ⌘Z, another reader and another device | `tests/stack_native.mjs`, "reading stacks replying to a message or a thumbs-up on it folds it …", in Chrome and Safari's engine |
| a swipe folds a long message that scrolls up and down in its card | `tests/stack_native.mjs`, "reading stacks a swipe folds a long message …" (a finger on a phone in Chrome only) |
| a scroll right after a trackpad swipe folded a message | `tests/stack_native.mjs`, "reading stacks a scroll right after two fingers fold a message …" |
| x folds and unfolds the selected message; a starred one, a dossier and writing | `tests/ui_outline_order.test.mjs` (the key map); `tests/stack_native.mjs`, "reading stacks x folds the selected message …" |
| the 👍 on a folded row | `tests/stack_native.mjs`, "reading stacks a folded message's row carries its 👍 …" |
| inside a dossier: a message shown whole keeps its agent name's badge (its computed corner, fill, border and padding those of a message on its own), folded rows with a plain name, no pill and a 👍 only once given, a message on its own unchanged, at 320, 375 and 390 pixels and on a laptop, light and dark, and a reload finding order, names and folds as they were | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks inside a dossier a message shown whole keeps its agent name's pill …" |
| inside a dossier: a header press folds, the words open the Reader, a folded row keeps its bar with Unfold, the first message folded and unfolded as any message, the title row still the dossier's, a message on its own opened from its header | in Chrome and Safari's engine, at 320, 375 and 390 pixels and on a laptop, `tests/stack_native.mjs`, "reading stacks inside a dossier a press on a shown message's header …" |
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
| what one stack never loses: folded, a gathered stack's head whole and each branch in view under a first message not loaded, read or not, not where it is loaded, a press on the head's words doing what it does on any card; a reply of the reader's own never the head while another branch can be, the oldest of the reader's own where all are; More's older messages of the stack shown last above it at its end newest first, whole at every level, outside the earlier-messages row, under the head the stack had, those of a dossier drawn higher up cards of their own where the button was, pressed again below the last such card too, that stack keeping its head, and the first message heading nothing so loaded | `tests/ui_stack_order.test.mjs`, "folded, a stack gathered under a first message the page has not loaded …", "a reply of the reader's own never heads a stack gathered …" and "older messages More filled a stack with …"; through the page's own More press, `tests/ui_inline_wiring.test.mjs`, "More messages shows the older messages of the dossier it fills where its button was …", "More messages shows every older message it loads where its button was, those of a dossier whose stack sits higher up too …" and "folded, a stack gathered under a first message not loaded shows its head's words …"; on the page, in Chrome, `tests/reader_live_native.mjs`, "live More messages shows the older messages where its button was", `tests/render_native.mjs`, "live rendering: every pill is as wide as its words …" and `tests/agent_colors_native.mjs`, "your own message keeps its own style when it arrives live and when More loads it"; at 320, 375 and 390 by a finger and on a laptop, light and dark, in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks Earlier messages fills the stack it was under with whole cards where the button was …", "reading stacks Earlier messages shows every older message it loads where the button was, those of a dossier whose stack sits higher up too …" and "reading stacks folded, a stack gathered under a first message above the page shows the words of the reply heading it …" |
| on the page: the dossier's minted name once, with its mark and its count, every loaded reply in its stack, another dossier above the page under its own first line, a loaded dossier as before, and Earlier messages pressed twice showing the fork and then the first message where the button was, the stack keeping its head and its name once, at 320, 375 and 390 by a finger and on a laptop, light and dark | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks one dossier whose fork sits above the loaded page is one stack …" |
| the dossier's place on its first message, its stack's head changing as the page holds more of it (`reheaded`), what the page keeps of it going to that head, a stack joined into a branch that does not head the one stack keeping its join line; a place on another message of the dossier, set before item 550, placing it while the first message carries none, whichever message heads its stack and whether or not it is loaded, the one set last winning, the first message's winning where both exist, a place in another dossier counting there alone | `tests/ui_stack_order.test.mjs`, "a dossier whose first message is above the page keeps the reader's place …", "a place the reader set on any message of a dossier …" and "a stack joined into a branch that is not the head's …"; the position's place and places, in Core, `tests/test_stack_aside.py` (`test_a_position_carries_the_readers_own_place_on_its_first_message_so_a_page_of_replies_keeps_it`, `test_a_position_carries_the_readers_own_places_on_the_dossiers_other_messages_the_most_recently_set_first`, `test_a_readers_listed_place_is_fenced_by_their_own_revisions_alone`) |
| on the page: a dossier opened, its newest seven held as a reply arrives and its earlier-messages row opened, staying so as Earlier messages loads an older reply to its first message and then that first message, each where the button was and the stack keeping its head, at 320, 375 and 390 by a finger and on a laptop | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks a dossier whose first message is above the page stays as the reader left it …" |
| on the page: ⌘↑ placing that dossier on top at once, its first message holding the place in Core and every frame keeping it there as the answers land, the place holding through Earlier messages twice and a reload, Let new replies move it; placed on another device, on top with its place line at 320, 375 and 390 | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks a dossier the reader placed, its first message above the page, keeps its place …" |
| on the page: a dossier placed on two replies that do not head its stack, as places were set before item 550, on top with its place line, through Earlier messages; Let new replies move it taking both places away in Core, and ⌘Z putting each back; a place on the first message winning over them, and a place in another dossier placing that dossier alone | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks a dossier placed on messages that do not head its stack …" and "reading stacks a place on a dossier's first message wins …" |
| on the page: two places set before item 550 on messages of one dossier that disagree, the one set last placing it, on top or at the bottom; after Let new replies move it and ⌘Z, the same one placing it, on the page and after a reload; a stack placed on the reply heading it, ⌘Z showing its place line and place at once while Core's answers are held | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks a dossier placed on two of its messages that disagree …"; in Chrome, "reading stacks ⌘Z of Let new replies move it on a stack placed on the reply heading it …" |
| on the page: a stack joined into a branch of that dossier that does not head its stack, its join line and Split back out inside the one stack at 320, 375 and 390 and on a laptop, Split back out reaching Core | in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks a stack joined into a branch of a dossier above the page …" |
| the head says who minted its name | `tests/ui_stack_order.test.mjs` (`mintedBy`); in Chrome and Safari's engine, `tests/stack_native.mjs`, "reading stacks a minted name says Named by …", at 320, 375 and 390 pixels and on a laptop, light and dark, folded and open |
| Return answers the outlined dossier; pen/name Rename retains Return save and Escape cancel; writing retains Return | `tests/visible_return_784_native.mjs` N1–N7 and `tests/stack_native.mjs`, "reading stacks Return on a selected dossier invokes its title-bar Reply …", in both engines |
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
| the title bar's glyphs: shown under the pointer or once selected by touch (hidden by touch, a press at ⋯ does not land on it, at 320, 375 and 390 pixels), named with their tooltips, 44px by touch, beside the tab and past its curved corner at 320, 375, 390 pixels (once selected the tab giving back at most what ⋯ needs) and on a laptop at 1280 and 761 (three) and 760 (⋯ alone), light and dark; none on a message on its own | `tests/stack_native.mjs`, "reading stacks the title bar shows Reply, Move below More and ⋯ …", in Chrome and Safari's engine |
| the title bar's ⋯ on the folder: its right edge at or inside the folder's, clear of the tab's corner, 44px, the tab giving back no more than ⋯ needs, by touch at 390, 375 and 320 each way a touch shows it (a reply selected, the dossier selected, the dossier lit with the focus gone, ⋯'s menu open), and under the pointer at 1280 and 760, light and dark | `tests/stack_native.mjs`, "reading stacks the title bar's ⋯ sits on the folder's face …", in Chrome and Safari's engine |
| hidden glyphs reserve nothing: at 320 by touch, at rest, a dossier's tab reaches its whole cap and an agent-only dossier's quiet row its end padding, each long name still cut off; once selected, ⋯ inside the row, nothing of the meta under it, the tab's name no wider than at rest | `tests/stack_native.mjs`, "reading stacks hidden title bar glyphs reserve nothing …", in Chrome and Safari's engine |
| the title bar's room costs the tab nothing: head rows at 375 and 390 keep who began the dossier whole and an image mark where 88 showed it, and at 390 a dossier whose first message carries a picture alone, selected by touch, keeps its image mark and who began it whole beside its ⋯, light and dark | `tests/card_marks_native.mjs`, "head rows at …" and "picture-only head row at 390px …", in Chrome and Safari's engine |
| ← and → on the title bar's glyphs go along its row (from ⋯ to Move below More, Reply and the chevron, and back, past ⋯ to the right rail) on a laptop, and from ⋯ to the chevron at 390, 375 and 320; ↓ from ⋯ goes on to the dossier's message below | `tests/stack_native.mjs`, "reading stacks ← and → on a dossier's title bar glyphs …", in Chrome and Safari's engine; `tests/outcome_rail_native.mjs`, "rail arrows on a topic and a Conversation …" (no arrow stays put where a control lies that way) |
| the title bar's Reply, ⋯ (the first message's own menu), Move below More and Bring back, by pointer, touch and the keys; a reload finds order, name and folds as they were, every message in reach | `tests/stack_native.mjs`, "reading stacks the title bar's Reply opens the Reader …", in Chrome and Safari's engine |
| on a 390px phone the title bar's ⋯ opens its menu, Reply to the first message with the title bar's Reply glyph and Move below More with the Reader's tray first, Bring back above More with the tray and its arrow out once below, light and dark | `tests/stack_native.mjs`, "reading menus a dossier's title bar ⋯ on a 390px phone …", in Chrome and Safari's engine |
| the message bar's Reply glyph, Show full message only on a cut-off message, Fold and Unfold, none on a starred message | `tests/stack_native.mjs`, "reading stacks the message bar's Reply is a glyph …", in Chrome and Safari's engine |
| the message bar in the window: a go-ahead ask's bar, short and cut off, plain and with "Link copied", in one row at 390, 375 and 320 pixels with Fold and Show full message behind its ⋯ where they do not fit and back once they do, nothing put away on a laptop or where there is room | `tests/topic_reading_native.mjs`, "reading a go-ahead ask's bar keeps every button in the window …", in Chrome and Safari's engine |
| a folder in its agent's colour, following the reader's choice; a person's neutral; no edge | `tests/ui_folder_colour.test.mjs` (contrast for every palette colour, light and dark); `tests/stack_native.mjs`, "reading stacks a dossier an agent began wears its colour …", in Chrome and Safari's engine |

`tests/acts.json` names the break each act must catch.

Not yet:

- On iPhone a long press opens no menu, because Safari sends no context menu
  for it; ⋯ is the way there.
- A head shown as one row has no room for its reply arrow. The reply sits
  in the stack under it.
- Archive, Make it a heading, Edit and Lift out come with the next piece. The
  title bar's tray glyph is Move below More, which is what archiving a dossier
  is for now.

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
it there; a newer visible reply from someone else brings it back. A dossier
whose title bar shows your star (any message of it you starred) stays above
More for you (item 635, docs/dossier-below-more.md): the swipe on its title
bar, Move below More and the Reader's archive button show as ever, and a
press says why where it was, moving nothing; starring a message in a dossier
below More brings it back above More, for you. Links can
show its messages without clearing your choice. More is a boundary for the
reorder controls: ⌘↑ and ⌘↓ move a stack past, and ⇧⌘↑ ⇧⌘↓ join
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
Move below More). The page may not yet have heard of a move another device
made before the link was followed, and so hold an older place than Core: the
dossier is drawn where it sits until the page has read Core's place again, and
the place that read finds is the one it holds to, so reading the move it
missed does not take the dossier away (item 426; a read that fails keeps the
place the page held). A Move below More or Bring back made on another device is a
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
↑ and ↓ while it is open, the New line, and Earlier messages. Core's
neighbours of the Reader beyond what the page loaded are read again whenever
an acts read reaches a later act than they were last read at, since a Move
below More or Bring back on another device moves their dossier with no change
to the topic; an acts read that reaches no later act leaves the neighbours
already resolved as they stand (item 426). The page's own fold, star or deal
places no dossier: when the neighbours were read at or after the act its
answer names as `acts_before`, they are taken as read at that act too, so the
acts read it brings leaves them standing, while its own Move below More, or
one following an act they were not read past, asks for them again. The New line,
when the oldest new message is in a dossier below a closed More, takes the
first place shown after it; when it is older than the page and waits at the
bottom saying more new messages lie below, the bottom is the end of the run
above More, never after the dossiers below it, and whether it is older than the
page is measured from that run's last card, not from a dossier below More
(item 426). A dossier below More
that someone joins into one above it reads there, above More, and Split back
out puts it below again; one joined into a dossier below More goes below with
it (`tests/stack_native.mjs`, "reading stacks below More: a dossier put below
More joined by someone else …"). Earlier messages shows wherever the dossiers put
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

Show agent coordination starts **Off** (item467). An explicit flip lasts for
this reader's tab session across reloads and topic visits; a fresh tab/device
starts Off, and a duplicated session retains its choice (Warp11470).
It changes no unread or delivery records. A message link reveals
only its target dossier for that visit without saving On. The pill shares
the Archived row below the composer, on its right, whenever coordination
exists. Left/right move between that row's controls; up/down leave the row.
Arrivals update its count and news colour, never its choice. When On,
coordination stays in its existing interleaved positions. The contract and
storage boundaries are in [coordination-467.md](coordination-467.md).

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

### An own star that also brings back a dossier (queue42 assembly)

A star's combined Bring back (item 635) retains `acts_before` from before
either act and `acts_version` from the final aside act, with one notification.
It moves a dossier, so the own-act neighbour shortcut (item 426) does not
apply when the receipt carries `brought_back`. Ordinary own stars, folds
and deals keep their existing shortcut.

A card Earlier messages keeps apart below its button is still part of the
dossier drawn above it. It repeats neither that dossier's cover sheet nor its
cover pills, even when a later press loads the dossier's first message there.
The dossier already drawn keeps its cover. A genuinely lone loaded message,
including a dossier's only loaded reply, keeps its cover pills (merge B3).

Item 645 is held by `tests/stack_native.mjs`, the "reading item 645 folded"
and "reading item 645 opened" cases in `native-reading` and
`native-webkit-reading`, at 320, 375, 390 and laptop widths, light and dark.
The "reading item 645 review Only new", "reading item 645 Only new visible
folded head", "reading item 645 review New line" and "reading item 645 review
standalone" cases hold filtering, separator and opening transitions at those
same sizes and themes. `tests/ui_folded_names.test.mjs` holds the renderer
boundaries below the browser, including line-only insertion, movement and removal.

`paintFoldedNames(list, messages)` refreshes attribution from the arranged
structure and its current visibility predicate, without measuring layout or
changing records. `arrangeStacks` calls it after `on.arranged` has placed the
page's separators; the page also calls it after a line-only `placeLine` refresh.

## Deliberate join (1269)

Move remains immediate and personal. All join menu/shortcut paths first open
a menu naming source and destination for everyone; Cancel starts focused. Only
the explicit named Join choice sends the existing join command. Changed
source/neighbor/visit/authority/revision refuses. See [the contract](deliberate-join-1269.md).
Historical native direct-join checks above need the extra deliberate step;
this source change does not claim those native checks have executed.
