# Dim switch width (980)

Intake contract before product changes, own base252/3d8756b464971dd16b064591e4d6693564768fd5.
976 approved14335 remains frozen in its separate tree and will be carried after957.

Tony14299 in Releases asks that the Dim0|1|2 control match the one directly
below it; his attached frame shows Quiet|Vivid below it. Item980 also names
Bookends|Paper. Read all footer owners: RailDimming.mount, rail-density.mjs,
look.mjs, rails.css, rail-dense.css and look.css. No product edits yet.

The three numeric segments must share the chosen width evenly. Existing0/1/2,
Bookends/Paper, Quiet/Vivid and Compact/Roomy behavior remains the same. Other
footer positions and touch targets must not move or shrink. No Core/storage
or stylesheet-loading behavior changes. Determine the exact target from actual
native geometry before code; if the two named existing widths disagree, ask
Warp for the intended target with Tony's frame and measured values.

Use isolated headless Chrome for Testing and a scratch fixture; native geometry
red first across both looks, light/dark, Compact/Roomy. Retain footer geometry
and segment widths as the before control. After the target is clear, implement
the narrow owner change, run meaningful width/behavior/native controls and
freeze with HEAD/tree/base for Warp. Coordinator owns piece/stages. Browser.close,
owned PID/profile cleanup and fixture EOF0/PID/port checks are required.

Actual Chrome252 geometry (Bookends selected; repeated in light/dark):

| Control | Compact width | Roomy width |
|---|---:|---:|
| Dim |58.578125px|100.6875px|
| Bookends/Paper |117.140625px|117.140625px|
| Quiet/Vivid |88.65625px|88.65625px|

All eight geometry cells fail; all eight native switch-behavior controls pass.
The numeric segments are also unequal. Raw red252/results.json and snapshots
retain the complete before footer geometry. No product change, freeze or push.
Target clarification is needed because matching both existing widths requires
resizing another control, while Tony's image names the one directly below.

Warp14350 resolves the target before code: Dim follows Quiet/Vivid exactly,
three equal numeric segments; Bookends/Paper and everything else unchanged.
Publish the actual Quiet/Vivid border-box width as a shared CSS variable in
look.mjs, refresh on its ResizeObserver and mount, and consume it only for
the fine-pointer desktop Dim grid. No copied pixel width. Hidden phone look
switches publish no zero width; phone/coarse targets retain their existing size.

Paper selection makes Bookends/Paper116.40625px in Chrome; Quiet/Vivid stays
88.65625px. WebKit’s corresponding Quiet/Vivid width is88.625px. The product
copies none of these numbers: it follows the actual source control.

Final evidence: owner cohort50/50; native Chrome25/25 and WebKit25/25.
Eight geometry cases per engine cover Bookends/Paper × light/dark ×
Compact/Roomy. Each removes the actual new stylesheet rule, observes the
original width mismatch, restores the rule and checks all other absolute
footer boxes unchanged. Eight behavior controls exercise all switches; eight
resize/restore/navigation controls make the real source switch wider, verify
Dim follows it and restores, then navigate and use the recreated Dim control.
One390px touch case preserves all44px targets and native tap selection.
This is desktop-engine phone-width evidence, not a physical-device claim.

The original Chrome run has8geometry failures/8behavior passes. Pristine252
WebKit has8geometry failures/9behavior/touch passes. Two early WebKit candidate
runs retained a14.078125px translation of the whole footer while the outline
owner’s provisional row was settling. Final checks finish that actual owner's
read, and use actual CSS removal/restoration in the same page. All absolute
x/y/width/height assertions remain; only Dim's intended width changes. These
failed harness phases are retained, not counted as green or waived.

Commands (AIM_PLAYWRIGHT_CORE points to the installed driver; Chromium also
uses AIM_CHROME, and AIM_ENGINE=webkit selects WebKit):

```
node --test tests/ui_rail_dimming_973.test.mjs tests/ui_rail_density_935.test.mjs tests/ui_color_choice.test.mjs tests/ui_author_colors.test.mjs
node tests/dim_switch_width_980_native.mjs EVIDENCE_DIRECTORY
```

AIM_980_BASELINE=1 skips candidate-only rule removal and dynamic following on
an untouched source. Raw evidence is outside the repo in
`/Users/commonfabric/aim-worktrees/core-lane7-980-evidence`:
red252, webkit-red252, owner.tap, chrome-final2 and webkit-final3. Both final
runs verify Browser.close, all observed owned PIDs/profiles absent, fixture
EOF/exit0/PID absent and port closed. No live data, browser or installed-tool
change. Fable owns Build p-31414ca75b5c4ddaa777ace0; Warp carries after957.
