// The red New line: where the server says the oldest unread message is, the
// page draws the line under its card, and moves or removes it as answers read
// at later commits say.
import test from 'node:test';
import assert from 'node:assert/strict';
import { oldestUnreadOf, placeNewLine } from '../web/unanswered.mjs';
import { TopicViews } from '../web/topic-views.mjs';
import { UNKNOWN } from '../web/read-through.mjs';
import { clock } from '../web/times.mjs';

// Every time is read at noon on Thursday 5 November 2026.
clock.now = () => new Date(2026, 10, 5, 12, 0).getTime();
import { readFileSync } from 'node:fs';

class Element {
  constructor(tag = 'div') { Object.assign(this, { tag, children: [], dataset: {}, className: '', textContent: '', parent: null }); }
  insertBefore(child, before) {
    child.remove(); const index = before ? this.children.indexOf(before) : this.children.length;
    assert.ok(index >= 0, 'insertBefore names a child of this list');
    this.children.splice(index, 0, child); child.parent = this;
  }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; } }
  get classList() {
    const names = () => this.className.split(' ').filter(Boolean);
    return { contains: name => names().includes(name),
      toggle: (name, on = !names().includes(name)) => { this.className = (on ? [...names().filter(n => n !== name), name] : names().filter(n => n !== name)).join(' '); return on; } };
  }
  append(...nodes) { for (const node of nodes) if (typeof node === 'string') this.children.push(node); else this.insertBefore(node, null); }
  replaceChildren(...nodes) { for (const node of [...this.children]) if (typeof node === 'string') this.children.splice(this.children.indexOf(node), 1); else node.remove(); this.append(...nodes); }
  // What it says: its own text, then its children's.
  get text() { return this.textContent + this.children.map(node => typeof node === 'string' ? node : node.text).join(''); }
  find(className) { for (const node of this.children) { if (typeof node !== 'object') continue; if (node.className === className) return node; const found = node.find(className); if (found) return found; } return null; }
}
const doc = { createElement: tag => new Element(tag) };
const list = (...seqs) => {
  const host = new Element();
  for (const seq of seqs) { const card = new Element('button'); card.dataset.seq = String(seq); card.dataset.id = 'm' + seq; host.insertBefore(card, null); }
  return host;
};
const order = host => host.children.map(node => node.dataset.line ?? Number(node.dataset.seq));

test('the line sits just below the card of the oldest unread message, and moves with it', () => {
  const host = list(50, 40, 30, 20);
  const line = placeNewLine(host, 30, doc);
  assert.deepEqual(order(host), [50, 40, 30, 'new', 20]);
  // Messages are newest first: what the reader has not read is above the line.
  assert.equal(line.text, 'New above');
  assert.equal(line.find('new-line-label').text, 'New above', 'its words say where the new messages are, in an element of their own');
  assert.equal(line.className, 'new-line');
  assert.equal(line.dataset.seq, undefined, 'the line is never taken for a card');
  assert.equal(line.dataset.id, undefined);
  assert.equal(placeNewLine(host, 30, doc), line, 'placed again where it is, it stays');
  assert.deepEqual(order(host), [50, 40, 30, 'new', 20]);
  placeNewLine(host, 40, doc);
  assert.deepEqual(order(host), [50, 40, 'new', 30, 20], 'reading the oldest moves it up');
  placeNewLine(host, 20, doc);
  assert.deepEqual(order(host), [50, 40, 30, 20, 'new'], 'under the last loaded card');
  placeNewLine(host, null, doc);
  assert.deepEqual(order(host), [50, 40, 30, 20], 'everything read, it goes');
  placeNewLine(host, 35, doc);
  assert.deepEqual(order(host), [50, 40, 30, 20], 'a message among the loaded ones without a card here has no line');
});

