# Notebook Cards: a Notebook page as a deck

A tool for sorting ideas and capturing notes, usable from any outcome. Any
Notebook page opens as a deck of cards, sorted as a list, a card's children
grouped under it. It is deliberately light (pipeline item 278): no Core
change, and one unit test file for the rules that keep a page's words.

## Default on phones (item 652)

For now, editing cards on a phone uses the same card editor as on a laptop,
as the default: the vertical list of cards with the writing box in the card's
own place, in the composer sheet and on the full page. There is no separate
phone carousel. Edit, Done, New card and Undo remain available by touch;
chevrons and speech bubbles have names, tooltips and 44px touch targets.
Autosaving, exact unfinished writing, permissions and recovery choices use
the same Notebook writer at every width.

`tests/reader_compose_native.mjs` (`native-compose`), the `item 652` cases in
`tests/card_editor_652.mjs`, holds this default in Chromium and WebKit at
320, 375, 390px and laptop width, light and dark, across the actual editor
states. Layout bounds use named tolerances; applied source mutants must fail
those bounds and pass again after restoration.

The 44px card targets and matching title clearance apply at phone widths
(up to 760px) as well as with a coarse pointer. A phone viewport does not
depend on the browser reporting its primary pointer correctly. At laptop
widths, a fine pointer retains its existing controls.

At those phone widths, every pressable inside `.notebook-sheet` has a
44px minimum width and height, independent of pointer classification. This
includes the header links and chips, Edit/Done/New card/Undo, writing and
ask fields and the To picker, chevrons and speech bubbles, every recovery
and conflict choice (including Try again and Discard my writing), image
actions and thumbnails, fenced-text Copy, ordinary links and the changes
summary. Native controls, links, summaries, button/link roles and elements
with a tabindex share the floor; only the two minimum dimensions use
`!important` so more-specific status and state rules cannot lower them.
Ordinary links get an inline block so the minimum applies; the header glyph
and speech-bubble links keep their own display. Hidden controls stay hidden.
The in-place writer keeps the greater of 44px and its retained card height;
the ask field keeps five rem, card thumbnails three rem in both dimensions,
and coarse-pointer image choices three rem in height.
The scope is the Notebook editor sheet; the full-page card editor retains
its existing target rules, and other composers and Pipeline controls do not
acquire this rule.

The item 652 trail records actual pointer/hover media, viewport and input
mode, computed control boxes and applicable CSS rules. Native chevron
presses fold and restore the child without changing saved words. Opening a
sheet's `memory.read` request is an observation of a request, not proof of
completed rendering. Focus-entry failures retain the engine's original
error, an immediate unmodified screenshot, active element, native DOM
events, Edit handler entry/return and timed DOM mutations. These observations
do not force focus or excuse a failed native press. Scenario screenshots,
geometry and diagnostics retain their normal, mutant or restored suffix;
the case names and six native-compose phases stay the same.

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

## A card’s menu, identity and color (item 867)

Each card has a named **This card** ⋯ beside its speech bubbles, shown when
picked, under the pointer, or focused; it is always shown at phone widths.
The shared menu offers Copy text, Copy link, Delete and Set color. Copy text
copies the card’s literal title and rendered words as plain text, without
children, image/reply bookkeeping or the hidden line. Delete takes that card
and its children, and one Undo brings them back. Set color uses the agents’
eight-color palette plus No color; the tint appears in Cards and in the dock.
Copy text uses overlapping-sheet ink and Set color a palette outline; Copy
link and Delete reuse the shared chain and cross glyphs.
Opening the menu and Copy text do not allocate an identity or rewrite a page.

The first Copy link or Set color allocates a random `c-` plus 32 lowercase
hexadecimal digits, kept in the card’s Notebook words in one line:
`<!-- theseus-card: {"id":"c-11111111111111111111111111111111","aliases":[],"color":"blue"} -->`.
`id` may be null for an alias-only card; `aliases` is a list of unique card
ids distinct from the primary, and `color` is a palette name or null. At least
one identity is present. Only a complete valid line outside a code fence is
metadata. Invalid markers and examples inside fences remain ordinary words.
Older cards are unchanged until they need an identity. No Core schema changes.

