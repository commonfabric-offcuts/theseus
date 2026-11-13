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

Whatever card a key leaves picked comes into view by the one rule for what
the keys select (docs/interaction.md, "What the keys select comes into view"):
one picked by ↑ ↓ ← →, moved by ⌘↑ ⌘↓, merged by ⇧⌘↑ ⇧⌘↓, moved in or out by
Tab or ⇧Tab, put back by ⌘Z, left picked by ⌘⌫ or Escape, and a card being
written that Return opens or ⌘↑ ⌘↓ move. A click on a card leaves the page
where it is. `deck-page.mjs` marks the time a key is acting (`keyed`), so every
act a key starts reads the rule, whichever path paints the card.

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
| finish editing | Escape | Done |
| finish editing, and write a new card below it | ⌘Return | |
| finish editing a card with children, and fold them away | ← at the very start | |
| while editing, move the card past the one above or below it | ⌘↑ ⌘↓ | |
| while editing, put the card under the one above it, or take it out of its parent | Tab, ⇧Tab | |
| while editing, move the line the cursor is on past the line above or below it | ⌥↑ ⌥↓ | |
| while editing, finish the card and go on editing the one above or below | ↑ at the very start, ↓ at the very end | |
| a new card beside this one | Return while not editing | New card |
| a new card right above this one | ⌥Return | |
| remove the card and its children | ⌘⌫ | |
| take back your last act | ⌘Z | Undo |
| select several cards, to act on them as one | ⇧↑ ⇧↓, ⌘-click or ⇧-click | |
| ask an agent about the card, or open its reply stack | → then Return, or a click on its speech bubble | its speech bubble |

A move and a merge go between cards with the same parent, never out of it: a
move takes the card past the one beside it with all its children, and a merge
keeps every word of both cards under the upper card's title, the lower card's
title a bold line inside it and its children following the upper card's. Tab
makes the card the last child of the card above it with the same parent, and
⇧Tab puts it after its parent's children, beside its parent; with nowhere to
go, Tab and ⇧Tab move the focus as they do elsewhere. A new card goes beside
the picked one, after its children, or with ⌥Return right above it, at its
depth.

While a card is being written, Tab, ⇧Tab, ⌘↑ and ⌘↓ move it by the same
rules; what is written, and the cursor, stay where they were. The page drawn
again (a read of it, a move) gives the box the focus back only where the box or
the cards had it, so a press outside the sheet as the page is read again leaves
the box's cursor where it was for the next opening. Both the move
and unfinished writing autosave through the shared Notebook writer (302,
notebook-writing.md). A new card with words also saves before Done; an empty
new card changes only where it will go. The box keeps these keys even with nowhere to go, as
an outliner does, so a Tab never takes the focus out of a card half written;
Escape leaves it, and ⌘Return leaves it and opens a new card for writing
right after it and its children, at its depth, as Return does from a picked
card; from a box with nothing written ⌘Return only leaves, so it never makes
an empty card. ← at the very start of a card that has children finishes it
and folds its children away, the card picked; on a card with none, ← stays
the box's. ↑ at the very start of what is written finishes
the card and opens the card that shows above it for writing, the cursor at
its end; ↓ at the very end does the same with the card below, the cursor at
its start. Anywhere else in the box ↑ and ↓ move the cursor as usual, and at
the first or last card they do nothing more. A new card with nothing written
is dropped on the way, as Escape drops it, and a card cleared of all its text
is removed with its children, as below, so ↓ from it goes on to the card after
them. The keys an input method takes while it composes stay its own. The
box shares the composer's writing keys (`web/writing-input.mjs`): ⌥↑ and ⌥↓
move the line the cursor is on, or the lines selected, past the line beside
them, as in the composer (interaction.md), and on a Mac ⌃A and ⌃E go to the
start and end of the line, and ⌃K, ⌃U and ⌃W delete to its end, back to its
start and the word before the cursor.

On a laptop a card being written stays where it showed: its box takes the
card's own place and height, its words stay on the lines they showed on, a
card with children keeps its chevron where it stood, and the cards around it
do not move. The box grows only when what is written needs more room. The
title takes the words' face while it is written, so it moves by the
difference between the two faces' lines, and a title that wrapped beside the
speech bubble may take a line fewer. Words that show as a list, a quote or
paragraphs are written as their markdown, a blank line a whole line, so such
a card can grow while it is written. The line of keys above the cards keeps
the height of its longest form, so it moves nothing when it changes.

Clearing all of a card's text removes the
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
reload and comes undone when its card's title changes. ← and → work as in a
tree: on a card with no children showing, ← goes up to its parent, and on a
card with none folded away, → gives the focus to its speech bubble. ⌘← and ⌘→
fold and show the same way, ⌘→ going down to the first child of a card whose
children show, and the browser never takes them for Back and Forward on the
cards.
⇧⌘← folds every card's children away and ⇧⌘→ shows them all again. ↑ and ↓ pass over
folded cards, a phone's swipe holds only the cards that show, and the count
says how many are folded away. An act that puts a card under a folded card,
Tab or an undo, unfolds it to show the card where it went; a remove beside a
folded card leaves it folded. On a phone, where one card shows at a time, a
child card shows its parent's title above its own.

## Saving

Text and Cards now share `NotebookWriting` (302, notebook-writing.md), using
`memory.revise` and the last confirmed revision. Unfinished writing autosaves,
and edits made during a save go in the next revision. Switching views does
not save or normalize the words. The exact request and newer local writing
survive a lost response and reload. A second tab may read while the first
holds its device journal.

