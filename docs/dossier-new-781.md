# Dossier header New (item 781)

Source contract / SPEC, written before implementation on live98
851471193d72f88312d428bb9e0383dae887a4e0. Tony9670 approved Warp9664's
restatement; Warp9675 ordered the build. No preview was requested. This is a
fresh build, with no predecessor source or workflow imports. The supplied
brief names no predecessor REPORT or SPEC.

## Person's act

A click, first phone tap, or activation of a dossier header's red `New` or
`· N new` opens its most recent New message whole in the feed and selects that
same message. Reader remains closed. Each completed act consumes exactly one
message, greatest message sequence first, including the head among candidates.
The messages and dossiers retain their source order and personal placement.
The head's existing New label takes precedence while that head is New; once it
is read the existing reply count shows remaining New replies. When no New
message remains neither red label is drawn. There is no chooser.

The action uses the existing visit's `cardRead` predicate. The page deliberately
retains unread appearance during ordinary on-screen reading even after delivery
acknowledgement; ordinary reading, hovering and fetching whole words must not
consume that retained New. Existing Reader opens, replies, thumbs and marks
keep their established semantics. No global unread-policy change is authorized.

A stale rendered label whose current dossier has no New message shows a quick
check, animates to its endpoint, then removes that label. This is a view-only
confirmation: no fabricated settlement and no decrement of a stored counter.
A new message arriving during the check must still show New after the check.

## Source and Core ownership

`stack-order.mjs` chooses the maximum-sequence unread message, independently of
DOM order, reply array order, timestamps and alphabetical ids. `reply-stacks.mjs`
draws actionable spans in the existing tab and routes that act before ordinary
head folding/renaming. Message-menu's phone first-tap interception exempts only
these header actions. All ordinary message links and card taps keep their path.

The application reveals with full/open, opens a personally folded message for
this visit without changing its recorded fold, fetches the whole text through
CardScroll's foreground path, reveals and focuses the same card. It does not
open/switch an editor, close a dialog, change writing, invoke a navigation guard,
or change a draft, pending reply, attachment or destination. Existing authority,
access-epoch and page-lifetime guards apply before effects and after awaits.

Settlement is the existing Core `topic.read_through` command with
`from_seq == seq == chosen.seq`, plus `message.mark(false)` at the mark revision
captured before opening when marked. It never acknowledges a range spanning
neighbours. Only matching, recorded committed receipts earn the visit's read
appearance and redraw the derived label. Core's delivery and mark rows own
persistence. Retries of an unconfirmed delivery command retain its exact
operation and authority; Marks already retains exact mark requests. A refused,
failed, superseded, edited or inaccessible landing must not claim consumption.
A mark renewed while opening is not adopted by an older clear. Repeated presses
while this dossier is busy queue in order, and select afresh after the preceding
act completes. Each completed press selects the next greatest New sequence.

No schema, new Core command, instance migration, storage prefix clearing,
background read policy, dossier ordering or normal link route is needed.

## Local evidence

Before source changes, focused Node tests must demonstrate failure against the
unchanged product source, including the existing head click's missing action
routing and newest selection. Tests exercise actual functions and renderer,
not source strings alone. App orchestration may be evaluated with explicit
bindings as the retained unread landing contract does. A separate focused
CPython 3.9 contract uses a temporary isolated Store and actual commands and SQL
to show exact-message settlement, neighbouring deliveries left pending,
revision-fenced marks, privacy and unchanged draft contents. No live store is
opened. Node tests run serially with --test-concurrency=1; one test workload at
a time. Every Python run has its own effective PYTHONPYCACHEPREFIX.

Required applied mutants: skip the settlement request; select oldest instead of
newest; remove first-tap exemption; prematurely complete the stale animation;
and falsify measured landing geometry. Every mutation must assert changed bytes,
produce a failing focused control, restore exact bytes, and pass a restored
control. Geometry's local control tests the native instrument with synthetic
measurements; it is not a measurement of a browser. Keep all failures and logs.

## Native cases prepared, UNRUN in this source phase

An item-specific case module is called by the existing reading harness. At
320/390 phone widths with native taps and 1280 laptop width with native pointer,
in light and dark, in each runner engine in the next authorized stage:

1. Head New alone with a read reply: first act opens/selects head, full exact
   words, Core read state, New gone, Reader closed, saved writing unchanged.
2. A read head with three New replies: exact identities newest/middle/oldest,
   count 3 -> 2 -> 1 -> gone, each clicked once, exact source order unchanged.
   Include a personally folded and cut-off reply and one behind Earlier messages.
3. Mixed head New and newer replies: newest reply first, head last; no jump to
   another dossier. Preserve privacy and normal message-link behavior controls.
4. Stale label: arrange a visit's New then change the known reading predicate
   without repainting the header. Start native input, observe the check animation
   on its real node, await animation.finished and a frame, require label gone.
   A delayed endpoint and arriving New must not be hidden. No fixed sleep is
   evidence of the endpoint.
5. Ordinary whole-word fetch/scroll reading leaves the retained label unchanged;
   normal message links still open Reader. Retained guard/draft controls stay.

Record chosen ids/sequences and Core before/after, actual input, source identity,
Reader.open, full words, focused/lit card, counts, pending commands, writing and
order, animation play states and endpoint, screenshots at each relevant state.
Use named tolerances: landing viewport edge 2 CSS px, horizontal overflow 1 CSS
px, nonzero painted box 0.5 CSS px, unchanged ordering positions 2 CSS px only
where placement is compared. An offscreen-by-12px instrument mutant must fail
the landing assertion despite its 2px tolerance. These tolerances are planned,
not claimed calibrated against engines until the next stage runs them.

## Budget, freeze and review boundary

Prior hosted/native/browser/whole-suite starts: 0. This phase allocates and
starts 0. All 18 remain unallocated for later acceptance; no runner, browser,
server, dispatch, install, publication, push, PR, board or live-store write.
Native capture/acceptance follows in the coordinator's next stage without another
preview wait. Local controls prove contracts only. Layout, actual hit testing,
native focus/selection, touch and animation rendering remain unrun until then.

Freeze a clean commit on fable/781-source9675, its head/tree/ordered parents,
full binary diff against the exact base, complete tracked source manifest,
evidence SHA256SUMS and whole REPORT/SPEC. Prior supplied evidence stays intact.
Stop for independent review without self-approval or a landing promise.
