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
`through` is the last topic message sequence observed before the move; null
brings it back. It cannot be a future sequence. A target which is no longer a
visible root is refused as STACK_CHANGED, so a concurrent join cannot hide a
different dossier. Retry uses the same operation identity; ordinary act revision
fencing prevents a late Undo from reversing another device's change.

`stack_positions`, args `{topic_id, message_ids:[up to 100 ids]}`, returns
`items:[{message_id, stack_position}]`. Topic-message pages also carry
`stack_position: {root_id, through, aside_revision, below, at:{messages,acts}}`.
Membership follows the latest shared join, otherwise same-topic reply ancestry,
including ancestors outside the loaded page; inaccessible ancestors terminate
it. Joined dossiers use the destination root's choice. Splitting restores the
source root's choice, subject to its newer replies. No body or hidden ancestor
is disclosed. `at` fences older reads against later message/act snapshots.

A root's newer visible messages are checked through indexed reply/join edges,
not by scanning unrelated topics or by relying on the browser's loaded rows.
The UI rereads positions for its bounded loaded ids on shared or personal acts;
new message pages carry the current position for their root.

Schema 38 adds `aside` to the existing act table plus reply/join edge indexes.
Upgrade preserves act ids, revisions and the sequence high-water mark. Downgrade
to 37 refuses if any aside row exists, even if brought back later.
