# Dossier Trash

Trash belongs to the reader. `stack.trash` targets the readable canonical
dossier root and takes a boolean `trashed` and the expected
`trash_revision`. The zero revision describes a dossier that has never been
in Trash. Archive, order, and message stars keep their existing records.
Restoring a dossier records another revision. Only the affected reader
receives the existing topic `acts` change.

The current Trash state rides with existing dossier positions. The
`dossier_trash` view is scoped to one readable topic and uses the current
reader, a bounded limit, and a descending action-ID cursor. It returns
compact root rows with the current Trash and root-star revisions. It seeks
the reader's Trash history and checks up to four times the page size for
the current canonical roots. A page with fewer rows may have a continuation
when more history remains. Trash state rides with the root's existing
current acts, which the feed already reads for the selected rows. A dossier
moved to another topic carries its current Trash state. If joined into
another root, its own state is dormant until it has its own root again.
Returned rows include the root's terminal removal record. Retraction keeps
the words readable with their label and time. Unsent roots are excluded.

Schema 71 adds Trash to the immutable act log and indexes the new kind. The
70 → 71 → 70 rehearsal uses a verified pre-merge backup copy. A down
migration with Trash history refuses before changing the instance. Both
the initial move and a later restore keep their history.

## Trash below Archived

The same fold appears at the foot of Archived on a laptop and in the phone
rail, including a topic with no archives. It starts closed and makes no
read of its own until opened. Opening asks for at most 24 current rows from
`dossier_trash` for the loaded topic. More follows only that view's cursor,
including a cursor on an otherwise empty page. Retry repeats the same
page. An exhausted empty list says “Trash is empty.”
The heading shows a count once the pages in the open fold are exhausted.
Titles and their bin icons use the muted rail colour, and phone rows are
at least 44px tall.

The fold owns only its displayed pages. Closing it, leaving the topic, or
losing access discards those rows and ignores earlier responses. Opening
it again reads the first page. The fold adds no Archive reads and leaves
archive counts and controls with the existing shelf.
