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
The source's excerpt scrolls separately while a reply is in its card.
A card already folded to a row keeps that row above the reply; opening the
reply changes no saved fold or dossier position.

This is a fresh, untested preview stage under warp8399 / Tony8394. The original
mockup gate under Tony7824 is historical; the current ruling drops that gate
only. Tony's actual full preview approval is required before tests or review.
No tests may be written or run in this stage. Hosting, copied data and operational
verification belong to the coordinator after this implementation is returned.
