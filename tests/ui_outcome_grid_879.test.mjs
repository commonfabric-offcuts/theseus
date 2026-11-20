import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { miniDocument, matches } from './fixtures/mini_dom.mjs';
import { OutcomeTopicCards } from '../web/outcome-topic-cards.mjs';
import { ThingsRail } from '../web/things-rail.mjs';
import { Shell } from '../web/in-place-navigation.mjs';
import { panes, feedKey } from '../web/panes.mjs';

const source = name => readFileSync(new URL('../web/' + name, import.meta.url), 'utf8');
function fixture(t) {
  const prior = globalThis.document, held = { center: panes.center, outline: panes.outline, things: panes.things, write: panes.write };
  const doc = miniDocument(), make = doc.createElement;
  doc.defaultView = { innerWidth: 1440, innerHeight: 1000, getComputedStyle: () => ({ overflowY: 'visible', overflowX: 'visible' }), scrollBy() {} };
  doc.createElement = tag => {
    const node = make(tag); node.ownerDocument = doc;
    node.contains = other => { for (let at = other; at; at = at.parent) if (at === node) return true; return false; };
    node.matches = selector => selector.split(',').some(part => part.trim() !== '#main h1' && matches(node, part));
    node.closest = selector => { for (let at = node; at; at = at.parent) if (at.matches(selector)) return at; return null; };
    node.hasAttribute = name => node.getAttribute(name) !== null;
    Object.defineProperty(node, 'parentElement', { get: () => node.parent });
    node.checkVisibility = () => { for (let at = node; at; at = at.parent) if (at.hidden) return false; return node.isConnected; };
    node.getBoundingClientRect = () => node.box ?? { top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100 };
    node.getClientRects = () => node.checkVisibility() ? [node.getBoundingClientRect()] : [];
    return node;
  };
  doc.body = doc.createElement('body'); doc.body.root = true; doc.documentElement = doc.body;
  doc.getElementById = id => doc.body.querySelector('#' + id);
  doc.querySelector = selector => selector.startsWith('#main >') ? null : doc.body.querySelector(selector);
  const main = doc.createElement('main'); main.id = 'main'; const host = doc.createElement('div'); main.append(host); doc.body.append(main);
  const cards = new OutcomeTopicCards({ host }), opened = [], navigated = [];
  const paint = ids => cards.paint({ reader: 'reader', groups: [{ name: 'active', rows: ids.map(id => ({ href: '?topic=' + id, activate: () => opened.push(id), item: { id, title: id, message_count: 0 } })) }] });
  const place = (ids, columns, { left = 300, top = 80, stepX = 250, stepY = 180 } = {}) => ids.forEach((id, index) => {
    const x = left + index % columns * stepX, y = top + Math.floor(index / columns) * stepY;
    cards.cards.get(id).box = { left: x, right: x + 230, top: y, bottom: y + 150, width: 230, height: 150 };
  });
  const press = (key, extra = {}) => {
    const event = { key, target: doc.activeElement, preventDefault() { this.defaultPrevented = true; }, ...extra };
    const handled = feedKey(event, doc, () => navigated.push(doc.activeElement.dataset.topicId));
    return { handled, prevented: Boolean(event.defaultPrevented) };
  };
  const id = () => doc.activeElement?.dataset.topicId;
  panes.center = () => cards; panes.outline = panes.things = null;
  globalThis.document = doc; t.after(() => { globalThis.document = prior; Object.assign(panes, held); });
  return { doc, main, host, cards, paint, place, press, id, opened, navigated };
}
const ids = Array.from({ length: 10 }, (_, i) => String.fromCharCode(97 + i));

