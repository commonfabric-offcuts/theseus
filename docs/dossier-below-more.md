# A dossier below More (355)

Swiping a dossier's header/chrome, or its last visible message, to the right
puts the whole dossier below More messages for this reader. Swiping another
message uses the existing personal fold. The menu offers Move below More and
Bring back; Command-Z reverses the act. More works even with no older page.
The Reader offers the same act as an archive button beside the message's star,
labelled with the count of the messages that move with it, the page's one stack
of the dossier, its first message loaded or not, and any older message of it
Earlier messages showed where its button was (items 378 and 550,
docs/reader.md). The page's New message composer at rest sits between the last
dossier above More and the More line (item 465).

The choice survives reloads and devices. Existing unread messages and the
reader's own new replies do not bring it back. A newer visible message by
someone else in the same dossier does. Read state, answers and other readers
never change. Links, search and Waiting can reveal a message without removing
the choice. Explicit Bring back clears it, and so does the reader's star on a
message of it; while the reader has a star in it, it stays above More for them
(below, "A star holds it above More").

Command–Down Arrow in a topic feed or Conversation moves the selected dossier
below More (705); a selected message moves its containing dossier. The selection
is Return's pointer, keyboard or last-touch selection. Writing, open menus,
other controls and the Reader keep their keys; nothing selected does nothing.
It uses the same star hold, personal act, More focus and Command-Z Undo. Move
its stack down remains available in ⋯ for reordering, without this shortcut.

## Core

`stack.aside`, target `{message_id: root}`, expected `{aside_revision, authority}`,
args `{through: integer|null, key?: number}` (the optional key restores the exact position on Undo) records an append-only personal message act.
`through` is the newest message of the dossier the page had seen before the
move; null brings it back. It cannot be later than the newest message the
reader can see in the topic. A target which is no longer a
visible root is refused as STACK_CHANGED, so a concurrent join cannot hide a
different dossier. Retry uses the same operation identity; ordinary act revision
fencing prevents a late Undo from reversing another device's change.

`stack_positions`, args `{topic_id, message_ids:[up to 100 ids]}`, returns
`items:[{message_id, stack_position}]`. Topic-message pages also carry
`stack_position: {order_key, order_tie, order_entry_key, root_id, through, aside_revision, below, name, name_revision, join_revision, placed, place_revision, places, cover, cover_revision, starred, at:{messages,acts}}`,
where `name` and `name_revision` are the dossier's short name as its first
message holds it (docs/reply-stacks.md), so a page holding only replies shows it,
and `join_revision` is its first message's join revision, so such a page joins
the whole dossier fenced as Core holds it (item 550). `placed` and
`place_revision` are the reader's own place for the dossier, on its first
message, and its revision: such a page sorts the dossier by it and places it
fenced on it, whatever of the dossier it has loaded (item 550). `places` lists
the reader's own places on the dossier's other messages, each `{message_id,
placed, place_revision, at_ms}`, the most recently set first: before item 550 a
stack was placed on the message heading it, a reply or a stack later joined
into the dossier, and while the first message carries no place the page sorts
the dossier by the one set last.
The `cover` and `cover_revision` carry its cover ([dossier-covers.md](dossier-covers.md))
from the first message the reader can see, so replies alone show it and a reader
outside a whispered first message is never given its cover.
Membership follows the latest shared join, otherwise same-topic reply ancestry,
including ancestors outside the loaded page; inaccessible ancestors terminate
it. Joined dossiers use the destination root's choice. Splitting restores the
source root's choice, subject to its newer replies. No body or hidden ancestor
is disclosed.

`at` is the snapshot a position was read at: `acts`, the newest act in the
topic the reader hears of (their own and the topic's, on messages they can
see), and `messages`, the newest message the reader can see in a dossier put
aside (0 for one that is not, since no message moves its position). A whisper
the reader is outside moves neither, and neither moves for a message outside
the dossier, so a page of earlier messages reads the same however the topic
grows. A later read has more acts, or as many acts and more messages: while
the acts stand still a dossier only gains messages, and a split, which can
leave it fewer, is a later act. The page keeps the later of two reads, and
draws the stacks again only when `root_id`, `through`, `below`,
`aside_revision`, `name_revision`, `cover_revision` or `starred` changed: a later `at`
alone moves no dossier.
A stack takes a position only where the page's own reading of it agrees: the
position names the stack's first message, or that message hangs under one the
page has not loaded and the position names none inside the stack. A join or a
split, before Core answers it and until its messages are read again, leaves
the positions read before it on the messages it moved, so none of them names
the stack's dossier or takes its rename. The page reads the positions again
once Core answers a join or a split, as after an aside or a name, and each
row of such a read places its own message.

