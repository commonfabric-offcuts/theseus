# Archive and Done return to the outcome (1000)

Assignment: Warp14699; whole current1000 record read (medium Build1, p-e941d58d350346b187d3d1e7, Fable14781).
Source base: live286, a23d9b00e73763935d2bf4fb0ea1c51ada007186.
Own branch: core-lane8/1000-topic-close-live286.
987 stays frozen57b982c2 in its separate tree;1000 precedes994.

## Measure before changing product behavior

First instrument an isolated native full-app/Core/HTTP fixture at this base.
Use actual native Archive/Done acts and monotonic browser/server timestamps.
Record click to command start/answer, local durable keep if applicable, the
subsequent topic/feed reloads, rail rereads, first visible state and destination.
Retain per-request start/end/name and visible-route/Reader/rail observations,
fixture volume and real browser/version. Repeat on phone and desktop, both
looks, with a small and a larger synthetic outcome; no real account writes.
Controlled held replies distinguish the dependency from native local timing.
No timing result comes from fake DOM or handler invocation. These measurements
characterize the isolated fixture, not Tony's device or network.

## Actual baseline before product changes

Actual untouched product source live286/a23d9b00e73763935d2bf4fb0ea1c51ada007186;
headless Chromium156.0.8078.47, native trusted pointer/touch acts, real app +
HTTP adapter + Core.16 cells:1280/390 × Bookends-dark/Paper-light × Done/Archive
× two fixture sizes. Small has6 additional topics/8 total messages; larger80
additional topics/242 total messages (160 additional retained history messages).
One-minute observed load3.41/18 at launch, no fabricated load or delays. The
page's initial requests settled and were quiet100ms BEFORE the timed click.
This quiet start is setup, not part of the action's measured latency.

Each numeric entry is minimum / median / maximum of that size's8 cases, in ms.
The row predicate observes DOM membership at a native animation frame, including
hidden rail rows on phone; it is not a GPU/pixel presentation timestamp.
Read rows time that request alone; overlapping reads are not added together.
The large outcome's cursor-tail request is separate from the first list read.

| Measured boundary | Before (min / median / max) | After |
| --- | --- | --- |
| small: Command round trip | 13.9 / 16.2 / 17.5 ms | Chromium 7.6 / 9.2 / 13.3 ms; WebKit 10.0 / 12.0 / 26.0 ms |
| small: Click to command answer | 14.4 / 16.4 / 17.8 ms | Chromium 23.4 / 26.5 / 32.7 ms; WebKit 13.0 / 15.5 / 36.0 ms |
| small: Click to animation-frame active-row absence | 45.2 / 47.0 / 48.7 ms | Chromium 29.5 / 32.0 / 41.1 ms; WebKit 13.0 / 16.0 / 35.0 ms |
| small: Current topic reload round trip | 4.2 / 5.7 / 12.5 ms | No current t1 topic/feed reload after departure |
| small: Feed messages reload round trip | 3.7 / 3.9 / 4.0 ms | No current t1 topic/feed reload after departure |
| small: First rail list reread round trip | 10.7 / 12.5 / 14.8 ms | Chromium 4.1 / 8.0 / 10.5 ms; WebKit 8.0 / 10.0 / 10.0 ms |
| larger: Command round trip | 14.0 / 18.2 / 19.2 ms | Chromium 7.1 / 8.7 / 12.0 ms; WebKit 12.0 / 15.0 / 25.0 ms |
| larger: Click to command answer | 14.9 / 18.6 / 19.5 ms | Chromium 22.5 / 27.4 / 34.0 ms; WebKit 16.0 / 20.5 / 33.0 ms |
| larger: Click to animation-frame active-row absence | 46.3 / 58.0 / 68.9 ms | Chromium 25.3 / 29.6 / 37.1 ms; WebKit 9.0 / 17.5 / 21.0 ms |
| larger: Current topic reload round trip | 5.5 / 6.5 / 13.6 ms | No current t1 topic/feed reload after departure |
| larger: Feed messages reload round trip | 11.6 / 12.3 / 17.6 ms | No current t1 topic/feed reload after departure |
| larger: First rail list reread round trip | 15.5 / 17.0 / 24.5 ms | Chromium 4.9 / 8.9 / 10.2 ms; WebKit 9.0 / 10.0 / 12.0 ms |
| Topic/Reader exit to actual parent outcome | Absent in all16 cases (address stayed ?topic=t1) | Ready parent/current rail in all32 measured cases |

