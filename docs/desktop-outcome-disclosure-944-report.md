# 944 verification

Base: release220, `73d3c2b34da8b6d69e1d541833ebd7be88cee189`.
The final fetch of `release/live73` returned that same source.

Desktop outcome names already opened the outcome home independently of the
chevron. The defect was in arrival: `ready()` saved an open choice and
`isOpen()` supplied an automatic current-outcome default. Desktop arrival now
reads the existing choices without writing one and uses the saved default.
This read retains921's merge with another tab. Phone arrival keeps its
existing open-current rule at the760px boundary. Only
`web/outline-rail.mjs` changes product behavior.

Desktop outcomes without a saved choice start folded. Explicit choices,
open-all/fold-all defaults and temporary New/Waiting filters retain their
existing owner and record. A browser shares the same choice record when its
viewport changes; there is no separate desktop preference or migration.

## Retained failures

Evidence is under
`/Users/commonfabric/.local/share/theseus/page-lane6/evidence/944/`.

- `chrome-red-route/native.json`: a real desktop outline name click on the
  unchanged220 product navigated, then failed because the collapsed outcome
  became expanded (`true !== false`). The earlier `chrome-red` attempt waited
  for an obsolete Conversation route and is retained as a harness failure.
- `node-initial.tap`: four assertions still required automatic desktop
  opening. They now explicitly test the retained phone rule or944's manual
  desktop rule; reader/instance isolation still writes three independent
  manual records and cross-tab merge assertions remain.
- `node-cohort.tap`:117 passed and one failed because844's partial document
  fixture lacked `defaultView.matchMedia`. The fixture now provides its
  desktop media state; its original topic-loading assertions are unchanged.
- `mutation-verdict.json` and `chrome-mutation/native.json`: the applied
  mutation restored automatic desktop opening and failed the actual native
  collapsed-choice assertion. Exact original bytes were restored, SHA256
  `b30f0129b92d270e4fb9df9683b679b8758a3168e952e096a764e8b4f022bea6`.
  `chrome-restored/native.json` then passed1/1.

## Final checks

- `node-final.tap`:118/118 across `ui_outline_disclosure_902`,
  `ui_outline_order`, `ui_topic_rail`, `ui_rails`, `ui_outline_stars`,
  `ui_rail_drawer`, `ui_outcome_navigation_901` and `ui_rail_density_935`.
- `chrome-final/native.json`:12/12. `webkit-final/native.json`:12/12.
  Four new944 cases cover desktop/phone in both themes; eight retained654
  cases cover320/375/390px phone widths and laptop in both themes.
- New944 native input verifies the outcome destination, exact desktop
  localStorage bytes, another outcome's open choice, reload into a new
  document, explicit chevrons, child-topic arrival and navigation away/back.
  Phone first tap still expands without navigation or drawer close; second
  tap opens the outcome. The older654 test titles retain their historical
  Conversation wording, but destination assertions now use the current
  outcome-home link (`?workspace=…`), as the product already does on220.
- `final-source-check.json`: all60 Chrome,79 WebKit and60 restored-control
  captured source hashes match the final files. These include the new native
  module and product owner. Browser.close/API close, fixture EOF exit0,
  empty fixture errors, observed owned PID absence, absent Chrome profile
  processes and closed fixture ports are recorded in each cleanup JSON.

These are isolated desktop engines with emulated phone touch and CSS widths.
WebKit is not physical iOS Safari; it retains device scale1. No physical phone
claim, timing claim, Core change or live-record test is made. The known188
Item783 failure remains failed evidence outside944; it was neither rerun nor
waived by these checks.
