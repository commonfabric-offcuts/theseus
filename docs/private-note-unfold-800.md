# Private notes keep their message whole (800)

For the reading actor, `yours.note === true` keeps the actual message card and
its note corner visible through automatic between-others folding, a closed or
folded dossier, its earlier-message group, and explicit fold commands or swipes.
It also prevents quiet dossier compaction or filtering from hiding a note corner.
No private body is added to the feed, and no other reader's note changes a card.

This is a display exception. Core's personal fold act and the requested state
of an automatic fold are retained; clearing the note restores those choices.
Metadata arriving after paint must recompute visibility without opening or
moving the dossier, changing its newest-seven boundary, or latching a kept row.
The existing 44px note corner continues to open the exact source's note while
preserving the reply draft and destination.

When a corner appears for a note added elsewhere after this document saved it
empty, opening it admits the newer exact-source saved note into that same clean
editor and keeps it on the device. Nonempty local writing, unsaved edits,
unsettled saves, conflicts, authority recovery and device-save errors keep their
existing copy. An older answer or a different existing note id cannot replace it.

Focused checks exercise actual fold and stack renderers, public Core privacy
and fold retention, and isolated native input at 320/375/390px and laptop widths
in light/dark Chrome for Testing and WebKit. Emulated input is not a physical
phone or Safari-app claim. Historical Build1's 0/8 setup refusal remains a
failure record; its public recipient-admission repair is retained for this run.
