import test from 'node:test';
import assert from 'node:assert/strict';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { interactiveHTML, literalHTMLNodes } from '../web/interactive-html.mjs';
import { formatWords, drawPassages, drawnText, linkedFenceNodes } from '../web/message-format.mjs';
import { coverSheet } from '../web/dossier-cover.mjs';

function fixture() {
  const doc = miniDocument();
  const create = doc.createElement;
  doc.createElement = tag => {
    const node = create(tag);
    node.style = { setProperty() {} };
    Object.defineProperty(node, 'ownerDocument', { value: doc });
    return node;
  };
  return { doc, host: doc.createElement('div') };
}
const source = 'Before **literal**\n\n```html\n<button>Run</button><script>document.title="works"</script>\n```\n\nAfter <literal>';
const frames = host => host.querySelectorAll('iframe');

test('920 Notebook cards render the complete HTML fence and retain exact source', () => {
  const { doc, host } = fixture();
  formatWords(host, source, { doc, interactiveHTML: true });
  assert.equal(frames(host).length, 1, 'complete Notebook HTML fence becomes a frame');
  assert.equal(drawnText(host), source);
  assert.equal(frames(host)[0].getAttribute('sandbox'), 'allow-scripts');
  assert.equal(frames(host)[0].src, '/interactive-html');
  assert.equal(frames(host)[0].srcdoc, undefined, 'untrusted HTML never enters the application document');
});
test('920 Notebook Reader and in-place revision use the same fence owner', () => {
  const { doc, host } = fixture();
  drawPassages(host, source, doc, { notebook: true });
  assert.equal(frames(host).length, 1, 'Reader');
  assert.equal(drawnText(host), source);
  host.replaceChildren(...linkedFenceNodes(source, doc));
  assert.equal(frames(host).length, 1, 'in-place revision');
});
test('920 a cover renders only its complete HTML fence and keeps surrounding literal text', () => {
  const { doc } = fixture();
  const sheet = coverSheet(doc, { stands: source, waiting: [] }, { nameOf: x => x });
  assert.equal(frames(sheet).length, 1);
  assert.match(sheet.text, /Before \*\*literal\*\*/);
  assert.match(sheet.text, /After <literal>/);
  assert.equal(sheet.querySelectorAll('strong').length, 0);
  assert.equal(sheet.querySelectorAll('script').length, 0);
});
test('920 incomplete fences and ordinary messages remain inert text', () => {
  const { doc, host } = fixture();
  for (const body of [source.slice(0, source.lastIndexOf('```')), '```js\n```html\n<script>bad()</script>\n```\n```']) {
    formatWords(host, body, { doc, interactiveHTML: true });
    assert.equal(frames(host).length, 0, body);
  }
  formatWords(host, source, { doc });
  assert.equal(frames(host).length, 0);
  drawPassages(host, source, doc);
  assert.equal(frames(host).length, 0);
});
test('920 an oversized complete fence refuses plainly without losing its source', () => {
  const { doc, host } = fixture(), body = '```html\n' + '🪴'.repeat(32769) + '\n```';
  formatWords(host, body, { doc, interactiveHTML: true });
  assert.equal(frames(host).length, 0);
  assert.match(host.text, /too large to display/);
  assert.equal(drawnText(host), body);
});

test('920 shared fence boundaries preserve CRLF, empty fences and inert outer fences', () => {
  const { doc, host } = fixture();
  for (const raw of ['~~~HTML\r\n<b>yes</b>\r\n~~~', '```html\n```', '```html extra\n<b>yes</b>\n```']) {
    formatWords(host, raw, { doc, interactiveHTML: true });
    assert.equal(frames(host).length, 1);
    assert.equal(drawnText(host), raw);
    host.replaceChildren(...literalHTMLNodes(raw, doc));
    assert.equal(frames(host).length, 1);
  }
  const raw = '````js\r\n```html\r\n<b>inert</b>\r\n```\r\n````';
  host.replaceChildren(...literalHTMLNodes(raw, doc));
  assert.equal(frames(host).length, 0); assert.equal(host.text, raw);
});

