# Experience guidelines

This document lists the experience Theseus provides and what holds each part in
place. The short version is the Notebook page "Experience guidelines" in the
Building Theseus outcome. That page points here, and this document carries the
full text with its checks.

A guideline an agent has read shows only that it was available. Whether it was
followed is shown by the check named beside it, or, where nothing automated can
tell, by Tony trying a preview. Where no check exists yet, the entry says so;
the gap is the next thing to build, not a claim.

A check is named by its harness file, its release step (`native-…` steps run in
the release check, `tools/release_check.py`), and the case name it reports, so a
run's results can be searched for it.

## Reading and writing come first

The Reader keeps room to read the message and room to write a useful reply.
Guidance on the page stays compact and folds away. On a phone with the keyboard
up, the message still shows enough to read while writing.

- `tests/reader_native.mjs` (`native-reader`): "default stacks, wide keeps
  writing full height, layout switch preserves typing", "divider click is inert,
  native drag changes proportions and preserves typing".
- `tests/reader_native.mjs` (`native-reader-finished`): "finished the save
  status is one line whatever it says: …".
- Gap: no check measures how much of a phone screen the message keeps while the
  keyboard is up. The phone check records the visible height before and with the
  keyboard (`keyboard.visualBefore`, `keyboard.visualSmallest`), as evidence for
  that check ([device-evidence.md](device-evidence.md)).

## Keys mean one thing in each place

While reading a source, Return quotes the selected or lit passage. In the reply,
Return makes a new line and Cmd-Return sends. In a private note, Cmd-Return
saves the note. Buttons, pickers and other controls keep their own keys. A hover
never promises a quote that Return would not make.

- `tests/reader_native.mjs` (`native-reader-keyboard`, `native-reader`): "hover
  Return quotes exact words and composer Return stays a newline", "note
  Cmd-Return saves only the note and keeps the Reader open on the reply",
  "nonempty send-and-stay shortcuts each send once and keep the reader open".

## Every input works

A laptop pointer, the keyboard alone and a phone's touch each reach the same
actions. The keyboard reaches every region: the sidebar, the topic, the Reader
and the writing. Focus stays visible and follows what the person did.

- Keyboard: `tests/outcome_rail_native.mjs` (`native-rail`,
  `native-webkit-rail`): "rail Tab from the logo block reaches the outline as
  one stop, on the topic being read: no fold triangle, the next Tab leaves it
  and Shift-Tab comes back", "rail the arrows move through the outline as a
  tree" and "rail → and ← move between the outline, the messages and the right
  rail"; "rail → on a folded outcome opens it, the next → lands on its pencil
  with a ring, …" reaches each pencil by the keys and presses it with Return.
  `tests/reader_colors_native.mjs`
  (`native-colors`, `native-webkit-colors`): the own card is reached by native
  Tab, and keyboard focus stays visible on it.
- `tests/fence_copy_native.mjs` (`native-fence-copy`) checks keyboard activation on the copy glyph and its feed card in Chromium and WebKit.
- Touch: see "A phone by touch" below.

## Dismiss without losing work

A press outside a pop-up closes it and keeps unsent writing and images. A press
outside, Escape and the close control all keep work the same way. A press that
starts or ends inside the pop-up is not an outside press.

- `tests/links_native.mjs` (`native-header`): "header a press on the backdrop
  closes the Reader, keeping its writing, and a drag out of the writing or into
  it does not", "header a press on the backdrop closes Topic settings and a
  press on its own empty space does not", "header a selection dragged out of
  Topic settings and let go on the backdrop keeps it open; a press there closes
  it".
- Node units: `tests/ui_links.test.mjs`, "a press that starts and ends outside
  a pop-up closes it, on every side, as its × does"; `tests/ui_topic_header.test.mjs`,
  "only a press that starts and ends on the backdrop closes Topic settings, as
  it does every pop-up".
- `tests/reader_persistence_native.mjs` (`native-correction`): "correction
  explicit Close Escape and Topic cancel pending navigation with preserved
  writing".

## Your place holds

A message arriving never moves what is being read or written, and nor does
quoting from it. Loading older messages shows them where they were asked for.

- `tests/reader_compose_native.mjs` (`native-compose`): "quoting keeps your
  place: the quoted passage stays where it was on screen, …" and "quoting from
  a passage taller than what shows keeps the words quoted where they were, …",
  in Chrome and Safari's engine, on a phone and a laptop, stacked and wide.
- `tests/reader_live_native.mjs` (`native-live`): "live a message arriving
  leaves the card being read in place, and a field scrolled away holds nothing",
  "live with no card on the screen, a message arriving scrolls nothing".
- `tests/topic_reading_native.mjs` (`native-reading`, `native-webkit-reading`):
  "reading Show full message on a card scrolled inside keeps the words being
  read where they were".
- `tests/reader_freshness_native.mjs` (`native-freshness`): the F-series. Reads
  continue through retries, resyncs and failures, and a "caught up" state is
  claimed only after a pass of reads has run to its end
  ([scoped-updates-followups.md](scoped-updates-followups.md)).

## Actions are where you look for them

An action sits on the surface where its work happens.

- `tests/topic_header_native.mjs` (`native-header`): "header a topic Ready for
  review shows ✅ Done beside its state; a click marks it Done, into the Done
  group, and the button goes; an active topic shows none", "header ✅ Done is
  reached with Tab and pressed with Return or Space, and the focus lands on the
  subtitle saying Done".
- Otherwise no automated check. Held by Tony's preview of every new surface.

## Quiet, not button land

