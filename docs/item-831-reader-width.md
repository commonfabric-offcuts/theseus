# Phone page and Reader width (831)

A Conversation and the Reader opened from it stay within the phone viewport,
including after all older messages load. Closing and reopening with an unsent
reply keeps both the writing and Close reachable.

An invisible reply-time tooltip in the feed caused the overflow. Its original
opacity-only hiding left a full-width absolutely positioned box extending
beyond the phone. The mobile layout viewport expanded around that box, and
the Reader inherited that expanded width through its existing percentage
sizing. The Draft preview and the Reader grid were not the cause.

The reply tooltip now has a zero-sized, clipped box while hidden. Its words
remain in the card's accessible text. Hover or the first touch shows the same
words; a second touch still opens the reply. Shown tips wrap at the viewport's
width and are placed inside its edges on hover, touch and resize. This uses
clientWidth, which stays device-sized when mobile innerWidth includes page
overflow. Measuring off the left edge first avoids briefly widening WebKit's
scroll area before final placement. The Reader's sizing is unchanged.

## Observations

All observations use an isolated store copy as Tony, with independent browser
contexts. On plain release 114, the original Conversation/open/write/close/
reopen sequence made a 468px Reader on a 390px device; Close began at x418.4.
A direct message link before full history loaded fit correctly. On release
115's unchanged CSS, full history made the page 449px wide. Removing the
composer left the width unchanged; removing the invisible reply tips returned
the page to 390px. The temporary Reader-only width correction was discarded.

Native observations in Chrome for Testing and installed WebKit show the full
Conversation at 390px before opening the Reader, then native open/reopen/Close
at 320, 375 and 390px with exact unsent writing retained. The desktop Reader
keeps its 1152px width at a 1280px window. Tip observations cover hidden
accessible text, first touch, resize, second touch to the exact reply source,
and desktop hover/click.

Raw baseline, diagnosis and native observations are in the auditor's
`item831-11004` evidence packet. No repository test suite or CI is run or
claimed. Desktop WebKit at phone width is not a physical iPhone observation.
