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
up, the message still shows enough to read while writing. The Reader and the
New message sheet are as tall as the window and grow with its width up to a
maximum, and on a phone never reach past the screen.

- `tests/reader_native.mjs` (`native-reader`): "default stacks, wide keeps
  writing full height, layout switch preserves typing", "divider click is inert,
  native drag changes proportions and preserves typing".
- `tests/reader_compose_native.mjs` (`native-compose`): the "size …" cases, at
  320, 375 and 390 points, a laptop and a window wider than the maximum
  ([reader.md](reader.md), "Size"); "phone …: reading shows at least 18 lines
  of the message, writing with the keyboard up at least 7, …" and "laptop
  stacked …: … at least 17 lines while writing", each with a long reply and
  the To line under the who chip ([reader.md](reader.md), "Naming who a
  message is to"); "header …: on a phone at 320, 375 and 390 the Reader's
  title is whole on the header's second row, … the two rows no taller than
  their targets and the message right under them, its end keeping its room; a
  laptop's header, stacked and wide, keeps one row and its room" and "access
  notice …: on a phone at 320, 375 and 390 the notice keeps the room under the
  Reader's two-row header, …", one case for each of the notice's states
  ([reader.md](reader.md), the archive button's two-row phone header).
- `tests/reader_native.mjs` (`native-reader-finished`): "finished the save
  status is one line whatever it says: …".
- Gap: no check measures how much of a phone screen the message keeps while the
  keyboard is up. The phone check records the visible height before and with the
  keyboard (`keyboard.visualBefore`, `keyboard.visualSmallest`), as evidence for
  that check ([device-evidence.md](device-evidence.md)).

- `tests/reader_compose_native.mjs` (`native-compose`): the “item 650” cases
  hold resizing either composer edge symmetrically around the centre, only
  horizontally, at 320, 375, 390 and laptop in both themes and engines, in
  each affected state ([composer-width.md](composer-width.md)).
  Review corrections add held-drag reversal, native Tab reach, topic access
  and conflict/recovery branches. These revised native cases are UNRUN pending
  runner budget; the prior run does not prove them.

## Keys mean one thing in each place

While reading a source, Return quotes the selected or lit passage, in the
Reader and on a topic's or a dossier's card alike, and ⌘C copies exactly the
lit passage. In the reply,
Return makes a new line and Cmd-Return sends. In a private note, Cmd-Return
saves the note. Buttons, pickers and other controls keep their own keys. A hover
never promises a quote that Return would not make.

- `tests/reader_native.mjs` (`native-reader-keyboard`, `native-reader`): "hover
  Return quotes exact words and composer Return stays a newline", "note
  Cmd-Return saves only the note and keeps the Reader open on the reply",
  "nonempty send-and-stay shortcuts each send once and keep the reader open".
- `tests/topic_reading_native.mjs` (`native-reading`, `native-webkit-reading`):
  "reading a passage the pointer rests on lights on a topic's card and a
  dossier's; ⌘C copies exactly its words and Return quotes them …", "reading
  a card's lit passage goes out as the focus moves to a control of the message
  or to writing …" (no hover promise where Return presses a control),
  "reading Shift-click on a card grows the light and opens nothing …",
  "reading a cut-off card's lit passage goes out as its whole message
  arrives …" and "reading an edit arriving under a card's lit passage puts
  the light out …" (a card drawn again with other words lights none of them
  until the pointer moves, so Return and ⌘C act on no words that were not
  lit), "reading Shift-click on a link in a card's words opens it in a new
  window …", "reading a card's lit passage goes out as the message's ⋯ menu
  takes the focus …" and "reading Tab off a lit passage on a dossier's card
  puts the light out …".

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
  with a ring, …" reaches each pencil by the keys and presses it with Return;
  from anywhere outside writing an arrow lands on the nearest control that
  way and the arrows reach every control a click reaches, the "rail arrows
  …" cases (docs/interaction.md, "The arrows everywhere").
  `tests/reader_colors_native.mjs`
  (`native-colors`, `native-webkit-colors`): the own card is reached by native
  Tab, and keyboard focus stays visible on it.
- `tests/fence_copy_native.mjs` (`native-fence-copy`) checks keyboard activation on the copy glyph and its feed card in Chromium and WebKit.
- Focus follows the pointer into the keys: `tests/outcome_rail_native.mjs`
  (`native-rail`, `native-webkit-rail`): "rail a press on an outline row opens
  its place in place with the keys kept on the row, wearing their ring: …",
  and the same for the row being read, a refused move and Waiting on you.
- `tests/outcome_rail_native.mjs` (`native-rail`, `native-webkit-rail`): "rail
  the keys reach a Build topic from the right rail: ↓ to its row, Return opens
  it in place and the keys stay on its row, …" (item 297: an outcome's Build
  topics are the right rail's, never the outline's too, [rails.md](rails.md)).
  "rail turned off while a Build topic is read, the topic moves live …", "rail
  a piece started in the topic being read moves it live …" and "rail a Build
  topic marked Done while its piece is still under way …": the open topic is
  in one list, never both and never neither. "rail with more than 20 Build
  topics, the piece in Now …" (every Now row carries its marks) and "rail the
  right rail's Build topics follow the reader's own order …" (⌘↑/⌘↓ order, as
  the outline keeps it).