test('920 parent channel rejects wrong source, nonce, origin and inactive link intents', () => {
  const { doc, host } = fixture(), opens = [], messages = [], listeners = [];
  doc.defaultView = { crypto, addEventListener: (kind, fn) => listeners.push(fn),
    navigator: { userActivation: { isActive: false } }, open: (...args) => opens.push(args) };
  const block = interactiveHTML('<p>private fence</p>', doc); host.root = true; host.append(block);
  const frame = host.querySelector('iframe');
  frame.contentWindow = { postMessage: (...args) => messages.push(args) }; frame.onload();
  assert.equal(messages.length, 1); assert.equal(messages[0][0].html, '<p>private fence</p>');
  const data = { ...messages[0][0], kind: 'height', height: 999999 };
  const send = patch => listeners[0]({ source: frame.contentWindow, origin: 'null', data, ...patch });
  send({ source: {} }); send({ data: { ...data, nonce: 'wrong' } }); send({ origin: 'https://wrong' });
  assert.equal(frame.style.height, undefined);
  send({}); assert.equal(frame.style.height, '4096px');
  const link = href => send({ data: { ...data, kind: 'link', href } });
  link('https://example.test/'); assert.equal(opens.length, 0);
  doc.defaultView.navigator.userActivation.isActive = true;
  for (const href of ['javascript:alert(1)', 'data:text/html,x', '/relative', 'https://secret@example.test/', 'x'.repeat(4097)]) link(href);
  assert.equal(opens.length, 0);
  link('https://example.test/'); assert.deepEqual(opens, [['https://example.test/', '_blank', 'noopener,noreferrer']]);
  frame.remove(); send({ data: { ...data, height: 50 } }); assert.equal(frame.style.height, '4096px');
});

function bootstrapFixture({ report = true, fetchOK = false, imageOK = false, reportPatch = {} } = {}) {
  const { doc } = fixture(), sent = [], parent = { postMessage: (...args) => sent.push(args) }, handlers = {}, probes = [];
  const href = 'https://theseus.test/interactive-html';
  let observer, closed = 0, disconnected = 0;
  doc.body = doc.createElement('body');
  const create = doc.createElement; doc.createElement = tag => Object.assign(create(tag), { contentWindow: {} });
  vm.runInNewContext(readFileSync(new URL('../web/interactive-html-bootstrap.js', import.meta.url), 'utf8'), {
    document: doc, parent, location: { href }, URL, TextEncoder, AbortController,
    addEventListener: (kind, fn) => { handlers[kind] = fn; },
    setTimeout: (fn, ms) => { assert.equal(ms, 5000); return setTimeout(fn, 10); }, clearTimeout,
    ReportingObserver: class { constructor(fn) { observer = fn; } observe() {} disconnect() { disconnected++; } },
    fetch: async target => { probes.push(['fetch', target]); if (fetchOK) return {}; throw Error('blocked'); },
    Image: class { set src(target) { probes.push(['image', target]); queueMicrotask(() => imageOK ? this.onload?.() : this.onerror?.()); } removeAttribute() {} },
    RTCPeerConnection: class {
      constructor(options) {
        probes.push(['rtc', JSON.parse(JSON.stringify(options))]);
        if (report) queueMicrotask(() => observer([{ type: 'connection-allowlist', url: href,
          body: { url: href, connection: 'webrtc', disposition: 'enforce', allowlist: [], ...reportPatch } }]));
      }
      createDataChannel() {} async createOffer() { return {}; } async setLocalDescription() {} close() { closed++; }
    },
  });
  const data = { protocol: 'theseus-html-1', kind: 'init', nonce: 'a'.repeat(48), html: '<p>kept</p>' };
  const send = patch => handlers.message({ source: parent, origin: 'https://theseus.test', data, ...patch });
  return { doc, data, send, sent, probes, cleaned: () => ({ closed, disconnected }) };
}

