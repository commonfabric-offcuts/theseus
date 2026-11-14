# Editing a message

A person can fix the words of their own message after sending it (item 228).
Everyone then reads the new words, marked "Edited". Each agent that can read
the message is sent one correction, so an agent that acted on the old words
knows to read them again. Core keeps every revision; the message itself never
changes.

This is how an edit keeps the rule that attributed messages remain immutable
and corrections are separate acts (AGENTS.md): the message's row, with its
first words, is never changed or removed; each edit is a new, attributed row
of `message_revisions`, written once by its author's operation; and what an
agent is told of it is a delivery of its own, a correction, never a change to
the delivery it already had.

## What an edit changes, and what stays

An edit appends the message's next revision of its words to
`message_revisions`. Revision 1 is the message's own row, which stays
byte-identical: the triggers that refuse an UPDATE or DELETE of `messages`
still hold. Revisions are never changed or removed either.

Only the words change. The message keeps its id, author, sequence, sent time,
topic, reply_to, addressees, intent, attachments, the quotes it carries, its
reactions and its deliveries. No topic version, count, wait, ask, horizon or
fold moves. An ask that was already answered (👍, ✅ or 🚫) or used as a
go-ahead stays editable: what was done on it stands, and a go-ahead check reads
the latest words when it runs.

Every read of a message's words goes through one helper in
`aim_next/message_edit.py` (`words`, `words_at`, `current_words`): the topic
page, the source, a reply's line, delivery previews, the excerpts of asks,
stars, blocking asks, conversation waits and check accounts, and the word a
pipeline move is made on. `tests/test_message_words.py` fails on any other read
of `messages.body`, SQL built in pieces included: it reads each string as the
text it makes, with the names, constants (from this module or the one they were
imported from) and functions it uses resolved to the strings they hold.

## `message.edit`

```json
{"kind": "message.edit", "target": {"message_id": "m-…"},
 "expected": {"message_revision": 1}, "args": {"body": "The new words"}}
```

`expected.message_revision` is the revision the editor started from, and is
required. Checks run in this order:

1. The words are within the body limit; otherwise `BODY_TOO_LARGE`, recorded
   like every refusal of a write's words, so the same operation id returns it
   again.
2. The actor must reach the message (`_message_access`). A whisper they are not
   in, or a message they cannot read, is refused `FORBIDDEN` exactly as an
   unknown id.
3. The actor is a person; an agent is refused `FORBIDDEN` "Only people edit
   messages".
4. The actor wrote it; otherwise `FORBIDDEN`.
5. Its outcome is not reached; otherwise `OUTCOME_REACHED`.
6. The message stands at the expected revision; otherwise a recorded
   `REVISION_CONFLICT` with `current_versions: {message_revision: N}`.
7. Words or an attachment remain; otherwise `EMPTY_MESSAGE`.
8. The words differ from the current ones; otherwise `INVALID_ARGUMENT`, not
   recorded.

The receipt's result is `{message_id, revision, edited_ms, corrections}`
(`corrections` is how many agents were sent one), and `affected` is
`{kind: "message", id, version: revision}`. A retry under the same operation id
returns the same receipt and adds nothing; the same id with other words is
`OPERATION_PAYLOAD_MISMATCH`.

## Who is told

