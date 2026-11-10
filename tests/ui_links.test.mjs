// Links in a message's words and a click outside a pop-up (docs/links.md),
// below the browser: which words become a link and where it opens, on a small
// document; and which presses close a pop-up, on a dialog with a box. The
// native checks in tests/links_native.mjs press them in a real browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webLinks, wordNodes, linkWords, openLinksWith, nameTopicsWith, shareLinksFrom, messageLink, pageLink } from '../web/links.mjs';
import { parseRoute, routeHref } from '../web/topic-navigation.mjs';
import { closeOnOutsideClick } from '../web/dismiss.mjs';
import { foldCard } from '../web/fold.mjs';

// A document that makes text nodes and elements, each element listening.
class Element {
  constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], handlers: {}, dataset: {}, attributes: {}, textContent: '', className: '', href: '', target: '', rel: '' }); }
  addEventListener(name, fn) { (this.handlers[name] ??= []).push(fn); }
  replaceChildren(...nodes) { this.children = nodes; for (const node of nodes) node.parentNode = this; }
  append(...nodes) { for (const node of nodes.map(node => typeof node === 'string' ? doc.createTextNode(node) : node)) { node.parentNode = this; this.children.push(node); } }
  replaceChild(node, old) { this.children[this.children.indexOf(old)] = node; node.parentNode = this; old.parentNode = null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  get ownerDocument() { return doc; }
  get text() { return this.children.length ? this.children.map(child => child.text ?? child.data).join('') : this.textContent; }
}
const doc = { createElement: tag => new Element(tag), createTextNode: data => ({ nodeType: 3, data, text: data }) };
const words = text => webLinks(text).map(link => text.slice(link.start, link.end));
// A click on an element, as the browser hands it to its listeners.
const click = (element, fields = {}) => {
  const event = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, stopped: false, prevented: false,
    stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; }, ...fields };
  for (const fn of element.handlers.click ?? []) fn(event);
  return event;
};
const here = (t, origin = 'https://theseus.example:5211') => {
  const previous = globalThis.location;
  globalThis.location = new URL(origin + '/?topic=t1');
  t.after(() => { globalThis.location = previous; openLinksWith(null); nameTopicsWith(() => null); shareLinksFrom(null); });
};

test('only an http or https address is a link, and one written inside a word is not', () => {
  assert.deepEqual(words('see https://a.example/x and http://b.example'), ['https://a.example/x', 'http://b.example']);
  assert.deepEqual(words('HTTPS://A.EXAMPLE/Path'), ['HTTPS://A.EXAMPLE/Path'], 'the scheme in capitals is still a web address');
  for (const text of ['javascript:alert(1)', 'ftp://a.example/x', 'mailto:tony@example.com', 'file:///etc/hosts', 'data:text/html,<b>x</b>', 'www.example.com', 'https://', 'https://?x'])
    assert.deepEqual(words(text), [], text + ' is words');
  assert.deepEqual(words('xhttps://a.example/x 1https://b.example'), [], 'a scheme run on from a word or number is not an address');
  assert.deepEqual(words('caféhttps://a.example/x 日本https://b.example e\u0301https://c.example'), [], 'in any script: a letter, or a mark that is part of one');
  assert.deepEqual(words('$https://a.example/x 。https://b.example'), ['https://a.example/x', 'https://b.example'], 'punctuation and symbols are no part of a word');
  assert.deepEqual(words('(https://a.example/x)'), ['https://a.example/x'], 'an opening bracket before it is not part of a word');
  assert.equal(webLinks('go https://a.example/a b')[0].href, 'https://a.example/a', 'the link goes where its words say');
  assert.deepEqual(webLinks(''), []);
  assert.deepEqual(webLinks(undefined), [], 'no words, no links');
});