// When the oldest unread message is further back than what is loaded, the
// line sits at the bottom of what is loaded, says so, and loads the older
// messages when activated; once its card is loaded, the line takes its place.
test('a line for a message not loaded yet sits at the bottom, says more new below, and loads it when pressed', () => {
  const host = list(50, 40, 30, 20), loads = [];
  const load = () => loads.push('older');
  const marker = placeNewLine(host, 10, doc, load);
  assert.deepEqual(order(host), [50, 40, 30, 20, 'older'], 'at the bottom of what is loaded');
  assert.equal(marker.tag, 'button', 'a control the person can press, by pointer or keyboard');
  assert.equal(marker.type, 'button');
  assert.equal(marker.text, 'More new below');
  assert.equal(marker.find('new-line-label').text, 'More new below', 'it says the unread messages lie further down');
  assert.equal(marker.className, 'new-line new-line-older');
  assert.equal(marker.dataset.seq, undefined, 'never taken for a card');
  marker.onclick();
  assert.deepEqual(loads, ['older'], 'pressing it loads the older messages');
  assert.equal(placeNewLine(host, 10, doc, load), marker, 'placed again, it stays');
  const older = list(15); host.insertBefore(older.children[0], null);
  placeNewLine(host, 10, doc, load);
  assert.deepEqual(order(host), [50, 40, 30, 20, 15, 'older'], 'more loaded, still not reached: still at the bottom');
  const reached = list(10); host.insertBefore(reached.children[0], null);
  const line = placeNewLine(host, 10, doc, load);
  assert.deepEqual(order(host), [50, 40, 30, 20, 15, 10, 'new'], 'loaded: the line takes its true place, and the marker goes');
  assert.equal(line.text, 'New above');
  assert.notEqual(line.tag, 'button', 'in its place the line is not a control');
  placeNewLine(host, 40, doc, load);
  assert.deepEqual(order(host), [50, 40, 'new', 30, 20, 15, 10]);
  assert.throws(() => placeNewLine(list(50, 40), 10, doc), /loads the older messages/, 'a line for a message further back needs a way to load it');
  // Nothing older to load (null): the line promises nothing, and one drawn
  // before goes.
  const top = list(50, 40);
  placeNewLine(top, 10, doc, load);
  assert.equal(placeNewLine(top, 10, doc, null), null);
  assert.deepEqual(order(top), [50, 40], 'no older line when nothing older can be loaded');
});

// Item 426: More messages ends the run the reader reads down, and the
// dossiers put below More follow it. The line for a message further back
// waits at the bottom of that run, above More, never after what lies below
// More; a message only inside a dossier counts among what is loaded.
test('a line for a message not loaded yet waits above More messages, not after the dossiers below it', () => {
  const host = list(50, 40, 30), load = () => {};
  const more = new Element('button'); more.className = 'stack-more'; host.insertBefore(more, null);
  const aside = new Element('section'); aside.className = 'reply-stack'; aside.dataset.stack = 'm60';
  const inside = new Element('button'); inside.dataset.seq = '60'; inside.dataset.id = 'm60'; aside.insertBefore(inside, null);
  host.insertBefore(aside, null);
  const name = node => node.dataset.line ?? (node === more ? 'More' : node === aside ? 'aside' : Number(node.dataset.seq));
  placeNewLine(host, 10, doc, load);
  assert.deepEqual(host.children.map(name), [50, 40, 30, 'older', 'More', 'aside'], 'above More, not below the dossier put aside');
  placeNewLine(host, 10, doc, load);
  assert.deepEqual(host.children.map(name), [50, 40, 30, 'older', 'More', 'aside'], 'placed again, it stays');
  host.insertBefore(host.children[3], null);
  placeNewLine(host, 10, doc, load);
  assert.deepEqual(host.children.map(name), [50, 40, 30, 'older', 'More', 'aside'], 'moved below, it goes back above More');
  // No More: the bottom of the list, as before.
  more.remove(); aside.remove();
  placeNewLine(host, 10, doc, load);
  assert.deepEqual(host.children.map(name), [50, 40, 30, 'older']);
  // A message older than every top-level card but loaded inside a dossier is loaded: no promise of older ones.
  const nested = list(50, 40);
  const stack = new Element('section'); stack.className = 'reply-stack';
  const reply = new Element('button'); reply.dataset.seq = '5'; stack.insertBefore(reply, null); nested.insertBefore(stack, null);
  assert.equal(placeNewLine(nested, 10, doc, load), null, 'a message among the loaded ones, inside a dossier, has no older line');
});

