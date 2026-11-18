# Refresh a dossier cover (Pipeline 738, preview only)

Pressing the cover's refresh glyph asks its writer to rewrite it using the
latest facts in that dossier. The existing cover stays whole. The glyph is an
activity indicator until Core records a real, changed `stack.cover` revision
after the revision observed by the request. A reply, delivery acknowledgement,
owner's automatic Done revision, no-op write or elapsed time cannot complete it.
The indicator means awaiting a cover, not that an agent is running.

`stack.cover_refresh` targets the dossier's first `message_id`, takes empty
`args`, and requires `expected.cover_revision`. CLI `cover MESSAGE --refresh`
uses the same command as HTTP `/api/command`; `dossier_cover`, message acts and
stack positions carry the same Core-owned refresh state. The ordinary operation
receipt deduplicates retries. Core additionally coalesces all pending requests
for a root across actors and tabs. Once completed, an attempt on its older
observed revision is refused rather than prompting again.
The pending operation identity, requester, observed revision, recipient and request
message are durable in append-only act history. Nothing schedules another prompt on a timer.

Core publishes one attributed request through the existing `_publish` path,
with its addressed delivery, wake eligibility and recovery. It is a reply in
the dossier, private between the same two people when the root is a whisper.
All ordinary topic reach, private message reach, closed outcome and publication
checks apply. No model call, route discovery or scheduler is introduced.

Recipient default: the recorded current cover writer, when enabled, an agent,
and still able to read this dossier root as the same root. Otherwise use the
outcome's explicitly configured coordinator, under those same checks. Neither
the dossier's human author nor an arbitrary team member is a fallback. A request
to oneself is refused because the normal delivery path does not deliver to its
sender. No eligible recipient is an honest refusal, with the cover untouched.
An absent/failed wake route leaves durable pending work; the request message is
reachable from the indicator. Core does not claim a writer has accepted it.

Schema 48 adds topic-owned `cover_refresh` acts and a separate writer record.
Existing cover
values, attribution, history, waits, payload kinds/links and owner-only Done are
unchanged. Historical writer attribution is reconstructed from the last cover
revision whose non-Done content changed (including `done_by`), rather than an
owner's automatic Done revision. Subsequent changed cover writes record the
writer explicitly. A changed write by an agent, leaving a nonempty cover,
completes pending refresh in the same transaction; human edits cannot stand in
for a writer's response. A newer agent with existing cover-write access may take over the cover.
Clearing the cover while pending leaves only the request indicator, without
restoring cleared content.

No-op rewriting cannot prove an update and remains pending. There is no cancel,
reassign or resend command in this preview: route repair uses existing delivery
recovery; changing recipient after a durable request remains an unsettled
product choice. A dossier joined elsewhere keeps its old request in history;
it cannot be completed by a write to another root.

The coordinator hosts this candidate on copied data without agents. A press can
therefore prove durable pending and reload continuity only after Tony tries it;
completion awaits the real writer pathway. The source-only preview stage wrote and ran zero tests; subsequent test evidence is
kept separately at the tested commit. Pipeline 737
links and 717 promises remain separate; this slice retains this base's cover
contracts without copying either worktree.

The browser keeps an unconfirmed command under its instance, actor and root,
with captured authority, before sending it. It retries that exact envelope; a
recorded refusal releases it for a new deliberate press. A changed authority
never silently rebinds it. Storage refusal sends nothing. Cross-tab races are
coalesced by Core in its write transaction. Their checks are named below; pass evidence belongs to an exact tested commit.


## Checks (item 738)

`tests/test_cover_refresh.py` uses real temporary Core records for recipient
selection, publication, same-operation retry/coalescing, authorization, privacy,
stale revisions, owner-only Done, human/no-op/empty writes, atomic completion,
rollback, root joins, reopen continuity and explicit schema 47 to 48 migration.
The act ledger retains executable source breaks for these boundaries.

`tests/cover_refresh_native.mjs`, imported by `topic_reading_native.mjs`, is
selected by `item 738` in `native-reading` and `native-webkit-reading`. Its native
pointer, touch and keyboard acts cover the sheet, singleton pills and Reader,
at 320, 375, 390 and laptop widths in light and dark. It captures unchanged
live94 source before images and candidate idle/busy/pending/reload/completed
states; Core's actual agent cover command supplies completion. Transport,
read-only storage, unavailable writer and missing-cover cases retain honest
state. Source controls measure lost pending, visible pending text and a 1px
hit target, then require exact byte restoration. Geometry names its 1 CSS px
rounding tolerance and the undersized-target control must still fail.

These cases run only through the coordinator's allocated pool. Their presence
is not a pass claim; the external report records source hashes, results,
phase evidence, cleanup and visual inspection at the tested head.


The singleton refresh button receives its own first tap, like the pending
request link. The card's first-tap selection handler exempts this refresh glyph;
its native singleton cases caught the original swallowed tap in both engines.
The shared waiting dots keep their existing reduced-motion behavior.

The bounded correction keeps the same approved product behavior and preserves
caught storage/transport errors as causes. Native Reader helpers reveal the
actual reply through its dossier owner (head/folded/open) before activation.
Keyboard receipts retain trusted key events, focus, rendered target facts and
a failure image; a stalled WebKit Option-Tab is compared with native plain Tab
on the same control. A source mutation removing its tab stop must fail, and
exact source restoration must restore keyboard activation.

The native cases save actual typed writing before requests and compare writing
and To through request, reload, request-link navigation, refusal and recovery.
Comparison captures settle real baseline read reports before holding subsequent
reports to keep the same read state. Completed covers are brought into view.
Actual animation-frame samples and human/no-op/owner-Done screenshots describe
only the intervals they record; they are not a claim about unobserved frames.
All new evidence remains pending until the allocated pool returns.

A trusted, uncancelled Tab can remain on the expanded cover summary in WebKit
for both native Option-Tab and plain Tab. The Reader therefore owns the Tab
boundary within its cover: eligible summary/controls in document order, then
the next Reader stop; Shift-Tab follows the same order backwards. Disabled and
negative-tabindex controls are skipped. A WebKit applied-source control removes
this boundary and must reproduce the actual native access failure before exact
restoration restores activation. This is keyboard access, with the approved
cover presentation unchanged.

Image comparison captures use the same native writing state in the live-source
and candidate Reader. They capture expanded writing separately, then fold it on
a phone by its source tap before comparing the visible cover. Every item-738
capture waits for actual finite animation.finished, an animation frame and an
opaque Reader, and retains that qualification receipt. An in-flight transition
or mismatched writing state is not accepted as an equal-state comparison.
