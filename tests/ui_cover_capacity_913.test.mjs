import test from 'node:test';
import assert from 'node:assert/strict';
import { renderer799 } from './fixtures/renderer799.mjs';
import { coverSheet, coverKey } from '../web/dossier-cover.mjs';
import { configureCoverRefresh } from '../web/cover-refresh.mjs';

const at = new Date(2026, 10, 20, 8, 0).getTime();
const pending = { request_id:'request913', operation_id:'request913', state:'pending', by:'reader', recipient:'writer',
  root_id:'root', observed_revision:1, at_ms:at + 1000, completed_revision:null };
const completed = { ...pending, state:'completed', completed_by:'old-writer', completed_ms:at + 2000, completed_revision:2 };
const cover = { root_id:'root', revision:3, stands:'Current cover', waiting:[], payload:null, owner:'reader',
  writer:'writer', by:'writer', at_ms:at + 3000, refresh:null, refresh_revision:0 };
function fixture(t) {
  const r = renderer799('reader'), doc = r.list.ownerDocument, storage = new Map();
  doc.defaultView = { localStorage:{ getItem:key=>storage.get(key) ?? null, setItem:(key,value)=>storage.set(key,value), removeItem:key=>storage.delete(key) } };
  doc.querySelectorAll = selector => r.list.querySelectorAll(selector);
  const instance='cover913-'+crypto.randomUUID();
  configureCoverRefresh(() => ({ bootstrap:{ instance_id:instance, actor:'reader', authority:{authority_id:'a',authority_epoch:1} },
    api:{ command:async()=>{ throw Error('no command expected'); } }, changed(){} }));
  t.after(() => configureCoverRefresh(null));
  return { doc, context:{viewer:'reader',nameOf:id=>id,topicId:'topic',rootId:'root'} };
}

test('913 a long cover keeps all literal words and line breaks in the shared sheet', t => {
  const f=fixture(t), stands='**Literal heading**\n<script>literal</script>\n'+'x'.repeat(20000);
  const sheet=coverSheet(f.doc,{...cover,stands},f.context), words=sheet.querySelector('.cover-stands');
  assert.equal(words.text,stands);
  assert.equal(words.children.length,0,'769 literal text remains literal');
  assert.equal(sheet.querySelectorAll('script').length,0);
  assert.equal(sheet.querySelectorAll('.cover-refresh').length,1);
});

test('913 direct writes show the cover revision writer and time without a refresh request', t => {
  const f=fixture(t), sheet=coverSheet(f.doc,cover,f.context), footer=sheet.querySelector('.cover-revision-line');
  assert.ok(footer);
  assert.match(footer.text,/^writer refreshed the cover · /);
  assert.equal(footer.querySelector('time').dataset.ms,String(cover.at_ms));
  assert.equal(sheet.querySelectorAll('.cover-revision-line').length,1);
});

test('913 a stale completed request cannot replace the latest direct-write footer', t => {
  const f=fixture(t), value={...cover,refresh:completed,refresh_revision:2};
  const sheet=coverSheet(f.doc,value,f.context), footer=sheet.querySelector('.cover-revision-line');
  assert.ok(footer);
  assert.match(footer.text,/^writer refreshed the cover · /);
  assert.equal(footer.querySelector('time').dataset.ms,String(cover.at_ms));
  assert.ok(!sheet.text.includes('old-writer'),'old request completion supplies no visible completion words');
  assert.equal(sheet.querySelectorAll('.refresh-request-line').filter(line=>!line.hidden).length,0);
});

test('913 pending request keeps its timed line alongside the actual revision footer', t => {
  const f=fixture(t), sheet=coverSheet(f.doc,{...cover,refresh:pending,refresh_revision:1},f.context);
  const request=sheet.querySelector('.refresh-request-line');
  assert.match(request.text,/^reader asked writer to refresh the cover · /);
  assert.equal(request.querySelector('time').dataset.ms,String(pending.at_ms));
  assert.equal(request.hidden,false);
  const footer=sheet.querySelector('.cover-revision-line');
  assert.ok(footer);assert.equal(footer.querySelector('time').dataset.ms,String(cover.at_ms));
});

test('913 revision provenance participates in the shared repaint key', t => {
  const f=fixture(t), key=coverKey(cover,f.context);
  assert.notEqual(key,coverKey({...cover,by:'another-writer'},f.context));
  assert.notEqual(key,coverKey({...cover,at_ms:cover.at_ms+1000},f.context));
  assert.equal(key,coverKey({...cover},f.context));
});
