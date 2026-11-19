# Dossiers stay put (731)

A dossier in a topic or Conversation keeps the reader's order when any reply
arrives, including after refresh and reload. New dossiers enter first; a dossier
reawakened from below More enters last above More. Personal moves and shared
joins still work. Item 635's star hold and return and item 550's canonical root
remain authoritative. The Topics rail is unchanged.

Core keeps a personal numeric order key by topic and canonical dossier root.
An explicit migration freezes the existing reader's effective order (latest
non-own activity, root placement, or latest legacy placement), without rewriting
messages or acts. Reads never initialize records. Publication admits new roots
at the top and returns sleeping roots at the bottom in the same transaction;
ordinary replies leave keys untouched. Star and unstar never write order keys;
a star brings a sleeping dossier above More at its existing key. The existing revision-fenced stack.place
command moves a key, retaining operation retries and Undo. Schema 48 adds `dossier_order`; downgrade is refused once it holds positions.
Each position carries `order_key`, `order_tie` and `order_entry_key`; partial pages use the same root's key. Changes remain actor scoped.
No browser storage supplies order authority. The migration and each publication
keep actor visibility; a private reply never changes an outside reader's key.
A new reader with no prior position uses the root's sequence until their own
move or a new admission. Reset position restores the last admission position;
it never enables activity ordering. Archive Undo carries the former key as the
optional `stack.aside` argument `key`, fenced by the usual aside revision.

The exact unmodified LIVE94 public Build is frozen in
`tests/fixtures/item_731_original_web.{json,tar.gz}`. Native comparisons run it
on the isolated candidate Core records, then restore every candidate public
byte. Three Core record/routing/return mutants run one focused file each in
fresh Python caches, restore bytes and run a restored control. The target-size
mutant alters the actual CSS floor and is caught by the shared 0.5px tolerance.

Native cases named `item 731` measure actual dossier identities/order and use
native keys or taps for personal moves and archive/star actions. They capture
unmodified before/after pages at 320, 375, 390 and laptop widths in both themes
and engines. Desktop WebKit is engine evidence, not a real phone.
