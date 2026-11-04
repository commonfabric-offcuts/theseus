# Scoped automatic updates: implementation plan

Status: accepted implementation plan, revision 03. Fable cleared it on
2026-11-04 in AIM `m-bfbb8d37`, subject to the build conditions below. The
original reviewed snapshot has SHA-256
`1198ffbf20cd4a69a30d29c7151e70bd1c00cb427b07aa38583637903688a9bf`.
Lead accepts the fixed foreground-one/background-one partition; foreground
borrowing is not selected. The implementation and its measurements are pending.
The historical source references below remain pinned observations and must be
rebound to the reviewed, integrated image correction before implementation.

Tony's first-use handoff uses explicit Refresh: **new replies appear after
Refresh; automatic updates are next**. This plan is that immediate follow-up,
on the same retained instance, origin, identity and data. It does not delay the
image review, integrated checks or manual-Refresh activation in
[first-use.md](first-use.md). It never requires clearing browser writing or
creating a replacement instance.

## Revision and existing evidence

The original code map below is pinned to published base
`af1f0c77d51040df5b204b28d119da6e1b8a8d9b`. Documentation-only successor
`de60d049902c4e441fc00738ae7680bfca99f8ab` records the manual-Refresh decision.
The reviewed Q1a query is `c9cd4943b2be938eb23d5a4a2c46c3475f1d902e`, included
in that base. Its [changes-query.md](changes-query.md) is the backend contract;
reuse it without reopening cursor/query correctness or describing it as UI proof.

Q1a's recorded evidence: 29 methods/20 subtests, nine applied/restored mutation
pairs; scoped query work of 272 VM steps and four materialized rows at both
1,000 and 10,000 unrelated changes for the recorded limit-two case. Those are
inherited backend results, not measurements of this proposed browser consumer.
Evidence manifest: `/Users/commonfabric/aim-worktrees/aim-core-evidence/aim-next-20261104/changes-query-34/HANDOFF.json`,
SHA-256 `9088f17e649fffb447aeecf842d4514cd8b883fdf2b4163396ef76c87f6bd361`.
Fable's exact Q1a clearance is AIM `m-89a512ce`.

UX's frozen image revision is
`45fc174f7934e1d4c0de38430ec1a47d10e99d04`; its independent review/integration is
separate; `45fc174` is not cleared (Fable `m-bffca490`, X1-X3). Those image fixes
remain UX's critical-path assignment, outside this plan. UX confirms in
`m-cc66d88b` that image retirement uses the existing
read coordinator and introduces no background timer/view bypass. Before building,
bind this plan to the actual integrated image tip and check only affected
interfaces. New image/transport/fixture references below explicitly use
`45fc174f7934e1d4c0de38430ec1a47d10e99d04`; they are observations, not clearance.
The first implementation base must include the reviewed image corrective delta.
Do not edit or test the image author's mutable checkout.

## What happens today

References are repository paths and one-based lines at the pinned base.

| Path and line | Present behavior and consequence |
| --- | --- |
| `web/app.mjs:272`, `:280`, `:320` | Bootstrap, then topic and list reads; there is no changes baseline before these reads. |
| `web/app.mjs:242`, `:256`, `:258`, `:270`, `:315` | Refresh rereads the newest 30 messages and first 20 Notebook items. Both replace the corresponding More cursor. Later loaded Notebook items can stay stale; bursts larger than 30 are not a complete catch-up. |
| `web/api.mjs:17`, `:40`; `aim_next/server.py:280`, `:295` | `Api.view` posts through the authenticated generic `/api/view` route into `Store.view`. A typed store refusal can arrive inside HTTP 200. No new endpoint is needed. |
| `aim_next/conversation.py:209`, `:216` | Topic metadata has summary/version; message pages support indexed before/after sequence cursors. Topic change keys cover sends and participation, not individual messages. |
| `aim_next/memory.py:132` | Notebook summaries support scoped after-sequence pages and exact item revision references. This also permits a bounded known-item summary read. |
| `web/cleanup.mjs:54`, `:61`, `:77` | One background transport is held until actual settlement. Foreground reservations prevent another background dispatch. Send has its separate path. |
| `web/app-session.mjs:104`, `:149`, `:173`, `:225` | Opening a source preserves prior writing, reads exact source/private state, and registers editors. Existing autosave, send, recovery and neighbor reads have their own ownership. |
| `web/app.mjs:208`; `web/reader.mjs:64`, `:93`, `:95`, `:299` | Present/show redraws source and editor. The existing source-update notice explains a writing/source revision difference; it does not offer a newly available revision. Background updates must not call present/show. |
| `web/editor.mjs:5`; `web/app-session.mjs:62` | The stable editor key excludes Notebook revision. Opening a different revision reuses the existing editor and its pinned source/writing rather than creating a new editor. |
| `aim_next/store.py:283`, `:288`, `:309`; `aim_next/server.py:418`; `web/api.mjs:34` | Authority refusal may precede Changes itself. Store-view errors arrive as result objects; bootstrap authority failures can be thrown in `AttemptError.details.error`. A new authority pair need not be obtainable. |
| `web/session.mjs:151`, `:195` | Authority recovery preserves writing and requires explicit review before adopting current private state. A changes cursor cannot authorize that adoption. |

