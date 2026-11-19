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
actual topic. The topic opens, the dossier is revealed for this visit, scrolled into view
and selected as by the arrows. No Reader or reply box opens (item 780;
[landing contract](starred-dossier-landing.md)). Leaving the topic uses the
existing writing guard. An already-open same-topic Reader retains its source
and writing; landing opens no additional presentation. Children never reorder their
parents, act as topics for reorder/write, or expose another reader's stars.
An empty list adds no heading, placeholder or decorative control. This is a
read-only navigation surface: it introduces no saving operation. Read-only
outcomes use the same reading path; guarded navigation keeps exact writing
and its destination. No schema or migration changes are needed.

## States and checks

`tests/outline_stars_native.mjs` runs only under the `item 715` family of
`native-rail` and `native-webkit-rail`. Each state is checked at 320, 375, 390
and 1280, light and dark: available (long, equal and empty names), empty,
live rename/star/unstar, reading/busy, transient error with Retry, refused
read with Retry, keyboard, read-only outcome, folded parent, unloaded parent,
same-topic unsaved writing kept per source, cross-topic unsaved writing that
refuses leaving until saved (then reaches the actual destination), and actor isolation with real denied
membership. The distinct text must meet 4.5:1 contrast. Measured layout uses
named 2px geometry and 0.75px touch tolerances; an absent 14.4px indent and a
30px target still fail. Source mutants break indent, touch size, distinct color
and canonical navigation and restore exact bytes before their native controls.

There is no saving state: this element performs reads and guarded navigation,
never a new write. Existing star/name writes remain on their existing surface.
The busy state here is a read in flight, not a promised star/name save. Empty
adds no visible row. Denied membership removes titles; a transient read error
keeps confirmed titles, names the problem and offers Retry. Core checks also
exercise whispers, private notes, removed membership, joined roots and paging;
Node checks fence stale reads and preserve distinct real IDs across pages.

The destination oracle observes the actual Reader source and the reply editor's
source/destination after a native press, not a message parameter in the URL:
opening a Reader consumes that parameter. Folded/unloaded checks first reveal
and press the real child. Actor-isolation ends after its own denied-actor
assertions, and failures capture state and screenshots before owned pages close.
The route mutant opens a different real root, must fail that identity oracle,
and is restored byte for byte before a passing control in the same engine run.
