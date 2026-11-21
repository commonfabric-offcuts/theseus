# Keep starred dossier landings selected (834)

The left outline's starred dossier keeps the 715/780 contract: reveal the
canonical dossier, scroll it into view and select its card, without opening
a Reader or reply. Close the phone drawer before landing, as unread-message
navigation already does. A loaded same-topic landing otherwise runs before
the rail's bubbling click handler: the main page is still inert, focus fails,
and the drawer's later close puts focus on the Topics button.

After a cross-topic landing, WebKit can emit a mouse move at the same screen
position as the click on the old rail row. A new MessageMenu used to forget
that position, treat this as real movement and clear the landed card's light.
Keep the last mouse position in the existing document-scoped press record;
the new topic can then recognize the stationary event. A finger's press
clears that position, retaining the existing first-mouse-event touch behavior.

These changes preserve topic navigation and writing guards, stale
landing fences, bounded source reads, and the single completed starred-history
paint. No server or database change is needed.

Unchanged release 117 reproduced the lost selection by native phone tap at
390px, while desktop clicks and cross-topic taps reached the correct dossier.
Three existing stars were observed, including a root 90 messages back.
Holding then releasing a real background history response did not reproduce
the reported missing scroll; its asynchronous source read also avoided the
same-topic focus race. WebKit verification of the first drawer-only fix
caught the second selection loss, with unchanged pointer coordinates and a
DOM removal trace. The full missing-scroll report remains unconfirmed.

Standalone observations and their exact source/evidence qualifications are in
the 834 Possible bugs dossier. These are isolated browser observations, not a
repository test suite or CI result, and not physical iPhone evidence.
