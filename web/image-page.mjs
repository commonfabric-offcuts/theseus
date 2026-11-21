import { verifiedImage } from './image-rail-menu.mjs';
import { messageLink } from './links.mjs';

// A stable authenticated address for one image. Source access is checked on
// refresh; unchanged authorized bytes are retained, not downloaded each commit.
export class ImagePage {
  constructor({ host, handles, route, current = () => true }) {
    Object.assign(this, { host, handles, route, current }); this.serial = 0;
  }
  dispose() { ++this.serial; if (this.url) URL.revokeObjectURL(this.url); this.url = null; this.cached = null; this.host.replaceChildren(); }
  async load() {
    const serial = ++this.serial, current = () => serial === this.serial && this.current();
    try {
      const media = await verifiedImage(this.handles, { source_ref: { kind: 'message', id: this.route.message }, attachment: { id: this.route.id } }, current, this.cached);
      if (!current()) return;
      if (this.cached && this.url && this.cached.attachment.sha256 === media.attachment.sha256) return true;
      if (this.url) URL.revokeObjectURL(this.url);
      this.url = URL.createObjectURL(media.blob); this.cached = media;
      const doc = this.host.ownerDocument, image = doc.createElement('img');
      image.src = this.url; image.alt = media.attachment.name; image.style.maxWidth = '100%'; image.style.height = 'auto';
      const download = doc.createElement('a'); download.href = this.url; download.download = media.attachment.name; download.textContent = 'Download ' + media.attachment.name;
      const source = doc.createElement('a'); source.href = messageLink(media.source.topic_id, this.route.message); source.textContent = 'Open its message';
      const actions = doc.createElement('p'); actions.append(source, ' · ', download);
      this.host.replaceChildren(actions, image); return true;
    } catch (error) {
      if (!current()) return;
      this.dispose(); this.host.textContent = 'Image unavailable. ' + error.message; return false;
    }
  }
}
