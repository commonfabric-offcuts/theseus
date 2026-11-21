# Card-start Tab verification (966)

Base: release266, `fd6a3f74456bb4e0aef327201925548af10ea4a2`.
Product change: `DeckPage.key` intercepts Tab/Shift-Tab at a collapsed zero
caret before the shared line indentation rule and reuses `moveWriting`.
The current help and keyboard contract describe the distinction. No new
persistence, pane routing, arrow, selection painter, Core or schema owner.

## Checks

- New handler checks on unchanged266:34 total,25 pass,9 fail. Candidate
  checks plus existing866:75/75; final nine-file affected cohort:162/162.
- Actual applied mutation removes the selection-end-zero guard:33/34 pass,
  selected-from-zero line behavior fails. Exact restore passes75/75. Restored
  module SHA256 is `573ec308da1b1d8fd7ca498182be98002863de1115c2d58c092274c0ea1d90e6`.
- Final native baseline against untouched266:3 failures (fresh/saved card
  indentation and first-card boundary),1 nonzero-line control passes.
- Final candidate:actual chromium156.0.8078.47 **31/31**, actual webkit26.6
  **31/31**. Full page, outcome-owned modal sheet and topic-owned dock in
  Bookends/Paper and light/dark combinations; native Command-Return/Tab,
  saved cards with children, caret/focus, Shift-Tab, save/reopen, card Undo,
  line and selection controls. One390px desktop hardware-keyboard case.
- The harness asserts actual browser type, served module bytes against the
  owned source, look and colour scheme. Every final result records the same
  module hash as the restored source above. Baseline hash:
  `d52b3813f306aedcfafef7f70e2a5980aeed0032292b46db384a328db0a5bc7d`.
- Final Browser.close, all observed owned PIDs/profile absence, scratch
  fixture EOF/exit0/PID absence and closed port are recorded for both engines.
  Earlier runs also verified cleanup. No workload remains.

Evidence root on this builder:
`/Users/commonfabric/aim-worktrees/core-lane7-966-evidence`.
Meaningful final files/directories: `owner-red.tap`, `selection-mutant.tap`,
`selection-restoration.json`, `owner-restored.tap`, `owner-cohort.tap`,
`chrome-red266-final3`, `chrome-final2`, `webkit-final2`.

## Retained diagnostics and limits

Initial native setup assumed Meta-Home moved the textarea caret on this Mac;
Select All then Left/Right now uses actual native selection. An invalid
sheet URL, old message-sheet selectors/controls, and outcome ownership in a
dock fixture each failed before the relevant gestures. These runs remain in
`chrome-red266`, `chrome-candidate`, `chrome-candidate2`, `chrome-final` and
`chrome-dock-probe`; the corrected sheet/dock probes pass10/10 each.
The route correctly follows a page's actual owner: a topic-owned page is
needed for a dock beside that topic's feed. The final harness uses current
Notebook dialog/menu and card gestures; no product routing change was needed.

The first WebKit run (`webkit-final`) recorded one `/api/view` access-control
error. It propagated to four case results after their card assertions;27
cases passed. The identical assertions passed31/31 on the unchanged rerun
(`webkit-final2`). The earlier error and cleanup record are retained; no
error filter, skipped case or weakened assertion was added.

Read-only, IME229, handled/foreign events and modifier negatives are handler
evidence.390px checks are desktop-engine hardware keyboard behavior, not a
physical phone or soft keyboard. No post-deploy/live verification is claimed.
