# A dossier below More (355)

Swiping a dossier's header/chrome, or its last visible message, to the right
puts the whole dossier below More messages for this reader. Swiping another
message uses the existing personal fold. The menu offers Move below More and
Bring back; Command-Z reverses the act. More works even with no older page.

The choice survives reloads and devices. Existing unread messages and the
reader's own new replies do not bring it back. A newer visible message by
someone else in the same dossier does. Read state, answers, stars and other
readers never change. Links, search and Waiting can reveal a message without
removing the choice. Explicit Bring back clears it.

## Core

`stack.aside`, target `{message_id: root}`, expected `{aside_revision, authority}`,
args `{through: integer|null}` records an append-only personal message act.
`through` is the newest message of the dossier the page had seen before the
move; null brings it back. It cannot be later than the newest message the
reader can see in the topic. A target which is no longer a
visible root is refused as STACK_CHANGED, so a concurrent join cannot hide a
different dossier. Retry uses the same operation identity; ordinary act revision
fencing prevents a late Undo from reversing another device's change.

`stack_positions`, args `{topic_id, message_ids:[up to 100 ids]}`, returns
`items:[{message_id, stack_position}]`. Topic-message pages also carry
`stack_position: {root_id, through, aside_revision, below, name, name_revision, at:{messages,acts}}`,
where `name` and `name_revision` are the dossier's short name as its first
message holds it (docs/reply-stacks.md), so a page holding only replies shows it.
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
`aside_revision` or `name_revision` changed: a later `at` alone moves no dossier.

A root's newer visible messages are checked through indexed reply/join edges,
not by scanning unrelated topics or by relying on the browser's loaded rows.
The UI rereads positions for its bounded loaded ids on shared or personal acts,
and draws what the acts and positions it read changed even when a later read
of that refresh fails, since the retry then finds nothing new;
new message pages carry the current position for their root. An act on a root
the page has not loaded is sent for one stand-in kept for that root, so it
learns the revision the act before it left: Command-Z at once after a move is
fenced on the move's own answer, as on a loaded root.

Schema 38 adds `aside` to the existing act table plus reply/join edge indexes.
Upgrade preserves act ids, revisions and the sequence high-water mark. Downgrade
to 37 refuses if any aside row exists, even if brought back later.
