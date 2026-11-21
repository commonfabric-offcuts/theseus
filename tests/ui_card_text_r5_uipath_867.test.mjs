// Retained review source SHA256 81107160b1dcc82f4974f0ec280cb55f635bf39600fc1117b08f1282d0578417; adaptations: docs/card-text-review-867.json.
// UI-path variants of zz_r5_attack D2..D5: every Cards act happens in the Cards view (switchView('cards') first,
// which is the only place the ⋯ menu exists), and every Text keystroke after it follows switchView('text'),
// as the real page forces. Variants: the save in flight confirms before (a) or after (b) the switch back to Text,
// and (c) a followed-commit sync() (app.mjs: followCommits(()=>page.load()) -> load() -> sync()) runs after the confirm.
import test from 'node:test';
import assert from 'node:assert/strict';
import { text867, card, details, A, B, metaOf, parseDeck } from './fixtures/card_text_867.mjs';
const sh=rows=>rows.map(r=>`${r.title}:${r.id?r.id.slice(2,3):'-'}${r.aliases.length?'/'+r.aliases.map(a=>a.slice(2,3)).join(''):''}/${r.color??'-'}`).join('  ');
const span=(v,i)=>{const d=parseDeck(v);let s=d.opening.length;for(let k=0;k<i;k++)s+=d.cards[k].raw.length;return {start:s,end:s+d.cards[i].raw.length,raw:d.cards[i].raw};};
const editWords=(h,i,from,to)=>{const v=h.p.text.value,s=span(v,i),k=s.raw.indexOf(from);assert.ok(k>=0,'words present '+from+' in '+JSON.stringify(s.raw));return h.input(s.start+k,s.start+k+from.length,to);};
function holdSaves(h){const send=h.api.command;let release,arrive;const arrived=new Promise(r=>arrive=r);h.api.command=async e=>{const receipt=await send(e);arrive();await new Promise(r=>release=r);return receipt;};return {arrived,release:()=>{h.api.command=send;release();}};}
const cardsMode=h=>{h.p.header.description=h.p.doc.createElement('p');h.p.switchView('cards');};
const textMode=h=>h.p.switchView('text');
const base=h=>metaOf(h.w.base.content.body), val=h=>metaOf(h.w.value.body);
const pickGreen=async(h,i)=>{const picker=h.p.cardColors(h.p.cardRef(i),h.p.text);const swatch=picker.root.querySelectorAll('.swatch').find(n=>n.getAttribute('aria-label')==='green')??picker.root.querySelectorAll('.swatch')[0];await swatch.onclick();return picker;};

for(const followed of [false,true])
test(`D3u${followed?'c':''} Cards: Copy link confirms the id${followed?', followed sync':''}, offline Set color; Text: keystroke in that card`,async t=>{
 const h=await text867(t,card('One','one',null)+card('Two','two',details(B,'rose')));
 cardsMode(h);
 const id=h.p.ensureCardId(h.p.cardRef(0));assert.ok(id);await h.w.flush();
 assert.deepEqual(base(h).map(r=>r.id),[id,B]);
 if(followed)h.p.sync();
 const send=h.api.command;h.api.command=async()=>{throw Error('offline');};
 const picker=await pickGreen(h,0);t.after(()=>picker.close(false));
 console.log('D3u after color value',sh(val(h)),'| base',sh(base(h)));
 textMode(h);
 const rows=editWords(h,0,'one','one!');console.log('D3u typed',sh(rows));
 h.api.command=send;await h.w.flush();await h.w.flush();
 console.log('D3u saved',sh(base(h)));
 assert.deepEqual(rows.map(r=>[r.id,r.color]),[[id,'green'],[B,'rose']]);
 assert.deepEqual(base(h).map(r=>[r.id,r.color]),[[id,'green'],[B,'rose']]);
});

for(const order of ['confirm, then Text','Text, then confirm','confirm, followed sync, then Text'])
test(`D4u Text keystroke in One in flight; Cards: Copy link allocates One id; ${order}; keystroke in One again`,async t=>{
 const h=await text867(t,card('One','one',null)+card('Two','two',details(B,'rose')));
 editWords(h,0,'one','one!');
 const hold=holdSaves(h);const saving=h.w.flush();await hold.arrived;
 cardsMode(h);
 const id=h.p.ensureCardId(h.p.cardRef(0));assert.ok(id);
 if(order.startsWith('confirm')){hold.release();await saving;if(order.includes('followed'))h.p.sync();textMode(h);}
 else {textMode(h);hold.release();await saving;}
 console.log('D4u',order,'base',sh(base(h)),'| value',sh(val(h)));
 const rows=editWords(h,0,'one!','one!!');console.log('D4u typed',sh(rows));
 assert.deepEqual(rows.map(r=>r.id),[id,B]);
 await h.w.flush();await h.w.flush();
 assert.deepEqual(base(h).map(r=>r.id),[id,B]);
 assert.equal(parseDeck(h.w.base.content.body).cards[0].words.includes('one!!'),true);
});

for(const order of ['confirm, then Text','Text, then confirm','confirm, followed sync, then Text'])
test(`D5u twins: keystroke in the identified twin in flight; Cards: Copy link on the id-less twin; ${order}; type in both`,async t=>{
 const h=await text867(t,card('Same','same',details(A))+card('Same','same',null));
 editWords(h,0,'same','same!');
 const hold=holdSaves(h);const saving=h.w.flush();await hold.arrived;
 cardsMode(h);
 const id=h.p.ensureCardId(h.p.cardRef(1));assert.ok(id);
 if(order.startsWith('confirm')){hold.release();await saving;if(order.includes('followed'))h.p.sync();textMode(h);}
 else {textMode(h);hold.release();await saving;}
 console.log('D5u',order,'base',sh(base(h)),'| value',sh(val(h)));
 let rows=editWords(h,0,'same!','same!!');console.log('D5u typed first',sh(rows));
 rows=editWords(h,1,'same','same?');console.log('D5u typed second',sh(rows));
 assert.deepEqual(rows.map(r=>r.id),[A,id]);
 await h.w.flush();await h.w.flush();
 assert.deepEqual(base(h).map(r=>r.id),[A,id]);
});

test('D2u-b Text edit in Two in flight; Cards allocates One id; back to Text BEFORE the confirm; confirm; type in One',async t=>{
 const h=await text867(t,card('One','one',null)+card('Two','two',details(B,'rose')));
 editWords(h,1,'two','two!');
 const hold=holdSaves(h);const saving=h.w.flush();await hold.arrived;
 cardsMode(h);const id=h.p.ensureCardId(h.p.cardRef(0));assert.ok(id);
 textMode(h);
 hold.release();await saving;
 console.log('D2u-b base',sh(base(h)),'| value',sh(val(h)));
 const rows=editWords(h,0,'one','one!');console.log('D2u-b typed',sh(rows));
 assert.deepEqual(rows.map(r=>r.id),[id,B]);
 await h.w.flush();await h.w.flush();assert.deepEqual(base(h).map(r=>r.id),[id,B]);
});

// The real page's only Text keystroke door is the textarea's input listener, and the textarea panel is hidden in Cards.
test('reach: in the Cards view the textarea panel and in the Text view the card list (with every ⋯) are hidden',async t=>{
 const h=await text867(t,card('One','one',null));
 assert.equal(h.p.mode,'text');assert.equal(h.p.list.hidden,true);assert.equal(h.p.textPanel.hidden,false);
 cardsMode(h);
 assert.equal(h.p.mode,'cards');assert.equal(h.p.list.hidden,false);assert.equal(h.p.textPanel.hidden,true);
});
