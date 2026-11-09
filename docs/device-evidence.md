# Device evidence: Safari's engine and the phone check

Chrome for Testing runs every page check. Two more sources of evidence cover what
Chrome cannot show:

- **Safari's engine.** The release check runs the same page checks again in
  Playwright's WebKit build.
- **A real phone.** The phone check page records what an actual phone did and
  posts it to a topic.

## Page checks in Safari's engine

`tests/webkit_native.mjs` runs the Chrome checks against the same isolated
fixture, with WebKit's own mouse, touch tap, keyboard, text input, screenshots,
colour scheme and viewport. Each mode runs every check its module offers. The
only exceptions are the checks it skips by name, each with a reason, and a skip
whose check no longer exists fails the run.

| Release step | Module | What it covers in Safari's engine |
| --- | --- | --- |
| `native-webkit-colors` | `tests/reader_colors_native.mjs` | Reading colours in light and dark: own and agent cards at rest, on hover and with keyboard focus; the hovered passage against a native selection; quoting a selection; colours at phone width with touch |
| `native-webkit-whispers` | `tests/whisper_native.mjs` | Every whisper check, including the phone-width layout and the dashed line in both schemes |
| `native-webkit-notebook` | `tests/notebook_pages_native.mjs` | Every Notebook page check, including 390 wide in light and dark |
| `native-webkit-rail` | `tests/outcome_rail_native.mjs` | The rail at 1280 and 390 wide, Tab order, lit outcomes, and the "☰ Topics" drawer at 390 wide |
| `native-webkit-pipeline` | `tests/pipeline_native.mjs` | Every pipeline page check, including the page and an item's record at 1280 and 390 wide |
| `native-webkit-device` | `tests/device_native.mjs` | The phone check page itself, below |
| `native-webkit-new-line` | `tests/new_line_native.mjs` | The red New line staying while read on screen, at 1280 and 390 wide, on a topic and a conversation, until a message at or above it is opened (by a card, the Reader's arrows, or a link); a lost read answer; no card reported read that the marks line or a conversation's Show row pushes off screen, and none held back by the rail's drawer. Its checks hold a read or lose an answer with Playwright's own request routing |

Five rail checks are skipped. Each depends on a Chrome harness tool that this
harness does not have:

- three hold a read open with request interception;
- one reads Chrome's network event stream;
- one records response bodies.

Each skip and its reason is recorded in `native.json`, under `skipped`.

`native.json` also lists the run's qualifications: where WebKit differs from
Chrome, and how the harness handled it.

- **Tab.** Plain Tab in Safari reaches only form fields. The harness presses
  Option-Tab, which is Safari's key for moving to every item.
- **Touch.** A WebKit context has touch, and with it no hover, from the moment
  it starts. A check that turns touch on gets its page loaded again in a touch
  context, at the same address, size and colour scheme.
- **Selection colour.** WebKit paints a page's `::selection` colour
  translucently. The selection band is found in the colour WebKit actually
  painted, and that colour must be a mix of the stylesheet's colour.
- **Selection height.** WebKit paints a selection over the glyph box on its
  first line, and from the line top to the glyph bottom on later lines. Chrome
  paints the whole line box. In Safari's engine the black hover is therefore
  required to cover the selection, not to match it exactly. On the first line
  it is up to 4 px taller than the selection, above and below.
- **Paint timing.** WebKit paints a new selection one frame after the event
  that made it. Each screenshot waits two animation frames.
- **Phone width.** A WebKit "phone" is a desktop window at phone width with
  touch, not iOS Safari. Its device scale stays at 1.
- **Leaving a page.** WebKit reports each read a page still had out when it
  navigates away as a page error ("... due to access control checks"), though
  the page handles the failure; Chrome reports none. Such an error, arriving
  between the main frame's navigation request and its arrival, is recorded as
  an event of the leaving page, not an error (`tests/webkit_native.mjs`).

Running these modes in WebKit found two faults, and both are fixed:

- **Topic strip.** Safari stores `scrollLeft` in whole pixels, so a lit topic
  beside the open one could stay cut by under a pixel. The strip is now always
  placed on a whole pixel, rounded towards the row it is showing
  (`web/outcome-scope.mjs`). On a phone the strip has since given way to the
  "☰ Topics" drawer (`web/rail-drawer.mjs`), which lists the topics top to
  bottom; the rail mode checks there that the open topic and a lit neighbour
  show whole.
- **Pipeline Turn on.** A live change could arrive while Turn on was still
  reading the pipeline. Focus then never reached the pipeline's title. Now a
  read overtaken by a newer one finishes when the newer one has painted
  (`web/pipeline.mjs`).

To run one mode yourself:

```sh
tools/native.py --out "$(mktemp -d)/webkit" webkit-device
```

playwright-core comes from `--playwright`, else `AIM_PLAYWRIGHT_CORE`, else the
one version under `~/Library/Caches/deno/npm/registry.npmjs.org/playwright-core/`.
Playwright finds its own WebKit build.

## The phone check

Some things only a real phone can show:

- the picker a phone offers for a names list;
- holding to select text, and the selection handles;
- the keyboard taking space from the page;
- a system notification;
- the tailnet page itself.

The phone check is a page of the app. Open it on the phone at
`/?phone-check=<topic id>`, over the tailnet address. It shows one step at a
time. Each step asks for one thing and writes down what the phone did, and every
step except the last has **Skip this step**. The person types nothing about the
results. Where only their eyes can tell (a notification appeared, the colours
read easily), they answer with one tap.

The last step shows the record as plain lines. **Send to Theseus** posts it to
the topic as one message from the person: a line per step, followed by the full
record as JSON. The page then reads the message back from Theseus and says
whether it matches exactly. If a send is lost, tapping again repeats the same
operation, so the message is recorded once.

What each part records:

| Step | What the person does | Evidence recorded (JSON key) |
| --- | --- | --- |
| Start | Taps **Start** | `page`: address (`origin`), whether it is `https` and on the tailnet (`.ts.net`), the `actor` and `instance` the page signed in as, the pointer type of the tap (`startPointer`: touch, pen or mouse), `userAgent`, `screen`, device pixel ratio (`dpr`), `viewport`, the visual viewport (`visual`), `touchPoints`, whether the pointer is coarse (`coarse`), whether hover is unavailable (`hoverNone`), colour `scheme`, and whether it was opened from the Home Screen (`standalone`) |
| The names list | Picks `fable` from the list the phone offers for the reply-address box (the same `datalist` box the app uses) | `names`: the value picked against the one asked for, the input type of each change (`insertReplacementText` when picked from the list, otherwise how it was typed), the box's font size, and the page zoom before and after (a phone that zooms into a small box shows it here) |
| Holding to select | Holds on a word until it is selected, drags the handles to cover the words asked for, then taps **That is my selection** | `longPress`: the selected text against the words asked for, the longest hold in ms, the pointer types, how many times a long press opened the context menu, and how many times the selection changed |
| The keyboard | Taps the writing box, types, selects a word with the handles, then taps **Record the keyboard** | `keyboard`: window and visible heights before the keyboard and at its smallest, whether a resize was seen, whether the box and its Send button stayed in view, the zoom, the length typed, and the selection's start, end and text |
| A notification | Taps **Allow and show a notification**, then answers **It appeared** or **Nothing appeared** | `notification`: whether the browser offers web notifications at all (`api`), the permission before and after the request, whether the test notification was shown or the error raised, whether it was tapped (`clicked`), and the answer (`saw`). It uses the same code (`web/attention.mjs`) as the topic page |
| Reading colours | Answers **Both read easily** or **Not easily** for an own card and an agent's card drawn with the app's own classes | `colours`: the scheme, each card's computed background and text colour, their contrast ratio, and the answer (`clear`) |
| Send | Taps **Send to Theseus** | One message in the topic. The page shows its id and whether the copy read back from Theseus matches exactly |

`native-webkit-device` runs this page in WebKit and checks that:

- every step records what really happened;
- a value that is not a name finishes nothing;
- a typed name is recorded as typed, not as picked;
- nothing is sent before the last tap;
- a lost send is retried as the same operation;
- the message holds exactly the record the page showed, and is recorded once;
- at 390 wide every control is at least 44 px tall (except the app's own names
  box, whose height is recorded), and nothing scrolls sideways.

Headless WebKit has no phone keyboard, no picker, no long press and no system
notification. There, the record says so (no resize seen, typed, mouse), and
that is exactly what a phone's record is compared against.

A preview serves the page on a copy of the live data. The evidence then lands in
that copy's topic, and taking the preview down deletes it, so read the message
before then.
