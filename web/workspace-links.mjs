import { keepOnEscape } from './keep-on-escape.mjs';
import { glyph } from './glyphs.mjs';
import { openMessageMenu, copyText } from './message-menu.mjs';
import { menuDoor } from './outline-menus.mjs';
import { RailMenuCommands } from './rail-menu-commands.mjs';

const node = (doc, tag, props = {}, ...children) => {
  const el = Object.assign(doc.createElement(tag), props); el.append(...children); return el;
};
export function linkURL(raw) {
  if (typeof raw !== 'string' || /[\s\x00-\x1f\x7f\\]/u.test(raw)) throw Error('Use an HTTP or HTTPS address without spaces.');
  let url; try { url = new URL(raw); } catch { throw Error('Enter the whole HTTP or HTTPS address.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw Error('Use an HTTP or HTTPS address without a username or password.');
  return url.href;
}
// Navigation-equivalent spellings share one icon. Core's exact URL remains
// the write identity; newest Core update wins (sequence breaks time ties).
function keptLinks(records) {
  const kept = new Map();
  for (const row of records) {
    let key; try { key = linkURL(row.url); } catch { continue; }
    const before = kept.get(key);
    if (!before || (row.ms ?? 0) > (before.ms ?? 0) ||
        (row.ms ?? 0) === (before.ms ?? 0) && (row.seq ?? 0) > (before.seq ?? 0)) kept.set(key, row);
  }
  return kept;
}
export function outcomeLinks(previews, records) {
  const rows = new Map();
  for (const preview of previews) {
    try { const url = linkURL(preview.url); if (!rows.has(url)) rows.set(url, { ...preview, url, revision: 0 }); } catch { /* not a usable web address */ }
  }
  for (const [key, record] of keptLinks(records)) {
    if (record.removed) rows.delete(key);
    else rows.set(key, { ...rows.get(key), ...record });
  }
  return [...rows.values()];
}

// Core owns records. This object owns only the current rail/form and exact
// unknown requests, under the same menu command owner the other rails use.
export class WorkspaceLinks {
  constructor(rail) {
    this.rail = rail; this.doc = rail.doc; this.commands = new RailMenuCommands();
    this.records = []; this.mayWrite = false; this.serial = 0;
    const doc = this.doc, part = rail.sections.get('previews');
    this.pencil = node(doc, 'button', { type: 'button', className: 'notebook-create link-create', title: 'Add link', hidden: true }, glyph('pencil', doc));
    this.pencil.setAttribute('aria-label', 'Add link'); this.pencil.setAttribute('aria-expanded', 'false');
    part.summary.append(this.pencil); this.pencil.onclick = event => {
      event.preventDefault(); event.stopPropagation();
      if (this.busy) return;
      if (!this.form.hidden) this.close(true); else this.edit(null, this.pencil);
    };
    this.cancelDoor = menuDoor(part.body, target => target.closest?.('a[data-outcome-link]'), (anchor, at) => this.menu(anchor, at));
    // A held finger can be over a newly opened sheet item on release.
    // Consume that release's click; the next deliberate press resets it.
    doc.addEventListener('pointerdown', event => {
      this.cancelDoor();
      this.holdOpened = false; this.touchDown = event.pointerType === 'touch' && part.body.contains(event.target);
    }, true);
    doc.addEventListener('pointerup', () => { this.touchDown = false; }, true);
    doc.addEventListener('pointercancel', () => { this.cancelDoor(); this.touchDown = false; this.holdOpened = false; }, true);
    doc.addEventListener('keydown', event => {
      if (!this.touchDown) { this.cancelDoor(); this.holdOpened = false; }
      // Native touch release may put focus back outside the sheet. Escape
      // still closes this Links menu before the rail handles the same key.
      if (event.key === 'Escape' && this.openMenu?.root.isConnected) {
        event.preventDefault(); event.stopPropagation(); this.openMenu.close(true);
      }
    }, true);
    doc.addEventListener('click', event => {
      if (!this.holdOpened) return;
      this.cancelDoor(); this.holdOpened = false; event.preventDefault(); event.stopImmediatePropagation();
    }, true);
    this.form = node(doc, 'form', { className: 'link-form rail-line', hidden: true });
    this.form.setAttribute('aria-label', 'Save outcome link');
    this.url = node(doc, 'input', { type: 'url', required: true, placeholder: 'https://…' });
    this.url.setAttribute('aria-label', 'Link URL');
    this.title = node(doc, 'input', { type: 'text', placeholder: 'Title (defaults to the site address)' });
    this.title.setAttribute('aria-label', 'Link title');
    this.save = node(doc, 'button', { type: 'submit', textContent: 'Add link' });
    this.cancel = node(doc, 'button', { type: 'button', textContent: 'Cancel' });
    this.notice = node(doc, 'p', { className: 'notice link-notice', hidden: true }); this.notice.setAttribute('role', 'status');
    this.form.append(node(doc, 'label', {}, 'URL', this.url), node(doc, 'label', {}, 'Title', this.title),
      node(doc, 'div', { className: 'link-form-actions' }, this.save, this.cancel), this.notice);
    part.summary.after(this.form);
    this.feedback = node(doc, 'p', { className: 'notice link-notice', hidden: true, textContent: 'Link copied.' });
    this.feedback.setAttribute('role', 'status'); this.form.after(this.feedback);
    this.cancel.onclick = () => this.close(true);
    this.form.onsubmit = event => { event.preventDefault(); this.submit(); };
    this.form.addEventListener('keydown', event => {
      if (event.isComposing || event.keyCode === 229) return;
      event.stopPropagation();
      if (event.target === this.url || event.target === this.title) {
        keepOnEscape(event, { value: this.record ? this.title.value : this.url.value,
          save: () => this.submit(), close: () => this.close(true) });
      } else if (event.key === 'Escape') { event.preventDefault(); this.close(true); }
    });
    this.title.addEventListener('blur', event => {
      if (this.record && !this.busy && !this.form.hidden && !this.form.contains(event.relatedTarget)) {
        if (this.title.value.trim()) this.submit(); else this.close(false);
      }
    });
    this.url.addEventListener('input', () => { try { this.title.placeholder = new URL(linkURL(this.url.value)).hostname; } catch { this.title.placeholder = 'Title (defaults to the site address)'; } });
  }
  reset() {
    ++this.serial; this.records = []; this.mayWrite = false; this.pencil.hidden = true;
    this.cancelDoor(); this.openMenu?.close(false); this.close(false); this.url.value = this.title.value = '';
    this.newDraft = null; this.touchDown = this.holdOpened = false; this.removedFocus = null;
    this.feedback.hidden = true;
  }
  current(handles) { return this.rail.handles === handles && handles?.readable?.() !== false; }
  async read(handles) {
    const items = [], seen = new Set(), max = handles.bootstrap.limits?.workspace_links ?? 500;
    let cursor;
    do {
      const answer = await handles.view('workspace_links', { workspace_id: handles.workspaceId, limit: Math.min(100, handles.bootstrap.limits?.page_max ?? 100),
        ...(cursor === undefined ? {} : { cursor }) });
      if (answer.error) throw Object.assign(Error(answer.error.message), answer.error);
      if (answer.instance_id !== handles.bootstrap.instance_id || answer.workspace_id !== handles.workspaceId || !Array.isArray(answer.items)) throw Error('The outcome Links could not be confirmed.');
      for (const row of answer.items) {
        if (!row || !Number.isSafeInteger(row.seq) || row.seq <= 0 || typeof row.title !== 'string' ||
            !Number.isSafeInteger(row.revision) || row.revision < 1 || typeof row.removed !== 'boolean' || seen.has(row.seq)) throw Error('The outcome Links could not be confirmed.');
        seen.add(row.seq);
        try { linkURL(row.url); } catch { continue; } // One legacy bad URL cannot deny the collection.
        items.push(row);
      }
      if (seen.size > max || !(answer.next_cursor === null || Number.isSafeInteger(answer.next_cursor) && answer.next_cursor > 0 &&
          (cursor === undefined || answer.next_cursor < cursor) && answer.items.at(-1)?.seq === answer.next_cursor)) throw Error('The outcome Links page could not be confirmed.');
      if (answer.next_cursor === null) return { items, reader_may_write: answer.reader_may_write === true };
      cursor = answer.next_cursor;
    } while (this.current(handles));
    return { items: [], reader_may_write: false };
  }
  section(previews, answer) {
    if (answer !== undefined) { this.records = answer?.items ?? []; this.mayWrite = answer?.reader_may_write === true; }
    this.pencil.hidden = !this.mayWrite;
    if (!this.mayWrite && !this.form.hidden) this.close(false);
    const rows = outcomeLinks(previews, this.records), handles = this.rail.handles;
    if (!rows.length && !this.mayWrite) return null;
    return { sum: rows.length ? String(rows.length) : '', key: JSON.stringify(['outcome-links', rows.map(row => [row.url, row.title, row.revision]), this.mayWrite]), node: () => {
      if (!rows.length) return node(this.doc, 'p', { className: 'things-quiet', textContent: 'No links yet.' });
      const grid = node(this.doc, 'div', { className: 'things-thumbs links-grid' });
      for (const row of rows) {
        const tile = node(this.doc, 'div', { className: 'link-tile' });
        const icon = node(this.doc, 'span', { className: 'link-browser' }, node(this.doc, 'img', { className: 'link-browser-fallback', alt: '', src: '/browser-link.svg' }));
        const image = node(this.doc, 'img', { className: 'link-favicon', alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', src: new URL('/favicon.ico', row.url).href });
        image.onerror = () => image.remove(); icon.append(image);
        const anchor = node(this.doc, 'a', { href: row.url, target: '_blank', rel: 'noopener noreferrer', className: 'outcome-link', title: `${row.title}\n${row.url}` },
          icon, node(this.doc, 'span', { className: 'link-title', textContent: row.title }));
        anchor.dataset.outcomeLink = row.url; anchor.linkRecord = row; anchor.setAttribute('aria-label', row.title);
        anchor.onclick = event => { if (!this.current(handles)) { event.preventDefault(); return; } if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) this.rail.close(false); };
        const more = node(this.doc, 'button', { type: 'button', className: 'link-menu', textContent: '⋯' });
        more.dataset.linkMenu = ''; more.setAttribute('aria-label', `Menu for ${row.title}`);
        more.onclick = event => { event.preventDefault(); event.stopPropagation(); this.menu(anchor); };
        tile.append(anchor, more); grid.append(tile);
      }
      return grid;
    } };
  }
  focusKey() { return this.doc.activeElement?.closest?.('a[data-outcome-link]')?.dataset.outcomeLink ?? null; }
  restoreFocus(url) {
    if (!url || this.doc.activeElement !== this.doc.body) return;
    const anchors = [...this.rail.sections.get('previews').body.querySelectorAll('a[data-outcome-link]')];
    const target = this.removedFocus?.url === url ? this.removedFocus.next : url; this.removedFocus = null;
    (anchors.find(el => el.dataset.outcomeLink === target) ?? anchors[0] ?? this.pencil).focus({ preventScroll: true });
  }
  message(words) { this.notice.textContent = words; this.notice.hidden = !words; }
  feedbackMessage(words) { this.feedback.textContent = words; this.feedback.hidden = !words; }
  close(focus) {
    if (!this.form.hidden && !this.record) this.newDraft = { url: this.url.value, title: this.title.value };
    ++this.serial; this.busy = false; this.form.hidden = true; this.pencil.setAttribute('aria-expanded', 'false');
    if (focus) (this.opener?.isConnected ? this.opener : this.pencil).focus();
  }
  edit(record, opener) {
    if (this.busy || !this.mayWrite || !this.rail.handles) return;
    if (!this.form.hidden && !this.record) this.newDraft = { url: this.url.value, title: this.title.value };
    ++this.serial; this.record = record; this.opener = opener; this.busy = false;
    this.url.readOnly = Boolean(record); this.title.readOnly = false; this.save.disabled = false;
    this.url.value = record?.url ?? this.newDraft?.url ?? ''; this.title.value = record?.title ?? this.newDraft?.title ?? ''; this.save.textContent = record ? 'Save' : 'Add link';
    this.message(''); this.form.hidden = false; this.rail.sections.get('previews').details.open = true;
    this.pencil.setAttribute('aria-expanded', 'true'); (record ? this.title : this.url).focus();
  }
  async write(handles, row, removed = false) {
    const { authority_id, authority_epoch } = handles.bootstrap.authority;
    const saved = this.records.find(record => record.url === row.url) ??
      ((row.revision ?? 0) === 0 ? keptLinks(this.records).get(linkURL(row.url)) : null);
    const url = saved?.url ?? row.url;
    const receipt = await this.commands.send(handles, { v: 1, instance_id: handles.bootstrap.instance_id, operation_id: crypto.randomUUID(),
      kind: 'workspace.link_set', target: { workspace_id: handles.workspaceId },
      expected: { authority: { authority_id, authority_epoch }, link_revision: row.revision ?? saved?.revision ?? 0 },
      args: { url, title: row.title, removed } });
    if (receipt.result?.workspace_id !== handles.workspaceId || receipt.result?.link?.url !== url) throw Error('The saved Link could not be confirmed.');
    return receipt.result.link;
  }
  async submit() {
    if (this.busy || !this.mayWrite || this.form.hidden) return;
    const handles = this.rail.handles, serial = this.serial;
    const current = () => serial === this.serial && this.current(handles);
    this.busy = true; this.save.disabled = true; this.url.readOnly = this.title.readOnly = true;
    try {
      const url = this.record ? this.record.url : linkURL(this.url.value);
      const row = { url, title: this.title.value.trim() || new URL(url).hostname, ...(this.record ? { revision: this.record.revision } : {}) };
      await this.write(handles, row);
      if (current()) { if (!this.record) this.url.value = this.title.value = ''; this.close(true); this.rail.changed(); }
    } catch (error) { if (current()) this.message(error.message); }
    finally { if (current()) { this.busy = false; this.save.disabled = false; this.url.readOnly = Boolean(this.record); this.title.readOnly = false; } }
  }
  menu(anchor, at = null) {
    if (!anchor?.isConnected || !this.current(this.rail.handles)) return;
    this.feedbackMessage('');
    if (this.touchDown) this.holdOpened = true;
    const handles = this.rail.handles, url = anchor.dataset.outcomeLink;
    const act = task => async () => {
      if (!this.current(handles)) return;
      const attached = [...this.rail.sections.get('previews').body.querySelectorAll('a[data-outcome-link]')]
        .find(el => el.isConnected && el.dataset.outcomeLink === url);
      if (!attached) { this.feedbackMessage('This link is no longer here.'); return; }
      try { await task(attached, attached.linkRecord); }
      catch (error) { if (this.current(handles)) this.feedbackMessage(error.message); }
    };
    this.openMenu = openMessageMenu({ anchor, at, doc: this.doc, win: this.rail.win, sheet: true, label: 'Link', items: [
      { label: 'Open', glyph: 'openpage', act: act(attached => attached.click()) },
      { label: 'Copy link', glyph: 'copy', act: act(async (_attached, row) => {
        if (!await copyText(row.url, this.rail.win.navigator)) throw Error('Could not copy this link.');
        if (this.current(handles)) this.feedbackMessage('Link copied.');
      }) },
      { label: 'Rename', glyph: 'pencil', disabled: !this.mayWrite, act: act((attached, row) => this.edit(row, attached)) },
      { label: 'Remove', glyph: 'drop', disabled: !this.mayWrite, act: act(async (_attached, row) => {
        const urls = [...this.rail.sections.get('previews').body.querySelectorAll('a[data-outcome-link]')].map(el => el.dataset.outcomeLink), index = urls.indexOf(row.url);
        await this.write(handles, row, true);
        if (this.current(handles)) { this.removedFocus = { url: row.url, next: urls[index + 1] ?? urls[index - 1] ?? null }; this.rail.changed(); }
      }) },
    ] });
    // The rail can itself be an overlay, as for its existing image menu.
    if (this.openMenu) this.openMenu.root.style.zIndex = String(Math.max(
      Number(this.rail.win.getComputedStyle(this.openMenu.root).zIndex) || 0,
      (Number(this.rail.win.getComputedStyle(this.rail.host).zIndex) || 0) + 1));
  }
}