// Once nothing at or above it is unread, the line stays in its place but
// fades: .new-line-read, a CSS opacity transition, and inert, so no pointer,
// Tab or screen reader finds it. Held again, the same line comes back.
test('a line that holds nothing unread fades where it is, inert, and the same line comes back when it holds again', () => {
  const host = list(50, 40, 30, 20), load = () => {};
  const line = placeNewLine(host, 30, doc);
  assert.deepEqual([line.className, line.inert], ['new-line', false], 'holding an unread message, it shows');
  assert.equal(placeNewLine(host, 30, doc, undefined, null, false), line, 'faded, it is the same line');
  assert.deepEqual(order(host), [50, 40, 30, 'new', 20], 'in its place, so nothing below it shifts');
  assert.deepEqual([line.className, line.inert], ['new-line new-line-read', true], 'faded and inert');
  assert.equal(line.text, 'New above', 'its words kept for the fade');
  assert.equal(placeNewLine(host, 30, doc), line);
  assert.deepEqual([line.className, line.inert], ['new-line', false], 'held again, it comes back');
  placeNewLine(host, 40, doc, undefined, null, false);
  assert.deepEqual(order(host), [50, 40, 'new', 30, 20], 'a faded line still goes where it is told');
  assert.deepEqual([line.className, line.inert], ['new-line new-line-read', true]);
  // "More new below" fades the same way, and stays a button that loads.
  const marker = placeNewLine(host, 10, doc, load, null, false);
  assert.deepEqual(order(host), [50, 40, 30, 20, 'older']);
  assert.deepEqual([marker.className, marker.inert], ['new-line new-line-older new-line-read', true], 'the older line faded and inert');
  assert.equal(placeNewLine(host, 10, doc, load), marker);
  assert.deepEqual([marker.className, marker.inert], ['new-line new-line-older', false], 'held again, it is a button again');
});

// The fade is a short opacity transition that keeps the line's space; the
// line is hidden only once it has faded, shown at once on the way back, and
// there is no transition when the reader's system asks for reduced motion.
test('the faded line keeps its space, is hidden only after the fade, and reduced motion fades nothing', () => {
  const css = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8');
  const rule = selector => { const at = css.indexOf(selector + '{'); assert.ok(at >= 0, 'aim.css sets ' + selector); return css.slice(at + selector.length + 1, css.indexOf('}', at)); };
  const faded = rule('.new-line.new-line-read');
  assert.match(faded, /opacity:0/, 'faded out');
  assert.match(faded, /visibility:hidden/, 'hidden once faded, so nothing finds it');
  assert.match(faded, /pointer-events:none/);
  assert.doesNotMatch(faded, /display:none|height:0/, 'it keeps its space');
  assert.match(faded, /transition:opacity \.6s ease,visibility 0s linear \.6s/, 'hidden only after the opacity has faded');
  assert.match(css, /\.new-line\{transition:opacity \.6s ease,visibility 0s\}/, 'shown at once on the way back, then faded in');
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.new-line,\.new-line\.new-line-read\{transition:none\}\}/, 'reduced motion: no transition either way');
});

test('what an answer says of the oldest unread message is read strictly', () => {
  assert.equal(oldestUnreadOf({}), undefined, 'a server that does not say draws no line');
  assert.deepEqual(oldestUnreadOf({ oldest_unread: null, commit_seq: 3 }), { value: null, at: 3 });
  assert.deepEqual(oldestUnreadOf({ oldest_unread: { seq: 4, id: 'm4' }, commit_seq: 0 }), { value: { seq: 4, id: 'm4' }, at: 0 });
  assert.deepEqual(oldestUnreadOf({ oldest_unread: { seq: 4, id: 'm4', sent_ms: 1762350240000 }, commit_seq: 3 }).value, { seq: 4, id: 'm4', sent_ms: 1762350240000 });
  assert.deepEqual(oldestUnreadOf({ oldest_unread: { seq: 4, id: 'm4', sent_ms: null }, commit_seq: 3 }).value, { seq: 4, id: 'm4', sent_ms: null }, 'a message from before times were kept');
  for (const bad of [{ seq: 0, id: 'm' }, { seq: 4 }, { seq: '4', id: 'm4' }, { seq: 4, id: '' }, 4, 'm4',
    { seq: 4, id: 'm4', sent_ms: '1762350240000' }, { seq: 4, id: 'm4', sent_ms: 1.5 }])
    assert.throws(() => oldestUnreadOf({ oldest_unread: bad, commit_seq: 3 }), /oldest unread message is malformed/);
  for (const at of [undefined, -1, 1.5, '3'])
    assert.throws(() => oldestUnreadOf({ oldest_unread: null, commit_seq: at }), /oldest unread message is malformed/, 'it says which commit it is as of');
});

