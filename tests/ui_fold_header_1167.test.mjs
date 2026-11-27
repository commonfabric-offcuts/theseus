// Actual renderer/handler checks with isolated record doubles. CSS checks are
// source contracts only: no native layout, input or timing is simulated here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { miniDocument, Element } from './fixtures/mini_dom.mjs';
import { withReaderArchive } from './fixtures/reader_archive.mjs';
import { arrangeStacks, stackState, setLevel, headerClick, foldedClick } from '../web/reply-stacks.mjs';
import { foldCard } from '../web/fold.mjs';
import { StackFeed } from '../web/stack-feed.mjs';
import { answered, contact } from '../web/api.mjs';

// The renderer uses direct-child chains; extend only this file's DOM port.
const query = Element.prototype.querySelectorAll;
Element.prototype.querySelectorAll = function(selector) {
  if (selector === '*') return [...this.descendants()];
  if (selector.includes(', ')) return [...new Set(selector.split(', ').flatMap(part => this.querySelectorAll(part)))];
  const parts = selector.split(' > ');
  if (parts.length > 2) return query.call(this, parts.slice(0, 2).join(' > ')).flatMap(child => child.querySelectorAll(':scope > ' + parts.slice(2).join(' > ')));
  return query.call(this, selector);
};
Object.defineProperties(Element.prototype, {
  ownerDocument: { get() { return this.document; } },
  firstElementChild: { get() { return this.children[0] ?? null; } },
  nextElementSibling: { get() { return this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null; } },
  parentElement: { get() { return this.parent; } },
  style: { get() { return { setProperty() {}, removeProperty() {} }; } },
});
Element.prototype.contains = function(node) { return node === this || [...this.descendants()].includes(node); };
Element.prototype.after = function(node) { this.parent.insertBefore(node, this.nextElementSibling); };

function fixture({ count = 3, only = false, records = new Map(), wrapped = false } = {}) {
  const doc = withReaderArchive(miniDocument()), list = doc.createElement('div'); list.root = true;
  const messages = new Map(), cards = new Map(), entries = new Map(), commands = [], notices = [];
  for (let seq = 1; seq <= count; seq++) {
    const id = 'm' + seq;
    if (!records.has(id)) records.set(id, { folded: false, fold_revision: 0, starred: false });
    const item = { id, seq, topic_id: 'isolated-1167', author_id: seq === 1 ? 'reader' : 'agent',
      body: 'Exact words ' + seq, addressees: [], reply_to: seq === 1 ? null : 'm1', acts: structuredClone(records.get(id)) };
    const card = doc.createElement('button'); card.className = 'message-card'; card.dataset.id = id; card.dataset.seq = String(seq);
    const header = doc.createElement('span'); header.className = 'message-author';
    const author = doc.createElement('span'); author.className = 'author-name'; author.textContent = item.author_id;
    header.append(author);
    const body = doc.createElement('span'); body.className = 'message-preview'; body.textContent = item.body;
    card.append(header, body);
    const entry = wrapped && seq === 1 ? foldCard(card, item, doc) : card;
    list.append(entry); messages.set(id, item); cards.set(id, card); entries.set(id, entry);
  }
  const state = stackState(list);
  if (only) { list.classList.add('only-new'); state.only = () => true; }
  const feed = Object.assign(Object.create(StackFeed.prototype), { doc, list, undos: [], messages: () => messages,
    actsOf: id => messages.get(id).acts, entryFor: id => entries.get(id), remember(action) { this.undos.push(action); },
    focusOn() {}, say(words) { notices.push(words); }, status(words) { notices.push(words); },
    act(kind, item, args) {
      assert.equal(kind, 'message.fold');
      const before = records.get(item.id), kept = { ...before, folded: args.folded, fold_revision: before.fold_revision + 1 };
      records.set(item.id, kept); item.acts = structuredClone(kept);
      commands.push({ kind, id: item.id, args, previous: before.fold_revision, revision: kept.fold_revision });
      return { recorded: true };
    } });
  const draw = () => arrangeStacks(list, messages, { doc, viewer: 'reader', on: { fold: id => feed.foldId(id), unfold: id => feed.unfoldId(id) } });
  feed.arrange = draw;
  draw(); setLevel(state, state.stacks[0], 'open'); draw();
  const card = id => cards.get(id), header = id => card(id).querySelector(':scope > .message-author');
  const chevron = id => card(id).querySelector(':scope > .message-header-chevron');
  return { doc, list, messages, records, commands, notices, cards, entries, state, feed, draw, card, header, chevron };
}

