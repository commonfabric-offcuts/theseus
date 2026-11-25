# Reachable split recovery (1268)

A dossier's message menu offers **Split back out…** even when its joined
source head is outside the retained window or folded. Existing join lines
and their direct split action keep working. A source is always chosen explicitly.

Discovery reads one `message_acts` page (at most100 records) per explicit
press, then a bounded `topic_messages` named-ID page for active join heads.
Only admitted source heads currently in the selected dossier become choices.
The named read supplies the source's own name/preview and join revision.
An empty page with a cursor offers More; a byte-cut named response retains
the omitted IDs for the next press. Discovery never populates feed runs,
changes pagination frontiers, or scans automatically to the beginning.

A choice rereads its source by ID, checks instance/topic/current membership,
unchanged join target/revision, current visit/anchor/menu and withheld/removed
state, then uses the existing split command, CAS, retry and Undo owner. A late
read cannot reopen a dismissed menu or act in a different dossier. Pending or
uncertain joins cannot be duplicated through discovery. For an unloaded head,
focus stays with a surviving visible message of the acted-on dossier.

The only product owners changed are stack-feed, stack-menu-items and the new
dossier-splits helper. No Core endpoint, schema, gesture redesign or renderer
change is selected. Current466/1289 selection preservation remains intact.

Own checks name click, key/touch-shaped activation, More, scroll/dismissal and
focus; unloaded/folded/Only-new/archive states; explicit multiple/nested joins;
names/covers/personal placement; stale access/membership, byte cuts, malformed
answers, pending/refused/retry/Undo. These are modeled controls. Native input,
viewport, selection and pixel position acceptance remain separately unrun.