Copy link waits for that identity to be saved and opens `cards` with `card`
and `view=cards`, revealing, picking and bringing that card into view even
when Text was the last view. Renaming or moving preserves the link. Missing
or ambiguous identities do not select a different card. Read-only cards can
copy their text and an already saved primary link; they cannot allocate an
identity, delete, or change color. A refusal leaves writing in the existing
Notebook recovery flow and does not claim that a new link or color was saved.

A merge keeps the neighbor’s primary identity and color, including null. It
adds the moved identities as aliases in the same line, so both old links
resolve. An unidentified neighbor stays without a primary until Copy link or
Set color needs one; an alias alone still resolves. Merge Undo restores both
original identities, colors and child groups, and Redo repeats that merge.
Word-edit and color Undo preserve an identity already allocated for a link.

Card editing and Text show no metadata line, restoring it through the same
Notebook writer and revision fence. Text edits attach metadata to surviving
card writing; removing an entire card removes its metadata. Text Undo/Redo
restores the corresponding metadata for writing from the current visit.
Merely switching views never writes the page. The deterministic checks use
real card acts, the Notebook writer and shared painters with in-memory
adapters; they do not claim native touch, focus or layout proof.

## Acts

Whatever card a key leaves picked comes into view by the one rule for what
the keys select (docs/interaction.md, "What the keys select comes into view"):
one picked by ↑ ↓ ← →, moved by ⌘↑ ⌘↓, merged by ⇧⌘↑ ⇧⌘↓, moved in or out by
Tab or ⇧Tab, put back by ⌘Z, left picked by ⌘⌫ or Escape, and a card being
written that Return opens or ⌘↑ ⌘↓ move. Opening a card by click or touch, writing in it, and closing it with
Escape or Done keep the page where it is (item 644). Rendering, saving and
setting the caret do not reveal the whole card; only navigation between cards
asks for a new place. If permission is refused while writing, the full page
keeps its height while the writing controls are away, so closing the retained
card cannot pull the page up from its end. `deck-page.mjs` marks the time a key is acting (`keyed`), so every
act a key starts reads the rule, whichever path paints the card.

