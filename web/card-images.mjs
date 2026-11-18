// A message's images in its card (item 474, docs/topic-reading.md "Images in
// a card"): on the topic page, in the Conversation and in a dossier, each
// verified inline image a message carries shows as a thumbnail after its
// words, the right rail's size, in the order it was sent. A press on the card
// outside a thumbnail opens the Reader as before; a thumbnail opens its image in a new tab. A message
// with no image draws nothing new.
//
// Each thumbnail reads its bytes through its own message (read), so Theseus
// gives them only to someone who may read that message, and the reads take
// turns with every other image read on the page (image-pick.mjs, paintThumb),
// behind the composer's own and the right rail's. A thumbnail is read only
// once its square is drawn near the window (whenNear): a card shown as one
// row (folded, between others, behind an earlier-messages row) or far from
// the window reads nothing until it is drawn as a card and comes near.
// A thumbnail holds its place, blank, from the moment its square is made: one
// not yet near is marked as coming (data-coming), so the square never draws
// the image's name before its picture is asked for. Once asked for, the hidden
// picture holds it while it loads; one whose read brings nothing (refused, or
// the message no longer readable) shows the image's name.
import { paintThumb } from './image-pick.mjs';

// How near the window a square is read: half a window above and below, so a
// card scrolled to has its pictures on the way before it shows.
const NEAR = '50% 0px';
// The squares drawn and not yet near, each with the paint that reads it. A
// square with no box (display:none: its card a row, or hidden) never
// intersects, so it waits until it is drawn and near (IntersectionObserver).
const waiting = new Map();
let near = null;
function whenNear(host, paint) {
  near ??= new IntersectionObserver(seen => {
    for (const each of seen) if (each.isIntersecting && waiting.has(each.target)) { const go = waiting.get(each.target); forget(each.target); go(); }
  }, { rootMargin: NEAR });
  waiting.set(host, paint); near.observe(host);
}
function forget(host) { if (waiting.delete(host)) near.unobserve(host); }

const INLINE = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

// The attachments a card shows as thumbnails: the verified inline images, in
// the order sent. Anything else, a file or an SVG, the Reader offers alone.
export const cardImages = item => (item?.attachments ?? []).filter(attachment => attachment?.inline === true && INLINE.includes(attachment.content_type));

// Puts card's thumbnails in place after its words (and the excerpt's cue): one
// strip, each image a square named for a screen reader and under the pointer
// by its file's name. read(attachment) gives the image's bytes, read through
// the message, once the square is drawn near the window. Painted again (an
// edit, a hold lifted), a thumbnail kept stays the same element and is not
// read again.
export function paintCardImages(card, item, read) {
  const images = cardImages(item), doc = card.ownerDocument;
  let strip = card.querySelector(':scope > .card-images');
  if (!images.length) { strip?.remove(); return; }
  if (!strip) { strip = doc.createElement('span'); strip.className = 'card-images'; }
  const after = card.querySelector(':scope > .message-preview-cue') ?? card.querySelector(':scope > .message-preview');
  if (after ? after.nextElementSibling !== strip : strip.parentElement !== card) { if (after) after.after(strip); else card.append(strip); }
  const keys = images.map(attachment => `${item.id}:${attachment.id}`);
  for (const host of [...strip.children]) if (!keys.includes(host.dataset.key)) { forget(host); host.remove(); }
  images.forEach((attachment, index) => {
    const key = keys[index], name = attachment.name || 'Image';
    let host = [...strip.children].find(each => each.dataset.key === key);
    if (!host) {
      host = doc.createElement('span'); host.className = 'card-image'; host.dataset.key = key; host.setAttribute('role', 'group');
      const words = doc.createElement('span'); words.className = 'card-image-name'; words.setAttribute('aria-hidden', 'true');
      host.append(words); host.dataset.coming = '';
      whenNear(host, () => { delete host.dataset.coming; paintThumb(host, key, () => read(attachment), image => host.prepend(image), { later: true }); });
    }
    if (strip.children[index] !== host) strip.insertBefore(host, strip.children[index] ?? null);
    host.setAttribute('aria-label', `Image: ${name}`); host.title = name;
    host.lastElementChild.textContent = name;
  });
}

// A topic the reader can no longer read keeps none of its pictures (docs/topic-reading.md): its cards' thumbnails
// go at once, and with their images their bytes (image-pick.mjs lets a picture go when none of its images is in the
// page). A card painted again paints them again.
export function dropCardImages(list) {
  for (const strip of list.querySelectorAll('.card-images')) { for (const host of strip.children) forget(host); strip.remove(); }
}
