// Retained review source SHA256 0c5c9cc4891ae4516c12c2f8ff101d75a49081e9b7bcc044dd70722101383117; adaptations: docs/card-text-review-867.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { text867 as port867, card, details, hidden, A, B, C, metaOf, parseDeck, cardDetails, stripDetails, CardTextProjection, cardText } from './fixtures/card_text_867.mjs';
// Real writer notifications update the body projection, including metadata-only acts.
async function text867(t,raw){const h=await port867(t,raw);h.w.changed=()=>{if(!h.w.closed)h.p.sync();};return h;}
const D='c-44444444444444444444444444444444';
const sh=rows=>rows.map(r=>`${r.title}:${r.id?r.id.slice(2,3):'-'}${r.aliases.length?'/'+r.aliases.map(a=>a.slice(2,3)).join(''):''}/${r.color??'-'}`).join('  ');
const allIds=body=>parseDeck(body).cards.flatMap(c=>cardDetails(c.words).ids);
const dupIds=body=>{const ids=allIds(body);return [...new Set(ids.filter((x,i)=>ids.indexOf(x)!==i))];};
const span=(v,i)=>{const d=parseDeck(v);let s=d.opening.length;for(let k=0;k<i;k++)s+=d.cards[k].raw.length;return {start:s,end:s+d.cards[i].raw.length,raw:d.cards[i].raw};};
const editWords=(h,i,from,to)=>{const v=h.p.text.value,s=span(v,i),k=s.raw.indexOf(from);assert.ok(k>=0,'words present '+from+' in '+JSON.stringify(s.raw));return h.input(s.start+k,s.start+k+from.length,to);};
const rename=(h,i,to)=>{const v=h.p.text.value,s=span(v,i),nl=s.raw.indexOf('\n');return h.input(s.start+3,s.start+(nl<0?s.raw.length:nl),to);};
const pasteAt=(h,i,text)=>{const v=h.p.text.value;const at=i>=parseDeck(v).cards.length?v.length:span(v,i).start;return h.input(at,at,text,'insertFromPaste');};
const typeAt=(h,at,s)=>{let rows;for(let i=0;i<s.length;i++)rows=h.input(at+i,at+i,s[i]);return rows;};
function holdSaves(h){const send=h.api.command;let release,arrive;const arrived=new Promise(r=>arrive=r);h.api.command=async e=>{const receipt=await send(e);arrive();await new Promise(r=>release=r);return receipt;};return {arrived,release:()=>{h.api.command=send;release();}};}
const noDupSaved=h=>{for(const c of h.calls){const d=dupIds(c.args.body);assert.deepEqual(d,[],'duplicate id in a saved body: '+JSON.stringify(c.args.body));}};
const cardsMode=h=>{h.p.header.description=h.p.doc.createElement('p');h.p.switchView('cards');};
const twin=card('Same','same',null);

// ---------- A: identical twins with ids edited around a confirmed save, every order ----------
for(const n of [2,3])for(const mode of ['words','rename'])for(let i=0;i<n;i++)for(let j=0;j<n;j++)if(i!==j)for(let k=0;k<=n;k++)
test(`A n=${n} ${mode} ${i}, save in flight, edit ${j}, confirm, paste twin at ${k}`,async t=>{
 const ids=[A,B,C].slice(0,n),colors=['blue','rose','green'];
 const h=await text867(t,ids.map((id,x)=>card('Same','same',details(id,colors[x]))).join(''));
 if(mode==='words')editWords(h,i,'same','same'+i);else rename(h,i,'Other'+i);
 const hold=holdSaves(h);const saving=h.w.flush();await hold.arrived;
 editWords(h,j,'same','same'+j);
 hold.release();await saving;
 const rows=pasteAt(h,k,twin);await h.w.flush();
 const expect=[...ids];expect.splice(k,0,null);
 const saved=metaOf(h.w.base.content.body);
 if(JSON.stringify(saved.map(r=>r.id))!==JSON.stringify(expect))console.log('A FAIL',n,mode,i,j,k,'value',sh(rows),'saved',sh(saved));
 noDupSaved(h);assert.deepEqual(saved.map(r=>r.id),expect);
});
for(const n of [2,3])for(let i=0;i<n;i++)for(let j=0;j<n;j++)if(i!==j)for(let k=0;k<=n;k++)
test(`A2 n=${n} edit ${i}, confirm, edit ${j}, confirm, paste twin at ${k} while that save is in flight`,async t=>{
 const ids=[A,B,C].slice(0,n),colors=['blue','rose','green'];
 const h=await text867(t,ids.map((id,x)=>card('Same','same',details(id,colors[x]))).join(''));
 editWords(h,i,'same','same'+i);await h.w.flush();
 editWords(h,j,'same','same'+j);
 const hold=holdSaves(h);const saving=h.w.flush();await hold.arrived;
 const rows=pasteAt(h,k,twin);
 hold.release();await saving;await h.w.flush();
 const expect=[...ids];expect.splice(k,0,null);
 const saved=metaOf(h.w.base.content.body);
 if(JSON.stringify(saved.map(r=>r.id))!==JSON.stringify(expect))console.log('A2 FAIL',n,i,j,k,'value',sh(rows),'saved',sh(saved));
 noDupSaved(h);assert.deepEqual(saved.map(r=>r.id),expect);
});

