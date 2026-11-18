# Starred dossiers in the outline (715)

Under each loaded topic row in the left outline, show the reader's starred
dossiers, newest star first. Stars on several messages of one dossier produce
one title, identified by Core's canonical dossier root, never by its name.
Use the shared short name, or the same first-message preview as the feed when
that name is empty. A star and the theme's warning-text color (`--warn`) distinguish the child row.
The existing right rail's starred messages retain their existing meaning;
there is no second dossier group.

Extend `stars` with optional `topic_id`. Core checks access to that topic and
returns the existing bounded, cursor-paged stars, scoped to it. Each item in a
scoped answer also carries `dossier: {id, name, body, attachments}`: the visible
canonical root, its shared name (a string), and a bounded current preview of
its first message and attachment names. No note or draft is read. Unscoped
answers keep their current shape. Pagination remains by star ID; the outline
deduplicates dossier IDs across the pages it has read. More starred dossiers
under a topic reads the next page. Refresh rereads the extent already loaded.

The outline reads only drawn, loaded topic parents. Folding a parent hides
its children; an unloaded parent has none. New reads, rename, star and unstar
follow the existing commit feed. A forbidden read removes its titles; another
read failure keeps the last confirmed titles and offers Retry under that
parent. Busy reads keep existing titles and controls, with aria-busy. A new
page or actor starts with no cached titles from the previous one.

Rows join the outline's single Tab stop and native arrow navigation as children
of their topic. Return, a click or a phone tap opens the canonical root in its
actual topic through the existing writing guard. Children never reorder their
parents, act as topics for reorder/write, or expose another reader's stars.
An empty list adds no heading, placeholder or decorative control. This is a
read-only navigation surface: it introduces no saving operation. Read-only
outcomes use the same reading path; guarded navigation keeps exact writing
and its destination. No schema or migration changes are needed.
