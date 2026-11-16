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
- A reply set aside (below) is not listed by `unsent: true`, and `through`
  does not change, so a page that prepared it reads it as no longer in doubt.
- A page read with `unsent: true` and a `source_ref` also carries `aside`:
  that writing's replies set aside and not sent, oldest first, each the
  reply's words as `submission` answers them (body, quotes, attachments,
  addressees, whisper, intent) plus `restored`, whether they went back into the
  writing. An older server sends no `aside`, and an older page ignores it.

## Setting a reply aside

A reply prepared and never sent (its send operation has no outcome at all)
stays in doubt for good: Check confirmation can only say it is not known sent.
Its line in the Review list therefore offers **Set aside**, a short word with
its name and a tooltip, 44px to touch on a phone, beside Check confirmation.

- `submission.set_aside` takes `args` `{submission_id, aside}`, and optionally
  `restored`, and no target. `aside: true` sets the reply aside; `aside: false`
  puts it back in doubt (Undo). `restored: true` (only with `aside: true`)
  says its words went back into the writing; without it they are kept on its
  line. Its `operation_id` begins `aside:<submission_id>:`. It answers
  `{submission_id, aside, restored, changed}`; recording what is already so
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
quotes and attachments, and its words are always somewhere on the page: in the
writing, or on its line in the Review list.

- When the writing the reply came from (the topic's composer, or the message's
  writing) is empty, they go back into it as its draft: every field of the
  writing, so who it goes to and how come back with the words. A whisper comes
  back as the same whisper to the same one, never as writing everyone in the
  topic would see; an ask comes back an ask; a name only offered in that
  writing that the reply does not name is not added. Its line says "Its words
  are back in your writing."
- Otherwise its line shows them: its words with Copy, and each image with Open,
  which shows it in place. They stay there once the list closes and after a
  reload, because the line is drawn from Core's `aside` list, not from the
  open list: a writing with no reply in doubt but one set aside whose words
  are only on its line shows a quiet **Set aside N** chip where its Review
  button was (a short word with its name and a tooltip, 44px to touch on a
  phone), which opens the same list. Nothing in it is in doubt.
- The page first records the reply set aside with its words kept on its line,
  and records `restored` only once they are in the writing, so a failure
  between leaves them in both places, never in neither.

Every reply set aside keeps its line, with Undo, whenever the list is open.
Undo puts the reply back in doubt and, while the writing still holds exactly
the words this page put back, empties every field it filled again.

An image goes back as a draft holds one, named by its id (Theseus keeps a
draft's images so, and an image the person chose goes in so), so the draft this
device keeps is the draft Theseus holds: the copy kept on this device is retired
once it is saved, and after a reload the writing is ready to send with nothing
to check in Review versions. Leaving a topic never waits on such an image: the
departure guard holds only an image still on its way to Theseus, never one the
draft names that Theseus already holds, even while the page is still checking
it.

A reply set aside is in doubt no more at once: the Review button stops
counting it, after a reload too and on another device of the same reader,
since each of them reads Core's unsent list.

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
