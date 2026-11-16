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
- A reply set aside (below) is not listed by `unsent: true`, and `through`
  does not change, so a page that prepared it reads it as no longer in doubt.

## Setting a reply aside

A reply prepared and never sent (its send operation has no outcome at all)
stays in doubt for good: Check confirmation can only say it is not known sent.
Its line in the Review list therefore offers **Set aside**, a short word with
its name and a tooltip, 44px to touch on a phone, beside Check confirmation.

- `submission.set_aside` takes `args` `{submission_id, aside}` and no target.
  `aside: true` sets the reply aside; `aside: false` puts it back in doubt
  (Undo). Its `operation_id` begins `aside:<submission_id>:`. It answers
  `{submission_id, aside, changed}`; setting aside a reply already set aside
  changes nothing (`changed: false`), and the same operation again answers its
  first receipt.
- Only the reply's author can: another reader's act is refused `FORBIDDEN`,
  as every read of someone else's reply is. A reply whose send is recorded
  committed went, so it is refused `ALREADY_SENT`, either way. A send under
  way on this page is the page's to wait for: it offers no Set aside then.
- A reply set aside whose send later shows committed is simply sent.

### How it is recorded, with no schema step

The `submissions` table is immutable (its triggers abort any update or
delete), so a reply's row and metadata never change. Setting aside is the
person's own committed operation in `operations`, the journal every command
already writes: the unsent list leaves a reply out when the latest committed
`submission.set_aside` operation naming it says `aside: true`. The operation
ids begin with `aside:<submission_id>:` so that read is a range of the
operations table's own key (actor, id), however long the person's history; it
then checks the submission id the receipt names, so one id beginning another's
is not confused with it. No table, column or index is added, and
`SCHEMA_VERSION` does not move.

It is backward and forward compatible: an older server never sees the
command (it refuses it `UNKNOWN_COMMAND` and records nothing), and an older
page reading a newer server sees only a shorter unsent list, which it already
reads as replies known sent. The `submission` view keeps its shape exactly (a
page checks it field for field), so whether a reply is set aside is said only
by the unsent list.

### The words are kept

Setting a reply aside never deletes anything: the submission keeps its words,
quotes and attachments. When the writing the reply came from (the topic's
composer, or the message's writing) is empty, they go back into it as its
draft, attachments too, and the line says "Its words are back in your
writing." Otherwise the line shows them, with Copy. Either way the line offers
Undo, which puts the reply back in doubt and, while the writing still holds
exactly the words put back, empties it again.

A reply set aside is in doubt no more at once: the Review button and the
departure guard stop counting it, after a reload too and on another device of
the same reader, since all of them read Core's unsent list.

## The answer

A reply is in doubt unless one of these holds:

- it is known sent: this device confirmed it; the server's page lists it with
  `send_status` `committed` (after Check confirmation); or the list was read to
  its end (`next_cursor` null), does not list it, and its prepare answered a
  `seq` no higher than `through`, so the read could see it and found it sent;
- it is on its way (its send or its correction is under way here);
- it was refused and replaced by a correction this device holds, which then
  answers for its words;
- it was set aside (see "Setting a reply aside").

A list not read to its end, or not read at all, is unread: more replies may be
in doubt, so the answer is never "none". The button then reads "Review N+
replies" ("Review more replies" with none known), and its list offers "More
pending replies".

A reply prepared here but never seen by the server's read (its prepare answered
no `seq`, or one above `through`) stays in doubt until Check confirmation
answers for it.

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
- The departure guard asks the page for the buttons it draws now and words its
  question with them: while a send is under way it waits; otherwise, while any
  entry is there, it names each button by its words and leaves on a second
  choice of the same topic with the same replies in doubt. Its rule and its
  words are that same answer, so they name a button exactly when the page
  shows one.

An open of a message's Reader dropped after its read (Escape, or another
message chosen while the step keeps the writing in front) still keeps that
fresher list, and the button shows its answer.