The actual local command answer is fast; the old row publication follows the
service answer and rail reread. This does not reproduce Tony's longer wall
clock wait or diagnose his device/network. The missing parent departure is
unambiguous in all16 actual native cases. Kept-write behavior must remove the
service/rail dependency, proved separately with held real replies. The after measurements below describe this local fixture only; held-response
checks separately prove that departure does not await the service answer.

Raw evidence: /Users/commonfabric/.local/share/theseus/core-lane8/evidence/1000/
baseline-quiet/results.json and baseline-quiet.log, including every request
payload/start/headers/JSON-body-end on the browser's monotonic clock, native
trusted event, animation-frame changes, actual admission callback/queue events,
served source hashes,16 screenshots, exact runtime/fixture counts, complete
Browser.close/owned PID/profile/fixture EOF0/PID/port/scratch cleanup. The earlier
canary and first16-cell non-quiescent matrix remain as separate evidence;
they are not silently substituted for this quiet-start cohort.

Read inventory: current topic t1 is read once per act; the other topic read is
the outcome's Conversation topic, a distinct identity. conversation(w1) is
read twice on desktop and three times on phone in this cohort. workspace_topics
first-page read is once; larger lists also read limit1 with a cursor after the
first page, not a duplicate first-page query. changes, pipeline/topic_tools and
memory_items have repeated identical queries. Full exact-argument inventory
is retained in baseline-read-inventory.json and shared with1005's owner.

Current source owners: TopicStatePanel.tap/go/post/answered in topic-state.mjs
retain a field's exact operation in memory, await send, apply the answer, then
request refresh. app.mjs provides direct api.command and the Freshness callbacks;
runTopicMenuAction delegates current-topic Archive/Done to that panel. OutlineMenus
uses the same current-topic door; non-current topic actions use RailMenuCommands.
The existing intent journal accepts only outcome-creation records, so it must not
be treated as an existing general command outbox. Inspect/reuse established
journal authority/transaction patterns when choosing the kept-write seam.

## Required behavior and defaults

Archive/Done first keep the exact intent under instance, actor and authority,
then draw its pending state and leave the currently read topic without waiting
for a service answer or rail reread. Core remains authoritative. A definitive
answer settles the same operation; an unknown result retains/retries that exact
operation. A refusal restores the topic and explains its real reason. Storage
failure does not pretend the intent is kept. Later navigation, writing, newer
acts or Undo cannot be erased by an earlier late answer.

When the acted-on topic is the page being read, close that page and an open
Reader, open its actual parent outcome and mark that outcome current in the rail.
Undo remains reachable from that destination and survives the pending/settled
transitions. Preserve drafts and field fences, permissions, manual topic-state
semantics and authority changes. Acting on another topic must not steal the
current page. Existing saved-state grouping remains Core's rule; the pending
projection is local work, never a new authoritative topic fact.

Defaults: immediate means after a successful local durable keep; no artificial
wait and no optimistic success label. Restore without taking over navigation
or writing the person changed afterward. Preserve the existing Archive/Done
inverse semantics, repeated-act and keyboard behavior. Covers, messages,
responsibility/title edits and other state controls retain their owners.

Phone and desktop, Bookends and Paper; current topic header/settings, rail menu
and Reader paths wherever they already offer these topic acts. A dossier's
message Archive is a separate existing act and must remain separate.

