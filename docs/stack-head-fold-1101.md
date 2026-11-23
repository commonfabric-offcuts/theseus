# A first message and its Fold menu agree (1101)

Base: actual release 351, `f4968864236368d25d7604ca9c1c10af80a6c77a`.
Owner: page-lane6. Intake: Fable 17769, Tony 17665 and its screenshot.

The screenshot proves the single-line/Fold disagreement, not its cause. In
351, opening Earlier messages adds an unfolded first message to `earlierRows`.
The renderer then draws a temporary single line while the menu and act read
the personal `acts.folded` record. An Unfold redraw can therefore replace the
saved folded row with another single line. The new test must reproduce this
on the actual old renderer before a product edit establishes the cause.

Once a dossier's first message is shown, draw it whole or as its personal
folded row from the same kept message-fold fact the menu and act already use.
Do not give that head a second temporary earlier-message row. This deliberately
replaces only item 476's first-message row: earlier replies keep their rows,
the newest-seven boundary stays held, and the closed Earlier messages control
still stands for the hidden first message until opened. A personal fold does
not open a dossier or change its level. Star, own-note and explicit link-peek
display exceptions keep their existing meanings and retained fold records.

Expected product owner: `web/reply-stacks.mjs`; its Earlier control tooltip and
`web/stack-feed.mjs` announcement say messages are shown, since the head now
shows whole. Update this contract and the
existing first-message documentation/native expectation for the deliberate
476 head change. Do not rewrite approved 858 (`d6816b967a47e60b5bba5cbd7f7067fe2f2be7aa`),
its branch, proof or saved-level implementation. No Core, schema, migration,
runtime, guard or pipeline change is planned; final actual paths classify.

Below the browser, exercise the actual renderer, menu descriptors and
StackFeed fold/unfold handler with separate records: old red, corrected green,
whole-old-owner red and restored green, recording direct child exits and
start/end input hashes. Cover a large dossier head through Fold, Unfold,
fresh-view reload, unrelated redraw/arrivals, earlier replies, selection/read
handlers, stars, own notes and link peek. Fake DOM checks make no native
gesture, geometry or timing claim. Run the relevant existing cohort and retain
every inherited failure with the actual old-base comparison.

Native proof must inspect the drawn head and actual menu with pointer/keys,
fold/unfold and a new document reading Core's retained fold, using isolated
records and headless Chrome for Testing/Safari's engine as available. Page5
owns the private slot at intake (17742); no browser or HTTP fixture starts
until actual cleanup/FREE, fresh resources and Page6's own INUSE notice.
Retain screenshots, exact source maps, failures and Browser.close/fixture/PID/
profile/TCP cleanup. No prior native evidence transfers to this change.

Native construction uses the current fixture's required divergence and reply
basis metadata. The earlier-message scenario ensures the dossier is open
instead of toggling an already-open one closed, selects its real head past
the cover sheet, and uses the current card-reply/second-body-press Reader
door. Its exact kept reason/body, displayed reply passage, image, order,
no-fold-write and reload assertions stay separate. These setup corrections
are retained with their failed attempts; they change no product policy.
Screenshots wait for the actual finite animations to finish and fold ghosts
to leave. The 1101 cases cover 1280/390 and both themes; the existing earlier
scenario also covers 375/320. Runtime results, old-owner controls and cleanup
receipts belong to the evidence packet, not to this declaration of coverage.
