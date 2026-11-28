# Substantive edit records (item 63)

A saved message edit still appends one immutable revision. Schema 72 adds one
nullable TEXT field, `message_revisions.edit_echo`, containing a short JSON
summary and the revision that started the echo group. Existing rows and
mechanical fixes remain NULL. The migration has no backfill. The down step
drops the field only if all values are NULL. Once an echo exists, downgrade
refuses and the live instance takes the fix-forward path.

Core treats redundant spaces inside ordinary prose, initial sentence
capitalization, and a small set of common transposed spellings as mechanical.
Changes to paths, code, indentation, numbers and other word substitutions
are substantive. Unfamiliar spelling corrections also leave an echo. Substantive edits within two minutes of the preceding substantive
edit on the same message share its group. Core checks at most the preceding 32
revisions of that message, so a burst of typo fixes can span the group without
an unbounded history scan. A return to the words before a group starts a new
group and records that reversal.

Topic message reads can carry the latest echo summary, group revision, and the
revision that wrote it. The source read can also provide a bounded diff for
the latest group or a named `edit_echo_revision` in the message source
reference. Historical diffs include bounded added text from the selected
revision. Current message access, edit holds, and removals apply. Only the
message author or a person already handed the exact baseline can read removed
words. Other readers can see changes to the current words. The dossier UI is
item 64.
