# Reading colors

Owner: aim-ux. Integration and release: fable. Request: Tony, Friction log
message `m-ca18c51f98ef4147a1e694c552ff84e8` (#267). Base:
`8a19ea8bd450bc1e90917536ac8dfcf9ffb0a915` (`origin/fable/rail-scroll`).

At that base, `web/aim.css:2` paints a hovered topic message with `--soft`;
`:18` leaves the reading pane on the dialog background and paints passage
hover with that same `--soft` using an ordinary inline background. Native
selection has its own color. `web/app.mjs:494-505` renders message cards
without an own-author style. `web/reader.mjs:225-315` owns passage boundaries,
hover/range arming and the exact excerpt; this change preserves that behavior.

## Trigger and result

- Opening a message in the Reader shows its source text against the existing
  topic-card hover color (`--soft`). Since agent colors this is per author;
  see "The Reader's page" below. The writing field keeps its background,
  dimensions and contrast. The shared source-text surface uses the same colors
  for Notebook reading.
- Hovering an eligible passage paints black behind light, readable text, with
  the same vertical coverage as selecting that text natively (within one device
  pixel for rasterization). Wrapped lines
  remain distinct and the paint must not change wrapping, spacing or hit areas.
  Native selection stays visually distinct from passage hover.
- A topic message authored by the current actor has a black background and
  light text. Ownership is derived from `item.author_id === bootstrap.actor`,
  never a hard-coded name. Other authors retain their current appearance.
  An own message stays distinguishable when hovered, with a visible border
  treatment; keyboard focus keeps its existing outline.
- These results apply in light/dark themes and laptop/mobile layouts. No new
  control or gesture is introduced. Reader dimensions, writing space, hover
  eligibility, Shift-click range, Return quoting, newline, send and Undo remain
  intact. Nearby writing/control interactions must not arm a passage or send.

## Evidence

Use an isolated instance, origin, actors and Chrome for Testing, after Fable
confirms the test slot. First capture the current failure against these visual
requirements. Verify native pointer hover and native drag selection on the same
single- and multi-line source text, with screenshots comparing their painted
height. Assert source and writing geometry are unchanged. Check own/other cards
at rest, hover and keyboard focus in both color schemes; repeat at phone width
with native touch and no horizontal overflow. Exercise quote/Undo/newline and
existing send behavior using the current native fixture. Inspect redraw after a
new message and confirm author styling on both old and new cards.

The visual change itself does not change records; red visual evidence is its
regression control. Any new load-bearing test instrument receives an applied
negative control. Existing assertions change only if the intended behavior
explains why their prior expectation is wrong. No unrelated punch-list changes
or live traffic belong in this slice.

## Critique and implementation

Fable reviewed the contract in Friction log #274, and aim-spec in #275 and
#277, before the build. Their concrete constraints are included: preserve the
source's direct text children and passage boundaries; use its computed 1.7 line
height; keep secondary own-card text readable in light mode; use a distinct
border in dark mode; and keep the existing native input checks.

The source pane uses `--soft`. Passage hover uses a black inline background
and two vertical shadows, extending only paint by half the difference between
the source line height and its inline text height. `Reader.applyLayout` measures
those existing boxes; it adds no padding, children or input behavior. Own cards
receive a class from the current actor comparison and use black with light body,
time and excerpt text. Their border changes on hover; native focus stays visible.

`tests/reader_colors_native.mjs` adds one focused check, run by the existing
native fixture with `--colors`. It covers initial paint and automatic WebSocket
arrival, own/other cards at rest and hover, native Tab focus, dark/light contrast,
wrapped passage paint versus actual partial drag selection, exact Return quoting
and Undo, Notebook provenance, and phone-width colors/touch/overflow. Screenshot
pixel bands, rather than DOM rectangles alone, measure the painted height.

The test helper deliberately rejects unsupported PNGs. Its wrong-color control
must return no band; an applied mutant returning a constant band was caught by
that assertion and then restored byte-for-byte. Red and green runs retain their
source snapshots, screenshots and fixture/browser cleanup evidence.

## Verification handoff

Final evidence is under `work/evidence/reading-colors/`: `green-04-final`
(the focused dark/light laptop/phone check), `inline-02-final` (9 existing
native checks), `reader-final` (5 existing native checks), and `unit-final.txt`
(69 existing component checks). `red-03-live` is the failing base UI control;
`mutant-band` is the applied instrument control. `verification.json` binds the
passing source snapshots to current bytes; `REPORT.md` lists checks and limits.

Run the focused check with `node tests/reader_persistence_native.mjs` followed
by the Chrome for Testing executable, an absolute evidence directory, and
`--colors`. All retained final checks pass; review and release remain Fable's.
Mobile evidence uses emulated native touch in CFT, not a physical phone or Safari.

## Release review corrections

Fable's independent implementation review (#292, on cherry-pick d0bd2af)
found two inadequate measurements and one contrast regression. The old paint
scan stopped five pixels outside the glyph box, so it could not see paint
spilling farther into the next line. The source check read its container's
computed background even if an opaque article hid that background. Neither
measurement fully enforced the existing intended appearance.

The correction scans two line heights above/below each measured text rectangle
and samples an actual pixel in whitespace between source words. Both reviewer
mutants (overhang multiplied by two, and an opaque article background) must fail.
The small source-actions hint must meet 4.5:1 on the newly colored pane in both
themes; darken only that hint in light mode, keeping dark mode's passing color.
No native-input expectations change. Optional hover treatments and additional
arrival coverage remain separate from these three requested corrections.

The corrective evidence is in `work/evidence/reading-colors/review-corrections/`.
`red-hint` fails the old 4.15:1 light hint; `tall-highlight` and `opaque-source`
catch both applied reviewer mutants in both themes. Each mutant is restored
byte-for-byte. `green` passes with the hint at 4.75:1 in light and 4.87:1 in dark;
all four runs close their browser and fixture cleanly. The local report and
verification manifest retain the exact sources, pixel readings and screenshots.

## Agent colors

Each agent has its own color. Its cards in a topic are tinted with it across
their whole face, and its name on each card sits on a deeper tint of the same
hue. There is no colored edge, bar or border: the card's border stays the
shared line color on every side. The person's own messages keep their black
and carry no tint, whoever they are; other people's cards keep the plain
card. Hovering an agent's card deepens its tint a little. Hovering another
person's card gives it a neutral grey tint (`#eff0f0` light, `#252b2e` dark),
not the green that is Fable's card at rest, with its quiet words deepened so
every word keeps 4.5:1 (`tests/ui_card_hover.test.mjs`).

`topic_messages` items carry `author_kind` (`human` or `agent`, from the
actor record), and only an `agent` card is tinted. `web/author-colors.mjs`
gives the team's agents fixed colors and any other agent indigo or olive,
which no team agent has, picked by FNV-1a over its id's UTF-8 bytes: the
same agent always gets the same color, on every page and every device, and
no other agent is taken for one of the team. The colors themselves are
classes in `web/aim.css`, one per palette name, for light and dark.

## The Reader's page

The Reader shows an agent's message on that agent's color as its card shows
it under the pointer: the card the person has just pressed, in the color the
person sees that agent in, their own choice included, and repainted when they
choose another. Every other source, the person's own message, another
person's message and a Notebook page, is read on a neutral page (`#eff0f0`
light, `#252b2e` dark), never the green that is Fable's card, so nothing opens
looking like Fable's. The message source view says which kind of actor wrote
it (`author_kind`, as `topic_messages` does), and `paneClass` in
`web/author-colors.mjs` picks the page. On an agent's color in light the
small source-actions hint is darkened to `#56616a`, as on its cards, so every
word on the page keeps 4.5:1 (`tests/ui_author_colors.test.mjs`); the native
colors check opens an agent's message, the person's own and a Notebook page
and reads the page's color from screenshot pixels behind the words.