## Invariants and boundaries

1. Freshness performs reads and updates view state. It never sends, acknowledges
   delivery, changes participation, prepares an operation, adopts a recovered
   draft, deletes recovery records or changes a quote's source revision.
2. An open source, text selection, caret, scroll/place, focus, reply/note body,
   quote, pending submission and image cycle retain identity during ordinary
   incoming updates. Freshness never assigns `registry.current`, increments
   `registry.generation`, sets `pendingOpen`, or calls `present`/`show`. It updates
   allowed presentation metadata (neighbors, offered revision, availability) in
   place, with its own request generations. This preserves a picker's captured
   presentation identity (`45fc174 web/uploads.mjs:48-57`). No automatic source
   opening, editor replacement or media reload. Explicit user opening still
   uses the normal lifecycle; permission loss hides inaccessible content without
   replacing the editor/presentation or pretending to be a new user action.
3. Scope is the open topic. Do not poll every workspace, actor, inbox, delivery,
   draft or cleanup candidate. The current workspace header has no editable
   workspace view to keep fresh. A future rendered scope needs its own explicit
   baseline and adapter, not an implicit expansion of this one.
4. The two Store-read slots belong to the **server serving this instance**, not
   a page. Reserve one slot for foreground reads and one for background reads,
   with the bounded admission below. Each document still routes cleanup and
   freshness through `registry.cleanup.read`; this local FIFO/coalescing layer
   is not proof of the instance budget. Only server callback/close completion
   releases a server slot. Client abort or fetch settlement cannot do so.
   Commands, uploads and attachment-byte streams retain their separate lanes.
5. Freshness cursor progress and successfully painted resource versions are
   separate state. A completed feed window may advance only after all its keys
   have been recorded as invalidations; failed dependent reads remain dirty.
   Partial pages never become a checkpoint. Reload starts with a fresh baseline
   and fresh initial views rather than persisting an incomplete browser cache.

## Triggers and results

### Start, tick and catch-up

After bootstrap and URL topic validation, require the supported
`transport.read_admission` capability described below before enabling automatic
freshness reads. If it is absent/incompatible, retain manual Refresh and say automatic
updates need the updated server; do not start a freshness polling timer.
Existing recovery cleanup is not disabled by this fallback. With the
capability confirmed, request the topic `changes` baseline
with omitted cursor **before** the topic and dependent initial lists. Retain its
checkpoint, read those views, construct the registry/controller, then catch up
from the saved checkpoint. Startup baseline and initial views are foreground
reads; subsequent automatic reads use the background class and coordinator. An unavailable baseline
does not silently declare the page current: show a retry state. Do not erase
existing journal data during startup failure.

Use a visible-page 500 ms check cadence as the initial measured candidate,
not a proven performance claim. Keep one pending check, not accumulating timer
jobs. A tick, manual Refresh, visibility/online return, or confirmed local effect
requests the same coalesced catch-up. Manual Refresh can request refresh of loaded
resources even when the feed is unchanged; duplicate clicks share work. Hidden
pages schedule no polling; visibility return catches up immediately. On pagehide,
stop timers and invalidate the controller generation; the existing bfcache reload
behavior remains. Already dispatched reads settle under the existing coordinator
deadline and cannot paint a disposed page.

Fetch changes pages with limit 50, forwarding opaque continuation/checkpoint
objects unchanged. A fixed window is finite even while other commits arrive.
Yield between reads and alternate feed draining with dirty-resource work; never
enqueue an entire backlog in `readTail`. Keep only one active freshness read and
one remembered follow-up per key. Merge target versions by maximum. Retain only
topic/list flags, current source state and already loaded item keys; collapse
unloaded Notebook keys into an unloaded-range flag instead of storing all IDs.
Start the next feed window after completing the current one.

`CLEANUP_DEFERRED` means yield to foreground work and retry later, not an error
to show as data loss. Source opening, stepping and explicit More reserve foreground
attention locally; public send remains direct through `EditorSession`. More
retains input-cursor validation. The capability-gated foreground reservation
cancels pending local freshness admissions, invalidates any in-flight freshness
paint and aborts its fetch. It does not wait for the background promise to drain
inside the foreground deadline: the server's reserved foreground slot supplies
capacity independently. Existing background cleanup reads may also be aborted
under the reservation; an interrupted proof retains its row/bytes and is deferred.
Do not manually clear `activeRead` or claim server capacity returned on abort.
The old conservative reservation behavior remains when the capability is absent.