- Touch: see "A phone by touch" below.
- `tests/outcome_rail_native.mjs` (`native-rail`, `native-webkit-rail`): the
  "rail item 654 …" cases tap a collapsed outcome and then the open one:
  the first expands its topics with the drawer, page and scroll kept; the
  second opens its Conversation. Topic taps and laptop clicks keep their way,
  at 320, 375, 390 and 1280px, in light and dark.

## Dismiss without losing work

A press outside a pop-up closes it and keeps unsent writing and images. A press
outside, Escape and the close control all keep work the same way. A press that
starts or ends inside the pop-up is not an outside press.

- `tests/team_bar_native.mjs` (`native-colors`, `native-webkit-colors`):
  "colors item 643 B1 drag endpoints keep picker open" and the empty,
  refused, error and busy picker cases exercise drags from the Team label
  into the name field or choices, and back out. The actual pointer release
  decides whether it ended inside, even when the click targets their common
  ancestor. Each runs at 320, 375, 390 and 1280px, light and dark.
  `tests/ui_people.test.mjs`: "item 643 B1 Team dismissal uses both pointer
  endpoints, not the common-ancestor click target" also checks captured,
  cancelled and mismatched-pointer releases never close the picker.

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

A reply in doubt that will never go can be set aside without losing its
words: they go back into the empty writing (to the same people, a whisper
still a whisper), or stay readable on its line with Copy and its images, in
reach through a Set aside chip after the list closes and after a reload, and
Undo puts the reply back in doubt ([replies-in-doubt.md](replies-in-doubt.md)).