Everyone who can read the message (`_message_readers`: whoever reads its
topic, whoever it was sent to by name, or a whisper's two people), the editor
included, gets an actor-scoped change `edit` keyed by the message id at its new
revision. An open page refreshes the message from it (below).

Each agent among them, other than the editor, is sent a **correction**: a
delivery of the message at the new revision (`deliveries.revision`), with
reason `correction`, in the agent's one delivery group of kind `correction`.
People never get one. A whisper's correction goes to the agent it was
whispered to, and to nobody else.

A correction is the agent's work, so it wakes the agent and lists in
`deliveries`, `inbox`, `watch` and the hosted notice. It is never unread,
addressed, counted, shown in attention, read through or thumbed away, because
every one of those reads only the `direct` and `subscription` groups, and every
lookup of a message's delivery to someone reads revision 1. It is settled only
by:

- an `ack` of its own delivery id;
- a newer correction of the same message to the same agent;
- the agent losing the message: the write that removes them from the outcome's
  team, the topic or the outcome's conversation settles their corrections of
  messages they can no longer read, and an edit settles the corrections of
  agents who are no longer readers. The `deliveries` view also leaves out a
  correction whose message the agent cannot read, and the `delivery` view
  refuses it. A message sent to the agent by name stays readable to it, so its
  correction stays.

Today only three writes take a message from an agent: `workspace.member_set`
(leaving the team), `participation.set` with `present: false` (leaving the
topic) and the outcome's conversation following its team. Each settles the
corrections it makes unreadable in its own transaction, so the counts that
schedule a wake (`delivery_groups.pending_count`,
`recipient_schedule.pending_count` and `next_due_ms`) stay true.
`workspace.owner_set` keeps the old owner on the team, so it takes nothing.
Should a later write take a message away without settling, the wake's claim
settles every correction its agent can no longer read before it hands any
work, and claims nothing when that was all there was: no preview, stale count
or repeated wake comes of it.

A disabled agent among the readers is a reader: its correction waits, pending,
while it is disabled, and it is woken for it once it is enabled again.

Slice 1 sends a correction to every agent that can read the message, whether
or not it was ever handed the old words. Knowing exactly which agents saw them
comes with slice 2, with holding a message while it is open in Edit.

### What an agent sees

The hosted notice names a correction in Core's words, before any whisper line:

> 1. correction: message m-… by tony was edited to revision 2; not a new ask,
>    Tell or reply; read it, act on its latest words, then ack delivery d-….

For a whisper it adds the whisper's privacy sentence and does not say it counts
as a Tell. The new words travel only in the untrusted context, as every
preview does. The thread instructions carry the same rule.

The CLI prints it as

```
correction "Release notes" #43 owner edited m-5c0… to revision 2: Can you check the second draft?  [d-7e2… in t-9a7…]
```

and `read` prints an edited message's latest words with
"(edited, revision N)" after its heading.

## Reads

- `topic_messages` items, in every form, carry `revision` (1 when never
  edited) and `edited_ms` (null when never edited), and their body is the
  latest words. A reply's `reply_to_excerpt` is the first 120 characters of the
  latest words of the message it answers.
- `topic_messages` takes `message_ids: [id, …]` with `topic_id` alone (with
  `cursor`, `direction`, `limit`, `items` or `audience` it is
  `INVALID_ARGUMENT`), one to 100 ids, duplicates collapsed, and returns those
  items in page shape, in sequence order. As `stack_positions` does, each id is
  first checked for reach: an unknown id, a whisper the reader is not in, or a
  message the reader cannot read, wherever it is, refuses the whole view
  `FORBIDDEN` "No readable source", so its existence never shows; a readable
  message of another topic refuses it `INVALID_ARGUMENT`.
- The `source` view carries the latest words, `revision`, `edited_ms`, and
  `version` and `current_revision` equal to the revision.
- A delivery item's `message` carries `revision` and `edited_ms` of the words
  it previews. A correction's item adds `correction: {revision}`, and its
  preview is the words of that revision.

## Quotes

A quote of a message names, in its `source`, the revision it quoted:
`{kind: "message", id, revision}`; the Reader names the revision it showed when
the words were selected. A revision that is not an integer, is a boolean, or
is not one of the message's revisions (revision 1 is the message's own words),
or one whose words lack the excerpt, is refused `INVALID_QUOTE`. The quote is
stored with the revision it named, even when a later revision has the same
words. A quote that names no revision, written by
a page from before edits, may quote any revision, and is kept without one;
Core never fills in the newest. Quotes already stored are never changed.

## Storage

Version 40 adds `message_revisions(message_id, revision > 1, author_id,
operation_id, body, edited_ms)`, keyed by message and revision and unique by
author and operation, and builds `deliveries` again with
`revision INTEGER NOT NULL DEFAULT 1` and `UNIQUE(message_id, recipient_id,
revision)`, keeping every row, its id and seq, where the next seq goes on from,
its indexes, the trigger that requires a delivery's topic, and every
`delivery_reasons` row. Stepping back to 39 is refused once any message has
been edited.

## The web page

Edit is in the ⋯ menu of a message the person wrote themselves, on a feed card,
a row of a reply stack (dossier) and in the Reader. Only people see it, and not
when the topic can no longer be read or its outcome is reached (the outcome's
light says reached). From a card or a row the Reader opens on the message and
turns to its edit mode; from the Reader's ⋯ it turns in place. The message's
words become a field, with Save (⌘Return) and Cancel under it. A reply being
written beside it is left as it is, and ⌘↑, ⌘↓ and the step buttons do
nothing while it edits. When the edit ends the focus goes back to where Edit
was chosen: a Reader opened for the edit closes onto the card.

