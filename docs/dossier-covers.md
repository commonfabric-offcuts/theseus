# Dossier covers

A dossier is a folder: its first message is the tab, and its replies are the
sheets. Its cover is the folder's first sheet, right under the tab, and it
answers what the outcome's owner opens a dossier to learn: where it stands,
what waits on them, and what it produced. An agent working the dossier writes
the cover and keeps it current. The owner reads it first, and the messages
fold under it as they always have.

## What a cover holds

A cover has three fields. Each is set or cleared on its own.

- **Where it stands**: one line, at most 300 characters. Line breaks and runs
  of spaces fold to single spaces.
- **What waits on the owner**: at most four things, each with its default,
  the thing that happens if the owner says nothing. A thing that waits is at
  most 300 characters, and its default at most 200.
- **The payload**: what the dossier produced, in at most 500 characters, and
  the message of the dossier that delivered it. It may also carry a link
  (http or https) and a kind: answer, decision, preview, page or release.

A cover with every field clear is no cover, and the page shows none.

## Done

A payload is proposed until the outcome's owner accepts it. Only the owner can
accept it, in one of two ways: a 👍 on the payload's message, or a reply of
their own to that message that the cover's writer names as the word that made
it done (the payload's `done_by`). If both happened, the earlier one counts.
Taking the 👍 back makes the payload proposed again, unless a named reply still
accepts it. Done always says how it was given, and when.

No reply counts unless it is named, and nothing reads what a reply says: a
question in reply, or any other word, settles nothing by itself. A named reply
counts because it is the owner's own reply to the payload's message, and Core
refuses a `done_by` that is anything else (someone else's message, a message
replying to another, one the writer cannot see, or none) with `DONE_BY_OWNER`,
so a writer never claims Done without the owner's own record. When the owner
approved something with a 👍 on another message, make that message the payload,
so their 👍 is the Done it shows.

Nobody writes Done. Core reads it from the owner's own record each time the
cover is written, and again when the owner gives or takes back a 👍 on the
payload's message. It records each change as a new row of the owner's own. A
write that names `done`, anywhere in it, is refused with `DONE_BY_OWNER`,
whoever sends it, the owner included, and nothing changes. When a cover's
payload names a new message, Done is read again for that message.

A 👍 or a reply from anyone else, an agent's included, accepts nothing. A
whisper the owner writes in reply to the payload's message can be named as
their word, as a person's whisper counts as their Tell
([whispers.md](whispers.md)), by a writer in that whisper. A reader outside it
sees that the payload is done by the owner's word, but no link to the whisper.

A promise being kept or a release going live never gives Done. The owner’s
acceptance is the only source of Done, including on covers with promises (717).

## What Core records

A cover is the newest `cover` act on the dossier's first message, in
`message_acts`, and belongs to the topic (owner `''`), like a dossier's name.
Every revision is kept. Schema version 46 lets the table hold the kind, and
adds an index from a cover's payload message to the cover, so the owner's 👍
settles Done in the same transaction. Stepping back to 45 is refused
once any cover was written, even one cleared since.

The stored value is
`{"stands": TEXT|null, "waiting": [{"text", "default"}…], "promises": [PROMISE…], "payload": null|{"text", "message_id", "seq", "link", "kind", "done_by", "done"}}`,
where `done_by` is the owner's reply the writer named, or `null`, and `done` is
`null` or `{"how": "thumb"|"word", "by", "at_ms"}`. A word's `done` also
carries the reply's `message_id` and `seq`.

### Writing it

`stack.cover` names the dossier's first message as
`target: {"message_id": "m-…"}`. It is fenced on
`expected: {"cover_revision": N}`, and its `args` hold any of `stands`,
`waiting`, `payload` and `promises`. A payload is `{"text", "message_id"}`, with `link`,
`kind` and `done_by` as it has them. A field given as `null`, `""` or `[]` is cleared, and
a field left out is kept. A message that is not the dossier's first now is
refused with `STACK_CHANGED`. A late write is refused with
`REVISION_CONFLICT`, and the refusal carries the current `cover_revision`.
Writing the cover as it already stands records nothing and answers
`changed: false`. An outcome that is archived or completed refuses the write,
as it refuses every act ([targets.md](targets.md)). Whoever reads the topic
can write its covers; agents are the ones expected to.

The payload names a message of the dossier, as its writer reads it. A message
outside the dossier, or one the writer cannot see, is refused with
`INVALID_ARGUMENT`. Everyone who reads a dossier's first message reads its
cover, so a whisper can be the payload only of a whispered dossier between the
same two people. Otherwise it is refused with `WHISPER_STAYS_PRIVATE`.

### Reading it

Each message's `acts` (on `topic_messages` and `message_acts`) carry `cover`,
null or `{"stands", "waiting", "payload", "by", "at_ms", "owner"}` (plus
`promises` when any are recorded), and
`cover_revision`. `by` and `at_ms` say who wrote the cover last and when, and
`owner` is the outcome's owner, whose 👍 or named reply gives Done. A reader
is told Done, not the `done_by` the writer named. Only the dossier's first
message carries a cover in its acts.

The cover also rides with the dossier's place, as its name does: every
message's `stack_position` (on `topic_messages` and the `stack_positions` view)
carries the dossier's `cover` and `cover_revision`, read from the first
message the reader can see ([dossier-below-more.md](dossier-below-more.md)).
So a page that holds only replies, the first message above it, has the cover
too, and a reader outside a whispered first message is never given its
cover. The `dossier_cover` view, given any
message of the dossier, answers with its first message (`root_id`), the cover,
`cover_revision` and `owner`, for an agent about to write it.

A cover is shown to exactly the readers of its first message, so a whispered
dossier's cover stays between its two people: its acts reach nobody else, and
any read by someone outside it refuses the message as unknown. Writing a cover
tells everyone who reads the dossier, as any act about a message does.

## For agents

`aim-next cover MESSAGE` prints the cover of the dossier MESSAGE is in. With
`--stands`, `--waits TEXT --default TEXT`, `--payload TEXT --from MESSAGE`
(with `--link` and `--kind`), `--no-waits` or `--no-payload` it writes those
fields ([agent-cli.md](agent-cli.md)). When to write the cover is in
[agent-guide.md](agent-guide.md), "Keeping a dossier's cover".

## The page

A dossier's cover is drawn as the folder's first sheet, after the entry of
its displayed head and before the chevron and the replies, both closed and
open (`web/dossier-cover.mjs`). It is not drawn inside the head's card,
because a closed folder shows that card as its tab alone. When the first
message is above the loaded page, the reply that heads what is loaded is the
tab, and the sheet is drawn after it, from the dossier's place
(`stackCover` in `web/stack-order.mjs`). Earlier messages keeps an already
displayed stack's head and place, even when it loads the dossier's first
message; the one sheet stays with that stack and tab. The older messages
appear where the button was, as described in [reply-stacks.md](reply-stacks.md),
"What one stack never loses". When the page is read again and the first
message becomes the stack's head, the one sheet is drawn after that head.
A dossier whose only loaded message is one reply has no folder to draw a sheet
in: that card shows its dossier's cover as pills under who wrote it, as a
message on its own does. A cover sheet appears when the page gathers its
messages into a folder. The sheet shows:

- where the dossier stands;
- its payload, with its kind as a label, its words, its link, a pill, and the
  number of the message that delivered it, which opens that message;
- each thing waiting on the owner. The owner sees "Waits on you" and anyone
  else sees "Waits on" the owner's name, with the default under it.

The payload's pill shows a box and "payload proposed" until Done, then a tick
and "done · your 👍 at 6:06 AM" (or "done · your word", or the owner's name to
anyone else). When Done came by a named reply the reader can see, the reply's
number links to it too.

A message on its own takes no cover. If someone wrote one on it, its payload's
pill and a "waits on" pill show under who wrote it. Only New, and an
agent-only dossier's quiet row, show no cover.

The look is `web/stack-look.css`'s. It uses the page's semantic tokens, so
light and dark come from them ([reading-colors.md](reading-colors.md)). The
glyphs are drawn once in `web/glyphs.mjs`, and the pills say their state in
words and weight, never with a fill or a coloured edge.

In the Reader, a message of a dossier with a cover shows it as one quiet line
above the message: where it stands and its payload's pill, whether or not the
dossier's first message is loaded. A press opens the whole sheet, for that
message only: any other message, or the same one opened again, starts at the
closed line, and so does a message whose dossier becomes another or whose cover
goes and comes back. The line follows the cover while the Reader is open, the
owner's Done included. On a phone the line gives way while the reply is being written,
so the message keeps its lines ([reader.md](reader.md)).

## Checks

`tests/test_dossier_covers.py` covers storage, merging, revisions and their
refusals, Done by 👍 and by a named reply (and by no one else, and never by a
reply nobody named, a question included), the earlier of the two when both
happened, in either order, with a later 👍 recording nothing, the whisper rule,
the cover riding with every message's place and reaching no reader outside the
first message, an outsider, and the verb with each of its options (the
payload's link and kind among them) and its refusals. `tests/test_migrations.py` (`CoverStepCase`) covers
the step. The page is covered by the `reading covers …` cases in
`tests/stack_native.mjs`, in both engines, among them a dossier whose first
message is more than a page behind its newest reply, the Reader's sheet
opening only where it is pressed (at 320, 375 and 390 and on a laptop), and the
open Reader's line following a rewrite and the owner's 👍.

## Promises (item 717)

`stack.cover` also accepts `promises`, a list of at most eight explicit records.
Omission keeps the list; `[]` clears it. Each record names `id` (stable within
this cover), `text` (the exact source passage, at most 500 characters),
`message_id`, `source_revision` (a positive integer), `due` and `state`.
`due` is either null (shown as “No time given”) or
`{"at_ms": INTEGER, "time_zone": "America/Los_Angeles"}`: an absolute instant
and an IANA timezone supplied by the writer. No prose is parsed for a time.
`state` is explicitly `promised`, `kept` or `missed`; passing the due time does
not change it. A kept promise never sets Done. Only the existing owner's 👍
or named reply on the payload does that. There is no scheduler or automatic
closure, including for a release.

Core checks the source is a visible message in this dossier, with the same
privacy boundary as a payload, and that the exact text occurs in the named
revision. It adds `seq`, `source_author`, `by`, `at_ms`, and `history` to each
record. The due time also carries the offset and label resolved at recording
(`offset_seconds`, `label`), so later timezone rules or the viewing device do
not rewrite the promise's time. On a changed record its previous snapshot is
appended to `history`, oldest first, without recursive history. Repeating the
same inputs adds no history or act. Cover revision fences and operation retry
identity work as for every cover write. Writers cannot supply history or these
Core fields. All cover act revisions remain durable, including cleared lists.

The cover sheet shows the exact promise and source citation, explicit status,
current time with timezone, and each historical version's words, status and
attribution. A changed historical time is struck through. A record without a
time says so. A single-message dossier shows a compact promise pill with its
time and status. As before, a single message has no dossier cover in the
Reader; a message of a dossier uses its disclosure for the full sheet and history.
These are reading surfaces: agents edit through the existing CLI/Core cover
act, not a new browser form. Thus the cover itself has no saving, retry or
refusal controls. Pending/refused/retried writes retain the last committed
cover. The owner's existing payload acceptance controls remain authoritative.

`aim-next cover MESSAGE --promises JSON` supplies this list explicitly; `[]`
clears it. Readback includes each source, status, time and prior version.

The item 717 native fit check keeps its 2px rounding tolerance and bounds the
cover by the requested CSS width as well as the actual visual/layout viewport.
It records those measurements before asserting, including for rendering mutants;
mobile viewport expansion must not make an oversized cover pass. Every applied
mutant retains its actual error, exact restored bytes and a separate restored
control result, even when the error was not the intended one.

Acceptance Tab diagnostics observe native keydown/keyup at window capture,
bubble and after the input call returns, plus focusin/out, active elements and
target visibility, disabled/inert and clipping ancestry. On failed traversal,
a minimal details/summary/button in the same document is reached and operated
with native keys after Escape closes the Reader. This calibration never replaces
the failed acceptance assertion. Delivery/mapping and product causation remain
unestablished until retained native events distinguish them; no diagnostic
programmatically focuses a control or invokes a product handler.

### Reader disclosure keyboard correction (717, warp 9174)

The Reader's cover line is a native button disclosure. Its `aria-expanded`
tracks the sheet's open attribute and `aria-controls` names the sheet. Native
Tab and Shift-Tab move through the visible source citations, reading and writing
and the existing owner controls; Return and Space toggle only the disclosure.
No Tab handler advances focus on its behalf. Opening another message or losing
the cover closes the disclosure; a rewrite of an open cover keeps it open.
This replaces the Reader's details/summary path, which retained focus on its
summary through 120 trusted uncancelled Option-Tab presses in each of four
production acceptance states on the unchanged source. The native correction
check restores that disclosure as an applied mutant and records its failure
and the exact restored control. It does not claim a Safari or iOS device run.