Ordinary source paths only. No installed tools, controller, live fixtures or
other owner trees. If a fix needs Core beyond a view, report that before freeze.
Fable owns the actual Now/Build binding and stages; Warp owns review/carry/deploy.

## Verification

Meaningful below-browser controls hold durable identity, settle/refusal/unknown,
reload/reconnect, authority/storage failure, late ordering and Undo. Real native
checks exercise current-topic/Reader exit and outcome/rail selection, both looks
and viewport classes, pending/committed/refused/Undo and later-navigation cases.
Retain actual baseline reds, apply/catch/restore load-bearing routing/recovery
mutations, compare affected failures to the source base, freeze green and request
one independent read. Browser notice/owned Browser.close/PID/profile/fixture
EOF0/PID/port proof are required for any native workload. No physical phone or
software-keyboard claim from desktop engines.

## Shared owner boundary (14764,14765,14779–14781)

Page-lane5’s1005 owns Freshness, read supersession, rail-list reconstruction
and retained rows/folds.1000 owns durable Archive/Done and parent-outcome
navigation. Coordinate shared app/navigation edits in the piece topics before
editing and share measured read names. Core-lane7’s1003 owns only rail-dimming.mjs
paintRows’ reader-wait exemption, using existing markers/notifications; preserve
the973/981 rules.1005 has priority. Its attached contract was fully read; its
initial timings too are explicitly unrun. No independent Freshness rewrite.

## Proposed kept-action and shared projection seam

The action controller/journal is new1000-owned code. Keep the exact existing
topic.update envelope and original topic identity/parent/field values under
the confirmed instance, actor and authority before any pending projection or
auto-departure. Preserve unknown operations for exact replay. Settle only an
authentic matching Core receipt; a definitive refusal restores the projection
and carries its reason. Runtime changes park the old intent rather than
reissuing it under a new authority. No new Core fact or command is planned.

Undo is reachable from the outcome while the first act is pending or settled.
If pending, keep the Undo request and its identity; resolve the first operation
before forming/sending the inverse from its actual receipt and field fences.
An unknown first operation cannot truthfully be cancelled or assumed unsaved.
Restore the previous manual state/waiting people via existing Core authority;
a newer field change refuses the inverse rather than being overwritten.
Keep failures/Retry visible from the new page. Later navigation, writing and
newer Undo fence every delayed UI callback.

Proposed narrow shared interface for1005 coordination BEFORE a product edit:
TopicPages.items filters only a locally kept unsettled topic identity through
a1000-owned pure pending projection; rejected acts stop filtering it. TopicRail
hears projection changes and paints the intentional removal immediately even
under its usual hover/focus retention. This hook does not own or alter read
scheduling, retries, supersession, cursor/accept rules or list publication.
The parent-outcome move uses the existing normal navigation/writing/build
guards. Outcome Undo/status lives across the shell's in-place app runs.
The exact TopicPages/TopicRail hook was agreed by the1005 owner at14833;
the agreed minimal projection hooks are implemented.

14833 confirmed final TopicPages.items filtering after merging, with retained
loaded maps/cursors/readAt/counts untouched. Exports: closingTopics(document)
and projectClosingTopics(instanceId,workspaceId,items,document) from
topic-close-projection.mjs; TopicRail.closingChanged removes only affected
projected links/cache entries, then paint(true) and updated. Weak rail owners
and document removal observation dispose retired rails; persistent outline
rails keep their subscription across app runs. No pagehide unsubscribe of a
shared persistent rail. Controller TopicCloseActions uses the separate strict
IDB openTopicCloseJournal; operation/receipt/Undo facts merge monotonically
across tabs and only IDs travel through its scoped BroadcastChannel.

Refusal default: restore the authoritative rail row and show the real reason
with Open topic from the destination; it never takes over the person's later
page or writing. On document start the latest20 settled/recent changes are loaded, plus every
unconfirmed change in bounded20-record pages. The current document retains
all its changes and shows20 at a time with More, prioritizing unconfirmed work.
Older settled changes beyond the latest20 are retained in storage but are not
loaded into a new document; Undo there is a named limit. Recovery reads pending work in20-record pages, same exact
operation IDs; Core remains the sole fact authority. Undo restores only fields
changed by the act, including a reopened-message note only when that act
actually changed it, fenced on Core's receipt value.