test('879 four-column cards move by their rectangles, including the uneven final row', t => {
  const f = fixture(t); f.paint(ids); f.place(ids, 4);
  const cases = [['a', 'ArrowRight', 'b'], ['d', 'ArrowLeft', 'c'], ['b', 'ArrowDown', 'f'], ['g', 'ArrowUp', 'c'],
    ['h', 'ArrowDown', 'j'], ['g', 'ArrowDown', 'j'], ['j', 'ArrowUp', 'f'], ['j', 'ArrowLeft', 'i']];
  for (const [from, key, to] of cases) {
    f.cards.cards.get(from).focus();
    assert.deepEqual(f.press(key), { handled: true, prevented: true }, from + ' ' + key);
    assert.equal(f.id(), to, from + ' ' + key + ' reaches nearest card in the adjacent visual row/column');
  }
  assert.equal(f.opened.length, 0, 'arrows never activate a topic');
  assert.equal(f.navigated.length, cases.length, 'actual focus movements report once');
});

test('879 all outer edges stay put and consume the arrow without a navigation notification', t => {
  const f = fixture(t); f.paint(ids); f.place(ids, 4);
  let railMoves = 0;
  for (const name of ['outline', 'things']) { const host = f.doc.createElement('aside'); f.doc.body.append(host); panes[name] = { host, focus() { railMoves++; return true; } }; }
  for (const [key, edge] of [['ArrowUp', ['a', 'b', 'c', 'd']], ['ArrowDown', ['i', 'j']], ['ArrowLeft', ['a', 'e', 'i']], ['ArrowRight', ['d', 'h', 'j']]]) {
    for (const from of edge) { f.cards.cards.get(from).focus(); assert.deepEqual(f.press(key), { handled: true, prevented: true }); assert.equal(f.id(), from, from + ' ' + key + ' stays'); }
  }
  assert.equal(railMoves, 0, 'card arrows do not escape to a rail');
  assert.deepEqual(f.navigated, [], 'an edge is handled but is not movement');
});

test('879 resize and visual order are read afresh; vertical moves choose centers, not DOM index or overlap', t => {
  const f = fixture(t); f.paint(ids); f.place(ids, 4);
  f.cards.cards.get('b').focus(); f.place(ids, 1); f.press('ArrowDown'); assert.equal(f.id(), 'c', 'phone layout uses the next physical row');
  f.place(['c', 'a', 'b', 'd', 'g', 'f', 'e', 'h', 'j', 'i'], 4);
  f.cards.cards.get('a').focus(); f.press('ArrowLeft'); assert.equal(f.id(), 'c', 'physical left differs from preceding DOM index');
  f.cards.cards.get('a').focus(); f.press('ArrowDown'); assert.equal(f.id(), 'f');
  // Two lower cards overlap the source's horizontal extent, but their
  // centers are unequal. The nearer center wins even with unequal widths.
  f.paint(['a', 'b', 'c']);
  f.cards.cards.get('a').box = { top: 0, bottom: 100, left: 100, right: 300, width: 200, height: 100 };
  f.cards.cards.get('b').box = { top: 150, bottom: 250, left: 0, right: 250, width: 250, height: 100 };
  f.cards.cards.get('c').box = { top: 150, bottom: 250, left: 260, right: 280, width: 20, height: 100 };
  f.cards.cards.get('a').focus(); f.press('ArrowDown'); assert.equal(f.id(), 'c', 'nearest horizontal center wins, despite b overlapping a');
});