## Instance-wide read admission (F2, F6)

At `45fc174`, `server.py:230-245` acquires `read_slots` nonblocking and holds the
permit across Store creation, callback and close. The default is two slots
(`:466-467`, `:482`). `AbortController` cannot interrupt the synchronous Store
callback. This plan changes this narrow HTTP admission seam, not Store/query
semantics, server watches or a browser-wide scheduling framework.

Lead owns a bounded server admission object with two fixed classes:

| Class | Active Store callbacks, including close | Maximum waiting tickets | Queue deadline |
| --- | --- | --- | --- |
| foreground | 1 reserved slot | 8 | 5,000 ms from admission attempt |
| background | 1 reserved slot | 2 | 500 ms from admission attempt |

The classes never borrow each other's slot. Within each class, a ticket is granted
FIFO; later arrivals cannot overtake an already queued ticket. Queue capacity
counts waiting tickets, separate from the active slot. Deadline uses server
monotonic time from the authenticated, parsed request's admission attempt; waiting
does not reset it. Cap the queue deadline by the handler's existing absolute
request deadline as well; admission must not extend a slow request's lifetime. A full queue or expired waiting ticket returns HTTP 503
`SERVER_BUSY`, `recorded:false`, retryable, without constructing Store or executing
its callback. Remove a withdrawn/expired ticket and notify the next waiter. A
queue deadline is not a deadline on an already running Store callback: only its
finally/close releases that active slot, even after a disconnected client.

On queued disconnect, withdraw when the handler observes it; otherwise the ticket
remains bounded by its original queue deadline. Before a queued grant, check for
an already observed disconnect and do not dispatch that ticket. No promise of
immediate socket-disconnect detection is needed for correctness. If a disconnect
is not observed until after grant, the read may finish; it keeps its slot until
callback/close finishes. A test must not equate cancellation of the browser's
promise with either queue withdrawal or server release.

Use `X-AIM-Read-Class: background` on automatic view/bootstrap reads. Missing
header means foreground, preserving direct image Check/validation and old clients.
An explicit foreground value is accepted. Multiple class headers or any other
value on a read refuse HTTP 400 `INVALID_READ_CLASS` before admission. The class
is only a scheduling hint for `/api/view` and `/api/bootstrap`; it cannot change
actor, access, query scope or an operation's lane. `/api/command`, binary upload
and media-byte reads keep their existing contracts and separate capacities.
Existing connection/framing limits remain, including the 16-connection cap.

The HTTP bootstrap advertises server-owned settings under
`transport.read_admission`, with `version:1`, `header:"X-AIM-Read-Class"`,
`foreground:{slots:1,max_waiters:8,queue_timeout_ms:5000}` and
`background:{slots:1,max_waiters:2,queue_timeout_ms:500}`. These values are serialized
from the actual admission configuration, not copied into Store LIMITS. The two-slot
production configuration enables this protocol; an existing nondefault single-slot
configuration remains supported without this capability and without automatic
freshness. Do not silently increase `max_reads` or reinterpret a test configured
with one read slot as the new two-slot contract.

`Api.view`/`bootstrap` carry a read-class option; default is foreground. The
background coordinator passes both signal and background class to each operation,
including its bootstrap brackets. Direct reads use the default foreground class.
The new foreground cancellation behavior is enabled only by a validated v1
bootstrap for the current instance. A new UI paired with an old server therefore
keeps automatic freshness off and retains the prior conservative client arbitration.
Lead deploys the HTTP seam and UI on the same retained instance/origin; no new
instance, token workaround or clearing of writing is a rollout step.

The exact read inventory at `45fc174` is:

| Reader | Route/class under this plan |
| --- | --- |
| `app-session.mjs:122-123`, `:241` source+editor_state open and two neighbor queries | Both requests remain individually foreground, even when paired. Server FIFO serializes them in its one foreground slot; their existing paired settlement and identity checks remain. No pair claims two slots. |
| `uploads.mjs:199`, `:201`, `:261`, `:274`, `:280` Check, retained-ref/correction validation and bootstrap | Direct `Api.view`/`bootstrap` defaults to foreground, as do corrected image implementations unless explicitly background. No bypass of server admission. |
| `app-session.mjs:301`, `:316`, `:331`, `:362`; `app.mjs:86`, `:135`, `:175`, `:293`, `:309`, `:325`, `:330`, `:335` | Adoption/pending/review, explicit lists and startup reads default foreground. New automatic list adapters opt into background. |
| `session.mjs:43`, `:162`, `:298`, `:408`, `:428`, `:471`, `:518` | Existing command reconciliation, private-state/recovery reads remain foreground. Freshness parking does not initiate them. Admission does not remove the need to handle a failed conflict read safely. |
| `cleanup.mjs:202`, `:204`, `:217`, `:275`; `upload-cleanup.mjs:24`, `:31`, `:42`, `:63-64`, `:71`, `:75` | Every proof read and both bootstrap brackets use background class through the local coordinator. |
| New changes/list/key/availability reads and automatic neighbor refresh | Background, one local operation at a time; continuations and per-key work retain local FIFO/coalescing. |
| `app.mjs:275`, `api.mjs:42`, `server.py:354-356` | Attachment bytes use the existing separate media-read lane; never count this as a Store-read-slot release. |

