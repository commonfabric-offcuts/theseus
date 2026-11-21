import test from 'node:test';
import assert from 'node:assert/strict';
import { holdReplyImages, replyNeedsWide } from '../web/card-replies.mjs';
import { CardReplies } from '../web/card-replies.mjs';
import { noWriting } from '../web/editor.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

function replies() {
  const doc=miniDocument(),owner=Object.assign(Object.create(CardReplies.prototype),{
    rows:new Map(),closed:new Set(),registry:{hideCard:async p=>{p.hidden=true;return true;}},
    changed(){},paint(){for(const row of this.rows.values())row.ui.root.hidden=row.p.hidden;}
  });
  for(const id of ['a','b','saved']) {
    const root=doc.createElement('div'),card=doc.createElement('article'),field=doc.createElement('textarea'),taller=doc.createElement('button');
    card.root=true;card.append(root);root.append(field,taller);
    const p={hidden:true,source:{source_ref:{kind:'message',id}},editors:{reply:{draft:noWriting()}}};
    owner.rows.set(id,{card,p,paintHeight(){},ui:{root,field,$:()=>taller,bar:{expand(){},close(){}}}});
  }
  return owner;
}
test('907 R2 opening another reply closes only a previous empty click-opened field',async()=>{
  const owner=replies();await owner.open('a',owner.rows.get('a').card);
  await owner.open('saved',owner.rows.get('saved').card,{focus:false});
  owner.rows.get('saved').p.editors.reply.draft.body='Saved writing';
  await owner.open('b',owner.rows.get('b').card);
  assert.equal(owner.rows.get('a').ui.root.hidden,true);
  assert.equal(owner.rows.get('b').ui.root.hidden,false);
  assert.equal(owner.rows.get('saved').ui.root.hidden,false);
});
for(const writing of [{body:'Exact writing'},{attachments:[{id:'image'}]},{quotes:[{body:'quoted'}]},{addressees:['chosen']}])
test('907 R2 opening another reply preserves chosen writing '+JSON.stringify(writing),async()=>{
  const owner=replies();await owner.open('a',owner.rows.get('a').card);
  Object.assign(owner.rows.get('a').p.editors.reply.draft,writing);
  await owner.open('b',owner.rows.get('b').card);assert.equal(owner.rows.get('a').ui.root.hidden,false);
});
test('907 R2 selected upload work does not count as an empty field',async()=>{
  const owner=replies();await owner.open('a',owner.rows.get('a').card);owner.rows.get('a').p.editors.reply.imageBusy=true;
  await owner.open('b',owner.rows.get('b').card);assert.equal(owner.rows.get('a').ui.root.hidden,false);
});
test('907 R2 closing resets this opening’s doubled height',async()=>{
  const owner=replies(),row=owner.rows.get('a');await owner.open('a',row.card);
  row.ui.root.setAttribute('data-tall','');row.ui.$().setAttribute('aria-pressed','true');
  await owner.close('a');assert.equal(row.ui.root.getAttribute('data-tall'),null);assert.equal(row.ui.$().getAttribute('aria-pressed'),'false');
  await owner.open('a',row.card);assert.equal(row.ui.root.getAttribute('data-tall'),null);
});

function field(top, bottom) {
  const rect = { top, bottom, height: bottom - top }, moves = [];
  return { field: { getClientRects: () => [rect], closest: () => ({ getBoundingClientRect: () => rect }) },
    win: { innerHeight: 800, scrollBy: value => moves.push(value) }, moves };
}
test('916 added and removed image strip keeps the reply field bottom in place', () => {
  for (const delta of [160, -160]) {
    const f = field(640 + delta, 740 + delta); holdReplyImages(f.field, delta, f.win);
    assert.deepEqual(f.moves, [{ top: delta, behavior: 'instant' }]);
  }
});
test('916 offscreen reply does not pull the reader away; the keyboard bounds a visible reply', () => {
  const off = field(1200, 1300); holdReplyImages(off.field, 160, off.win); assert.deepEqual(off.moves, []);
  const f = field(420, 520); f.win.visualViewport = { offsetTop: 60, height: 340 };
  holdReplyImages(f.field, 80, f.win); assert.deepEqual(f.moves, [{ top: 120, behavior: 'instant' }]);
});
test('907 temporary Wide detects explicit quotes, typed quote lines and wrapped overflow without changing caret or size', () => {
  const f = { style: { height: '90px', whiteSpace: '' }, scrollTop: 12, scrollHeight: 120 };
  const win = { getComputedStyle: () => ({ lineHeight: '24px', paddingTop: '8px', paddingBottom: '8px' }) };
  assert.equal(replyNeedsWide(f, { body: 'a\n> quoted' }, win), true);
  assert.equal(replyNeedsWide(f, { body: 'wrapped', quotes: [{}] }, win), true);
  assert.equal(replyNeedsWide(f, { body: 'wrapped' }, win), true);
  f.scrollHeight = 112; assert.equal(replyNeedsWide(f, { body: 'four lines' }, win), false);
  assert.deepEqual(f.style, { height: '90px', whiteSpace: '' }); assert.equal(f.scrollTop, 12);
});

