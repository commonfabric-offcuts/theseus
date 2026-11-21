// Contract checks of the actual attachmentControl source. DOM doubles here
// prove queue/authority decisions only; native gestures live in image_buttons_653.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const file = 'web/app.mjs';
const original = process.env.ITEM653_ORIGINAL === '1';
const text = original ? execFileSync('git', ['show', '932856a^:' + file], { encoding: 'utf8' }) : readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const start = text.indexOf('function attachmentControl('), end = text.indexOf('\n// One of a Notebook', start);
assert.ok(start > 0 && end > start, 'extract the real complete production function');
const source = text.slice(start, end);
const descriptor = { id: 'media-653', name: 'portrait.png', inline: true, content_type: 'image/png', sha256: 'digest-a' };
const ref = { kind: 'memory', id: 'page-653', revision: 2 };
function fixture(code = source, attachment = descriptor, sourceRef = ref) {
  const jobs = [], calls = [], notices = [], urls = [], doc = { activeElement: null, body: {} };
  class Element {
    constructor(tag, name) { this.tag = tag; this.name = name; this.children = []; this.isConnected = true; this.classes = new Set(); this.classList = { add: n => this.classes.add(n), remove: n => this.classes.delete(n) }; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children.forEach(n => n.isConnected = false); this.children = nodes; }
    focus() { doc.activeElement = this; }
  }
  const state = { current: true, retired: null, read: async () => ({ inline: true, blob: 'verified bytes' }) };
  const context = vm.createContext({ document: doc, node: (tag, name) => new Element(tag, name),
    button: (name, action) => Object.assign(new Element('button', name), { action }),
    api: { media: async (...args) => { calls.push(args); return state.read(); } }, bootstrap: { instance_id: 'isolated-653' },
    mediaURLs: new Set(), URL: { createObjectURL: blob => { urls.push(blob); return 'blob:653'; } },
    paintThumb: (host, key, load) => jobs.push({ host, key, load }), retired: null });
  // Retirement is a live top-level production binding in this context.
  const build = vm.runInContext('(' + code + ')', context);
  const host = build(attachment, sourceRef, () => state.current, n => notices.push(n)), open = host.children[0];
  return { host, open, jobs, calls, notices, urls, state, doc, context };
}

test('item 653 verified descriptors alone gain a thumbnail, whose key binds exact source revision id and digest', () => {
  const f = fixture(); assert.equal(f.jobs.length, 1, 'verified image has one thumbnail');
  assert.deepEqual(JSON.parse(f.jobs[0].key), ['attachment', ref, descriptor.id, descriptor.sha256]);
  for (const changed of [{ ...ref, revision: 3 }, { kind: 'message', id: 'message-653' }, null]) {
    assert.notEqual(fixture(source, descriptor, changed).jobs[0].key, f.jobs[0].key);
  }
  assert.notEqual(fixture(source, { ...descriptor, sha256: 'digest-b' }).jobs[0].key, f.jobs[0].key);
  assert.equal(f.open.name, 'Open portrait.png'); assert.equal(f.open.tag, 'button');
  for (const attachment of [{ id: 'unknown', name: 'unknown.png' }, { ...descriptor, inline: false }, { ...descriptor, content_type: 'image/svg+xml' }, { ...descriptor, content_type: 'application/pdf' }]) {
    const fallback = fixture(source, attachment); assert.equal(fallback.jobs.length, 0, 'unknown/non-inline file has no speculative read');
    assert.equal(fallback.calls.length, 0); assert.equal(fallback.open.name, 'Open ' + attachment.name);
  }
});

test('item 653 queued and completed reads reject disposal replacement retirement and withdrawn authority', async () => {
  for (const when of ['before', 'after']) for (const reason of ['disconnected', 'withdrawn', 'replaced', 'retired']) {
    const f = fixture(); assert.equal(f.jobs.length, 1, 'verified image has a guarded loader');
    const invalidate = () => { if (reason === 'disconnected') f.host.isConnected = false; if (reason === 'withdrawn') f.state.current = false;
      if (reason === 'replaced') f.host.replaceChildren(); if (reason === 'retired') f.context.retired = ['retired']; };
    if (when === 'before') invalidate(); else f.state.read = async () => { invalidate(); return { inline: true, blob: 'late bytes' }; };
    assert.equal(await f.jobs[0].load(), null, when + ' ' + reason + ' cannot display bytes');
    assert.equal(f.calls.length, when === 'before' ? 0 : 1); assert.equal(f.urls.length, 0);
  }
  const f = fixture(); assert.equal(await f.jobs[0].load(), 'verified bytes');
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [['isolated-653', descriptor, ref]]);
  f.state.read = async () => ({ inline: false, blob: 'not inline' }); assert.equal(await f.jobs[0].load(), null);
});

test('item 653 named Open keeps its exact read Download refusal retry and post-Open cancellation', async () => {
  const f = fixture(); f.state.read = async () => { throw Error('denied'); };
  await f.open.action(); assert.match(f.notices[0].message, /denied/); assert.equal(f.open.disabled, false); assert.equal(f.host.children[0], f.open);
  f.state.read = async () => ({ inline: true, blob: 'verified explicit bytes' });
  await f.open.action(); assert.equal(f.host.classes.has('attachment-control'), false);
  assert.deepEqual(f.host.children.map(n => [n.tag, n.name]), [['img', undefined], ['a', 'Download portrait.png']]);
  assert.equal(f.host.children[1].download, descriptor.name); assert.equal(f.host.children[1].href, 'blob:653');
  if (!original) assert.equal(await f.jobs[0].load(), null, 'queued thumbnail cannot read after Open replaced it');
  assert.equal(f.calls.length, 2); assert.deepEqual(f.urls, ['verified explicit bytes']);
});

// Instrument controls: exact source mutations must fail the corresponding
// assertion, rather than throwing a parser/harness error. No product edits.
if (!original) test('item 653 exact source mutants lose the authority gates and fail their contract assertions', async () => {
  const mutations = [
    { from: "if (!currentImage()) return null;", to: '', when: 'before' },
    { from: 'return currentImage() && media.inline ? media.blob : null;', to: 'return media.inline ? media.blob : null;', when: 'after' },
  ];
  for (const m of mutations) {
    assert.equal(source.split(m.from).length, 2, 'one actual mutation site');
    const changed = source.replace(m.from, m.to); assert.notEqual(changed, source);
    const f = fixture(changed); if (m.when === 'before') f.state.current = false;
    else f.state.read = async () => { f.state.current = false; return { inline: true, blob: 'stale bytes' }; };
    let failure;
    try { const result = await f.jobs[0].load(); if (m.when === 'before') assert.equal(f.calls.length, 0, 'withdrawn source starts no byte read'); else assert.equal(result, null, 'withdrawn source displays no stale bytes'); } catch (e) { failure = e; }
    assert.equal(failure?.code, 'ERR_ASSERTION'); assert.match(failure.message, /withdrawn source (displays no stale bytes|starts no byte read)/);
    console.log('CAUGHT item 653 ' + m.when + ': ' + failure.message);
  }
});
