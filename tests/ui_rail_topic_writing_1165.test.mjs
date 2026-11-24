import test from 'node:test';
import assert from 'node:assert/strict';
import { OutlineRail } from '../web/outline-rail.mjs';
import { Shell } from '../web/in-place-navigation.mjs';
import { InlineComposer } from '../web/inline-composer.mjs';
import { TopicNavigation, routeHref, parseRoute, routeKey } from '../web/topic-navigation.mjs';
import { writeTopicOnArrival } from '../web/topic-writing.mjs';
import { railTopicWritingFixture, receipt, refused } from './fixtures/rail_topic_writing_1165.mjs';

const owners = { OutlineRail, Shell, InlineComposer, TopicNavigation, routeHref };
const settle = () => new Promise(setImmediate);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(t, options = {}) {
  const f = railTopicWritingFixture(owners, { arrival: writeTopicOnArrival, ...options }); t.after(f.restore);
  const input = f.openLine(); input.value = 'A new topic'; return f;
}

test('1165 confirmed rail creation opens its inline writing sheet and places the caret', async t => {
  const f = fixture(t); f.press('Enter'); await settle();
  assert.equal(f.sheet.open, true, 'confirmed rail creation opens its writing sheet');
  assert.equal(f.doc.activeElement, f.field); assert.deepEqual(f.field.selection, [0, 0]);
  assert.deepEqual(f.opened, [{ kind: 'topic', id: 'made', act: 'topic-write' }]);
  assert.equal(new URL(f.win.location.href).hash, '', 'the action was consumed once');
});

test('1165 creation uses the existing opening save and publish with the rail outcome', async t => {
  const f = fixture(t); f.press('Enter'); f.press('Enter'); await settle();
  assert.deepEqual(f.commands.map(r => r.kind), ['opening.save', 'opening.publish']);
  const [save, publish] = f.commands;
  assert.equal(save.args.workspace_id, 'outcome'); assert.equal(save.args.title, 'A new topic');
  assert.equal(save.args.body, ''); assert.deepEqual(save.args.attachments, []);
  assert.equal(publish.target.opening_id, save.target.opening_id); assert.equal(publish.expected.opening_revision, 1);
});

test('1165 unknown publish selects nothing and retry retains the exact publish operation', async t => {
  let lost = true;
  const f = fixture(t, { answer: request => {
    if (request.kind === 'opening.save') return receipt(request, { opening_revision: 1 });
    if (lost) { lost = false; throw Error('offline'); }
    return receipt(request, { topic: { id: 'made' } });
  } });
  f.press('Enter'); await settle();
  assert.deepEqual(f.opened, []); assert.equal(f.sheet.open, false); assert.equal(f.input().value, 'A new topic');
  f.press('Enter'); await settle();
  assert.deepEqual(f.commands[2], f.commands[1]); assert.equal(f.sheet.open, true);
});

test('1165 refused publish retains the title without selecting a destination', async t => {
  const f = fixture(t, { answer: request => request.kind === 'opening.save' ? receipt(request, { opening_revision: 1 }) : refused(request) });
  f.press('Enter'); await settle();
  assert.deepEqual(f.opened, []); assert.equal(f.sheet.open, false); assert.equal(f.input().value, 'A new topic');
  assert.equal(f.doc.activeElement, f.input());
});

test('1165 mismatched receipt cannot select its purported destination', async t => {
  const f = fixture(t, { answer: request => ({ ...receipt(request, { topic: { id: 'wrong' } }), operation_id: 'other' }) });
  f.press('Enter'); await settle(); assert.deepEqual(f.opened, []); assert.equal(f.sheet.open, false);
});

