# Scroll bars while scrolling (398, 399)

The left sidebar (398), a message in the composer (399) and every other area
show their scroll bar only while that area scrolls, and showing it never moves
or resizes the content. A platform draws its bars in one of two ways, and the
page measures which once, as it starts, with a hidden probe (`web/scrollbars.mjs`):

- Over the content (macOS with a trackpad, every phone): the bars take no room
  and already show only while scrolling. The page leaves them to the platform,
  so each area has exactly the room it had before 398/399.
- Always shown (macOS with a mouse, or Show scroll bars: Always): the bars take
  room. The page draws its own at the platform's measured width
  (`--quiet-scrollbar-size`), so every area keeps the room it had, and keeps
  their thumbs transparent at rest. A thumb shows when its area actually
  scrolls and fades after 700ms without a scroll; the fade lasts 180ms, or is
  immediate with reduced motion. Pointing at a resting area does not reveal it.

One passive, capturing document listener covers the page, nested scrollers,
and areas added by later navigation. The active colour belongs only to the
element that scrolls; nested idle areas do not inherit it. Nothing intercepts
wheel, touch, keys or native scrollbar dragging. A non-overflowing area cannot
acquire an active thumb. Page hiding clears transient timers and colours;
in-place navigation does not install another listener. The platform is read
once per page load: changing the system setting takes effect on the next load.

`tests/scrollbars_native.mjs` holds the rail, feed card, Reader source,
writing, horizontal code and page at 320, 375, 390 and 1280px:

- Overlay bars, in `native-reading` and `native-webkit-reading` ("reading
  scrollbars …"): each area's bar takes the platform's room (0) and no custom
  bar replaces the platform's, idle, while a native wheel scrolls it and
  settled, and each area is as wide and tall as with the piece's styles off.
  Narrow cases use touch to open surfaces, but scrolling is wheel input: these
  are browser-width checks, not a claim about iOS finger drags.
- Always-shown bars, in `native-scrollbars` ("scrollbars …"): Chrome started
  with `-AppleShowScrollBars Always`. Each bar keeps the platform's width (15px)
  idle, scrolling and settled, its thumb is transparent at rest, paints while
  the wheel scrolls (the scrollbar edge's pixels change) and clears, without
  scrolling the content, and a non-overflowing element never gets a thumb.
  Chrome's mobile emulation draws overlay bars, so the narrow widths here are
  narrow windows with a pointer.

WebKit's harness cannot be given always-shown bars: its web process reads only
the system setting, which a test must not change. Its always-shown path is the
same CSS as Chrome's, and no check holds it in WebKit.

Composer dimensions are separate work (400).