Two visible documents may each have a local background request, but the server
runs only one background Store callback and queues the other. An image Check and
both halves of an open/neighbor operation queue in foreground independently.
Background occupancy alone cannot consume foreground capacity or fill its queue.
Genuine foreground overload, connection saturation, slow storage and authority
contention still have refusal/deadline paths; no unconditional latency promise
under overload follows from the partition. Classify a `SERVER_BUSY` by the actual
server counter/reason in fixture evidence, not the client's stack alone.

### Admission fairness and the existing image producer

The read-only assessment
`/Users/commonfabric/aim-worktrees/aim-core-evidence/aim-next-20261104/freshness-cleanup-assessment-01/assessment.json`
(SHA-256 `347d5e887e8581ce93a480bb2229b1d3dbaf3fa201f8cc0b44648742f901bfe5`)
shows `45fc174 app-session.mjs:88` requests cleanup after any stamped format2
persist. `cleanup.mjs:111-121` can keep processing those requests. In the stable
dirty selected-ready cycle case, `uploadProof` reads bootstrap, editor_state and
closing bootstrap without reaching meaningful retirement. Other branches can
skip or exceed those reads. This is a load/admission risk, not proof of indefinite
starvation: local `readTail` is FIFO per read and the server classes are also FIFO.

Freshness must enqueue its read without waiting for `cleanup.idle`. Proof group 3
must demonstrate progress/deadline while a real format2 persistence producer is
still active, not only after the producer drains. Restoring image spec03's narrow
cleanup entry points (confirmed ready-ref draft save, confirmed prepare/send,
completed removal/discard and scoped candidate discovery) is a separately assigned
post-first-use image follow-up. It does not enlarge X1-X3. Keep local persistence
and exact retirement proofs intact. This increment cannot claim its latency target
without the contention result or an explicitly reviewed disposition of a miss;
concurrency-only green is insufficient.

### Topic key: metadata, message delta and neighbors

A newer topic version invalidates topic metadata/participants and the message
live frontier. Fetch the bounded topic summary and, if its latest-message ID has
not been seen, page `topic_messages(direction: after, cursor: newestSeenSeq,
limit: 30)` until that captured latest ID has been seen. This gives a finite
target under continuous sends; a page may include later messages too. With an
initially empty list use sequence zero. Preserve current `audience: all` list
semantics; do not silently adopt the reader-arrow filter.

Deduplicate by message ID, order by stored sequence, and advance the live cursor
only for validated returned items. Do not substitute a new last-30 query: that
would skip the middle of a burst. Maintain an independent older-history cursor
for More. A late older-page result applies only to its captured frontier and
cannot reset the live cursor. Preserve focused cards and the user's list anchor.
Do not claim a topic's newest version means a partial message page is complete.

Invalidate cached neighbors of an active message when this topic changes. Refresh
its two limit-one `audience: reader` neighbor queries serially through the shared
background coordinator, fenced to the same current source. Update only arrow
availability/cache, not the source. Stepping during a pending refresh uses the
existing foreground neighbor path; an old background answer cannot overwrite it.

### Notebook key: loaded summary or explicit revision offer

For a changed loaded item with known sequence S, use
`memory_items(owner_scope: topic, cursor: S - 1, limit: 1)`. Validate exact scope,
ID and sequence before applying the summary; require a nondecreasing item
revision meeting the invalidation's target. This refreshes an item beyond the
first 20 without fetching its full body or adding an API. If the expected item
is absent/mismatched, retain the dirty state and show a scoped refresh failure;
never draw a different item into its card.

For newly created/unloaded items: when the loaded Notebook tail is complete,
append from its own last-loaded sequence using bounded 20-item pages. Otherwise,
mark the unloaded range changed and leave fetching it to More. Do not walk every
unloaded item merely to keep the first screen fresh. Keep the paging frontier
independent of keyed-summary reads. A loaded summary is never replaced by an
older revision returned from a racing More request.

