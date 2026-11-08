# Links in messages, and clicking outside a pop-up

## Links in a message's words

Every surface that shows a message's or a Notebook page's words shows its web
addresses as links: the topic page's message cards and the line a reply quotes,
a folded message's line, Notebook cards, the Reader's source text, a Notebook
page opened on an outcome's page, the messages sent to the person by name, and
the message a new topic answers. `web/links.mjs` draws them.

- Only an `http://` or `https://` address becomes a link. The words are drawn
  as text nodes and anchors, never as markup.
- An address ends at a space, an angle bracket, a quote mark or an ellipsis.
  Sentence punctuation (`.,;:!?`) after it, and a closing bracket it did not
  open, stay outside the link.
- An excerpt may have cut an address short, so on an excerpt an address that
  runs to its end (or to the ellipsis that ends it) is left as words. A
  folded message's line shows the message's first line, so it counts as cut
  only when the message is an excerpt whose first line is also its last.
- A link to one of this Theseus's own places (Outcomes, an outcome, a topic,
  an outcome's conversation or pipeline, a pipeline item) on the same origin
  opens here, through the page's navigation, which keeps
  writing as any other move does. Any other link opens in a new tab with
  `rel="noopener noreferrer"`.
- Clicking a link only follows it: it does not open the card it sits on, fold
  or unfold a message, or light a passage in the Reader to quote.
- Writing stays plain text: nothing becomes a link while it is written.

## Topics named in a message

A topic's id standing on its own in a message's words (`t-` and 32 lowercase
hex digits, as Theseus makes them) is a link that shows the topic's name and
opens it, by pointer, keyboard or touch. A link to a topic, written as its
address, shows the topic's name too, and a link to a message shows
"Message in" and its topic's name. The words it stands for stay the link's
title, and a selection in the Reader counts them, not the name, so quoting
is unchanged.

The name comes from what the page already holds (the open topic, the topic
list) or else from one read of the topic, kept for the page; a read that
fails is tried again the next time a message names it. A bare id the reader
cannot see, or that names no topic, stays plain words; an address stays a link
showing its address.

## A message's link

`?topic=T&message=M` opens topic T with message M in the Reader; when T is an
outcome's conversation it opens the conversation page, as any link to that
topic does. Once it is open the address names the page alone, so reloading
does not open the Reader again. The Reader reads the message as any opening
does, so a whisper opens only for the two people in it: anyone else who
follows its link sees the message is not available to them, with nothing of
its words. In a message's words such a link opens the message in the Reader: in
place when it is in the open topic (from the Reader's own text, stepping as
the arrows do), else by opening its topic.

A copied link names the instance's tailnet origin when it has one (the
bootstrap's `links.origin`), so a link copied on the Mac opens on a phone. A
link naming either that origin or the page's own is one of this Theseus's
places.

## A message's menu

Every message card on the topic page has a ⋯ button in its top right corner,
always shown. It opens a short menu, and a right-click anywhere on a message
(its card, or a folded message's line) opens the same menu where the pointer
is; on a link or a selection the browser's own menu stays. The items:

- Copy Link puts the message's link on the clipboard, and the ⋯ says
  "Link copied" until the next press lands or a key is pressed, so a press
  on the ⋯ itself still opens its menu. Where the clipboard refuses, the page
  gives the link to select instead.
- Mark unread, or Mark read on a message marked unread, for a message by
  someone else. Mark read places the New line afresh, as the Reader's button
  does. A card never opened may have a mark the page has not seen; a refusal
  that names its revision is answered once more at it.

The Reader's header has the same ⋯ in place of the Wide/Stacked button: Copy
Link and the mark for a message, and Wide layout or Stacked layout where the
window is wide enough to choose. Up and Down move through a menu, Escape
closes it and gives the focus back, and a press outside or a scroll that
moves what opened it closes it.

## Clicking outside a pop-up

A click or tap outside a modal pop-up, on its backdrop, closes it the way its
× and Escape do (`web/dismiss.mjs`). The Reader, Topic settings and the
version review all close this way. For the Reader that close keeps the
unsent writing, quotes and images, waits while a save is running, returns the
focus to what opened it, and never sends; when the close is refused (an image
still being chosen, or writing this device could not keep) the Reader stays
open and says why. The version review closes as Keep both for now does, and
Topic settings as its ✕ does, giving the focus back to the gear. On a phone
the Reader and Topic settings fill the screen, so nothing is outside them. The
color picker, which is not modal, already closes on a press outside it.

Only a press that starts and ends outside counts. A selection or drag that
starts inside and is let go outside does not close the pop-up, nor does a
press that starts outside and ends inside, nor a press with any button but the
main one. A press that closes a smaller pop-up open inside a modal one closes
only the smaller one.
