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
- The departure guard: while a send is under way it waits; otherwise, while any
  reply is in doubt, it names each Review button by its words and leaves on a
  second choice of the same topic with the same replies in doubt.
