# Quiet success receipts and local Undo — 1082

Pre-edit contract under Warp17199 and Fable17204/17205, Build1
p-2a6af3b642fd46c8ba1376f0, topic t-fa1d21bd35161bcf9350ae7a1363d720.
Actual intake: release339, 5fa3105db348d34fa315ccf07a55b8581e81527a,
schema65, bound Health1795373258987. Own fresh branch/worktree:
page-lane6/1082-no-success-banners-339-17204. The version published17213 preceded all product edits and test runs.
Tony17147/17179/17195 and their three bound, hash-checked images were read
and viewed: one Archived receipt, Deleted “Test” and ten Archived rows.
The pause and former rail-local Undo proposal are superseded.

## Behavior, lifetime and identity

Both topic-close-ui.mjs and notebook-delete-ui.mjs stop drawing successful
archive/Done/delete receipts, including saved rows after navigation/reload.
Successful restoration adds no receipt banner either. Hiding a row never
removes the saved action, matching Core receipt or Undo target. Existing rail
grouping and Notebook history remain; add no rail button, toast or dialog.

Pending, uncertain, rejected and unconfirmed/failed restore work keeps its
actual line/reason and recovery controls. A refused topic inverse currently
returns to phase committed with a rejected undo.receipt/error: keep that error
visible. Earlier-runtime unresolved work stays parked and visible; storage and
navigation errors stay visible. Filter visible rows before pagination, so
hidden successes consume no slots. Preserve bounded older-Notebook discovery
and its existing door to older unresolved records; no unbounded journal scan.

Default: **ten minutes (600,000 ms)** from the locally kept matching committed
forward receipt. NotebookWriting already uses exactly this receipt-based
expires; preserve it. TopicCloseActions currently has no expiry: keep its first
committed-observation timestamp as optional metadata in the existing journal.
Cross-tab merges/retries/reload preserve the first persisted timestamp. Legacy
committed topic rows without it use their original kept at conservatively;
opening old receipts must not grant another ten minutes.

Unconfirmed forward/restore work never expires. An Undo durably chosen before
the forward answer arrives stays chosen even if ten minutes later elapse. It
waits for that same operation's matching receipt, then forms its fenced inverse.
Expiry rejects only admission of a new Undo; it erases no history, failure,
retry or already-kept choice. A rejected action cannot acquire an inverse.

Keep exact operation IDs, instance/person/authority, targets, args, original
parent/topic, Core field/revision fences, immutable receipts and first kept Undo
ID. TopicCloseActions/openTopicCloseJournal retain monotone merge and exact
retry. NotebookWriting retains its per-page journal, Web Lock and content/image
recovery. No old authority is rebound. Topic Undo retains its existing parent
outcome/workspace route; Notebook retains its document-owned Command-Z and
historyUndo path across in-place navigation/reload. Existing keyboard scope
and precedence stay with these owners; introduce no general cross-module Undo
stack. Hidden receipts cannot be prerequisites for keyboard Undo.

Input/textarea/contenteditable, composition, handled events, Shift-Z and Alt
modifiers retain their writing owner. Preserve newer writing/navigation. No
Core/schema, permission, save/history, app routing,1074 editor, installed tool,
controller or runtime change is planned.

## Bounded verification

ui_success_receipts_1082.test.mjs first runs on actual339: committed
rows draw nothing; pending/refusal/restore-refusal remain actionable; Command-Z
works without a notice inside the window and rejects a fresh expired Undo.
Cover legacy timestamps, cross-tab/replay identity, unknown/already-kept Undo,
authority and writing negatives. Actual owner code with semantic adapters and
controlled clocks proves rules/routing, not native gestures/layout/timing.

Run the named topic-close1000/Notebook-delete1051 cohort and actual startup plus
directly affected Notebook-writing/recovery owners selected from real imports.
The standalone historical1000/1051 native producers assert the retired success
rows/buttons and are not current release-check inputs. Preserve them as history;
the dedicated1082 producer checks the changed UI against real journal/Core
answers and native Command-Z. Existing owner unit assertions stay unchanged.

Bounded real Core/HTTP/IndexedDB native proof: archive two topics, mark Done,
delete a Notebook page, inspect empty success notice regions, restore with
trusted Command-Z, then inspect an applicable rejection/unknown line. Pair
CFT/WebKit, Paper/Bookends and desktop/phone widths; retain screenshots,
receipts/history/IDs, reload/in-place navigation, lost-answer exact retries and
writing negatives. Fixture-only clock changes prove boundaries, not a physical
OS/device gesture or a ten-minute wall-clock wait. Apply a real old owner or
narrow load-bearing fault, observe the check fail and restore exact bytes.
Capture actual commands/exits/results/failures and START/END selected input/body
bytes. Do not weaken unrelated assertions or run an unrelated broad suite.

## Slot and delivery

The shared slot passed1074→858→1082 through actual clean releases.1082 accepted
17337 with its own17338 declaration; Page5/1089 is next under17322/17323.
Measured load must remain below12/18 before each phase/cell. The declaration comes
before private headless CFT/WebKit with scratch records. Browser.close and
fixture EOF/exit0/empty errors, PID/profile absence and closed TCPs precede
browser-free. Tony's browser stays free. Actual results and all failed phases are retained in the final report.

Expected product scope: the two notice modules, topic-close.mjs and
topic-close-storage.mjs for bounded Undo. Optional local metadata needs no IDB
schema upgrade and remains readable by the prior code. Independent review
classifies the final assembled diff; ordinary intent is not route approval.
Freeze/push only the exact own green source; publish HEAD/tree/base, tests and
bounded source/input/raw proof with all failed phases for Warp's one read.
Fable owns canonical freeze/title/stages; Warp carry/merge/deploy and actual
predecessor composition, including17210's Node comparison on the carry tree.
1082 is first in the ordinary list.1077 source/proof stays fixed;1028 follows
only after this work and actual Links LIVE plus its correction/proof gates.
The later queue is1028→1060→1076→1091→1078→1080 under17324, with no
future piece included here.