test('an address ends at a space, angle bracket, quote mark or ellipsis, and leaves sentence punctuation and an unopened bracket outside', () => {
  assert.deepEqual(words('Shipped: https://a.example/r21. Next https://b.example/x?y=1, then https://c.example/z!'), ['https://a.example/r21', 'https://b.example/x?y=1', 'https://c.example/z']);
  assert.deepEqual(words('done https://a.example/x... and https://b.example/y;:?!'), ['https://a.example/x', 'https://b.example/y']);
  assert.deepEqual(words('(see https://a.example/x)'), ['https://a.example/x'], 'a closing bracket it did not open stays outside');
  assert.deepEqual(words('https://en.example/wiki/Foo_(bar)'), ['https://en.example/wiki/Foo_(bar)'], 'a bracket it opened is its own');
  assert.deepEqual(words('[https://a.example/x] {https://b.example/y}'), ['https://a.example/x', 'https://b.example/y']);
  assert.deepEqual(words('<https://a.example/x>"https://b.example/y"\'https://c.example/z\'`https://d.example`'), ['https://a.example/x', 'https://b.example/y', 'https://c.example/z', 'https://d.example']);
  assert.deepEqual(words('“https://a.example/x” ‘https://b.example/y’ https://c.example/z…more'), ['https://a.example/x', 'https://b.example/y', 'https://c.example/z']);
  assert.deepEqual(words('one\nhttps://a.example/x\ttwo'), ['https://a.example/x']);
  assert.deepEqual(words('*https://a.example/x*'), ['https://a.example/x'], 'emphasis marks stay outside');
  assert.deepEqual(words('**https://a.example/x** _https://b.example/y_ __https://c.example/z__ ~~https://d.example/w~~ (https://e.example/v_~*).'),
    ['https://a.example/x', 'https://b.example/y', 'https://c.example/z', 'https://d.example/w', 'https://e.example/v'], 'every mark a line reads (*, _, ~) stays outside, as GFM leaves it');
  assert.deepEqual(words('https://a.example/a_b~c*d'), ['https://a.example/a_b~c*d'], 'a mark inside an address is its own');
  assert.deepEqual(words('x_https://a.example/x a~https://b.example/y'), ['https://a.example/x', 'https://b.example/y'], 'a mark before an address is no word it continues');
});

test('an excerpt leaves an address it may have cut short as words, and keeps every whole one', () => {
  const partial = text => webLinks(text, { partial: true }).map(link => text.slice(link.start, link.end));
  assert.deepEqual(partial('read https://a.example/long-pa'), [], 'running to the end of an excerpt');
  assert.deepEqual(partial('read https://a.example/long-pa…'), [], 'running to the ellipsis that ends it');
  assert.deepEqual(partial('read https://a.example/long-pa  '), [], 'running to the end, spaces aside');
  assert.deepEqual(partial('https://a.example/x then more words'), ['https://a.example/x'], 'an address with words after it is whole');
  assert.deepEqual(words('read https://a.example/long-path'), ['https://a.example/long-path'], 'the whole message keeps its last address');
});

test('the words are text nodes and anchors, never markup, and every other word is kept as it was', () => {
  const text = '<b>bold</b> & https://a.example/x?a=1&b=<2> done.';
  const nodes = wordNodes(text, { doc });
  assert.deepEqual(nodes.map(node => node.tagName ?? '#text'), ['#text', 'A', '#text']);
  assert.equal(nodes[0].data, '<b>bold</b> & ', 'the markup is words in a text node');
  assert.equal(nodes.map(node => node.text).join(''), text, 'every character is drawn once, in order');
  assert.deepEqual(wordNodes('', { doc }).map(node => node.data), [''], 'no words: one empty text node');
  assert.deepEqual(wordNodes('https://a.example', { doc }).map(node => node.tagName ?? '#text'), ['A'], 'an address alone is one anchor');
  const host = new Element('span');
  assert.equal(linkWords(host, 'see https://a.example/x.'), host, 'linkWords hands back its host');
  assert.equal(host.text, 'see https://a.example/x.');
  assert.deepEqual(host.children.map(node => node.tagName ?? '#text'), ['#text', 'A', '#text']);
});

test('a link elsewhere opens in a new tab without the page behind, and its click presses nothing around it', t => {
  here(t);
  const opened = [];
  openLinksWith((route, title) => opened.push([route, title]));
  const [a] = wordNodes('https://other.example/x', { doc });
  assert.deepEqual([a.href, a.target, a.rel, a.className], ['https://other.example/x', '_blank', 'noopener noreferrer', 'words-link']);
  const event = click(a);
  assert.deepEqual([event.stopped, event.prevented, opened], [true, false, []], 'the browser follows it; the card under it hears nothing');
  // The same origin but not one of this Theseus's places is elsewhere too.
  for (const address of ['https://theseus.example:5211/api/bootstrap', 'https://theseus.example:5211/?topic=t1&x=2', 'https://theseus.example:5212/?topic=t2', 'http://theseus.example:5211/?topic=t2'])
    assert.equal(wordNodes(address, { doc })[0].target, '_blank', address + ' opens in a new tab');
});