test('1165 a newer navigation before creation confirmation owns destination and focus', async t => {
  const gate = deferred();
  const f = fixture(t, { answer: request => request.kind === 'opening.save' ? receipt(request, { opening_revision: 1 }) : gate.promise });
  f.press('Enter'); await settle();
  await f.choose({ kind: 'topic', id: 'later' }); const later = f.doc.createElement('button'); f.doc.body.append(later); later.focus();
  gate.resolve(receipt(f.commands.at(-1), { topic: { id: 'made' } })); await settle();
  assert.deepEqual(f.opened, [{ kind: 'topic', id: 'later' }]); assert.equal(f.doc.activeElement, later); assert.equal(f.sheet.open, false);
});

test('1165 a late refusal after newer navigation cannot steal focus', async t => {
  const gate = deferred(); const f = fixture(t, { answer: () => gate.promise }); f.press('Enter');
  await f.choose({ kind: 'topic', id: 'later' }); const later = f.doc.createElement('button'); f.doc.body.append(later); later.focus();
  gate.resolve(refused(f.commands[0])); await settle(); assert.equal(f.doc.activeElement === later, true, 'late refusal preserves the newer focus owner'); assert.equal(f.sheet.open, false);
});

test('1165 cancelling and reopening a pending title does not resurrect its old focus request', async t => {
  const gate = deferred(); const f = fixture(t, { answer: request => request.kind === 'opening.save' ? receipt(request, { opening_revision: 1 }) : gate.promise });
  f.press('Enter'); await settle(); f.press('Escape'); f.outcome.newTopic.onclick();
  f.input().value = 'Later title';
  gate.resolve(receipt(f.commands.at(-1), { topic: { id: 'made' } })); await settle();
  assert.deepEqual(f.opened, []); assert.equal(f.sheet.open, false); assert.equal(f.input().value, 'Later title');
});

test('1165 a retired rail run cannot navigate from its late confirmation', async t => {
  const gate = deferred(); const f = fixture(t, { answer: request => request.kind === 'opening.save' ? receipt(request, { opening_revision: 1 }) : gate.promise });
  f.press('Enter'); await settle(); f.rail.run++;
  gate.resolve(receipt(f.commands.at(-1), { topic: { id: 'made' } })); await settle(); assert.deepEqual(f.opened, []); assert.equal(f.sheet.open, false);
});

test('1165 the existing departure guard can refuse a confirmed creation navigation', async t => {
  const f = fixture(t, { beforeLeave: async () => { throw Error('Writing is not safely saved.'); } });
  f.press('Enter'); await settle(); assert.equal(f.commands.length, 2); assert.deepEqual(f.opened, []); assert.equal(f.sheet.open, false);
});

test('1165 writing arrival round-trips through the normal topic URL and is consumed once', t => {
  const f = fixture(t), route = { kind: 'topic', id: 'made', act: 'topic-write' };
  f.win.location.href = new URL(routeHref(route), f.win.location.href).href;
  assert.deepEqual(parseRoute(new URL(f.win.location.href)), route);
  const args = { route, topic: { id: 'made' }, registry: f.registry, shell: f.shell, current: () => true, win: f.win };
  assert.equal(writeTopicOnArrival(args), true); assert.equal(writeTopicOnArrival(args), false);
  assert.equal(f.doc.activeElement, f.field);
});

test('1165 an unavailable or replaced inline owner admits no writing arrival', t => {
  const f = fixture(t), route = { kind: 'topic', id: 'made', act: 'topic-write' };
  f.win.location.href = new URL(routeHref(route), f.win.location.href).href;
  const args = { route, topic: { id: 'made' }, registry: f.registry, shell: f.shell, current: () => true, win: f.win };
  f.presentation.destinationAvailable = false; assert.equal(writeTopicOnArrival(args), false);
  f.presentation.destinationAvailable = true; f.presentation.availabilityUnconfirmed = true; assert.equal(writeTopicOnArrival(args), false);
  f.presentation.availabilityUnconfirmed = false; f.registry.inline = null; assert.equal(writeTopicOnArrival(args), false);
  assert.equal(f.sheet.open, false);
});

