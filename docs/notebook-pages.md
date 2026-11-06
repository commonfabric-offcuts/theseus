# Notebook pages and what changed since you read them

An outcome's Notebook pages sit beside its topics. A page someone has read
and that has been revised since is marked changed for them, the way a topic
with unread messages carries a count, until they open it again, and the
Reader then shows what changed since the revision they last read.

## Core

Core keeps, for each person and each Notebook page, the last revision they
read (`memory_reads`, schema version 18). No row means they have not read
it. The revision only grows: reading an older revision, or the same one
again, leaves it where it is, so a late or repeated request never makes a
page look changed again.

- Command `memory.read`: target `{item_id}`, args `{revision}`, expected
  `{authority}` only. The revision must be an exact, existing revision of a
  page the reader can read (`FORBIDDEN` otherwise; a malformed one is
  `INVALID_ARGUMENT`). Result: `{item_id, previous_revision,
  read_revision, current_revision, changed}`. A read that moves the
  revision forward adds the change `memory_read` to the reader's own
  (`actor`) changes; one that moves nothing tells nobody.
- Writing a revision (`memory.create`, `memory.revise`) reads it for its
  writer, so a person's own edit never marks a page changed for them. The
  write is its own change; it adds no `memory_read` change.
- View `memory_items`: each item carries `read_revision`, the viewer's own,
  `0` when they have not read it. A page is changed for the viewer when
  `0 < read_revision < revision`. A page never read is not marked: the light
  is for what changed under someone, not for everything they have not read.
