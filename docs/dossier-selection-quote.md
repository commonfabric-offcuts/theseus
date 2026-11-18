# Phone dossier Quote pill (674, Tony7203)

On a phone, selecting text in a message inside a dossier shows the same Quote
pill the composer uses; tapping it opens the composer with the selected text
quoted. Selecting alone opens nothing.

This source-only feel preview uses the current Reader pill's markup and style,
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
Source reasoning supplies no phone or native-selection proof. No tests or
review processes are authorized until Tony approves that feel.