test('1165 a newer queued move or retired arrival does not open the earlier writing sheet', t => {
  const f = fixture(t), route = { kind: 'topic', id: 'made', act: 'topic-write' };
  f.win.location.href = new URL(routeHref(route), f.win.location.href).href;
  const args = { route, topic: { id: 'made' }, registry: f.registry, shell: f.shell, current: () => true, win: f.win };
  f.shell.owed = { open: { kind: 'topic', id: 'later' } }; assert.equal(writeTopicOnArrival(args), false);
  f.shell.owed = null; assert.equal(writeTopicOnArrival({ ...args, current: () => false }), false); assert.equal(f.sheet.open, false);
});

test('1165 topic writing action cannot be combined with another UI destination', () => {
  for (const extra of [{ message: 'm' }, { page: 'n' }, { at: 'unread' }, { choice: 'Edit' }]) {
    assert.throws(() => routeKey({ kind: 'topic', id: 'made', act: 'topic-write', ...extra }));
  }
});

test('1165 actual readiness keeps a queued newer choice ahead of the earlier writing arrival', async t => {
  const f = fixture(t), route = { kind: 'topic', id: 'made', act: 'topic-write' }, gate = deferred(), opened = [];
  t.after(() => gate.resolve(false));
  f.win.location.href = new URL(routeHref(route), f.win.location.href).href;
  f.shell.installed = true; f.shell.feed = true; f.shell.begun = route;
  f.shell.page = { open: async target => { opened.push(target); return gate.promise; } };
  let composed = 0; const compose = f.shell.compose.bind(f.shell);
  f.shell.compose = () => { composed++; return compose(); };
  const later = f.doc.createElement('button'); f.doc.body.append(later); later.focus();
  const pending = f.shell.open({ kind: 'topic', id: 'later' }, 'Later choice');
  f.shell.ready({ view: async () => ({}) });
  const args = { route, topic: { id: 'made' }, registry: f.registry, shell: f.shell, current: () => true, win: f.win };
  assert.equal(writeTopicOnArrival(args), false);
  assert.equal(composed, 0); assert.equal(f.doc.activeElement, later); assert.equal(f.sheet.open, false);
  await settle(); assert.deepEqual(opened, [{ kind: 'topic', id: 'later' }]);
  gate.resolve(false); assert.equal(await pending, false);
  assert.equal(writeTopicOnArrival(args), false); assert.equal(composed, 0); assert.equal(f.doc.activeElement, later);
});

test('1165 actual readiness never composes the earlier arrival when the queued departure is refused', async t => {
  const f = fixture(t, { beforeLeave: async () => { throw Error('Writing is not safely saved.'); } });
  const route = { kind: 'topic', id: 'made', act: 'topic-write' }, opened = [];
  f.win.location.href = new URL(routeHref(route), f.win.location.href).href;
  f.shell.installed = true; f.shell.feed = true; f.shell.begun = route;
  f.shell.page = { open: async target => {
    opened.push(target);
    try { return await f.rail.open(target, 'Refused choice'); } catch { return false; }
  } };
  let composed = 0; const compose = f.shell.compose.bind(f.shell);
  f.shell.compose = () => { composed++; return compose(); };
  const later = f.doc.createElement('button'); f.doc.body.append(later); later.focus();
  const pending = f.shell.open({ kind: 'topic', id: 'later' }, 'Refused choice');
  f.shell.ready({ view: async () => ({}) });
  const args = { route, topic: { id: 'made' }, registry: f.registry, shell: f.shell, current: () => true, win: f.win };
  assert.equal(writeTopicOnArrival(args), false);
  assert.equal(composed, 0); assert.equal(f.doc.activeElement, later);
  assert.equal(await pending, false); assert.deepEqual(opened, [{ kind: 'topic', id: 'later' }]);
  assert.equal(writeTopicOnArrival(args), false); assert.equal(composed, 0); assert.equal(f.doc.activeElement, later); assert.equal(f.sheet.open, false);
});
