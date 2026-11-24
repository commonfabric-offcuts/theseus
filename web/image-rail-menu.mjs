import { menuDoor } from './outline-menus.mjs';
import { openMessageMenu, copyText } from './message-menu.mjs';
import { placeLink } from './links.mjs';
import { routeHref } from './topic-navigation.mjs';
import { RailMenuCommands } from './rail-menu-commands.mjs';
import { stackActEnvelope, HELD_BY_STAR } from './stack-feed.mjs';
import { archiveReadConfirmed } from './archive-new.mjs';

const TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const still = current => { if (!current()) throw Error('The page changed. Open the image menu again.'); };
export const imageAddress = (image, origin = null) => origin
  ? new URL(routeHref({ kind: 'image', id: image.attachment.id, message: image.source_ref.id }), origin).href
  : placeLink({ kind: 'image', id: image.attachment.id, message: image.source_ref.id });

// The address carries identifiers, never a session or blob URL. Re-read the
// source; Api.media owns descriptor, length and digest verification.
export async function verifiedImage(handles, image, current, cached = null) {
  still(current);
  const source = await handles.view('source', { source_ref: image.source_ref }, 'foreground');
  still(current);
  const attachment = source.attachments?.find(a => a.id === image.attachment.id);
  if (source.instance_id !== handles.bootstrap.instance_id || source.source_ref?.kind !== 'message' ||
      source.source_ref.id !== image.source_ref.id || (image.topic_id && source.topic_id !== image.topic_id) ||
      !attachment?.inline || !TYPES.has(attachment.content_type) ||
      (image.attachment.sha256 && image.attachment.sha256 !== attachment.sha256)) throw Error('This image is no longer available in its message.');
  if (cached?.attachment.id === attachment.id && cached.attachment.sha256 === attachment.sha256) return { ...cached, source };
  const media = await handles.inTurn(() => { still(current); return handles.api.media(handles.bootstrap.instance_id, attachment, image.source_ref); });
  still(current);
  return { ...media, attachment, source };
}

export async function pngImage(blob, win = globalThis, doc = globalThis.document) {
  if (blob.type === 'image/png') return blob;
  const bitmap = await win.createImageBitmap(blob);
  try {
    const canvas = doc.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    return await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error('The image could not be copied.')), 'image/png'));
  } finally { bitmap.close(); }
}
// Invoke write in the native press, before awaiting media, including Safari.
export function writeImage(read, { nav = globalThis.navigator, Item = globalThis.ClipboardItem } = {}) {
  if (!nav?.clipboard?.write || !Item) return Promise.reject(Error('Copy image is unavailable here. Use Download.'));
  const data = Promise.resolve().then(read);
  data.catch(() => {}); // write can reject before it consumes the promised data.
  try { return nav.clipboard.write([new Item({ 'image/png': data })]); }
  catch (error) { return Promise.reject(error); }
}