test('879 first and last remain; other controls, modified arrows and writing retain their keys', t => {
  const f = fixture(t); f.paint(ids); f.place(ids, 4);
  f.doc.body.focus(); assert.equal(f.press('ArrowDown').handled, true); assert.equal(f.id(), 'a');
  assert.equal(f.press('End').handled, true); assert.equal(f.id(), 'j');
  assert.equal(f.press('Home').handled, true); assert.equal(f.id(), 'a');
  for (const extra of [{ metaKey: true }, { shiftKey: true }, { ctrlKey: true }, { altKey: true }, { isComposing: true }, { defaultPrevented: true }]) {
    assert.equal(f.press('ArrowRight', extra).handled, false); assert.equal(f.id(), 'a');
  }
  for (const tag of ['button', 'input', 'textarea', 'select']) {
    const other = f.doc.createElement(tag); f.host.append(other); other.focus();
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) { assert.equal(f.press(key).handled, false, tag + ' owns ' + key); assert.equal(f.doc.activeElement === other, true); }
  }
  const menu = f.doc.createElement('div'); menu.setAttribute('role', 'menu'); const button = f.doc.createElement('button'); menu.append(button); f.host.append(menu); button.focus();
  assert.equal(f.press('ArrowDown').handled, false); menu.remove();
  f.cards.cards.get('a').focus(); const modal = f.doc.createElement('dialog'); modal.setAttribute('open', ''); f.doc.body.append(modal);
  assert.equal(f.press('ArrowDown').handled, false); modal.remove();
  assert.equal(f.press('Enter').handled, false, 'Return belongs to the native link');
  f.doc.activeElement.onclick(); assert.deepEqual(f.opened, ['a']);
  f.paint([]); f.doc.body.focus(); assert.equal(f.press('ArrowDown').handled, false);
});

function railFixture(t) {
  const f = fixture(t), node = () => f.doc.createElement('div'), host = node(), backdrop = node(), row = node();
  host.id = 'things'; backdrop.id = 'things-backdrop'; backdrop.hidden = true; f.doc.body.append(host, backdrop, row);
  const query = f.doc.querySelector; f.doc.querySelector = selector => selector === '#main .eyebrow-row' ? row : query(selector);
  let loads = 0, subscriptions = 0, unsubscriptions = 0;
  // The lifecycle owners are real; drawing and reads are observed separately
  // so this check needs no native EventTarget, transport or storage.
  const rail = Object.assign(Object.create(ThingsRail.prototype), { doc: f.doc, host, backdrop, wide: { matches: true },
    handles: null, creators: new Map(), sections: new Map([['notebook', { details: node() }]]), serial: 0,
    paintHead() {}, clear() {}, closer: node(), reload() { loads++; this.stale = false; this.drawnOnce = true; } });
  const shell = new Shell({ doc: f.doc, win: { location: { href: 'https://fixture/?workspace=w' } } }); shell.install = () => {}; shell.follow(rail);
  const begin = kind => { shell.win.location.href = kind === 'workspace' ? 'https://fixture/?workspace=w' : kind === 'topic' ? 'https://fixture/?topic=t' : 'https://fixture/?conversation=w'; shell.begin({}); };
  const ready = () => shell.ready({ bootstrap: { instance_id: 'fixture', actor: 'reader' }, workspaceId: 'w', topic: { id: 't' }, live: { listen() { subscriptions++; return () => { unsubscriptions++; }; } } });
  return { ...f, rail, shell, row, begin, ready, counts: () => [loads, subscriptions, unsubscriptions] };
}

for (const wide of [true, false]) test('879 outcome home never shows or starts its right rail; topics and conversations keep theirs (' + (wide ? 'wide' : 'narrow') + ')', t => {
  const f = railFixture(t); f.rail.wide.matches = wide;
  f.begin('workspace'); f.ready();
  assert.equal(f.rail.host.hidden, true, 'outcome right rail is hidden');
  assert.equal(f.rail.control(), null, 'outcome has no rail opener');
  assert.equal(f.rail.handles === null, true, 'outcome starts no rail owner or reads');
  assert.deepEqual(f.counts(), [0, 0, 0]);
  f.rail.open(); assert.equal(f.doc.documentElement.hasAttribute('data-things-open'), false, 'hidden rail cannot cover the outcome');
  for (const kind of ['topic', 'conversation']) {
    f.begin(kind); f.ready(); assert.equal(f.rail.host.hidden, false, kind + ' retains right rail'); assert.ok(f.rail.control());
    assert.equal(f.rail.handles.route.kind, kind); assert.equal(f.rail.shows(), wide);
    if (!wide) { f.rail.open(); assert.equal(f.rail.shows(), true); assert.equal(f.main.inert, true); }
  }
  assert.deepEqual(f.counts(), [2, 2, 1]);
  f.rail.open(); f.begin('workspace'); f.ready();
  assert.equal(f.rail.host.hidden, true); assert.equal(f.rail.control(), null); assert.equal(f.doc.documentElement.hasAttribute('data-things-open'), false);
  assert.equal(f.main.inert, false); assert.equal(f.rail.backdrop.hidden, true); assert.deepEqual(f.counts(), [2, 2, 2]);
});

