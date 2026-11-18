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

Live94 cards were native buttons. The preview's div must retain their
non-selectable source text; this is scoped to the card's source children,
outside the embedded Reader. A selection-release click on those words must
not open the full composer. This does not remove explicit Return/passage
quoting, Reader selection/Quote, copying or normal selection inside writing.

DEFAULT under Tony8468 / warp8469: retain the reused addressing row and its
existing destination, recipient, Tell/Ask/Whisper and attachment ownership.
Do not simplify it or duplicate any editor or send machinery.

This revision is a fresh, untested preview-only delta under Tony8468 /
warp8469, from frozen first preview a7ae00d91343c58e23e0a73a7e0aa2d9b812384a.
That preview was held, not approved. The original mockup gate under Tony7824
is historical; warp8399 / Tony8394 dropped that gate only. Tony's feedback
does not supply approval. His actual full preview approval is required before
tests or review.
No tests may be written or run in this stage. Hosting, copied data and operational
verification belong to the coordinator after this implementation is returned.
