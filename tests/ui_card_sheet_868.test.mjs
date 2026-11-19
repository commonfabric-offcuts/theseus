import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DeckPage } from '../web/deck-page.mjs';
import { NotebookSheet } from '../web/notebook-sheet.mjs';
import { parseDeck } from '../web/deck.mjs';
import { miniDocument, Element, matches } from './fixtures/mini_dom.mjs';

// Actual handlers and painting, with no browser or geometry claim.
function documentFor(t) {
  const doc = miniDocument(), saved = new Map(), listeners = new Map();
  const set = (name, value) => { saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); };
  const make = doc.createElement;
  doc.createElement = tag => {
    const n = make(tag); n.ownerDocument = doc; n.style = { setProperty(k,v) { this[k]=v; }, removeProperty(k) { delete this[k]; } };
    n.scrollTop = 0; n.scrollHeight = n.clientHeight = n.offsetHeight = 100;
    Object.defineProperty(n, 'parentElement', { get: () => n.parent });
    n.contains = other => n === other || [...n.descendants()].includes(other);
    n.matches = selector => matches(n, selector);
    n.getBoundingClientRect = () => ({ top: 0, bottom: 100, height: 100, width: 500 });
    n.getClientRects = () => [n.getBoundingClientRect()];
    n.before = other => n.parent?.insertBefore(other,n);
    n.setSelectionRange = (start,end) => { n.selectionStart=start; n.selectionEnd=end; };
    n.querySelectorAll = selector => {
      const own = /^:scope\s*>\s*(.+)$/.exec(selector), simple = own?.[1] ?? selector;
      const values = [...simple.matchAll(/\[([\w-]+)="([^"]*)"\]/g)];
      const plain = simple.replace(/\[([\w-]+)="[^"]*"\]/g, '[$1]');
      return (own ? n.children : [...n.descendants()]).filter(el => matches(el,plain) && values.every(([,key,value]) => key.startsWith('data-') ? el.dataset[key.slice(5)] === value : el.getAttribute(key) === value));
    };
    return n;
  };
  doc.createElementNS = (_ns,tag) => doc.createElement(tag);
  doc.body = doc.createElement('body'); doc.body.root = true; doc.activeElement=doc.body;
  doc.documentElement=doc.createElement('html'); doc.getElementById=id=>doc.byId(id);
  doc.querySelector=()=>null; doc.getSelection=()=>({isCollapsed:true});
  doc.addEventListener=(type,fn)=>{if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);};
  doc.defaultView={getComputedStyle:()=>({marginTop:'0px',marginBottom:'0px'}),addEventListener(){}};
  set('document',doc); set('location',new URL('https://fixture/?topic=t'));
  set('addEventListener',()=>{});set('removeEventListener',()=>{});set('scrollX',0);set('scrollY',0);set('scrollTo',()=>{});
  set('matchMedia',()=>({matches:true,addEventListener(){},removeEventListener(){}}));
  set('sessionStorage',{getItem:()=>null,setItem(){},removeItem(){}});set('localStorage',{getItem:()=>null,setItem(){}});
  t.after(()=>{for(const [name,descriptor] of saved)descriptor?Object.defineProperty(globalThis,name,descriptor):delete globalThis[name];});
  return doc;
}
function deck(t) {
  const doc=documentFor(t),host=doc.createElement('section');doc.body.append(host);
  const page=new DeckPage({doc,host,item:'fixture-page',header:{description:doc.createElement('p')},read(){},send(){},place(){},askIn(){}});
  page.base={body:'## First\n\n## Second'};page.deck=parseDeck(page.base.body);page.save=()=>{};
  page.paint();return {page,doc};
}
const key=(page,name,extra={})=>{const event={key:name,target:page.editing?.field??page.list,preventDefault(){this.defaultPrevented=true;},...extra};page.key(event);return event;};
const ringed=page=>page.list.querySelectorAll('.deck-card').filter(row=>row.getAttribute('aria-current')==='true'||row.classList.contains('deck-writing'));

