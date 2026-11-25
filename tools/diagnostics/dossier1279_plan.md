# 1279 corrected observer plan, source only

This implements Fable26793 revision2. No corrected producer has entered.
451 remains unspent. Request one corrected448 full-file continuation first;
return its actual trace/barriers before any later451 disposition. Keep both
previous physical attempts and all original forecasts/accounting gaps.

## Corrected source finding

The earlier module-mismatch diagnosis was wrong: pinned `web_build.py` writes
an import map from `/` to `/b/<stamp>/`. Absolute imports already resolve to
the versioned document graph. The original observer instead dereferenced
`this.positions.get(id)` before the actual method and before its event was
logged. TopicViews initializes no positions Map and treats it as optional.
That expression can throw inside the observer before product ingestion.
The original run did not capture that exception, so this is source evidence,
not a retrospective assertion about its actual throw or Tony's incident.
26788 revision2 corrects the interpretation of the immutable earlier packet.

## Exact observer and positive control

Read the document's versioned app script URL and import map. Retain that URL,
explicit TopicViews/StackFeed URLs, actual served byte lengths/SHA256s and
pinned Git head. Assert served bytes equal the pinned product files. Import
those exact URLs and separately assert identity with the absolute specifiers.
Identity equality alone does not pass the owner-call control.

The separate observer module wraps actual TopicViews messagesPage, trimWindow,
readPositions and refresh, plus StackFeed.arrange. Log entry before invoking
the real method; retain caller stack, target records and position clocks,
epoch/floor/frontier, window counts/pins and cover/entry/focus/range geometry.
Use the message's actual stack_position, never an assumed positions Map.
StackFeed.messages is a provider; observation neither calls it nor treats it
as a Map. Repeated method snapshots compact the full loaded-id list; complete
canonical membership survives in batch/DOM snapshots and incoming page ids.

Observer record construction is caught separately. The real call always runs
despite a logging fault. Preserve original synchronous return and exact thrown
object. For async owners return the exact original promise; observe settlement
without substituting a promise or suppressing the original caller's retry.
Currentness wrappers log only calls the product actually makes, preserve
arguments/receiver/value/throw and never probe currentness an extra time.
Observer errors and dropped events are explicit diagnostic barriers.
The main file retains an integrity record before and after every30-arrival
batch and immediately before setting transitionComplete. Any recorded error
or event loss stops that case before the next batch/completion. This source
successor closes Fable26822's later-error/loss finding without changing the
actual owner call, its return/throw, or any existing case/oracle.

For each applicable case the first normal30-arrival batch must produce an
actual document messagesPage entry naming its last arrival, with its matching
return/throw. This is the positive control; do not call a product method to
manufacture it. A throw, false return, missed control or logging fault stops
that case before more pressure. Retain the actual error or before/after
frontier/epoch/floor and observed refresh currentness values. No owner entry
plus an actual currentness false is distinguished from ingestion throwing;
missing observations remain unknown. Capture the updates notice as well.

## Focus and unchanged physical cases

The plain cover note/text itself has no tabindex. Pinned coverSheet can append
the existing refresh control, whose nonpending form is a native button; this
scratch fixture additionally contains an authored reference link. Those are
existing conditional focus targets, not permission to add one. Inventory the
actual rendered target cover's links/buttons/tabindex, disabled/inert state
and rectangles before trying the original bounded80 native Tabs. If none is
available or Tab does not reach it, retain that case barrier. No focus(),
tabindex mutation, handler invocation or hidden synthetic focus substitute.
The original80-Tab failure remains untouched; inventory is not a passing
native focus result. A focused control that exposes message entries cannot
be labelled the cover-only condition: the existing initial-condition oracle
still applies.

Keep the same baseline-v2 initial records/hash, four case labels, separate
ephemeral context/origin, pinned448 source and installed lock/nice15/load<12/
landing priority. No product/fixture-server/runner change. Cases still inspect
cover-only visibility, cover focus, cover selection and visible-message
control. At most330 ordinary arrivals per case in30-record batches; identical
cover churn at120 only after the positive control. Capture current focus/range
at every transition; an earlier churn-induced range loss is separate from a
later retirement. More/authored linked return remain separate and conditional.
Never bypass guards, force admission, increase the300-record product budget,
alter a retry or touch Tony's data/profile. Capture full case barriers and
Browser.close/profile absence/server-thread close/child+wrapper reaps and
original group observation. This is instrumented diagnosis, not CPU/latency
acceptance or proof of the historical human incident.