// ---------- B: a twin with an id and one without ----------
for(const shape of ['id first','id second'])for(let i=0;i<2;i++)for(let k=0;k<=2;k++)
test(`B ${shape}: edit ${i}, save in flight, edit ${1-i}, confirm, paste twin at ${k}`,async t=>{
 const ids=shape==='id first'?[A,null]:[null,A];
 const h=await text867(t,ids.map(id=>card('Same','same',id?details(id,'rose'):null)).join(''));
 editWords(h,i,'same','same'+i);
 const hold=holdSaves(h);const saving=h.w.flush();await hold.arrived;
 editWords(h,1-i,'same','same'+(1-i));
 hold.release();await saving;
 const rows=pasteAt(h,k,twin);await h.w.flush();
 const expect=[...ids];expect.splice(k,0,null);
 const saved=metaOf(h.w.base.content.body);
 if(JSON.stringify(saved.map(r=>r.id))!==JSON.stringify(expect))console.log('B FAIL',shape,i,k,'value',sh(rows),'saved',sh(saved));
 noDupSaved(h);assert.deepEqual(saved.map(r=>r.id),expect);
});

// ---------- C: a pasted twin beside a card, then typing in the original ----------
test('C0 paste an exact copy of a card right below it (Copy text, paste), then type in the ORIGINAL',async t=>{
 const h=await text867(t,card('Plan','plan words',details(A))+card('Other','other',details(B,'rose')));
 let rows=pasteAt(h,1,card('Plan','plan words',null));console.log('C0 pasted',sh(rows));
 assert.deepEqual(rows.map(r=>r.id),[A,null,B]);
 rows=editWords(h,0,'plan words','plan words!');console.log('C0 typed in original',sh(rows));
 await h.w.flush();console.log('C0 saved',sh(metaOf(h.w.base.content.body)));
 noDupSaved(h);
 assert.deepEqual(rows.map(r=>[r.id,r.color]),[[A,'blue'],[null,null],[B,'rose']],'the original keeps its id and color; the pasted copy has none');
});
test('C0b paste an exact copy ABOVE, then type in the original (now row 1)',async t=>{
 const h=await text867(t,card('Plan','plan words',details(A))+card('Other','other',details(B,'rose')));
 let rows=pasteAt(h,0,card('Plan','plan words',null));assert.deepEqual(rows.map(r=>r.id),[null,A,B]);
 rows=editWords(h,1,'plan words','plan words!');console.log('C0b',sh(rows));
 assert.deepEqual(rows.map(r=>r.id),[null,A,B]);
});
test('C0c paste a copy below, then RENAME the original',async t=>{
 const h=await text867(t,card('Plan','plan words',details(A))+card('Other','other',details(B,'rose')));
 let rows=pasteAt(h,1,card('Plan','plan words',null));assert.deepEqual(rows.map(r=>r.id),[A,null,B]);
 rows=rename(h,0,'Plan B');console.log('C0c',sh(rows));
 assert.deepEqual(rows.map(r=>r.id),[A,null,B]);
});
test('C0d paste a copy below, save confirms, then type in the original (base now holds both)',async t=>{
 const h=await text867(t,card('Plan','plan words',details(A))+card('Other','other',details(B,'rose')));
 pasteAt(h,1,card('Plan','plan words',null));await h.w.flush();
 const rows=editWords(h,0,'plan words','plan words!');console.log('C0d',sh(rows));
 assert.deepEqual(rows.map(r=>r.id),[A,null,B]);
});
test('C1 (fuzz r=1) twins: rename row 0 (unsaved), paste a twin between, keep typing in the renamed title',async t=>{
 const h=await text867(t,card('Same','same',details(A))+card('Same','same',details(B,'green')));
 let rows=rename(h,0,'Other');assert.deepEqual(rows.map(r=>r.id),[A,B]);
 rows=pasteAt(h,1,twin);console.log('C1 pasted',sh(rows));assert.deepEqual(rows.map(r=>r.id),[A,null,B]);
 const at=h.p.text.value.indexOf('Other')+5;rows=h.input(at,at,'!');console.log('C1 typed',sh(rows));
 assert.deepEqual(rows.map(r=>r.id),[A,null,B]);
});
test('C2 (fuzz r=3) twins: paste a twin between, then type in the LOWER original',async t=>{
 const h=await text867(t,card('Same','same',details(A))+card('Same','same',details(B,'green')));
 let rows=pasteAt(h,1,twin);assert.deepEqual(rows.map(r=>r.id),[A,null,B]);
 rows=editWords(h,2,'same','same!');console.log('C2',sh(rows));
 assert.deepEqual(rows.map(r=>r.id),[A,null,B]);
});
test('C3 rename then paste a twin between, save confirms, then keep typing (base holds the rename)',async t=>{
 const h=await text867(t,card('Same','same',details(A))+card('Same','same',details(B,'green')));
 rename(h,0,'Other');pasteAt(h,1,twin);await h.w.flush();
 const at=h.p.text.value.indexOf('Other')+5;const rows=h.input(at,at,'!');console.log('C3',sh(rows));
 assert.deepEqual(rows.map(r=>r.id),[A,null,B]);
});
test('C4 module replay of fuzz r=1 and r=3 histories',()=>{
 const run=(start,edits)=>{const p=new CardTextProjection();let text=p.show(start),out;for(const e of edits){text=text.slice(0,e.start)+e.insert+text.slice(e.end);out=p.edit(text,{start:e.start,end:e.end,inputType:'insertText'});}return metaOf(out);};
 const r1=run(card('Same','same',details(A))+card('Same','same',details(B,'green')),[{start:3,end:7,insert:'Other'},{start:16,end:16,insert:twin},{start:3,end:8,insert:'Other!'}]);
 const r3=run(card('Same','same',details(A))+card('Same','same',details(B,'green')),[{start:15,end:15,insert:twin},{start:39,end:43,insert:'same!'}]);
 console.log('C4 r=1',sh(r1),'| r=3',sh(r3));
 assert.deepEqual(r1.map(r=>r.id),[A,null,B]);assert.deepEqual(r3.map(r=>r.id),[A,null,B]);
});

