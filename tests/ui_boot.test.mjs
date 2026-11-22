// The page's boot (web/boot.js, docs/rails.md, "One build per document"): a
// module of the document's build that the server could not give loads the page
// afresh on the build the server serves, or says so with Reload; it never loops
// and never stays blank. The native build cases (tests/message_edit_native.mjs,
// "reading edit build a page whose modules …") load real pages across a deploy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../web/boot.js', import.meta.url), 'utf8');

class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.hidden = true; this.onclick = null; }
  setAttribute(name,value) { (this.attributes ??= {})[name] = value; }
  replaceChildren(...nodes) { this.children = nodes; }
  get textContent() { return this.children.map(n => typeof n === 'string' ? n : n.textContent).join(''); }
  set textContent(text) { this.children = [text]; }
}
class HTMLScriptElement extends Element {
  constructor(type, src) { super('script'); this.type = type; this.src = src; }
}

// A page with the boot run in it. answer: what /api/build gives, a function of the request (throw: the read fails).
function page(answer) {
  const listeners = [], asked = [], status = new Element('div'), reloads = [];
  const window = {
    HTMLScriptElement, URL,
    addEventListener: (type, listener, capture) => listeners.push({ type, listener, capture }),
    document: { getElementById: id => id === 'app-status' ? status : null, createElement: tag => new Element(tag) },
    location: { href: 'http://127.0.0.1:9/?topic=t1', reload: () => reloads.push(true) },
    fetch: async (url, init) => { asked.push([url, init]); return answer(); },
  };
  vm.runInNewContext(SOURCE, window);
  // An error dispatched at target, as the browser fires it, and every promise it began settled.
  const fail = async target => { for (const { type, listener } of listeners) if (type === 'error') listener({ target }); for (let i = 0; i < 10; i++) await null; await new Promise(r => setImmediate(r)); };
  return { listeners, asked, status, reloads, fail };
}
const entry = build => new HTMLScriptElement('module', `http://127.0.0.1:9/b/${build}/app.mjs`);
const serves = build => () => ({ ok: true, json: async () => ({ build }) });

test('the boot listens for errors as they go down to their target, before any module', () => {
  const { listeners } = page(serves('A'));
  assert.deepEqual(listeners.map(({ type, capture }) => [type, capture]), [['error', true]]);
});

test('an entry under a build the server no longer serves loads the page afresh, once, saying nothing', async () => {
  const p = page(serves('B'));
  await p.fail(entry('A'));
  // Asked in the page's own realm: compared as JSON.
  assert.equal(JSON.stringify(p.asked), JSON.stringify([['/api/build', { cache: 'no-store', credentials: 'same-origin' }]]));
  assert.deepEqual(p.reloads, [true]);
  assert.equal(p.status.hidden, true);
});

test('an entry the server could not give on its own build says so with Reload, and loads nothing by itself: no loop', async () => {
  const p = page(serves('A'));
  await p.fail(entry('A'));
  assert.deepEqual(p.reloads, [], 'the same build would fail the same way');
  assert.equal(p.status.hidden, false);
  assert.equal(p.status.textContent, 'Theseus could not open this page.Reload×');
  const again = p.status.children[1];
  assert.deepEqual([again.tagName, again.type, again.className], ['BUTTON', 'button', 'updated-reload']);
  again.onclick();
  assert.deepEqual(p.reloads, [true], 'Reload reloads');
});

test('with the build unread (no server, a refusal, an answer naming none) the page says so, and loads nothing by itself', async () => {
  for (const [what, answer] of [['no server', () => { throw new TypeError('Failed to fetch'); }], ['a refusal', () => ({ ok: false, json: async () => ({ build: 'B' }) })],
    ['no build', () => ({ ok: true, json: async () => ({}) })], ['an empty build', serves('')], ['not JSON', () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } })]]) {
    const p = page(answer);
    await p.fail(entry('A'));
    assert.deepEqual([p.reloads, p.status.hidden, p.status.textContent], [[], false, 'Theseus could not open this page.Reload×'], what);
  }
});

test('only the failure of a module under a build reads the build: an image, a classic script, a module outside a build, an inline one', async () => {
  for (const target of [new Element('img'), new HTMLScriptElement('', 'http://127.0.0.1:9/b/A/x.js'), new HTMLScriptElement('module', 'http://127.0.0.1:9/app.mjs'),
    new HTMLScriptElement('module', ''), null]) {
    const p = page(serves('B'));
    await p.fail(target);
    assert.deepEqual([p.asked.length, p.reloads, p.status.hidden], [0, [], true], String(target?.tagName) + ' ' + (target?.src ?? ''));
  }
});


test('1036 a pre-module boot failure closes and stays closed across repeated graph failures on that page',async()=>{
 const p=page(serves('A'));await p.fail(entry('A'));const close=p.status.children.find(n=>n.className==='page-notice-close');assert.ok(close,'the module-free fallback needs its own corner close');assert.equal(close.attributes['aria-label'],'Close notice');assert.equal(close.type,'button');close.onclick();assert.equal(p.status.hidden,true);await p.fail(entry('A'));assert.equal(p.status.hidden,true);assert.deepEqual(p.reloads,[]);
 const fresh=page(serves('A'));await fresh.fail(entry('A'));assert.equal(fresh.status.hidden,false);
});
