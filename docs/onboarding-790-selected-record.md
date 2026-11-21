# Item 790 selected paste record correction — SPEC

Written in full before implementation changes in the fresh owned
`codex-790-selected10037` checkout, under Warp10037 and auditor10036. Exact
starting source: d6275288154f3a04fd89449e220e651846dcf274; tree
fd618ebcea8528dcfbd52e34da1f1d3f9eb90994; sole ordered parent
eda1c5360ab6172cbca9aa5261f2ff911edb7138. Starting index/worktree clean.
Read whole AGENTS.md, docs/VISION.md, docs/experience-guidelines.md,
CURRENT-BRIEF-RULES.txt, checks/790-paste9912 REPORT.md and SPEC.md,
its local/mutation receipts and safe native receipts, original build9837
REPORT/SPEC, and coordinator-20261117/790-ROOT10005.json. Original raw
artifacts and source captures stay at their original paths, verified by
explicit manifests and byte hashes; credential-bearing request diagnostics
are never decoded or reproduced.

## Defect and exact scope

The real Chromium fixture control in tests/onboarding_790_native.mjs probes
raw Meta+V and the explicit native paste editing command. It selects raw if
raw.exact, else command if command.exact, else refuses. The actual assertion
currently always receives command. Raw-only success therefore selects raw
but fails before the six product cases. Command-only and both-success reach
the product cases; neither-success must continue refusing.

Change only the control assertion argument to the actually selected record:
raw when raw.exact, otherwise command. Keep the selection priority, refusal,
stopReason, observations and native dispatch unchanged. Do not extract a
parallel selection implementation or alter product behavior. No Core, web,
permission, schema, native input, clipboard equality or geometry changes.
The only other tracked changes are focused controls and this contract.
No feature extension, neighboring-state gate or product source mutant.

## Below-browser controls and meaningful red

Extend tests/clipboard_790_diagnostics.test.mjs. Execute the real exported
onboardingChecks790 control body with an isolated fake page; use its actual
probePaste790, nativePaste790, assertPaste790, comparison observation and
stopReason. Supply deterministic native-route outcomes at the driver edge,
never a second implementation of selection. Verify actual raw-only success,
command-only success, both-success/raw priority and neither-success refusal.
For successful controls, register all six original product cases and execute
the laptop first-copy body against the fake driver to observe both product
probe routes. Other product bodies remain unexecuted in these controls.
This establishes instrumentation behavior, never native clipboard proof.

Require malformed selected-record trusted phases to refuse even when text
matches; a malformed unselected command record must not reject valid raw.
This makes assertion removal, wrong record and incorrect raw preference
observable through the real path. Retain existing exact clipboard readback,
same-length wrong pasted text, privacy/no-text diagnostics, read refusal,
input command/phase and literal Chromium7/WebKit6 enumeration controls.
Run focused Node checks only, serial --test-concurrency=1, one local test
process at a time. No Python workload is necessary. Existing named measured
viewportTolerance790Px=1 and fractional 0.75px control stay unchanged and
continue rejecting the actual inherited +2px mutant. No weakening.

First run the new controls against the supplied defective source to retain
the meaningful red. Then apply the one-argument correction and pass focused
controls. Apply an actual wrong-record source mutant restoring unconditional
assertPaste790(command); assert a unique replacement and changed bytes,
run controls and require raw-only failure at the real assertion. Restore
exact corrected bytes in finally and require the full focused control to
pass. Retain original, corrected, mutant and restored complete module bytes,
SHA256, exact commands, exit codes and raw logs. Do not reinterpret expected
mutant failures as unexplained product failures. Run Node syntax and Git
whitespace checks. Preserve all preexisting evidence unchanged.

## Historical diagnostic and limits

Original Chromium run44419300541 at eda1c536:2/6, four paste timeouts.
Original WebKit run44420132317 at eda1c536:6/6, six native paste assertions.
Corrected Chromium run44427775073 at d6275288:7/7, including fixture contrast
and eight product paste assertions. These historical totals and every raw
result/source capture remain immutable. They are not native results for
this new source. This seat makes ZERO native starts.

The d6275288 fixture contrast observed raw p.key('v',4) trusted keydown/up
without paste/input, empty pasted text and exact=false despite exact browser
clipboard readback. Chromium Input.dispatchKeyEvent rawKeyDown with
commands:['paste'] followed by keyUp observed trusted paste/beforeinput/input
insertFromPaste and exact=true. No text goes into the native dispatch.
Its expected/readback/native pasted fixture SHA256 was
87696096f15f2a6a29b950fd5e715c35c13483964ab75f986a137bd66cf6ce88,
62 JavaScript UTF-16 units. Product strings are compared exactly in memory;
UTF-8 hashes only document diagnostics. WebKit retains raw input unchanged.
The prior report's intended raw fallback was not covered by actual raw-only
success; this correction fixes that classified instrument defect.

Original Chromium did not capture actual clipboard readback/pasted text;
its four failures cannot gain that missing evidence retroactively. Claude
first-copy branches were unreachable after Codex failure at both widths.
Original WebKit proves both first-copy variants and Codex retry; no Claude
current-retry proof is claimed. The later Chromium7/7 did execute all eight
variant/stage clipboard branches. No physical-phone or preview approval is
claimed. The inherited native source index omits onboarding_790_native.mjs,
clipboard_790_diagnostics.mjs, onboarding_790_expressions.mjs,
aim_next/onboarding.py and web/onboarding.mjs. Exact historical clean snapshot,
wrapper, local tracked-source manifest and binary diffs supply provenance;
no omitted native source-copy capture is invented. Original unsafe request
objects stay only in original raw artifacts; safe summaries exclude them.

## Freeze and independent return

Freeze one clean commit after correction and focused controls. Packet under
checks/790-selected10037 includes complete SPEC/REPORT, clean head/tree and
ordered parents, full-index binary diff from d6275288, every tracked path's
Git blob plus SHA256/size bound to matching worktree bytes, product byte
comparison for every tracked web/ and aim_next/ path, actual command/results,
original/mutant/restored source bytes, logs and evidence hashes. Verify all
94 original artifact entries, 282 corrected-Chromium artifact/source entries
and 18 prior local evidence entries unchanged, without recursive searching.
Use explicitly named manifests and Git tracked-file enumeration only.
Preserve untracked work. Freeze packet files once written; final separate
manifest hashes them without self-reference. No edits to historical packets.

Whole-piece ledger: THREE actual starts, ZERO allocated, FIFTEEN unallocated
of eighteen. POOL.json checks=[]; no request or dispatch. No native rerun,
local browser/server, whole suite, direct runner, delegation, process signal,
board/stage/flight write, push/PR/merge/deploy/install, live/foreign tree/store,
profile/key/env/session/credential access. This builder returns the correction
for independent read with no approval claim. Coordinator owns later actual-live
judged-first composition, including permission/read boundary judgment first;
that authorized later composition is outside this correction.
