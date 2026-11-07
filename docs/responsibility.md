# What each participant is responsible for

Each active participant in a topic keeps one short note saying what they do
there. The topic shows every note beside where the topic stands, so whoever
opens it sees who does what. Core keeps the note on the participant's row
(`topic_participants.responsibility`); the row outlives a leave, so someone
who rejoins finds their note as they left it.

## Schema version 21

`topic_participants` gains `responsibility_revision INTEGER NOT NULL DEFAULT 0`.
Notes written before keep their words at revision 0. The step back to 20 runs
only while no note has a revision above 0 (`RECORDS_WOULD_BE_LOST` otherwise),
because restarting revisions would let a stale request land later.

## `responsibility.set`

- `target`: `{topic_id}`. `expected`: `{responsibility_revision}` (required).
- `args`: exactly `{note}`: text of at most 1024 UTF-8 bytes, refused whole
  with `BODY_TOO_LARGE` rather than cut. Empty text clears the note.
- The note is always the sender's own. Someone who is not an active
  participant is refused with `FORBIDDEN`, recorded.
- The revision is the note's own, not the topic's: a message posted in the
  topic meanwhile does not refuse it. A request whose revision is not the
  current one is refused with `REVISION_CONFLICT` and
  `current_versions.responsibility_revision`, so a late request never undoes a
  newer note.
- The same note again changes nothing: `changed: false`, no revision.
- A change advances the revision by one and touches the topic, so the topic's
  change scope carries it to every open page.
- Result: `{topic_id, actor_id, note, responsibility_revision, changed, version}`,
  where `version` is the topic's version after the act.

`participation.set` may still set someone's note as they are added, with the
same bound; a changed note takes a new revision there too.

## Reads

The `topic` view's `participants` carry `responsibility` (whole up to 1024
bytes; a longer note from before this bound is cut there, with
`responsibility_truncated: true`) and `responsibility_revision`.

## Clients

- CLI: `responsible TOPIC TEXT|-` sets the actor's own note, fenced on the
  revision it has just read; `read TOPIC` lists each note under the title.
- Page: in Topic settings (the gear beside the topic's title), a participant
  writes their own note on the one line under "Your part", saved on Return
  or on leaving the line; the other participants' notes are listed under it.
