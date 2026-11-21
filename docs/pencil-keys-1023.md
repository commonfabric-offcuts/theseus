# Pencil keys and mode pills (1023)

Assigned by Warp15320; bound by Fable15331. Base is live306,
`5ccd5432284200e823c123c5689383d13f1c8fb7`. Core7 owns this slice;
Page5's 1022 touch guard is in `compose-bar.mjs` and remains separate.

Option-N opens the modal pencil in Note mode; Option-M opens it in Message
mode. Either switches the existing pencil while preserving exact writing,
selection, destination and the selected Notebook page where applicable.
Use physical Alt+KeyN/KeyM, including native Dead/micro key spellings.
Recognized shortcuts in pencil-owned text must not insert their characters
when a mode change is held by busy, admission or dialog guards. Those guards
still prevent the change; unrelated dialogs/controls keep their own keys.

After a click leaves focus on either Note/Message pill, Return and
Command-Return invoke the existing composer Send once. They preserve its
empty/read-only/busy/submission/recovery/authority guards. Default: Return
inside text remains a newline; Command-Return inside text keeps existing
Send behavior. Repeat and composition must not publish extra submissions.
Mode-pill arrows and Space retain their existing selection semantics.

The product change stays in `pencil-keys.mjs`, whose document capture handler
can recognize the existing mode-pill nodes without editing `inline-composer.mjs`.
The broader possible pill-block edit was announced in Landing before work;
the resulting repair needs no edit in that other file.
Keys legend and guide name the resulting behavior. No Core, schema, runtime,
touch-Send, receipt, draft, recovery or publication-owner changes are planned.

Retain actual failing checks against unmodified live306 product bytes for
the three requested cases before editing product. Add small real-owner Node
controls for guarded paths and native isolated Chrome/WebKit keyboard/click
checks with exact Core publication/readback, both looks and appearances.
Compare only the affected importer cohorts against the same base and retain
full failure diagnostics. Preserve actual failed phases and all served-source
hashes. Verify Browser.close, observed owned PIDs gone, profile removal,
fixture EOF/exit0/absence and ports closed. No Tony browser or live test data.

Tony's exact physical text-field trigger is still being clarified by Warp;
do not claim that automated input proves his physical keyboard's behavior.
Freeze when meaningful checks are green, push only this exact branch, and
return HEAD/tree, tests, pass/fail and material limits for Warp's one read.
Fable records stages/freezes; Warp owns carry/landing. Ordinary classification
is re-derived from the actual frozen diff.