test('868 Command-Return leaves exactly the new writing card ringed, including after repaint',t=>{
  const {page}=deck(t);page.open({text:'First',shown:'First',depth:0,near:0,fresh:false});
  assert.equal(key(page,'Enter',{metaKey:true}).defaultPrevented,true);
  assert.equal(page.editing.fresh,true);assert.equal(page.editing.field.value,'');
  assert.equal(ringed(page).length,1,'the previous card must lose its current ring');
  assert.equal(ringed(page)[0],page.editing.field.closest('li'));
  page.paint();assert.equal(ringed(page).length,1,'a redraw keeps one current card');
  assert.equal(ringed(page)[0].getAttribute('aria-current'),'true');
});
test('868 finishing an empty next card restores the original current card without adding an empty card',t=>{
  const {page}=deck(t);page.open({text:'First',shown:'First',depth:0,near:0,fresh:false});
  key(page,'Enter',{metaKey:true});key(page,'Enter',{metaKey:true});
  assert.equal(page.editing,null);assert.equal(page.deck.cards.length,2);assert.equal(ringed(page).length,1);
  assert.equal(ringed(page)[0].dataset.index,'0');
});
test('868 existing-card editing designates its writing row current, then Escape restores the picked card',t=>{
  const {page}=deck(t);page.picked=1;page.open({text:'Second',shown:'Second',depth:0,near:1,fresh:false});
  assert.equal(ringed(page).length,1);assert.equal(ringed(page)[0].getAttribute('aria-current'),'true');
  key(page,'Escape');assert.equal(page.editing,null);assert.equal(ringed(page).length,1);assert.equal(ringed(page)[0].dataset.index,'1');
});
test('868 card keys still finish, add and undo while the toolbar has scrolled away; status stays accessible',t=>{
  const {page}=deck(t);page.host.scrollTop=500;
  assert.equal(page.status.getAttribute('role'),'status');
  page.open({text:'First',shown:'First',depth:0,near:0,fresh:false});key(page,'Enter',{metaKey:true});
  page.editing.field.value='Third';key(page,'Escape');
  assert.equal(page.deck.cards.length,3);assert.equal(page.deck.cards[1].title,'Third');
  key(page,'z',{metaKey:true});assert.equal(page.deck.cards.length,2);
  assert.equal(ringed(page).length,1);assert.equal(page.host.scrollTop,500);
});

async function sheet(t) {
  const doc=documentFor(t);
  for(const id of ['new-message-sheet','inline-composer','reader'])doc.body.append(doc.byId(id));
  const dialog=doc.byId('new-message-sheet');dialog.close=()=>{dialog.open=false;};dialog.show=dialog.showModal=()=>{dialog.open=true;};
  const pages=[];
  const s=new NotebookSheet({doc,fullHref:()=>'/p',openStack:async()=>true,goBack(){},feed:{topicId:'t',read:async()=>({items:[],next_cursor:null}),open(){}},
    make:(id,host)=>{const page={item:id,host,mode:'cards',text:doc.createElement('textarea'),sheetTitle:doc.createElement('span'),views:doc.createElement('div'),draft:doc.createElement('button'),more:doc.createElement('button'),pageNotice:doc.createElement('p'),status:doc.createElement('p'),bar:doc.createElement('div'),list:doc.createElement('ol'),load:async()=>true,show(){},paint(){},close(){},writing:{journalPending:false,flush:async()=>{}}};
      page.status.setAttribute('role','status');page.status.textContent='Saved to Theseus';page.bar.className='deck-bar';page.list.className='deck-cards';host.append(page.bar,page.list);pages.push(page);return page;}});
  t.after(()=>s.retire());await s.open('one');return {s,doc,pages};
}
test('868 only title and glyphs stay outside the active page scroller in modal and docked modes',async t=>{
  const {s,pages}=await sheet(t),page=pages[0],head=s.title.parentElement;
  assert.deepEqual(head.children.map(n=>n.className),[s.title,s.dockButton,s.full,s.closer].map(n=>n.className));
  for(const docked of [true,false]) {
    s.setDocked(docked);
    for(const control of [s.views,s.dossierButton,s.status,s.dossiers.root,page.bar,page.list])assert.ok(page.host.contains(control),'control shares the cards scroll owner');
    assert.equal(s.views.parentElement,s.dossierButton.parentElement,'Choose dossier shares the views toolbar');
    assert.equal(page.status.getAttribute('role'),'status');assert.equal(page.status.textContent,'Saved to Theseus');
  }
});
test('868 controls follow page switches without replacing scroll ownership or duplicating status',async t=>{
  const {s,pages}=await sheet(t),first=pages[0];first.host.scrollTop=177;await s.open('two');
  assert.equal(first.kept.host,177);assert.ok(pages[1].host.contains(s.views));assert.equal(first.host.contains(s.views),false);
  assert.equal(s.status.children.length,1);assert.ok(s.status.children[0]===pages[1].status);
  s.close();await s.open('two');assert.equal(s.current,pages[1]);assert.ok(pages[1].host.contains(s.status));
});
test('868 stylesheet keeps one compact header row and lets the deck bar scroll',()=>{
  const css=readFileSync(new URL('../web/aim.css',import.meta.url),'utf8');
  const rules=selector=>[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([,s])=>s.trim()===selector).map(([,s,b])=>b).join(';');
  assert.doesNotMatch(rules('.notebook-sheet-page>.deck-bar'),/position:sticky/);
  assert.doesNotMatch(rules('.notebook-sheet-head'),/flex-wrap:wrap|grid-template-areas/);
  assert.match(rules('.notebook-sheet-head .sheet-glyph'),/height:2\.5rem/);
  assert.match(rules('.notebook-sheet-title'),/text-overflow:ellipsis/);
  assert.match(rules('.notebook-sheet-page'),/overflow:auto/);
});