If a key names the open Notebook source and a newer revision, offer **Open
revision N** without replacing the body, image URLs, selection or editor. The
offer can use the change-key revision even if the item is outside loaded cards.
Maintain a monotone target for loaded, current and currently opening item IDs:
`max(change-key target, validated refreshed summary revision,
source.current_revision)`. Register the pending open's item before its source
read, so a key arriving mid-open is retained. Recompute at each ordinary explicit
presentation, summary/key update and offer/status paint. Do not delete a target
when its summary read is deferred or when the feed checkpoint advances. Hide the
offer only when that presentation already shows the target or the item/binding
is no longer relevant; this state remains bounded to loaded/current/opening items.
Thus a key consumed before presentation, or a source read completed before a
new key, still converges on the offer without calling present from freshness.
Bind the offer to the stable editor key and captured current presentation/source,
plus the explicitly offered revision. Clicking it deliberately uses normal
`registry.open` with that exact revision. The editor key deliberately excludes
revision (`web/editor.mjs:5`), so this reuses the editor: `editor.sourceRef`,
writing, quotes and the image cycle retain their original pins while the
presentation can show N. Do not create a revision-keyed replacement editor or
transfer its upload cycle. A stale offer from a closed/replaced presentation
cannot reopen its source.
Declining/ignoring it has no effect on writing. A still newer key updates the
offer, not an already dispatched explicit-open request. Reopening a revision
uses normal retained-writing behavior; freshness provides no new undo or merge
of revisions. Render the offer in a distinct node from `source-update`: the
existing `paintStatus` owns that node's pinned-writing explanation (base
`web/reader.mjs:299`; image `45fc174` at `web/reader.mjs:357`). Preserve both
messages without allowing status repaint to erase or retarget the offer.

### Stale completion, failure, permission and resync

Capture instance, actor, authority pair, scope/controller generation, resource
key, request generation, input cursor and target version at dispatch. Before
applying, check the still-current binding and applicable frontier/source, plus
response identity and monotone resource version. Remember invalidation arriving
during a read so it causes one follow-up. Reject late answers after navigation,
dispose, resync or known authority change. An aborted read is not a successful
refresh. Ordinary view responses do not carry a new authority grant.

Parse typed store errors before the app's generic `validate` discards their code,
including errors in thrown `AttemptError.details.error` as well as successful
HTTP response bodies. **AUTHORITY_CHANGED and INVALID_BINDING fence the current
generation, stop freshness and park writing immediately**, even when bootstrap
also refuses and no fresh authority pair can be read. They must not fall through
to transient backoff or wait for a successful pair comparison. This includes
failures before Changes runs and failures of the resync bootstrap request.

Classify remaining results explicitly:

| Result | Consumer action |
| --- | --- |
| HTTP 503 `SERVER_BUSY`, retryable `AUTHORITY_BUSY`, `DATABASE_BUSY`, network/abort failure | Keep completed checkpoint and dirty keys; yield/back off (500 ms, 1 s, 2 s, capped at 5 s, with bounded jitter for competing documents). One pending retry, no request pile or public-operation replay. Expected foreground cancellation is a defer, not a visible loss error. |
| `CLEANUP_DEFERRED` | Yield to foreground; keep invalidations and retry after the reservation, without an error claiming data loss. |
| HTTP 401 `SESSION_REQUIRED` or 403 `ORIGIN_REFUSED` | Stop automatic work and offer Reload to reconnect; writing is kept. No automatic reload, journal clearing or token substitution. Deliberate reload honors local durability/beforeunload protection. |
| `VIEW_TOO_LARGE`, `INVALID_ARGUMENT`, `INVALID_READ_CLASS`, malformed identity/page | Diagnostic stop, retaining stale view and writing; no repeated baseline or transient retry loop. |
| `AUTHORITY_CHANGED`, `INVALID_BINDING`, `RESYNC_REQUIRED`, topic/source `FORBIDDEN` | Use the distinct authority/resync/access paths here, not the transient bucket. |

Show updates delayed for a transient failure and permit explicit retry. The
healthy one-second claim excludes hidden, offline, denied or transport-stalled
periods; evidence must label those separately, not erase their elapsed time.

For `RESYNC_REQUIRED`, fence the old generation and compare a freshly read
bootstrap binding. If instance, actor and authority still match, visibly
re-establish a baseline before rereading permitted dependent views, including
loaded Notebook keys and the message delta; preserve old source/writing. Do not
turn a malformed response or `INVALID_ARGUMENT` into repeated baseline loops:
stop with a diagnostic and keep the prior view marked stale.

If authority differs, or AUTHORITY_CHANGED/INVALID_BINDING is observed through
either result/error channel, stop freshness and park writing through its existing
`EditorSession` owner. The concrete reuse gap is `45fc174 session.mjs:182-186`:
`authorityChanged(entry)` requires a failed command envelope/error and immediately
calls `refreshRecovery` (`:154-178`), which probes and reads private state. A view
refusal has no such command and must not initiate that unconstrained recovery.

