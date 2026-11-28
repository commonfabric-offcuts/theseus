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

Schema 71 adds Trash to the immutable act log and indexes the new kind. The
70 → 71 → 70 rehearsal uses a verified pre-merge backup copy. A down
migration with Trash history refuses before changing the instance. Both
the initial move and a later restore keep their history.
