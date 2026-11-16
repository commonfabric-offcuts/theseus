# Replies in doubt

A reply the person sent is in doubt while nobody can say it went: its send was
not confirmed, or it was refused. The page shows a "Review N replies" button
only then, from one answer, `EditorRegistry.doubt(editor)` in
`web/app-session.mjs`. A reply in doubt never holds the reader on the page: it
is kept, in Core and on this device, through a reload and a move, and its
button is there when the reader comes back.

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

A reply is settled by its own ids alone: its submission id, the operation that
sent it, and the receipt for that operation. Another reply with the same words
or the same pictures settles nothing, and a reply's own receipt settles it
whatever its words.

## Who uses it

`EditorRegistry.inDoubt` is the one answer for a page: one entry for each
registered writing with a reply in doubt, in the order the writings
registered, with `doubt()`'s ids and the words of its button. It reads only
what the registry holds now: its registered writings, their replies, the sends
under way and the server's lists. An editor that is not registered (one a
recovered version replaced, say) is in doubt about nothing, and the server's
list cannot be read or changed through it.

- The page draws one Review button for each entry, in its words, and nothing
  else. A message's writing has its button under the topic's title. The
  topic's own writing has its button in the composer while the composer shows
  (loaded, or failed with Retry composer), and under the title until then. The
  Reader also shows its own writing's button.
- The page draws them all again whenever it is told of a change (each
  registration, each change to a list, each change to a writing or its sends),
  whichever writing the notice names, so a notice about a replaced writing
  draws the registered one's button.
- The Review list lists the replies in doubt of the writing registered under
  the button's key, read again from the registry at every draw and every act
  (and keeps those it showed, so a reply checked as sent says so in place).
- The departure guard (`web/topic-navigation.mjs`) waits while a send is under
  way, and while writing or chosen pictures are not yet safe on this device or
  in Theseus. A reply in doubt holds nothing: the first choice of a topic or an
  outcome leaves, sending nothing and discarding nothing, and says nothing.
  Asking every time made a loop of warnings the reader could only click
  through, and its notice stayed over the rail (item 547). On coming back, a
  reply Core took whose answer was lost is settled, and one with the same words
  that never went stays in doubt (`outcome_rail_native.mjs`, "rail a reply
  whose send is not confirmed holds no move …").

An open of a message's Reader dropped after its read (Escape, or another
message chosen while the step keeps the writing in front) still keeps that
fresher list, and the button shows its answer.