test('a link to one of this Theseus\'s places opens it here, and a modified click is left to the browser', t => {
  here(t);
  const opened = [];
  openLinksWith((route, title) => opened.push([route, title]));
  const [topic] = wordNodes('https://theseus.example:5211/?topic=t-other', { doc });
  assert.deepEqual([topic.href, topic.target], ['?topic=t-other', '']);
  const event = click(topic);
  assert.deepEqual([event.stopped, event.prevented], [true, true]);
  assert.deepEqual(opened, [[{ kind: 'topic', id: 't-other' }, 'https://theseus.example:5211/?topic=t-other']]);
  opened.length = 0;
  const [outcome] = wordNodes('https://theseus.example:5211/?workspace=building-theseus', { doc });
  click(outcome);
  const [home] = wordNodes('https://theseus.example:5211/', { doc });
  click(home);
  assert.deepEqual(opened.map(([route]) => route), [{ kind: 'workspace', id: 'building-theseus' }, { kind: 'root' }]);
  assert.equal(home.href, '/');
  opened.length = 0;
  for (const fields of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    const modified = click(topic, fields);
    assert.deepEqual([modified.stopped, modified.prevented], [true, false], JSON.stringify(fields) + ' is the browser\'s own');
  }
  assert.deepEqual(opened, [], 'no modified click opens it here');
  // A place a link cannot open here (a new outcome's form) opens in a new tab.
  assert.equal(wordNodes('https://theseus.example:5211/?new=outcome&intent=i1', { doc })[0].target, '_blank');
});

// A dialog laid out with a box, and the page's window, each listening.
function popup({ box = { left: 400, right: 1000, top: 100, bottom: 700 }, open = true } = {}) {
  const win = { handlers: {}, addEventListener(name, fn, capture) { assert.equal(capture, true, 'seen on the way down'); this.handlers[name] = fn; } };
  const dialog = { open, inner: null, handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; },
    getBoundingClientRect: () => box, querySelector: selector => (assert.equal(selector, '[role="dialog"]:not([hidden])'), dialog.inner) };
  let closed = 0;
  closeOnOutsideClick(dialog, () => { closed++; dialog.open = false; }, win);
  const at = (x, y, target = dialog, more = {}) => ({ target, clientX: x, clientY: y, button: 0, isPrimary: true, ...more });
  // A press and its release: pointerdown where it starts, then the click the
  // browser sends to the common ancestor, at the point where it ends.
  const press = (down, up = down) => { win.handlers.pointerdown(down); dialog.handlers.click(up); };
  return { dialog, at, press, closed: () => closed };
}

test('a press that starts and ends outside a pop-up closes it, on every side, as its × does', () => {
  for (const [x, y] of [[399, 400], [1000, 400], [700, 99], [700, 700], [5, 5]]) {
    const p = popup();
    p.press(p.at(x, y));
    assert.equal(p.closed(), 1, `${x},${y} is outside`);
  }
});

test('a press inside, a drag out of it or into it, and a press while it is shut leave a pop-up alone', () => {
  const inside = popup();
  inside.press(inside.at(999, 699));
  assert.equal(inside.closed(), 0, 'on its own empty space, inside its box');
  const field = {};
  const dragOut = popup();
  dragOut.press(dragOut.at(600, 400, field), dragOut.at(50, 400));
  assert.equal(dragOut.closed(), 0, 'a selection started in its writing and let go on the backdrop');
  const dragIn = popup();
  dragIn.press(dragIn.at(50, 400), dragIn.at(600, 400));
  assert.equal(dragIn.closed(), 0, 'started on the backdrop and let go inside');
  const target = popup();
  target.press(target.at(50, 400), target.at(50, 400, field));
  assert.equal(target.closed(), 0, 'a click whose target is inside is not on the backdrop');
  const shut = popup({ open: false });
  shut.press(shut.at(50, 400));
  assert.equal(shut.closed(), 0, 'a shut pop-up is not closed again');
  // One press is one decision: a release with no press of its own after it does nothing.
  const once = popup();
  once.press(once.at(50, 400), once.at(600, 400));
  once.dialog.handlers.click(once.at(50, 400));
  assert.equal(once.closed(), 0, 'the press that went inside is spent');
});