// ---------- D: a confirmed save that itself carries a NEW id (Cards Copy link) between keystrokes ----------
test('D1 Text edit in Two, Cards allocates One id, save confirms both, then type in both',async t=>{
 const h=await text867(t,card('One','one',null)+card('Two','two',details(B,'rose')));
 editWords(h,1,'two','two!');cardsMode(h);
 const id=h.p.ensureCardId(h.p.cardRef(0));assert.ok(id);await h.w.flush();
 console.log('D1 base',sh(metaOf(h.w.base.content.body)));
 h.p.switchView('text');
 let rows=editWords(h,1,'two!','two!?');rows=editWords(h,0,'one','one!');console.log('D1 typed',sh(rows));
 await h.w.flush();noDupSaved(h);
 assert.deepEqual(metaOf(h.w.base.content.body).map(r=>r.id),[id,B]);
});
test('D2 Text edit save in flight, Cards allocates One id meanwhile, text save confirms, type in One before its id saves',async t=>{
 const h=await text867(t,card('One','one',null)+card('Two','two',details(B,'rose')));
 editWords(h,1,'two','two!');
 const hold=holdSaves(h);const saving=h.w.flush();await hold.arrived;
 cardsMode(h);const id=h.p.ensureCardId(h.p.cardRef(0));assert.ok(id);
 hold.release();await saving;
 console.log('D2 base',sh(metaOf(h.w.base.content.body)),'| value',sh(metaOf(h.w.value.body)));
 h.p.switchView('text');
 const rows=editWords(h,0,'one','one!');console.log('D2 typed',sh(rows));
 assert.deepEqual(rows.map(r=>r.id),[id,B]);
 await h.w.flush();noDupSaved(h);assert.deepEqual(metaOf(h.w.base.content.body).map(r=>r.id),[id,B]);
});
test('D3 id confirmed by Copy link, then offline Set color, then a keystroke IN that card before any sync',async t=>{
 const h=await text867(t,card('One','one',null)+card('Two','two',details(B,'rose')));
 h.p.header.description=h.p.doc.createElement('p');
 const id=h.p.ensureCardId(h.p.cardRef(0));assert.ok(id);await h.w.flush();
 assert.deepEqual(metaOf(h.w.base.content.body).map(r=>r.id),[id,B]);
 const send=h.api.command;h.api.command=async()=>{throw Error('offline');};
 const picker=h.p.cardColors(h.p.cardRef(0),h.p.text);t.after(()=>picker.close(false));
 const swatch=picker.root.querySelectorAll('.swatch').find(n=>n.getAttribute('aria-label')==='green')??picker.root.querySelectorAll('.swatch')[0];
 await swatch.onclick();
 console.log('D3 after color value',sh(metaOf(h.w.value.body)),'| base',sh(metaOf(h.w.base.content.body)));
 const rows=editWords(h,0,'one','one!');console.log('D3 typed in One',sh(rows));
 h.api.command=send;await h.w.flush();await h.w.flush();
 console.log('D3 saved',sh(metaOf(h.w.base.content.body)));noDupSaved(h);
 assert.deepEqual(rows.map(r=>[r.id,r.color]),[[id,'green'],[B,'rose']],'the unconfirmed color survives a keystroke in its card after the id confirmed');
 assert.deepEqual(metaOf(h.w.base.content.body).map(r=>[r.id,r.color]),[[id,'green'],[B,'rose']]);
});
test('D4 Text keystroke in One in flight, Copy link allocates One id meanwhile, confirm, keystroke in One again',async t=>{
 const h=await text867(t,card('One','one',null)+card('Two','two',details(B,'rose')));
 h.p.header.description=h.p.doc.createElement('p');
 editWords(h,0,'one','one!');
 const hold=holdSaves(h);const saving=h.w.flush();await hold.arrived;
 const id=h.p.ensureCardId(h.p.cardRef(0));assert.ok(id);
 hold.release();await saving;
 console.log('D4 base',sh(metaOf(h.w.base.content.body)),'| value',sh(metaOf(h.w.value.body)));
 const rows=editWords(h,0,'one!','one!!');console.log('D4 typed',sh(rows));
 assert.deepEqual(rows.map(r=>r.id),[id,B]);
 await h.w.flush();noDupSaved(h);assert.deepEqual(metaOf(h.w.base.content.body).map(r=>r.id),[id,B]);
});
test('D5 twins: Copy link allocates an id on the id-less twin while a keystroke in the identified twin is in flight',async t=>{
 const h=await text867(t,card('Same','same',details(A))+card('Same','same',null));
 h.p.header.description=h.p.doc.createElement('p');
 editWords(h,0,'same','same!');
 const hold=holdSaves(h);const saving=h.w.flush();await hold.arrived;
 const id=h.p.ensureCardId(h.p.cardRef(1));assert.ok(id);
 hold.release();await saving;
 let rows=editWords(h,0,'same!','same!!');console.log('D5 typed first',sh(rows));
 rows=editWords(h,1,'same','same?');console.log('D5 typed second',sh(rows));
 assert.deepEqual(rows.map(r=>r.id),[A,id]);
 await h.w.flush();noDupSaved(h);assert.deepEqual(metaOf(h.w.base.content.body).map(r=>r.id),[A,id]);
});

