# Notebook page menu (792) — SPEC

Base: live99 a34f72f0b3555a274fd4ae5adb07123ff89c3a85, schema 47.
One shared existing overflow menu, in the Notebook Text and Cards editor,
including the composer and full page: Star/Unstar, Rename, Delete. The
revision Reader's page menu opens that same editor for Rename and Delete.
No extra preview gate. This is stored-data/permission work requiring independent
judgment before deployment; no ordinary PR, push or deployment in this build.

Star belongs only to the authenticated reader. `memory.star` targets item_id,
args {starred:boolean}, expected {star_revision, authority}. Append-only star
acts supply monotonic revisions; stale requests cannot undo later stars.
`memory_stars` takes an exact topic_id, cursor and limit, lists only this
reader's live stars in that topic, newest first. On a Conversation it also
lists outcome-scoped pages of exactly that outcome. Core rechecks page access;
no star grants access or leaks private annotations or another reader's stars.
The outline's existing loaded-parent, paging, refresh, failure and navigation
guards apply; a page retains its real item identity and latest title. Unstar
leaves all other readers' stars intact. Deleted pages have no projected star;
restoration recovers stars whose readers did not unstar them.

Rename edits the title inline. Return saves, Escape cancels. The shared
NotebookWriting journal and memory.revise carry exact body, attachments,
references, draft, expected revision and operation identity. Existing merge,
conflict and late-save fences preserve writing; no title-only alternate write.
The title box retains its displayed snapshot when remote revisions arrive.

`memory.delete` targets item_id, args {deleted:boolean}, expected
{item_revision, authority}. The page's creator (writer) or its outcome's owner
may delete/restore it, only with current scope access and in an open outcome;
being a topic participant, coordinator, most recent reviser or topic owner alone
does not grant deletion. Core answers `reader_may_delete`. An agent may not
mutate a draft page. Delete confirms once with the browser's native confirmation;
Retry replays the exact retained request without another confirmation. Refusal
changes no page, star or revision. Unsaved writing must settle before deletion;
a refused/conflicting save retains writing and prevents delete.

Deletion/restoration each append a complete immutable Notebook revision,
carrying exact previous words, attachments, references and draft plus deleted.
The shared item revision fences rename against delete in either order.
Notebook listings and personal star projections exclude deleted pages.
`memory_current` returns the deletion revision and deleted:true with no body,
attachments or references, no writing permission. Old exact source links,
quotes and source attachment reads report PAGE_DELETED while deleted; they
work under their existing access rules after restoration. This is not erasure
or a new read grant. UI hides page content on confirmed deletion and offers
Undo to authorized readers; local unfinished writing, private notes, reply
drafts and unconfirmed image bytes stay in their existing scoped journals.
Late ordinary save confirmations cannot clear a newer deletion state.

Schema: explicit 47 -> `47-notebook-792` candidate migration adds deleted to
memory_revisions and an append-only memory_star_acts table with scoped indexes.
A named stamp avoids taking 757's unapproved 48 or guessing its future order.
Old binaries refuse this stamp rather than reading deleted pages as live.
Stepping back is refused once stars or a deleted revision exist. Integration
must explicitly reconcile this candidate migration with any separately approved
schema work; no live migration occurs here.

Evidence: focused real Core and serial Node controls for permissions, current
revisions/history, privacy, paging, replay, conflicts, both editor modes and
surfaces, late reads and refusal. Applied source mutants must be observed
failing, then restored byte-for-byte with fresh effective CPython 3.9 caches.
Native cases start exactly `reading item 792`, wired into native-reading and
native-webkit-reading: actual mouse/keys on laptop and touch at phone width,
both themes, same menus, star/rail/reload, inline rename and one confirmation,
delete/Undo. Named geometry tolerances must catch an applied layout mutant.
Clipboard is not applicable. Dry enumeration and generated expressions precede
browser allocation. Prior starts 0, allocated 2 (one Chromium then inspect raw,
one WebKit on same clean frozen head), unallocated 16; no retries/local browser.
Any own-fault edit after Chromium holds WebKit for coordinator disposition.
Record helper hashes, raw logs, screenshot paths, phase unrun and owned cleanup.

`memory_status {item_id}` is a small scoped read of current revision, deletion,
reader write/delete permission and the reader's star state. The open editor
reads it on commits even if the Notebook body version has not moved. This
keeps personal stars and permission changes current without rereading the body
on an unrelated commit. Its identity and revision fences are the same as the
full current-page read.