Factor/reuse the owner's recovery-state initialization into a narrow park-only
entry point: validate the captured failed pair against that session's authority,
set review-needed state synchronously, persist it locally, and do no network read
or authority adoption. Do not replace an existing newer recovery review. Use the
existing recovery object/gates (`save` at `:337-345`, `send` at `:350-353`), not a
second authority owner or fake failed operation. The existing command-error path
can keep its current probe behavior. Explicit Review/Retry proceeds through
`retryAuthority`/`refreshRecovery`/`resumePrivate`; their reads use foreground
admission. A park with no new pair is valid. Cancel affected autosave timers while
preserving local saves and exact pending operation identities. Instance/actor
replacement requires deliberate reconnection; never reuse old private state
under a different identity.

For topic `FORBIDDEN`, stop that scope and hide its now-unavailable list/metadata,
while retaining private writing. Topic access loss does **not** prove source
access loss: a directly delivered message can remain readable. Recheck the exact
active source and its editor state, sequentially through the coordinator, with
source-generation guards and without registering replacement editors. Preserve
source/selection if still allowed; disable sending to an unavailable destination.
If the source is also refused, hide its cached body/attachments and quoting
affordance, but preserve the private editor and recovery copy. Privacy takes
priority over source selection in that case. A failed availability read shows
unconfirmed availability and blocks newly enabled actions; it cannot grant
access. Explicit Retry can recheck permission. Do not silently restart denied
polling or manufacture an empty, apparently current topic.

## File ownership and minimum proof

Lead assigns implementation only after independent critique of this exact plan.
UX keeps UI/editor ownership; Core does not change reviewed query behavior.

| Owner | Proposed files/responsibility |
| --- | --- |
| UX | New `web/freshness.mjs`: scoped feed state, typed-result checks, per-key coalescing and convergent revision targets. `web/app.mjs`: baseline/capability order, list adapters/frontiers, Refresh/lifecycle hooks and allowed in-place presentation metadata. |
| UX | `web/reader.mjs` and `web/index.html`: distinct convergent revision offer/status without redraw. `web/app-session.mjs` and narrow `web/session.mjs` refactor: availability, neighbor generations and reuse of owned recovery state for park-only observation. `web/api.mjs` and `web/cleanup.mjs`: read class, capability-gated foreground cancellation and signal propagation; preserve local FIFO and proof guards. |
| UX | New focused `tests/ui_freshness.test.mjs` for deterministic controller checks; `tests/reader_persistence_native.mjs` gets a selected freshness mode using the actual app, plus only touched session/image assertions. `tests/reader_native.mjs` and `fixtures/reader.mjs` are not consumer/HTTP evidence. |
| Lead | `aim_next/server.py`: bounded admission classes/header/bootstrap advertisement, callback/close-owned release. New focused `tests/test_http_read_admission.py` may prove this transport seam; `tests/fixtures/ui_http.py` gains private stdin agent/race/slot controls for UX's real-app proof. Generic `test_http_store.py` alone cannot prove consumer ordering. Integration, exact revision review, publication and retained-instance rollout stay lead-owned. |
| Core | This plan, shared-contract consultation and independent evidence review as assigned; query changes require a separate concrete defect. |
| Fable | Independent pre-build critique and exact implementation/evidence review. |

The changed-contract proof is bounded to these cases, not a new blanket suite:

1. **Real consumer and pinned initial race (F1).** Run the actual `app.mjs` via
   `reader_persistence_native.mjs` and `fixtures/ui_http.py`, with real Store,
   authenticated HTTP, IDB and Web Locks. The current connected helper enables
   interception only after readiness (`45fc174 reader_persistence_native.mjs:129-134`);
   move the freshness-mode setup before navigation and install response-stage
   interception before app startup. Do not replace the app with a renderer fixture.
   Extend private fixture stdin (currently `ui_http.py:98-129`) with a second
   fixture agent's committed message and `memory.revise`, preserving exact actor,
   operation IDs and receipts. No product debug endpoint or real member identity.

   Pin the schedule against already captured **old response bodies**, not merely
   a request in flight. Startup currently reads the lists sequentially, so use
   two holds: capture the first topic_messages response, commit message M through
   the private agent control, then release that response; capture the first
   memory_items response, commit revision N+1, then release it. Read back that the
   held bodies exclude M/show N and that commits precede release. The initial
   baseline must precede both captures. Drain real HTTP changes and observe M and
   the updated summary/offer without Refresh. A mutant moving baseline **after
   all initial dependent views** must miss those commits and fail this exact
   schedule. Also cover a small continuation page/terminal checkpoint and a
   commit after the captured window. Count consumer requests and stored records:
   no consumer command/delivery acknowledgement; fixture agent writes separately
   attributed. Existing Core tests cover the full query correctness matrix.
