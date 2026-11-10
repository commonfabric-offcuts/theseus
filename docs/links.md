# Links in messages, and clicking outside a pop-up

## Links in a message's words

Every surface that shows a message's or a Notebook page's words shows its web
addresses as links: the topic page's message cards and the line a reply quotes,
a folded message's line, Notebook cards, the Reader's source text, a Notebook
page opened on an outcome's page, the messages sent to the person by name, and
the message a new topic answers. `web/links.mjs` draws them.

- Only an `http://` or `https://` address becomes a link. The words are drawn
  as text nodes and anchors, never as markup.
- An address ends at a space, an angle bracket, a quote mark or an ellipsis,
  and in a message's formatted words at an escape, as in
  `https://a.example/my\_page`, which links to `https://a.example/my`, or
  code. It holds brackets, as in `https://a.example/q?ids[]=1`. Whether a `[`
  opens a `[words](address)` is read before anything after it, by matching
  brackets as CommonMark does, so `[a https://a.example/x[b] c](https://d.example/)`
  is one link with those words and no address in them, while in
  `[see https://a.example/q?ids[]=1 now] tail` the `[` is words and the
  address is `https://a.example/q?ids[]=1`, as it is with no `[` before it.
  Sentence punctuation and the marks a line reads
  (`.,;:!?*_~`) at its end, and a closing bracket it did not open, stay
  outside the link, as GFM leaves them, so `~~see https://a.example/x~~` is
  struck words holding a link to `https://a.example/x`. A letter, digit or
  other part of a word straight before an address or a topic's id runs it
  into a word; punctuation, a mark among it, does not (`web/characters.mjs`
  says which is which, for the marks too). An address the browser cannot read
  is words to the end of its run.
- A topic's id after a mark is a link as an address there is, so
  `snake_case_t-…` links the id once its name is known, as GFM would link an
  address there; whether an id run on from a word by `_` should stay words is
  the product's call.
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
- A link written as `[words](address)` shows the words and goes to the
  address as written, whole: brackets that close inside it (as in
  `https://en.wikipedia.org/wiki/Markdown_(disambiguation)`), quote marks and
  closing punctuation are its own, and none of a bare address's endings
  apply. An escaped bracket in it is that bracket as written, neither opening
  nor closing it: `[a](https://a.example/x\)y)` goes to
  `https://a.example/x)y`. Its words end at the `]` that closes its `[`, brackets in between
  balanced, and may hold bold, italics and code, but no other link; an
  address with a space in it is no such link, and nor is one with no words. When the target is no address,
  the brackets that would end there, and any inside it, are words. A link written this way to a
  topic keeps its words; it does not show the topic's name.
- Writing stays plain text: nothing becomes a link while it is written.

## Topics named in a message

A topic's id standing on its own in a message's words (`t-` and 32 lowercase
hex digits, as Theseus makes them) is a link that shows the topic's name and
opens it, by pointer, keyboard or touch. A link to a topic, written as its
address, shows the topic's name too, and a link to a message shows
"Message in" and its topic's name. The words it stands for stay the link's
title, and a selection in the Reader counts and quotes them, not the name: a
quote holds the source's own words, with a link a selection only partly
covers taken whole.

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

## A Notebook page's link

A Notebook page has a link of the same family, naming its Notebook's place
and the page, and, for one revision, that revision:

- `?topic=T&page=P` opens topic T with page P of its own Notebook in the
  Reader, as the page stands; `?topic=T&page=P&revision=N` opens revision N.
- `?workspace=W&page=P` (and `&revision=N`) opens outcome W's page, with page
  P of the outcome's Notebook open in place below its lists, as its row
  opens it there.

Once it is open the address names the topic or the outcome alone, as a
message's link does. As it stands is read through the `memory_current` view
([notebook-pages.md](notebook-pages.md#core)); a revision that does not exist,
or a page the reader may not read, is refused and nothing of it is shown. A
page and a message are never named together, and a revision only with its
page (a positive whole number).

In a message's words such a link is one of this Theseus's places. Pressed on
a topic's page, a page of that topic's Notebook or of its outcome's opens in
the Reader in place (from the Reader's own text too); pressed on an outcome's
page, a page of that outcome's Notebook opens in place; any other opens its
place. A link to a page in a topic's Notebook shows "Notebook page in" and
the topic's name; an outcome page's link shows its address.

The Reader's ⋯, on a Notebook page, offers Copy Link (the page as it stands,
so it keeps opening the latest revision) and Copy Link to Revision N (the
revision shown), naming the tailnet origin as a message's link does. An
agent prints the same link with `note link ITEM [--revision N] [--origin
URL]` ([agent-cli.md](agent-cli.md#notebook-pages)). It also offers Open as
cards, the page as a deck at `?cards=ITEM` ([decks.md](decks.md)), which a
page opened in place on its outcome's page offers too; such a link in a
message's words opens here as well.

## A message's menu

Every message on the topic page has a ⋯ button on its bar, the one bar that
shows over a lit message (docs/interaction.md), beside 👍 and Reply. It opens a
short menu, and a right-click anywhere on a message (its card, or a folded
message's line) opens the same menu where the pointer is; on a link or a
selection the browser's own menu stays. On a phone a tap lights the message
and the bar's ⋯ is one more tap. The items:

- Copy Link puts the message's link on the clipboard, naming the message's
  own topic (in the Reader, a message from another topic names that one), and the ⋯ says
  "Link copied" until the next press lands, a key is pressed or the light
  moves to another message, so a press on the ⋯ itself still opens its menu.
  Where the clipboard refuses, the page gives the link to select instead.
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
