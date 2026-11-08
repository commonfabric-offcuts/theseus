# Replies in doubt

A reply the person sent is in doubt while nobody can say it went: its send was
not confirmed, or it was refused. The page shows a "Review N replies" button
only then, and leaving a topic asks for a second choice only then. Both use one
answer, `EditorRegistry.doubt(editor)` in `web/app-session.mjs`.

## What Core answers

- `submissions` and `editor_state` take `unsent: true`. The page then lists only
  the person's replies from that source whose send is not recorded as
  committed (`send_status` `unknown` or `rejected`), oldest first and paged as
  before. However many replies went, this list stays as short as the replies
  that may be in doubt.
- Every `submissions` page carries `through`: the highest `seq` of that
  source's replies when the page was read (0 when there are none). A reply's
  `seq` is its place in that order.
- `submission.prepare` answers with the reply's `seq`, beside its
  `submission_id`.

## The answer

A reply is in doubt unless one of these holds:

- it is known sent: this device confirmed it; the server's page lists it with
  `send_status` `committed` (after Check confirmation); or the list was read to
  its end (`next_cursor` null), does not list it, and its prepare answered a
  `seq` no higher than `through`, so the read could see it and found it sent;
- it is on its way (its send or its correction is under way here);
- it was refused and replaced by a correction this device holds, which then
  answers for its words.

A list not read to its end, or not read at all, is unread: more replies may be
in doubt, so the answer is never "none". The button then reads "Review N+
replies" ("Review more replies" with none known), and its list offers "More
pending replies".

A reply prepared here but never seen by the server's read (its prepare answered
no `seq`, or one above `through`) stays in doubt until Check confirmation
answers for it.

## Who uses it

- The Review button under the topic's title, in the composer and in the Reader.
- The Review list, which lists the replies in doubt (and keeps those it showed,
  so a reply checked as sent says so in place).
- The departure guard: while a send is under way it waits; otherwise, while a
  reply is in doubt and the page shows its Review button, it names each such
  button by its words and leaves on a second choice of the same topic with the
  same replies in doubt.

The guard asks the page which buttons it shows (`TopicNavigation`'s `shown`),
so its words never point at a button that is not there. Each writing's button
has one place: a message's under the topic's title, whether or not its Reader
opened; the topic's own in the composer, whenever the composer shows, loaded
or failed with Retry composer. While the composer is still loading nothing is
drawn for it, and leaving names nothing for it.

The page draws each button when the answer's inputs change:
`EditorRegistry.setPending` is the only write of the server's list and tells
the writing registered for it, and a writing is told as soon as it is
registered. An open of a message's Reader dropped after its read (Escape, or
another message chosen while the step keeps the writing in front) still keeps
that fresher list, and the button shows its answer.