// Same stack.aside act and revision fence as the feed. Retain an unknown
// request with its pre-act position: a reread must not turn Retry into Bring back.
export class ImageArchive {
  constructor() { this.commands = new RailMenuCommands(); this.pending = new Map(); }
  async prepare(handles, image, current) {
    const answer = await handles.view('topic_messages', { topic_id: image.topic_id, message_ids: [image.source_ref.id] }, 'foreground');
    still(current);
    const item = answer.items?.[0], position = item?.stack_position;
    if (answer.instance_id !== handles.bootstrap.instance_id || answer.items?.length !== 1 || item.id !== image.source_ref.id ||
        item.topic_id !== image.topic_id || !item.attachments?.some(a => a.id === image.attachment.id) ||
        !position?.root_id || !Number.isSafeInteger(position.aside_revision) || !Number.isSafeInteger(position.at?.messages)) throw Error('The image’s message could not be confirmed.');
    const key = JSON.stringify([handles.bootstrap.instance_id, handles.bootstrap.actor, handles.bootstrap.authority, position.root_id]);
    if (this.pending.has(key)) return { ...this.pending.get(key), label: 'Retry ' + this.pending.get(key).label };
    const below = Boolean(position.below), label = below ? 'Bring back its message' : 'Archive its message';
    // One indexed newest-message read establishes a boundary for the whole
    // dossier, even when the image is in an older reply not loaded in the feed.
    const latest = below ? null : await handles.view('topic_messages', { topic_id: image.topic_id, audience: 'all', direction: 'before', limit: 1 }, 'foreground');
    still(current);
    if (!below && (latest.instance_id !== handles.bootstrap.instance_id || latest.items?.length !== 1 ||
        latest.items[0].topic_id !== image.topic_id || !Number.isSafeInteger(latest.items[0].seq) || latest.items[0].seq < item.seq)) throw Error('The message archive boundary could not be confirmed.');
    const request = stackActEnvelope({ instanceId: handles.bootstrap.instance_id, authority: handles.bootstrap.authority,
      kind: 'stack.aside', item: { id: position.root_id, acts: { aside_revision: position.aside_revision } },
      args: { through: below ? null : latest.items[0].seq, ...(!below ? { clear_new: true } : {}) } });
    return { key, label, request, topicId: image.topic_id, before: { through: position.through, key: position.order_key }, disabled: !below && Boolean(position.starred?.length) };
  }
  async perform(handles, plan, current) {
    still(current);
    if (plan.disabled) throw Error(HELD_BY_STAR);
    if (plan.request.args.clear_new === true && !('finishArchive' in plan))
      plan.finishArchive = handles.captureArchiveReading?.(plan.request.target.message_id, plan.request.args.through, plan.topicId) ?? null;
    this.pending.set(plan.key, { ...plan, label: plan.label.replace(/^Retry /, '') });
    let receipt;
    try { receipt = await this.commands.send(handles, plan.request); }
    catch (error) {
      if (!this.commands.retained(handles, plan.request.kind, plan.request.target)) this.pending.delete(plan.key);
      throw error;
    }
    if (plan.request.args.clear_new === true) {
      if (!archiveReadConfirmed(receipt, plan.request, plan.topicId)) throw Error('The archive reading was not confirmed. Choose it again to retry the same request.');
      if (current()) plan.finishArchive?.();
    }
    this.pending.delete(plan.key);
    if (plan.undo) return null;
    if (!Number.isSafeInteger(receipt.result?.aside_revision)) throw Error('The message action was saved, but Undo could not be confirmed.');
    const undo = { ...plan.request, operation_id: crypto.randomUUID(), expected: { ...plan.request.expected, aside_revision: receipt.result.aside_revision },
      args: { through: plan.before.through, ...(typeof plan.before.key === 'number' ? { key: plan.before.key } : {}) } };
    return () => this.perform(handles, { ...plan, request: undo, label: 'Undo message action', undo: true, disabled: false }, current);
  }
}

