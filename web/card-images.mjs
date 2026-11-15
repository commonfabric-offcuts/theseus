// A message's images in its card (item 474, docs/topic-reading.md "Images in
// a card"): on the topic page, in the Conversation and in a dossier, each
// verified inline image a message carries shows as a thumbnail after its
// words, the right rail's size, in the order it was sent. A press on the card
// opens the Reader as before, where each attachment keeps its Open. A message
// with no image draws nothing new.
//
// Each thumbnail reads its bytes through its own message (read), so Theseus
// gives them only to someone who may read that message, and the reads take
// turns with every other image read on the page (image-pick.mjs, paintThumb).
// A thumbnail holds its place while it loads; one whose read brings nothing
// (refused, or the message no longer readable) shows the image's name.
import { paintThumb } from './image-pick.mjs';

const INLINE = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

// The attachments a card shows as thumbnails: the verified inline images, in
// the order sent. Anything else, a file or an SVG, the Reader offers alone.
export const cardImages = item => (item?.attachments ?? []).filter(attachment => attachment?.inline === true && INLINE.includes(attachment.content_type));

// Puts card's thumbnails in place after its words (and the excerpt's cue): one
// strip, each image a square named for a screen reader and under the pointer
// by its file's name. read(attachment) gives the image's bytes, read through
// the message. Painted again (an edit, a hold lifted), a thumbnail kept stays
// the same element and is not read again.
export function paintCardImages(card, item, read) {
  const images = cardImages(item), doc = card.ownerDocument;
  let strip = card.querySelector(':scope > .card-images');
  if (!images.length) { strip?.remove(); return; }
  if (!strip) { strip = doc.createElement('span'); strip.className = 'card-images'; }
  const after = card.querySelector(':scope > .message-preview-cue') ?? card.querySelector(':scope > .message-preview');
  if (after ? after.nextElementSibling !== strip : strip.parentElement !== card) { if (after) after.after(strip); else card.append(strip); }
  const keys = images.map(attachment => `${item.id}:${attachment.id}`);
  for (const host of [...strip.children]) if (!keys.includes(host.dataset.key)) host.remove();
  images.forEach((attachment, index) => {
    const key = keys[index], name = attachment.name || 'Image';
    let host = [...strip.children].find(each => each.dataset.key === key);
    if (!host) {
      host = doc.createElement('span'); host.className = 'card-image'; host.dataset.key = key; host.setAttribute('role', 'img');
      const words = doc.createElement('span'); words.className = 'card-image-name'; words.setAttribute('aria-hidden', 'true');
      host.append(words);
      paintThumb(host, key, () => read(attachment), image => host.prepend(image));
    }
    if (strip.children[index] !== host) strip.insertBefore(host, strip.children[index] ?? null);
    host.setAttribute('aria-label', `Image: ${name}`); host.title = name;
    host.lastElementChild.textContent = name;
  });
}