2. **Paging, coalescing and offer convergence.** More than 30 incoming messages
   appear once without resetting older history. A loaded Notebook item beyond
   the first 20 refreshes through its keyed read. Ticks/clicks/local notifications
   coalesce; invalidation during a read gets one follow-up. Stale scope/authority,
   older revision and older frontier answers cannot paint. Defer the Notebook
   summary and consume its key, then open the item; separately commit after a
   captured source response while opening. Both schedules retain the highest
   target and show the exact offer after ordinary present/status repaint.
   Unloaded ranges do not trigger whole-Notebook scans.
3. **Real server budget and sustained producer (F2, F6).** In the same real-app
   fixture, have two documents whose actual visibilityState is visible (separate
   CFT windows if necessary), automatic checks in both, an image Check/retained-ref
   validation, and paired open/neighbor reads. Instrument the actual production
   admission enter/release plus Store callback and close in the private fixture;
   do not infer holders from client fetch counters. Assert active background <=1,
   active foreground <=1, total Store-read holders <=2, bounded waiters, FIFO order
   and the intended header/default on every inventory path. All selected
   foreground opens/neighbors finish without freshness-caused SERVER_BUSY.

   Hold a background callback inside Store, request foreground open, and observe
   it complete through the foreground slot while background remains held. Abort
   the client background fetch: server counts must still show the holder until
   the fixture releases its callback and close. Separately hold Store.close to
   prove it owns the permit too. Cover a full queue, expiration from original
   admission time, queued disconnect, and post-expiry absence of a late Store
   callback. Disconnect must not leak a ticket or free an active permit early.
   Verify old-server/no-capability mode sends no changes checks or automatic
   freshness-dependent reads; existing recovery cleanup may still run.

   Drive the real format2 persisted -> request -> uploadProof producer during
   continuous plain-text editing. Record admission cause, pending age, dispatch,
   settlement and retirement outcome; freshness must progress and meet its
   selected healthy deadline **while the producer still runs**, not after idle.
   Use finite healthy read delays and an explicit workload, never an artificial
   early rejection to fake settlement. Retain local late-settlement/foreground
   reservation checks and verify send does not wait behind either read queue.
   This evidence neither fixes image admission nor waives its separate follow-up.
4. **Native selection, picker and writing (F1, F4, F5, F8).** Also run through the
   real app/HTTP/IDB fixture, not `reader_native.mjs`. Hold an actual image picker
   reservation through an incoming message/Notebook update, then complete the
   selected file on that same reservation. Verify freshness did not replace
   registry.current, change registry.generation/pendingOpen, or invoke show/present;
   observe public object lifetimes with test-only instrumentation, not product
   debug state. Before/after native checks cover exact selected text/range,
   source reference, focus, caret/place, private body/quotes, editor key and cycle.
   Lists, arrows and offer may change; source/editor/image ownership may not.
   Explicit revision opening changes the presentation while preserving the
   existing editor.sourceRef, quotes and image cycle. Status paint cannot erase
   the offer, and a stale offer cannot reopen a replaced presentation. Include
   cancellation/close during a held read and its late completion. Use the final
   corrected image interface; no rerun of unrelated image cases.
5. **Consumer failure/recovery over the actual HTTP seam (F1, F3, F7).** Inject
   controls through the private fixture (never a product endpoint) to exercise
   HTTP-200 typed refusal, pre-Changes AUTHORITY_CHANGED/INVALID_BINDING and
   bootstrap AttemptError.details refusal with no fresh pair. Observe parked,
   durable writing and no automatic probe/adoption/send. Exercise SERVER_BUSY
   backoff, 401/403 reconnect stop, oversized/malformed diagnostic stop, and
   same-binding resync with a pinned initial-view race. Topic denial must preserve
   a still-readable directly delivered source, while source denial hides source
   content and retains private writing. Existing failed conflict-read handling
   remains a separate correctness obligation; admission success must not mask it.

For proofs 1/4/5, fixture `Store.command` controls run as the fixture agent through
the same command library; label them as such rather than claiming a new CLI/broker
run. Existing connected-loop/CLI evidence is reused. Export source hashes for every
loaded module, adapter, fixture and instrumentation file. Browser requests and
private fixture controls are separate timelines. No real human instance is used.

Red-first applies. For each load-bearing new claim, use a small mutant that
actually changes bytes, with its targeted assertion and restored control: omit
baseline/advance partial checkpoint, drop remembered invalidation, bypass stale
generation, reset history frontier, replace selected revision, or bypass shared
transport accounting as appropriate. Add narrow mutants for the new seam:
background borrowing the foreground slot, release before Store.close, ignored
queue expiration, automatic polling without advertised capability, and a
freshness call to present or replacement of registry.current. The pinned
late-baseline mutant must fail in the real app fixture. For the progress check,
a mutant gating freshness on cleanup.idle must fail while the producer runs.
Each assertion must distinguish its own mutation from unrelated failures.
Check for redundant guards before claiming a kill. Do not remutate Q1 merely to repeat its existing evidence. Python probes
use CPython 3.9 and a separate `PYTHONPYCACHEPREFIX` per mutation/control.

