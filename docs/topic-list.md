# An outcome's topics

Each outcome lists its topics latest activity first, so the topics with
something new or something said about them come to the top and quiet ones sink.
Done topics are listed apart, below the rest, and archived topics apart again.
The web app's topic list (in the sidebar and on the outcome page) and the CLI's
`topics` verb both show the server's order.

## Activity

A topic's activity time, `activity_ms`, is the later of two facts the server
records:

- when its newest message was sent (`sent_ms`), and
- when someone last said where it stands (`state_ms`): any `topic.update` that
  gives a state, a note or who it waits on, even one that repeats the state.

Renaming a topic, archiving it or bringing it back, reading it, marking a
message, joining or leaving it, and a hosted turn in it are not activity. The
time is kept on the topic row in the same transaction that sends the message
or says the state, and it never goes back: a later act with an earlier clock
leaves it as it was. Topic reads and list items carry it.

Schema version 18 adds `activity_ms`, worked out on upgrade from each topic's
newest message and its state time (0 for a topic with neither, which sorts
last), the index the lists read, and `state_message_id` (below). Stepping back
to 17 drops the activity times, which the next upgrade works out again, and is
refused once any topic was reopened by a message, since that record would be
lost.

## A message in a done topic

A new message in a done topic brings it back among the active ones, in the
same transaction that sends the message: its state becomes `active`, said by
the message's author (`state_by`) at the message's send time (`state_ms`),
with the note "Reopened by a new message" and `state_message_id` naming the
message. A post, a prepared send and a reply all do this; a refused send
changes nothing. A message in a topic that is active, waiting or ready for
review leaves its state as it was. The next `topic.update` that says where the
topic stands replaces all of it and clears `state_message_id`. Topic reads and
list items carry `state_message_id`, null for a state someone said.

## `workspace_topics`

- `args`: `{workspace_id, cursor, limit, archived, done}`. `archived` and
  `done` are optional booleans, default false, and may not both be true.
- With neither, it lists the outcome's topics that are neither done nor
  archived. With `done: true`, the done ones that are not archived. With
  `archived: true`, every archived topic, done or not: the ones not done
  first, then the done ones.
- Each list is ordered by `activity_ms`, latest first, and then by topic id,
  descending, so topics with the same time keep one order.
- `next_cursor` is the position of the page's last topic, written
  `DONE:ACTIVITY_MS:ID` (`DONE` is 1 for a done topic); pass it back as
  `cursor` for the next page; an empty cursor is the start. Any other cursor
  is refused (`INVALID_ARGUMENT`).
  A topic whose activity changes between pages moves; a reload reads the list
  again from its start.
- Every page carries `groups: {done, archived}`, how many topics the done list
  and the archived list hold, so a client can say "Done (3)" without reading
  them.
- Each page, and each count, is read from one index on (outcome, archived,
  done, activity time, id), so its cost follows the page, not the outcome's
  history.

## In the web app

The topic list in the sidebar, and on the outcome page, shows the topics that
are neither done nor archived, in the server's order, with More for the next
page. Below them a "Done (N)" line and an "Archived (N)" line, closed at first,
each open to list theirs (with their own More); a line whose list holds no
topic is not shown. N is the server's count from the latest list read. A closed
line's list is not read; an open one is read again with the rest after each
commit. Whether each line is open is kept for the person on this browser
(`localStorage`, per instance and person); without storage each starts closed.

The open topic's row sits in the list its own state puts it in, in its place
by activity, before the lists are read again. A topic that two lists hold,
because it moved between their reads, shows once, in the list read last.

## The CLI

`topics OUTCOME` prints the topics that are neither done nor archived, latest
activity first, then `done (N):` and the done ones, then, when there are any,
`archived (N): topics OUTCOME --archived`. `topics OUTCOME --archived` prints
the archived list.