A root's newer visible messages are checked through indexed reply/join edges,
not by scanning unrelated topics or by relying on the browser's loaded rows.
The UI rereads positions for its bounded loaded ids on shared or personal acts,
and draws what the acts and positions it read changed even when a later read
of that refresh fails, since the retry then finds nothing new;
new message pages carry the current position for their root. An act on a root
the page has not loaded is sent for one stand-in kept for that root, so it
learns the revision the act before it left: Command-Z at once after a move is
fenced on the move's own answer, as on a loaded root.

## A star holds it above More (item 635)

A dossier's title bar shows the reader's star when any message of it is
starred by them, not only its first, and a dossier whose title bar shows the
reader's star is not moved below More for them. Move below More in its menu,
the swipe on its title bar and the Reader's archive button show as ever; a
press says "This dossier has a message you starred: unstar it to move it below
More" where it was (`press-note.mjs`: under the archive button, the line of
the message whose menu it was, or the title bar the swipe crossed), and
nothing moves on any frame. Command-Z, or Undo in ⋯, after a Bring back on a
dossier starred since is held the same way, and nothing says it was put back.
The words name "This dossier", so they show by the dossier the undo would have
moved, never beside a message of another one. Undo in ⋯ on a message of that
dossier says why by that message. Command-Z, wherever the keys are, and Undo in
the ⋯ of a message of another dossier say it under the dossier's title bar,
brought into view where it was out of the window, where its star shows. Where
the page does not draw the dossier at all (an agents-only dossier while Show
agent coordination is off), the reason goes on the page's status line (in the
left rail on a laptop), and nothing hidden is shown for it. A note shows under
what it is said beside, and over it where the window has no room below (a
message near the bottom of a phone's screen). The way out is to unstar. A star and the move are
each the reader's alone, so the hold is too: another reader's star never holds
yours, and yours never holds theirs. Starring a message in a dossier the reader
moved below More brings it back above More for them, in the same act; taking
the star off later leaves it above More.

Core holds this for every way a dossier goes below More, since each sends
`stack.aside`: the menu item, the swipe on the title bar, the Reader's archive
button, Command-Z or Undo in ⋯ after a Bring back, and any client or agent sending the
command itself, as the CLI's `command` verb does (it has no verb of its own
for the move). No other key moves a dossier below More:

- `stack.aside` below More is refused as `STARRED_IN_DOSSIER`, with that
  sentence, when the dossier holds a message the reader starred and can see;
  nothing is recorded. Bring back (`through: null`) is never refused, even
  for a dossier their star is in: a starred stack joined into a dossier they
  moved below More leaves that move standing, and their Bring back of it is
  recorded.
- `message.star` with `starred: true` on a message of a dossier the reader
  moved below More records their Bring back (`through: null`, its next
  `aside_revision`) in the same transaction, and its result says so:
  `brought_back: {root_id, aside_revision}`. The reader is told once, at the
  last row.
- A position names the reader's starred messages of the dossier, oldest
  first, loaded on the page or not: `starred: [message ids]`, which the title
  bar's star reads for those the page has not loaded (`starredDossiers` in
  `web/stack-order.mjs`; the page's own acts for those it has). A position
  naming one is never `below`, so a starred stack someone joins into a
  dossier below More keeps it above More for that reader (item 368).

The page checks the same rule before sending anything, so a press on a
dossier whose title bar shows the star moves nothing even for a frame. A move
sent before the page has read a star made on another device is refused by
Core, and said on the status line as any refusal is ("… was not saved: This
dossier has a message you starred …"); the dossier shows where Core holds it,
above More.

Schema 38 adds `aside` to the existing act table plus reply/join edge indexes.
Upgrade preserves act ids, revisions and the sequence high-water mark. Downgrade
to 37 refuses if any aside row exists, even if brought back later.

For an unloaded Reader source, `stack_positions` also returns
`has_other_messages` on each position: whether its dossier has another
message this reader can see, through the same indexed reply/join edges.
This distinguishes an unnamed root with replies from a singleton without
loading history; whispers the reader cannot see and replies joined elsewhere
never count. The field is computed once per root in this scoped view.
