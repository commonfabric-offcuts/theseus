# The left rail stays through a move (1005)

Warp14762, the medium1005 Candidate at intake, and Tony Backlog14745/14747/14749/
14751 are the source. Base actual live source: e77b46168a0bc5e0addecbe58b3dd18c8db22407. NEW own
page-lane5/1005-solid-left-rail. Fable14797 bound medium Build1
p-f033d7ae4d144106a6712bf7 in the existing1005 topic. Fable owns stages;
Warp owns current-live carry/review.372 is shipped284;999 is shipped282.

## First reproduce and measure

All three original screenshots are downloaded through the bound actor and
inspected: Updates delayed with Retry; moved-on topic notices in retained
outcomes after a move; unreadable-response plus topic/star notices. Tony also
asks whether a release overlapped. These are distinct observations, not one
assumed cause. Reproduce on the exact live source in isolated native Core/HTTP
fixtures on this Mac, moving between outcomes while topic and freshness reads
are outstanding. Retain actual observed load below the standing12/18 limit;
do not manufacture broad CPU load. Real observed round trips and separately
labelled controlled delays must never be conflated.

| Observation | Native intake-source baseline |
| --- | --- |
| Two ordinary outcome moves | One document/folds retained; seven A topic nodes reconstructed |
| Held B list across own move | Actual Core reply7.7ms; separate56.0ms hold; moved-on notice observed |
| workspace_topics ordinary local requests |3.8–14.2ms observed request→finished; no production-latency claim |
| One controlled503 poll failure | Updates delayed displayed after first failure, cleared after successful retry; about569ms visible |
| Repeated exact reads in ordinary-move windows | workspaces(limit20) twice; per-topic stars/memory_stars twice; full exact arguments retained |
| Release/build/session overlap in Tony’s captures | Not reproduced; no causal claim |

The original unchanged Chromium canary had12 checks:8 pass/4 actual behavior
reds, no pageerrors/fatal. Source hashes, full browser request traces, notice
observations, DOM identities and screenshots remain in1005-baseline evidence.
The held response/faults are explicitly controlled, not actual slow service.
Actual observed load3.73/18 at baseline. The longer Tony-device/release-overlap
question is not answered by these scratch fixture timings.

Use native input and browser request/response timestamps, with exact served
source, full trace and before/after screenshots. Record every read issued
more than once per move. No fake-DOM timing claim, no production record writes,
Tony browser/profile or runner/server installation edits.

## Behavior

A read superseded by the person's move is discarded and re-issued for the
current place silently; it removes no row or saved fold and shows no moved-on
notice. Keep the existing rail nodes, folds and reading position through a
move; change current-place marks. Replace list content only after a complete
new answer is available, as982 publishes its bounded More answer once.

Slow/in-flight polling is not a failed poll. Show Updates delayed only after
its retry attempts actually fail; never dim the rail because of that status.
Default: initial attempt plus two automatic retries (three consecutive failed
passes) before a retryable delay notice. Existing backoff stays500,1000,2000,
4000 then5000ms, with0–99ms jitter. Actual I/O time is additional. Retry
continues after the notice; success resets the failure count, dirty-resource
progress and checkpoint rules remain unchanged. A history-resync success
does not report a failed poll, and resync read failures use the same budget. Real access, authority, malformed-response and reconnect
failures retain correct diagnostics/recovery rather than being hidden as
navigation. Preserve one-build navigation and exact writing/recovery rules.
No new Core API/schema/storage change is expected.

## Ownership and checks

OutlineRail, TopicPages/TopicRail, Shell's rail read/handoff and Freshness are
the read/publication seam. Core8's1000 retains durable Archive/Done act and
outcome navigation; coordinate any shared app/navigation edit in the work
topics before it is made, and share measured read names. Core7's1003 owns
rail-dimming.mjs and its reader-wait markers/notifications; preserve973/981
Dim choices and waiting-filter semantics. No dimming-owner rewrite is planned.

