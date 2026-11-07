# An outcome's conversation

Each outcome has one conversation that never ends: a topic of kind
`conversation`, for asking where things stand and raising friction and
requests. One agent, the outcome's coordinator, answers there; any other agent
answers only an item that names it. Each thing posted there shows what became
of it, as a small tag on its card, and Theseus writes that tag itself, in the
act that did it.

## The page

`?conversation=OUTCOME` is a topic page like any other: the messages, newest
first, with the same cards, New line and counts, and the writing box below
them ("Write to OUTCOME…"). The heading is "Conversation", with what it is for
and who answers under it. A card's tags say New, Answered (with the reply),
Taken into a topic (with the topic), On the pipeline, or Waiting on someone
(with the ask). One filter chip, "Only new (N)", leaves out every card but the
items nothing has settled. Any link to the conversation's topic opens this
page.

## Who is in it

The coordinator is `workspaces.coordinator_id`, chosen by the owner with
`workspace.create`'s `coordinator` or `workspace.coordinator_set` (target
`{workspace_id}`, expected `{workspace_revision}`, args `{actor_id: ID | null}`;
the actor must be on the team). The conversation's participants are always the
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
| `answer` | an answerer replies to the item, unless the reply asks the item's author | the reply's id |
| `topic` | `opening.publish` starts a topic whose `source_message_id` is the item | the new topic's id |
| `pipeline` | the pipeline adds items from it (a seam: `_record_take(db, item, "pipeline", numbers, actor, part, added)`) | the item numbers |

A take settles the item unless it took only part of it: `part: true` on
`message.post`, `draft.save` (`--part` on `post`) or `opening.save` (`--part`
on `start --from`). `part` anywhere else is refused.

An ask there waits on each person it asks until that person replies to that
ask (`reply_to` = the ask), or leaves the team and so can no longer read the
conversation; nothing else clears it. A coordinator the owner replaces stays
on the team and still owes its asks.
The conversation's `topic_waiting` rows follow the open asks, so attention and
the sidebar read its waits as for any topic.

A message sent to the conversation from the Reader about a message in another
topic carries `about_id`, that message, set by `message.send`. Switching the
Reader's To between This topic and Conversation moves the writing: it is
carried into the other place's draft and kept on the device first, then the
draft it left is emptied, so switching back and forth loses no word and Send
sends all of it. Words the other draft already held are kept, first. Writing
with images does not move; To says why.

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
`kind`. Stepping back from version 28 is refused once a conversation exists.