Fable's color is the green its cards already had. Before agent colors, the
live app painted every agent's card plain at rest and in `--soft` under the
pointer, and the Reader's page in `--soft` too; that green (`#e8f1ec` light,
`#263d35` dark) is what Tony called Fable's color as it stands (#452), so
Fable's card is that green at rest, in both themes. The person's own black is
unchanged. Orchid, which Fable had for a while, belongs to no one by default
and stays in the palette for anyone to be given. Green's nearest neighbours
are olive and cyan, at CIEDE2000 7.0 and 9.4 apart on the name's tag in light
(10.1 and 11.1 in dark); the palette's closest pair, violet and orchid, is
4.4, so no agent's default needed to move.

The other hues stay clear of the warning amber and the red New line. On a tinted light card the quiet text (`--muted`) is darkened to
`#56616a`, and on a tinted dark card the excerpt cue (`--accent`) is lightened
to `#79c7ab`, so that body, name, time and cue all keep at least 4.5:1 on the
card, on its hover, and on the name's tag:

| Color | Agent | Light card / name / hover | Dark card / name / hover | Lowest text contrast, light / dark |
|---|---|---|---|---|
| green | `fable` | `#e8f1ec` / `#c8e0d2` / `#dfece5` | `#263d35` / `#385a4d` / `#29403a` | 5.21 / 4.64 |
| blue | `aim-lead` | `#ebf2fa` / `#c6daf1` / `#e0ebf7` | `#202d3c` / `#32465d` / `#243242` | 5.25 / 5.44 |
| indigo | fallback only | `#ececf9` / `#c9cbed` / `#e2e3f5` | `#222339` / `#363759` / `#262740` | 4.99 / 6.06 |
| violet | `aim-ux` | `#f2edf8` / `#dacbeb` / `#ebe3f4` | `#2d2438` / `#463757` / `#32283e` | 5.08 / 5.81 |
| orchid | no one by default | `#f7edf7` / `#e9cee9` / `#f3e5f3` | `#372537` / `#553a55` / `#3d293d` | 5.22 / 5.54 |
| rose | `aim-spec` | `#f9ecf0` / `#edc9d5` / `#f5e2e9` | `#39222a` / `#593641` / `#40262f` | 5.11 / 5.71 |
| peach | `warp` | `#faf1eb` / `#f1d7c6` / `#f7eae0` | `#3c2b20` / `#5d4332` / `#423024` | 5.37 / 5.22 |
| cyan | `aim-core` | `#ecf6f9` / `#c9e6ed` / `#e2f2f5` | `#223539` / `#365259` / `#263b40` | 5.51 / 4.92 |
| olive | fallback only | `#f4f7ee` / `#e0e8cf` / `#eff3e5` | `#313626` / `#4c543b` / `#373c2a` | 5.62 / 4.76 |

