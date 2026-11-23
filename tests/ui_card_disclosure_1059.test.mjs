// Controller decisions and real view identity; this fake supplies geometry,
// so actual clamp/wrapping/focus order belongs to the separate native harness.
//1113: explicitly flush the scheduled frame; existing1059 assertions stay intact.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CardDisclosure,disclosureRecords} from '../web/card-disclosure.mjs';
import {applyAct,cardText,deckBody,parseDeck} from '../web/deck.mjs';
import {detailsLine} from '../web/card-details.mjs';
import {miniDocument} from './fixtures/mini_dom.mjs';
import {DeckPage} from '../web/deck-page.mjs';
const cards=body=>parseDeck(body).cards;
const page='## One\n\nLong words.\n\n## Two\n\nMore words.\n';

test('1059 unique stored card identity keeps its display choice across rename and reordering',()=>{
 const id='c-'+'a'.repeat(32),line=detailsLine({id,aliases:[],color:null});
 let records=disclosureRecords([],cards(page.replace('Long words.','Long words.\n\n'+line)));records[0].expanded=true;
 const moved=cards('## Two\n\nMore words.\n\n## Renamed\n\nNew body.\n\n'+line+'\n');
 records=disclosureRecords(records,moved);assert.deepEqual(records.map(r=>r.expanded),[false,true]);
});
test('1059 unique text follows a remote move and unique heading follows an updated body',()=>{
 let records=disclosureRecords([],cards(page));records[0].expanded=true;
 records=disclosureRecords(records,cards('## Two\n\nMore words.\n\n## One\n\nLong words.\n'));
 assert.deepEqual(records.map(r=>r.expanded),[false,true]);
 records=disclosureRecords(records,cards('## Two\n\nMore words.\n\n## One\n\nChanged words.\n'));
 assert.deepEqual(records.map(r=>r.expanded),[false,true]);
});
test('1059 identical legacy cards keep separate choices across repaint and real local move results',()=>{
 const deck=parseDeck('## Same\n\nWords.\n\n## Same\n\nWords.\n');let records=disclosureRecords([],deck.cards);records[0].expanded=true;
 records=disclosureRecords(records,parseDeck(deckBody(deck)).cards);assert.deepEqual(records.map(r=>r.expanded),[true,false]);
 const current={...deck,cards:records.map(r=>r.card)},done=applyAct(current,{kind:'move',text:cardText(current.cards[0]),near:0,step:1});assert.ok(done);
 records=disclosureRecords(records,done.deck.cards);records=disclosureRecords(records,parseDeck(deckBody(done.deck)).cards);
 assert.deepEqual(records.map(r=>r.expanded),[false,true]);
});
test('1059 actual direct-edit continuity keeps a renamed and rewritten card',()=>{
 const deck=parseDeck(page);let records=disclosureRecords([],deck.cards);records[0].expanded=true;
 const done=applyAct(deck,{kind:'edit',text:cardText(deck.cards[0]),to:'Renamed\nRewritten.',near:0});
 records=disclosureRecords(records,done.deck.cards,{from:deck.cards[0],to:done.deck.cards[done.at]});
 records=disclosureRecords(records,parseDeck(deckBody(done.deck)).cards);assert.deepEqual(records.map(r=>r.expanded),[true,false]);
});
test('1059 the actual DeckPage act carries duplicate-card choices before its real reparse',()=>{
 const f=fixture(),body='## Same\n\nWords.\n\n## Same\n\nWords.\n',deck=parseDeck(body);
 f.controller.begin(deck.cards);f.controller.records[0].expanded=true;
 const p=Object.assign(Object.create(DeckPage.prototype),{deck,base:{body},disclosure:f.controller,selected:new Set(),acts:[],undos:[],picked:0,
  header:{description:{}},reveal(){},paint(){this.disclosure.begin(this.deck.cards);},save(){}});
 assert.equal(p.act({kind:'move',text:cardText(deck.cards[0]),near:0,step:1}),true);
 assert.deepEqual(p.disclosure.records.map(r=>r.expanded),[false,true]);
 assert.equal(p.act({kind:'edit',text:cardText(p.deck.cards[1]),near:1,to:'Renamed\nRewritten.'}),true);
 assert.deepEqual(p.disclosure.records.map(r=>r.expanded),[false,true]);f.signal.abort();
});
test('1059 ambiguous external duplicate replacement resets unmatched choices and new ids do not inherit another card',()=>{
 let records=disclosureRecords([],cards('## Same\n\nWords.\n\n## Same\n\nWords.\n'));records[0].expanded=true;
 records=disclosureRecords(records,cards('## Same\n\nWords.\n\n## Same\n\nWords.\n\n## Same\n\nWords.\n'));assert.deepEqual(records.map(r=>r.expanded),[false,false,false]);
 const tagged=id=>cards('## Same\n\n'+detailsLine({id:'c-'+id.repeat(32),aliases:[],color:null})+'\n');
 records=disclosureRecords([],tagged('a'));records[0].expanded=true;records=disclosureRecords(records,tagged('b'));assert.equal(records[0].expanded,false);
});