- `tests/set_aside_native.mjs` (`native-rail`, `native-webkit-rail`): "rail set
  aside composer", "rail set aside message", "rail set aside attachment",
  "rail set aside kept words", "rail set aside kept image", "rail set aside
  whisper", and "rail set aside looks right" and "rail set aside kept looks
  right" (1280, 320, 375 and 390, light and dark). Each of the composer,
  message and attachment shapes loads the page again on the topic, opens its
  writing (a message's in the Reader), closes it and presses another topic,
  which goes on the first try; then, in a second tab, the writing is ready to
  send and the press goes.
- `tests/ui_inline_wiring.test.mjs`: "a reply set aside with its words kept has
  a Set aside chip the guard does not name".
- Node units: `tests/ui_topic_navigation.test.mjs`, "an image retained from
  the draft lets the page leave while it is still being checked; one the draft
  does not name holds".
- Core: `tests/test_set_aside.py`.

## Your place holds

Topics stay where the reader puts them in the left rail. New messages,
reloads and other people’s activity never move them. A new topic appears
at the top of its outcome once, then stays until the reader moves it.
`tests/outcome_rail_native.mjs` (`native-rail`, `native-webkit-rail`), the
"rail item 641" cases, check this at 320, 375, 390 and laptop widths, light
and dark, including the reader’s own native reorder.

Opening, using and closing a card composer keeps the page at its place
(item 644). Quoting on a laptop opens a stacked reply wide (item 668);
a phone stays stacked. `tests/notebook_pages_native.mjs` (`native-notebook`,
`native-webkit-notebook`) and `tests/reader_compose_native.mjs` (`native-compose`,
both engines), the cases named "item 644", hold these acts at 320, 375 and
390 pixels and on a laptop, light and dark.

A message arriving never moves what is being read or written, and nor does
quoting from it, nor typing in the reply. A quote keeps its words in sight
until you scroll the message yourself, however you scroll it, and keeps the
words themselves when the lines wrap anew. Loading older messages shows them
where they were asked for. The New line fading or moving never leaves the
page shorter under what is being read.

- `tests/reader_compose_native.mjs` (`native-compose`): "quoting keeps your
  place: the quoted passage stays where it was on screen, …" and "quoting from
  a passage taller than what shows keeps the words quoted where they were, …",
  in Chrome and Safari's engine, on a phone and a laptop, stacked and wide;
  "quoting: one who has not scrolled keeps the quoted words in sight as the
  reply grows, and a scroll the person makes … lets them go", "typing in the
  reply leaves a message scrolled to its end at its end", "quoting: words
  chosen to the very start of the next sentence …" and "quoting: once the
  lines wrap anew, the message shows the words quoted …".
- `tests/reader_live_native.mjs` (`native-live`): "live a message arriving
  leaves the card being read in place, and a field scrolled away holds nothing",
  "live with no card on the screen, a message arriving scrolls nothing".
- `tests/reader_inline_native.mjs` (`native-inline`): "inline find restore
  owner switch arrival and exact source-free send": while a new message is
  written at the topic page's end, a reply to the person's own message takes
  the place of its stack's taller read latest reply, shrinking what is above
  the writing by more than the page is scrolled, then a message of its own to
  the topic grows it; through both the writing, its caret and its focus stay
  where they were on screen, and no room is kept above the writing once the
  page can hold it by scrolling ([attention.md](attention.md)).
- `tests/topic_reading_native.mjs` (`native-reading`, `native-webkit-reading`):
  "reading Show full message on a card scrolled inside keeps the words being
  read where they were"; `tests/stack_native.mjs` (the same steps): "reading
  stacks a message arriving in an open dossier hides nothing being read: …",
  the newest seven counted when the dossier opened, so a reply arriving never
  puts the card or row being read behind the earlier-messages row.
- `tests/stack_native.mjs` (`native-reading`, `native-webkit-reading`):
  "reading stacks one dossier whose fork sits above the loaded page is one
  stack …": a dossier the loaded page cuts above its fork is one stack, its
  name once, at 320, 375 and 390 and a laptop, and loading the older
  messages, the fork and then its first message, shows every message once,
  each where the button was, and leaves the stack its head and its name once
  ([reply-stacks.md](reply-stacks.md), "One dossier, one stack").
- `tests/stack_native.mjs` (`native-reading`, `native-webkit-reading`):
  "reading stacks Earlier messages shows every older message it loads where
  the button was, those of a dossier whose stack sits higher up too …": the
  older replies of a dossier drawn higher up show below the last card shown,
  newest first, whole, and neither that card nor the stack higher up moves or
  takes another head, at 320, 375 and 390 by a finger and a laptop.
- `tests/stack_native.mjs` (`native-reading`, `native-webkit-reading`):
  "reading stacks a dossier whose first message is above the page stays as
  the reader left it …" and "… a dossier the reader placed, its first
  message above the page, keeps its place …": Earlier messages loading an
  older reply to a dossier's first message, then that first message, leaves
  the dossier open under its head with the seven it showed and its
  earlier-messages row as it was, at 320, 375 and 390 and a laptop, and where
  the reader placed it, through a reload too.
- `tests/new_line_native.mjs` (`native-colors`, `native-webkit-new-line`):
  "the room after the Notebook keeps the card being read in place as the New
  line fades or moves up, and goes as the person scrolls up", at a phone's
  320, 375 and 390 widths and a laptop: the message opened from the top of
  the window is where it was when the Reader closes, and pushing down at the
  page's end, with the line showing, faded or moved, or with no room after
  the window is resized there, leaves the room as it was.
- `tests/reader_freshness_native.mjs` (`native-freshness`): the F-series. Reads
  continue through retries, resyncs and failures, and a "caught up" state is
  claimed only after a pass of reads has run to its end
  ([scoped-updates-followups.md](scoped-updates-followups.md)).

- `tests/notebook_sheet_native.mjs` (`native-notebook`,
  `native-webkit-notebook`): the "notebook item 642" cases keep Text, Cards and
  Draft in the same boxes while a card is written and its saving sign changes;
  every status branch at 320, 375, 390 and laptop, light and dark, with the
  status in a row of its own ([decks.md](decks.md#where-it-opens)).

## Actions are where you look for them

An action sits on the surface where its work happens. A count leads to what
it counts: a press on a topic's unread count shows the oldest message still
unread, plainly on screen, however deep it is, and the count counts nothing a
press cannot reach.

- `tests/stack_native.mjs` (`native-reading`, `native-webkit-reading`):
  "reading unread count one press lands on the oldest unread message deep in a
  dossier behind its earlier row, on screen, and the count goes once it is
  read", at a laptop's width and at 390, 375 and 320 on a phone, light and
  dark; `tests/test_new_line.py` (`CountLeadsThereCase`): the count and the
  message it leads to are one rule ([attention.md](attention.md)).
- `tests/topic_header_native.mjs` (`native-header`): "header a topic Ready for
  review shows ✅ Done beside its state; a click marks it Done, into the Done
  group, and the button goes; an active topic shows none", "header ✅ Done is
  reached with Tab and pressed with Return or Space, and the focus lands on the
  subtitle saying Done".
- Otherwise no automated check. Held by Tony's preview of every new surface.

The topic's Team says "Team". + Add becomes Done while the possible agent
pills and field show; Done or a click outside closes them without adding the
filter's words. `tests/team_bar_native.mjs` (native-colors and
native-webkit-colors), the "item 643" cases, holds this at 320, 375, 390 and
laptop widths in light and dark, including empty, refused, error, busy and
read-only states. `tests/ui_people.test.mjs` holds drag-out and focus behavior.

## Quiet, not button land

A surface shows what the person came for: the words, and the one or two acts
they are most likely to take. Everything else waits behind a ⋯ or a +, or
appears once the person starts the act it belongs to. A word, a glyph or a small
mark in a line beats a boxed button. Marks on a card sit in the card's own line.

- `tests/outcome_rail_native.mjs` (`native-rail`, `native-webkit-rail`): "rail
  no page has a header bar or Refresh; …"; "rail on a laptop each pencil is
  quiet until the pointer is on its row or heading: …" (a pencil, not a
  + New topic row, and none shown on a row neither pointed at nor keyed).
- `tests/card_marks_native.mjs` (`native-card-marks`): "marks at …: an image,
  your note and your saved reply each show a quiet named glyph beside the
  time; another's never does", at 320, 375 and 390 points and a laptop, light
  and dark, in Chrome and Safari's engine: each mark is in the card's line on
  the time's line, never a control, and a card with all three keeps a one-line
  author line; "head rows at …" checks a stack's head row keeps its reply count
  whole beside them, and "picture-only head row at 390px …" that a selected
  dossier's image mark and who began it stay whole beside its title bar's ⋯
  ([topic-reading.md](topic-reading.md), "What a card carries");
  `tests/stack_native.mjs` (`native-reading`, `native-webkit-reading`): "reading
  stacks hidden title bar glyphs reserve nothing …", at 320 by touch hidden
  glyphs keep no width from a dossier's name, and "reading stacks the title
  bar's ⋯ sits on the folder's face …", ⋯ stays inside the folder's right edge,
  the tab giving back no more than ⋯ needs, at 320, 375 and 390 each way a
  touch shows it and on a laptop, light and dark.
- Gap: a page check that counts the boxed controls showing before the person
  acts is proposed and not built. Until then, Tony's preview holds this.

## One meaning, one glyph

Every menu item shows a glyph before its words, and an act keeps one glyph in
every menu: the glyph of the button that does the same thing, where there is
one ([links.md](links.md), "A message's menu"). The words, their order, keys
and acts are what they were.

- `tests/stack_native.mjs` (`native-reading`, `native-webkit-reading`):
  "reading menus every item of a message's ⋯, a right-click, a dossier's menu
  and the phone's sheets carries its glyph before its words, …", at 320, 375
  and 390 points and a laptop, light and dark, in each state an item has.
- `tests/reader_compose_native.mjs` (`native-compose`, Chrome and Safari's
  engine): "menus phone-320: …" to "menus stacked: every item of the
  Reader's ⋯ carries its glyph …".
- `tests/notebook_pages_native.mjs` (`native-notebook`,
  `native-webkit-notebook`): "notebook menus the Reader's ⋯ on a Notebook page
  carries a glyph before each item's words, …".
- `tests/pipeline_native.mjs` (`native-pipeline`, `native-webkit-pipeline`):
  "pipeline menus every item of an item's ⋯ carries its glyph …".
- Each browser case above also holds what every glyph draws: the approved
  design page's drawing, ink that shows (Quote selection's ❝ included), and for
  the pencil and the tray the New message and Reader's archive buttons' own
  drawings as the page shows them (`misdrawn` in `tests/menu_glyphs.mjs`).
