# An outcome's conversation

Each outcome has one conversation that never ends: a topic of kind
`conversation`, for asking where things stand and raising friction and
requests. One agent, the outcome's coordinator, answers there; any other agent
answers only an item that names it. Each thing posted there shows what became
of it, as a small tag on its card, and Theseus writes that tag itself, in the
act that did it.

## The page

`?conversation=OUTCOME` is a topic page like any other: the messages, newest
first, with the same cards, reply stacks, New line and counts, and the writing
box below them ("Write to OUTCOME…"). The heading is "Conversation", with what it is for
and who answers under it. A card's tags show three quiet dots pulsing in turn while nothing has settled its item ("Waiting for an answer", still under reduced motion; a topic page draws the same dots on the reader's own message until the first reply from anyone else, docs/topic-reading.md, "Waiting for a reply"), then say Answered (with the reply),
Taken into a topic (with the topic) or On the pipeline, and, beside any of
them, Waiting on someone (with the ask). One filter chip, "Only new (N)", at
the right of the row above the feed (beside "N messages marked unread · Read it"
when that shows, on one row while both fit; at a phone's width Only new wraps
just under it, still at the right), leaves out every card but the items nothing has settled; a new item in a reply
stack shows on its own, without the messages it hangs under, and lays out as
a card on its own does (in line with the others and as far apart), whatever
else of its stack is new: there a stack draws nothing of its own. In a folded
stack an item nothing has settled, and an ask waiting on the reader, stay in
view (docs/topic-reading.md, "Reply stacks"). The page reads the
conversation again on every commit; a read that changes nothing on a card
leaves its tags and links as they are, so a press on a tag's link, or the
focus on one, is never lost to a repaint. Any link to the
conversation's topic opens this page.

## Who is in it

The coordinator is `workspaces.coordinator_id`, chosen at creation with
`workspace.create`'s `coordinator` or `workspace.coordinator_set` (target
`{workspace_id}`, expected `{workspace_revision}`, args `{actor_id: ID | null}`;
the chosen actor must be enabled and on the team). Any reader of the outcome
may choose its coordinator, under their own identity, regardless of role
([agent-settings.md](agent-settings.md)). The conversation's participants are always the
team's people plus the coordinator, kept so by `workspace.create`,
`workspace.coordinator_set` and `workspace.member_set` in the same act. So the
coordinator is woken by every message there, every person reads it, and any
other agent is woken only by a message that names it. With no coordinator the
page says nobody answers yet; items still arrive.

`workspace.create` starts the new outcome's conversation (its result carries
`conversation_id`). An outcome made before version 28 gets its conversation
from the operator: `aim-next-admin conversation-start --profile P --outcome W
[--coordinator NAME] [--replaces T1,T2]`; each replaced topic becomes Done
("Replaced by the conversation"), archived, readable under Archived.

## What a conversation refuses

| Code | When |
| --- | --- |
| `CONVERSATION_RULE` | `topic.update` of its title, archive or `done` ("A conversation never ends; topics do"); of any other state, note or waiting list ("In a conversation each item says where it stands. To wait on someone, ask them in a message"); `participation.set` ("Who is in the conversation follows the team…"). |
| `NOT_THE_ANSWERER` | An agent's reply to an item it does not answer. An item's answerers are the agents it names, else the coordinator. |

## Items, takes and waits

Every message on the record there is an item except one by the coordinator, a
reply by one of an item's answerers to that item, and a person's reply to an
open ask to them. A take records what became of an item:

| Kind | Written when | `ref` |
| --- | --- | --- |
| `answer` | an answerer replies to the item, whether or not the reply asks the item's author back | the reply's id |
| `topic` | `opening.publish` starts a topic whose `source_message_id` is the item | the new topic's id |
| `pipeline` | `pipeline.item_add` adds an item with the item as a source (`added: false`, "as 92"), or `pipeline.source_add` adds it to an item (`added: true`, "added to 92"); only for this outcome's own pipeline | the item numbers |

A take settles the item unless it took only part of it: `part: true` on
`message.post`, `draft.save` (`--part` on `post`), `opening.save` (`--part`
on `start --from`), `pipeline.item_add` or `pipeline.source_add` (each needs a
message source). `part` anywhere else is refused.

A reply that asks the item's author back answers the item like any other: the
card reads Answered, and the ask's own wait reads Waiting on them beside it
until they reply to that ask. An answerer who will still owe the rest once the
author replies sends the ask with `part`, which leaves the item New. Before
version 31 such a reply wrote no take, so its item stayed New for good. The
step to version 31 writes the take that each agent's reply to an item writes
now, where it has none, at the time the reply was sent, as a whole answer,
since whether it took only part was not kept. An agent's reply to an item was
always its answerer's; a person's was only while they coordinated, which is
not kept, so a person's reply is left as it was.

An ask there waits on each person it asks until that person replies to that
ask (`reply_to` = the ask), gives it a 👍 (a person's 👍 on a plain ask to
them answers it yes; taking the 👍 back makes it wait again unless they
replied to it meanwhile; [thumbs.md](thumbs.md#a-thumbs-up-answers-an-ask)), or
leaves the team and so can no longer read the conversation; nothing else
clears it. A coordinator someone replaces stays
on the team and still owes its asks.
The conversation's `topic_waiting` rows follow the open asks, so attention and
the sidebar read its waits as for any topic. The Conversation row on the outcome's page,
waiting on the reader, opens the oldest of its asks to them at its message, and
each press after it the next (item 148, docs/outcome-light.md).

A message sent to the conversation from the Reader about a message in another
topic carries `about_id`, that message, set by `message.send`. Switching the
Reader's To between This topic and Conversation never merges two drafts. The
writing is everything the person wrote or chose: the words, quotes, the names
it goes to, the choice of Whisper, Tell or Ask, and any image chosen for it.
When the other place's draft holds none of that, the writing moves there whole,
as it is: it is kept in the other draft on the device first, then the draft it
left is emptied, so an interrupted switch leaves it where it was. It moves as
the Reader showed it, so it is the same message there: the author a reply is
offered to stays named, and a Whisper, Tell or Ask the person chose goes with
it. With no choice a reply is a Tell in both places (docs/whispers.md), and a
whisper is never offered this switch, so nothing more is written down. When the
other draft already holds writing, nothing moves: the other draft opens as it
is, the writing just left stays in its own draft, and one line says so ("Your
writing for This topic is kept there."). Writing with images, in any state
(attached, still uploading, failed), never moves; the same line says it stayed.

## Views

`conversation {workspace_id}` (any outcome member): `conversation` is null for
an older outcome not yet started, else `{topic_id, version, coordinator,
new_items, unread, addressed, waits: [{ask_message_id, on, by, since_ms,
item_id, excerpt}], work, replaced: [{topic_id, title}], live}`. `excerpt` is
the ask's first sentence without its leading @names, cut at 160 characters.

`topic_messages` gives every message `about` (null, `{message_id, topic_id,
topic_title, author_id}`, or `{hidden: true}`) and, in a conversation, `item`
(null or `{state: "new" | "settled", takes: [...]}`; consecutive pipeline takes
by one actor are one line). `items: "open"` lists only items not settled.

`workspace_topics` leaves the conversation out; the `topic` view carries
`kind`. The `workspace` view carries `conversation_id` (null for an older
outcome not yet started), so a page that read it keeps the conversation's row
in its place while the conversation's own read is out, and draws nothing there
for an outcome that has none: the row never appears or goes under a finger. Stepping back from version 28 is refused once a conversation exists.
