# Dossier message cards: implementation handoff

Status: researched implementation plan, **not implemented**. Tony approved the
v4 visual study on 12 November 2026 and asked for this handoff. The study is a
reference for appearance and motion, not a replacement for the feed's behavior.

Source inspected: `e710d883483c1ce03b5d9d4cb5a2556069907cf0` in
`/Users/commonfabric/aim-next`. This document was prepared in the isolated branch
`codex-worker/dossier-implementation-handoff`. Recheck these functions against
the current release before coding; a reviewed branch is not a live deployment.

## Reference and intended result

A dossier remains a folder with its existing tab, title, counts, chevron and
self-organizing message membership. Inside it, later replies overlap earlier
cards. Chronology remains top to bottom; the newest reply is at the bottom and
in front. Soft contact shadows make that layering visible. A folded message
becomes a quiet exposed edge, and can be brought back out in place.

A new reply enters from above with a fade, travels over the older cards and
lands at the bottom. The folder stays at its old height until the incoming
card reaches its lower edge. Its boundary then follows the moving card through
the landing and settle. It must not make empty room before the card gets there.

Approval and artifact records, in topic `t-b9a28549446e9d985cddea9cfa83c08f`:

- Tony's approval/request: `m-41ee81c7b922442dab694a577c63a9bd`.
- V4 delivery: `m-7c1d4ecf365d4574bd428d0182e60414`.
- Approved HTML: `media-4e2178a976e748508c81175dac01d47a`.
- Before/after stills: `media-271a33e532ed4f36a978dc36682b219c` and
  `media-49f7acd2c69046b5b9fa17677ad52763`.
- Motion clip: `media-15d7ba42c8c14e2595159fd334a1b515`.
- HTML SHA-256:
  `329bf57a507ccea3728eb9f1dae2c139299cb427f6c75e209ebcfa801e45cfc2`.

With your own bound CLI, retrieve the reference without somebody else's profile:

```sh
aim-next attachment media-4e2178a976e748508c81175dac01d47a \
  --message m-7c1d4ecf365d4574bd428d0182e60414 --out /absolute/new/path/dossier-v4.html
```

The temporary phone preview is
`http://commons-macbook-pro-1.saga-castor.ts.net:5193/`, reachable over Tailscale
while its separate preview server runs. The attachment and hash are the durable
reference. The preview has no live feed or record access.

### Reference measurements

| Part | V4 reference |
| --- | --- |
| Overlap | 12 CSS px between visible cards |
| Corners | 12 px on message cards; retain the existing dossier tab geometry |
| Material | Soft top contact shadow `0 -1px 2px rgb(0 0 0 / .20)` in dark; no broad halo |
| Light material | Contact shadow `0 -1px 2px rgb(54 46 38 / .10)` in the study |
| Author alignment | Visible name text shares the body's left edge; agent pill extends 4 px left of it |
| Text | Existing system font; body 16/24 px; author 12.8/19.2 px |
| Folded card | 44 px box; 32 px exposed when its successor overlaps 12 px |
| Folded ink | Study uses `.62` opacity on contents, full strength on hover/selection; see contrast correction below |
| Fold / unfold | 360 ms; `cubic-bezier(.25,.7,.2,1)` |
| New reply | 760 ms; top-down fade, a small tilt, slight overtravel and settle |
| Selection | Existing focus token and one strong ring; same light for pointer and keyboard |

Name alignment is about the letters, not the outside of the pill. In the
rendered desktop reference, Fable, codex-worker and tony all start at x =
383.390625 CSS px. That absolute coordinate is not a production layout rule.

The study alternates longer, multi-paragraph arrivals with brief follow-ups.
Use that range when judging motion; don't tune it only against equal-height,
one-sentence messages.

## Production behavior to retain

The authoritative contracts remain [reply-stacks.md](reply-stacks.md),
[interaction.md](interaction.md), [topic-reading.md](topic-reading.md), and
[experience-guidelines.md](experience-guidelines.md).

