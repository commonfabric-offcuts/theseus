// Retained review source SHA256 be087089129bd160b49fd1a3a0fe62015bf6e6b3cd78783b875022b1df2c6394; adaptations: docs/card-text-review-867.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { text867, card, details, A, B, metaOf, parseDeck, cardDetails, cardText } from './fixtures/card_text_867.mjs';
const sh=rows=>rows.map(r=>`${r.title}:${r.id?r.id.slice(2,3):'-'}${r.aliases.length?'/'+r.aliases.map(a=>a.slice(2,3)).join(''):''}/${r.color??'-'}`).join('  ');
const span=(v,i)=>{const d=parseDeck(v);let s=d.opening.length;for(let k=0;k<i;k++)s+=d.cards[k].raw.length;return {start:s,end:s+d.cards[i].raw.length,raw:d.cards[i].raw};};
const editWords=(h,i,from,to)=>{const v=h.p.text.value,s=span(v,i),k=s.raw.indexOf(from);assert.ok(k>=0);return h.input(s.start+k,s.start+k+from.length,to);};
const pasteAt=(h,i,text)=>{const v=h.p.text.value;const at=i>=parseDeck(v).cards.length?v.length:span(v,i).start;return h.input(at,at,text,'insertFromPaste');};
function holdSaves(h){const send=h.api.command;let release,arrive;const arrived=new Promise(r=>arrive=r);h.api.command=async e=>{const receipt=await send(e);arrive();await new Promise(r=>release=r);return receipt;};return {arrived,release:()=>{h.api.command=send;release();}};}
// The real page syncs on every writer notification (notebook-page.mjs: changed:()=>this.writingChanged()). Wire it.
async function wired(t,raw){
 const h=await text867(t,raw);h.p.header.description=h.p.doc.createElement('p');
 let syncs=0;h.w.changed=()=>{syncs++;if(!h.w.closed)h.p.sync();};h.syncs=()=>syncs;return h;
}
const val=h=>metaOf(h.w.value.body);

