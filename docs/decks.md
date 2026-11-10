# Notebook Cards: a Notebook page as a deck

A tool for sorting ideas and capturing notes, usable from any outcome. Any
Notebook page opens as a deck of cards: thumbed through one at a time on a
phone, and sorted as a list with the keys on a laptop, a card's children
grouped under it. It is deliberately light (pipeline item 278): no Core
change, and one unit test file for the rules that keep a page's words.

## The page is the deck

A deck is an ordinary Notebook page (notebook-pages.md), so it keeps every
revision with its author, the Reader shows it and what changed, and an agent
reads and writes it with `note read` and `note revise` like any other page.

- Each card is a heading of two to six `#`s and the words under it, up to the
  next such heading. A heading inside a fenced block is not one, and a `#`
  heading is words.
- A card's children are the deeper headings after it, up to the next heading
  as shallow as its own: a `##` card is the deck's own, a `###` card under it
  is one of its children, and a `####` card under that is a child of the
  child. Every act takes a card's children with it.
- What comes before the first card is the deck's opening; the cards page shows
  it above the cards and never changes it.
- A card's text, as a person writes it, is its title on the first line and its
  words below. Writing a line that starts with `##` into a card starts another
  card.
- Only the card an act changes is written again. A card that only moves keeps
  its exact words; where it now stands beside a card it did not stand beside
  before, a blank line separates them. A page opened as cards and closed with
  nothing done to it is never written.

The rules are `web/deck.mjs`, checked by `tests/ui_deck.test.mjs`.

## Acts

| act | laptop | phone |
| --- | --- | --- |
| pick the card above or below | ↑ ↓ | swipe |
| move the card past the one above or below it | ⌘↑ ⌘↓ | |
| merge with the card above or below it | ⇧⌘↑ ⇧⌘↓ | |
| put the card under the one above it | Tab | |
| take the card out of its parent | ⇧Tab | |
| fold away a card's children, or show them | ← →, or a click on the chevron before its title | a tap on its chevron |
| fold away every card's children, or show them all | ⇧⌘← ⇧⌘→ | |
| edit the card | a click where the cursor should go, or ⌘Return | Edit, or a tap where the cursor should go |
| finish editing | Escape or ⌘Return | Done |
| a new card beside this one | Return while not editing | New card |
| a new card right above this one | ⌥Return | |
| remove the card and its children | ⌘⌫ | |
| take back your last act | ⌘Z | Undo |
| select several cards, to act on them as one | ⇧↑ ⇧↓, ⌘-click or ⇧-click | |
| ask an agent about the card, or open its reply stack | ⌥→ then Return, or a click on its speech bubble | its speech bubble |

A move and a merge go between cards with the same parent, never out of it: a
move takes the card past the one beside it with all its children, and a merge
keeps every word of both cards under the upper card's title, the lower card's
title a bold line inside it and its children following the upper card's. Tab
makes the card the last child of the card above it with the same parent, and
⇧Tab puts it after its parent's children, beside its parent; with nowhere to
go, Tab and ⇧Tab move the focus as they do elsewhere. A new card goes beside
the picked one, after its children, or with ⌥Return right above it, at its
depth. Clearing all of a card's text removes the
card, and ⌘⌫ and a clearing both take its children too. ⌘Z takes back the
person's own acts on this page, newest first, each as a new revision; it
never reverts someone else's change.

Several cards can be selected together, the picked card among them: ⇧↑ and
⇧↓ select every card that shows from where the selection began to the card
they go to, ⇧-click does the same up to the card clicked, and ⌘-click adds a
card or takes it out. The count says how many are selected. With several
selected, the top one leads and the others follow it as its neighbors, each
with its children, at its depth and in their order: ⌘↑ and ⌘↓ gather them
under the top card and take them all past the card beside them, Tab puts the
top card under the card above it and the others after it, ⇧Tab takes the top
card out of its parent and the others after it, and ⌘⌫ removes them all. ⌘Z
takes back each of these whole, and the cards stay selected through them.
Merge, edit, fold and the speech bubble act on the picked card alone. Escape,
a plain click or a plain ↑ or ↓ ends the selection, and so do writing a
card, asking about one and folding. The rules are `groupAct` in
`web/deck.mjs`.