- A stack has `head`, `folded` (latest plus unread/kept), and `open` states.
  An individual saved message fold is a different fact. Changing a stack's
  state does not clear the reader's saved message folds.
- `stack-order.mjs` decides gathering, joins, oldest-first reply order and
  dossier placement. A reader's own reply does not lift their dossier;
  somebody else's reply may. Placement still wins.
- Own replies and unread replies kept by the current visit remain visible as
  the existing contract specifies. Agent-coordination filtering, Only new,
  joined-stack provenance and the one New line retain their behavior.
- One message/header owns selection. Native arrows, Tab, Return, the existing
  menu, touch taps and swipes remain the ways to act. The study's `F` shortcut,
  demonstration buttons, fake reactions and simplified header clicks are not
  additions to the production key map or command API.
- No visual effect sends an extra fold, read, reply, deal or other command.
  Existing command/revision/undo/refusal handling remains in charge.
- A new message must not move the writing or message being read. A pressed
  target must not move before the press ends. Motion is subordinate to these.

The work appears to be client presentation work; no Core/schema/API change is
needed for the mapped design. This is a finding, not a ban on fixing a genuine
backend issue if implementation reveals one.

## Source map

Function names below are the stable pointers at the inspected commit.

| Source | Existing responsibility / integration point |
| --- | --- |
| `web/stack-look.css` | Sole owner of dossier appearance, `--stack-*` tokens, tab shape and ring, `.stack-replies`, folded rows, phone and dark variants. Keep visual choices here. |
| `web/aim.css` | Semantic theme and agent colors, `.author-name`, own black cards, shared message bar, scrolling card styles. Limit edits to genuinely shared styles. |
| `web/reply-stacks.mjs` | `arrangeStacks`, `paintStack`, `paintFolded`, `paintHead`, `reconcile`, `carry`; stable entries, grouping and visibility, section reuse, restored DOM focus and nested scroll positions. |
| `web/stack-order.mjs` | `gather`, `ordered`, `rowsOf`, `rowFolded`, `laterActs`, `LEVELS`; keep these rules independent of animation. |
| `web/stack-feed.mjs` | `arrange`, `arrived`, `setFold`, `unfoldId`, `fold`, `focusOn`, `act`, `settled`; optimistic acts, revision reconciliation, undo, press deferral. |
| `web/app.mjs` | `paintViews`, `keepListAnchor`, `listAnchor`, `feedOf`, `paintCardReading`; creates and reuses `messageEntries`, wires both topic and Conversation feeds. |
| `web/topic-views.mjs` | `messagesPage(answer, {initial, cursor, live})`, `refresh`; accepted paged data and live frontier before `paint('messages')`. Best existing place to distinguish new live IDs from history/reload. |
| `web/message-menu.mjs` | `MessageMenu` pointer admission, `light`, `paintBar`, `place`, `key`, `tabOnly`; already implements the desired pointer/keyboard handoff and one floating toolbar. Reuse it. |
| `web/marks.mjs` | `paintAuthor`; splits marked names at a whole grapheme to keep the Unread pill attached. Alignment must preserve that structure. |
| `web/author-colors.mjs` | `cardClass`, `paintCardColor`; agent identity, own/other people, whispers. Keep the classes and chosen colors. |
| `web/fold.mjs` | `cardIn`, `opened`, `foldCard`; an entry can be a `.message-fold` wrapper containing a hidden card and a `.fold-line`. This is separate from saved `message.fold`. |
| `web/card-scroll.mjs` | `CardScroll.expand`, `whole`, `edges`; a lit excerpt becomes a same-height scrolling card. Preserve its `maxHeight`, scroll and fetched body. |
| `web/press-hold.mjs` | `PressHold.after` and `end`; coalesces paints during a primary press. Running animations must also respect the held press. |
| `web/in-place-navigation.mjs` | `Scope.end` runs pagehide listeners on feed navigation. Animation cleanup must run here through the page's lifecycle. |

### What the current render actually does

