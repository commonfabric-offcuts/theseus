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

The message's own acts are in the Reader's ⋯, beside Copy Link: Quote
selection (only while words are selected or a passage is lit), Mark unread,
Start a topic from this, and Add to pipeline, and Wide or Stacked layout
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
  A 👍 given here, while the reply is open, is a reply of one thumb: once
  Core holds it the Reader closes, as after Send, keeping what the reply
  holds (who it goes to and how) for the next time the message opens. A 👍
  Core refuses leaves the Reader and the reply open, and says why; one given
  on the quiet line, or taken back, leaves the Reader as it is.
  Send stands clear of the field, so a touch between them never sends.

The field grows with its writing, then scrolls: up to four lines on a laptop
and three on a phone, where a toggle makes it taller, so the message keeps
its room however long the reply. Wide gives the reply a whole column.
Escape, a press outside, or opening another message folds the composer back
to its line; the writing is kept. Showing the same message again (choosing
In, adopting a saved version, its access checked) is no move: the composer,
an open panel, the focus and the place in the message stay as they were, so
a phone's keyboard or panel stays up. Writing left in one message's reply is
kept when the Reader moves to the next, and the notice says "Your reply to
the last one is kept". After Quote, the quoted passage is scrolled to just
above the reply, and kept there while the reply and the keyboard change the
message's room, until the message is scrolled. On a phone the ❝ Quote pill
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
the popped New message sheet, the topic page's end, where no dialog is
open), so no surface passes the key on; a dialog it is not in keeps its
own Escape (`web/compose-bar.mjs`, `heard`). A panel goes with its
composer: a surface that closes or hides with a panel open (the Reader
closed by ⌘⇧Return, the topic page giving way to another view) puts the
panel away, naming no one, and a composer no one sees hears no keys, so
Escape is always what is shown now's (`unseen`).

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

## New message

A quiet ✎ at the top of a topic opens the same composer with no message
above it, focused and ready to type. It is the only control it adds to the
page. ✕, Escape or a press on the backdrop closes it, keeping what was
written, and focus returns to ✎.

## What the checks see

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
