import test from 'node:test';
import assert from 'node:assert/strict';
import { joinFixture } from './fixtures/join1269.mjs';
import { stackMenuItems } from '../web/stack-menu-items.mjs';
import { MESSAGE_KEY_WORDS } from '../web/pane-keys.mjs';

for (const ingress of ['shortcut-up', 'shortcut-down', 'desktop-menu', 'phone-sheet', 'touch-shaped-choice']) test('1269 first ' + ingress + ' activation opens a named choice without sending', async t => {
  const f = joinFixture({ phone: ingress.includes('phone') || ingress.includes('touch') }); t.after(f.close);
  if (ingress.startsWith('shortcut')) f.key(ingress.endsWith('down') ? 'down' : 'up');
  else { const menu = f.feed.menuItems(f.messages.get(f.selected), { phone: ingress === 'phone-sheet' });
    const choices = ingress === 'phone-sheet' ? menu.last[0] : null;
    if (choices) { let moves; f.feed.menuItems(f.messages.get(f.selected), { phone: true, more: x => { moves = x; } }).last[0].act(); moves.find(x => x.key === 'join-up').act(); }
    else menu.last.find(x => x.key === 'join-up').act(); }
  await f.feed.chain;
  assert.equal(f.calls.length, 0, 'opening a join choice must not send stack.join');
  assert.ok(f.menu()); assert.match(f.menu().text, /source dossier/); assert.match(f.menu().text, /(?:above|below) dossier/);
  assert.match(f.menu().text, /everyone/); assert.equal(f.doc.activeElement.text, 'Cancel');
});
for (const way of ['up', 'down']) test('1269 deliberate ' + way + ' confirmation sends one existing CAS join and Undo restores', async t => {
  const f = joinFixture(); t.after(f.close); f.key(way); assert.equal(f.calls.length, 0);
  const before = structuredClone(f.messages.get('source'));
  f.confirm(); await f.feed.chain;
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].kind, 'stack.join');
  assert.deepEqual(f.calls[0].target, { message_id: 'source' });
  assert.deepEqual(f.calls[0].args, { into: way === 'up' ? 'above' : 'below' });
  assert.equal(f.calls[0].expected.join_revision, 3); assert.deepEqual(f.calls[0].expected.authority, f.authority);
  assert.deepEqual(f.messages.get('source').acts.name, before.acts.name);
  assert.deepEqual(JSON.parse(JSON.stringify(f.messages.get('source').acts.cover)), before.acts.cover);
  assert.equal(f.messages.get('source').stack_position.placed, 20);
  f.feed.undo(); await f.feed.chain; assert.deepEqual(f.calls[1].args, { into: null }); assert.equal(f.calls[1].expected.join_revision, 4);
});
test('1269 unloaded dossier root is the confirmed source, never its loaded branch', async t => {
  const f = joinFixture({ unloaded: true }); t.after(f.close); f.key(); assert.equal(f.calls.length, 0);
  f.confirm(); await f.feed.chain; assert.deepEqual(f.calls[0].target, { message_id: 'source' }); assert.equal(f.calls[0].expected.join_revision, 3);
  assert.equal(f.messages.has('source'), false);
});
for (const change of ['revision', 'authority', 'retired', 'disconnected', 'topic', 'neighbor', 'pending', 'uncertain', 'More side', 'hidden coordination', 'Only new', 'target topic', 'target identity']) test('1269 refuses a changed ' + change + ' before confirmation', async t => {
  const f = joinFixture(); t.after(f.close); f.key(); assert.equal(f.calls.length, 0);
  if (change === 'revision') f.messages.get('source').acts.join_revision++;
  if (change === 'authority') f.authority.authority_epoch = 'new';
  if (change === 'retired') f.feed.gone = true;
  if (change === 'disconnected') f.entry().remove();
  if (change === 'topic') f.messages.get('source').topic_id = 'another';
  if (change === 'neighbor') { f.messages.get('above').stack_position = { ...f.messages.get('above').stack_position, order_key: 5 }; f.feed.arrange(); }
  if (change === 'pending') f.feed.pending.set('source', [{ joined: { into: 'below' } }]);
  if (change === 'uncertain') f.feed.doubts.set('old-operation', { kind: 'stack.join', item: f.messages.get('source') });
  if (change === 'More side') f.feed.state.below.add('above');
  if (change === 'hidden coordination') f.feed.state.coordination.add('above');
  if (change === 'Only new') f.feed.state.only = item => item.id !== 'source';
  if (change === 'target topic') f.messages.get('above').topic_id = 'another';
  if (change === 'target identity') { f.messages.get('above').acts.joined = { into: 'below' }; f.messages.get('above').acts.join_revision++; f.feed.arrange(); }
  f.confirm(); await f.feed.chain; assert.equal(f.calls.length, 0); assert.ok(f.notices.length);
});
test('1269 ordinary move shortcut and both menu directions remain immediate personal writes', async () => {
  for (const ingress of ['shortcut', 'menu']) for (const way of ['up', 'down']) {
    const f = joinFixture(); if (ingress === 'shortcut') f.key(way, { shiftKey: false });
    else f.feed.menuItems(f.messages.get('source')).last.find(x => x.key === 'move-' + way).act();
    await f.feed.chain; assert.ok(f.calls.length); assert.ok(f.calls.every(c => c.kind === 'stack.place')); assert.equal(f.menu(), null);
  }
});
test('1269 menus and message key legend advertise the deliberate step and preserve1268 Split', () => {
  for (const phone of [false, true]) { const m = stackMenuItems({ found: true, phone, splitSources: true }, () => {});
    const rows = phone ? (() => { let x; const n = stackMenuItems({ found: true, phone }, (k,v) => { x=v; }); n.last[0].act(); return x; })() : m.last;
    assert.ok(rows.filter(x => x.key.startsWith('join-')).every(x => x.label.endsWith('…')));
    assert.ok(m.first.some(x => x.key === 'split-sources')); }
  assert.match(new Map(MESSAGE_KEY_WORDS).get('⇧⌘↑ ⇧⌘↓'), /choice|confirm/i);
});
test('1269 confirmed join with unknown result retries the exact original operation', async t => {
  const f = joinFixture(); t.after(f.close); let first;
  f.feed.commandOf = async envelope => { f.calls.push(envelope); first ??= envelope;
    if (f.calls.length === 1) throw Error('connection lost');
    return { status: 'committed', result: { into: envelope.args.into, join_revision: 4 } }; };
  f.key(); f.confirm(); await f.feed.chain; await new Promise(resolve => setImmediate(resolve));
  const [doubt] = f.feed.doubts.values(); assert.ok(doubt); assert.equal(doubt.envelope.operation_id, first.operation_id);
  await f.feed.send(doubt.kind, doubt.item, doubt.args, doubt.envelope); assert.deepEqual(f.calls[1], first);
});
test('1269 final Core join refusal remains refused with no automatic second act', async t => {
  const f = joinFixture(); t.after(f.close);
  f.feed.commandOf = async envelope => { f.calls.push(envelope); return { status: 'refused', recorded: true,
    error: { code: 'FORBIDDEN', message: 'No permission for this message' } }; };
  f.key(); f.confirm(); await f.feed.chain; await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 1); assert.equal(f.feed.doubts.size, 0); assert.ok(f.notices.length);
});
