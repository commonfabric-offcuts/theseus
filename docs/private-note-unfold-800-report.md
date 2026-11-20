# 800 Build2 on release 210

Branch `page-lane6/800-private-note-live210`, based on
`9808c5171eaeea5ab1bcd0b4bd9ec34e6d20849a`. Reuses existing piece
`p-c35f71c66ee94bfb9581b99b`. The exact frozen HEAD/tree are in its board receipt.

Kept the literal default and useful client checks from `2365bbdd`, and the
public recipient-admission repair from `a23b5c6b`. Adapted to 210's context rows,
held newest-seven boundary, quiet-agent filter and saved reply fields. Private
note flags keep actual cards whole; underlying personal folds remain recorded.
Clearing a note restores ordinary folding/filtering. A restored reply field
precedes the note corner. Opening a newer remotely added note refreshes a cached
saved-empty note only while no local writing, unsettled save or recovery needs
protection. Core and schema are unchanged.

Final checks:

- 818/818 Node checks, zero failures, from `final-cohort.tap`. Files:
  `ui_note_unfold_800`, `item800_fixture_setup`, `ui_app`, `ui_marks`,
  `ui_stack_order`, `ui_dossier_context_857`, `ui_first_message_landing_875`,
  `ui_folded_names`, `ui_note_corner_layout`, `ui_card_replies_907`,
  `ui_message_edit`, `ui_links`, and `ui_inline_wiring` (all `.test.mjs`).
- Public Core privacy/fold-retention 1/1: `test_note_unfold_800.py`, final
  Python3.9 cache `/tmp/page-lane6-800-final-core-20261120`. DELETE/FK settings,
  private bodies, per-reader flags, retained folds and fixture deletion read back.
- Chrome for Testing156 8/8: `chrome-complete/native.json`.
- WebKit26.6 8/8: `webkit-final/native.json`.

Both engines cover 320/375/390/1280px, light/dark, actual corners and every
1936 CSS-pixel target point, closed/open/earlier dossiers, keyboard fold and
touch/trackpad input with Core commit readback, native note edit/delete, live
addition/removal, exact reply draft/destination and another reader's negative.
Applied small/displaced/covered corner rules fail the actual geometry checks;
each rule is removed and exact original geometry passes again. Lower DOM checks
make no native gesture or timing claim. Phones are emulated; WebKit phone-width
swipes use native wheel input, without a physical finger-drag or Safari-app claim.

Actual failures retained under
`/Users/commonfabric/.local/share/theseus/page-lane6/evidence/800/`: baseline
fold/renderer reds, quiet-filter and reply-corner native reds, cached-empty-note
red, setup format/admission incompatibilities and native input failures. The
laptop input trace showed a dossier gap while saved reply fields were loading;
checks now wait for all five exact fields, keep the native wheel-target assertion,
and require the actual Core fold commit. The WebKit other-reader row press is
preceded by native focus, with a check that focus itself leaves it folded.
No behavioral assertion was replaced with a handler invocation or source regex.

The two native runners' existing malformed spread token is repaired. The app
fixture supplies the current rail's CSS style methods. The HTTP fixture only
adds optional forwarding of the public `divergence_reason` field; 800 explicitly
supplies its new-dossier/reply reasons. These are test repairs, without product
admission bypasses. The earlier Build1 0/8 recipient-setup failure remains at
`fable-tools/checks/800-note10030/evidence`; it was never native acceptance.
The known release188 Item783 failure remains unwaived; these filtered native
commands did not run Item783.

Both final browsers closed through their owned close APIs, fixture EOF exited0
with empty stderr, captured owned PIDs are absent, scratch ports are closed and
the Chrome profile is removed (`final-cleanup.json`). Product source digests are
retained in `product-source-digests.json`; raw screenshots, observations and
failure logs remain alongside the final records. No live records, runtime,
installation, stage, carry or deployment changed.
