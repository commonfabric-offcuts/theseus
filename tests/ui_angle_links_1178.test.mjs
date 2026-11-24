import test from 'node:test';
import assert from 'node:assert/strict';
import { formatWords, drawPassages, drawnText, literalLinkNodes, sourcePosition } from '../web/message-format.mjs';
import { writtenLink, openLinksWith } from '../web/links.mjs';
import { CardScroll } from '../web/card-scroll.mjs';
import { NotebookPage } from '../web/notebook-page.mjs';
import { deckBody } from '../web/deck.mjs';
import { document1178, bubble, painted1178, reportedLink, reportedTarget } from './fixtures/angle_links_1178.mjs';

const walk = node => [node, ...(node.childNodes ?? []).flatMap(walk)];
const refs = node => walk(node).filter(n => n.classList?.contains('words-reference'));
const anchors = node => walk(node).filter(n => n.tagName === 'A');
const render = (body, doc = document1178()) => formatWords(doc.createElement('div'), body);
const shape = node => ({ tag: node.tagName, text: node.textContent, className: node.className,
  href: node.href, target: node.target, rel: node.rel, title: node.title, attributes: node.attributes });

test('1178 the reported local angle link displays its label and retains the whole path title', () => {
  const host = render(reportedLink);
  assert.equal(host.textContent, 'Saved dose plan', 'the reported angle-local link displays only its authored label');
  const [reference] = refs(host);
  assert.equal(refs(host).length, 1); assert.equal(reference.tagName, 'SPAN');
  assert.equal(reference.title, reportedTarget); assert.equal(anchors(host).length, 0);
  assert.equal(reference.href, undefined); assert.equal(reference.getAttribute('href'), null);
  assert.equal(reference.getAttribute('tabindex'), null); assert.equal(reference.tabIndex, undefined);
  assert.equal(reference.getAttribute('role'), null); assert.equal(drawnText(host), reportedLink);
});

test('1178 angle local destinations retain spaces line suffixes parentheses and punctuation escapes', () => {
  for (const [target, title] of [
    ['/a path with spaces/file.md:28', '/a path with spaces/file.md:28'],
    ['~/Notes/a (new) plan).md:9', '~/Notes/a (new) plan).md:9'],
    ['file:///Users/reader/a path/file.md:28', 'file:///Users/reader/a path/file.md:28'],
    [String.raw`/a\<b\>/a\)plan.md:2`, '/a<b>/a)plan.md:2'],
    [String.raw`/a\\b/file.md:3`, '/a\\b/file.md:3'],
  ]) {
    const host = render(`before [words](<${target}>) after`);
    assert.equal(host.textContent, 'before words after', target);
    assert.equal(refs(host).length, 1); assert.equal(refs(host)[0].title, title);
    assert.equal(anchors(host).length, 0);
  }
});

test('1178 angle web and existing query destinations keep the ordinary anchor shape and owner', t => {
  const old = globalThis.location; globalThis.location = new URL('https://theseus.example/');
  const opened = []; openLinksWith((...args) => opened.push(args));
  t.after(() => { globalThis.location = old; openLinksWith(null); });
  for (const target of ['https://elsewhere.example/a(b)?x=1&y=2', 'https://elsewhere.example/a path', '?topic=t-test']) {
    const angled = anchors(render(`[words](<${target}>)`))[0];
    const plainTarget = target.replace('a path', 'a%20path');
    const plain = anchors(render(`[words](${plainTarget})`))[0];
    assert.ok(angled); assert.ok(plain); assert.deepEqual(shape(angled), shape(plain));
    assert.equal(bubble(angled, 'click').stopped, true);
  }
  assert.equal(opened.length, 1); assert.equal(opened[0][0].id, 't-test');
});

test('1178 formatted local labels stay atomic in message and Reader source mapping', () => {
  const body = 'Before [the **new** `plan`](</a path/plan.md:28>) after.';
  const start = body.indexOf('['), end = body.indexOf('>)') + 2;
  for (const reader of [false, true]) {
    const doc = document1178(), host = doc.createElement('div');
    if (reader) drawPassages(host, body, doc); else formatWords(host, body);
    assert.equal(host.textContent, 'Before the new plan after.');
    const [reference] = refs(host); assert.ok(reference.querySelector('strong')); assert.ok(reference.querySelector('code'));
    assert.equal(drawnText(host), body);
    for (const node of walk(reference).filter(n => n.nodeType === 3)) {
      assert.equal(sourcePosition(node, 0), start);
      assert.equal(sourcePosition(node, node.data.length, true), end);
      if (node.data.length > 1) { assert.equal(sourcePosition(node, 1), start); assert.equal(sourcePosition(node, 1, true), end); }
    }
    let previous = 0;
    for (const node of walk(host).filter(n => n.nodeType === 3)) for (let at = 0; at <= node.data.length; at++) {
      const position = sourcePosition(node, at); assert.ok(position >= previous); previous = position;
    }
  }
});

test('1178 malformed angle boundaries code and escaped openers stay literal', () => {
  for (const body of [
    '[words](</a path)', '[words](</a path> )', '[words](</a path>extra)',
    '[words](</a <nested> path>)', '[words](</a > early/path>)',
    '[words](</a\npath>)', '[words](</a\rpath>)',
    '`[words](</a path>)`', '```md\n[words](</a path>)\n```', String.raw`\[words](</a path>)`,
  ]) {
    const host = render(body); assert.equal(refs(host).length, 0, body); assert.equal(anchors(host).length, 0, body);
    assert.ok(host.textContent.includes('words'), body);
  }
});