Changes to different cards merge while the current card stays open, including
when an agent answers the card's bubble by editing elsewhere in the deck.
Changes to the same card on both sides, or overlapping Text writing, show both
versions and ask which to continue with. Untouched writing accepts a newer
revision without a question. A permission refusal preserves local writing and
makes the page read-only. Someone Core does not let write the page (its
`reader_may_write`, notebook-pages.md) reads it: no Edit, New card, Undo, Add
image or Draft, the words not writable and the saving sign saying To read;
writing they had kept on the device still goes to Core, which answers it.
Every read of the page as it stands tells the page whether Core lets them
write it, so after Discard my writing, or a save answered by a newer
revision, a page they may not write is still to read.
Background reads still check the Notebook version before reading the page body
again.

The page's draft mark ([notebook-pages.md](notebook-pages.md#a-draft-page)) is
part of what the writing saves and merges, beside its title and words: marking
or clearing it is one more act, saved as a revision, which Undo takes back.

## Asking about a card

Each card has a speech bubble at its right edge. On a laptop it shows on the
picked card, and under the pointer while the mouse is in use: macOS hides the
pointer while a person types, so once a key is pressed the card under it
shows neither its bubble nor the pointer's highlight until the mouse moves.
→ gives the bubble the focus, from a card with no children folded away, as ⌥→
does from any card, and ← gives the focus back to the card. On a phone it shows on every card. On a card with no reply
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

A draft page's cards offer no speech bubble that asks: its words are kept from
agents until the mark is cleared, and the bubble comes back with them. A card's
reply stack, begun before the mark, still opens from its bubble. Nor does
someone who may not write the page ask from it, since the ask writes the
stack's link into the card.

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

A page opens in the composer over the feed (item 396, `web/notebook-sheet.mjs`):
the New message sheet comes up with the page in it, from every place a page is
opened as it stands: a row of the outline's Outcome Notebook, a card of the
topic's own Notebook, a row of the right rail's Notebook, a row on the
outcome's own page, a link to a page as it stands, the pencil that starts a
page (its first card ready to write), and Edit page in the ⋯ of the Reader
showing a page at a revision. Over the outcome's own page, which has no feed,
it comes up over that page. A link to a page at a revision still opens it in
the Reader, or in place on its outcome's page, to read.

The sheet's head is one line on a laptop: the page's title, Text and Cards as
chips with the page's Draft toggle beside them, the saving sign, a Full page glyph (↗, `?cards=ITEM`, below) and ✕, each
glyph named for screen readers and with a tooltip; on a phone it takes two
lines, the title with ↗ and ✕, then the chips and the sign, which on a screen
too narrow for both whole (320 points) takes a line of its own below the chips,
never one over the other; each chip, and the Draft mark that stands for the
toggle for someone who reads the page, is 44 points tall there. When the sign
says what needs the person (a refused save with Try again and Discard my
writing, a save paused, the device's copy unavailable), it takes a line of its
own below the rest of the head at every width, on a laptop as on a phone, its
words whole and wrapping and its buttons after them (44 points tall on touch),
so a press on a chip always reaches the chip. Below it is one
place that scrolls; on a phone one card fills it, swiped through as on the full
page. The line of keys above the cards is short there (↑ ↓ pick · Return new
card · ⌘Return edit, and while writing Escape done · ⌘Return next card), the
full page's line its tooltip.

✕, Escape or a press on the backdrop closes it. While a card is being written
the first Escape finishes the card and a second closes the sheet; ✕ and a press
outside close it with the card still open. The feed comes back where it was
read and the focus to what opened the page, at once, so a page opened from the
keys straight after (Tab to the next card, Return) stays open; should anything
have moved the feed while the sheet was up (its scrollbar, say), closing puts it
back. The feed keeps
its length while the sheet is up, so one read to its end does not move behind
the backdrop. Unfinished writing keeps saving
(notebook-writing.md), and the page keeps its picked card, its place in the
cards and an open card box until another page is opened in its place: opening
it again shows it as it was left. A second page replaces the first, whose
writing goes on to Core; a card box it had open opens again with it, as it does
after a reload or a move to another topic and back. While the sheet shows, the
keys are its own: an arrow, Page Up or Down, Home, End or Space that the page
does not use moves nothing behind it, and neither does a wheel, a trackpad or
a finger over the backdrop or the sheet's head (its title, chips and saving
sign), or over a card or past the end of what scrolls in the sheet. Each is
the sheet's own only where a box in it would scroll that way, a finger's way
counted from where it touched down, so a swipe still goes through the cards.
The page showing is read again on every commit, so a
revision made elsewhere shows at once, and is read as it comes, so its light
stays out (nothing is drawn above the cards for it; the person's own revisions
Core counts as read already); a page whose sheet is closed is not read again
until it opens, though writing of its own that Core has not confirmed still
goes.

Opening a page reads it, as the Reader did (notebook-pages.md): its changed
light goes out, and what changed since the revision the person last read shows
above the cards, under "What changed since you read revision N".

A card's speech bubble with a reply stack sets the sheet aside and opens the
stack in the Reader, whose header then says "← <page title>" in place of its
way back to the topic. Closing the Reader any way, by that button, ✕, Escape or
the backdrop, brings the page back exactly as it was. A stack in another topic
(an outcome page's asks go to its Conversation) opens on that topic's page; its
way back comes back to the page the sheet stood over, the feed where it was and
the page open over it with its card box as it was.

`?cards=ITEM` (topic-navigation.mjs) is the full page, with no rail, so the
deck has the width; the eyebrow goes back to the page in its topic or outcome.
Existing Cards links still open it. Its count and buttons stand above the
cards, where a phone's keyboard never covers Done, and a phone opens scrolled
to them.

The checks are `tests/notebook_sheet_native.mjs`, in the `notebook` and
`webkit-notebook` modes, at a laptop's width and a phone's.