A surface shows what the person came for: the words, and the one or two acts
they are most likely to take. Everything else waits behind a ⋯ or a +, or
appears once the person starts the act it belongs to. A word, a glyph or a small
mark in a line beats a boxed button. Marks on a card sit in the card's own line.

- `tests/outcome_rail_native.mjs` (`native-rail`, `native-webkit-rail`): "rail
  no page has a header bar or Refresh; …"; "rail on a laptop each pencil is
  quiet until the pointer is on its row or heading: …" (a pencil, not a
  + New topic row, and none shown on a row neither pointed at nor keyed).
- Gap: a page check that counts the boxed controls showing before the person
  acts is proposed and not built. Until then, Tony's preview holds this.

## Getting something in is quick, never a form

One line or one tap comes first: type, press Return, and it is in. Details are
optional and set afterwards, in place. A choice among a few options is chips
tapped once, not a dropdown or a stack of round buttons. Capture starts from
where the person already is, so nobody types ids. No box is wider than its
content needs: a title line is about a sentence wide, and a few sentences about
40rem.

- `tests/form_rules_native.mjs` (`native-forms`): "forms the audit names a box
  too wide, a short dropdown, round buttons, checkboxes and a stretched button"
  (the audit's own negative control), then the rule on each surface: "forms the
  Outcomes page and its New outcome line keep to the rule", "forms an outcome
  page, its New topic line, its purpose and its team keep to the rule", "forms
  a topic page, its People row and its composer keep to the rule", "forms the
  Reader on a message, on a Notebook page, its note and its Start a topic line
  keep to the rule", "forms a resumed opening and a resumed outcome form keep to
  the rule".
- `tests/pipeline_native.mjs` (`native-pipeline`, `native-webkit-pipeline`):
  "pipeline turning it on is one tap from the outcome page, and one line and
  Return adds an item whose words and size are set in place".

## No coloured left edges

Nothing is marked by a coloured edge or bar down one side. A card's colour
covers its whole face.

- Node units, `tests/ui_author_colors.test.mjs`: "nothing on the page wears a
  colored left edge or bar", "an agent's card is colored across its whole face,
  never by an edge or bar".
- `tests/reader_colors_native.mjs` (`native-colors`, `native-webkit-colors`):
  the hovered card is black on both sides, with no edge or bar, measured from
  screenshot pixels.

## Colours come from the theme's tokens

Colours are named by meaning (`--paper`, `--panel`, `--ink`, `--muted`,
`--line`, `--accent`, `--on-accent`, `--soft`, `--focus`, `--warn`, `--note`,
`--alert`) in `web/aim.css`. Each token has a light and a dark value, and a
surface uses the token, not a raw colour.

- Node unit, `tests/ui_save_sign.test.mjs`: "each saving state is drawn from a
  palette token".
- `tests/reader_colors_native.mjs` (`native-colors`, `native-webkit-colors`):
  reading colours and contrast in light and dark.
- Gap: no check fails a raw colour added outside the token definitions.

## Preview first

A new piece is put in front of Tony as a preview right after it is built, before
review and tests, for him to click. It is served from the candidate's own files
on a copy of the live data, over the tailnet, so trying it changes nothing real.

- Not a page check: this is how work moves through the pipeline (the Notebook
  page "How we work"). The preview tool records each preview it serves.

## A phone by touch

Everything is reachable by touch on a phone. Touch targets are big enough,
nothing scrolls sideways, and nothing depends on hover.

- `tests/fence_copy_native.mjs` (`native-fence-copy`) checks touch targets, partial fences and visible clipboard refusals at 320, 375 and 390 pixels in both themes.
- `tests/reader_navigation_native.mjs` (`native-navigation`): "navigation
  paging workspace denial retry and narrow touch targets".
- `tests/reader_openings_native.mjs` (`native-openings`): "openings 390px touch
  an opening types adds a participant saves and sends by tap".
- `tests/outcome_rail_native.mjs` (`native-rail`, `native-webkit-rail`): "rail
  at 320, 375 and 390 the pencil beside the outcome in the open drawer always
  shows, 44px, …", in both themes.
- Safari's engine at phone width, with touch: `native-webkit-whispers`,
  `native-webkit-notebook`, `native-webkit-rail`, `native-webkit-pipeline` and
  `native-webkit-colors` ([device-evidence.md](device-evidence.md)).
- `tests/device_native.mjs` (`native-webkit-device`): "device at a phone's width
  every phone check control is in reach by touch and nothing scrolls sideways".
- A real phone: the phone check records what Tony's phone did with the names
  list, holding to select, the keyboard, a notification and the tailnet page,
  and posts it to a topic ([device-evidence.md](device-evidence.md)).
- Gap: the reply-address box ("Someone else") is 29 px tall at phone width,
  under the 44 px the other controls keep. The device check records its height.

## Plain words

The page says what happened in words a person uses: what was refused and why,
and what was kept. It never shows an error code or an id.

- Node units: `tests/ui_app.test.mjs`, "a step whose device save fails says so
  plainly and keeps the writing in front" and "a message the person may not
  read opens nothing and says so in plain words, as one that is not there";
  `tests/ui_quick_create.test.mjs`, "New outcome says a refusal in plain words,
  and a changed title after a lost answer is a new request".
- `tests/topic_header_native.mjs` (`native-header`): "header a chip pressed
  after someone else changed where it stands, before the page has read it, is
  refused in plain words, and theirs stands".

## One link per area

Each area has one link that opens it, and that link is what gets shared and
tried. Tony tries a preview from the one link he is given.

- No automated check. Held by the release and preview tools, which each hand out
  one address.