test('1167 foldable headers draw a noninteractive chevron without moving author fragments', () => {
  const f = fixture();
  for (const id of ['m1', 'm2', 'm3']) {
    const header = f.header(id), author = header.firstElementChild, svg = f.chevron(id);
    assert.ok(svg, '1167 foldable header draws its chevron');
    assert.equal(svg.tagName, 'SVG'); assert.equal(svg.getAttribute('aria-hidden'), 'true');
    assert.equal(svg.getAttribute('focusable'), 'false'); assert.equal(svg.getAttribute('width'), '14');
    assert.equal(svg.querySelector('path').getAttribute('stroke-width'), '1.8');
    assert.equal(svg.getAttribute('tabindex'), null); assert.equal(svg.getAttribute('role'), null);
    assert.equal(svg.parentElement, f.card(id));
    assert.equal(header.firstElementChild, author); assert.equal(author.className, 'author-name');
    assert.equal(header.children.length, 1, 'glyph takes no author-fragment slot');
    assert.ok(header.classList.contains('message-fold-header'));
  }
  assert.deepEqual(f.commands, [], 'drawing adds no fold record');
});

test('a saved fold closes a visible reply without sending another fold', async () => {
  const f=fixture({records:new Map([['m2',{folded:true,fold_revision:7,starred:false}]])});
  const item=f.messages.get('m2'),card=f.card(item.id);
  card.setAttribute('data-card-reply','');f.draw();
  assert.equal(card.dataset.folded,'false');
  assert.equal(f.feed.foldState(item),'fold');
  f.feed.closeReplyToFold=async id=>{
    assert.equal(id,item.id);card.removeAttribute('data-card-reply');return true;
  };
  assert.equal(await f.feed.setFold(item,true),true);
  assert.equal(card.dataset.folded,'true');
  assert.deepEqual(f.commands,[]);assert.deepEqual(f.feed.undos,[]);assert.deepEqual(f.notices,[]);
  assert.equal(f.records.get(item.id).fold_revision,7);
});

test('the Reader menu can unfold a saved fold even when the message is open alone', () => {
  const f=fixture({records:new Map([['m2',{folded:true,fold_revision:7,starred:false}]])});
  const item=f.messages.get('m2');
  f.entries.get(item.id).remove();f.entries.delete(item.id);f.draw();
  const choice=f.feed.menuItems(item,{reader:true}).first.find(entry=>entry.key==='fold');
  assert.equal(choice.label,'Unfold');
  choice.act();
  assert.deepEqual(f.commands.map(({id,args})=>({id,args})),[{id:item.id,args:{folded:false}}]);
});

test('1167 singleton and Only new headers keep their prior presentation across redraws', () => {
  for (const options of [{ count: 1 }, { only: true }]) {
    const f = fixture(options);
    for (const id of f.cards.keys()) {
      assert.equal(f.chevron(id), null);
      assert.equal(f.header(id).classList.contains('message-fold-header'), false);
      assert.equal(headerClick(f.list, f.entries.get(id), { target: f.header(id).firstElementChild }), false);
    }
    assert.deepEqual(f.commands, []);
  }
  const f = fixture(), original = f.card('m1');
  f.list.classList.add('only-new'); f.state.only = () => true; f.draw();
  assert.equal(f.chevron('m1'), null); assert.equal(f.card('m1'), original);
  f.list.classList.remove('only-new'); f.state.only = null; f.draw();
  assert.ok(f.chevron('m1'));
  for (const id of ['m2', 'm3']) { f.entries.get(id).remove(); f.messages.delete(id); }
  f.draw(); assert.equal(f.chevron('m1'), null); assert.equal(f.header('m1').classList.contains('message-fold-header'), false);
});

