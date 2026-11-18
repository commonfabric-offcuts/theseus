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
ordinary replies leave keys untouched. The existing revision-fenced stack.place
command moves a key, retaining operation retries and Undo. Each position carries
order_key; partial pages use the same root's key. Changes remain actor scoped.
No browser storage supplies order authority.

Native cases named `item 731` measure actual dossier identities/order and use
native keys or taps for personal moves and archive/star actions. They capture
unmodified before/after pages at 320, 375, 390 and laptop widths in both themes
and engines. Desktop WebKit is engine evidence, not a real phone.