test('1178 only explicit angle local references expand destination eligibility', () => {
  for (const target of ['/relative', '~/a path', 'file:///a path', '//elsewhere.example/a']) assert.equal(writtenLink(target), null, target);
  for (const target of ['javascript:alert(1)', 'data:text/html,test', '#fragment', 'relative/file.md']) {
    const host = render(`[words](<${target}>)`); assert.equal(refs(host).length, 0); assert.equal(anchors(host).length, 0);
  }
  const hostile = render('[<img src=x onerror=run>](</a path/"onclick=run.md:28>)');
  assert.equal(hostile.querySelectorAll('img').length, 0); assert.equal(hostile.querySelectorAll('script').length, 0);
  assert.equal(refs(hostile)[0].title, '/a path/"onclick=run.md:28');
  assert.equal(refs(hostile)[0].textContent, '<img src=x onerror=run>');
});

test('1178 repeated unclosed angle destinations retain linear formatter work', () => {
  const work = [];
  for (const n of [1000, 2000]) {
    const body = '[x](</a path '.repeat(n), meter = { steps: 0 }, doc = document1178();
    const host = doc.createElement('div'); formatWords(host, body, { meter });
    assert.equal(refs(host).length, 0); assert.equal(host.textContent, body);
    assert.ok(meter.steps > 0 && meter.steps <= 40 * body.length); work.push(meter.steps);
  }
  assert.ok(work[1] <= 2.2 * work[0]);
});

test('1178 the actual message CardScroll owner keeps references selectable and isolates their clicks', async () => {
  const doc = document1178(), card = doc.createElement('article'), preview = doc.createElement('div');
  preview.className = 'message-preview'; card.append(preview); doc.body.append(card);
  let folds = 0, opens = 0; card.addEventListener('click', () => folds++);
  openLinksWith(() => opens++);
  try {
    const scroll = new CardScroll({ read: async () => { throw Error('Unexpected read'); } });
    assert.equal(await scroll.showFull(card, { id: 'synthetic-1178', body: reportedLink }), true);
    assert.equal(preview.textContent, 'Saved dose plan');
    const reference = refs(preview)[0];
    for (const type of ['mousedown', 'click']) {
      const event = bubble(reference, type); assert.equal(event.stopped, true); assert.equal(event.defaultPrevented, false);
    }
    assert.equal(folds, 0); assert.equal(opens, 0); assert.equal(drawnText(preview), reportedLink);
    bubble(preview, 'click'); assert.equal(folds, 1, 'the surrounding card handler remains live');
  } finally { openLinksWith(null); }
});

test('1178 real DeckPage Display isolates reference clicks from edit select and fold owners', t => {
  const body = reportedLink + '\n\n## First\n\n' + reportedLink + '\n\n## Next\n\nkept\n';
  const p = painted1178(t, body), acts = [];
  p.editAt = (...args) => acts.push(['edit', ...args]); p.placeOf = () => 0;
  p.toggle = () => acts.push(['toggle']); p.extend = () => acts.push(['extend']); p.pick = () => acts.push(['pick']);
  let folds = 0; p.host.addEventListener('click', () => folds++);
  const words = p.list.querySelector('.deck-words'), reference = refs(words)[0];
  assert.equal(refs(p.opening)[0].title, reportedTarget); assert.equal(words.textContent, 'Saved dose plan');
  for (const extra of [{}, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }]) for (const type of ['mousedown', 'click']) {
    const event = bubble(reference, type, extra); assert.equal(event.stopped, true); assert.equal(event.defaultPrevented, false);
  }
  assert.deepEqual(acts, []); assert.equal(folds, 0); assert.equal(p.editing, undefined); assert.equal(deckBody(p.deck), body);
  bubble(words, 'click'); assert.equal(acts[0][0], 'edit', 'the actual parent edit handler is active for ordinary words');
  bubble(words, 'click', { metaKey: true }); assert.equal(acts[1][0], 'toggle', 'the actual modifier-selection handler is active');
});

test('1178 real NotebookPage passage composition preserves authored local link source', t => {
  const body = reportedLink + '\n\n## First\n\n' + reportedLink + '\n';
  const p = painted1178(t, body), source = { body, source_ref: { kind: 'memory', id: 'synthetic-1178', revision: 1 } }, bound = [];
  p.source = source; p.writing = { base: { source }, value: { body }, closed: false, deleted: false };
  p.passages = { bind(node, options) { bound.push({ node, options }); } };
  NotebookPage.prototype.readingPassages.call(p);
  assert.equal(bound.length, 2); assert.ok(bound.every(({ options }) => options.source === source && options.current()));
  const words = p.list.querySelector('.deck-words'), reference = refs(words)[0];
  assert.equal(reference.textContent, 'Saved dose plan'); assert.equal(reference.title, reportedTarget);
  assert.equal(p.writing.value.body, body); assert.equal(deckBody(p.deck), body); assert.equal(source.body, body);
  assert.equal(drawnText(words), reportedLink); assert.equal(drawnText(p.list.children[0]), '## First\n\n' + reportedLink);
  const text = walk(reference).find(n => n.nodeType === 3), rowSource = drawnText(p.list.children[0]);
  assert.equal(rowSource.slice(sourcePosition(text, 0), sourcePosition(text, text.data.length, true)), reportedLink);
});

test('1178 literal link consumers reuse angle parsing and existing authored label formatting', () => {
  const doc = document1178(), body = '[the **plan**](</a path/file.md:28>)';
  const host = doc.createElement('div'); host.append(...literalLinkNodes(body, { doc }));
  assert.equal(refs(host).length, 1); assert.equal(refs(host)[0].textContent, 'the plan');
  assert.equal(refs(host)[0].title, '/a path/file.md:28'); assert.equal(host.querySelectorAll('strong').length, 1);
});
