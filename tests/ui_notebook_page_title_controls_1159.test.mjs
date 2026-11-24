import test from 'node:test';
import assert from 'node:assert/strict';
import { titlePage, BODY } from './fixtures/page_title_1159.mjs';

for (const [name, key, extra] of [['Return', 'Enter', {}], ['Command Return', 'Enter', { metaKey: true }]]) {
  test(`1159 ${name} saves exactly once and enters first-card writing`, async t => {
    const { p, w, calls, open, complete, views } = await titlePage(t);
    open(); const e = await complete(key, extra);
    assert.equal(e.defaultPrevented, true); assert.equal(e.stopped, true);
    assert.equal(w.value.title, 'Renamed page'); assert.equal(w.value.body, BODY);
    assert.equal(calls.length, 1); assert.equal(p.doc.activeElement, p.editing.field);
    assert.equal(p.editing.near, 0); assert.equal(p.editing.field.selectionStart, 0);
    assert.deepEqual(views, []);
  });
}
for (const [name, kind, extra] of [['click', 'click', {}], ['double click', 'dblclick', {}],
  ['keyboard Return', 'keydown', { key: 'Enter' }], ['keyboard Space', 'keydown', { key: ' ' }]]) {
  test(`1159 displayed title ${name} activates the shared inline editor`, async t => {
    const { p, activate, w, calls } = await titlePage(t);
    assert.equal(p.titleControl.tabIndex, 0);
    assert.equal(p.titleControl.getAttribute('role'), 'button');
    assert.match(p.titleControl.getAttribute('aria-label'), /Edit page title/);
    const e = activate(kind, extra);
    assert.equal(e.defaultPrevented, true); assert.equal(p.doc.activeElement, p.titleBox);
    assert.equal(p.titleBox.value, 'Page');
    assert.deepEqual([p.titleBox.selectionStart, p.titleBox.selectionEnd], [0, 4]);
    assert.equal(w.value.title, 'Page'); assert.equal(calls.length, 0);
  });
}
test('1159 repeated activation preserves the title draft and its selection', async t => {
  const { p, open, activate } = await titlePage(t);
  const field = open('Exact unfinished title'); field.setSelectionRange(3, 7);
  activate('dblclick'); p.rename();
  assert.equal(p.titleBox, field); assert.equal(field.value, 'Exact unfinished title');
  assert.deepEqual([field.selectionStart, field.selectionEnd], [3, 7]);
});
for (const [name, body] of [['empty', ''], ['opening-only', 'Exact opening words.\n\n']]) {
  test(`1159 Cards ${name} completion opens an unpersisted first-card entry`, async t => {
    const { p, w, calls, open, complete } = await titlePage(t, { body });
    open(); await complete();
    assert.equal(w.value.title, 'Renamed page'); assert.equal(w.value.body, body);
    assert.equal(p.deck.cards.length, 0); assert.equal(p.editing.fresh, true);
    assert.equal(p.editing.field.value, ''); assert.equal(p.doc.activeElement, p.editing.field);
    assert.deepEqual([p.editing.field.selectionStart, p.editing.field.selectionEnd], [0, 0]);
    assert.equal(calls.length, 1); assert.equal(calls[0].args.body, body);
  });
}
test('1159 unchanged title completes without creating a revision', async t => {
  const { p, w, calls, open, complete } = await titlePage(t);
  open('Page'); await complete();
  assert.equal(w.value.title, 'Page'); assert.equal(w.value.body, BODY); assert.equal(calls.length, 0);
  assert.equal(p.doc.activeElement, p.editing.field); assert.equal(p.editing.near, 0);
});
for (const [name, body, at] of [['first-card after opening', BODY, BODY.indexOf('First')],
  ['fenced false heading', '```\n## False\n```\n\n  ### First\n\nWords\n', 24],
  ['empty', '', 0], ['opening-only', 'Exact opening words.\n\n', 0]]) {
  test(`1159 Text ${name} keeps its view and uses the existing field`, async t => {
    const { p, w, calls, views, open, complete } = await titlePage(t, { body, mode: 'text' });
    open(); await complete('Enter', { metaKey: true });
    assert.equal(p.mode, 'text'); assert.deepEqual(views, []);
    assert.equal(p.doc.activeElement, p.text);
    assert.deepEqual([p.text.selectionStart, p.text.selectionEnd], [at, at]);
    assert.equal(p.text.value, body); assert.equal(w.value.body, body);
    assert.equal(calls.length, 1); assert.equal(calls[0].args.body, body);
    assert.equal(Boolean(p.editing), false);
  });
}
test('1159 title completion keeps a previously edited card before entering the first card', async t => {
  const { p, w, open, complete } = await titlePage(t);
  p.pick(1); p.edit();
  p.editing.field.value = 'Last\nExact unfinished card words';
  p.editing.field.listeners.input({ inputType: 'insertText' });
  open(); await complete();
  assert.equal(w.value.title, 'Renamed page');
  assert.match(w.value.body, /## Last\n\nExact unfinished card words/);
  assert.match(w.value.body, /^Opening stays\./);
  assert.equal(p.editing.near, 0); assert.equal(p.doc.activeElement, p.editing.field);
  assert.equal(p.editing.field.value, 'First\nFirst words');
});
test('1159 title completion preserves unsent Text and its first-card destination', async t => {
  const { p, w, views, open, complete } = await titlePage(t, { mode: 'text' });
  const changed = BODY.replace('First words', 'Exact Text draft');
  p.text.value = changed;
  open(); await complete('Enter');
  assert.equal(w.value.title, 'Renamed page'); assert.equal(w.value.body, changed);
  assert.equal(p.text.value, changed); assert.equal(p.mode, 'text'); assert.deepEqual(views, []);
  assert.equal(p.doc.activeElement, p.text);
  assert.deepEqual([p.text.selectionStart, p.text.selectionEnd], [BODY.indexOf('First'), BODY.indexOf('First')]);
});
test('1159 a delayed title save moves focus before its receipt and never reclaims later focus', async t => {
  const { p, w, api, open, complete } = await titlePage(t);
  const command = api.command; let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  api.command = async envelope => { entered(); await gate; return command(envelope); };
  open(); const done = complete('Enter'); await started;
  assert.equal(w.value.title, 'Renamed page');
  assert.equal(p.doc.activeElement, p.editing.field);
  const elsewhere = p.doc.createElement('button'); p.doc.body.append(elsewhere); elsewhere.focus();
  release(); await done;
  assert.equal(w.base.content.title, 'Renamed page');
  assert.equal(p.doc.activeElement, elsewhere, 'a receipt is not a new focus gesture');
});
test('1159 title save failure retains the exact journal and retry operation', async t => {
  const { p, w, api, calls, journal, open, complete } = await titlePage(t);
  const command = api.command, tried = []; let fail = true;
  api.command = async envelope => {
    tried.push(structuredClone(envelope));
    if (fail) throw Error('1159 isolated lost response');
    return command(envelope);
  };
  open(); await complete();
  assert.equal(w.value.title, 'Renamed page'); assert.equal(w.value.body, BODY);
  assert.equal(p.doc.activeElement, p.editing.field);
  assert.match(w.error, /1159 isolated lost response/);
  assert.deepEqual(journal().pending, tried[0]); assert.equal(calls.length, 0);
  fail = false; await w.flush();
  assert.deepEqual(tried[1], tried[0]); assert.equal(w.base.content.title, 'Renamed page');
  assert.equal(w.pending, null); assert.equal(calls.length, 1);
});
test('1159 permission loss during title editing retains its visible draft without a false save', async t => {
  const { p, w, calls, open, complete } = await titlePage(t);
  const field = open(); w.readOnly = true; await complete();
  assert.equal(p.doc.activeElement, field); assert.equal(field.value, 'Renamed page');
  assert.ok(p.renameSeen); assert.equal(w.value.title, 'Page'); assert.equal(calls.length, 0);
});
test('1159 a replacement writer cannot receive the previous title editor snapshot', async t => {
  const { p, w, calls, open, complete } = await titlePage(t);
  const field = open(), replacement = Object.create(w); p.writing = replacement;
  await complete();
  assert.equal(p.doc.activeElement, field); assert.ok(p.renameSeen);
  assert.equal(w.value.title, 'Page'); assert.equal(calls.length, 0); p.writing = w;
});
for (const [name, change] of [['read-only page', p => { p.readOnly = true; }],
  ['read-only writer', p => { p.writing.readOnly = true; }], ['reading writer', p => { p.writing.reading = true; }],
  ['deleted page', p => { p.writing.deleted = true; }], ['closed writer', p => { p.writing.closed = true; }],
  ['pending page action', p => { p.writing.actionPending = {}; }], ['running page action', p => { p.writing.actionRunning = true; }],
  ['conflict', p => { p.writing.conflict = p.writing.base; }], ['inactive sheet', p => { p.menuCurrent = () => false; }],
  ['hidden page', p => { p.host.hidden = true; }], ['retired page', p => { p.detached = true; }]]) {
  test(`1159 title activation respects ${name}`, async t => {
    const { p, w, calls, activate } = await titlePage(t);
    change(p); activate();
    assert.equal(p.renameSeen, undefined); assert.equal(w.value.title, 'Page');
    assert.equal(w.value.body, BODY); assert.equal(calls.length, 0);
  });
}
for (const [name, extra] of [['composing', { isComposing: true }], ['IME key229', { keyCode: 229 }],
  ['already handled', { defaultPrevented: true }]]) {
  test(`1159 ${name} title completion keeps the draft and its focus`, async t => {
    const { p, w, calls, open, complete } = await titlePage(t);
    const field = open(); await complete('Escape', extra);
    assert.equal(p.doc.activeElement, field); assert.equal(field.value, 'Renamed page');
    assert.ok(p.renameSeen); assert.equal(w.value.title, 'Page'); assert.equal(calls.length, 0);
  });
}
for (const [name, extra] of [['secondary click', { button: 2 }], ['Control click', { ctrlKey: true }],
  ['Command click', { metaKey: true }], ['handled click', { defaultPrevented: true }]]) {
  test(`1159 ${name} leaves title activation to its prior owner`, async t => {
    const { p, calls, activate } = await titlePage(t);
    activate('click', extra); assert.equal(p.renameSeen, undefined); assert.equal(calls.length, 0);
  });
}
