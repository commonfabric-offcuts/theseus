# Images keep their keyboard outline (1030)

Core8 owns p-de6e208df33d499cb09ec5b3 on
core-lane8/1030-images-grid-308, base308
46d4de292c663a2dee710394d0ab0b596ec5b128. Fable15445 binds the work;
Warp15534 confirms the bounded CSS scope after the actual native red.
The contract preceded product edits.

From the feed, Right enters the retained thumbnail tile. Consecutive Rights
move the actual image focus and leave an outline visible around the chosen
picture. The image remains the Return/new-tab owner; menu/Escape, selection,
Left/Up/Down, roving state and route lifecycle keep their existing owners.
On a phone, an open rail covers the feed, so its grid keys are tested directly.

The defect is paint clipping:1007 moves from the tile A to its IMG, whose
2px outline with2px offset lies entirely outside the enclosing tile's
hidden overflow. Focus and the grid capture listener work; the ring vanishes.
The fix draws the keyboard ring on the tile when its image is focus-visible.
No JavaScript, Core, schema, media, route or manual-state owner changes.

Existing1007 row-edge behavior stays: Right holds at the visual row end;
Left at the first column returns to feed; Up from the first row reaches the
heading; Down after the final row continues to the next normal rail row.
Warp15458's conditional short-row hypothesis did not reproduce a routing
defect;15534 accepts the clipped-ring repair. Wider Safari rail cursoring is
separate1034/Page6, and Dim is later1033. No source change for1016.

Native checks assert actual picture identity plus outline-band area remaining
after viewport/ancestor overflow clipping. A computed outline alone is
insufficient. Screenshots retain entry/continued-key state. Preserve the
actual pristine308 failures, initial computed-only passing controls and
fixture setup failures separately. The accepted repair must survive actual
rule removal/caught failure/byte-exact restoration, both looks/themes at
1280/390 in Chrome for Testing and installed WebKit, short2/3-picture rows,
menu/opening/row controls and route/dock-close probes. Record exact served
hashes and full owned browser/profile/fixture/port cleanup. Phone emulation
and installed WebKit are not physical-device or Safari-application proof.
