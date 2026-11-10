# Cards: a Notebook page as a deck

A tool for sorting ideas and capturing notes, usable from any outcome. Any
Notebook page opens as a deck of cards: thumbed through one at a time on a
phone, and sorted as a list with the keys on a laptop. It is deliberately
light (pipeline item 278): no Core change, and one unit test file for the
rules that keep a page's words.

## The page is the deck

A deck is an ordinary Notebook page (notebook-pages.md), so it keeps every
revision with its author, the Reader shows it and what changed, and an agent
reads and writes it with `note read` and `note revise` like any other page.

- Each card is a `##` heading and the words under it, up to the next `##`
  heading. A heading inside a fenced block is not one.
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
| move the card up or down | ⌘↑ ⌘↓ | |
| merge with the card above or below | ⇧⌘↑ ⇧⌘↓ | |
| edit the card | Return, or a double click | Edit |
| finish editing | Escape or ⌘Return | Done |
| a new card after this one | ⌘Return while not editing | New card |
| remove the card | ⌘⌫ | |
| take back your last act | ⌘Z | Undo |

A merge keeps every word of both cards under the upper card's title; the lower
card's title becomes a `###` heading inside it. Clearing all of a card's text
removes the card. ⌘Z takes back the person's own acts on this page, newest
first, each as a new revision; it never reverts someone else's change.

## Saving

Every act writes a new revision with `memory.revise`, expecting the revision
the deck was read at, and the saving sign says when it was saved. Acts made
while a save is on its way go together in the next one. When the page changed
elsewhere first (`REVISION_CONFLICT`), the deck reads the page again and makes
the waiting acts again on it, each finding its card by its words; an act whose
card is gone is dropped, and the page says so. A save whose answer was lost
goes again exactly as it was, under the same operation, so Core records it
once: on Try again, or by itself the next time Theseus is heard from. On every commit the live feed announces, the deck reads its Notebook's
version, and reads the page again only when that has moved, so a change made
on a laptop shows on the phone. An edit in progress is kept through a re-read;
if its card changed elsewhere meanwhile, the edit is added as a card beside
it rather than written over it. A person who may read the page but not write
it (`FORBIDDEN`, `OUTCOME_REACHED`) gets the deck to read, and the page says
why.

## Where it opens

`?cards=ITEM` (topic-navigation.mjs), with no rail, so the deck has the
width; the eyebrow goes back to the page in its topic or outcome. A Notebook
page's ⋯ in the Reader, and a page opened in place on its outcome's page,
offer Open as cards ([links.md](links.md)). The count and the buttons stand
above the cards, where a phone's keyboard never covers Done, and a phone
opens scrolled to them.
