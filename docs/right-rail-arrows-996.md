# Right rail arrows and disclosure (996)

Base: actual release279 `dcadf50639526784964ad3260029a5bb1b6e6eab`.
Default: plain Left from a right-rail section's row, heading or inset control
uses the existing `panes.step('things','left')` feed handoff. It never first
folds the section or moves to its parent. Arriving on a heading leaves its fold.

Each heading has an independent chevron using the outline's shared glyph.
Return/Space on it toggles once; native pointer heading toggling remains.
Up/Down continue through the rail from that control. Right can still reach the
Notebook pencil before entering its pages. Saved section folds and dynamic row
identity remain the current owners'. Do not change the docked Notebook's967
arrows, the shared pane order, general arrow reach or selection/writing guards.

Start with actual279 Notebook Left/disclosure failures, then other sections.
Verify actual native keyboard movement, focus and fold state in both looks at
desktop widths. Below-browser checks cover routing/control guards, not native
gestures or layout. Keep native source/engine and complete owned-browser,
profile, fixture/PID/port cleanup evidence. Meaningful green checks freeze the
source for one independent read; Fable owns stages and Warp owns landing.

The new disclosure keeps a 44px target on coarse-pointer/narrow screens;
phone emulation checks actual taps and bounds, without a physical-device claim.