test('920 bootstrap binds one parent nonce and forwards only its own opaque child', async () => {
  const { doc, data, send, sent, probes, cleaned } = bootstrapFixture();
  await send({ source: {} }); await send({ origin: 'null' }); await send({ data: { ...data, nonce: 'short' } });
  assert.equal(doc.body.children.length, 0);
  const opening = send({}); assert.equal(doc.body.children.length, 0, 'source cannot run before enforcement');
  await opening; const frame = doc.body.children[0];
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts');
  assert.match(frame.srcdoc, /connect-src 'none'; frame-src 'none'; form-action 'none'/);
  assert.ok(frame.srcdoc.endsWith('<p>kept</p>'));
  await send({}); assert.equal(doc.body.children.length, 1, 'initialization is one-use');
  const relay = { protocol: data.protocol, nonce: data.nonce, kind: 'height', height: 80 };
  send({ source: {}, origin: 'null', data: relay });
  send({ source: frame.contentWindow, origin: 'null', data: { ...relay, nonce: 'b'.repeat(48) } });
  assert.equal(sent.length, 0);
  send({ source: frame.contentWindow, origin: 'null', data: relay });
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [[relay, 'https://theseus.test']]);
  assert.deepEqual(probes, [['fetch', 'https://theseus.test/interactive-html'], ['image', 'https://theseus.test/interactive-html'],
    ['rtc', { iceServers: [{ urls: 'stun:192.0.2.1:9' }] }]]);
  assert.deepEqual(cleaned(), { closed: 1, disconnected: 1 });
});

test('920 missing enforcement, report-only, wrong policy and any successful probe keep source inert', async () => {
  for (const options of [{ report: false }, { fetchOK: true }, { imageOK: true },
    { reportPatch: { disposition: 'report' } }, { reportPatch: { allowlist: ['https://elsewhere.test'] } },
    { reportPatch: { url: 'https://elsewhere.test' } }]) {
    const f = bootstrapFixture(options); await f.send({});
    assert.equal(f.doc.body.children.length, 0, JSON.stringify(options));
    assert.equal(f.sent[0][0].kind, 'refused');
    assert.deepEqual(f.cleaned(), { closed: 1, disconnected: 1 });
  }
});

test('920 nonce-bound refusal replaces the frame with the exact original fence as text', () => {
  const { doc, host } = fixture(), listeners = [], messages = [];
  doc.defaultView = { crypto, addEventListener: (_, fn) => listeners.push(fn) };
  const original = '~~~HTML\r\n<script>doNotRun()</script>\r\n~~~';
  const block = interactiveHTML('<script>doNotRun()</script>', doc, original); host.root = true; host.append(block);
  block.dataset.start = '12'; block.dataset.end = '70';
  const frame = host.querySelector('iframe');
  frame.replaceWith = replacement => { host.replaceChildren(replacement); };
  frame.contentWindow = { postMessage: value => messages.push(value) }; frame.onload();
  const data = { ...messages[0], kind: 'refused' };
  listeners[0]({ source: frame.contentWindow, origin: 'null', data: { ...data, nonce: 'wrong' } });
  assert.equal(frames(host).length, 1);
  listeners[0]({ source: frame.contentWindow, origin: 'null', data });
  assert.equal(host.children[0] === block, true, 'fallback keeps the Reader passage and source-position owner');
  assert.deepEqual(block.dataset, { start: '12', end: '70' });
  assert.equal(frames(host).length, 0);
  assert.equal(host.querySelector('.md-pre').textContent, original);
  assert.equal(host.querySelector('.html-refusal').textContent, "This page's browser cannot isolate this block's network, so it is shown as text.");
  assert.equal(host.querySelectorAll('script').length, 0);
});