// The line says when the oldest message the reader has not read was
// sent, as every time on the page does; the label and the time are separate
// spans, so either label composes with the time.
test('the line says when that message was sent, today\'s time alone, and its title keeps the date', () => {
  const host = list(50, 40, 30, 20), loads = [];
  const sent = new Date(2026, 10, 5, 4, 40).getTime(), yesterday = new Date(2026, 10, 4, 21, 12).getTime();
  const line = placeNewLine(host, 30, doc, undefined, sent);
  assert.equal(line.text, 'New above · 4:40 AM');
  assert.deepEqual([line.find('new-line-label')?.text, line.find('new-line-time')?.text], ['New above', ' · 4:40 AM'], 'the label and the time are separate spans');
  assert.equal(line.find('new-line-time').children[1].title, '4:40 AM Thu Nov 5', 'the time\'s title keeps the date');
  assert.match(line.title, /4:40 AM Thu Nov 5/, 'and so does the line\'s');
  // Placed again after midnight, the same line says it was yesterday.
  const now = clock.now;
  clock.now = () => new Date(2026, 10, 6, 0, 5).getTime();
  try { placeNewLine(host, 30, doc, undefined, sent); assert.equal(line.text, 'New above · Yesterday 4:40 AM'); }
  finally { clock.now = now; }
  placeNewLine(host, 30, doc, undefined, sent);
  assert.equal(placeNewLine(host, 40, doc, undefined, yesterday), line, 'moved by an answer, it is the same line');
  assert.equal(line.text, 'New above · Yesterday 9:12 PM', 'its time follows the message it sits under');
  placeNewLine(host, 40, doc, undefined, null);
  assert.equal(line.text, 'New above', 'a message from before times were kept has none');
  assert.equal(line.find('new-line-time'), null);
  const marker = placeNewLine(host, 10, doc, () => loads.push('older'), new Date(2026, 10, 1, 7, 41).getTime());
  assert.equal(marker.text, 'More new below · 7:41 AM Sun Nov 1', 'the line for a message further back says when, dated');
  assert.equal(marker.find('new-line-label').text, 'More new below');
});

test('the latest commit an answer was read at decides where the line is, from a page or from topic_unread', async () => {
  const paints = [];
  const views = new TopicViews({ instanceId: 'i', topicId: 't1', paint: kind => paints.push(kind) });
  const page = (version, at, oldest, items = []) => ({ instance_id: 'i', items, next_cursor: null, relevant_versions: { topic: version },
    ...(oldest === undefined ? {} : { oldest_unread: oldest, commit_seq: at }) });
  const item = seq => ({ id: 'm' + seq, seq, topic_id: 't1', body: 'b', author_id: 'a' });
  views.messagesPage(page(5, 10, { seq: 3, id: 'm3' }, [item(3), item(4)]), { initial: true });
  assert.deepEqual(views.oldestUnread, { seq: 3, id: 'm3' });
  // Reading changes no topic version: the commit orders the answers.
  const reads = [];
  const answer = (at, oldest, topic = 't1') => async (name, args) => { reads.push([name, args]); return { instance_id: 'i', topic_id: topic, oldest_unread: oldest, commit_seq: at }; };
  paints.length = 0;
  assert.equal(await views.readUnread(answer(12, { seq: 4, id: 'm4' })), true);
  assert.deepEqual(reads, [['topic_unread', { topic_id: 't1' }]]);
  assert.deepEqual(views.oldestUnread, { seq: 4, id: 'm4' }, 'reading the oldest moved it up');
  assert.deepEqual(views.line, { seq: 3, id: 'm3' }, 'the line, placed when the topic opened, holds while the person reads');
  assert.deepEqual(paints, [], 'so nothing is painted');
  views.messagesPage(page(5, 11, { seq: 3, id: 'm3' }, [item(2)]), { cursor: views.olderCursor ?? 3 });
  assert.deepEqual(views.oldestUnread, { seq: 4, id: 'm4' }, 'a page read at an earlier commit does not bring it back, though its topic version is the same');
  paints.length = 0;
  await views.readUnread(answer(12, { seq: 4, id: 'm4' }));
  assert.deepEqual(paints, [], 'the same answer again moves nothing');
  await views.readUnread(answer(11, null));
  assert.deepEqual(views.oldestUnread, { seq: 4, id: 'm4' }, 'nor does an earlier topic_unread');
  await views.readUnread(answer(13, null));
  assert.equal(views.oldestUnread, null, 'everything read: no line');
  views.messagesPage(page(6, 14, { seq: 6, id: 'm6' }, [item(6)]), { live: true, cursor: 4 });
  assert.deepEqual(views.oldestUnread, { seq: 6, id: 'm6' }, 'a message that arrived while caught up');
  views.messagesPage(page(7, undefined, undefined, []), { live: true, cursor: 6 });
  assert.deepEqual(views.oldestUnread, { seq: 6, id: 'm6' }, 'a page that does not say leaves it as it was');
  // A stale read (the topic was left meanwhile) changes nothing; another topic's answer is refused.
  assert.equal(await views.readUnread(answer(20, null), () => false), false);
  assert.deepEqual(views.oldestUnread, { seq: 6, id: 'm6' });
  await assert.rejects(views.readUnread(answer(21, null, 't2')), /another topic or says nothing/);
  await assert.rejects(views.readUnread(async () => ({ instance_id: 'i', topic_id: 't1' })), /another topic or says nothing/, 'an answer that does not say is refused');
});