// ---------- E: CRLF page, type then Undo on the opening, an id-less card, an identified card, titles, a line under the title ----------
const crlfRaw=('# Page\n\nopening\n\n'+card('One','one',null)+card('Two','two',details(B,'rose'))+'## Three\n\n'+hidden(details(A,'green'))+'\n\nthree words\n\n').replaceAll('\n','\r\n');
for(const target of ['opening','one','two','three words','One','Two','Three'])test('E1 CRLF type then Undo at '+target+': exact bytes back, no revision',async t=>{
 const h=await text867(t,crlfRaw);const at=h.p.text.value.indexOf(target)+target.length;
 h.input(at,at,'x');const typed=h.w.value.body;
 h.input(at,at+1,'','historyUndo');await h.w.flush();
 const mixed=/(?<!\r)\n/.test(typed)&&typed.includes('\r\n');
 console.log('E1',target,'typed mixed endings?',mixed,'undone equal',h.w.value.body===crlfRaw,'calls',h.calls.length);
 assert.equal(h.w.value.body,crlfRaw);assert.equal(h.calls.length,0);
});
test('E2 CRLF type in two cards and the opening, Undo all three',async t=>{
 const h=await text867(t,crlfRaw);const v=h.p.text.value;
 const a=v.indexOf('opening')+7,b=v.indexOf('one')+3,c=v.indexOf('three words')+11;
 h.input(c,c,'z');h.input(b,b,'y');h.input(a,a,'x');
 h.input(a,a+1,'','historyUndo');h.input(b,b+1,'','historyUndo');h.input(c,c+1,'','historyUndo');
 await h.w.flush();assert.equal(h.w.value.body,crlfRaw);assert.equal(h.calls.length,0);
});
test('E3 CRLF type two chars in the identified card, Undo twice',async t=>{
 const h=await text867(t,crlfRaw);const at=h.p.text.value.indexOf('two')+3;
 h.input(at,at,'x');h.input(at+1,at+1,'y');h.input(at+1,at+2,'','historyUndo');h.input(at,at+1,'','historyUndo');
 await h.w.flush();assert.equal(h.w.value.body,crlfRaw);assert.equal(h.calls.length,0);
});
test('E4 CRLF type, save confirms, Undo: the revision owed has consistent endings per card and keeps every id',async t=>{
 const h=await text867(t,crlfRaw);const at=h.p.text.value.indexOf('two')+3;
 h.input(at,at,'x');await h.w.flush();const saved1=h.w.base.content.body;
 h.input(at,at+1,'','historyUndo');await h.w.flush();const saved2=h.w.base.content.body;
 console.log('E4 saved1',JSON.stringify(saved1));console.log('E4 saved2',JSON.stringify(saved2));
 assert.equal(stripDetails(saved2).replaceAll('\r\n','\n'),h.p.text.value);
 assert.deepEqual(metaOf(saved2).map(r=>[r.id,r.color]),[[null,null],[B,'rose'],[A,'green']]);
 assert.ok(saved2.startsWith('# Page\r\n'),'untouched opening keeps CRLF');assert.ok(saved2.includes('## One\r\n\r\none\r\n'),'untouched card keeps CRLF');
});

