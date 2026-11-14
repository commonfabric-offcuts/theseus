# Editing a message

A person can fix the words of their own message after sending it (items 228
and 452). Everyone then reads the new words, marked "Edited". Each agent that
was handed the old words is sent one correction, so an agent that acted on
them knows to read them again. While the person has the message open in Edit,
agents are not handed it at all: it is held until they save or leave the
edit. Core keeps every revision; the message itself never changes.

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
required. `args` is `{body}` or `{body, holder}`: a page that opened an edit
session (below) names its holder, and a Save by the session's holder ends the
session. A holder that is not an identifier is `INVALID_ARGUMENT`. Checks run
in this order:

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

The receipt's result is `{message_id, revision, edited_ms, session_closed,
corrections}` (`corrections` is how many agents were sent one;
`session_closed` is true when this Save was the holder's and ended the
session, and then `session_revision` gives the session's new revision), and
`affected` is
`{kind: "message", id, version: revision}`. A retry under the same operation id
returns the same receipt and adds nothing; the same id with other words is
`OPERATION_PAYLOAD_MISMATCH`.

## Who is told

Everyone who can read the message (`_message_readers`: whoever reads its
topic, whoever it was sent to by name, or a whisper's two people), the editor
included, gets an actor-scoped change `edit` keyed by the message id at its new
revision. An open page refreshes the message from it (below).

Each agent among them, other than the editor, that was **handed the old
words** is sent a **correction**: a delivery of the message at the new
revision (`deliveries.revision`), with reason `correction`, in the agent's one
delivery group of kind `correction`. An agent reader that was never handed
them gets nothing: it reads the new words the next time it reads the message.
People never get one. A whisper's correction goes to the agent it was
whispered to, and to nobody else.

### What counts as handed

Core records, per agent and per person's message, the highest revision whose
words left the store in an answer to that agent (`message_exposures`). An agent
was handed the words when it has such a row, or when the message was sent at
or below the horizon: the last message sequence when version 41 was applied,
before exposures were kept, so every agent reader of an older message counts
as handed.

The record is made at the boundary every agent view passes through
(`Store._hand_over`):

- The words helper marks the words it returns in an agent view: a marker
  (U+E000, the view run's random nonce, a token number, U+E001) before each
  message's words, naming the message and the revision they are. Only words
  the view returns are marked: a read that measures, decides or cuts (a page's
  size bound, a go-ahead check, a preview's cut) reads them plain, and marks
  only what it hands out.
- At the boundary every marker of that run is taken out of the answer, keys
  included, and each one found names a pair (message, revision). A stored
  quote of message M in a returned message M′ counts as handing M at the
  quote's revision (1 when it names none) when the part of the answer that
  follows M′'s marker holds the first line of that quote (whitespace
  collapsed, its first 40 characters). A marker that was cut or rewritten
  never leaves: the view fails with a store error and returns nothing.
- A pair grows the record when the message is a person's, the revision is
  above the one recorded, and it is not revision 1 of a message at or below
  the horizon. If none grows, the read returns as before, with no write. If one
  does, the read is rolled back and run again under `BEGIN IMMEDIATE` on the
  same connection, at a fresh clock, and its answer and its record commit
  together, so no Save can commit between the words returned and the record of
  them. A read that meets a Save's open write is `DATABASE_BUSY`, retryable,
  and hands nothing.

What an agent is handed is exactly what the store answered it. A client that
shows the agent less than it read (the hosted notice previews 20 of the
deliveries it reads; the assessment read tool passes on some fields) still
counts what it read, so it may correct more than needed, and never misses one.
A person's reads record nothing.

### Corrections

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

A Save by a device that does not hold the edit leaves the message held (below):
its corrections are queued in the state `held`, and an older held correction
of the same message is settled, as a newer correction settles an older one.
They become pending when the hold ends.

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

A message its author has open in Edit is held from agents (below). `read` and
`source` print "(held: its author is editing it)" in place of its words, an
excerpt or line of it prints "(held)", `ack` of its delivery prints the
`MESSAGE_HELD` refusal, and `watch` prints
`delivery held while its author edits it  [d-…]` and waits on past it, until
the release's delivery change prints it as a delivery.

## Reads

- `topic_messages` items, in every form, carry `revision` (1 when never
  edited) and `edited_ms` (null when never edited), and their body is the
  latest words. A reply's `reply_to_excerpt` is the first 120 characters of the
  latest words of the message it answers. Every item carries `withheld` and
  `reply_to_withheld`; for an agent, a held message's item comes without its
  words (below).
- `topic_messages` takes `message_ids: [id, …]` with `topic_id` alone (with
  `cursor`, `direction`, `limit`, `items` or `audience` it is
  `INVALID_ARGUMENT`), one to 100 ids, duplicates collapsed, and returns those
  items in page shape, in sequence order. As `stack_positions` does, each id is
  first checked for reach: an unknown id, a whisper the reader is not in, or a
  message the reader cannot read, wherever it is, refuses the whole view
  `FORBIDDEN` "No readable source", so its existence never shows; a readable
  message of another topic refuses it `INVALID_ARGUMENT`.
- The `source` view carries the latest words, `revision`, `edited_ms`,
  `withheld`, and `version` and `current_revision` equal to the revision.
- A delivery item's `message` carries `revision` and `edited_ms` of the words
  it previews. A correction's item adds `correction: {revision}`, and its
  preview is the words of that revision.
- A page's size bound measures the words, never the markers an agent view puts
  on them.

## Holding a message while it is edited

Opening Edit on a message holds it from agents until the person saves, leaves
the edit, or stops touching it for `edit_hold_ms` (2 minutes; capabilities'
`limits`), so no agent is handed words that are about to change.

### Edit sessions

A message has at most one edit session (`message_edit_sessions`), owned by its
author. A page names its device by a `holder`, an identifier of its own; the
session's `revision` moves with every session command, and each writes an
actor-scoped change `edit_session`, keyed by the message at that revision, to
the author.

- `message.edit_open {message_id} args {holder}`: checks as `message.edit`'s 2
  to 5 (reach, a person, the author, an outcome not reached). A session that
  was saved or closed, or none, starts again: its base is the current revision
  and its draft the current words. An open one, held or lapsed, is taken by
  this holder (`taken` is true when another device held it) and keeps its draft
  and base, so any device resumes it. It renews the hold. The result is
  `{message_id, session_revision, holder, taken, base_revision, base_words,
  draft, revision, words, renewed_ms, hold_ms}`.
- `message.edit_draft {message_id} expected {session_revision} args {holder,
  body, base_revision}`: the words' size first (a recorded `BODY_TOO_LARGE`,
  before access, as a Save's), then checks 2 to 5, then `EDIT_CLOSED` when no
  session is open and `EDIT_TAKEN` "This edit is open on another device" when
  another device holds it (neither recorded), then the session revision (a
  recorded `REVISION_CONFLICT`), then a base that is one of the message's
  revisions. It keeps the draft in Core and renews the hold; one after a
  released lapse holds again. Its result is `{message_id, session_revision,
  renewed_ms}`.
- `message.edit_close {message_id} args {holder}`: by the holder, ends the
  session as `closed`, lets its draft go and releases the hold: `{closed: true,
  session_revision}`. With no open session it changes nothing and writes no
  change: `{closed: false}`. By another device it is `EDIT_TAKEN`, not
  recorded, and nothing is released. It checks reach, a person and the author,
  not the outcome, so a hold can always be ended.
- The holder's Save (`message.edit` with its `holder`) ends the session as
  `saved` and releases the hold before any correction is queued. A Save by
  another device commits by revision and leaves the session open.

### What holding does

While the session is open and not released (holding), every agent delivery of
the message that is not settled is in the state `held`: the same row, with the
same id, seq, group, revision and reasons, counted nowhere. Opening Edit moves
pending rows to `held` and uncounts them as an acknowledgment would; it is not
an acknowledgment, so it writes no change or operation, settles nothing and
answers no wake. A delivery queued while the message is holding (a correction
from another device's Save) is queued `held`. People's deliveries are never
held.

Every count, list and schedule reads only `pending`, so a held delivery leaves
the agent's inbox, counts, attention and Health's waiting work, and the
scheduler sees its departure; if it was all the agent had pending, the agent
has nothing due. In agent views, while the session was renewed within
`edit_hold_ms` (held):

- `topic_messages` items of the message keep their id, seq, author, intent,
  addressees, reply_to, revision and edited time, with `withheld: true`, body
  "", `preview: false` and no attachments; a reply to it has
  `reply_to_withheld: true` and no `reply_to_excerpt`.
- `source` has `withheld: true`, body "", and no attachments or quotes; a
  stored quote of a held message in another message's source has excerpt ""
  and `withheld: true`. Outside a view (a command, `open_media`) the hold is
  decided by the same clock.
- Every excerpt or line entry carries `withheld`, with the words "": attention
  blocking lines, the pipeline's held lines and asks, conversation waits,
  stars, check asks and the check account.
- `topic_images` leaves its images out, and `media` and `open_media` through it
  are refused `MESSAGE_HELD`.
- `delivery` of a held delivery, `delivery.ack` of one, `opening.publish` from
  it with nothing written, and a pipeline move made on it (or on a reply to it)
  are refused `MESSAGE_HELD`, not recorded: "m-… is being edited by its author
  and is held until they save or leave the edit (at most 2 minutes). Nothing
  was done." Quoting it, or replying to it, is not refused.

Access is unchanged: a held delivery keeps its reasons, so an agent sent the
message by name keeps exactly the access it had.

### Release

The hold ends with the holder's Save, the holder's close, or a lapse a write
observes (no timer runs). Release makes each held delivery pending again, the
same row, counted as an arrival, and hands it back: a turn that was told of it
before the hold is told again (`handed_seq` is cleared when it covers the
row), and the agent is due now, or when its live claim ends. It writes a
`delivery` change at version 1 for each row, so `watch` prints it as it
arrives. A row whose group closed during the hold (its agent left the topic)
becomes pending uncounted, as the rows a cancelled subscription leaves.

A lapse is released by the runner's next `claim_wakes`, which the runner sleeps
until (`_next_due` counts the earliest hold end of a held delivery to an agent
it serves), or by an `ack` of the delivery, which releases first in the same
commit. A turn whose claim was taken while the delivery was held, and which is
handed after the release, is handled as a stale start (the release time is
not before the attempt started), so the delivery is due again at once rather
than after the turn ends. Between a lapse and the write that releases it,
views already show the words but the deliveries stay held.

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

Version 41 adds `message_edit_sessions` (one row per message: holder,
revision, base revision, draft, state `open`, `saved` or `closed`, renewed and
released times), `message_exposures(actor_id, message_id, revision)`, which
only grows, and `message_edit_horizon`, set to the highest message sequence
when the step is applied. A delivery's state may be `held`. Stepping back to 40
is refused while any session is open, held or lapsed, or any delivery is held;
exposures are dropped, and the next step up sets the horizon again. The words
helper's SQL function, `marked_words`, is registered on every connection the
store opens; no schema object names it, so a connection without it still
opens the schema. Code that runs the helper's SQL on a connection of its own
registers it first (`message_edit.register`).

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

Opening Edit takes the message's edit session in Core
(`web/message-edit-writing.mjs`): the page names this device by a holder, an
identifier it keeps on the device (in IndexedDB, under a Web Lock, so one tab
edits a message at a time) before `message.edit_open` leaves, and the edit
mode shows only once Core answers. If Core refuses, is busy or does not
answer, nothing opens and the Reader says "Edit could not start: …"; the
device row stays as it was. The field opens on Core's draft and its base, so
an edit begun on another device resumes here; words on this device that Core
never confirmed open as they are, on their own base, and become the draft at
once. A row kept from before sessions has no holder: its words open as
unconfirmed and become the draft.

- **Draft saves.** Typing saves the words to Core as the session's draft
  (`message.edit_draft`), 450 ms after the last key and at most 2 seconds
  after the first, one at a time, on the session revision Core last gave.
  One with no answer goes again under its own operation. `EDIT_CLOSED` stops
  them; `BODY_TOO_LARGE` pauses them until the words are shorter; a refusal
  that will not change makes the edit read-only.
- **The hold.** Each draft save renews Core's hold on the message. A key, a
  press or the focus in the field renews it once a quarter of `edit_hold_ms`
  has passed since Core last did; no timer runs, so a field left alone
  lapses.
- **Save** sends the whole request with the holder, kept on the device before
  it is sent, after any draft save already out returns. The holder's Save
  ends the session in Core.
- **Every other ending** (Cancel, words equal to the base, Use saved) sends
  one `message.edit_close` and clears the device row. A close with no answer
  keeps only the holder and that close's operation on the device; the next
  Edit of the message sends it again first.
- **Escape**, closing the Reader or leaving the page sends nothing: the words
  stay on the device with their base, the session stays open in Core, and its
  hold lapses `edit_hold_ms` after the last renewal. The next Edit rejoins the
  session with the same holder. If the message was edited since, its Save
  meets `REVISION_CONFLICT`.
- **Another device.** Opening Edit on a second device takes the session; the
  first hears the `edit_session` change above its own session revision and
  shows "Open on your other device", with Edit here. It saves no drafts, and
  its Save still commits by revision but does not end the other device's
  session; neither it nor Cancel closes. Edit here takes the session back and
  saves its words as the draft. A change read while one of the page's own
  session commands is out is compared once that command answers.

What the edit mode shows (`web/message-edit.mjs`):

- **editing**: the draft, and once it differs "Kept on this device" until
  Core confirms the words, then "Kept".
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

## Stated limits

- **Old tabs need a reload.** No deploy reloads an open page, so a tab loaded
  before slice 1 stops its live updates for a topic once a message in it is
  edited, until it is reloaded. A page of a later release takes a later
  revision and goes on.
- **A delivery is not a page.** A person whose only way to the message is a
  delivery sent to them by name, without the topic, sees the new words the
  next time they open it; live only where a page of theirs already lists it
  under "Sent to you by name".
- **The hold starts when Edit opens.** An agent handed the words before that
  keeps them, and gets a correction if the words change.
- **An abandoned Edit holds agents for up to `edit_hold_ms`** (2 minutes)
  after its last renewal, and a field left untouched that long lapses too.
  Agents may then be handed the old words, and the Save corrects them.
- **A page loaded before slice 2** opens no session, so its Edit holds
  nothing. Its Save still commits by revision and corrects exposed agents.
- **During holding, the message's deliveries leave the agent's counts.**
  Unread and addressed counts, attention, the inbox and Health's waiting work
  leave them out until release, as if settled. If they were all the agent had
  pending, its unanswered-wake count is cleared.
- **Words of a message inside another message's own words** are that
  message's words and are not held, as in a topic started from it. They record
  exposure only when the other message's part of the answer holds the head of
  its own stored quote of it.
- **A topic started from a message records revision 1**, since the opening's
  quote names no revision. Any row makes the agent exposed, so the correction
  still comes; only the recorded revision can understate.
- **Very short quotes can over-record**: a stored quote whose head is "ok"
  records the message whenever the quoting message's part holds that text. It
  errs toward a correction.
- **A message with no words** (attachments only) is never marked, so handing
  it records nothing, and a later edit that adds words corrects nobody.
- **The boundary is the store's answer.** The hosted notice previews 20 of the
  deliveries it reads, and the assessment read tool passes on only some
  fields; every marker in what they read counts, so both over-correct and
  never miss a correction.
- **When two devices hold writing**, the device where Edit opens last opens on
  its own unconfirmed words and saves them as the draft at once. The other
  keeps its words on that device until it ends its edit.
- **A hold opened between a claim and its notice read** can leave that one
  notice empty: it finishes `unavailable`, `nothing_pending`, which Health
  counts as one wake that did not get through.
- **Duplicate notices are accepted**: release hands work back even when a
  notice named it before the hold; a hold released inside one claim is a stale
  start and names the delivery again; and a parked agent is woken once by
  each release of its own work.
- **Between a lapse and the write that releases it**, views show the words but
  the deliveries stay held. With a running runner that write comes at the hold
  end; without one, it is the next claim, the next `ack` of that delivery, or
  the next session command that ends the session. `watch` learns of the
  release through its delivery change.
- **Exposure writes cost a commit.** An agent's first read of a person's
  message above the horizon, the hosted notice's included, is a short
  `BEGIN IMMEDIATE` write that waits at most 250 ms on another writer and wakes
  every live stream. A busy notice read finishes `unavailable` and the agent is
  due again a minute later, so new work can wait behind a burst of draft saves.
  A CLI read that meets such a write is `DATABASE_BUSY`, before anything else
  is done (`reply` reads its target first, so it saves nothing to send).
- **The step back waits on every open session**, lapsed ones included. Escape
  and leaving the page keep a session open until a device ends that edit, and
  no operator command lists or closes one.
- **`edit_draft`'s size refusal is recorded before access**, as a Save's is:
  someone who is not the author can get a recorded `BODY_TOO_LARGE`.
- **A leftover marker stops the hosted loop.** A view whose answer still
  holds a cut or rewritten marker of its run fails as a store error and
  returns nothing, rather than hand a marker out; in the hosted runner that
  error is a loop fault. No view cuts or rewrites marked words, so only a bug
  can cause it.