test('only the primary button\'s press closes a pop-up, and one that closes a smaller pop-up inside it closes only that', () => {
  for (const more of [{ button: 2 }, { button: 1 }, { isPrimary: false }]) {
    const p = popup();
    p.press(p.at(50, 400, undefined, more));
    assert.equal(p.closed(), 0, JSON.stringify(more));
  }
  const nested = popup();
  nested.dialog.inner = { role: 'dialog' };
  // The smaller pop-up's own press handler removes it on the way down; the
  // outer one has already seen it was open.
  nested.press(nested.at(50, 400));
  assert.equal(nested.closed(), 0, 'the press closed the color picker, not the Reader');
  nested.dialog.inner = null;
  nested.press(nested.at(50, 400));
  assert.equal(nested.closed(), 1, 'the next press outside closes it');
});

test('a folded message\'s line shows its first line\'s web addresses as links, and one an excerpt may have cut as words', () => {
  const previous = globalThis.document;
  globalThis.document = doc;
  try {
    const folded = item => {
      const fold = foldCard(Object.assign(new Element('button'), { setAttribute() {} }), { id: 'm1', seq: 1, author_id: 'aim-core', addressees: ['aim-ux'], ...item }, doc);
      const words = fold.children[0].children[1];
      return { text: words.text, links: words.children.filter(node => node.tagName === 'A').map(a => a.textContent) };
    };
    assert.deepEqual(folded({ body: 'The run is https://ci.example/run/7 now.\nMore below.' }),
      { text: ' to aim-ux: The run is https://ci.example/run/7 now.', links: ['https://ci.example/run/7'] });
    assert.deepEqual(folded({ body: 'Logs: https://ci.example/run/7\nhttps://ci.example/run/8', preview: true }).links, ['https://ci.example/run/7'],
      'an excerpt cut after its first line leaves that line whole');
    assert.deepEqual(folded({ body: 'Logs: https://ci.example/run/7-and-the-rest', preview: true }).links, [],
      'an excerpt of one line may end inside its address, so the address is words');
    assert.deepEqual(folded({ body: 'Logs: https://ci.example/run/7-and-the-rest', preview: false }).links, ['https://ci.example/run/7-and-the-rest']);
  } finally { globalThis.document = previous; }
});

// docs/links.md, "A message's link" and "Topics named in a message".
const T1 = 't-' + '1'.repeat(32), T2 = 't-' + 'a'.repeat(32), NOWHERE = 't-' + 'f'.repeat(32);
const names = new Map([[T1, 'Launch copy'], [T2, 'Where the plan carried on']]);
// What wordNodes drew: each node as its words, or an anchor as [shown, title, href].
const drawn = nodes => nodes.map(node => node.tagName === 'A' ? [node.textContent, node.title ?? '', node.href] : node.data);

test('a message\'s link names its topic and the message, and opens that message from this address or the tailnet one', t => {
  here(t, 'http://127.0.0.1:5210');
  const route = { kind: 'topic', id: T1, message: 'm-1' };
  assert.equal(routeHref(route), `?topic=${T1}&message=m-1`);
  assert.deepEqual(parseRoute(new URL(`http://127.0.0.1:5210/?topic=${T1}&message=m-1`)), route);
  assert.deepEqual(parseRoute(new URL(`http://127.0.0.1:5210/?message=m-1&topic=${T1}`)), route, 'in either order');
  assert.throws(() => parseRoute(new URL('http://127.0.0.1:5210/?message=m-1')), /incomplete or ambiguous/, 'a message names its topic');
  assert.throws(() => routeHref({ kind: 'topic', id: T1, message: '' }), /incomplete or ambiguous/);
  // Copied with no tailnet address: this page's own.
  assert.equal(messageLink(T1, 'm-1'), `http://127.0.0.1:5210/?topic=${T1}&message=m-1`);
  const phone = `https://mac.example.ts.net:5210/?topic=${T1}&message=m-1`;
  assert.equal(wordNodes(phone, { doc })[0].target, '_blank', 'another origin is elsewhere while the instance names none');
  shareLinksFrom('https://mac.example.ts.net:5210');
  assert.equal(messageLink(T1, 'm-1'), phone, 'copied on the Mac, it names the address a phone reaches');
  const opened = [];
  openLinksWith((target, title, link) => opened.push([target, title, link]));
  const [a] = wordNodes(phone, { doc });
  assert.deepEqual([a.href, a.target], [`?topic=${T1}&message=m-1`, ''], 'the tailnet address is one of this Theseus\'s places, here too');
  click(a);
  assert.deepEqual(opened.map(([target]) => target), [route]);
  assert.equal(opened[0][2], a, 'the page hears which link was pressed, to give it the focus back');
  shareLinksFrom('');
  assert.equal(messageLink(T1, 'm-1'), `http://127.0.0.1:5210/?topic=${T1}&message=m-1`, 'an empty origin names none');
});