The base revision and its words are fixed when Edit opens. The draft is kept
on this device, in IndexedDB under a Web Lock (one tab edits a message at a
time), and the whole request of a Save is kept there before it is sent
(`web/message-edit-writing.mjs`).

- **Cancel** lets the draft go: the device copy is cleared and the message
  shows its saved words.
- **Escape**, or closing the Reader, keeps the draft with its base revision.
  The next Edit of the message brings it back on that base; if the message was
  edited since, its Save meets `REVISION_CONFLICT`.
- **Unchanged**: words equal to the base end the edit and send nothing.

What the edit mode shows (`web/message-edit.mjs`):

- **editing**: the draft, and "Kept on this device" once it differs.
- **empty**: Save is off while a message with no images is blank; if Core still
  answers `EMPTY_MESSAGE`, the words stay.
- **saving**: the field reads only, and "Saving…"; Save and Cancel wait.
- **saved**: the new words show with "Edited", the device copy is cleared, and
  the focus goes back.
- **conflict**: "This message was edited elsewhere" over the saved words, with
  Save mine (the draft as a new operation on the newer revision; if the draft
  is the saved words, the edit ends unchanged and sends nothing) and Use saved
  (the draft goes).
- **uncertain** (no answer came): "Not known whether this was saved: Theseus
  did not confirm it." Try again first asks Core what it recorded for the
  operation (`view('operation')`), and sends the same kept request only if it
  recorded nothing. A reload while saving does the same.
- **busy**: "Not saved: Theseus was busy." Try again sends the same request,
  under the same operation id.
- **too long**: `BODY_TOO_LARGE` shows "Not saved: too long"; the words stay
  in the field and on the device, and changed words go as a new operation.
- **refused**: any other refusal shows Core's own words, the words kept; where
  Core will not take an edit of this message from this person now (FORBIDDEN,
  OUTCOME_REACHED), Save is off and Cancel leaves.

A message's author line, and the Reader's provenance, say "Edited" once it has
been.

### How an open page learns of an edit

Every reader of the message, the editor's other tabs included, hears the
actor-scoped `edit` change (`web/freshness.mjs`). A page that shows the
message, or a loaded reply to it whose line shows its words (the page reads
only its newest messages, so a reply can be loaded while the message it
answers is not), or whose conversation holds either, reads it with
`topic_messages {topic_id, message_ids: [id]}` and, if it comes back at a later
revision, repaints: the card's words, its excerpt cue and folded line,
"Edited", the reply line of each loaded reply to it, the conversation's own
copy of the message and of each reply to it, the stacks, an attention row
showing it (a whole message read there is read again), and an open Reader on
it, in place, unless that Reader is editing it (then its Save meets the
conflict). A message only a reply's line shows is not taken into the page:
paging up reads it. A revision lower than the one held, or than the latest
read for a reply's line, is ignored. If the read is refused, the card stays as
it is and the page goes on.

The right rail keeps each topic's newest messages, and the previews and pull
requests read from their words, by the topic's version, which an edit does not
move; the topics holding the edited message are read again. The cards page's
talk counts (`web/deck-page.mjs`) hold how many replies a stack has and how
many are unread, never words, and are read afresh on every load. A page started
from a message (`web/opening.mjs`) reads its source once when it opens, as it
always has, and its quote names no revision.

## Stated limits of slice 1

- **The edit draft lives on one device.** It cannot be resumed on another
  device, short of "any device can resume it" (docs/VISION.md); slice 2 keeps
  it in Core.
- **Old tabs need a reload.** No deploy reloads an open page, so a tab loaded
  before this release stops its live updates for a topic once a message in it
  is edited, until it is reloaded. A page of this release takes a later
  revision and goes on.
- **A delivery is not a page.** A person whose only way to the message is a
  delivery sent to them by name, without the topic, sees the new words the
  next time they open it; live only where a page of theirs already lists it
  under "Sent to you by name".
- **Every agent reader is corrected.** Until slice 2 every agent that can read
  the message gets a correction, whether or not it was ever handed the old
  words.
