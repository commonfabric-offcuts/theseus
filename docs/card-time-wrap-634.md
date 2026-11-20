# A plain card's time and star share a line (634)

At 320px, a plain card with the wide time `12:34 AM` must not wrap its
hidden star onto an otherwise empty author line. The star still reserves
its place: revealing it by selecting the card must not move the time or
put a new control under the selecting finger. This extends the existing
marked-card layout to plain cards, with a reserved glyph and gap measured
in the author line's own font size. The reported plain card's author and
full wide timestamp still fit on one line, without changing star behavior.

The existing `card_marks_native.mjs` check will use a fixed wide formatted
time instead of the wall clock. Its same cases also draw `1:11 AM` as a
short-time control. On unchanged release 220, first demonstrate the 320px
wide-time failure in Chromium and WebKit, light and dark. At 390px and
desktop widths the plain author line stays on one line; at 320px the short
time stays on one line. Existing named marks, per-reader privacy, the
star's position and horizontal bounds remain checked. Select the actual
plain card with touch on phones and mouse on desktop, checking that the
star appears without moving the author/time boxes.

Scope: the existing author-line CSS and its native browser check. No
Core, schema, message markup, dossier header, copying, or writing change.
Use isolated fixture records and owned browsers; close through
`browser.close()` and retain cleanup evidence for each run.

## Verification on 20 November 2026

Base: release 220, `73d3c2b34da8b6d69e1d541833ebd7be88cee189`.
The only product change is two author-line selectors and their reserved
space in `web/aim.css`. The star uses one author-font em plus a 0.2em gap,
including plain cards; its existing touch area and interaction remain.

- Unchanged-product baseline: 12/16 cases pass; four 320px wide-time cases
  fail in Chromium/WebKit, light/dark. The hidden star alone creates about
  21px below the visible author/time. The fixed `1:11 AM` control stays on
  one line; 375/390/1280 wide controls pass.
- Final source: 16/16 pass (8 Chromium, 8 WebKit) at 320/375/390/1280,
  light/dark. The entire plain author and wide timestamp stay on one line,
  as do the short-time controls. Named marks and per-reader omissions,
  line bounds and no horizontal overflow remain checked. Actual touch on
  phone viewports and mouse on desktop reveal the star without shifting
  the author/time, then star and unstar the correct message with committed
  Core receipts and the corresponding drawn state.
- Applied final mutation restores the old marked-card-only selectors;
  all four 320px cases fail. The exact CSS bytes are restored and all
  16 cases pass. `634-final-css-mutation.json` records both source hashes.
- Screenshots were inspected in light Chromium and dark WebKit. Final
  plain cards have one complete author/time line, without a spare row.
- Each invocation closes browsers through their API and ends the fixture
  with EOF. Logs retain launched browser PIDs; checks confirm those PIDs,
  the observed Chromium profile processes and fixture PID are absent,
  fixture exit is 0 with empty stderr, and its origin port is closed.
- `git diff --check` passes. No broad browser-suite, physical-device,
  writing-recovery or Core-change claim is made.

The initial fixture refused a synthetic root without its divergence reason
before launching a browser. The harness now supplies explicit fixture
reasons for roots/replies. The next run found that page-wide accessible
mark counts also included dossier-header marks; counts now target the card
author lines whose marks this case measures. It also showed that the old
historical `12:15 AM` control wraps on 220, so the negative uses the shorter
`1:11 AM`. Those diagnostics are retained separately from the four clean
baseline reds. A first CSS candidate passed the old empty-line assertion
but visual review caught `AM` wrapping alone: the final font-relative
reservation and stronger whole-line assertion fix that as well. Its first
mutation/restored run remains historical evidence, not the final verdict.

Reproduce the focused native cohort:

```sh
AIM_PLAYWRIGHT_CORE=/absolute/playwright-core \
  node tests/card_marks_native.mjs /absolute/chrome-for-testing \
  /fresh/absolute/evidence 'marks at'
```

Local artifacts are in
`/Users/commonfabric/.local/share/theseus/auditor/evidence/` under
`634-native-red`, `634-native-red2`, `634-native-red3`, `634-native-green`,
`634-native-mutant`, `634-native-restored`, `634-native-compact`,
`634-native-compact-mutant` and `634-native-final`. Each holds its exact
invocation, log, results and cleanup verification. The last directory is
the final verdict; `634-final-css-mutation.json` is the final mutation record.
