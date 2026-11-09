# How Theseus answers the pointer, keys and taps

One short page of the rules every screen follows. The page itself is in the
app: press ? anywhere outside writing, or the small "? Pointer, keys and taps"
under who you are at the top of the side rail, which on a phone "☰ Topics"
opens (`web/interaction-guide.mjs`, the same words). Each rule there names
the pointer's way, the keys' and the phone's.

## The topic page

- **The light.** The message under the pointer lights, as a passage lights in
  the Reader, and a bar sits over its top corner: 👍, ✅ and 🚫 when it asks you
  for a go-ahead, Reply, and ⋯, the message's menu (Copy Link, Mark read or
  unread; docs/links.md), which a right-click on the message also opens. The
  bar is only as wide as its buttons, and never covers the reply arrow beside
  the card's time (docs/topic-reading.md): where it would, it sits above that
  line, or below it at the window's top. ↑ and ↓
  move the light; Tab onto a message lights it, and Tab again goes through
  its bar's buttons, ⋯ last, then on from the message (Shift-Tab from the
  bar's first button comes back to it). A click on a lit message opens
  it in the Reader. On a phone a tap lights a message and shows its bar, a
  second tap opens it, and a tap anywhere but a message, its bar or a pop-up lets the
  light go; scrolling keeps it. The bar stays inside the window while any of
  its message is on screen and scrolls away with it. Where a finger presses,
  each of its buttons, and each item of the ⋯ menu, is at least 44px. (`web/message-menu.mjs`)
- **Return**, or **Reply** on the bar (a phone's way), opens the Reader on the
  lit message with the cursor in the reply and nothing quoted; to quote part of
  it, select that part in the Reader and press Return. Return in writing, on a
  folded line or on another control does what it does there.
- **A cut-off message** (the first 1,024 bytes are shown) reads on in place:
  once the pointer rests on it, the keys light it or a finger taps it, its words
  become a box of the same height that scrolls under the wheel, trackpad or a
  finger, and not the page. Where a finger scrolls, the excerpt is never taller
  than 60% of the window, so a drag outside the lit message still scrolls the
  page. (`web/card-scroll.mjs`)
- **👍** means read and understood, never "do it"; pressing it again takes it
  back. The count on a message names who: on hover, or where nothing hovers (a
  phone), on the lit message, whose count then reads the names. A press on the
  count thumbs up; a tap on it on a phone lights the message and names who, and
  the bar's 👍 thumbs up. In the Reader 👍 sits beside Send. **✅ and 🚫**
  answer an agent's go-ahead ask in one tap or click, on the message or its
  bar, and the agent hears it as a reply (docs/thumbs.md).

## Writing

- **Images.** Paste, Add image, Paste image when the browser can tell the
  clipboard holds one, and `#img` to pick one of the topic's recent images
  from a short list (↑ ↓ and Return, or a tap). On an iPhone or iPad, press and
  hold in the writing and tap Paste. (docs/images.md)
- **⌥↑ and ⌥↓** move the line, list item or paragraph the cursor is on, or
  those selected, above or below its neighbour; ⌘Z puts it back. Where nothing
  can move the keys do what they normally do. A list item carries the lines
  indented under it and moves only past an item at its own depth; a plain line
  moves within its paragraph; a paragraph that is wholly the cursor's moves
  past the next one. A phone's keyboard has no such key. (`web/line-move.mjs`)
- **The saving sign** says when the writing was last saved: "Saved to Theseus ·
  4:40 AM", or the time it was kept on this device (docs/times.md).

## Everywhere

- **Escape**, or ✕, closes the open pop-up and keeps the writing; a click or tap
  outside a pop-up closes it too (`web/dismiss.mjs`, docs/links.md).
- **?** opens this guide.

Each rule will name the check that holds it once the checks for the message
menu are written.
