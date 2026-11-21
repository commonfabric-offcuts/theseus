# Agent suggestions while replying (972)

Typing `@` at a word boundary offers the topic's enabled agents and people,
filtered by actor ID or display-name prefix as the person types, case-insensitively
(999). With no matching name the list closes. The same picker
serves a card's inline reply, the Reader, the topic composer and its pencil
sheet. IDs are inserted so duplicate display names cannot name the wrong actor.
An `@` inside a word, email address or URL does not open it.

The writing keeps focus. Up/Down selects a row; Tab, Return or a click/tap inserts
the ID, replacing only the current token and preserving the rest of the text.
Escape dismisses the list without changing writing or closing its surface.
Composition, read-only writing, private notes and inactive editors do not pick.
Closing/changing the writing context dismisses suggestions. Insertion follows
the existing native edit/Undo and durable draft path, with no new storage or API.
The browser chooses Undo grouping; Redo restores exact completed writing.

This is completion, not a change to message addressing: Core still interprets
leading `@agent` names. Names elsewhere remain text; existing recipients, quote
basis and destination stay intact.

Checks: first reproduce missing middle-of-text suggestions in a native inline
reply on release 252. Then exercise all four surfaces at desktop/phone widths in
Chromium and WebKit, including filtering, Return, click/tap, Escape, email,
suffix preservation, Undo and an actual Core send. Owner checks cover token
boundaries, matching and lifecycle/keyboard guards. Applied mutations must be
observed failing and restored for claims about exact writing and addressing.

## Validation on 252

Base: `3d8756b464971dd16b064591e4d6693564768fd5`.
Raw evidence is under `/Users/commonfabric/.local/share/theseus/auditor/evidence/`.

- `972-red252`: the actual inline `@` gesture times out waiting for the absent
  list, before any product change. Browser and scratch Core cleanup verified.
- `972-chromium-final252`, `972-webkit-final252`: 16 cases per engine, crossing
  four surfaces, 1280/390 widths and Bookends/Paper. Real key/click/tap input,
  two member kinds, outsider/self exclusion, ID/display-name filtering, arrow
  selection, Return without sending, Escape, email, no-match Return, suffix
  preservation and native Undo/Redo. Every case sends through real isolated
  Core and checks exact body, topic, reply source and leading-name recipient.
  All product and native-harness hashes are recorded; every run verifies
  Browser.close, all observed owned PIDs, profile removal and fixture EOF,
  exit 0, PID absence and closed port. Phone-width desktop engines do not
  establish physical-phone keyboard behavior.
- `972-owner252.log`: focused owner cohort, 142/142. The final broader
  `972-cohort-final252.log` has 1115 tests, 1101 passing, 14 failing. Pristine
  252 has 1108/1094/14 on the same existing files. Failed names and leading
  causes are equal (`972-cohort-comparison252.json`); all seven added checks
  pass. Those existing reds remain failures; this is not a broad-green claim.
- `972-applied-mutations.json` and `.py`: actual suffix and recipient-marker
  mutations fail owner checks; removing inline wiring fails the native gesture.
  Every mutation is restored byte for byte before the final Chromium run and
  broader owner run. WebKit's final source hashes match the restored source.

Early verification evidence remains available. `972-webkit252` and
`972-webkit-partial252` exposed invalid harness assumptions: WebKit groups
typing and completion in one Undo step, and bulk filling a trailing space
while the pencil placeholder uses nowrap can introduce an NBSP before the
picker runs. The harness now types normally and verifies exact Undo/Redo
round-trip instead of imposing Chromium's grouping. No product text
normalization or custom Undo was added. `972-cohort252.log` additionally found
three new failures in minimal hosts with one handler per event; routing picker
updates through WritingInput's existing input/select handlers restores those
unchanged tests. The new phone rows wrap long IDs without clipping.