Measure collection, fixture/server setup, browser readiness/waits, test execution
and reporting separately. For freshness record commit-to-visible latency,
queue-to-dispatch delay, request duration, keys/pages read and dependent refresh
count. The retained target is healthy visible-page catch-up within one second;
record keyed-read p95 against the 500 ms target rather than assuming it. Compare
the same visible workload with 1,000/10,000 unrelated records using existing
fixtures and the inherited Q1 bounds; an unrelated commit must not refresh
dependent lists. Candidate idle cost is at most two topic checks/second when
healthy and visible, zero when hidden. Record actual work as well as latency.

Only one substantial workload at a time, coordinated with lead. Use an isolated
checkout, fixture instance/origin and Chrome for Testing, ending it with
Browser.close. Tests never use the retained human instance or legacy AIM data.
Existing release gates stay in force; this plan adds no blanket rerun. Bind the
final UI proof to the integrated source hashes and distinguish implemented,
verified, published and activated.

## Handoff and unresolved risk

Revision 03 addresses only F1-F8 and the agreed admission/progress follow-up:
real-app/pinned-response proof, per-server read partition and bounded queues,
error classes, in-place presentation and picker invariants, convergent revision
offer, foreground cancellation with server-owned release, and the named
park-only seam in existing authority recovery. F8's revision offer stays in this
increment; UX starts after image correction/integration. Neither image X1-X3 nor
manual-Refresh activation grows from this plan. Proposal02 remains frozen at
SHA-256 `ff134fe4fe8aba5f02249281ae2c5dc1023a90d2114b350c4e24b99647c37750`.

The known image cleanup-admission follow-up and native-02 conflict-read refusal
remain separately tracked. The latter predates freshness; the server partition
cannot substitute for persisting a safe client conflict when a read fails.

Next action: Fable critiques this exact document against the pinned code; lead
then lands the accepted document at its intended repository path and assigns
implementation against the integrated corrected image revision. The main
unverified risks are foreground throughput with one reserved read slot, bounded
queue timing under two active documents, continued image-proof demand,
maintaining loaded paging frontiers, authority/permission transitions and
preserving image/source/editor lifetimes. The partition does not preempt an
active Store callback, guarantee a deadline under slow storage, or solve image
producer admission. Those limits are part of the review, not implied green claims.
The 500 ms cadence is a measured starting choice, not a shipping guarantee.
No automatic-update implementation, browser result or retained-instance rollout
is claimed by this document.

## Independent review: implementation conditions

Fable's clearance `m-bfbb8d37` adds these conditions. They are part of the
implementation and final review, not evidence that updates already work.

1. **Atomic permit handoff.** Grant, expiry and withdrawal are decided under
   one lock. A granted ticket owns the permit even if it wakes after its
   deadline: it proceeds or releases and hands on, never returns 503 holding
   it. Wake the head specifically, or notify all with a head check. Prove
   release at the head's expiry instant returns active to zero and admits the
   next read; also prove prompt head wake with two waiters. Apply and restore
   a distinct mutant for each claim.
2. **Foreground latency.** Keep the specified fixed FG1/BG1 partition and no
   borrowing. Measure paired source-open and neighbor latency against the
   pinned base on the same workload. Assert no foreground reservation expires
   in the selected healthy workload. The existing single five-second client
   deadline starts before `keepLocal` and covers both halves of a pair.
3. **Browser socket contention.** Under proof 3's two-document workload,
   record Send-click to `/api/command` request start, including CDP browser
   queueing/stalled time. Queued reads occupy sockets; server counters alone
   cannot prove foreground dispatch latency.
4. **Retryable authority parking.** Park-only recovery uses its own phase
   accepted by `retryAuthority`, not `refreshRecovery`'s `loading` phase.
   Proof 5 must press Retry after a view-refusal park and reach the binding
   probe and `editor_state` read.
5. **Complete read-error classification.** HTTP 500 `REQUEST_UNCONFIRMED`,
   HTTP 503 `CAPABILITIES_UNAVAILABLE` and other retryable 5xx responses back
   off on reads. An unlisted nonretryable code stops diagnostically. This
   never authorizes replaying a public command.
6. **Cleanup deferral.** Inside `cleanup.read`, classify its own foreground
   reservation abort and a background 503 as `CLEANUP_DEFERRED`. Opening a
   source while a cleanup read is held must leave `cleanupError` null and
   preserve retained rows and bytes.

The plan's baseline remains historical until the first implementation records
its exact integrated image revision. Manual-Refresh first use remains the
independent, earlier handoff described in [first-use.md](first-use.md).