// "More new below" is a control, and looks like one: framed and filled as the
// page's other buttons are (warp, item 91b: with no border or background it
// read as a label), its red words readable at rest and under the pointer.
test('the line for messages further back is drawn as a button, its words readable', () => {
  const css = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8');
  const rule = selector => { const at = css.indexOf(selector + '{'); assert.ok(at >= 0, 'aim.css sets ' + selector); return css.slice(at + selector.length + 1, css.indexOf('}', at)); };
  const older = rule('.new-line-older');
  assert.match(older, /border:1px solid var\(--line\)/, 'framed as a button');
  assert.match(older, /background:var\(--panel\)/, 'filled as a button');
  assert.doesNotMatch(css, /\.new-line-older[^{}]*\{[^}]*(border:0|background:none)/, 'never a bare label');
  const hex = (text, name) => { const h = text.match(new RegExp('--' + name + ':(#[0-9a-f]{6}|#[0-9a-f]{3})(?![0-9a-f])'))[1]; return h.length === 4 ? '#' + [...h.slice(1)].map(c => c + c).join('') : h; };
  const root = css.slice(css.indexOf(':root{'), css.indexOf('}', css.indexOf(':root{'))), darkAt = css.indexOf('@media(prefers-color-scheme:dark){:root{');
  const dark = css.slice(darkAt, css.indexOf('}', darkAt));
  const luminance = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const [theme, text] of [['light', root], ['dark', dark]])
    for (const fill of ['panel', 'soft'])
      assert.ok(contrast(hex(text, 'alert'), hex(text, fill)) >= 4.5, `${theme}: the red words on --${fill} ${contrast(hex(text, 'alert'), hex(text, fill)).toFixed(2)}`);
});

test('a page for a frontier that moved on is not kept, yet what it says of the line is, and the line is placed', () => {
  const paints = [];
  const views = new TopicViews({ instanceId: 'i', topicId: 't1', paint: kind => paints.push(kind) });
  const item = seq => ({ id: 'm' + seq, seq, topic_id: 't1', body: 'b', author_id: 'a' });
  const page = (at, oldest, items, next = null) => ({ instance_id: 'i', items, next_cursor: next, relevant_versions: { topic: 5 }, oldest_unread: oldest, commit_seq: at });
  views.messagesPage(page(10, { seq: 6, id: 'm6' }, [item(6), item(7)], 6), { initial: true });
  assert.equal(views.olderCursor, 6);
  // An older page asked for from a cursor the page has since passed: its
  // messages are not kept, but it was read at a later commit, when a message
  // further back was marked unread.
  paints.length = 0;
  assert.equal(views.messagesPage(page(12, { seq: 2, id: 'm2' }, [item(2)]), { cursor: 4 }), false, 'the stale page is not kept');
  assert.equal(views.messages.has('m2'), false);
  assert.deepEqual(views.oldestUnread, { seq: 2, id: 'm2' });
  assert.deepEqual(paints, ['line'], 'the line is placed where that page says');
  paints.length = 0;
  assert.equal(views.messagesPage(page(13, { seq: 2, id: 'm2' }, []), { cursor: 4 }), false);
  assert.deepEqual(paints, [], 'a stale page that moves nothing paints nothing');
});

