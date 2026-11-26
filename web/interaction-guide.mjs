// How Theseus answers the pointer, the keyboard and a finger, on one short
// page (docs/interaction.md holds the same rules and the checks that keep
// them). Each rule says the pointer's way, the keys' and the phone's. It opens
// quietly: the ? key anywhere outside writing, or the small ? under who you
// are at the foot of the side rail (on a phone, the end of its drawer or of the page).
import { closeOnOutsideClick } from './dismiss.mjs';

export const TITLE = 'Pointer, keys and taps';
export const RULES = [
  ['Light a message', 'Point at it, or Tab or ↑ ↓ to it; on a phone, tap it. It lights, and its buttons show over its corner: 👍, Reply and ⋯, and ✅ 🚫 when it asks you for a go-ahead; Tab goes on to them, and to the ☆ in its header that stars it for you. Pointing at it or clicking in it also puts the keys there, so ↑ ↓ and Return go on from it, without scrolling and never out of your writing. Click it once it is lit to open it in the Reader; on a phone, tap it again, or tap anywhere else to let the light go.'],
  ['Reply', 'Return replies to the message or dossier showing its strong outline, using the same reply bar as its Reply arrow. With nothing outlined, Return opens New message on the current page without navigating. Hovering a rail topic is not selecting it. A button or link showing its focus ring keeps its activation, and writing keeps Return. Return quotes the passage lit under the pointer, as in the Reader: a sentence, a list item or a block of the message lights as you point at it, and Shift grows the light. Light off at the rail’s foot turns pointer passage lighting off on this device; keyboard outlines and selected text keep working. To quote part of it, select that part on the card or in the Reader and press Return, or the ❝ Quote that shows. The ✎ beside a topic\'s title starts a new message there, and so does ⌘Return anywhere on the page outside writing.'],
  ['The reply', 'While you read, the reply is one line under the message: +, the field, and 👍. Tap or Tab into the field to write. Above it the chip says what Send does and who sees it, such as "Ask fable · everyone here"; press it to choose Ask, Tell or Whisper and who it goes to, then Done. + holds Add image, your private note and Quote. A press on the message, or Escape, puts a panel away; your writing stays. Moving to another message keeps the reply you began, and says so. On a phone ↑ Previous and ↓ Next sit at the end of the message, ⤢ makes the field taller, and a panel takes the keyboard\'s place.'],
  ['Pencil sheet keys', 'Option-N opens the pencil sheet in Note mode; Option-M opens it in Message mode. Either switches the open pencil while typing, keeping writing and selection without inserting a character. If a mode change is held, its shortcut still does not type into the pencil’s own field. After clicking Note or Message, Return and ⌘Return both send through the usual Send guards. Elsewhere in the sheet or its inline composer, Return sends when no text field holds the caret. In text, Return still makes a new line and ⌘Return sends. A page picker or naming dialog keeps its own Return. A phone has no Option key.'],
  ['Naming someone', 'On a laptop, To in the chip\'s panel shows the topic\'s people: click one to name them, or type any name and press Return, Done or Escape. On a phone, To shows who is named, each with ×, and + Someone, which opens Name someone over the screen: tap people, or type a name and press Return. Done, ← or Escape brings you back with your writing as it was, and names anyone you typed. A name you typed and did not name stays in To with that reply, and Send waits on it until you name them or clear it. Or start what you write with @ and a name, as in "@auditor can you look?": it goes to the people you named that way and no one else by name, even as a reply to someone else, and the line under the chip says "To auditor" as you type. An @word that is nobody here stays as words, and the message goes where it would have.'],
  ['👍', 'Read and understood, said without writing anything. It is never "do it". It marks that message read at once, here and wherever you are signed in; taking it back leaves it read. Press or tap it again to take it back. A message\'s 👍 count names who: point at it, or on a phone tap the message. In the Reader it sits on the reply\'s line and beside Send; pressed there, it closes the Reader as Send does, and whatever you wrote is kept.'],
  ['Copy a message', 'With a message lit (pointed at, or reached with the keys) and no words selected, ⌘C copies its words as written, or exactly the passage lit under the pointer; off a Mac, Ctrl-C. In the Reader ⇧⌘C copies the message shown. With words selected, or in writing, ⌘C copies as it always does.'],
  ['⋯', 'The message\'s menu: mark icons for Star, Read/Unread, Archive and Copy link, then its actions and grouped keys. Start new offers separate Topic and Dossier buttons when both are available; Edit appears on a message of your own. Rename uses the dossier pencil. Joined | Broken out is at the left rail\'s foot; Wide/Stacked stays in the Reader\'s menu. On a laptop a right-click on the message opens it too, where the pointer is; on a phone the Reader\'s ⋯ opens from the bottom.'],
  ['Edit a message', 'Edit in a message\'s ⋯, on a message of your own, opens it in the Reader as a field holding its words: fix them and Save, or ⌘ Return; Cancel leaves the message as it was, and Escape leaves the edit with your words kept on this device for the next Edit. Everyone sees the new words, marked Edited. If it was edited elsewhere meanwhile, choose Save mine or Use saved. While you edit, ⌘↑ and ⌘↓ do not move to another message.'],
  ['✅ and 🚫', 'An agent asking for a go-ahead offers them on the message and on its buttons, one tap each. Your answer is kept on the message and reaches the agent as your reply.'],
  ['A message that is cut off', 'Rest the pointer on it and scroll it where it is with the wheel or trackpad; on a phone, tap it, then drag inside it with a finger. Drag outside it to scroll the page.'],
  ['Images while writing', 'Paste an image into the writing, or press Add image. Type #img to pick one of this topic\'s recent images from a short list: ↑ ↓ and Return, or tap one. When the browser can tell your clipboard holds an image, the button says Paste image. An image that needs a choice says so where Saved sits; pressing Send then opens its choices. On an iPhone or iPad, press and hold in the writing and tap Paste.'],
  ['Moving through the panes', 'On a topic or a Conversation, ↑ and ↓ move through the outline\'s outcomes and topics, and Return on a row showing its focus ring opens it: an outcome opens its home with its topics, without folding other outcomes. ⌘→ and ⌘← open and fold an outcome, and ⇧⌘→ and ⇧⌘← every outcome, including those loaded later; later individual folds are kept as exceptions. → and ← open or fold, then move between the outline, the messages and the right rail, each keeping its place: → on a folded outcome opens it, the next → lands on its pencil, and the next goes on to the messages. Return on an outcome\'s pencil opens a new topic\'s title line there; ↑ from the first outcome reaches the Outcomes pencil, where Return starts a new outcome. On a laptop the pencils show where the pointer or the keys are; on a phone they always show. In the messages ↑ and ↓ move the light, and ↑ from the top message reaches the buttons above it, such as Topic settings and New message: ← and → move along them, Return or Space presses one, ↓ selects the first card or stack in the feed. In the right rail ↑ and ↓ move through its sections, which → and ← open and fold as in the outline (⌘→ and ⌘← too). ⌘Return starts a new message in the topic the keys are on, or in an outcome\'s Conversation; in writing it sends. ⌘↑ and ⌘↓ move an outcome, or a topic within its outcome, up or down: your order is kept wherever you sign in, and ⌘Z puts the last move back. Everywhere else, on every page and in a pop-up, an arrow moves to the nearest button or link that way, so the arrows reach whatever a click does: ↑ from the outline\'s top (the Outcomes pencil) goes on to the rail\'s chips and the logo, and ↓ past the last message to People, the Notebook and the reply. None of these keys act in writing. The outline\'s Keys lists them.'],
  ['Dim the left rail', 'Option-click a topic or outcome name in the left rail to dim or undim it. Option-Shift-click keeps only that topic and its outcome, or the clicked outcome’s branch, bright. Command-click opens the link in a new tab.'],
  ['Reply stacks', 'Replies gather under the message they answer, oldest first as a chat reads, with that message on top as one row: who began it, its short name, who replied and how many are new. Press the row to show the message whole. Click the name or ✎ to rename it for everyone here: Return or Escape saves; Space folds and opens it. A line stands for each run of replies folded away, with how many are new in red; press it to open them. Reply on a message’s bar, or Return on the visibly outlined message or dossier, opens its reply composer. On a message, ⌘↑ and ⌘↓ move its stack up and down in your own order; ⌘→ archives the selected dossier for you alone (a selected message archives its containing dossier), → shows every message and ← only the latest and unread; another → when fully open moves to the right siderail, and another ← at latest and unread moves to the left siderail. ⇧⌘↑ and ⇧⌘↓ open a choice naming both dossiers; explicitly confirm Join to combine them for everyone, after which every message of both reads oldest first as one stack and a new reply lands at the bottom (Split back out takes it out again), and ⌘Z puts the last back. ⋯ holds the same, and Star for me, which keeps a message in view and in the right rail\'s Starred, for you alone. Fold on ⋯, or x on the selected message, makes a message one line, who wrote it and its first words, for you alone, on every device, in every state of its stack, until you unfold it: press or tap that line, Unfold on ⋯ or x again, and ⌘Z undoes a fold you just made. A reply or a 👍 of yours folds the message for you too, and ⌘Z leaves that fold; its line keeps its 👍. A starred message is not folded. Swipe a dossier’s header or last visible message right to archive the whole dossier for you, on every device. Your own replies leave it there; a new reply from someone else brings it back. Archived (n) shows the archived dossiers. Archive and Bring back are also in ⋯, and in the Reader as the archive button beside the star, which says how many messages go; ⌘Z undoes a move. On a laptop, two fingers swiped right on the trackpad fold other messages, and swiped left over a folded line unfold it. On a phone ⋯ opens from the bottom, with Move or join… for the stack\'s moves; a message swiped right folds, and its line swiped left unfolds.'],
  ['Moving lines', 'In writing, ⌥↑ and ⌥↓ move the line, list item or paragraph you are on, or those selected, above or below its neighbour; ⌘Z puts it back. A phone has no such key.'],
  ['Escape', 'Closes what is open, keeping your writing; so does ✕. A click or tap outside a pop-up closes it too.'],
  ['?', 'The ? key opens this page, and so does "? Pointer, keys and taps" at the foot of the side rail, under who you are (on a phone, at the end of what ☰ opens, or of the page).'],
];

