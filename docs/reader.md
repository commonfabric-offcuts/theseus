# The Reader and its composer

The Reader is for reading a message and replying to it. The message takes
the room; the reply is as small as its writing lets it be. The topic's new
message is the same composer with no message above it.

## Reading

While reading, the only thing under the message is one quiet line: `+`, a
field that says who a reply would go to ("Tell fable · everyone here"), and
👍 for a reply of one thumb; `+` and 👍 wear no ring or fill until pointed at.
Nothing under the message is boxed. A draft already written shows a Draft
tag on the line, and one waiting to be reviewed shows its chip ("1 reply may
not have sent", read whole by a screen reader).

The Reader's title names the dossier a reply there goes into (item 561):
its name, typed or minted, as the dossier's tab shows it, and for a dossier
nobody has named yet its first message's first line, never the oldest reply
the page has loaded (item 550). Where the page cannot say (that first message
is not loaded, or the topic's updates are paused), the dossier Core sends with
the message read as a source says: its first message's id, its name, that
message as it begins and whether the dossier is that message alone
(`dossier` in the `source` view, `stacks.source_dossier`; none for a reader
who reads only that message, sent to them by name). A message of its
own, which nobody answered or named, has the topic's name. A name given while
the Reader is open shows at once. However long, the title keeps one line, cut
off with an ellipsis, so the star, the archive button and ✕ keep their place;
a press on it goes back to the topic, as ← does (`StackFeed.dossierName`,
`readerDossierName` in `app.mjs`, `Reader.paintTitle`).

A message of a dossier with a cover (item 624, [dossier-covers.md](dossier-covers.md))
shows the cover as one quiet line above the message: "Cover", where the dossier
stands, and its payload's pill, also when the dossier's first message is above
the loaded page. A press opens the whole sheet, for that message: another
message, the same one opened again, a message whose dossier becomes another,
and a cover that goes and comes back each start at the closed line. The line
follows the cover as the page's stacks do, while the Reader is open, and a sheet
opened stays open as its cover changes (`StackFeed.dossierCover`,
`Reader.paintCover`). A message on its own, or one of a dossier with no cover,
shows none. On a phone the line gives way while the reply is written, so with
the keyboard up the message keeps its 7 lines.

A star beside the message's title stars it for you, and pressed again
unstars it: outline until starred, filled once starred, "Star for me" or
"Unstar" by name, a 44 pixel target under a finger. It is the card's ⋯ Star
for me (`StackFeed.star`), so the card and the Reader agree; it shows for
any message of the topic, never for a Notebook page. A message no loaded page
holds (opened alone, from a link to an older message) has its star and Fold
message too: the page reads its acts with the loaded messages', and again
whenever they change (`TopicViews.showAlone`), so a star made on another
device shows there as well.

Beside the star, an archive glyph with a number is Move below More for the
message's whole dossier (item 378): the same act as the card's ⋯ Move below
More (`StackFeed.setAside`), and the number is how many messages move below
More with it, the message itself included. The act moves the whole dossier,
which the page draws as one stack whether or not it has loaded its first
message (item 550), with any older message of it More messages showed where
its button was as a card of its own, so the count is of every stack the page
draws of the dossier ("Move below More: 3
messages" by name and as its tooltip). Once the dossier is below More it shows
pressed and brings it back ("Bring back above More: 3 messages"), as ⋯ does.
The Reader stays open on the message and the focus stays on the button; the
page behind it changes as after ⋯'s item, and ⌘Z on the page puts it back. It
shows for a message the page's stacks hold whose dossier Core placed, and
never for a Notebook page, a message opened alone (of this topic, from a link to
an older message, or of another topic, from an About link) or a message Core
sent no place for, which ⋯ offers no move either: moving on to one of these
from a message it showed for, the button goes; a 44 pixel target under a finger (`paintReaderAside` in
`web/app.mjs`, `StackFeed.asideOffer`). Pressed, it shows the move at once,
while Core has it; a refusal puts it back unpressed and the page says why. A
phone's header has no room for ←, the title with its star and this button,
↑ ↓, ⋯ and ✕ in one row of 44 pixel targets, so there (480 pixels wide or
less) the title, its star and the archive button take a second row, and who
wrote the message and when stays in the first, beside ←. The title stays
whole there. The two rows cost the message no more than their 44 pixel
targets (item 593): the header keeps no padding above or below them, and the
message starts right under it, with no gap of the pane's own above it, so
with a long reply and the keyboard up a phone still shows 7 lines of the
message. The access notice, when the pane shows it above the message, keeps
the pane's gap under the header in each of its states, and the message keeps
its own room after its end, under ↑ Previous · ↓ Next. A laptop's header, and
a phone's of one row, keep their room as before.

The message's own acts are in the Reader's ⋯, beside Copy Link: Quote
selection (only while words are selected or a passage is lit), Mark unread,
Fold message (Unfold message once folded; a starred message offers none, as
on the card), Start a topic from this, and Add to pipeline, and Wide or Stacked layout
where the window can choose. Pressing the ⋯ or + can move the focus and let
the selection go, so what Quote selection quotes there is what was chosen
as it was pressed, by a pointer, a finger or the keys. ↑ and ↓ in the
header step to the message above and the message below as the topic page
shows them: inside a reply stack, ↓ goes down to its newer replies and then
on to the stack below (docs/reply-stacks.md). On a phone the ⋯ is a sheet
from the bottom, and the message ends with a quiet "↑ Previous · ↓ Next".

## Writing

A press or Tab into the field makes it the composer:

- **The who chip** says in words what Send will do and who sees it:
  "Tell fable · everyone here", or, dashed, "Whisper to fable · only you
  two". A press opens the who panel: the full sentence of who sees it first,
  then How (Whisper, Tell, Ask), To, and In where the reply could go to
  another topic; Done closes it. On a laptop To is the topic's people,
  tapped to name them, and a field for anyone else; on a phone naming is
  two steps (below).
- **Where it goes**, when In sends the reply to the outcome's conversation:
  the chip says so ("Tell fable · in the conversation"), and so does the
  panel's sentence ("Everyone in the conversation will see this"). A line
  under the chip says it goes there with a link to this message, who
  answers there, and that nobody in this topic is woken. With nothing
  written, the field says it too ("Reply to fable in the conversation…").
- **The save status** sits beside the chip: Saved, or what is wrong. The chip
  is as wide as its words, short of the room "Saved to Theseus" needs, and
  never moves as the status changes. An image
  that still needs a choice is named there ("Finish IMG_3307.heic first")
  and Send is dimmed but still pressable: a press says the whole sentence in
  the notice above the composer and opens that image's choices.
- **Images** are a strip of thumbnails above the field, each with its × to
  remove it. A mark sits on one that needs a choice; a press on the
  thumbnail opens its name, state and choices in place.
- **+** holds Add image, Paste image when the clipboard has one, the note
  (Add note, Show note) and Quote. A tile does its one thing and puts the
  panel away.
- **Send** names what it does: Tell, Whisper or Ask. With nothing written it
  is dimmed, and 👍 stands beside it, as on the quiet line, so the cursor
  Return or Reply puts in an empty reply never hides 👍; it goes once a word
  is typed, and comes back when what was typed is all deleted. Send's dimming,
  👍 and the line's Draft tag read one rule, whether anything is written
  (words or an image, `web/editor.mjs` `written`): who the reply goes to,
  how it asks and where it is posted are not writing, so choosing them, or
  moving the reply to the conversation, never hides 👍. In Wide, 👍 is on
  the row under the field, so the field keeps the column's width either way.
  A 👍 given here or on the quiet line is a reply of one thumb: once Core
  holds it the Reader closes, as after Send, keeping what the reply holds
  (who it goes to and how) for the next time the message opens. A 👍 Core
  refuses leaves the Reader and the reply open, and says why; one taken back
  leaves the Reader as it is.
  Send stands clear of the field, so a touch between them never sends.

The field grows with its writing, then scrolls: up to four lines on a laptop
and three on a phone, where a toggle makes it taller, so the message keeps
its room however long the reply. Wide gives the reply a whole column, and
the New message sheet the whole sheet ("Size", below).
Escape, a press outside, or opening another message folds the composer back
to its line; the writing is kept. Showing the same message again (choosing
In, adopting a saved version, its access checked) is no move: the composer,
an open panel, the focus and the place in the message stay as they were, so
a phone's keyboard or panel stays up. Writing left in one message's reply is
kept when the Reader moves to the next, and the notice says "Your reply to
the last one is kept". Quoting keeps your place: the quote lands at the
end of the reply with the cursor after it, as it always has, and the message
does not move, so the words quoted stay where they were on screen and the
topic page behind the Reader stays where it was. What is kept in sight is the
words quoted, as much of them as showed, not the whole passage they are in: a
code block, a table, a quote or a list item is one passage, and an agent's
log can be taller than the screen, so a line quoted from near its end, or from
the middle of a block that runs past both edges, stays where it was. Only
where the reply opening, or the keyboard coming up, would cover the words does
the message move, the least that shows them just above the reply, or, when
they are taller than the room left, that fills it with them from where they
start. Words quoted from out of sight (from the ⋯, say) come into sight the
same least way: from below, their end just above the reply; from above, their
start at the top (their end at the bottom when they are taller than the
room). So they stay while the reply and the keyboard change the message's
room, until the person scrolls the message, however they do it: the wheel,
a finger, the keys, or a drag of its scrollbar. Any scroll the Reader did not
make itself lets the words go, so the reply's next change of size moves
nothing; only the browser's own pull of a message scrolled to its end, as its
room grows there, is not the person's. What is kept is the words themselves:
once the lines wrap anew (a phone turned, the window made narrower, Wide and
Stacked changed) they are measured again where they now are, not held at the
height they had. Words chosen by a drag let go at the very start of the next
passage are kept in the passage holding the last word chosen, not the next
one. Typing in the reply never pulls a message scrolled to its end down: the
reply measures itself at no height at each key, which for that moment gives
its room to the message, and the message is put back as it was. On a phone the ❝ Quote pill
takes what is selected as the finger presses it, since the press itself can
let the selection go.

Every control of a composer, in every state, is a 44 pixel target under a
coarse pointer (one floor in `aim.css` under all of them, not a list of
them; the naming sheet is inside the composer, so its people, ×s and Add to
topic are held to it too), and every one can
be reached from the keyboard, in the order it is shown: the who chip, the
review chips, `+`, the field and Send. Escape while a panel is open closes
it, wherever the focus is, and returns focus to what opened it. The
composer hears that Escape itself, on every surface it sits in (the Reader,
the popped New message sheet, its place in the topic page's feed, where no dialog is
open), so no surface passes the key on; a dialog it is not in keeps its
own Escape (`web/compose-bar.mjs`, `heard`). A panel goes with its
composer: a surface that closes or hides with a panel open (the Reader
closed by ⌘⇧Return, the topic page giving way to another view) puts the
panel away, naming no one, and a composer no one sees hears no keys, so
Escape is always what is shown now's (`unseen`).

## Size

The Reader, where the composer has the message beside it, and the New
message sheet, where it stands alone, are as tall as what shows of the window
and grow with its width up to a maximum (item 400). On a laptop each keeps
1.5rem of the dimmed page on every side and is at most 72rem wide, 100rem in
Wide; the window decides the size, so it changes when the window does and
never with what is written. A wider Reader changes what wraps and what
overflows at 1440, so the native checks' message has one passage longer than
any line, and the check that scrolls it reads it in a shorter window. On a phone, as in any window 760px wide or
narrower, each is the window's width and as tall as what shows, above the
keyboard when it is up (the sheet leaves .75rem of the dimmed page above it),
so nothing goes past the screen, sideways or down, and Send stays in reach
with the keyboard up. A phone turned sideways is wider than that, and is
sized as a small laptop window. In Wide the reply's column is the Reader's
whole height; in the New message sheet the composer is the sheet's height
and its field takes what the head, an open panel and the images leave, then
scrolls, so there is no taller toggle (⤢) there, while the stacked Reader's
field keeps it where the window is narrow; on a laptop the sheet's who panel
opens in it under the head, and + over the field's foot, as in Wide. Stacked, the reply
stays as tall as its writing and the message has the rest; where the Reader
is shorter than both (a small phone with the keyboard up, the reply holding
an image), the field gives way, down to one line, before the reply has to
scroll, so as much of the reply's head and images shows with Send as can.

Shorter still, as on a 320-point phone with the keyboard up and an image
whose Send was refused (its notice, the image's choices to Attach as
download or Remove, the head, the field and Send), the composer scrolls
inside itself: the stacked reply below the Reader's header where the window
is narrow (there its panels open in its flow, not over the message), the
composer inside the sheet. Every row above the field keeps its whole height,
so no row is drawn over another, and the field keeps one line. What has
focus shows: a press brings it into view as any focus does, and as the
keyboard comes up the composer the field is typed in scrolls itself, and
only itself, to bring the field, with Send on its row, back into view
(`web/compose-bar.mjs`, which reads the keyboard). A composer that does not
scroll (side by side, or in a wider window, a phone turned sideways among
them) is not moved, and the Reader, which clips what is past it, is never
scrolled: its header stays at its top. Nothing of the composer goes past
the screen, and every part of it is a scroll away. The sizes are in `web/aim.css` (`--widest`, the stacked reply's rows and the
sheet's), not measured in script.

## Layouts

- **Stacked** (a laptop's default): the message takes all the room the reply
  does not. There is no divider; the reply is as tall as its writing. The
  who and + panels are popovers over the bottom of the message, so the
  message does not move under them.
- **Wide**: the reply is a column beside the message, with its divider and
  share. The who panel opens inline in the column, and the hint (Return for a
  new line · ⌘ Return to send) has a line of its own under the field.
- **Phone**: the Reader follows the visible part of the window
  (`visualViewport`), so it sits above the keyboard. The who and + panels
  take the keyboard's place, at the keyboard's last height: opening one lets
  the keyboard go, and a press back in the field brings it back and closes
  the panel. A finger scrolling the message keeps the panel, as it would
  keep the keyboard.

The Reader's notices (an image to finish, a reply kept, a step that waits)
sit at the top of the reply, never over the message, so what is read stays
whole, the end line included. A notice says what last happened: it goes when
you write on, or when another message opens.

## Naming someone on a phone

Naming someone is two steps. The first covers as little of the message as
it can; the second may take the whole screen, as a modal does.

1. **The who panel**, in the keyboard's place. Its To row is one line
   whatever the team's size: who is named, each with a × to take them off
   (marked when they are not in the topic), scrolled sideways when there are
   many, then **+ Someone**. It never lists the team, so the message keeps
   the room it has while writing with the keyboard up.
2. **+ Someone** opens the naming sheet over the whole visible screen, the
   keyboard included: "Name someone" between ← and Done at its top, the
   topic's people a finger's height each (a tap names or un-names one), and
   at its foot, above the keyboard, the field for any name (Return names
   it). Everyone the sheet offers, who answers too where the reply is
   Answered by, is one list that scrolls between the head and the field, so
   the field stays above the keyboard and the last name can be scrolled to,
   however big the team. Someone named who is not in the topic shows "not in this topic", its
   ×, and Add to topic where the reader may add them. The sheet is a modal
   dialog (`showModal`), so Tab stays in it.

Done, ←, Escape or the system's back puts the sheet away, back to + Someone
in the who panel, with the writing, the message's place and the who panel as
they were; Done there goes back to the writing. A name left typed in the
field, or picked from its suggestions, is named by each of these as by
Return, and so is one left in a laptop's To field when the person puts the
who panel away by its Done or Escape, wherever the focus is when Escape is
pressed: in the panel, on the message, on + or on Send (`heard`). Only these acts of finishing with
naming name anyone, and each does nothing else, so what it changes shows in
the chip at once. A panel that goes for another act (a press on Send or
anywhere else, +, moving to another message) names no one: the name stays
typed in To with the reply it was typed for, back in To when that reply is
shown again, and never named in another. Send waits while a name is typed
and not named, since with or without them it would reach people the chip
did not say: To opens on that name, and the composer says "warp is typed in
To but not named yet." for as long as that is true. It goes as soon as they
are named (Return, a tap on them, a way out that names), To is cleared or
holds another name, or other writing is shown, so it never stands beside a
chip that reaches them. A name the writing already names holds nothing
(`web/compose-bar.mjs`, `takeName`, `writes`, `holdSend`, `settle`). While the sheet is open the
message is hidden on purpose. On a laptop To keeps its one row of the
topic's people and the field, in the who panel; the sheet never opens there
(`web/compose-bar.mjs`, `wireNaming`).

## Naming who a message is to

Writing in either composer (the Reader's reply and the topic's composer)
that starts with one or more @names, each naming a member of the topic, goes
to exactly those members, in place of the default: the author a reply
answers, or everyone with nobody named. "@auditor can you reply here?",
written as a reply to fable's message, goes to auditor, not fable. A member
is someone the topic's messages can be sent to: its participants and the
outcome's team, switched on, other than the writer, named by actor id or
name in any case (an id wins over a name; a name two members share names
nobody). The names are read from the start: each is "@" and a word of
letters, digits, `_`, `.` and `-`, ended by a space, the end, or one of
`, : ; ! ?` (a `.` ending it is not part of it). The first word that names no
member ends them, and an @word that names no member is plain text: the
default stands, and nothing is said of it. The words stay in the message as
written. Whether it whispers, tells or asks follows the composer's own rule
(docs/whispers.md): a Tell unless the person presses Whisper or Ask, and a
reply to a whisper, to its one agent, a whisper.

**The line under the chip** says who it goes to as it is typed, in the
composer's quiet words: "To auditor", "To auditor and fable", or the
default, "To fable" for a reply to fable and "To everyone here" for the
topic (`web/whisper-choice.mjs` `toWords`). The chip, Send's word and the
who panel's sentence follow the same names; the who panel's chips still
show who was named by a tap, and the name field still names them. The line
is small type set close under the chip, adding no gap of its own, and on a
phone the composer's padding gives a little, so it costs the message little
more than its own words: with a long reply, a phone with the keyboard up
still shows 7 lines of the message and a stacked laptop Reader 17
(`web/aim.css`; the floors are the `native-compose` "phone …" and "laptop
stacked …" cases).

**Core records it.** `submission.prepare`, which freezes the writing the
page saved, records as its addressees the members its leading @names name
(`aim_next/addressing.py`), whatever the draft named, so the message on the
record goes where the line said. The person it is addressed to answers it in
place, as anyone a message names (in the conversation, it is theirs to
answer: docs/conversation.md); the members it is not addressed to are treated
as for any message not addressed to them (docs/attention.md, "Messages
between others"). The page reads the same rule (`web/at-names.mjs`) only to
say it beforehand; both are held to one table of cases
(`tests/fixtures/at_names.json`). The topic's participants come with their
names (`topic.participants[].name`), as the team's do. Messages posted
through `message.post`, an agent's `post --asks/--tells`, keep the
addressees they name; messages already sent keep theirs; and a new topic's
opening, which names its people as it is made, is unchanged.

## New message

A quiet ✎ at the top of a topic opens the same composer with no message
above it, focused and ready to type. It is the only control it adds to the
page. ✕, Escape or a press on the backdrop closes it, keeping what was
written, and focus returns to ✎. At rest the same composer is drawn in the
feed, one line until written in, just above More: under the last dossier shown
above More and over the More line (item 465). It is never moved while it is up,
and a holder of its height keeps its place there, so no dossier behind the
backdrop moves, in Chrome or Safari's engine, by ✎ or by ⌘Return; the holder is
drawn only while the sheet is up, as the sheet's own open state says, read by
one rule in `web/aim.css` and taken away by no script, so the place comes back
the moment it closes, before any close event is heard (`web/sheet-holder.mjs`,
which a Notebook page in the sheet shares). It takes
that place again as it is put back (`home` in `web/reply-stacks.mjs`);
where the feed is not drawn (an outcome's page, Health, a topic the reader can
no longer read), a dialog in it would show nothing, so it rests at the page's
end instead, put back first if it was up, its writing kept, and goes up from
there, a Notebook page too (`drawFeed` in `web/app.mjs`).

A Notebook page opened as it stands comes up in the same sheet, with the
page's title, Text and Cards, its saving sign, Full page and ✕ in place of the
message's (docs/decks.md, "Where it opens"). A card's reply stack opens here in
the Reader, whose header then leads back to the page ("← page title").

## What the checks see

`tests/reader_compose_native.mjs` measures the size ("size …" cases, in
Chrome and WebKit): at 320×568, 375×667 and 390×844 with touch, at 480×300
without touch (a narrow window, laid out as a phone is), at 1440×960 stacked
and Wide, and at 2560×1440, past the maximum, with the composer empty,
holding a draft longer than its field (in the sheet, one written in its
place in the feed first), holding an image, and holding a HEIC image that waits on a
choice, its choices open (in the Reader by a refused Send, whose notice says
why), the Reader and the New message sheet are each measured against the
window: their height and width as above, the composer filling the sheet and
Wide's column, the field reaching the composer's foot, a long draft scrolling
inside the field, a composer that scrolls inside itself having its field at
one line (its minimum), no row of the composer drawn over another, what has focus
showing (with the field in hand, Send too), ⤢ in the stacked Reader where
the window is narrow and not in the sheet, and no control of the composer, nor
the page, reaching past what shows, a control in a part that scrolls
counting where that part is; on a phone again with the keyboard up. At
844×390 with touch, a phone turned sideways, the same states hold only that,
as the keyboard comes up, neither the Reader nor the sheet scrolls and the
Reader's header stays at its top.

"quoting keeps your place" (`native-compose`, at 390×844 with touch and at
1280×800 stacked and wide, in both engines) selects words in a passage a third
of the way down what shows, by a mouse's drag on a laptop, and quotes them by
Return while reading and again while writing (on the phone by the ❝ pill as
well): each time the passage's top stays within two pixels, the topic page
behind the Reader is where it was, the quote is exactly what it always added,
and the cursor sits after it with the field showing it. Return with nothing
chosen quotes nothing and moves nothing, on the message and in the writing
(a new line there); and words the opening reply would cover end just above
it. "quoting from a passage taller than what shows" (the same shapes and
engines) quotes from an agent's 70-line log in a code block: words from near
the top of what shows to near its bottom as the reply opens and, on the
phone, the keyboard comes up (they fill the room left, their start on the
screen); a line near the log's end with its top above the screen, the
message scrolled to its end; a line in the log running past both edges, the
keyboard then coming up on the phone; on a laptop the log lit whole by a
press. Each time what showed of the words moves only as far as the reply or
keyboard covers it, within two pixels. A line quoted from above what shows
comes into sight at its top, and words taller than the screen quoted from
above it come into sight with their end at its bottom.
"quoting: one who has not scrolled keeps the quoted words in sight as the
reply grows, and a scroll the person makes …" (1280×800 stacked, both
engines) quotes words wholly inside the message's room, just above where the
reply opens, and types a line: they stay above the reply (a line the room's
edge cuts off as it is quoted stays cut off as it was: what showed is what is
kept); then the message is scrolled on down past the words by a drag of its
scrollbar (in Chrome; Safari's engine draws an overlay scrollbar a headless
pointer cannot hold, so there it is scrolled from outside the page's code, as
the drag scrolls it) and a line is typed: the message stays where it was put,
the words not pulled back. The words are quoted again, kept in sight, then
scrolled back up past by the same drag and a line is deleted: the message
stays where it was put. Both directions are checked, since a scroll down is
the person reading on. "phone: quoting at the end of a message …" quotes the last words above
the reply of a message scrolled to its end, the keyboard going down and up
again: the words still show. "typing in the reply leaves a message scrolled
to its end at its end" types words with the message at its end. "quoting:
words chosen to the very start of the next sentence …" chooses a sentence up
to offset 0 of the next one, which begins the line below, just above where
the reply opens: the words chosen end just above the reply, not on the next
sentence's line. "wide:
quoting: once the lines wrap anew …" quotes the end of a long list item near
the bottom of what shows, then narrows the window: the words still show.

`tests/reader_compose_native.mjs` runs in Chrome for Testing and in
Playwright's WebKit at 390×844 with touch, and at 1280×800 stacked and wide,
in light and dark, in a topic with a team of seven; the release check runs
it as `native-compose`. On the phone, every state a case photographs is also
checked for controls under 44 pixels, among them both steps of naming
someone, after naming one of the team and someone who is not in the topic,
and the taller-field toggle is pressed there and pressed back. Naming is
checked in the Reader and in the New message sheet: the who panel names no
one it was not asked to and keeps To one line, the message keeps at least 7
lines with it open, the sheet fills what shows with the keyboard up and down
and is titled, Done, Escape and ← each come back to + Someone with the
writing and the place kept, and the keys alone reach every control of both
steps with Tab kept in the sheet. A name typed in the sheet's field is named
by Done, ← and Escape, and one typed in a laptop's To field by the panel's
Done and Escape, Escape pressed in the panel and, in the Reader and the New
message sheet, with focus on the message or on Send, and at the topic page's
end, the sheet not popped up, by the keys alone with focus on + or on Send, also after a Reader closed by ⌘⇧Return with its who or + panel open, which takes the panel with it; a press on the message names no one and leaves it in To;
stepping to another message by the keys alone, the who panel open, names no
one there and finds it typed on coming back; and Send pressed with it typed,
in the Reader and the New message sheet, sends nothing and opens To on it,
and what it says goes once they are named by Return or a click, or To is
cleared, and stays gone as the writing goes on; then, with To cleared, the
Reader's whisper reaches its one agent alone (last, as it sends) (`tests/ui_compose_naming.test.mjs` holds every way out
below the browser). Last, with the outcome's
conversation given a coordinator and a team of nine, Answered by is checked
on a phone on the conversation page and for a Reader reply sent there: the
field being typed in stays above the keyboard and the last name can be
scrolled to and tapped. A phone's keyboard is stood in for by
shrinking the viewport to 390×464 while a field has focus, which is what
`visualViewport` reports when a real keyboard comes up. What only a real
phone shows: the keyboard's own height and animation, the browser's bars
appearing and going, and the caret being kept in view by the system. In
WebKit, Tab moves only between fields and links unless Option is held, as in
Safari; the check presses Option-Tab there.