// The line is placed from the server's answer when the topic opens, and again
// on an explicit Mark read; during the visit, reading never moves it up. Once
// nothing at or above it is unread it fades where it is (held is false), with
// no Refresh (Tony, What's live #584/#586). It moves only to show more unread:
// a mark further back, or, with no line or a faded one, an arrival or a mark.
test('the line is placed when the topic opens, holds while the person reads, fades once nothing above it is unread, and moves only to show more', async () => {
  const paints = [];
  const views = new TopicViews({ instanceId: 'i', topicId: 't1', paint: kind => paints.push(kind) });
  const item = seq => ({ id: 'm' + seq, seq, topic_id: 't1', body: 'b', author_id: 'a' });
  views.messagesPage({ instance_id: 'i', items: [item(3), item(4), item(5)], next_cursor: null, relevant_versions: { topic: 5 },
    oldest_unread: { seq: 3, id: 'm3' }, commit_seq: 10 }, { initial: true });
  assert.deepEqual(views.line, { seq: 3, id: 'm3' }, 'placed from the server when the topic opens');
  const answer = (at, oldest) => async () => ({ instance_id: 'i', topic_id: 't1', oldest_unread: oldest, commit_seq: at });
  const step = async (at, oldest, { afresh = false } = {}) => { paints.length = 0; if (afresh) views.placeAfresh(); await views.readUnread(answer(at, oldest)); return [views.line, [...paints]]; };
  const m = seq => ({ seq, id: 'm' + seq });
  assert.equal(views.held, true, 'it holds the oldest unread message');
  assert.deepEqual(await step(12, m(4)), [m(3), []], 'reading the oldest leaves the line where it is');
  assert.equal(views.held, true);
  assert.deepEqual(await step(13, m(6)), [m(3), []], 'read up to a message that arrived above it: the line holds it, and does not fade');
  assert.equal(views.held, true);
  assert.deepEqual(await step(14, null), [m(3), ['line']], 'nothing at or above it unread: it fades where it is, with no Refresh');
  assert.equal(views.held, false, 'faded');
  assert.deepEqual(await step(15, m(7)), [m(7), ['line']], 'faded, an arrival brings the line just below it, not back where it was');
  assert.equal(views.held, true);
  assert.deepEqual(await step(16, m(2)), [m(2), ['line']], 'a mark further back moves it down, to show more');
  assert.deepEqual(await step(17, m(7), { afresh: true }), [m(7), ['line']], 'an explicit Mark read places it afresh');
  assert.deepEqual(await step(18, null, { afresh: true }), [m(7), ['line']], 'afresh with nothing unread: the line stays where it is, to fade');
  assert.equal(views.held, false);
  assert.deepEqual(await step(19, m(7)), [m(7), ['line']], 'its own message unread again: the faded line comes back where it is');
  assert.equal(views.held, true);
  assert.deepEqual(await step(20, m(8)), [m(7), []], 'its message read and another arrived above it: the line holds');
  assert.deepEqual(await step(18, null, { afresh: true }), [m(8), ['line']], 'an afresh answer read at an earlier commit places the line where the later answer says');
  assert.deepEqual(views.oldestUnread, m(8));
  assert.equal(views.held, true);
});