export class ImageRailMenu {
  constructor(rail) {
    this.rail = rail; this.serial = 0; this.archive = new ImageArchive();
    this.cancelDoor = menuDoor(rail.holder, target => {
      const row = target.closest?.('[data-rail-image]');
      return rail.handles && row && rail.holder.contains(row) ? row : null;
    }, (row, at) => this.open(row, at));
    rail.doc.addEventListener('pointerdown', event => {
      this.holdOpened = false;
      this.touchDown = event.pointerType === 'touch' && rail.holder.contains(event.target);
      if (this.pending && !this.pending.contains(event.target)) this.cancelPending();
    }, true);
    rail.doc.addEventListener('pointerup', () => { this.touchDown = false; }, true);
    rail.doc.addEventListener('pointercancel', () => { this.touchDown = false; this.holdOpened = false; }, true);
    // The sheet can appear under the finger that opened it. Its release may
    // retarget the click into the sheet, so consume that release before a row
    // can act. The next deliberate press clears this guard.
    rail.doc.addEventListener('click', event => {
      if (!this.holdOpened) return;
      this.holdOpened = false; event.preventDefault(); event.stopImmediatePropagation();
    }, true);
    rail.doc.addEventListener('keydown', event => { if (event.key === 'Escape' && this.pending) this.cancelPending(); }, true);
  }
  cancelPending() { ++this.serial; this.pending = null; }
  reset() { this.touchDown = false; this.holdOpened = false; this.cancelPending(); this.cancelDoor(); this.menu?.close(false); this.menu = null; this.noticeNode?.remove(); }
  notice(words, undo = null) {
    const { rail } = this;
    const handles = rail.handles;
    this.noticeNode ??= rail.doc.createElement('p');
    this.noticeNode.className = 'notice image-menu-notice'; this.noticeNode.setAttribute('role', 'status');
    this.noticeNode.replaceChildren(words); rail.host.append(this.noticeNode);
    if (undo) {
      const button = rail.doc.createElement('button'); button.type = 'button'; button.textContent = 'Undo';
      button.onclick = async () => { button.disabled = true; try { await undo(); if (rail.handles === handles) { this.notice('Message action undone.'); handles?.menuChanged?.(); } } catch (error) { if (rail.handles === handles) this.notice(error.message, undo); } };
      this.noticeNode.append(' ', button);
    }
  }
  async open(row, at) {
    const rail = this.rail, handles = rail.handles, image = row.railImage, serial = ++this.serial;
    if (this.touchDown) this.holdOpened = true;
    this.menu?.close(false); this.pending = row;
    const current = () => rail.handles === handles && handles?.readable?.() !== false && handles?.current?.() !== false && row.isConnected !== false && row.railImage === image;
    try {
      still(current);
      const plan = await this.archive.prepare(handles, image, () => current() && serial === this.serial);
      if (serial !== this.serial) return;
      const perform = action => {
        if (!current() || serial !== this.serial) return;
        try { Promise.resolve(action()).catch(error => { if (current()) this.notice(error.message); }); }
        catch (error) { if (current()) this.notice(error.message); }
      };
      const read = () => verifiedImage(handles, image, current);
      const anchor = row.querySelector('img') ?? row;
      this.pending = null;
      this.menu = openMessageMenu({ anchor, at, label: 'Image', sheet: true, doc: rail.doc, win: rail.win, items: [
        { label: 'Copy link', glyph: 'link', act: () => perform(async () => {
          const copied = await copyText(imageAddress(image), rail.win.navigator);
          if (current()) this.notice(copied ? 'Image link copied.' : 'The image link could not be copied.');
        }) },
        { label: 'Copy image', glyph: 'copy', act: () => perform(() => writeImage(async () => {
          const media = await read(), png = await pngImage(media.blob, rail.win, rail.doc); still(current); return png;
        }, { nav: rail.win.navigator, Item: rail.win.ClipboardItem }).then(() => { if (current()) this.notice('Image copied.'); })) },
        { label: 'Download', glyph: 'image', act: () => perform(async () => {
          const media = await read(); still(current);
          const url = URL.createObjectURL(media.blob), link = rail.doc.createElement('a');
          link.href = url; link.download = media.attachment.name; rail.doc.body.append(link); link.click(); link.remove();
          rail.win.setTimeout(() => URL.revokeObjectURL(url), 1000); this.notice('Download started.');
        }) },
        { label: plan.label, glyph: 'archive', disabled: plan.disabled, description: plan.disabled ? HELD_BY_STAR : 'For you, including replies in its dossier', act: () => perform(async () => {
          const undo = await this.archive.perform(handles, plan, current);
          if (current()) { this.notice(plan.undo ? 'Message action undone.' : plan.request.args.through === null ? 'Message brought back.' : 'Message archived, for you only.', undo); handles.menuChanged?.(); }
        }) },
      ] });
      // The rail is itself a phone overlay. Keep its shared menu above that
      // actual layer; the page's ordinary menu layer is underneath the rail.
      if (this.menu) this.menu.root.style.zIndex = String(Math.max(
        Number(rail.win.getComputedStyle(this.menu.root).zIndex) || 0,
        (Number(rail.win.getComputedStyle(rail.host).zIndex) || 0) + 1));
    } catch (error) { if (serial === this.serial && current()) this.notice(error.message); }
  }
}
