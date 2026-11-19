# Dossier covers

A dossier is a folder: its first message is the tab, and its replies are the
sheets. Its cover is the folder's first sheet, right under the tab, and it
answers what the outcome's owner opens a dossier to learn: where it stands,
what waits on them, and what it produced. An agent working the dossier writes
the cover and keeps it current. The owner reads it first, and the messages
fold under it as they always have.

## What a cover holds

A cover has three fields. Each is set or cleared on its own.

- **Where it stands**: at most 300 characters, including line breaks. LF
  separates lines and stays a line break through command, storage and the
  shared cover sheet (item 769). CRLF becomes LF: the CR is folded with the
  other whitespace on its line. Within each LF-separated line, whitespace
  folds to single spaces as before; outer whitespace is trimmed, and an
  all-whitespace value clears the field. Interior blank lines stay blank.
  Single-line values keep their existing normalization and look. These are
  plain words: no label parsing, Markdown or inferred historical breaks.
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

Two more ways to reach Done are not built yet: a promise kept by a time, and
the record itself showing the work landed (a release, say). Both would set the
same `done` value with their own `how`, so a page that reads `how` will show
them when they come.

## What Core records

A cover is the newest `cover` act on the dossier's first message, in
`message_acts`, and belongs to the topic (owner `''`), like a dossier's name.
Every revision is kept. Schema version 46 lets the table hold the kind, and
adds an index from a cover's payload message to the cover, so the owner's 👍
settles Done in the same transaction. Stepping back to 45 is refused
once any cover was written, even one cleared since.

The stored value is
`{"stands": TEXT|null, "waiting": [{"text", "default"}…], "payload": null|{"text", "message_id", "seq", "link", "kind", "done_by", "done"}}`,
where `done_by` is the owner's reply the writer named, or `null`, and `done` is
`null` or `{"how": "thumb"|"word", "by", "at_ms"}`. A word's `done` also
carries the reply's `message_id` and `seq`.

### Writing it

`stack.cover` names the dossier's first message as
`target: {"message_id": "m-…"}`. It is fenced on
`expected: {"cover_revision": N}`, and its `args` hold any of `stands`,
`waiting` and `payload`. A payload is `{"text", "message_id"}`, with `link`,
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
null or `{"stands", "waiting", "payload", "by", "at_ms", "owner"}`, and
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

A cover's refresh glyph requests a rewrite from its recorded writer, falling
back only to the configured, eligible outcome coordinator. It turns while Core
awaits a changed agent cover revision, keeping the existing cover whole, and
links to the durable request. Reload does not end the wait. A reply, the owner's
Done, delivery acknowledgement or a timer never ends it. The state, routing,
retry identity and preview limitations are in [cover-refresh.md](cover-refresh.md).

A dossier's cover is drawn first in the folder, directly under its name row
and above the first message's card, both closed and open (`web/dossier-cover.mjs`).
It has the folder's own colour (`--stack-folder`) in light and dark, with readable
words, a soft top inner shadow and a faint lighter bottom inner edge. Its pills,
spacing and rounded corners stay the same. The tab stands above the folder even
when its head's message is closed.

When the first message is above the loaded page, the folder gets its cover from
its dossier's place (`stackCover` in `web/stack-order.mjs`). More keeps the existing
stack's head and place; the one sheet stays above its messages as older messages
arrive. When the page is read again with its real first message loaded, the cover
still precedes that card. Singletons also have a folder and one cover sheet under
the separate name row (items 799/803); they do not repeat the cover as card pills.
The Reader keeps its cover above the source body.
The sheet shows:

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

Item 769: the focused Core/CLI cases in `tests/test_dossier_covers.py`, HTTP
case in `tests/test_http_store.py` and shared drawing case in
`tests/ui_dossier_cover.test.mjs` check literal LF source values separately
from visual proof. The `reading item 769` cases in `tests/stack_native.mjs`
(`native-reading`, `native-webkit-reading`) measure consecutive painted lines
on the feed and the Reader's opened shared sheet at 320, 375, 390 and 1280,
light and dark, through updates and reload. A single-line cover stays one
line; waits, defaults, payload and unsent writing survive. Measured geometry
uses `lineGeometryTolerancePx = 2`. Desktop WebKit is not physical iOS proof.

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

## Waiting count in the outline (item 756)

`workspaces` items add `cover_waiting`, one per readable cover with a nonempty
waiting list whose owner is the bound reader, over all unarchived topics of
that outcome. Duplicate entries and cover revisions never multiply it.
`workspace_topics` items carry the same field for that topic. A joined-away
first message is no longer a cover until it heads its own dossier again.
Archived topic lists may still display covers, but contribute zero to this
count. The existing workspace membership/reached/ended lists govern which
outcomes the outline sums; it reads no additional outcomes.

The outline adds this contribution to its existing said/ask topic count; it
keeps the light and the question-opening control's meaning. Pressing the same
Waiting on you pill filters and unfilters as before, retaining topics with
cover waits as well as topics waiting from said/ask reasons. Cover changes use
the existing shared act commit notification, so no reload or background
history reconstruction is needed.

Schema 51 adds `cover_waiting`, a derived index holding only the current
nonempty waiting covers, keyed by first message with outcome/topic indexes.
Every cover act updates it in the same transaction. Migration alone fills it
from the latest recorded cover revisions; downgrade drops only the derived
index. Counts recheck current owner, archive state, first-message visibility
and dossier root identity, seeking only this outcome's current candidates or
a bounded topic page. No read or server migrates a store.

## Question-linked waits (item 759, warp9191)

New agent asks to people append their supplied question/options/default to the
cover in the publication transaction. Each names the actual asked actor, ask
message and source revision, independently of the outcome owner. Explicit no
choices/no default with reason is shown plainly. Manual waiting edits preserve
these linked waits; eligible per-question answers and attention clear together.
Schema 54 records links without changing legacy asks. See
[asking-person-cover.md](asking-person-cover.md) for fields and fences.

## Answer beside a linked wait (782)
The asked person sees the existing go-ahead choices beside the cover wait,
including singleton pills and the Reader. Each submits `message.answer` for
that exact ask with the answer revision observed on the cover. A stale choice
refuses, and the cover reloads. Core publishes the same answer reply and clears
the linked wait in that transaction. Other readers receive no answer controls.
Waiting counts now include a cover once when any wait names the reader; manual
owner waits still follow the current outcome owner. Dossier moves relocate
both the derived count index and the linked questions atomically.
