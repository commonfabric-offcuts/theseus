# Phone dossier Quote pill (674, Tony7203)

On a phone, selecting text in a message inside a dossier shows the same Quote
pill the composer uses; tapping it opens the composer with the selected text
quoted. Selecting alone opens nothing.

The preview implementation uses the current Reader pill's markup and style,
the card's existing selection-to-Markdown mapping, and the existing
`replyMessage` → `Reader.quoteFrom` → `Reader.quoteInto` owner. The source is
the selected message and its displayed revision, never the dossier's first
message by inference. The current reply destination, To, draft, private note,
whisper and Wide/stacked rules remain the Reader's. Quoting appends to that
reply; it never sends or replaces writing. Another source's writing stays with
that source under the existing open rules.

Only one noncollapsed native range wholly inside one visible dossier message's
formatted words qualifies. Every selected word must be visible inside its
scrolling/clipping ancestors and the visual viewport. Existing Markdown rules
include whole-link and formatting-mark expansion. Controls, deleted words,
hidden/clipped words, multiple messages/ranges, missing or unavailable sources,
and a selection invalidated by a text/revision repaint offer no quote. The
candidate is revalidated as the pill is pressed and activated. The press captures
the exact excerpt, revision and cloned range before native selection can
collapse; a cancelled or abandoned press drops that capture.

The pill is a native button, at least 44px each way, clamped inside the visual
viewport near its bottom, away from the system menu beside selected words.
Native selection handles, Copy and accessibility retain their browser owners.
Touch selection-ending clicks do not open the message; links and controls keep
their actions. Fine-pointer desktop selection, swipe/fold, repaint/read/dismiss
and the Reader's existing pill keep their owners. No clipboard, privacy,
delivery, read-state, API or Core rule changes.

Scope uses the existing coarse-pointer convention for phone controls, including
landscape. There is no new destination default. Unresolved until Tony tries his
actual phone: pill placement versus Safari's selection UI and handles, and
whether the current quote destination/Reader opening is the intended feel.
Source reasoning supplies no phone or native-selection proof. Warp9078 advances this exact preview to tests now, superseding the earlier
wait. This is not evidence that Tony tried or approved it on a physical phone.


## Checks under warp9078

`tests/dossier_selection_quote_native.mjs`, reached through the existing
`native-reading` and `native-webkit-reading` steps with `item 674`, uses browser
mouse selection and native touch/keyboard activation on isolated fixtures.
`tests/ui_dossier_selection_quote.test.mjs` checks capture validation and the
existing Reader quote owner below the browser; its simulated objects make no
native-gesture or phone claim. The historical preview source remains
`c865e195d79db737e5af3f4ff56cc9cd217f8838`. Before captures use exact public
source overlays from its parent, with digests; source mutants must apply once,
fail their semantic assertion, and restore every candidate public byte.

The current quote destination/layout and writing owners are the default.
Desktop WebKit does not establish physical iOS selection handles, system menus,
software-keyboard geometry or native touch-drag cancellation. Unreached states
and raw failures belong in the stage report; they are not passing checks.
