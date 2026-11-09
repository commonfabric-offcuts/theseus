// How Theseus answers the pointer, the keyboard and a finger, on one short
// page (docs/interaction.md holds the same rules and the checks that keep
// them). Each rule says the pointer's way, the keys' and the phone's. It opens
// quietly: the ? key anywhere outside writing, or the small ? under who you
// are at the top of the side rail (on a phone, the top of the page).
import { closeOnOutsideClick } from './dismiss.mjs';

export const TITLE = 'Pointer, keys and taps';
export const RULES = [
  ['Light a message', 'Point at it, or Tab or ↑ ↓ to it; on a phone, tap it. It lights, and its buttons show over its corner: 👍, Reply and ⋯, and ✅ 🚫 when it asks you for a go-ahead; Tab goes on to them. Click it once it is lit to open it in the Reader; on a phone, tap it again, or tap anywhere else to let the light go.'],
  ['Reply', 'Return, or Reply on its buttons, opens the lit message with the cursor in your reply. To quote part of it, select that part in the Reader and press Return.'],
  ['👍', 'Read and understood, said without writing anything. It is never "do it". Press or tap it again to take it back. A message\'s 👍 count names who: point at it, or on a phone tap the message. In the Reader it sits beside Send.'],
  ['⋯', 'The message\'s menu: Copy Link, and Mark unread or Mark read. On a laptop a right-click on the message opens it too, where the pointer is.'],
  ['✅ and 🚫', 'An agent asking for a go-ahead offers them on the message and on its buttons, one tap each. Your answer is kept on the message and reaches the agent as your reply.'],
  ['A message that is cut off', 'Rest the pointer on it and scroll it where it is with the wheel or trackpad; on a phone, tap it, then drag inside it with a finger. Drag outside it to scroll the page.'],
  ['Images while writing', 'Paste an image into the writing, or press Add image. Type #img to pick one of this topic\'s recent images from a short list: ↑ ↓ and Return, or tap one. When the browser can tell your clipboard holds an image, the button says Paste image. On an iPhone or iPad, press and hold in the writing and tap Paste.'],
  ['Moving lines', 'In writing, ⌥↑ and ⌥↓ move the line, list item or paragraph you are on, or those selected, above or below its neighbour; ⌘Z puts it back. A phone has no such key.'],
  ['Escape', 'Closes what is open, keeping your writing; so does ✕. A click or tap outside a pop-up closes it too.'],
  ['?', 'The ? key opens this page, and so does "? Pointer, keys and taps" at the top of the side rail (on a phone, the top of the page).'],
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
  offer(label) {
    if (!label || label.parentElement.querySelector('.guide-open')) return;
    const button = this.doc.createElement('button');
    button.type = 'button'; button.className = 'guide-open quiet'; button.textContent = '? ' + TITLE;
    button.title = TITLE; button.setAttribute('aria-label', 'How Theseus answers the pointer, keys and taps');
    button.onclick = () => this.open();
    label.after(button);
  }
}

// Whether a key press is the ? that opens the guide: not while writing or in a pop-up.
export function asksForGuide(event, doc = document) {
  if (event.key !== '?' || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return false;
  const at = doc.activeElement;
  if (at && (at.matches?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))) return false;
  return !doc.querySelector('dialog[open]');
}
