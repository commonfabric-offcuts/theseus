# Topics started from a message

One question, one topic. A new topic can name the message it answers, its
source, and whoever starts another topic from the same message sees the
first ones before sending. Two people who open topics for the same discussion
seconds apart are both told: the check runs where the topic is created.

## Schema version 18

`topics` gains `source_message_id TEXT REFERENCES messages(id)`, with the
partial index `topic_sources ON topics(source_message_id,id) WHERE
source_message_id IS NOT NULL`. The step back to 17 runs only while no topic
names a source and no open opening's payload names one.

## Commands

- `opening.save` accepts an optional `source_message_id` beside the whole
  writing. The first save names it (a message the author can read, else
  `FORBIDDEN`, recorded); every later save keeps it. A later save may leave
  it out, as a page from before this field does; one that names a different
  source, or `null` where one is kept, is `INVALID_ARGUMENT`. The opening's
  payload keeps it, and the `opening` view returns it (`null` when none).
- `opening.publish` accepts `args: {}` or `{seen: [topic ids]}`, at most
  `page_max` of them. For an opening with a source, Core counts the topics
  already started from that message that the author can read and `seen` does
  not name. If there are any, the publish is refused with `ALREADY_STARTED`,
  recorded, naming the first few; nothing is created and the opening stays
  open. Publishing again with them in `seen` goes ahead. `seen` on an opening
  without a source is `INVALID_ARGUMENT`. The new topic records its
  `source_message_id`, which the `topic` and `workspace_topics` views carry.
- `opening.discard` still takes `args: {}` only.

## View

`source_topics` with `{message_id, cursor, limit}` lists, in id order, the
topics started from that message that the reader can read, as `{id,
workspace_id, title, title_truncated, creator_id, state, archived,
message_count, latest_seq}`, with the answer's `message_id`. A message the
reader cannot read is `FORBIDDEN`. A topic the reader cannot open is neither
listed nor counted: it is not one they could continue in.

## Clients

- CLI: `start OUTCOME --title T --from MESSAGE [--seen T1,T2] TEXT` reads
  `source_topics` first; when it lists topics `--seen` does not name, it
  prints them and refuses with `ALREADY_STARTED` before saving anything.
  Otherwise it saves the opening with its source and publishes with `seen`.
  `publish OPENING [--seen T1,T2]` passes `seen` through.
- Page: the Reader offers "Start a topic from this" on a message. The new
  topic's page says which message it answers and lists the topics already
  started from it, with links; Send names those as seen. If another topic
  started meanwhile, Send is refused, the list is read again, and the next
  Send goes ahead. The page's link carries the message as `opening_from`
  (`?workspace=W&opening=O&opening_topic=T&opening_from=M`); Core's own record
  of the opening's source wins once it has one.