The item 644 cases in `tests/notebook_pages_native.mjs` sample scroll positions
on every animation frame: the document, the sheet wrapper, the dialog and the
visible `.notebook-sheet-page` (the sheet's actual overflow owner). Each sheet
case first applies and restores a 350px jump to that owner and requires the
same predicate to reject the trace, even after the owner returns to its start.
This control covers normal, saving, refused, read-only, empty and error states
at 320, 375, 390 and 1280px in both themes. The shared sampler and predicate
also have a browser-free instrument control in
`tests/ui_card_scroll_probe.test.mjs`; removing the sheet-owner sample must
fail that check. This unit control alone does not establish native behavior.

| act | laptop | phone |
| --- | --- | --- |
| pick the card above or below | ↑ ↓ | tap the card, or Edit |
| move the card past the one above or below it | ⌘↑ ⌘↓ | |
| merge with the card above or below it | ⇧⌘↑ ⇧⌘↓ | |
| put the card under the one above it | Tab | |
| take the card out of its parent | ⇧Tab | |
| fold away a card's children, or show them | ← →, or a click on the chevron before its title | a tap on its chevron |
| fold away every card's children, or show them all | ⇧⌘← ⇧⌘→ | |
| edit the card | a click where the cursor should go, or ⌘Return | Edit, or a tap where the cursor should go |
| finish editing | Escape or ⇧⌘Return | Done |
| finish editing, and write a new card below it | ⌘Return | |
| finish editing a card with children, and fold them away | ← at the very start | |
| finish editing a card with folded children, and show them | → at the very end | |
| while editing, move the card past the one above or below it | ⌘↑ ⌘↓ | |
| while editing, indent or outdent the current line or selected lines | Tab, ⇧Tab | |
| while editing, move the line the cursor is on past the line above or below it | ⌥↑ ⌥↓ | |
| while editing, finish the card and go on editing the one above or below | ↑ at the very start, ↓ at the very end | |
| a new card beside this one | Return while not editing | New card |
| a new card right above this one, finishing any current writing first | ⌥Return | |
| remove the card and its children | ⌘⌫ | |
| take back your last act | ⌘Z | Undo |
| select several cards, to act on them as one | ⇧↑ ⇧↓, ⌘-click or ⇧-click | |
| ask an agent about the card, or open its reply stack | → then Return, or a click on its speech bubble | its speech bubble |

A move and a merge go between cards with the same parent, never out of it: a
move takes the card past the one beside it with all its children. A merge
keeps the adjacent card's title and appends the picked card's title as a plain
line, then its words, after the adjacent card's words. The picked card's
children follow the adjacent card's children. This also applies when merging
down: the lower card keeps its title, words and children first. The moved
title is escaped as literal text, so it cannot become another heading or
formatted block; lists, links, marks and Reply stack lines in the body stay.
Undo restores both cards and their child groups; Redo keeps the same merge
direction. While a card is picked, Tab makes it the last child of the card
above it with the same parent, and ⇧Tab puts it after its parent's children,
beside its parent; with nowhere to go, Tab and ⇧Tab move the focus as they do
elsewhere. A new card goes beside the picked one, after its children, or with
⌥Return right above it, at its depth.

While a card is being written, ⌘↑ and ⌘↓ move it by the same rules; what is
written, and the cursor, stay where they were. Tab and ⇧Tab instead indent
and outdent the current line or selected lines inside the card, through the
single `WritingInput.indentKey` rule: two spaces in, up to two spaces or one
leading tab out. A selection ending at the next line's start excludes that
line. One insertion uses the existing input/autosave path and the field's
Undo/Redo selection record. Other writing surfaces keep their existing Tab
routing. No Tab takes focus out of a card half written, including an outdent
at the left edge or Safari's ⌥Tab.

The page drawn again (a read of it, a move) gives the box the focus back only
where the box or the cards had it, so a press outside the sheet as the page is
read again leaves the box's cursor where it was for the next opening. Both
the move and unfinished writing autosave through the shared Notebook writer
(302, notebook-writing.md). A new card with words also saves before Done;
an empty new card changes only where it will go. Escape or ⇧⌘Return leaves
writing. ⌘Return leaves it and opens a new card right after it and its
children, at its depth; from a box with nothing written ⌘Return only leaves,
so it never makes an empty card. ⌥Return finishes the box and opens a fresh
card directly above the picked card, just as it does outside writing.
← at the very start of a card that has children finishes it and folds its
children away, the card picked. → at the very end of a card with folded
children finishes it and shows its children, keeping the parent picked.
With no folded children, or away from that end, → stays the box's; a selected
range or modified arrow also stays the box's. On a card with no children,
← stays the box's. ↑ at the very start of what is written finishes
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

At every width a card being written stays where it showed: its box takes the
card's own place and height, its words stay on the lines they showed on, a
card with children keeps its chevron where it stood, and the cards around it
do not move. The box grows only when what is written needs more room. On a
touch parent card, chevron clearance belongs to the title line alone. The
editor measures the read body's start to keep the taller touch title's room;
opening Edit without
changing the body keeps its horizontal origin and wrapping. The `item 652 B1`
cases compare unchanged body character positions, line membership, chevron
and adjacent-card bounds before and after native Edit, then check Done writes
no revision, in both surfaces, themes and engines at 320/375/390 and laptop.
Each measured comparison names its tolerance (2 CSS px); the whole-body
padding source mutant must be caught and the restored control pass. The
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
cards. Past the first card or the last, ↑ or ↓ goes on to what lies that way
on the page: the bar above the cards, the header, and below the last card the
rail's foot that ends the page (docs/rails.md, "The rail's foot";
docs/interaction.md, "The arrows everywhere"). With nothing focused the arrows stay the deck's, picking
a card.
⇧⌘← folds every card's children away and ⇧⌘→ shows them all again. ↑ and ↓ pass over
folded cards, only unfolded cards show, and the count
says how many are folded away. An act that puts a card under a folded card,
Tab or an undo, unfolds it to show the card where it went; a remove beside a
folded card leaves it folded. A child card is indented under its parent at
every width.

## Images in a card