`paintViews('messages')` creates missing entries, inserts them initially into
`#messages`, and calls `feedOf().arrived(...)`. `StackFeed.arrived` keeps new own
replies, arranges the whole loaded feed, and performs its existing deal acts.
This all runs inside `keepListAnchor`.

`arrangeStacks` gathers the loaded entries, reuses sections by head ID, sets
visibility, and reconciles the same nodes into their final dossier. It then
paints individual folded rows and restores focus. Repaint is not arrival:
reactions, read state, acts, filters and joins all arrange existing entries too.

`paintFolded` currently prepends a separate `.message-folded` row and hides the
normal card contents through CSS. A direct copy of the study's `.card-inner`
animation will not work: that wrapper is not in production. Design the small
markup/transition adapter here instead of replacing the card renderer.

## Suggested implementation shape

Add a small, page-owned motion controller, for example `web/stack-motion.mjs`.
The name and interface are proposals; keep it a presentation adapter around the
existing keyed nodes, not another store, orderer, selection owner or action queue.

Its responsibilities are to capture geometry, animate eligible transitions,
track the physical lower edge, and restore its own temporary styles. Expose a
cancel/finish/dispose path, and call the existing menu's placement logic as needed.
Appearance and timing values belong in `--stack-*` CSS properties, read by the
adapter; JS needs numbers and geometry, not palette literals.

### 1. Identify genuine live additions

At `TopicViews.messagesPage`, compute newly added IDs against the map **before**
merging. If needed, extend the paint callback with a small second argument such
as `{initial, live, addedIds}`; existing other paint kinds keep their behavior.
Pass that provenance through `paintViews` to the adapter. Inspect consumers and
update tests for this small interface change.

Do not use unread status, DOM creation alone, mutation observers, or a larger
sequence on an already-known ID as proof of an arrival. Suppress deal-in for
initial load, older paging, reload/resync reconstruction, off-screen/background
catch-up, filter changes, joins/splits, and reopening a saved fold. The existing
`StackFeed.newestSeen` baseline is useful context but was built for deal/keep
semantics, not a complete motion eligibility policy.

A live reply must also end up visible in the final `paintStack` result. Hidden
replies in closed/quiet dossiers update the tab/count without being animated
through a state that would otherwise conceal them. Opening the dossier later
is not a new arrival. New independent dossiers can use their normal static
paint; the approved deal is a reply joining an existing visible dossier.

Record handled IDs per page so later paints and duplicate live notifications do
not replay a deal. Clear transient motion state when leaving the feed, not the
message's records or global browser storage.

### 2. Apply the soft layered appearance

Use the existing `.reply-stack` and `.stack-replies` structure. Give later
**visible** message faces higher paint order, with 12 px overlap. Hidden entries
and provenance lines are not cards. Do not assign paint order from raw sequence
numbers or animate transforms on the folder/tab root.

Cover these layouts explicitly: fully open original plus replies, a root inside
`.message-fold`, partial/latest view, a standalone placed message, joined-stack
lines, and a folded last card with no successor. Do not pull a join/placement
label under a card. No padding, control or text may be covered by overlap: keep
12 px of sacrificial bottom space on a card that has a successor.

A full root card holds the absolutely positioned dossier tab. Transforming that
root changes containing blocks and can displace the tab and its ring. Keep the
tab independent and use the smallest message-face treatment needed for motion.
Audit stacking contexts against the shared toolbar and its menu; don't solve
layering with global arbitrary z-index values.

Apply name alignment at the first visible name segment. Do not add a negative
margin to every `.author-name`: marked names have start/end fragments. Retain
grapheme wrapping, the Unread pill, time, replied arrow, and agent color-picker
hit target. Folded names should retain the same alignment and identity treatment.

### 3. Deal a reply while its edge stretches the folder

Capture old geometry before entries are inserted/reconciled. Perform the normal
semantic render synchronously, measure final geometry, then install the start
pose and temporary size before the browser paints it. Don't briefly render the
final enlarged folder and repair it in a later task.

For the simple one-card case, the study's useful invariant is:

```text
oldFloor = replies' previous rendered height
movingEdge = incoming card's rendered bottom - replies' rendered top
repliesHeight = max(oldFloor, movingEdge)
dossierBottom = repliesTop + repliesHeight + actual bottom padding
```

The incoming card's rendered box includes its transform. At each animation
frame, the folder follows that edge, not another independently eased height.
Restore natural layout when the card reaches its final pose. Read the actual
padding: the inspected CSS uses 8 px on desktop and 6.4 px on a phone.

Freeze the replies' old height before adding the incoming face; prevent flex
children from shrinking under that temporary height. The incoming face starts
far enough above its final slot that even a very tall card's lower edge begins
above the old floor. In the reference, travel is at least card height + 24 px.
Keep the softer static shadow when the temporary travel shadow ends.

The reference's 760 ms timeline is approximately:

| Time | Pose |
| --- | --- |
| 0 | Above the tab/older cards, opacity 0, rotation −.45°, scale .985 |
| 26% | 64% of the initial upward offset remains, opacity .55, rotation −.25°, scale .993 |
| 76% | Final slot +3 px vertically, opacity 1, rotation .06°, scale 1 |
| 89% | Final slot −1 px, rotation 0 |
| 100% | Natural final position and soft contact shadow |

The HTML contains the exact segment easing. The original folder must not grow
before the traveling lower edge reaches it. Keep this invariant for long cards,
phone widths, zoom, and both themes; don't hardcode a fixed incoming height.

For a batch, use one bounded timeline per dossier and the maximum traveling
edge of the incoming faces, in final order. Avoid a long queue of one animation
per message. A later update can supersede a running transition: settle or
retarget from measured current geometry, then render the latest semantic result.
Do not delay accepting live data until animation finishes.

### 4. Fold one card without a fading duplicate

Capture its current rendered height, keep one solid author header, and clip the
body as the card shrinks behind its successor. The reference moves the same
header inset from 16 to 8 px; there is no cloned author line and no opacity
animation on the message text. Finish at the folded edge; reverse from measured
geometry on unfolding, rather than guessing the full height.

Coordinate this with `paintFolded`'s separate row. Either retain a shared author
line or perform an equivalent visual handoff to the folded row without two
simultaneous headers. Keep saved `data-folded`/act semantics immediate even when
the visual transition is finishing. Temporarily visible outgoing body content
must not remain interactive or accessible as an expanded card after folding.

Keep the named `.message-folded`, `.folded-author`, `.folded-words` and cue
contracts or update their users together. The fold's source remains
`StackFeed.setFold`, including star protection, undo, command refusal and changes
from another device. It must not turn into a CSS-only local saved-fold state.

## Production corrections to the study

Two reference details need deliberate adaptation and a candidate preview, not
literal copying:

1. **Folded text contrast.** `.62` group opacity conveys the approved quiet
   look but lowers the dark snippet below the existing 4.5:1 text contract.
   Compositing `--muted` `#9aaba8` at .62 gives approximately 2.83:1 on Fable's
   `#263d35`, 2.96:1 on olive `#313626`, and 3.75:1 on own black. At full muted
   strength the same pairs are about 4.87, 5.20 and 8.76. Use semantic folded
   ink/material tokens to preserve quietness with readable words; keep the
   focus ring at full strength. Measure rendered colors in both themes and all
   agent palettes, including quiet-agent styling so two opacity rules do not
   compound. Don't waive contrast or merely dim the whole stack.
2. **Phone hit area.** A 44 px folded card overlapped by 12 px exposes only a
   32 px strip. The production touch contract needs 44 px that can actually
   receive the tap. Recommended phone adaptation: a 56 px folded card with
   12 px overlap exposes 44 px; desktop keeps the 32 px reference edge. Preview
   that adjustment on Tony's phone. An invisible larger hit box underneath the
   next card doesn't solve it and must not steal that card's presses.

The study renders all sample text. Production still has excerpts, read-in-place
scrolling, formatting, unread pills, reply arrows and real reaction controls.
Use those actual components when judging the implementation.

## Lifecycle and interaction constraints

