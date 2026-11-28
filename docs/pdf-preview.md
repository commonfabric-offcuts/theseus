# Files PDF preview

The Files rail opens an attachment through a same-origin form POST to
`/api/media/pdf-preview` in a new tab. The form carries the current session
proof, instance ID, message ID, media ID and expected SHA-256. The preview
requires the configured Host and exact Origin. The bearer remains out of the
URL, and the new tab releases its opener before navigation.

Core reads the attachment through the existing message access check. Only
exact captured bytes with an `application/pdf` descriptor, a recognized PDF
version header and a trailing PDF EOF marker qualify for inline preview.
Existing PDFs qualify after the same checks. The stored image-inline flag
keeps its current meaning. Other non-image downloads retain attachment
disposition.

The response retains the shared media sandbox CSP, frame denial, no-referrer,
nosniff and no-store. PDF bytes go directly to the browser's native viewer.
