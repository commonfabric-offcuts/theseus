// A card's image where a Notebook page is read rather than written: the Reader, and a page opened in place on its
// outcome's page (docs/decks.md "Images in a card"). The line ![name](attachment:ID) shows as the image, at the
// thumbnail size (653, aim.css), read through the page by read(attachment), so only someone who may read the page gets its bytes.
// An image the page does not carry shows its name alone, saying so, and nothing is read for it. Its name stays under
// the picture, for every reader.
import { lineImage } from './deck.mjs';
import { paintThumb } from './image-pick.mjs';

export function pageImage(doc, image, { attachments = [], read = null } = {}) {
  const figure = doc.createElement('figure'), caption = doc.createElement('figcaption');
  const attached = attachments.find(attachment => attachment.id === image.id), name = image.name.trim() || 'Image';
  figure.className = 'page-image'; caption.className = 'page-image-name';
  caption.textContent = attached ? name : `${name} · not on this page`;
  if (!attached) figure.dataset.state = 'missing';
  figure.append(caption);
  if (attached?.inline && read) paintThumb(figure, 'card:' + image.id, () => read(attached), img => caption.before(img));
  return figure;
}

// What drawPassages and linkedFenceNodes take to draw a page's image lines this way (message-format.mjs).
export const pageImages = (source, read) => ({ of: lineImage, node: (image, doc) => pageImage(doc, image, { attachments: source.attachments ?? [], read }) });