test('907 saved reply restoration never unfolds unrelated cards', async () => {
  const { CardReplies } = await import('../web/card-replies.mjs');
  const requested = [], owner = { rows: new Map(), closed: new Set(), queue: new Map(), drain() {} };
  CardReplies.prototype.sync.call(owner, [{ id: 'plain' }, { id: 'saved', yours: { reply: true } }], id => { requested.push(id); return {}; });
  assert.deepEqual(requested, ['saved']); assert.deepEqual([...owner.queue.keys()], ['saved']);
});

test('907 adding then removing a second recipient keeps a whispered reply private by default', async () => {
  const { InlineComposer } = await import('../web/inline-composer.mjs');
  const { choiceOf } = await import('../web/whisper-choice.mjs');
  const draft = { addressees: ['agent-a'], body: '', whisper: null, intent: null };
  const editor = { draft, edit: patch => Object.assign(draft, patch) }, p = { source: { whisper: true }, editors: { reply: editor } };
  const ui = { kind: 'message', cardReply: true, presentation: p, editor, admits: () => true, state: () => ({ readOnly: false }),
    names: () => draft.addressees, kindOf: () => 'agent', callbacks: { edit() {} }, paintRecipients() {}, paintChoice() {} };
  InlineComposer.prototype.addName.call(ui, 'agent-b');
  assert.deepEqual(choiceOf(draft, draft.addressees, ui.kindOf), { choice: 'tell', switched: true });
  InlineComposer.prototype.removeName.call(ui, 'agent-b');
  assert.equal(choiceOf(draft, draft.addressees, ui.kindOf).choice, 'whisper');
});


test('929 closing the Reader leaves its empty click-opened reply closed', async () => {
  const owner = replies(), row = owner.rows.get('a'); await owner.open('a', row.card);
  owner.readerClosed({ fromCardReply: { wide: false }, source: row.p.source, editors: row.p.editors }); owner.paint();
  assert.equal(row.p.hidden, true); assert.equal(row.ui.root.hidden, true); assert.equal(owner.closed.has('a'), true);
  await owner.open('a', row.card); assert.equal(row.ui.root.hidden, false, 'a new click deliberately opens it again');
});
for (const kind of ['words', 'images', 'quotes', 'recipients', 'upload', 'submission'])
test('929 Reader close preserves its reply with ' + kind, async () => {
  const owner = replies(), row = owner.rows.get('a'); await owner.open('a', row.card);
  const editor = row.p.editors.reply;
  if (kind === 'words') editor.draft.body = 'Written in the Reader';
  if (kind === 'images') editor.draft.attachments = [{ id: 'image' }];
  if (kind === 'quotes') editor.draft.quotes = [{ body: 'quoted' }];
  if (kind === 'recipients') editor.draft.addressees = ['chosen'];
  if (kind === 'upload') editor.imageBusy = true;
  if (kind === 'submission') editor.submissions = [{ status: 'sending' }];
  owner.readerClosed({ fromCardReply: { wide: false }, source: row.p.source, editors: row.p.editors }); owner.paint();
  assert.equal(row.p.hidden, false); assert.equal(row.ui.root.hidden, false); assert.equal(owner.closed.has('a'), false);
});
test('929 an unrelated or stale Reader close does not close another opening', async () => {
  const owner = replies(), row = owner.rows.get('a'); await owner.open('a', row.card);
  for (const p of [{ source: row.p.source, editors: row.p.editors },
    { fromCardReply: {}, source: row.p.source, editors: { reply: {} } }]) owner.readerClosed(p);
  assert.equal(row.p.hidden, false); assert.equal(row.ui.root.hidden, false);
});
