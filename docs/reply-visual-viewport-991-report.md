# 991 verification

Base275: `712e21e0970fb3982a447a091fc25315e2b4032f`.
Product change is confined to `web/compose-bar.mjs`, its existing persistent
keyboard owner. It waits for layout after changed phone viewport bounds,
then reads the current focused writing field and its visible footer/act.
The nearest scrolling ancestor moves; a fixed ancestor prevents scrolling a
dialog's background. Gap is8 CSS pixels or the larger scroll-padding-bottom.
Second shrink, visual pan and typing growth can re-settle; an unchanged
viewport scroll does not pull writing back. Normal opening reveal and975's
fit/ResizeObserver owner remain. No CSS, draft/send, Core or schema change.

## Actual red and green

- New geometry/lifecycle controls against unchanged275:12 total,3 pass,
  9 fail. They exercise the actual module's persistent reader with bounded
  event/geometry ports; these are not native keyboard/phone evidence.
- Native unchanged275 at390px:one real card-reply failure and one pencil
  control pass. VisualViewport height really changes844→430. The old card
  field ends at429.609px but its footer/act ends at473.609px, beneath the
  observed430px bottom. Field and act are separate rows.
- Final focused owner checks32/32:16 new viewport cases,975's nine and838's
  seven. Delayed live-field geometry, second shrink, same-height offset pan,
  typing growth, internal scroller, blur/disconnect/hidden/readonly/disabled,
  coalescing, orientation reset, full-height restoration, unrelated input,
  already visible and unchanged-desktop/ordinary-scroll negatives.
- Actual applied footer-removal mutation fails five of16 checks (11 pass).
  Exact restoration passes25/25, followed by32/32 with the838 integration.
- Actual chromium156.0.8078.47 **16/16**, actual webkit26.6 **16/16**. Twelve
  390px card/pencil/topic-foot cells cross both looks and themes; two full
  Reader controls and two unchanged-laptop controls. Each phone cell checks
  real visualViewport844→430→350, further native typing, field/footer bounds,
  focus, exact writing and selection. No target scrolling by the harness
  after shrink. Both engines assert the exact served module bytes.
- Both native results and restored source have SHA256
  `60b7daf6846de3f75da1c15ae88f9d0f0483122591412475d25add3f27bbbbe2`.
- Final affected12-file cohort667/657pass/10fail versus pristine275's
  651/641pass/10fail. Failed names and full diagnostics match with only source
  root and duration normalized. None is skipped or waived. Exact file list,
  command/exit, raw TAP and comparison are retained.

The old838 test extracted the private tracker without its new helper/phone/
frame dependencies; its first candidate run failed on that stand-in. It now
loads the actual module through shared geometry ports and checks delayed
field-plus-act settling. Its ordinary-scroll assertion is retained. The
initial11-failure cohort and corrected10-failure cohort remain as evidence.
No unrelated test assertion changed.

## Evidence and practical limit

Evidence: `/Users/commonfabric/aim-worktrees/core-lane7-991-evidence`:
`owner-red275.tap`, `chrome-red275`, `owner-final.tap`, `footer-mutant.tap`,
`footer-restoration.json`, `chrome-candidate`, `webkit-candidate`,
`cohort-baseline275.tap`, `cohort-final.tap`, `cohort-comparison.json` and
`cohort-final-command.json`. Inspected Bookends/dark card reply and
Paper/light pencil screenshots show the act above the observed bottom.

Every native run verified Browser.close, all observed owned PIDs/profile
absence and profile removal, fixture EOF/exit0/PID absence and closed port.
No workload remains. All launches read uptime under12 on18 cores.

These are desktop engines with mobile viewport/touch settings, not a physical
iOS Safari or Android Chrome keyboard. The native resize changes layout and
visual viewport height; the API is not replaced or synthetically resized.
Layout-height-unchanged geometry and same-height visual pan have lower-layer
ports, not native device proof. Tony's same-phone reply after landing is the
dependable acceptance check explicitly assigned to Warp in14573/14581.