Before product: native current-head reproduction plus real-owner red checks
for supersession/retry/atomic publication and retained node/fold identity.
Then meaningful small regressions, actual applied/caught/restored controls
and native desktop/phone both-look flow with exact source and strict owned
Browser.close/PID/profile/fixture EOF0/PID/port cleanup. Retain raw failures;
freeze on own meaningful green, push only this branch and one Warp diff/test
read. Fable stages and Warp carry/landing. Reproduction/measurement remains
owed; this intake is not a diagnosed cause or completed fix.

## Implementation and shared boundary

One document-owned TopicRail per outcome now supplies both the left outline
and the current topic's OutcomeScope. Outcome home cards already consume that
same owner. Navigation no longer adopts/clones/discards a page-owned list.
The topic page gets the rail through Shell.topicsFor; its existing writing,
navigation and runtime-review guards remain. A selected topic is separate
from retained known topic facts. Clearing selection removes current-page marks
immediately, retaining its row until a complete fresh list is available.
Newer current-topic facts learned while a list waits cannot be overwritten by
that list. A successful refresh publishes all requested lists together.

Outline.begin invalidates each rail's read epoch; Shell's queued view accepts
a current-run guard and throws only typed READ_SUPERSEDED before dispatch.
Each stage of readTopicList checks its run before continuing. Retired replies
publish nothing and never display moved-on text; the next run's normal load
reissues what is still needed. More extents, groups/cursors, hover/focus
retention and access/malformed response diagnostics remain owned by TopicRail.

Starred dossiers/pages keep their nodes across a move; their read epoch retires
old work and a new complete reply owns publication. Changing instance/actor
resets these in-memory presentations explicitly, without touching saved stores.
No topic-body/star-body cache is copied into a test. Current native first
correction removes duplicate stars/memory_stars reads per move; the observed
two identical workspaces(limit20) reads remain a named limitation.

Core8's1000 pending projection is coordinated at14823/14833: pure final items
projection, scoped instance/workspace/topic, plus a change notification that
removes only intentionally hidden links even if focused/pointed, then calls
paint(true)/existing presentation callbacks.1000 owns those hooks and its new
journal/controller/module naming;1005 leaves TopicPages.items and paint's
retention algorithm unchanged.1003 owns the dimming expression,1010 the look
footer. No Core/schema change, migration, runner/tool/live-installation edit.

## Validation at freeze

Owner red and native baseline retained. Final241 affected controls across14 files pass,
including actual old-run rejection, atomic all-list publication, late current
metadata, retained stars,901 routing and982 More extent. The first expanded
native matrix retained four harness failures: it released its malformed-HTTP200
fault after one reply, so automatic rereads recovered before the native Retry
press. The corrected driver keeps that fault until an observed trusted click;
this changes only fixture control, not product behavior. Final exact-source Chromium96/96 and WebKit96/96 pass. Each engine runs
16 full-app/Core/HTTP contexts:390/1280 × both looks × navigation, transient
poll, exhausted poll and malformed topic-response recovery. Browser.close,
every observed owned PID/profile absence/removal, fixture EOF0/PID/port
cleanup pass. Five real source mutations each cause exactly one intended
owner failure, with identical restoration hashes and restored controls green.
The source/report/evidence packet is in the1005 review handoff. No physical
phone, software-keyboard, Tony-network or production-load timing claim.

The furthest drawn current row also counts toward a departure's reload extent.
If it was injected beyond the first page, a first-page answer cannot disprove
it: the bounded atomic reread reaches its position before clearing its overlay.
The dedicated41-topic control fails without this retention; no request exceeds
pageMax. This uses the existing loaded-extent rule, with no whole-instance scan.

The wider run's five obsolete adopted/copy-handoff cases are replaced by the
persistent-owner and page-ID-retirement coverage: two976 cases rewritten,
three935 clone-specific cases retired with the preserved density/key cases.
The new902 shared-owner check and native matrix hold their actual guarantee.
The old844 prototype fixture failed on pristine intake too because it omitted
the constructor's dimming binding. It now supplies that binding and verifies
the same current rail identity; its no-duplicate-current-list assertion stays.
Final wider controls have no unexplained failure or known-red waiver.