## Implemented result and final proof

The separate strict IndexedDB transaction completes before command dispatch,
projection and navigation. Core still records the result. Local pending
projection never changes raw authoritative maps/cursors/counts, and a recorded
refusal restores the authoritative row and reason. Unknown attempts keep and
replay the exact operation; an Undo kept before the forward answer waits for
that real receipt, then fences its inverse. Original history-entry tokens let
startup recover interrupted departure without taking over a later explicit
visit. Other-topic actions and remote state updates do not leave the current
page. Existing departure guards keep Reader writing exactly.

Final real native full-app/Core/HTTP flows: Chromium60/60, WebKit60/60,
390/1280 × Bookends-dark/Paper-light ×15 cases. Held-before-Core forward,
recorded Archive/Done refusal, committed-but-lost answer/reload exact replay,
Reader Done/Archive with exact saved writing, manual Waiting Undo, rail Done,
noncurrent-topic Archive, strict-storage refusal, later navigation/writing,
explicit revisit, peer-tab Undo, native keyboard Done and remote Done/note.
Every completed Undo also restores the active rail row. Final timing matrix
16/16 per engine adds the two fixture volumes and native Undo from the outcome;
its timestamps distinguish strict keep, dispatch, command JSON end, DOM-frame
row absence and ready parent/current rail. Two changed legacy header cases
also pass through the original checks on a native Playwright/CDP adapter.

533/533 affected owner checks, including15 controller/journal/projection cases.
Five real applied/caught/exact-restored mutations cover strict admission,
final item projection, operation receipt identity, concurrent kept Undo and
inverse receipt fences; a sixth actual native mutation removes parent routing
and is caught. Source hashes and raw failures/restoration are retained.
Full wiring canary on this base:495 tests,485pass/10fail, same ten names and
full normalized diagnostics as untouched286. No broad all-green claim.

Before and after are separate native local runs, not a controlled statistical
speed claim or reproduction of Tony's network/device delay. The service/rail
wait dependency is removed by the durable projection/departure boundary;
loading the ready outcome still performs its real scoped reads. Physical
phones, software keyboards, account/runtime-switch native cases and production
release overlap are not proved here. Strict IDB durability is required; failure
admits no closing command and explains why. Newly loaded documents offer the
latest20 settled changes plus all pending work; older settled Undo is the
explicit limit above. No new Core/schema fact, browser-storage fallback or
installed-tool change. Fable owns stages; Warp owns carry onto live294 or later,
preserving both retained-owner readyRails handle sets and the14833/14853 seam.

Final local keep/destination boundaries (min / median / max, ms):

| Engine / fixture | Click to strict keep complete | Click to ready parent/current rail |
| --- | --- | --- |
| Chromium / small | 13.5 / 14.6 / 15.4 | 97.3 / 113.2 / 113.7 |
| Chromium / larger | 9.4 / 13.8 / 16.4 | 107.2 / 113.3 / 128.0 |
| WebKit / small | 1.0 / 1.5 / 4.0 | 93.0 / 105.0 / 124.0 |
| WebKit / larger | 1.0 / 1.5 / 4.0 | 106.0 / 109.0 / 142.0 |

Native sources: timing-chromium-final and timing-webkit-final/results.json;
launch one-minute loads6.24 and3.85/18 respectively. WebKit's clock is coarser;
these are separate fixture runs, not a browser comparison. The current-topic
topic/feed reload is absent after the act; the distinct Conversation topic is
still read by the actual outcome. Raw per-request bodies/start/JSON-end,
transaction start/completion/operation IDs, frames, screenshots, admissions and
cleanup remain in the handoff packet. No overlapping read latencies are summed.
