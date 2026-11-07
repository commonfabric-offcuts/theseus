# Whispers

A person can whisper to one agent. Only the two of them ever see it, in every
read, and the agent's answer is a whisper too. A whisper is a question, never
an instruction, and it never makes a topic wait on anyone.

## Writing

`message.post` and `draft.save` take `whisper` (true or false, default false)
beside `body`, `addressees`, `reply_to`, `quotes` and `attachments`; a draft
carries it into `submission.prepare` and `message.send`. A whisper names
exactly one addressee, its other person, and no `intent`.

| Code | When |
| --- | --- |
| `WHISPER_SHAPE` | Other than one addressee; a person whispering to a person; an agent whispering other than to answer a whisper sent to it, to the person who sent it; a whisper answering a whisper between a different pair; a whisper with an intent; a whisper on writing that opens a topic (`opening.save`, or `draft.save` with a new-topic source or an `opening`). |
| `WHISPER_STAYS_PRIVATE` | A message on the record replying to a whisper; quoting a whisper other than into a Tell by the person in it, or into a whisper between the same two; a whisper as a topic's source, as Notebook evidence, or as where a pipeline item came from or what it is still gathering (`pipeline.item_add`, `pipeline.source_add`, `pipeline.item_edit`). |

A reply, quote or source the writer cannot see is refused as one that does not
exist, so no refusal names a whisper to anyone outside it. Writing in the
Reader about a whisper that is sent as a Tell goes as a new message, quoting
only what was selected; it answers nothing.

## What a whisper leaves alone

A whisper reaches its one other person as an addressed delivery and wakes
them as any addressed message does. It changes nothing anyone else can see:
the topic's version, latest message, count, activity and order, a done
topic's state, who waits on whom, who has written in the topic, and the work
ring. Each of the two gets an actor-scoped change `whisper` whose
`resource_id` is the topic and whose `version` is the message's sequence; the
topic page reads its reader's own scope on each commit to show a whisper as
it arrives.

## Reading

`topic_messages` items carry `whisper` and, for a whisper, `private_to`; the
viewer's own whisper with no whisper reply yet carries `no_answer: true`. A
reply whose parent the viewer cannot see has no `reply_to_author` or
`reply_to_excerpt`. `source` carries `whisper` and `private_to`, and a quote of
a whisper read by someone outside it keeps its excerpt with `source: null`.
Delivery items carry `message.whisper`. `wakes` counts, for every reader but
the agent itself, only deliveries on the record, and leaves out an agent whose
pending work is whispers alone.

## Limits

The database file is outside this boundary: anything that opens the SQLite
file directly reads every row, as it reads drafts and private notes. A
Notebook page is free writing, so Core cannot stop an agent paraphrasing a
whisper there.

Schema version 27 adds `messages.private_to`, the `message_reply_links`
index and the `whisper_shape` trigger. Stepping back to 26 is refused once a
whisper exists, since release 22 would show it to everyone.