test('1167 header and folded row retain the existing saved fold owner and inert glyph', () => {
  const f = fixture(), id = 'm1', glyph = f.chevron(id), body = f.card(id).querySelector('.message-preview');
  assert.equal(headerClick(f.list, f.entries.get(id), { target: f.header(id).firstElementChild }), true);
  assert.deepEqual(f.records.get(id), { folded: true, fold_revision: 1, starred: false });
  assert.equal(f.card(id).dataset.folded, 'true'); assert.equal(f.chevron(id), glyph);
  const row = f.card(id).querySelector('.message-folded');
  assert.equal(row.querySelector('.folded-words').textContent, 'Exact words 1');
  assert.equal(foldedClick(f.list, f.entries.get(id), { target: row }), true);
  assert.deepEqual(f.records.get(id), { folded: false, fold_revision: 2, starred: false });
  assert.equal(f.card(id).dataset.folded, 'false'); assert.equal(f.chevron(id), glyph);
  assert.equal(f.card(id).querySelector('.message-preview'), body); assert.equal(body.textContent, 'Exact words 1');
  assert.deepEqual(f.commands.map(x => x.args.folded), [true, false]);
  const fresh = fixture({ records: f.records });
  assert.equal(fresh.card(id).dataset.folded, undefined); assert.ok(fresh.chevron(id));
  assert.deepEqual(fresh.commands, []);
});

test('1167 header controls, message words and nested attribution retain their own acts', () => {
  const f = fixture(), id = 'm2', header = f.header(id);
  for (const tag of ['a', 'button', 'input', 'textarea', 'select', 'span']) {
    const control = f.doc.createElement(tag); if (tag === 'span') control.setAttribute('role', 'button');
    const label = f.doc.createElement('span'); control.append(label); header.append(control);
    assert.equal(headerClick(f.list, f.entries.get(id), { target: label }), false, tag + ' stays a control');
  }
  const body = f.card(id).querySelector('.message-preview'), nested = f.doc.createElement('span'); nested.className = 'message-author'; body.append(nested);
  assert.equal(headerClick(f.list, f.entries.get(id), { target: nested }), false, 'nested byline is not the card header');
  assert.equal(headerClick(f.list, f.entries.get(id), { target: body }), false, 'message words keep the Reader path');
  assert.deepEqual(f.commands, []);
});

test('1167 x, menu and Undo keep the existing fold projection and glyph', () => {
  const f = fixture(), id = 'm1', glyph = f.chevron(id); let prevented = 0;
  const event = { preventDefault() { prevented++; } };
  f.feed.foldKey(event, f.entries.get(id), false);
  assert.equal(f.card(id).dataset.folded, 'true'); assert.equal(f.chevron(id), glyph);
  const menu = f.feed.menuItems(f.messages.get(id), { reader: true }).first.find(x => x.key === 'fold');
  assert.equal(menu.label, 'Unfold'); menu.act();
  assert.equal(f.card(id).dataset.folded, 'false'); assert.equal(f.chevron(id), glyph);
  assert.deepEqual(f.commands.map(x => x.args.folded), [true, false]);
  f.feed.undos.at(-1)(); assert.equal(f.card(id).dataset.folded, 'true');
  const fresh = fixture({ records: f.records }); assert.equal(fresh.card(id).dataset.folded, 'true');
  assert.ok(fresh.chevron(id)); assert.equal(prevented, 1);
});

test('1167 starred-header refusal preserves the saved record and open card', () => {
  const f = fixture({ records: new Map([['m2', { folded: false, fold_revision: 4, starred: true }]]) });
  assert.equal(headerClick(f.list, f.entries.get('m2'), { target: f.header('m2') }), true);
  assert.deepEqual(f.records.get('m2'), { folded: false, fold_revision: 4, starred: true });
  assert.notEqual(f.card('m2').dataset.folded, 'true'); assert.ok(f.chevron('m2'));
  assert.ok(f.notices.includes('Starred messages stay in view; unstar it to fold.')); assert.deepEqual(f.commands, []);
});

test('1167 repeated and replaced headers keep one glyph and clear detached furniture', () => {
  const f = fixture(), id = 'm1', first = f.chevron(id), old = f.header(id);
  for (let i = 0; i < 3; i++) f.draw();
  assert.equal(f.card(id).querySelectorAll('.message-header-chevron').length, 1); assert.equal(f.chevron(id), first);
  const replacement = f.doc.createElement('span'); replacement.className = 'message-author';
  old.after(replacement); old.remove(); f.draw();
  assert.equal(old.classList.contains('message-fold-header'), false);
  assert.ok(replacement.classList.contains('message-fold-header')); assert.equal(f.chevron(id), first);
  assert.equal(f.card(id).querySelectorAll('.message-header-chevron').length, 1);
});

test('1167 a wrapped dossier card uses its own header and existing fold owner', () => {
  const f = fixture({ wrapped: true }), entry = f.entries.get('m1');
  assert.notEqual(entry, f.card('m1')); assert.ok(f.chevron('m1'));
  assert.equal(headerClick(f.list, entry, { target: f.header('m1') }), true);
  assert.equal(f.card('m1').dataset.folded, 'true');
  assert.deepEqual(f.commands.map(x => [x.id, x.args.folded]), [['m1', true]]);
});

