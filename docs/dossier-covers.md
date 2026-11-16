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
accept it, in one of two ways: a 👍 on the payload's message, or their own
reply to that message that does not ask. If both happened, the earlier one
counts. Taking the 👍 back makes the payload proposed again, unless a reply
still accepts it. Done always says how it was given, and when.

Nobody writes Done. Core reads it from the owner's own record each time the
cover is written, and again when the owner gives or takes back a 👍 on the
payload's message or replies to it. It records each change as a new row of the
owner's own. A write that names `done`, anywhere in it, is refused with
`DONE_BY_OWNER`, whoever sends it, the owner included, and nothing changes.
When a cover's payload names a new message, Done is read again for that
message.

A 👍 or a reply from anyone else, an agent's included, accepts nothing. A
whisper the owner writes in reply to the payload's message counts as their
word, as a person's whisper counts as their Tell
([whispers.md](whispers.md)). A reader outside that whisper sees that the
payload is done by the owner's word, but no link to the whisper.

Two more ways to reach Done are not built yet: a promise kept by a time, and
the record itself showing the work landed (a release, say). Both would set the
same `done` value with their own `how`, so a page that reads `how` will show
them when they come.

## What Core records

A cover is the newest `cover` act on the dossier's first message, in
`message_acts`, and belongs to the topic (owner `''`), like a dossier's name.
Every revision is kept. Schema version 46 lets the table hold the kind, and
adds an index from a cover's payload message to the cover, so the owner's 👍
or reply settles Done in the same transaction. Stepping back to 45 is refused
once any cover was written, even one cleared since.

The stored value is
`{"stands": TEXT|null, "waiting": [{"text", "default"}…], "payload": null|{"text", "message_id", "seq", "link", "kind", "done"}}`,
where `done` is `null` or `{"how": "thumb"|"word", "by", "at_ms"}`. A word's
`done` also carries the reply's `message_id` and `seq`.

### Writing it

`stack.cover` names the dossier's first message as
`target: {"message_id": "m-…"}`. It is fenced on
`expected: {"cover_revision": N}`, and its `args` hold any of `stands`,
`waiting` and `payload`. A field given as `null`, `""` or `[]` is cleared, and
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
`owner` is the outcome's owner, whose 👍 or reply gives Done. Only the
dossier's first message carries a cover. The `dossier_cover` view, given any
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

A dossier's cover is drawn as the folder's first sheet, after its first
message's entry and before the chevron and the replies, both closed and open
(`web/dossier-cover.mjs`). It is not drawn inside the first message's card,
because a closed folder shows that card as its tab alone. The sheet shows:

- where the dossier stands;
- its payload, with its kind as a label, its words, its link, a pill, and the
  number of the message that delivered it, which opens that message;
- each thing waiting on the owner. The owner sees "Waits on you" and anyone
  else sees "Waits on" the owner's name, with the default under it.

The payload's pill shows a box and "payload proposed" until Done, then a tick
and "done · your 👍 at 6:06 AM" (or "done · your word", or the owner's name to
anyone else). When Done came by a reply the reader can see, the reply's number
links to it too.

A message on its own takes no cover. If someone wrote one on it, its payload's
pill and a "waits on" pill show under who wrote it. Only New, and an
agent-only dossier's quiet row, show no cover.

The look is `web/stack-look.css`'s. It uses the page's semantic tokens, so
light and dark come from them ([reading-colors.md](reading-colors.md)). The
glyphs are drawn once in `web/glyphs.mjs`, and the pills say their state in
words and weight, never with a fill or a coloured edge.

In the Reader, a message of a dossier with a cover shows it as one quiet line
above the message: where it stands and its payload's pill. A press opens the
whole sheet. On a phone the line gives way while the reply is being written,
so the message keeps its lines ([reader.md](reader.md)).

## Checks

`tests/test_dossier_covers.py` covers storage, merging, revisions and their
refusals, Done by 👍 and by reply (and by no one else), the whisper rule, an
outsider, and the verb. `tests/test_migrations.py` (`CoverStepCase`) covers
the step. The page is covered by the `reading covers …` cases in
`tests/stack_native.mjs`, in both engines.
