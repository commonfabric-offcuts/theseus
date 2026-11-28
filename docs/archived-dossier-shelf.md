# Archived dossier pages

The Archived shelf reads `dossier_archive` for the selected topic and
authenticated reader. Its compact results include the canonical root,
display name or short excerpt, message and New counts, archive revision,
and the reader's order key. They stay outside the feed's message runs.
The right rail keeps its existing Grid and List views. On a phone the
same shelf appears in Pipeline & pages.

Read Archive candidates through the existing reader-act index. The query
sorts the reader's Archive records by the same star tier and dossier order
as the shelf. A stable cursor carries that tier, key, tie and root sequence.
Within a visit a just-archived dossier can still go first in its tier for
the existing shelf animation. A continuation can be present on a page
with few or zero visible results when older Archive records still exist.

The query limits the number of roots it checks after sorting. The work is
driven by the reader's Archive acts, current stars and the checked dossiers,
and does not page through ordinary topic messages. Canonical ancestry,
whisper visibility and the existing latest-other-author rule decide which
roots still belong on the shelf. The unread projection uses the current
delivery and mark rules. No migration or new stored archive state is needed.

Bring back uses the existing revision-fenced `stack.aside` action. For a
root outside the feed, a successful restore opens that dossier with the
existing bounded dossier landing. A reply from another author can return
the dossier while an earlier shelf page is visible. Feed and archive
refreshes discard stale shelf rows and keep the archive cursor separate
from the feed's older-message cursor.