// An explicit Mark read places the line afresh from the newest
// answer known: one read meanwhile at a later commit (a read-through landing
// between the two reads) wins over the afresh read's own; and when the afresh
// read fails, the next read asked after it places the line instead.
test('placed afresh, the line goes where the newest answer says, even when the afresh read is older or fails', async () => {
  const views = new TopicViews({ instanceId: 'i', topicId: 't1' });
  const item = seq => ({ id: 'm' + seq, seq, topic_id: 't1', body: 'b', author_id: 'a' });
  views.messagesPage({ instance_id: 'i', items: [item(3), item(4), item(5)], next_cursor: null, relevant_versions: { topic: 5 },
    oldest_unread: { seq: 3, id: 'm3' }, commit_seq: 10 }, { initial: true });
  const answer = (at, oldest) => async () => ({ instance_id: 'i', topic_id: 't1', oldest_unread: oldest, commit_seq: at });
  const m = seq => ({ seq, id: 'm' + seq });
  await views.readUnread(answer(13, null));
  assert.deepEqual([views.line, views.held], [m(3), false], 'everything read: the line stays where it is, faded');
  views.placeAfresh(); await views.readUnread(answer(12, m(4)));
  assert.deepEqual([views.line, views.held], [m(3), false], 'an afresh read answered at an earlier commit places the line from the later answer: nothing is unread, so it stays faded');
  await views.readUnread(answer(14, m(6)));
  await views.readUnread(answer(15, m(8)));
  assert.deepEqual([views.line, views.held], [m(6), true], 'read up to an arrival above it: the line holds');
  views.placeAfresh(); await assert.rejects(views.readUnread(async () => { throw Error('offline'); }), /offline/);
  assert.deepEqual(views.line, m(6), 'the afresh read failed: the line is where it was');
  await views.readUnread(answer(16, m(8)));
  assert.deepEqual(views.line, m(8), 'the next read places it afresh in its place');
  await views.readUnread(answer(17, m(9)));
  assert.deepEqual(views.line, m(8), 'and only that one: the line holds again');
  // A read asked before the line was to be placed afresh, and answered after, is an ordinary read.
  let release;
  const early = views.readUnread(() => new Promise(resolve => { release = resolve; }));
  views.placeAfresh();
  release({ instance_id: 'i', topic_id: 't1', oldest_unread: m(10), commit_seq: 18 }); await early;
  assert.deepEqual(views.line, m(8), 'a read asked before the Mark read does not place the line afresh');
  await views.readUnread(answer(19, m(10)));
  assert.deepEqual(views.line, m(10), 'the read asked after it does');
});