test('W-C0 wired sync: paste an exact copy below, then type in the original',async t=>{
 const h=await wired(t,card('Plan','plan words',details(A))+card('Other','other',details(B,'rose')));
 pasteAt(h,1,card('Plan','plan words',null));assert.deepEqual(val(h).map(r=>r.id),[A,null,B]);
 editWords(h,0,'plan words','plan words!');console.log('W-C0 typed',sh(val(h)),'syncs',h.syncs());
 await h.w.flush();console.log('W-C0 saved',sh(metaOf(h.w.base.content.body)));
 assert.ok(h.syncs()>0,'the page synced on notifications');
 assert.deepEqual(val(h).map(r=>[r.id,r.color]),[[A,'blue'],[null,null],[B,'rose']]);
});
test('W-C1 wired sync: rename row 0, paste a twin between, keep typing in the renamed title',async t=>{
 const h=await wired(t,card('Same','same',details(A))+card('Same','same',details(B,'green')));
 h.input(3,7,'Other');pasteAt(h,1,card('Same','same',null));
 const at=h.p.text.value.indexOf('Other')+5;h.input(at,at,'!');console.log('W-C1',sh(val(h)));
 assert.deepEqual(val(h).map(r=>r.id),[A,null,B]);
});
test('W-C0d wired sync: paste a copy below, save confirms, then type in the original',async t=>{
 const h=await wired(t,card('Plan','plan words',details(A))+card('Other','other',details(B,'rose')));
 pasteAt(h,1,card('Plan','plan words',null));await h.w.flush();
 editWords(h,0,'plan words','plan words!');console.log('W-C0d',sh(val(h)));
 assert.deepEqual(val(h).map(r=>r.id),[A,null,B]);
});
test('W-D3 wired sync: id confirmed by Copy link, offline Set color, keystroke in that card',async t=>{
 const h=await wired(t,card('One','one',null)+card('Two','two',details(B,'rose')));
 const id=h.p.ensureCardId(h.p.cardRef(0));assert.ok(id);await h.w.flush();
 const send=h.api.command;h.api.command=async()=>{throw Error('offline');};
 const picker=h.p.cardColors(h.p.cardRef(0),h.p.text);t.after(()=>picker.close(false));
 await (picker.root.querySelectorAll('.swatch').find(n=>n.getAttribute('aria-label')==='green')??picker.root.querySelectorAll('.swatch')[0]).onclick();
 editWords(h,0,'one','one!');console.log('W-D3 typed',sh(val(h)));
 h.api.command=send;await h.w.flush();await h.w.flush();console.log('W-D3 saved',sh(metaOf(h.w.base.content.body)));
 assert.deepEqual(metaOf(h.w.base.content.body).map(r=>[r.id,r.color]),[[id,'green'],[B,'rose']]);
});
test('W-D4 wired sync: keystroke in One in flight, Copy link allocates One id, confirm, keystroke in One again',async t=>{
 const h=await wired(t,card('One','one',null)+card('Two','two',details(B,'rose')));
 editWords(h,0,'one','one!');
 const hold=holdSaves(h);const saving=h.w.flush();await hold.arrived;
 const id=h.p.ensureCardId(h.p.cardRef(0));assert.ok(id);
 hold.release();await saving;
 editWords(h,0,'one!','one!!');console.log('W-D4 typed',sh(val(h)));
 assert.deepEqual(val(h).map(r=>r.id),[id,B]);await h.w.flush();assert.deepEqual(metaOf(h.w.base.content.body).map(r=>r.id),[id,B]);
});
test('W-D5 wired sync: twins, Copy link allocates the id-less twin while a keystroke in the identified twin is in flight',async t=>{
 const h=await wired(t,card('Same','same',details(A))+card('Same','same',null));
 editWords(h,0,'same','same!');
 const hold=holdSaves(h);const saving=h.w.flush();await hold.arrived;
 const id=h.p.ensureCardId(h.p.cardRef(1));assert.ok(id);
 hold.release();await saving;
 editWords(h,0,'same!','same!!');editWords(h,1,'same','same?');console.log('W-D5 typed',sh(val(h)));
 assert.deepEqual(val(h).map(r=>r.id),[A,id]);await h.w.flush();assert.deepEqual(metaOf(h.w.base.content.body).map(r=>r.id),[A,id]);
});
test('W-G2 wired sync: offline Set color on an id-less card, delete its heading in Text, Undo',async t=>{
 const h=await wired(t,card('First','first',details(A))+card('Second','second',null));
 const send=h.api.command;h.api.command=async()=>{throw Error('offline');};
 const picker=h.p.cardColors(h.p.cardRef(1),h.p.text);t.after(()=>picker.close(false));
 await (picker.root.querySelectorAll('.swatch').find(n=>n.getAttribute('aria-label')==='green')??picker.root.querySelectorAll('.swatch')[0]).onclick();
 const id=val(h)[1].id;assert.ok(id);
 const v=h.p.text.value,s=v.indexOf('## Second'),e=s+'## Second\n'.length;
 h.input(s,e,'','deleteContentBackward');console.log('W-G2 merged',sh(val(h)));
 h.input(s,s,'## Second\n','historyUndo');console.log('W-G2 undone',sh(val(h)));
 h.api.command=send;await h.w.flush();await h.w.flush();console.log('W-G2 saved',sh(metaOf(h.w.base.content.body)));
 assert.deepEqual(metaOf(h.w.base.content.body).map(r=>[r.id,r.color]),[[A,'blue'],[id,'green']]);
});
// The persist gap: base is replaced before notify; a keystroke landing between them sees confirm() without show().
test('W-GAP a keystroke between the confirmed base and its notification, in a card whose id just confirmed with the twin pasted',async t=>{
 const h=await wired(t,card('Plan','plan words',details(A))+card('Other','other',details(B,'rose')));
 pasteAt(h,1,card('Plan','plan words',null));
 const put=h.w.store.put;let typed=false;
 h.w.store.put=async value=>{await put(value);if(!typed&&value.base?.content?.body?.includes('plan words')&&parseDeck(value.base.content.body).cards.length===3){typed=true;editWords(h,0,'plan words','plan words!');}};
 await h.w.flush();console.log('W-GAP typed in gap?',typed,sh(val(h)));
 assert.deepEqual(val(h).map(r=>r.id),[A,null,B]);
});
