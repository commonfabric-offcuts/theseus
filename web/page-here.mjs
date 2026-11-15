import { paintChanges } from './page-changes.mjs';
import { linkedFenceNodes } from './message-format.mjs';
import { pageImages } from './page-image.mjs';

// On an outcome's own page there is no Reader, so a Notebook page listed
// beside its topics opens in place, below the list: its title, what changed
// since the person last read it, and the page as it now stands. Opening it
// reads it, as the Reader does, so its light goes out. One page shows at a
// time; Close puts the focus back on its row.
export class PageHere {
  // read(ref): the page's source view at that exact revision.
  // reads: a PageReads, which records the read and answers the revision read before.
  // cards(id), when given: the address of the shared page editor (docs/notebook-writing.md).
  // media(attachment, ref), when given: the bytes of one of the page's images, read through the page at ref; its
  // card lines show the images (page-image.mjs), and without it each shows its name.
  constructor({ host, read, reads, cards = null, media = null, doc = globalThis.document }) {
    Object.assign(this, { host, read, reads, cards, media, doc });
    this.serial = 0; this.opener = null;
  }
  node(tag, text, className) {
    const element = this.doc.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  close() {
    ++this.serial; this.host.hidden = true; this.host.replaceChildren();
    if (this.opener?.isConnected) this.opener.focus();
  }
  async open(ref, opener) {
    const serial = ++this.serial, current = () => serial === this.serial;
    this.opener = opener;
    const heading = this.node('h2', 'Opening the page…'), status = this.node('p', '', 'notice');
    status.setAttribute('role', 'status'); status.hidden = true;
    const close = this.node('button', 'Close page'); close.type = 'button'; close.onclick = () => this.close();
    this.host.replaceChildren(heading, status, close); this.host.hidden = false;
    const say = message => { if (current()) { status.textContent = message; status.hidden = false; } };
    let source;
    try { source = await this.read(ref); }
    catch (error) { say(`${error.message} The page could not be read.`); heading.textContent = 'Notebook page'; return; }
    if (!current()) return;
    heading.textContent = source.title || 'Notebook page';
    heading.tabIndex = -1;
    const origin = this.node('p', `Notebook · revision ${source.source_ref.revision}${source.draft === true ? ' · draft' : ''}`, 'muted');
    const body = this.node('div', undefined, 'page-here-body');
    body.append(...linkedFenceNodes(source.body ?? '', this.doc, pageImages(source, this.media && (attachment => this.media(attachment, source.source_ref)))));
    // Edit page only for someone Core lets write the page (its reader_may_write).
    const cards = this.cards && source.reader_may_write === true ? Object.assign(this.node('a', 'Edit page', 'page-here-cards'), { href: this.cards(source.source_ref.id) }) : '';
    this.host.replaceChildren(heading, origin, status, body, cards, close);
    heading.focus();
    let since;
    try { since = await this.reads.opened(source); }
    catch (error) { say(error.message); return; }
    if (since === null || !current()) return;
    let earlier;
    try { earlier = await this.read({ ...source.source_ref, revision: since }); }
    catch (error) { say(`What changed since revision ${since} could not be read. ${error.message}`); return; }
    if (!current()) return;
    const changes = this.node('details', undefined, 'source-changes'); changes.open = true;
    const shown = this.node('div');
    changes.append(this.node('summary', `What changed since you read revision ${since}`), shown);
    paintChanges(shown, earlier.body ?? '', source.body ?? '', this.doc);
    this.host.insertBefore(changes, body);
  }
}