An image goes into a card while it is written (item 321): pasted into its box,
dropped on it, or picked with `#img`. The card shows it under its words, and
the page keeps it: the image is one of the page's attachments, and a line of
the card's words names it, `![NAME](attachment:ID)`, as a reply stack's line
names its stack. The line moves with the card through moves, merges and edits,
a card's removal takes it and Undo brings it back. The box leaves such lines
out, as it leaves out the stacks', and shows the card's images under what is
written, each at the height it showed at on the card, with × beside it to take
it out of the card (named "Remove the image NAME from this card", 44 points to
touch on a phone; it never covers the image); the lines go back under what is written, before any stack's, when
the card is saved. A line inside a fenced block is words, and so is one that
holds anything else. A new card holding only images is named for the first of
them; a card cleared of all its text is removed, its images with it.

Each file is taken or refused at once, before its bytes are read, by the
page's own limits, which are Core's (`bootstrap.limits`): a PNG, JPEG, GIF or
WebP image, at most 16 MB, and at most 8 attachments and 64 MB to a page,
counting those still uploading. A refusal is one line in the saving sign
saying what was not added and why ("notes.pdf was not added: it is not a PNG,
JPEG, GIF or WebP image.", "huge.png was not added: an image may be at most
16 MB."), and nothing goes to Core; of several files, those before the first
refused are taken. The line goes when an image is taken or another card
opens.

A taken image is named in the card at once, by the media id it will upload
under, and uploads through the page's images (`web/notebook-images.mjs`, the
same `media.begin`/`media.publish` as every image, its bytes kept on the device
until Core has them). Until then the card shows it from those bytes, its name
saying "Uploading…" or why its upload failed, with Retry in the page's list of
images; once Core has it, it is attached to the page. Its name stays with it
for screen readers; it shows beside the picture while the image uploads or after
its upload failed, and in the picture's place while the picture does not show:
before it loads, or when the page holds no such image ("· not on this page").
Clicking a displayed image opens it in a new tab, leaving the card and its
writing in place (item 651, docs/images.md). Item 653's source-only preview
shows these clickable images as 3rem square thumbnails with `object-fit:contain`,
the page attachment list's convention: the whole image fits without cropping
([image-buttons-653.md](image-buttons-653.md)). The page's list of
images under the head leaves an image a card shows to the card, unless it needs
Retry. × takes the image off the page too, unless another card still shows it.
Undo, bringing back the card's line, puts the image back on the page (and so
does writing its line again while the page is open), so a card never names an
image the page lost: one uploaded is attached again, one still uploading when ×
was pressed goes on uploading from its bytes and is attached once Core has it,
and one someone else added is attached again by its id, which Core takes from a
writer of the page because one of its revisions carried it
(`NotebookImages.restore`). Core still refuses an image someone else uploaded
that no revision of the page carried. A revise reads the revision it follows,
and looks through the page's history only for such an image, that image alone,
so an ordinary save costs the same however many revisions autosave has made. An image taken off with Remove in the
page's list of images is not put back.

