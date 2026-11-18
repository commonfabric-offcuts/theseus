# The dossier title star (item 735, warp 8421/8463)

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
in the same order. In the composed 646 preview no own star means the same
control is unlit, labelled "Star this dossier", and loads and stars the
actual first message through the existing page loader and message-star act.
The lit label is "Starred"; unstar stays on the message. Another actor's star
or private message cannot supply its destination. Return and Space activate
the control, as do pointer and touch.

Both the hidden reply and the folded-away first message are this slice's
own cases (8421 supersedes the previous split with parked item 640).
The existing title action owns its first phone tap even after closing writing;
card-body taps retain their first-light behavior. Item 646 makes this same
control always visible; there is still one starred action and one callback,
using 613's landing. The historical hidden-reply fixture intended to force
scrolling by putting its target after 26 earlier rows, but the final 735
return could not reach its root prerequisite. The no-scroll proof is missing.

The nine live Fast Trains records establish star ownership, not actual page visibility;
this work makes no claim about, and changes nothing on, Tony's actual page.
Native checks matching `item 735` in both reading engines retain base/red,
applied mutation, restoration and current images on isolated Core fixtures.
Those are preserved historical sources, not execution or approval of the
646 composition. 735 is parked: at 320px the floating bar covers the own
message star, and hidden-reply/no-scroll evidence remains incomplete. Under
warp8529 this composition is source-only until the coordinator hosts a copy
and Tony gives his actual first 646 preview word; no checks run here.