// Reading on screen is not reading for the line (Tony, 7 November 2026): a
// message turns read when the reader opens or answers it, not while they
// scroll past it. What this page reads on screen while the line holds keeps
// holding it, until the reader acts on what it marks: opens a message at or
// above it in the Reader, replies (here or elsewhere), or presses Mark read.
// Read elsewhere, where this page did not see it, nothing holds it.
test('what the page reads on screen holds the line until the reader opens, answers or marks read; read elsewhere, it fades', async () => {
  const paints = [];
  const views = new TopicViews({ instanceId: 'i', topicId: 't1', reader: 'me', paint: kind => paints.push(kind) });
  const item = (seq, author = 'a') => ({ id: 'm' + seq, seq, topic_id: 't1', body: 'b', author_id: author });
  views.messagesPage({ instance_id: 'i', items: [item(3), item(4), item(5)], next_cursor: null, relevant_versions: { topic: 5 },
    oldest_unread: { seq: 3, id: 'm3' }, commit_seq: 10 }, { initial: true });
  const m = seq => ({ seq, id: 'm' + seq });
  let at = 10;
  const step = async oldest => { paints.length = 0; await views.readUnread(async () => ({ instance_id: 'i', topic_id: 't1', oldest_unread: oldest, commit_seq: ++at })); return [views.line, views.held, [...paints]]; };
  const settled = n => ({ status: 'committed', result: { acknowledged: n } });
  // The page sights cards on screen with the promise of Core's receipt for
  // their report (ReadThrough.seen); the check answers it.
  const sight = (from, through) => {
    let answer; const report = new Promise(resolve => { answer = resolve; });
    views.sighted(from, through, report);
    return async receipt => { paints.length = 0; answer(receipt); await report; await null; return [views.held, [...paints]]; };
  };
  // Both unread messages on the first screen, sighted while the line holds.
  const first = sight(3, 5);
  assert.deepEqual(await step(null), [m(3), true, []], 'read on screen, nothing is unread and the line still holds, with no repaint');
  assert.deepEqual(await first(settled(2)), [true, []], 'Core settled them for this page: it keeps holding');
  views.opened(2);
  assert.deepEqual([views.held, paints], [true, []], 'opening a message below the line is no act on it');
  views.opened(4);
  assert.deepEqual([views.held, paints], [false, ['line']], 'opening a message above it in the Reader fades it');
  sight(3, 5)(settled(1));
  assert.equal(views.held, false, 'faded, reading on screen never brings it back');
  // An arrival brings the line back under it; read on screen and settled, it holds.
  assert.deepEqual(await step(m(6)), [m(6), true, ['line']]);
  const arrival = sight(6, 6);
  assert.deepEqual(await step(null), [m(6), true, []], 'the arrival read on screen holds the line');
  assert.deepEqual(await arrival(settled(0)), [false, ['line']], 'a report that settled nothing (read already, elsewhere) holds nothing: the line fades');
  // A call that reported nothing new (its cards reported already or waiting
  // to be) holds nothing either.
  assert.deepEqual(await step(m(7)), [m(7), true, ['line']]);
  const already = sight(7, 7);
  assert.deepEqual(await step(null), [m(7), true, []]);
  assert.deepEqual(await already(null), [false, ['line']], 'nothing new reported: the line fades once nothing is unread');
  // A report whose result is not known keeps holding: a failed report, whose
  // answer may have been lost after Core recorded it, or one Core did not
  // commit. Whatever Core did not record is still unread anyway.
  for (const [what, receipt, seq] of [['a failed report', UNKNOWN], ['a report Core did not commit', { recorded: false, status: 'retryable', error: { code: 'DATABASE_BUSY' } }],
    ['a committed report that names no count', { recorded: true, status: 'committed', result: {} }]].map((entry, n) => [...entry, 100 + n])) {
    assert.deepEqual(await step(m(seq)), [m(seq), true, ['line']], what);
    const lost = sight(seq, seq);
    assert.deepEqual(await step(null), [m(seq), true, []], what);
    assert.deepEqual(await lost(receipt), [true, []], what + ': read on screen, the line holds');
    paints.length = 0; views.opened(seq);
    assert.deepEqual([views.held, paints], [false, ['line']], what + ': opened, it fades');
  }
  // A range seen before an act holds nothing after it, whenever its receipt comes.
  assert.deepEqual(await step(m(8)), [m(8), true, ['line']]);
  const before = sight(8, 8);
  views.opened(8);
  assert.deepEqual(await step(null), [m(8), false, ['line']], 'opened after it was seen: nothing holds the line');
  assert.deepEqual(await before(settled(1)), [false, []], 'the receipt that comes after the act does not hold it again');
  // Another's message arriving is no act; the reader's own (a reply, here or elsewhere) is.
  assert.deepEqual(await step(m(9)), [m(9), true, ['line']]);
  await sight(9, 9)(settled(1));
  assert.deepEqual(await step(null), [m(9), true, []]);
  views.messagesPage({ instance_id: 'i', items: [item(6), item(7), item(8), item(9)], next_cursor: null, relevant_versions: { topic: 9 } }, { live: true, cursor: 5 });
  assert.equal(views.held, true, 'messages from others arriving leave it held');
  paints.length = 0;
  views.messagesPage({ instance_id: 'i', items: [item(10, 'me')], next_cursor: null, relevant_versions: { topic: 10 } }, { live: true, cursor: 9 });
  assert.deepEqual([views.held, paints], [false, ['messages']], 'the reader\'s own reply arriving fades it, with the repaint of the messages');
  // Mark read here is an act too.
  assert.deepEqual(await step(m(11)), [m(11), true, ['line']]);
  await sight(11, 11)(settled(1));
  assert.deepEqual(await step(null), [m(11), true, []]);
  paints.length = 0; views.placeAfresh();
  assert.deepEqual([views.held, paints], [false, ['line']], 'Mark read fades it at once when nothing at or above it is unread');
  // Read elsewhere, with nothing seen here, the line fades as the answer says.
  assert.deepEqual(await step(m(12)), [m(12), true, ['line']]);
  await sight(1, 2)(settled(2));
  assert.deepEqual(await step(null), [m(12), false, ['line']], 'read in another tab, with only cards below the line read here, nothing holds it: it fades');
});