// ---------- F: markdown hard break (two trailing spaces) ----------
test('F1 CRLF identified card: type two spaces, Return, a word; metadata stays after the words; Undo all restores bytes',async t=>{
 const h=await text867(t,crlfRaw);const at=h.p.text.value.indexOf('two')+3;
 let rows;rows=h.input(at,at,' ');rows=h.input(at+1,at+1,' ');rows=h.input(at+2,at+2,'\n');rows=h.input(at+3,at+3,'next');
 const body=h.w.value.body;console.log('F1 body',JSON.stringify(body));
 assert.equal(stripDetails(body).replaceAll('\r\n','\n'),h.p.text.value);
 assert.deepEqual(rows.map(r=>r.id),[null,B,A]);
 const normalized=body.replaceAll('\r\n','\n'),wordAt=normalized.indexOf('two  \nnext');
 assert.ok(wordAt>=0&&wordAt<normalized.indexOf(hidden(details(B,'rose'))),'metadata after the hard break and the new word');
 h.input(at+3,at+7,'','historyUndo');h.input(at+2,at+3,'','historyUndo');h.input(at+1,at+2,'','historyUndo');h.input(at,at+1,'','historyUndo');
 await h.w.flush();assert.equal(h.w.value.body,crlfRaw);assert.equal(h.calls.length,0);
});
test('F2 LF: hard break at the end of an identified card, save, then a twin pasted below: identity stays',async t=>{
 const h=await text867(t,card('Plan','plan',details(A))+card('End','end',details(B,'rose')));
 const at=h.p.text.value.indexOf('plan')+4;h.input(at,at,'  ');h.input(at+2,at+2,'\n');h.input(at+3,at+3,'more');await h.w.flush();
 const rows=pasteAt(h,1,card('Plan','plan  \nmore',null));console.log('F2',sh(rows));
 assert.deepEqual(rows.map(r=>r.id),[A,null,B]);await h.w.flush();noDupSaved(h);
});