// docs/links.md, "A Notebook page's link".
test('a Notebook page\'s link names its Notebook and the page, latest or at a revision, and opens it here from this address or the tailnet one', t => {
  here(t, 'http://127.0.0.1:5210');
  const latest = { kind: 'topic', id: T1, page: 'n-1' }, revised = { kind: 'topic', id: T1, page: 'n-1', revision: '3' };
  const outcome = { kind: 'workspace', id: 'w-1', page: 'n-2' }, outcomeAt = { kind: 'workspace', id: 'w-1', page: 'n-2', revision: '1' };
  assert.equal(routeHref(latest), `?topic=${T1}&page=n-1`);
  assert.equal(routeHref(revised), `?topic=${T1}&page=n-1&revision=3`);
  assert.equal(routeHref(outcomeAt), '?workspace=w-1&page=n-2&revision=1');
  for (const route of [latest, revised, outcome, outcomeAt]) assert.deepEqual(parseRoute(new URL('http://127.0.0.1:5210/' + routeHref(route))), route);
  assert.deepEqual(parseRoute(new URL(`http://127.0.0.1:5210/?revision=3&page=n-1&topic=${T1}`)), revised, 'in any order');
  for (const bad of [`?topic=${T1}&revision=3`, `?topic=${T1}&page=n-1&revision=0`, `?topic=${T1}&page=n-1&revision=x`,
    `?topic=${T1}&page=n-1&message=m-1`, '?page=n-1', '?workspace=w-1&revision=2', `?topic=${T1}&page=`]) {
    assert.throws(() => parseRoute(new URL('http://127.0.0.1:5210/' + bad)), /incomplete or ambiguous/, bad);
  }
  // A page is named alone, never with a message, and a revision only with its page.
  assert.throws(() => routeHref({ kind: 'topic', id: T1, message: 'm-1', page: 'n-1' }), /incomplete or ambiguous/);
  assert.throws(() => routeHref({ kind: 'workspace', id: 'w-1', revision: '2' }), /incomplete or ambiguous/);
  assert.throws(() => routeHref({ kind: 'topic', id: T1, page: 'n-1', revision: '02' }), /incomplete or ambiguous/);
  // Copied with no tailnet address: this page's own; with one, the address a phone reaches.
  assert.equal(pageLink({ kind: 'topic', id: T1 }, 'n-1'), `http://127.0.0.1:5210/?topic=${T1}&page=n-1`);
  shareLinksFrom('https://mac.example.ts.net:5210');
  assert.equal(pageLink({ kind: 'workspace', id: 'w-1' }, 'n-2', 1), 'https://mac.example.ts.net:5210/?workspace=w-1&page=n-2&revision=1');
  assert.throws(() => pageLink({ kind: 'message', id: 'm-1' }, 'n-1'), /Notebook/);
  // Pasted into a message, each is one of this Theseus's places, and a press opens it here.
  const opened = [];
  openLinksWith(target => opened.push(target));
  const text = `Results: ${pageLink({ kind: 'workspace', id: 'w-1' }, 'n-2', 1)} and http://127.0.0.1:5210/?topic=${T1}&page=n-1.`;
  const anchors = wordNodes(text, { doc }).filter(node => node.tagName === 'A');
  assert.deepEqual(anchors.map(a => [a.href, a.target]), [['?workspace=w-1&page=n-2&revision=1', ''], [`?topic=${T1}&page=n-1`, '']]);
  for (const a of anchors) click(a);
  assert.deepEqual(opened, [outcomeAt, latest]);
});

test('a link to a page in a topic\'s Notebook shows "Notebook page in" and the topic\'s name', t => {
  here(t);
  nameTopicsWith(id => names.get(id) ?? null);
  assert.deepEqual(drawn(wordNodes(`See https://theseus.example:5211/?topic=${T1}&page=n-1&revision=2 now`, { doc })),
    ['See ', ['Notebook page in Launch copy', `https://theseus.example:5211/?topic=${T1}&page=n-1&revision=2`, `?topic=${T1}&page=n-1&revision=2`], ' now']);
});