An image already on the page is read through the page as it stands
(`/api/media/read` with the page's `source_ref`), so only someone who may read
the page sees it; someone Core does not let write the page sees the images and
no ×. In the Text view the line is words like any other, and an image pasted
there is attached to the page without a line, as before.

Everywhere else a card's words are drawn, the line is never its markup. Where
the page is read, the Reader (a page at a revision) and a page opened in place
on its outcome's page, it is
the image, with its name under it, read through the page at the
revision shown (`web/page-image.mjs`); an image the page does not carry is its
name alone, "· not on this page", and nothing is read for it. Where only words
show, the topic's Notebook card (an excerpt of the page), what changed since
the person last read the page, and an ask quoting the card, it is the image's
name after an image glyph, "🖼 chart.png" (`imageStandIns`). A line in a code
span, in a quote or inside a fenced block, and an image from the web
(`![x](https://…)`), are words there as in the card.

The rules for the line are `cardImages`, `imageLine` and `boxText` in
`web/deck.mjs`, checked by `tests/ui_card_images.test.mjs`, with the page's
limits and putting an image back; reading through the page and attaching an
image again, `tests/test_memory_card_images.py`; in the browser,
`tests/notebook_card_images_native.mjs` in the `notebook` and
`webkit-notebook` modes: a paste and a drop while the card is written, a
reload, ×, Undo after ×, × on an image two cards show, a new card holding only
an image, the refusals and a large image within the limit, and each state of a
card's image at 320, 375, 390 and a laptop, light and dark; the image in the
Reader at 320, 390 and a laptop and in place on an outcome's page, the topic's
Notebook card naming it and an ask quoting it, each in light and dark (with
`imageStandIns` and `lineImage` in `tests/ui_card_images.test.mjs`, and the
Reader's passages, a page in place and what changed in
`tests/ui_card_image_words.test.mjs`); an image picked with `#img` into a card,
`tests/notebook_pages_native.mjs` ("notebook images paste and img picker").

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

A page opens in its own Notebook dialog (871, `web/notebook-sheet.mjs`),
beside a topic feed by default at 1280px or wider, or over the page otherwise.
An explicit Wide choice persists for the session. This applies wherever a page is
opened as it stands: a card of the topic's own Notebook, a row of the right
rail's Notebook (the topic's, or the outcome's), a row on the
outcome's own page, a link to a page as it stands, the pencil that starts a
page (its first card ready to write), and Edit page in the ⋯ of the Reader
showing a page at a revision. Over the outcome's own page, which has no feed,
it comes up over that page. A link to a page at a revision still opens it in
the Reader, or in place on its outcome's page, to read.

The sheet keeps only one tight title row fixed (868): the page's title,
ellipsized when long, the page menu, the layout glyph where available, Full page (↗,
`?cards=ITEM`, below) and ✕. Glyphs have screen-reader names and tooltips;
desktop glyphs are 40 points and phone controls retain their 44-point floor.
The page menu (873) owns Show as text / Show as cards, Draft with its note,
Choose dossier… while docked, Add image… and Wide/Open with Dossiers, followed
by the existing page actions and Copy Link. The old toolbar is removed. The
same controls move with the active NotebookPage; neither the writing nor its
scroll owner is replaced. New message keeps its own composer, available from
the pencil while Notebook is docked; its close/send leaves Notebook intact.

The saving sign has a quiet row at the top of the scroller, on the
laptop and at every phone width (item 642). "Saved to Theseus", keeping a
device copy, saving, uploading and every attention or read-only state change
only that row; page actions stay in the title-row menu. Attention notices wrap whole there. A refusal's Try again and Discard
my writing follow its words, wrapping when needed, and are 44 points tall on
touch. Its existing role=status keeps announcing save state. Below the fixed
title is one place that scrolls: the dossier picker, saving sign, page notices,
deck bar and the same vertical card list as the full page
at every width. The line of keys above the cards is short there (↑ ↓ pick · Return new
card · ⌘Return edit, and while writing Escape done · ⌘Return next card), the
full page's line its tooltip. Done, New card and Undo scroll away with the cards;
their keyboard handlers remain active. While a card is being written, only
its writing row is current, including the new card opened by ⌘Return. The
saved picked index remains the return point when an empty new card is finished.

✕ and Escape close either layout; only the layout control switches between
beside and over the feed. A press on the modal backdrop also closes it. While a card is being written
the first Escape finishes the card and a second closes the sheet; ✕ and a press
outside close it with the card still open. The feed comes back where it was
read and the focus to what opened the page, at once, so a page opened from the
keys straight after (Tab to the next card, Return) stays open; should anything
have moved the feed while the modal sheet was up (its scrollbar, say), closing
puts it back. Closing a docked Notebook keeps the feed where the person moved it. The feed keeps
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
counted from where it touched down, so a vertical drag scrolls the card list.
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
cards. The list and the in-place editor are the laptop's on a phone too, for
now, with Done available above the cards.

The checks are `tests/notebook_sheet_native.mjs`, in the `notebook` and
`webkit-notebook` modes. Its "notebook item 642" cases compare the controls'
boxes across every saving-sign branch and during native typing/autosave, at
320, 375, 390 and 1440 pixels, in light and dark. Geometry fixtures render the
real `NotebookPage.writingChanged` branches; the typing case checks Core's
confirmed words, focus and each painted frame. CSS mutants break the laptop
row, the phone row and the old status width cap separately and restore each rule.

## The page's menu (792)

Text and Cards share Star, Rename and Delete in the existing ⋯ menu, in the
composer and on the full page. Rename edits the title in place using the same
revision journal as the words. Delete confirms once, retains the page's history
and offers Undo. Core supplies deletion permission: the page's creator or the
outcome's owner, with access, in an open outcome. A reader's star is personal.
The command, migration, recovery and old-link rules are in
[the page menu contract](notebook-menu-792.md).