// ---------- G: offline Set color on an id-less twin, type IN it, paste a twin beside it, then the save confirms ----------
test('G1 offline Set color on the second id-less twin, type in it, paste a twin between, confirm',async t=>{
 const h=await text867(t,card('Same','same',null)+card('Same','same',null));
 cardsMode(h);const send=h.api.command;h.api.command=async()=>{throw Error('offline');};
 const picker=h.p.cardColors(h.p.cardRef(1),h.p.text);t.after(()=>picker.close(false));
 const swatch=picker.root.querySelectorAll('.swatch').find(n=>n.getAttribute('aria-label')==='green')??picker.root.querySelectorAll('.swatch')[0];
 await swatch.onclick();const id=metaOf(h.w.value.body)[1].id;assert.ok(id);
 h.p.switchView('text');
 let rows=editWords(h,1,'same','same!');console.log('G1 typed',sh(rows));assert.deepEqual(rows.map(r=>r.id),[null,id]);
 rows=pasteAt(h,1,twin);console.log('G1 pasted',sh(rows));assert.deepEqual(rows.map(r=>[r.id,r.color]),[[null,null],[null,null],[id,'green']]);
 h.api.command=send;await h.w.flush();await h.w.flush();console.log('G1 saved',sh(metaOf(h.w.base.content.body)));noDupSaved(h);
 assert.deepEqual(metaOf(h.w.base.content.body).map(r=>[r.id,r.color]),[[null,null],[null,null],[id,'green']]);
});
test('G2 offline Set color on an id-less card, then delete its heading in Text (merge up), then Undo',async t=>{
 const h=await text867(t,card('First','first',details(A))+card('Second','second',null));
 cardsMode(h);const send=h.api.command;h.api.command=async()=>{throw Error('offline');};
 const picker=h.p.cardColors(h.p.cardRef(1),h.p.text);t.after(()=>picker.close(false));
 await (picker.root.querySelectorAll('.swatch').find(n=>n.getAttribute('aria-label')==='green')??picker.root.querySelectorAll('.swatch')[0]).onclick();
 const id=metaOf(h.w.value.body)[1].id;assert.ok(id);h.p.switchView('text');
 const v=h.p.text.value,s=v.indexOf('## Second'),e=s+'## Second\n'.length;
 let rows=h.input(s,e,'','deleteContentBackward');console.log('G2 merged',sh(rows));assert.deepEqual(dupIds(h.w.value.body),[]);
 rows=h.input(s,s,'## Second\n','historyUndo');console.log('G2 undone',sh(rows));assert.deepEqual(dupIds(h.w.value.body),[]);
 h.api.command=send;await h.w.flush();await h.w.flush();console.log('G2 saved',sh(metaOf(h.w.base.content.body)));noDupSaved(h);
 assert.deepEqual(metaOf(h.w.base.content.body).map(r=>[r.id,r.color]),[[A,'blue'],[id,'green']],'the unconfirmed color returns with its card on Undo');
});