Folding is the reader's own view and never touches the page: the folded
cards are kept in this browser by their titles, so a fold lasts through a
reload and comes undone when its card's title changes. ← and → work as in any
tree: on a card with no children showing, ← goes up to its parent, and on a
card whose children show, → goes down to the first of them. ⌘← and ⌘→ do the
same, and the browser never takes them for Back and Forward on the cards.
⇧⌘← folds every card's children away and ⇧⌘→ shows them all again. ↑ and ↓ pass over
folded cards, a phone's swipe holds only the cards that show, and the count
says how many are folded away. An act that puts a card under a folded card,
Tab or an undo, unfolds it to show the card where it went; a remove beside a
folded card leaves it folded. On a phone, where one card shows at a time, a
child card shows its parent's title above its own.

## Saving

Every act writes a new revision with `memory.revise`, expecting the revision
the deck was read at, and the saving sign says when it was saved. Acts made
while a save is on its way go together in the next one. When the page changed
elsewhere first (`REVISION_CONFLICT`), the deck reads the page again and makes
the waiting acts again on it, each finding its card by its words; an act whose
card is gone is dropped, and the page says so. A save whose answer was lost
goes again exactly as it was, under the same operation, so Core records it
once: on Try again, or by itself the next time Theseus is heard from. On every
commit the live feed announces, the deck reads its Notebook's version, and
reads the page again only when that has moved, so a change made on a laptop
shows on the phone. An edit in progress is kept through a re-read;
if its card changed elsewhere meanwhile, the edit is added as a card beside
it rather than written over it. A person who may read the page but not write
it (`FORBIDDEN`, `OUTCOME_REACHED`) gets the deck to read, and the page says
why.

## Asking about a card

Each card has a speech bubble at its right edge. On a laptop it shows on the
picked card and under the pointer; ⌥→ gives it the focus and ← gives the focus
back to the card. On a phone it shows on every card. On a card with no reply
stack, the bubble asks an agent about it: a box in the card's place takes the
ask, and Ask or ⌘Return sends it as a new message (`message.post`, an ask) in
the page's topic, or for an outcome's page in its conversation. The message
quotes the card and says where it is, so the agent can change the card when
that is what is asked. It goes to one agent: the only agent among the topic's
participants, or, of several, the one asked last in this browser, which the
person may change. Not to all of them, since each one asked would start on the
same work. An ask whose answer is lost is sent again as it was on Try again,
so Core records it once. Escape goes back to the cards, and so do ↑, ↓ and ←
from a box with nothing written, ↑ and ↓ going on to the card beside; picking
another card does the same. What was written waits for that card's next ask
while the page stays open, and Cancel drops it. The box, like the edit box,
asks the browser not to offer AutoFill. Safari, and Apple's iCloud Passwords
extension in Chrome, ignore that request and judge a box with no label element
by the words on the page around it, so beside a card about tokens or codes an
empty box reads as a field for a one-time code. Each box is therefore named by
a label element of its own, whose words name nothing AutoFill fills.

Once Core has the ask, the card keeps the link to its reply stack as a line of
its words, `[Reply stack](ADDRESS)`. A line that holds only a link to a message
of this Theseus is a stack: the deck draws it as the card's bubble rather than
as words, and it moves with the card through moves, merges and edits (the
edit box leaves it out and puts it back under what is written). The back and
forth is the topic's own feed. The bubble says Sent until the stack's first
reply and then counts its replies. It stays quiet, in the muted color, except
while one of them waits unread for the reader: then it is filled in the accent
color and marked with a dot, from the deliveries Core already keeps
([attention.md](attention.md)). It opens the stack in its topic,
and coming back to the deck in the same tab lands on the same card. The counts
come from the topic's latest 100 messages, read on every load as the
conversation page reads its topic, so a stack begun before them shows its
bubble without a count.

## Where it opens

`?cards=ITEM` (topic-navigation.mjs), with no rail, so the deck has the
width; the eyebrow goes back to the page in its topic or outcome. A Notebook
page's ⋯ in the Reader, and a page opened in place on its outcome's page,
offer Open as cards ([links.md](links.md)). The count and the buttons stand
above the cards, where a phone's keyboard never covers Done, and a phone
opens scrolled to them.