- Reuse `MessageMenu`; do not import the study's global key/pointer handlers or
  toolbar. Its screen-coordinate guard already prevents a stationary pointer
  stealing selection after a keyboard-driven scroll. Keep one ring and the
  bar's existing header floor, viewport clamping and reply-arrow avoidance.
- Geometry growth must continue to reposition the existing bar. Its
  `ResizeObserver` covers document/host/bar changes; verify the rendered
  position during animation and add only the scoped notification needed.
- Keep `reconcile`/`carry` and actual message nodes. Avoid extra `[data-id]`
  proxies, cloned accessible cards, or spacers the next reconciliation will
  mistake for entries. Preserve nested table and card scroll positions.
- `keepListAnchor` handles synchronous paints, not arbitrary later animation
  frames. Recommended admission: animate only when growth is below the held
  writing/reading anchor. If a reordered dossier or expanding region would
  move that anchor, paint the final state using the existing anchor handling
  and skip the optional motion. Don't add per-frame scroll fighting.
- Initial press deferral is insufficient if a press begins during motion.
  Pause current visual geometry on a primary pointerdown so a held target
  stops moving. On release/cancel/contextmenu/blur, reconcile queued paints
  through `PressHold` and continue only a still-current transition. Never
  freeze command receipt processing or resurrect a superseded visual target.
- Settle cleanly on width change, late content expansion, a changed fold,
  joins/splits, filter changes or a detached target. Own a generation/token
  per transition so an old completion cannot clear a successor's styles.
  Preserve pre-existing inline `maxHeight` and scroll styles from `CardScroll`.
- On `pagehide` (including in-place navigation), cancel animations/RAF,
  disconnect controller observers, remove temporary styles and release held
  geometry. A disposed callback must not touch the next page's reused shell.
- Reduced motion uses final natural layout immediately, with no travel,
  tilt/fade/settle sequence. Hidden tabs must not accumulate a replay queue.
  Motion completion/cancellation, not a guessed sleep, releases geometry.
- New entries are currently observed for read tracking as they are created.
  `IntersectionObserver` does not treat zero opacity as unseen. Do not let the
  transparent start pose mark a message read. Defer the animated entry's
  `cardObserver`/`middleObserver` admission until it is settled visibly; on
  finish/cancel, observe the real entry once so current geometry is evaluated.
  Existing static entries and Core's read commands retain their current rules.

## Implementation sequence

1. Claim the slice in the Building Theseus outcome per `AGENTS.md`, use an
   isolated worktree, and compare the current release to this source map.
   Retrieve the exact reference above. Coordinate any shared paint-callback
   interface change with its owner.
2. Build the static treatment in `stack-look.css`, including full-root and
   wrapped entries, identity alignment, single-selection rings and the
   production contrast/touch corrections. Keep the existing input behavior.
3. Add explicit live-addition provenance and the scoped motion controller.
   Integrate at the existing paint/arrange boundary; do not replace ordering,
   read state or command code. Add cancellation and anchor/press admission
   before enabling travel.
4. Implement edge-led arrival and the single-header fold transition. Exercise
   variable-length content, bursts and interruptions in an isolated feed.