// ---------- H: Cards Undo of a confirmed delete / merge, then type in the restored card ----------
test('H1 Cards delete save in flight, Cards Undo, delete confirms, type in the restored card, save',async t=>{
 const h=await text867(t,card('One','one',details(A))+card('Two','two',details(B,'rose')));
 cardsMode(h);h.p.act({kind:'remove',text:cardText(h.p.deck.cards[1]),near:1});
 const hold=holdSaves(h);const saving=h.w.flush();await hold.arrived;
 h.p.key({key:'z',metaKey:true,target:h.p.list,preventDefault(){}});
 hold.release();await saving;
 console.log('H1 base',sh(metaOf(h.w.base.content.body)),'| value',sh(metaOf(h.w.value.body)));
 h.p.switchView('text');const rows=editWords(h,1,'two','two!');console.log('H1 typed',sh(rows));
 assert.deepEqual(rows.map(r=>[r.id,r.color]),[[A,'blue'],[B,'rose']]);
 await h.w.flush();await h.w.flush();noDupSaved(h);assert.deepEqual(metaOf(h.w.base.content.body).map(r=>[r.id,r.color]),[[A,'blue'],[B,'rose']]);
});
test('H2 Cards merge confirmed, Cards Undo (unsaved split), type in the restored card and the survivor',async t=>{
 const h=await text867(t,card('One','one',details(A))+card('Two','two',details(B,'rose')));
 cardsMode(h);h.p.act({kind:'merge',text:cardText(h.p.deck.cards[1]),near:1,step:-1});await h.w.flush();
 console.log('H2 merged base',sh(metaOf(h.w.base.content.body)));assert.deepEqual(metaOf(h.w.base.content.body).map(r=>r.ids),[[A,B]]);
 h.p.key({key:'z',metaKey:true,target:h.p.list,preventDefault(){}});
 console.log('H2 undone value',sh(metaOf(h.w.value.body)));
 h.p.switchView('text');
 let rows=editWords(h,1,'two','two!');console.log('H2 typed restored',sh(rows));assert.deepEqual(dupIds(h.w.value.body),[]);
 rows=editWords(h,0,'one','one!');console.log('H2 typed survivor',sh(rows));assert.deepEqual(dupIds(h.w.value.body),[]);
 assert.deepEqual(rows.map(r=>r.ids),[[A],[B]]);
 await h.w.flush();noDupSaved(h);assert.deepEqual(metaOf(h.w.base.content.body).map(r=>r.ids),[[A],[B]]);
});
test('H3 Text Undo of an unsaved Text merge where the survivor has a confirmed alias keeps that alias only',async t=>{
 const h=await text867(t,card('First','first',details(A,'blue',[D]))+card('Second','second',details(B,'rose')));
 const v=h.p.text.value,s=v.indexOf('## Second'),e=s+'## Second\n'.length;
 let rows=h.input(s,e,'','deleteContentBackward');console.log('H3 merged',sh(rows));assert.deepEqual(rows.map(r=>r.ids),[[A,D,B]]);
 rows=h.input(s,s,'## Second\n','historyUndo');console.log('H3 undone',sh(rows));
 assert.deepEqual(rows.map(r=>r.ids),[[A,D],[B]]);assert.equal(rows[1].color,'rose');
});

