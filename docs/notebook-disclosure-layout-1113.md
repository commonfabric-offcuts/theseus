# 1113: keep large Notebook pages responsive

Pre-edit contract. Page5 owns this slice on Warp18266/18274 and Fable18277.
1113 replaces dropped1112; its sole message source is Landing18266. The
1076 branch and piece are preserved. Construction starts from actual live356
bc8f125646fb7450b1a1242f851562feb3887751, schema66, in the new own branch
page-lane5/1113-disclosure-layout-356-18274.

The supplied scratch body is 148948 bytes, 2144 lines, SHA256
ef512f546d03078a767929ac69b57fa9e4cec705c834cec711243d641462b45f.
Keep its private content in local ignored artifacts; never commit it or load
its embedded external resources. Use isolated fixture records and an isolated
headless Chrome for Testing profile. No live Notebook or user-browser writes.

Disclosure measurement runs after rendering, once per scheduled frame. Its
three phases are all clamp-reset writes, all geometry reads, then all button
and expanded-class writes. IntersectionObserver limits measurement to words
intersecting the viewport, including clipping by a sheet. ResizeObserver only
queues work; it never synchronously reads geometry. Repaint/close invalidate
old work and disconnect observations. Scrolling a card into view, reflow,
fonts and window resize refresh its real overflow. A browser without
IntersectionObserver uses a batched viewport-rectangle fallback.

Preserve1059: the same one-pixel overflow tolerance, labels, native control
keys, per-page memory-only expansion identity, display choice across repaint
and edits/moves, focus restoration and fallback when a pill disappears,
read-only operation, and no save/history/preference mutation. Deferred focus
restoration must not steal focus from a subsequent user action. Hidden,
detached, removed and aborted rows must never be measured by stale callbacks.
Keep the existing1059 assertions; adapt only their fixture frame boundary
where the contract now deliberately defers measurement.

Source inspection distinguishes one ResizeObserver per controller observing
many words from one observer per card. DeckPage input directly sizes the
textarea; a full repaint per keystroke is not established. Repeated key-hint
painting is an observed owner report, with cause still unproved. Record the
hint count/visibility and typing route in the real browser before changing
another owner. No fake-DOM timing claims.

Checks: focused deterministic scheduling/visibility/write-read ordering and
stale/focus tests, existing1059 state/identity/key protections, and real browser
baseline/corrected timing on the same307-card scratch fixture. Report the
actual baseline and corrected paint boundary, deferred measurement duration,
layout counts, input duration, source/fixture identities and raw samples.
The requested target is one paint under50ms, not a claim before measurement.
Retain actual old-source red/failure and exact restored controls. Existing1059
native behavior remains part of acceptance; do not waive failed assertions.

1113 has the next controlled workload reservation before1028 ONE,1104,1106,
1076. Source preparation is authorized now. Every actual launch still needs
fresh raw UTC/load/CPU strict<12, exact owned-process/profile/TCP boundary
checks and Landing INUSE/FREE. Native fixture and browser launch each require
their own immediate resource sample. Any held fixture is closed through stdin
EOF and its post-EOF teardown/exit/TCP/owned cleanup retained; browser close
uses Browser.close. No browser or test has run at contract creation.

Freeze only after meaningful green evidence, push this exact source branch,
and send HEAD plus test paths/pass/fail to Warp for the independent read.
Warp owns carry/merge/landing/runtime and the separate release after the train;
Fable owns coordination and canonical stage/evidence reads (Fable18280).

Readiness comparison ruling18355/18362: the next controlled window compares
original and corrected controllers on the same307-card body, viewport and
source, with a common clock from before navigation to visible body[data-ready=true].
Use a120-second observation horizon. If either side never reaches ready,
record not ready within120 seconds, actual elapsed timeout and a censored
lower bound; never turn120 into a measured completion time. Capture API
requests/responses and native browser paint/long-task entries. Readiness also
awaits writing.open, paintHeader and loadTalks, so these observations do not
isolate a function's paint duration or establish the disclosure cause alone.
The original one-paint/deferred-work metric and1059 native behavior are still
separate. Typing may follow the pair if the controlled window allows. No
automatic retries or broadened suite follow a hold or unexplained failure.