5. Put an actual candidate preview in Tony's hand early, following
   [experience-guidelines.md](experience-guidelines.md#preview-first). The
   static approved HTML is not proof the production integration works.
6. Leave checks behind, update the actual behavior sections of
   `reply-stacks.md` when implemented, and follow the release owner's process.
   This research does not authorize this agent to compete with the live deployer.

## Checks the coding agent should leave behind

These are proposed additions/regressions to prove, not checks run by this
research task. Use isolated fixture records and real browser input for gestures.

| Check | Evidence / likely home |
| --- | --- |
| Layer order, sacrificial padding, last card, joins and wrapped root | Geometry and screenshot pixels in `tests/stack_native.mjs`, using the actual feed DOM |
| Muted folded words remain readable; full-strength current ring | Extend `tests/ui_author_colors.test.mjs` token checks and rendered checks in `tests/reader_colors_native.mjs` / reading cases |
| Equal first-letter alignment, marked Unicode name and wrapped Unread pill | Render `paintAuthor` output; measure text ranges and actual picker/tap behavior |
| One light: pointer → keyboard → real pointer; a still pointer doesn't reclaim it | Extend reading cases using native pointer/key input and a scroll/layout change |
| Toolbar follows travel/growth, doesn't cover tab/replied mark, hides for a hidden target | Reading cases; measure rectangles during motion, not only at the end |
| Edge stays fixed before contact; then follows long/short moving card | Sample rendered rectangles on animation frames; allow about 1 CSS px for rounding; assert both pre-contact and stretching samples exist |
| Fold/unfold has one solid author, no duplicate or ghost; saved state/Undo/refusal still win | Real menu/swipe actions plus a held/refused command; inspect intermediate frames and final Core acts |
| No replay on initial/history/reactions/filters, and no replay of the same live ID | Unit policy tests plus actual live fixture additions; absence as well as positive deal-in |
| Closed, off-screen and coordination dossiers; own replies and same-update answers | Retain and extend current `tests/stack_native.mjs` cases |
| Writing/reading anchor and nested scroll stay put | `tests/reader_live_native.mjs`, reading carry/scroll cases; position and scroll offsets before/during/after |
| Press starts mid-animation, then ends/cancels; live updates keep the pressed target stable | Extend `tests/ui_press_hold.test.mjs` for any lifecycle seam and native press cases for actual geometry |
| Burst, second arrival, rapid Undo/refold, resize, pagehide and in-place navigation | Controller lifecycle units plus native feed/navigation checks; no leftover styles, RAF or callbacks |
| Transparent incoming card doesn't earn a read; settled visible card does | Isolated live/read fixture assertions through real read state, not a test counter alone |
| 390 px touch: 44 px reachable folded edge, no sideways page, swipe vs horizontal table scroll | Chrome touch and WebKit reading checks, then Tony's phone preview |
| Reduced motion and theme | Final natural geometry, no pending effect, light/dark pixels and contrast |

Useful existing lower-level files are `tests/ui_stack_order.test.mjs`,
`ui_coordination_stacks`, `ui_press_hold`, `ui_message_menu`, `ui_author_colors`
and `ui_freshness`. Add focused pure policy/controller tests if introducing a
new module; do not make a unit test pretend to prove native focus or layout.

Focused starting commands, from the implementation worktree:

```sh
node --test tests/ui_stack_order.test.mjs tests/ui_coordination_stacks.test.mjs \
  tests/ui_press_hold.test.mjs tests/ui_message_menu.test.mjs \
  tests/ui_author_colors.test.mjs tests/ui_freshness.test.mjs

node tests/reader_persistence_native.mjs "$AIM_CHROME_FOR_TESTING" \
  /absolute/new/evidence/chrome-reading --reading

AIM_PLAYWRIGHT_CORE=/absolute/path/to/playwright-core \
  node tests/webkit_native.mjs ignored /absolute/new/evidence/webkit-reading --reading
```

The native entry points accept a final regular-expression case filter for focused work;
`tests/stack_native.mjs` is imported by reading checks, not a standalone runner.
The release catalog names these `native-reading` and `native-webkit-reading`.
Broaden to the relevant live, colors, Conversation and navigation checks after
the implementation warrants it; the release owner runs required release checks.
Run one substantial workload at a time. Use Chrome for Testing and close the
owned browser through its protocol, never the person's Chrome or a signal.

## What was verified for this handoff

Read-only source mapping, reference retrieval/hash, and contrast arithmetic.
The standalone study had already been rendered at 1440 px and 390 px, with real
pointer/keyboard checks, and recorded at normal and quarter speed. Its v4
boundary measurements differed from the target edge by at most about .016 CSS
px on desktop and .025 CSS px on the phone-sized browser in that run. Those
figures describe the prototype, not production, Safari-on-device or a future
implementation's performance. No application implementation or broad test run
was performed in this documentation task.
