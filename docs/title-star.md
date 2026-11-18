# The dossier title star (item 735, warp 8387)

A press on the filled star in a dossier's title opens the earliest message
**you starred** in that dossier (message order, not when stars were added).
It shows that exact message whole, with its own star, in the same dossier,
with the keys on it. It uses item 613's existing reading landing: Core pages
are loaded through the message and dossier root, `reveal({full:true,open:true})`
opens Earlier messages, and the existing selection scroll and focus finish it.
No second reveal, star mutation, dossier move or composer change is involved.

Core's `stack_position.starred` is already oldest first and includes only
the current reader's stars on messages they can access. Loaded personal acts
override stale position metadata; newly starred loaded messages participate
in the same order. No own star means no title control. Another actor's star
or private message cannot supply its destination. Return and Space activate
the control, as do pointer and touch.

The hidden-reply fixture is this slice's own case. Item 640's in-flight
first-message visibility work is separate and is not copied here. The nine
live Fast Trains records establish star ownership, not actual page visibility;
this work makes no claim about, and changes nothing on, Tony's actual page.
Native checks matching `item 735` in both reading engines retain base/red,
applied mutation, restoration and current images on isolated Core fixtures.