- `tests/ui_menu_glyphs.test.mjs` (node): the glyph by name, silent and after
  the words in the document; an item with no glyph opens no menu; every glyph
  draws the approved drawing, and a borrowed one is its named control's.

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
  a topic page, its Team and its composer keep to the rule", "forms the
  Reader on a message, on a Notebook page, its note and its Start a topic line
  keep to the rule", "forms a resumed opening and a resumed outcome form keep to
  the rule".
- `tests/pipeline_native.mjs` (`native-pipeline`, `native-webkit-pipeline`):
  "pipeline turning it on is one tap from the outcome page, and one line and
  Return adds an item whose words and size are set in place".
- `tests/team_invite_native.mjs` (`native-forms`, `native-webkit-invite`):
  "forms invite an agent from the Team panel: a name, Codex, Return; …", and
  each of its states measured at 320, 375 and 390 pixels by touch and on a
  laptop, in light and dark ("forms invite on a phone by touch the line and
  the prompt fit …"); after a reload, or a lost answer and another outcome,
  the same name typed again gives back the same agent ("forms invite after a
  sign-in file not written and a reload …", "forms invite after a lost answer
  and a move to another outcome and back …").

## No coloured left edges

Nothing is marked by a coloured edge or bar down one side. A card's colour
covers its whole face, and a dossier's colour, its first poster's when that
is an agent, covers its folder and its title bar, and nothing else (item 477).

- Node units, `tests/ui_author_colors.test.mjs`: "nothing on the page wears a
  colored left edge or bar", "an agent's card is colored across its whole face,
  never by an edge or bar".
- `tests/reader_colors_native.mjs` (`native-colors`, `native-webkit-colors`):
  the hovered card is black on both sides, with no edge or bar, measured from
  screenshot pixels.
- `tests/ui_folder_colour.test.mjs`: "the coloured folder covers a whole
  face"; `tests/stack_native.mjs`, "reading stacks a dossier an agent began
  wears its colour …", measures no edge on the folder or its tab.

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
- `tests/targets_native.mjs` (`native-targets`, `native-webkit-targets`):
  "targets the owner's Complete · Archive, and Bring back on the page, the home
  and a topic, are 44px tall at 320, 375 and 390 …", and "targets the owner
  archives by touch …" (archived by a tap, brought back by the keys).
- `tests/reader_navigation_native.mjs` (`native-navigation`): "navigation
  paging workspace denial retry and narrow touch targets".
- `tests/reader_openings_native.mjs` (`native-openings`): "openings 390px touch
  an opening types adds a participant saves and sends by tap".
- `tests/outcome_rail_native.mjs` (`native-rail`, `native-webkit-rail`): "rail
  the header at 320, 375, 390, a narrow laptop and a laptop, light and dark,
  …" measures which line each of the header's pills is on in each state of
  "☰ Outcomes" (nothing, a count, a count and the light, two digits with and
  without the light, the light alone): "Pipeline & pages" goes under it,
  whole, only when the two pills and one gap do not fit the row (at 320 with
  the light and a count); otherwise the outcome's name gives up its room and
  the two share the line; no part of the page ends past the screen's right
  edge.
- `tests/outcome_rail_native.mjs` (`native-rail`, `native-webkit-rail`): "rail
  at 320, 375 and 390 the pencil beside the outcome in the open drawer always
  shows, 44px, …", in both themes; "rail each pencil's title line, at 320, 375
  and 390 in the open drawer and on a laptop, …" draws each of its states
  (open, refused, busy, refused by the server) at each width, in both themes.
- `tests/outcome_rail_native.mjs` (`native-rail`, `native-webkit-rail`): "rail
  the rail's foot: who you are on which instance, the guide's ? and Health sit
  below the side rail's last section …", at 320, 375 and 390 in the drawer and
  on a laptop, light and dark: the three end the rail (or the page with no
  rail) inside the screen, the guide's ? is 44px to a finger and opens the
  guide; `tests/health_native.mjs` (`native-health`, `native-webkit-health`):
  "health lit at the foot of the side rail …", the lit link tapped there opens
  Health ([rails.md](rails.md), "The rail's foot").
- `tests/outcome_rail_native.mjs` (`native-rail`): "rail on a phone, on a Build
  topic's outcome, the drawer's outcome row counts its Build topics' new
  messages and "Pipeline & pages" carries them to their rows; …" and "rail More
  topics in the right rail brings 20 more Build topics, …", at 320, 375 and
  390 in both themes: what is new where the outline has no row is counted on a
  control a finger can reach ([rails.md](rails.md), "Counts"). "rail on a
  phone at 320 375 390, with two-digit counts on ☰ Outcomes and on "Pipeline
  & pages" or one, nothing in the header runs past the page's edge", in both
  engines, measures each header control's right edge.
- Safari's engine at phone width, with touch: `native-webkit-whispers`,
  `native-webkit-notebook`, `native-webkit-rail`, `native-webkit-pipeline` and
  `native-webkit-colors` ([device-evidence.md](device-evidence.md)).
- `tests/stack_native.mjs` (`native-reading`, `native-webkit-reading`): "reading
  dossier look a folded excerpt draws only its row, by touch at 390, 375 and 320
  and on a laptop, …": a message the reader folded draws only its row by touch,
  and no card's words paint outside its own box.
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
- `tests/stack_native.mjs` (`native-reading`, `native-webkit-reading`):
  "reading stacks star hold: …": Move below More on a dossier holding a
  message the reader starred, from its menu and the Reader's archive button,
  says why in plain words where it was pressed, at 320, 375 and 390 points
  and a laptop, light and dark, and nothing moves on any frame
  ([dossier-below-more.md](dossier-below-more.md), item 635); "reading
  stacks star undo: …": Command-Z, or Undo in ⋯, after a Bring back on a
  dossier starred since, says why by the message whose ⋯ it was when that is
  the dossier's, else under the dossier's title bar, brought into view, and
  never beside a message of another dossier, and nothing says it was put back;
  "reading stacks star undo hidden: …": for a dossier the page does not draw
  (Show agent coordination off), on the status line, showing nothing hidden;
  "reading stacks star note over: …": pressed on a message at the bottom of
  the window, the words show over it, inside the window.

## One link per area

Each area has one link that opens it, and that link is what gets shared and
tried. Tony tries a preview from the one link he is given.

- No automated check. Held by the release and preview tools, which each hand out
  one address.

## A starred reply keeps its dossier

Opening a starred message shows its dossier name in the composer; pressing
that title returns to that dossier. Opening the same message from its dossier
agrees (item 655).

- `tests/stack_native.mjs` (`native-reading`, `native-webkit-reading`): the
  "reading item 655" cases use two differently named dossiers in one topic,
  the starred reply in the second outside the loaded page, and another topic
  on screen; at 320, 375, 390px and laptop, light and dark. The direct-link
  cases isolate the title and return from rail navigation. A return changes
  neither the star nor either dossier's position.
- `tests/ui_starred_dossier.test.mjs`: a valid cross-topic Starred route and
  a bounded return that preserves the paging gap, then merges an overlapping
  older page without repeating messages.

Item 655 review checks in `tests/stack_native.mjs` (`native-reading` and
`native-webkit-reading`): "reading item 655 B1-root", "B1-reply", "single",
"B2-fresh", "B3-position", "B3-root" and "B4-return" cover unnamed roots and
replies, singleton fallback, remote rename/clear/join/split, each failed
metadata lookup and settled Conversation return through Only new. Each
state runs at 320, 375, 390 and laptop, with light/dark screenshots.