`tests/ui_author_colors.test.mjs` reads these colors from `aim.css` and holds
every pair to 4.5:1, the name's tint to 1.15 times its card's luminance, and
the rules to no edge or bar. `tests/agent_colors_native.mjs` (run with
`--colors`) checks the painted result: every agent's card and name in light
and dark, at laptop and phone width, from screenshot pixels, and saves those
screenshots for review.

## Hovering your own message

Your own card is black, at rest and under the pointer, exactly as it was
live: hovering changes only its border, from the accent to the ink color,
never its fill and never with an edge or bar. `tests/ui_own_hover.test.mjs`
holds this from `aim.css`, and the native colors check reads the hovered
card's fill from screenshot pixels on both sides.

## Choosing an agent's color

Each agent's color above is its default. A person can choose another for any
agent, for themselves alone: clicking the agent's name, on one of its cards or
in the topic's participants, opens a small picker with the palette's colors
and the agent's default. The choice is kept by Core, so it follows the person
to every page and device; it changes nothing anyone else sees, and no
message, delivery or wake. The person's own messages keep their black: there
is no choice for oneself, and a person's cards are never tinted.

Contract:

- Record: `color_choices`, one row per (chooser, agent): `color`, a palette
  name or null for the agent's default, and a `revision` that only grows. Rows
  are never deleted, so a revision is never reused. Schema version 17 adds the
  table; stepping back to 16 is refused while any row exists, reset rows
  included, since dropping one would restart its revisions.
- Command `color.set`: target `{actor_id}` (an agent, not the chooser),
  args `{color}` (a palette name, or null to go back to the default),
  expected `{color_revision}` (the revision the page last read, 0 for none).
  A palette name is the only color accepted: no CSS ever comes from a request.
  A stale revision is refused with the current one, so a late request never
  undoes a newer choice. Choosing the color already chosen changes nothing.
  The choice adds an actor-scoped change (`color`, the agent's id).
- View `colors` (`cursor`, `limit`): the reader's own choices, reset ones
  included, in agent id order, each `{actor_id, color, color_revision}`, and
  `palette`, the colors a choice may name, in the order a picker offers them.
  Core owns the palette; the browser draws each name as a class in
  `web/aim.css`, and a check holds the two to the same names.

The page reads `colors` when it opens and again when it is shown or focused,
so a choice made on another device is there when the person comes back to
this one. The read at opening, and one a picker or a refused choice waits on,
goes in the foreground read lane, since the first cards wait on it; the read
on focus goes in the background lane; one asked for while another runs runs
after it even if that one fails. A read may land after a choice the page made while it was out, so
each agent keeps whichever choice has the higher revision, and an agent the
read does not list keeps its choice (Core deletes none, so the read had not
seen it). A card's color is the reader's choice for its agent when there is
one, else the agent's default.

The picker (`web/color-picker.mjs`) is a non-modal popover labelled "Color
for" the agent: a swatch per palette color, each a button named for its
color, and "Default (its own color)", with the current choice pressed and
focused. Each swatch is outlined in the quiet text color, at 3:1 or better
against the picker in both themes (WCAG 1.4.11), and the pressed one also
wears an ink ring. The arrow keys, Home and End move between them, and Tab goes round
them while it is open; Escape closes it and gives the focus back; a press
outside closes it; pressing the name again closes it. It is placed once, fixed
to the window, so when a scroll moves its name away it closes rather than float
away from it, giving the focus back to the name if it held it; a scroll that
leaves the name where it was (to within a pixel), such as the page holding its
place while a message arrives above, leaves it open. A choice closes it once
Core has committed it, and a refusal is said inside it. When the answer is
lost on the way, the picker says it is unknown whether the color was saved and
that a press again sends the same request: the page keeps one request per
agent, color and revision, under the authority it was made with, and sends it
again as it is until Core records an answer, so Core answers a press again
with what it recorded rather than calling it a change made elsewhere. That answer can be older than a
choice the page has read since; the newer one stays, as with any read. A card is itself a
button that opens the message, and a control inside a button is not reachable
or announced as one, so on a card the name is a pointer shortcut: a click on
it opens the picker instead of the message, and the focus returns to the
card. The keyboard way is the topic's participants, where each agent's name is
a button of its own, in the agent's color; an agent keeps the same button
across repaints, so the focus goes back to it after a choice. The page reads the choices before
it first draws the cards, so they wear the chosen colors from the start; a
read that fails leaves the defaults, and opening the picker reads again.
