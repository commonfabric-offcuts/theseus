# Reply inside a message card (item 721 preview)

The Reply glyph in a message's hover/touch bar opens the existing Reader reply
bar inside that source card. It uses the same DOM, `Reader`, `ComposeBar`,
`EditorRegistry`, editor sessions and upload owner as the phone composer.
There is one active reply surface, with the same source reference, destination,
saved writing, recipients and attachments when opened in either place.

The card remains in its dossier and the page keeps its reading position.
The reply's title names its dossier/topic; × or Escape keeps the writing and
returns to the card. Sending uses the existing real submission path. The full
Reader remains available through a card click, quoted passage, dossier Reply,
links and other explicit opening controls. Opening it moves the same reply bar
back to its full surface. A card removed or hidden by a feed/access change also
returns the writing to the full Reader, where existing access notices apply.

An inline reply is not a modal: it does not trap Tab or take the rest of the
page's controls away. Source cards use a keyboard-focusable button role and
become a group while holding the reply, so writing controls are not nested in a
native button. Their appearance, pointer actions, Return and Space are retained.
The source stays whole above the reply in the same card: opening Reply uses
the existing Show full message and visit-only reveal paths, without saving a
fold or dossier-position change. There is no reply-specific source height
limit, clipping or inner source scroller. A long message can put the bar below
the viewport; it remains part of the same page-scrolling card.

An edit arriving while that bar is open keeps the previous whole source in
place until the revised whole source is read through CardScroll. It never
replaces the source with a newly received excerpt. A superseded source read
cannot overwrite a newer revision or another reply owner. Writing stays in
the same editor while the source changes.

Under warp8627's bounded correction, a native drag over source words selects
text and never opens Reader. Pointer movement owns this distinction before
selection exists; checking only the selection at click time is insufficient.
A stationary click and explicit Return retain their full Reader routes.
Source selection is scoped to the card's direct message preview, outside the
embedded Reader. Explicit Return/passage quoting, Reader selection/Quote,
copying and normal writing selection retain their existing owners.

DEFAULT under Tony8468 / warp8469: retain the reused addressing row and its
existing destination, recipient, Tell/Ask/Whisper and attachment ownership.
Do not simplify it or duplicate any editor or send machinery.

The first preview a7ae00d91343c58e23e0a73a7e0aa2d9b812384a was held.
The original mockup gate under Tony7824 remains historical; warp8399 dropped
that gate only. Tony8502 (m-c083ba0ec2cf4e95b9f4abce3b9b6d14) gave full
approval of revised SAME-copy preview93825af00eee9bfb7dc1c67afb27c3e13e6cf787;
warp8503 then authorized tests. Warp8627 authorizes this focused correction
from tested37d1642d, whose web bytes equal approved938. The approved bytes and
their failed evidence remain immutable controls; this correction adds no new
surface or approval restart. Hosting and operational verification stay with
the coordinator. No independent approval is inferred from implementation.