function fixture(){
 const doc=miniDocument();doc.body=doc.byId('body');doc.fonts=new EventTarget();doc.defaultView=new EventTarget();
 class Observer{constructor(callback){this.callback=callback;this.targets=new Set();}observe(node){this.targets.add(node);}disconnect(){this.targets.clear();}}
 const signal=new AbortController(),controller=new CardDisclosure({doc,signal:signal.signal,ResizeObserver:Observer});
 const frames=[];doc.defaultView.requestAnimationFrame=callback=>{frames.push(callback);return frames.length;};
 const flush=()=>{for(const callback of frames.splice(0))callback();};
 const rows=[];
 const attach=(index=0,full=130,clamped=40)=>{
  const row=doc.createElement('li'),words=doc.createElement('div');row.className='deck-card';words.className='deck-words';row.append(words);doc.body.append(row);
  const geometry={full,clamped,width:200,visible:true};
  words.getClientRects=()=>geometry.visible&&words.isConnected?[{}]:[];
  Object.defineProperties(words,{clientWidth:{get:()=>geometry.width},clientHeight:{get:()=>words.classList.contains('deck-expanded')?geometry.full:geometry.clamped},scrollHeight:{get:()=>geometry.full}});
  controller.attach(row,words,index);const entry=controller.entries.at(-1);rows.push(row);return {...entry,geometry};
 };
 const click=entry=>{let stopped=0;entry.button.listeners.click({stopPropagation(){stopped++;}});assert.equal(stopped,1);flush();};
 return {doc,signal,controller,attach,click,rows,flush};
}
test('1059 measured overflow offers a per-card native button, expands/collapses and leaves short words alone',()=>{
 const f=fixture();f.controller.begin(cards(page));const long=f.attach(),short=f.attach(1,20,20);f.controller.mount();f.flush();
 assert.equal(long.button.textContent,'Show all');assert.equal(long.button.hidden,false);assert.equal(short.button.hidden,true);
 assert.equal(long.button.getAttribute('aria-controls'),long.words.id);
 long.button.focus();f.click(long);assert.equal(long.words.clientHeight,130);assert.equal(long.button.textContent,'Show less');assert.equal(long.button.getAttribute('aria-expanded'),'true');assert.equal(f.doc.activeElement,long.button);assert.equal(short.record.expanded,false);
 f.click(long);assert.equal(long.words.clientHeight,40);assert.equal(long.button.getAttribute('aria-expanded'),'false');f.signal.abort();
});
test('1059 attached visible geometry and pixel tolerance gate the control; resize removes it and returns focus to its card',()=>{
 const f=fixture();f.controller.begin(cards(page));const entry=f.attach(0,41,40);f.controller.mount();f.flush();assert.equal(entry.button.hidden,true);
 entry.geometry.full=130;f.controller.resize.callback([{target:entry.words}]);f.flush();assert.equal(entry.button.hidden,false);
 entry.button.focus();f.click(entry);entry.geometry.full=20;entry.geometry.clamped=20;f.controller.resize.callback([{target:entry.words}]);f.flush();assert.equal(entry.button.hidden,true);assert.equal(f.doc.activeElement,entry.row);assert.equal(entry.record.expanded,true);
 entry.geometry.full=130;entry.geometry.visible=false;f.controller.refresh();f.flush();assert.equal(entry.button.hidden,true);
 entry.geometry.visible=true;entry.geometry.width=0;f.controller.refresh();f.flush();assert.equal(entry.button.hidden,true);f.signal.abort();
});
test('1059 repaint restores the same disclosure focus and choice, then abort releases observations and state',()=>{
 const f=fixture(),body=cards(page);f.controller.begin(body);const old=f.attach();f.controller.mount();f.flush();old.button.focus();f.click(old);
 const focus=f.controller.focused();f.controller.begin(cards(page));old.row.remove();const next=f.attach();f.controller.mount(focus);f.flush();
 assert.equal(next.button.textContent,'Show less');assert.equal(f.doc.activeElement,next.button);assert.equal(f.controller.resize.targets.has(old.words),false);assert.equal(f.controller.resize.targets.has(next.words),true);
 f.signal.abort();assert.equal(f.controller.closed,true);assert.equal(f.controller.resize.targets.size,0);assert.deepEqual(f.controller.records,[]);assert.deepEqual(f.controller.entries,[]);
});
test('1059 repaint that removes a focused pill returns focus to that same card',()=>{
 const f=fixture();f.controller.begin(cards(page));f.attach();const second=f.attach(1);f.controller.mount();f.flush();
 second.button.focus();f.click(second);const focused=f.controller.focused();
 f.controller.begin(cards(page.replace('More words.','Short.')));for(const row of f.rows)row.remove();
 const first=f.attach(),now=f.attach(1,20,20);first.row.focus();
 f.controller.mount(focused);f.flush();assert.equal(now.button.hidden,true);assert.equal(f.doc.activeElement,now.row);f.signal.abort();
});
test('1059 a second repaint preserves the same card focus after its pill disappeared',()=>{
 const f=fixture();f.controller.begin(cards(page));f.attach();const second=f.attach(1);f.controller.mount();f.flush();second.button.focus();
 const repaint=()=>{const focus=f.controller.focused();f.controller.begin(cards(page));for(const row of f.rows)row.remove();const first=f.attach(),now=f.attach(1,20,20);first.row.focus();f.controller.mount(focus);f.flush();return now;};
 const first=repaint();assert.equal(f.doc.activeElement,first.row);
 const again=repaint();assert.equal(f.doc.activeElement,again.row,'the fallback row remains the same focused card on the next repaint');f.signal.abort();
});