test('a link to an outcome\'s conversation, its pipeline or one of its items opens here', t => {
  here(t);
  const opened = [];
  openLinksWith(target => opened.push(target));
  for (const address of ['https://theseus.example:5211/?conversation=w1', 'https://theseus.example:5211/?pipeline=w1', 'https://theseus.example:5211/?pipeline=w1&item=24']) {
    const [a] = wordNodes(address, { doc });
    assert.equal(a.target, '', address + ' opens here');
    click(a);
  }
  assert.deepEqual(opened, [{ kind: 'conversation', id: 'w1' }, { kind: 'pipeline', id: 'w1' }, { kind: 'item', id: 'w1', item: '24' }]);
});

test('a topic\'s id standing on its own is a link that shows the topic\'s name and opens it; one run into a word or the page cannot name stays words', t => {
  here(t);
  nameTopicsWith(id => names.get(id) ?? null);
  const opened = [];
  openLinksWith((target, title) => opened.push([target, title]));
  const text = `See ${T1}, then x${T2} and ${T2}x and ${T2}-2 and ${NOWHERE}.`;
  assert.deepEqual(drawn(wordNodes(text, { doc })), ['See ', ['Launch copy', T1, `?topic=${T1}`],
    `, then x${T2} and ${T2}x and ${T2}-2 and `, NOWHERE, '.'], 'the id no topic answers to is words, in its own text node');
  assert.deepEqual(words(`(${T2})`), [T2], 'a bracket is not part of a word');
  assert.deepEqual(words(`_${T1}_ __${T2}__ ~~${T1}~~ *${T2}*`), [T1, T2, T1, T2], 'nor is a mark: an id in italics, bold or struck words is its own');
  assert.deepEqual(words('t-' + '1'.repeat(31) + ' t-' + 'A'.repeat(32)), [], 'only the ids Theseus makes: 32 lowercase hex digits');
  const [, link] = wordNodes(text, { doc });
  assert.equal(link.dataset.words, String(T1.length), 'the Reader counts the words the link stands for');
  click(link);
  assert.deepEqual(opened, [[{ kind: 'topic', id: T1 }, 'Launch copy']]);
  // An id inside an address is the address's, drawn once.
  assert.deepEqual(webLinks(`https://theseus.example:5211/?topic=${T1}`).length, 1);
});

test('a link to a topic shows its name, a link to a message shows "Message in" and its topic\'s name, and one the page cannot name shows its address', t => {
  here(t);
  nameTopicsWith(id => names.get(id) ?? null);
  const topic = `https://theseus.example:5211/?topic=${T1}`, message = `https://theseus.example:5211/?topic=${T2}&message=m-9`;
  const unnamed = `https://theseus.example:5211/?topic=${NOWHERE}`;
  assert.deepEqual(drawn(wordNodes(`${topic} ${message} ${unnamed}`, { doc })), [['Launch copy', topic, `?topic=${T1}`], ' ',
    ['Message in Where the plan carried on', message, `?topic=${T2}&message=m-9`], ' ', [unnamed, '', `?topic=${NOWHERE}`]]);
  // A namer that fails is a name not known.
  nameTopicsWith(() => { throw Error('no read'); });
  assert.deepEqual(drawn(wordNodes(`${T1} ${topic}`, { doc })), [T1, ' ', [topic, '', `?topic=${T1}`]]);
});

test('a name the page must read first arrives in place: a bare id becomes its link then, and one that cannot be named stays words', async t => {
  here(t);
  const reads = new Map([[T1, Promise.resolve('Launch copy')], [NOWHERE, Promise.resolve(null)], [T2, Promise.reject(Error('offline'))]]);
  nameTopicsWith(id => reads.get(id));
  const host = new Element('span');
  linkWords(host, `${T1} ${NOWHERE} ${T2} https://theseus.example:5211/?topic=${T1}`);
  assert.deepEqual(host.children.map(node => node.tagName ?? '#text'), ['#text', '#text', '#text', '#text', '#text', '#text', 'A'],
    'until the names arrive, a bare id is words and an address is its link');
  await Promise.allSettled(reads.values()); await null;
  assert.deepEqual(drawn(host.children), [['Launch copy', T1, `?topic=${T1}`], ' ', NOWHERE, ' ', T2, ' ',
    ['Launch copy', `https://theseus.example:5211/?topic=${T1}`, `?topic=${T1}`]]);
  assert.equal(host.text, `Launch copy ${NOWHERE} ${T2} Launch copy`);
});