export class InteractionGuide {
  constructor(doc = document) { this.doc = doc; this.dialog = null; }
  build() {
    const doc = this.doc, dialog = doc.createElement('dialog');
    dialog.className = 'interaction-guide'; dialog.setAttribute('aria-labelledby', 'interaction-guide-title');
    const header = doc.createElement('header'), title = doc.createElement('h2'), close = doc.createElement('button');
    title.id = 'interaction-guide-title'; title.textContent = TITLE;
    close.type = 'button'; close.textContent = '✕'; close.setAttribute('aria-label', 'Close'); close.onclick = () => dialog.close();
    header.append(title, close);
    const list = doc.createElement('dl');
    for (const [term, words] of RULES) {
      const dt = doc.createElement('dt'), dd = doc.createElement('dd');
      dt.textContent = term; dd.textContent = words; list.append(dt, dd);
    }
    dialog.append(header, list);
    closeOnOutsideClick(dialog, () => dialog.close(), doc.defaultView);
    doc.body.append(dialog);
    return dialog;
  }
  open() {
    this.dialog ??= this.build();
    if (!this.dialog.open) this.dialog.showModal();
  }
  // The quiet way in: a small ? under the instance label, a full tap high on a phone.
  // One the page before drew, put back with the rail's foot by a move in place
  // (in-place-navigation.mjs), gives its place to this one.
  offer(label) {
    const there = label?.parentElement.querySelector('.guide-open');
    if (!label || (there && there === this.button)) return;
    const button = this.button = this.doc.createElement('button');
    button.type = 'button'; button.className = 'guide-open quiet'; button.textContent = '? ' + TITLE;
    button.title = TITLE; button.setAttribute('aria-label', 'How Theseus answers the pointer, keys and taps');
    button.onclick = () => this.open();
    if (there) there.replaceWith(button); else label.after(button);
  }
}

// Whether a key press is the ? that opens the guide: not while writing or in a pop-up.
export function asksForGuide(event, doc = document) {
  if (event.key !== '?' || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return false;
  const at = doc.activeElement;
  if (at && (at.matches?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))) return false;
  return !doc.querySelector('dialog[open]');
}