// Restricted CSS source evaluator: braces/media/declarations and exact known
// selectors only. It evaluates these source contracts, not browser layout.
function rules(text, media = []) {
  const result = []; text = text.replace(/\/\*[\s\S]*?\*\//g, '');
  for (let at = 0; at < text.length;) {
    const open = text.indexOf('{', at); if (open < 0) break;
    let end = open + 1, depth = 1, quote = null;
    for (; end < text.length && depth; end++) {
      const ch = text[end]; if (quote) { if (ch === quote && text[end - 1] !== '\\') quote = null; }
      else if (ch === '"' || ch === "'") quote = ch; else if (ch === '{') depth++; else if (ch === '}') depth--;
    }
    const selector = text.slice(at, open).trim(), body = text.slice(open + 1, end - 1);
    if (selector.startsWith('@media')) result.push(...rules(body, [...media, selector]));
    else if (!selector.startsWith('@')) result.push({ selector, media, props: Object.fromEntries(body.split(';').map(part => part.trim()).filter(part => part.includes(':')).map(part => { const i = part.indexOf(':'); return [part.slice(0, i).trim(), part.slice(i + 1).trim()]; })) });
    at = end;
  }
  return result;
}
const sheet = rules(source('aim.css') + '\n' + source('rails.css') + '\n' + source('stack-look.css'));
const active = (rule, width, dark) => rule.media.every(media => (!/prefers-color-scheme/.test(media) || media.includes(dark ? 'dark' : 'light')) &&
  [...media.matchAll(/(min|max)-width:\s*(\d+)px/g)].every(([, bound, n]) => bound === 'min' ? width >= +n : width <= +n));
const styles = (selectors, width = 1440, dark = false) => Object.assign({}, ...sheet.filter(rule => active(rule, width, dark) && rule.selector.split(',').some(selector => selectors.includes(selector.trim()))).map(rule => rule.props));
const resolve = (value, tokens) => value?.replace(/var\((--[\w-]+)\)/g, (_, name) => resolve(tokens[name], tokens));

test('879 source layout gives the rail space back and fits four or more cards at 1440, one on phones', () => {
  const outcomeLayout = ['.workspace-layout', '[data-rails] .workspace-layout', '[data-rails] .workspace-layout:has(#outcome-page:not([hidden]) .outcome-topic-cards)'];
  assert.equal(styles(outcomeLayout)['grid-template-columns'], '18rem minmax(0,1fr)', 'no empty right-rail column on an outcome');
  assert.equal(styles(['.workspace-layout', '[data-rails] .workspace-layout'])['grid-template-columns'], '18rem minmax(0,1fr) 18rem', 'topics keep both rails');
  assert.equal(styles(['main', '[data-rails] .workspace-layout:has(#outcome-page:not([hidden]) .outcome-topic-cards) #main'])['max-width'], 'none');
  assert.equal(styles(['.selection-page', '[data-rails] #outcome-page:not([hidden]):has(.outcome-topic-cards)'])['max-width'], 'none');
  const grid = styles(['.outcome-topic-grid']), pattern = /^repeat\(auto-fit,minmax\(min\(100%,([\d.]+)rem\),1fr\)\)$/;
  assert.match(grid['grid-template-columns'], pattern, 'columns fit the available width');
  const minimum = +grid['grid-template-columns'].match(pattern)[1] * 16, gap = parseFloat(grid.gap) * 16;
  const main = styles(['main']), padding = main.padding.match(/clamp\(([\d.]+)rem,([\d.]+)vw,([\d.]+)rem\)/);
  assert.ok(padding, 'read the shipped main horizontal padding');
  const columns = width => { const side = Math.max(+padding[1] * 16, Math.min(width * +padding[2] / 100, +padding[3] * 16)); return Math.floor((width - 18 * 16 - side * 2 + gap) / (minimum + gap)); };
  assert.ok(columns(1440) >= 4, 'four fit at 1440'); assert.ok(columns(1920) > columns(1440), 'wider screens gain columns');
  for (const width of [320, 375, 390, 760]) assert.equal(styles(['.outcome-topic-grid'], width)['grid-template-columns'], 'minmax(0,1fr)', width + ' keeps one column');
});

test('879 source title and meta resolve to white only in dark mode; light colors remain exact', () => {
  for (const dark of [false, true]) {
    const tokens = styles([':root'], 1440, dark);
    const title = resolve(styles(['.outcome-topic-title'], 1440, dark).color, tokens);
    const meta = resolve(styles(['.outcome-topic-meta'], 1440, dark).color, tokens);
    assert.equal(title, dark ? '#fff' : '#23695e', 'title ' + (dark ? 'dark' : 'light'));
    assert.equal(meta, dark ? '#fff' : '#59636a', 'meta ' + (dark ? 'dark' : 'light'));
  }
});

test('879 width rules require the visible cards host created only by the outcome-home branch', () => {
  const index = source('index.html'), app = source('app.mjs');
  // The shared container is present even on a topic page. Its presence alone
  // cannot identify an outcome home. Read the actual page and creator code.
  assert.match(index, /<section id="outcome-page" class="selection-page" hidden><\/section>/);
  assert.equal(index.includes('outcome-topic-cards'), false, 'no static cards host on other routes');
  const creator = "cardsHost.className='outcome-topic-cards'";
  assert.equal(app.split(creator).length - 1, 1, 'one real cards-host creation site');
  const start = app.indexOf('async function initializeOutcomePage(route) {');
  const end = app.indexOf('\nfunction pipelineSend(', start);
  assert.ok(start >= 0 && end > start);
  const page = app.slice(start, end);
  const guard = page.indexOf("if(!['root','workspace'].includes(route.kind))throw");
  const shown = page.indexOf("$('outcome-page').hidden=false;");
  const root = page.indexOf("if(route.kind==='root') {");
  const workspace = page.indexOf('\n  } else {', root);
  const created = page.indexOf(creator);
  assert.ok(guard >= 0 && guard < shown && shown < root && root < workspace && workspace < created,
    'only the workspace branch creates cards, after showing the outcome page');
  assert.equal(page.slice(root, workspace).includes(creator), false, 'Outcomes home has no cards host');
  assert.match(page.slice(created), /\$\('topic-navigation'\)\.append\(cardsHost\)/);
  assert.match(page.slice(workspace, created), /\$\('outcome-page'\)\.append\([^;]*\$\('topic-navigation'\)/);
  // Derive the overridden rules from rails.css rather than telling styles()
  // which selectors a hypothetical page would match.
  const overrides = rules(source('rails.css')).filter(rule => (rule.selector.includes('.workspace-layout:has(') || rule.selector.includes('#outcome-page')) &&
    (rule.props['grid-template-columns'] === '18rem minmax(0,1fr)' || rule.props['max-width'] === 'none'));
  const key = '[data-rails] .workspace-layout:has(#outcome-page:not([hidden]) .outcome-topic-cards)';
  assert.deepEqual(overrides.map(rule => rule.selector), [key, key + ' #main', '[data-rails] #outcome-page:not([hidden]):has(.outcome-topic-cards)']);
  assert.equal(styles(['.workspace-layout', '[data-rails] .workspace-layout'])['grid-template-columns'], '18rem minmax(0,1fr) 18rem');
  assert.equal(styles(['main'])['max-width'], '75rem');
  assert.equal(styles(['.selection-page'])['max-width'], '50rem');
});
