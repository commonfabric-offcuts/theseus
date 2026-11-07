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
- A link to one of this Theseus's own places (Outcomes, an outcome, a topic)
  on the same origin opens here, through the page's navigation, which keeps
  writing as any other move does. Any other link opens in a new tab with
  `rel="noopener noreferrer"`.
- Clicking a link only follows it: it does not open the card it sits on, fold
  or unfold a message, or light a passage in the Reader to quote.
- Writing stays plain text: nothing becomes a link while it is written.

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