Landing ruling18407 supersedes the earlier acceptance schedule above. Warp
accepted the retained readiness pair and26 focused Node checks as1113's
landing evidence and directed freeze now, with no further1113 browser window.
The component-paint/deferred-work samples are not a landing requirement under
that ruling. Neither their target nor1059 native parity is claimed measured
or passed here. The original1059 native harness remains byte-identical to356;
the unexecuted helper amendments and refusal-only controls proposed at18406
are retained in local evidence and its attached source packet, excluded from
this source change. The new1113 native harness is the exact20462-byte source
executed for both readiness observations, SHA256
5f5740fe83a4a811c1da64e6067ed5fe7e5a28b2c39cded21c75a86038d11ebc.

Retained validation:
- Actual original356 controller applied:19 passed/7 failed/direct1 across the
  three focused Node files. Two new checks establish scheduling failures;
  five depend on the new test fixture's intersection callback and are not
  five independent product failures. Exact corrected source restored.
- Corrected controller:26 passed/0 failed/direct0, including all19 existing
  1059 state/identity/key checks; only fixture frame flushing was adapted.
- Native common host-before-navigation to visible body-ready boundary:
  original15150.301625ms; corrected1123.63075ms. Both reached ready,
  uncensored, direct0, same307-card fixture, browser and five other served
  owner bodies. Corrected four trusted input events took118.584458ms total
  automation wall; native Meta-Z editor equality, Escape and exact scratch
  Core-body equality passed. These are not per-key latency measurements.
- Both native samples[] arrays are empty: no component-paint result. Original
  historical exclusive occupancy is unproved; corrected observation had
  explicitly permitted1122 unit work beside it. No isolated-cause or
  statistical speedup claim. Earlier ten-second instrument failures remain
  retained and are not relabeled as measured completion times.
- Each readiness observation closed its browser, ended fixture stdin and
  verified fixture/stdio exit0, empty stderr, all12 teardown records ending
  cleanup-complete/errors[], exact TCP ECONNREFUSED and own process/profile
  absence. Corrected ownFREE18394 was independently read at18401.

Public evidence packet1113-readiness-pair-06-07.tgz is510374 bytes, SHA256
733000042e00c5dbfe32eaee41e7366fac57f16cd7c14c8806971136411b4b99,
with43 safe regular members and manifest
4c76cf8f5780b502dc5ceb1010c6ab2c2c2872105edace74d359b9f93e938090.
It is attached to Landing18394; auditor18401 verified every manifest entry,
raw/public report correspondence, served sources and retained cleanup.
Private fixture content and capability tokens are excluded from the commit
and public packet. Warp owns carry/landing/runtime; Fable reviews/approves.


Review repair18414: b7fc1c1d is unapproved. Warp's whole-Node comparison
adds two files that pass on actual356: ui_card_menu_867.test.mjs and
ui_card_review_r4_attack_867.test.mjs. Their adapters have no defaultView;
the new deferred fallback reads its viewport without checking the window.
This is a new uncaught asynchronous error, not a known baseline red.
The repair must stop measurement for a missing/detached window, cancel a
frame through the window that scheduled it, disconnect both observers,
and release document/font/window listeners on explicit close as well as
parent abort. Late queued/observer/listener work must not read geometry.
Add focused lifecycle controls; retain the two real integration failures,
then the whole Node comparison must add no failing file versus exact356.
No browser window or native/performance remeasurement is requested.

The review reproduction on unchanged b7fc1c1d gave148 passed/2 failed/direct1,
with both867 files emitting the reported innerHeight asynchronous exception.
Four new lifecycle checks against that source gave7 passed/4 failed/direct1:
queued fallback and intersection measurement after detachment, cancellation
through the original window, and real event subscriptions after explicit
close. The correction gives178 passed/0 failed/direct0 across these11 new
scheduling/lifecycle checks, all19 existing1059 checks, and the two unchanged
867 integration files. Existing867 test bodies and1059 assertions are intact.
Whole-Node comparison against cached exact356 is the remaining refreeze check.
Its raw output and direct exit belong to the immutable head's review packet.

The earlier readiness/typing observations describe the7955-byte controller
at b7fc1c1d, before this lifecycle-only repair; they are not remeasurements of
the repaired source. No further1113 native window is reserved under18416.
