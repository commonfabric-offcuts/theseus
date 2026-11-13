# Scroll bars while scrolling (398, 399)

Every area keeps native scrolling, with the same gutter width in idle, scrolling
and fading states. Its thumb
is transparent at rest, becomes visible when that area actually scrolls, and
fades after 700ms without a scroll. The fade lasts 180ms, or is immediate with
reduced motion. Moving the pointer over a resting area does not reveal its bar.

One passive, capturing document listener covers the page, nested scrollers,
and areas added by later navigation. The active colour belongs only to the
element that scrolls; nested idle areas do not inherit it. Nothing intercepts
wheel, touch, keys or native scrollbar dragging. A non-overflowing area cannot
acquire an active thumb. Page hiding clears transient timers and colours;
in-place navigation does not install another listener.

`tests/scrollbars_native.mjs`, included in `native-reading` and
`native-webkit-reading`, holds idle / scrolling / settled states on the rail,
feed card, Reader source, writing, horizontal code and page at 320, 375, 390
and 1280px. It checks native wheel movement, effective scrollbar colours and actual scrollbar-edge pixels,
unchanged geometry and scroll position when the bar fades, and a non-overflow
negative. Narrow cases use touch to open surfaces, but scrolling is wheel
input: these are browser-width checks, not a claim about iOS finger drags.

WebKit's screenshot omits the page's viewport scrollbar even when a calibration
forces a constant red thumb and blue track. The check records that calibration:
those four page cases hold native motion, resolved thumb colours and geometry,
but do not claim viewport pixel proof. All nested areas in both engines, and
the page in Chrome, require the visible edge to change back to quiet pixels.

Composer dimensions are separate work (400).
