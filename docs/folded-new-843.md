# Session-new labels when folding a dossier (843)

Tony's report at 11339 shows each between-others row with its red `new`
label outside the row, underneath the next overlapping sheet. The label
belongs inside the row's button. It must retain space while the excerpt
ellipsizes, on both narrow and wide pages. Ordinary folded and earlier rows
also retain the label inside their own line; the dossier's tab keeps its
existing New control.

An explicit collapse with the dossier chevron handles the loaded messages
in that dossier and clears their session-new marks. Expansion preserves
marks. Other dossiers retain theirs, and Undo restores the open/closed view
without resurrecting handled arrival marks. Later arrivals may become new.
Stored unread facts, marks, stars, folds and writing are unchanged.

This is a page-only follow-up to 833. Checks exercise the real app painting
and chevron handler below the browser. CSS assertions establish the layout
rules, not native rendering or touch behavior. No browser, full suite or CI
is part of this change.

## Verification

Base: verified release 131, `de8bea59a87994d94abc58f18ab882310ad35033`.
The automatic carry from 130 required no hand edit. The four 843 checks
pass. On unmodified 130, three fail on the reported behaviors and the
ordinary folded/earlier-row regression already passes. Five applied source
mutations (badge outside row, head-only clearing, clearing on expansion,
block row layout and shrinking badge) each fail the relevant assertion;
each restored control passes all four checks. They were rerun on 131.

The comparison runs the same nine existing families on 131 and the
candidate, adding `ui_folded_new_843.test.mjs` on the candidate:
`ui_visit_new`, `ui_dossier_new_781`, `ui_inline_wiring`, `ui_stack_order`,
`ui_stack_position`, `ui_folded_names`, `ui_folded_sender`,
`ui_coordination_stacks`, and `ui_cover_refresh` (all `.test.mjs`).
Base: 292 pass / 4 fail; candidate: 296 pass / the same 4 fail; zero skips.
These are not all-green totals. The four pre-existing failures are:

- 781 header-count test: its fixture omits `stack.dossier`, so the renderer
  treats its head as a reply-headed dossier and has no `.stack-new` node.
- 781 head-New/stale test: expects one focus call but the current source
  performs three focus calls to that same message in its reveal path.
- Two 645 arranged/line-only regression tests: the small DOM fixture rejects
  the current tools selector `[data-tool=menu]` before their assertions run.

Warp 11402 explicitly leaves these four outside 843. Their source and tests
are unchanged; the raw base and candidate evidence names each failure.
Evidence is under the auditor's local `evidence/843-*` artifacts: base and
candidate TAP, original red and restored green TAP, mutation script and
`843-mutations.json`. CSS contracts and DOM structure are checked; native
layout and phone gestures remain for Tony's live confirmation.