// ---------- I: a transient merge alias (delete a heading, then put it back before saving) ----------
test('I1 delete a heading, then paste it back before saving: the merged alias stays on its current owner',async t=>{
 const h=await text867(t,card('First','first',details(A))+card('Second','second',details(B,'rose')));
 const v=h.p.text.value,s=v.indexOf('## Second'),e=s+'## Second\n'.length;
 let rows=h.input(s,e,'','deleteContentBackward');console.log('I1 merged',sh(rows));assert.deepEqual(rows.map(r=>r.ids),[[A,B]]);
 rows=h.input(s,s,'## Second\n','insertFromPaste');console.log('I1 pasted back',sh(rows));
 assert.deepEqual(rows.map(r=>[r.ids,r.color]),[[[A,B],'blue'],[[],null]]);
 await h.w.flush();noDupSaved(h);assert.deepEqual(metaOf(h.w.base.content.body).map(r=>r.ids),[[A,B],[]]);
});
test('I2 delete a heading, then type it back key by key before saving: one id per card at every key',async t=>{
 const h=await text867(t,card('First','first',details(A))+card('Second','second',details(B,'rose')));
 const v=h.p.text.value,s=v.indexOf('## Second'),e=s+'## Second\n'.length;
 h.input(s,e,'','deleteContentBackward');
 const keys='## Second\n';let rows;const trail=[];
 for(let i=0;i<keys.length;i++){rows=h.input(s+i,s+i,keys[i]);trail.push(sh(rows));assert.deepEqual(dupIds(h.w.value.body),[],'dup at key '+i+': '+sh(rows));}
 console.log('I2 trail',trail.join(' | '));
 assert.deepEqual(rows.map(r=>[r.ids,r.color]),[[[A,B],'blue'],[[],null]]);
 await h.w.flush();noDupSaved(h);
});
test('I3 delete a heading with the save in flight, Undo, then the merged save confirms, then type in the restored card',async t=>{
 const h=await text867(t,card('First','first',details(A))+card('Second','second',details(B,'rose')));
 const v=h.p.text.value,s=v.indexOf('## Second'),e=s+'## Second\n'.length;
 h.input(s,e,'','deleteContentBackward');
 const hold=holdSaves(h);const saving=h.w.flush();await hold.arrived;
 let rows=h.input(s,s,'## Second\n','historyUndo');console.log('I3 undone (merge in flight)',sh(rows));
 hold.release();await saving;console.log('I3 base',sh(metaOf(h.w.base.content.body)));
 rows=editWords(h,1,'second','second!');console.log('I3 typed restored',sh(rows));assert.deepEqual(dupIds(h.w.value.body),[]);
 await h.w.flush();console.log('I3 saved',sh(metaOf(h.w.base.content.body)));noDupSaved(h);
 assert.deepEqual(dupIds(h.w.base.content.body),[]);
});
test('I4 delete a heading, save confirms, Undo: exact snapshots split the identities',async t=>{
 const h=await text867(t,card('First','first',details(A))+card('Second','second',details(B,'rose')));
 const v=h.p.text.value,s=v.indexOf('## Second'),e=s+'## Second\n'.length;
 h.input(s,e,'','deleteContentBackward');await h.w.flush();
 const rows=h.input(s,s,'## Second\n','historyUndo');console.log('I4',sh(rows));
 await h.w.flush();noDupSaved(h);assert.deepEqual(dupIds(h.w.base.content.body),[]);
});
test('I5 chain: delete Second and Third headings, Undo once, Undo twice',async t=>{
 const h=await text867(t,card('First','first',details(A))+card('Second','second',details(B,'rose'))+card('Third','third',details(C,'green')));
 let v=h.p.text.value,s2=v.indexOf('## Second'),e2=s2+'## Second\n'.length;
 let rows=h.input(s2,e2,'','deleteContentBackward');console.log('I5 a',sh(rows));
 v=h.p.text.value;const s3=v.indexOf('## Third'),e3=s3+'## Third\n'.length;
 rows=h.input(s3,e3,'','deleteContentBackward');console.log('I5 b',sh(rows));assert.deepEqual(rows.map(r=>r.ids),[[A,B,C]]);
 rows=h.input(s3,s3,'## Third\n','historyUndo');console.log('I5 c',sh(rows));assert.deepEqual(rows.map(r=>r.ids),[[A,B],[C]]);
 rows=h.input(s2,s2,'## Second\n','historyUndo');console.log('I5 d',sh(rows));assert.deepEqual(rows.map(r=>[r.ids,r.color]),[[[A],'blue'],[[B],'rose'],[[C],'green']]);
 await h.w.flush();noDupSaved(h);
});
test('I6 delete the SECOND heading of three, the merged alias confirms, re-split by Undo, then delete the Third heading',async t=>{
 const h=await text867(t,card('First','first',details(A))+card('Second','second',details(B,'rose'))+card('Third','third',details(C,'green')));
 let v=h.p.text.value,s2=v.indexOf('## Second'),e2=s2+'## Second\n'.length;
 h.input(s2,e2,'','deleteContentBackward');await h.w.flush();
 let rows=h.input(s2,s2,'## Second\n','historyUndo');console.log('I6 a',sh(rows));
 v=h.p.text.value;const s3=v.indexOf('## Third'),e3=s3+'## Third\n'.length;
 rows=h.input(s3,e3,'','deleteContentBackward');console.log('I6 b',sh(rows));assert.deepEqual(dupIds(h.w.value.body),[]);
 await h.w.flush();noDupSaved(h);
});