test('1176 header effects are gated only by header hover in either fold state', () => {
  const css = readFileSync(new URL('../web/stack-look.css', import.meta.url), 'utf8');
  const start = css.indexOf('/* 1167'), end = css.indexOf("/* The star in a message's header", start), rules = css.slice(start, end);
  assert.ok(start >= 0 && end > start);
  const scoped = '.reply-stack[data-single=false]:not(.only-new *) .message-header-foldable';
  assert.equal(/:active|:focus(?:-within|-visible)?/.test(rules), false, '1176 header effects have no focus or press trigger');
  assert.equal(/transition:[^;}]*\b(?:opacity|background|color)\b/.test(rules), false, 'pointer exit has no fade-out tail');
  assert.ok(rules.includes(scoped + '>.message-fold-header:hover'));
  assert.equal(rules.includes(scoped + ':hover'), false, 'hovering message words does not light the header');
  assert.ok(rules.includes('background:color-mix(in srgb,var(--ink) 7%,transparent)'));
  assert.ok(rules.includes('margin:-1rem -1.15rem .4rem;padding:1rem 1.15rem 0'));
  assert.equal(/border-bottom|box-shadow|text-decoration/.test(rules), false, 'no under-band line or card-outline replacement');
  assert.ok(rules.includes('pointer-events:none')); assert.ok(rules.includes('opacity:0;transform:translateY(-50%) rotate(0deg)'));
  assert.ok(rules.includes('display:block!important;top:50%;color:var(--muted);opacity:0;transform:translateY(-50%) rotate(-90deg)'));
  assert.ok(rules.includes('[data-folded=true]:not([data-earlier=true]):has(>.message-folded:hover)>.message-header-chevron{color:var(--ink);opacity:1}'));
  for (const [, selector, body] of rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/background:|opacity:1(?:[;}\s]|$)/.test(body)) assert.ok(selector.includes(':hover'), 'each visible effect requires header hover');
  }
  assert.ok(rules.includes('[data-earlier=true]>.message-header-chevron{display:none!important}'));
  assert.ok(rules.includes('transition:transform .16s ease')); assert.ok(rules.includes('@media(prefers-reduced-motion:reduce)'));
});


test('a fold confirmed on retry closes the captured empty opening once', async () => {
  const f = fixture(), item = f.messages.get('m2'), requests = [];
  let closes = 0;
  Object.assign(f.feed, {
    act: StackFeed.prototype.act,
    captureEmptyReply: () => () => { ++closes; return true; },
    instanceId: 'fixture', authority: () => ({ authority_id: 'fixture', authority_epoch: 'one' }),
    pending: new Map(), made: new WeakMap(), makes: 0, clock: () => 20, chain: Promise.resolve(),
    acted() {}, settled() {}, listen() {}, reread() {}, paintNotice() {},
    doubts: new Map(), notices: new Map(),
    commandOf: async envelope => {
      requests.push(envelope);
      if (requests.length === 1) throw new TypeError('Fetch did not return a receipt');
      return { status: 'committed', result: { folded: true, fold_revision: 1 } };
    },
  });
  await assert.rejects(f.feed.setFold(item, true), /did not commit/);
  assert.equal(f.feed.doubts.size, 1);
  assert.equal(closes, 0);
  const previous = contact.answered;
  answered();
  assert.ok(contact.answered > previous);
  f.feed.askAgain();
  await f.feed.chain;
  assert.deepEqual(requests, [requests[0], requests[0]]);
  assert.equal(closes, 1);
});

test('fold-through closes only empty openings for cards named in its receipt', async () => {
  const f = fixture(), closed = [];
  f.feed.captureEmptyReply = id => () => { closed.push(id); return true; };
  f.feed.settled = () => {};
  let committed;
  f.feed.act = (kind, item, args, also, options) => {
    assert.equal(kind, 'message.fold_through');
    committed = options.committed;
    return Promise.resolve({ folds: [] });
  };
  const [stack] = f.state.stacks;
  f.feed.foldThrough(stack, f.messages.get('m3'));
  assert.deepEqual(closed, []);
  f.messages.get('m2').acts.folded = true;
  committed({ folds: [{ message_id: 'm2' }, { message_id: 'not loaded' }] });
  assert.deepEqual(closed, ['m2']);
});
