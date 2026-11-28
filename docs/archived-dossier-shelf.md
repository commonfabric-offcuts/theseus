# Archived dossier pages

The Archived shelf reads `dossier_archive` for the selected topic and
authenticated reader. Its compact results include the canonical root,
display name or short excerpt, reply and New counts, archive revision,
and the reader's order key. They stay outside the feed's message runs.
Archived follows Links and scrolls with the rail, retaining its Grid and
List views. On a phone the same shelf appears in Pipeline & pages.

Read Archive candidates through the existing reader-act index. The query
sorts the reader's Archive records by the same star tier and dossier order
as the shelf. A stable cursor carries that tier, key, tie and root sequence.
Within a visit a just-archived dossier can still go first in its tier for
the existing shelf animation. A continuation can be present on a page
with few or zero visible results when older Archive records still exist.

The query limits the number of roots it checks after sorting. The existing
reader-act index visits that reader's Archive records to filter the topic
and sort their metadata. Canonical ancestry,
whisper visibility and the existing latest-other-author rule decide which
roots still belong on the shelf. New counts probe only the returned
dossiers' members with the current delivery and mark rules. A bounded
lookahead yields an exact heading count and “Show N more” when available.
Otherwise the heading omits the count and the button says “Show more.”

Bring back uses the existing revision-fenced `stack.aside` action. For a
root outside the feed, a successful restore opens that dossier with the
existing bounded dossier landing. A reply from another author can return
the dossier while an earlier shelf page is visible. Feed and archive
refreshes discard stale shelf rows and keep the archive cursor separate
from the feed's older-message cursor. Terminal removal clears its shelf
row immediately. Loss of topic access clears the shelf and rejects
responses begun before the access change.

When the first Archive page is conclusively empty, the same response can
also prove Trash empty. The probe seeks up to nine of this reader's Trash
acts in the topic through the existing recent Trash index, without reading
message words or traversing dossiers. With eight or fewer positive acts,
superseded and unsent acts do not prevent proving emptiness. If a sample
could still contain a usable Trash row or the history exceeds the probe,
the rail keeps the folded Trash row. With no archives it shows that row
alone. Opening Trash still reads its first page on demand.
