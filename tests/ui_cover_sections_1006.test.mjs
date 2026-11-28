import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { coverSheet } from '../web/dossier-cover.mjs';
import { formatNodes, sourcePosition } from '../web/message-format.mjs';

const context={viewer:'viewer-1006',topicId:'topic-1006',rootId:'message-1006',nameOf:x=>x};
const cover={owner:'owner-1006',root_id:'message-1006',revision:1,waiting:[],stands:''};
const raw='Preface\n\n# Today\n\n- **Built** one\n- [Result](https://example.test/result)\n\n### Detail\n\nKeep `bytes`\n\n## Next\n\nNext words\n\n# Parked\n\nParked words';
function fixture(storage=new Map()) {
  const doc=miniDocument(),create=doc.createElement;
  doc.createElement=tag=>{const n=create(tag);n.style={setProperty(){}};
    Object.defineProperties(n,{childNodes:{get:()=>n.children},parentNode:{get:()=>n.parent}});return n;};
  const host=doc.byId('host');doc.querySelectorAll=s=>host.querySelectorAll(s);
  doc.defaultView={crypto:webcrypto,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},addEventListener(){}};
  const paint=(stands=raw,ctx=context,input={})=>{const sheet=coverSheet(doc,{...cover,stands,...input},ctx);host.append(sheet);return sheet;};
  return {doc,host,paint,storage};
}
const sections=sheet=>sheet.querySelector('.cover-stands')?.querySelectorAll('.cover-section') ?? [];
const toggle=(section,open)=>{section.open=open;section.listeners.toggle({target:section});};
const tree=n=>({tag:n.tagName,cl:n.className,text:n.textContent,href:n.href??null,children:n.children.map(x=>typeof x==='string'?x:tree(x))});
const unwrap=n=>n.classList?.contains('cover-section') ? [n.children[0].children[0],...n.children[1].children.flatMap(unwrap)] : [n];

test('1006 all sections open; nested levels end at the next same/higher heading without lost words or source positions',()=>{
  const {paint,doc}=fixture(),sheet=paint(),words=sheet.querySelector('.cover-stands'),all=sections(sheet);
  assert.equal(all.length,4);assert.ok(all.every(n=>n.open));
  assert.equal(all[0].querySelectorAll('.cover-section').length,2);
  assert.equal(all[2].querySelectorAll('.cover-section').length,0);
  assert.equal(all[3].querySelectorAll('.cover-section').length,0);
  assert.equal(all[1].children[1].text,'Keep bytes');
  const drawn=words.children.flatMap(unwrap),reference=formatNodes(raw,{doc});
  assert.deepEqual(drawn.map(tree),reference.map(tree));
  assert.deepEqual(drawn.map(n=>sourcePosition(n,0)),reference.map(n=>sourcePosition(n,0)));
  assert.equal(words.querySelector('a').href,'https://example.test/result');
});
test('1006 same viewer/message shares live folds and repaint, while another viewer/message starts open',()=>{
  const {paint,storage}=fixture(),card=paint(),reader=paint();
  toggle(sections(card)[2],false);
  assert.equal(sections(reader)[2].open,false);
  assert.equal(sections(paint(raw,context,{revision:2}))[2].open,false);
  assert.equal(sections(paint(raw,{...context,viewer:'someone-else'}))[2].open,true);
  assert.equal(sections(paint(raw,{...context,rootId:'other'},{root_id:'other'}))[2].open,true);
  assert.equal(sections(paint(raw.replace('## Next','## Renamed')))[2].open,true);
  const fresh=fixture(storage);assert.equal(sections(fresh.paint())[2].open,false);
  toggle(sections(card)[2],true);assert.equal(sections(reader)[2].open,true);
});
test('1006 repeated headings keep independent choices; unrelated prefix/body refresh keeps a heading choice',()=>{
  const {paint}=fixture(),input='## Same\n\nFirst\n\n## Same\n\nSecond',sheet=paint(input);
  toggle(sections(sheet)[1],false);
  const again=sections(paint('Intro\n\n'+input+' changed'));
  assert.equal(again[0].open,true);assert.equal(again[1].open,false);
});
test('1006 fifth/sixth-level headings nest by their authored level, and empty headings lose no body',()=>{
  const {paint}=fixture(),sheet=paint('##### Parent\n\nBody\n\n###### Child\n\nChild words\n\n##### Next\n\nNext words\n\n# \n\nEmpty heading body');
  const all=sections(sheet);assert.equal(all.length,4);assert.equal(all[0].querySelectorAll('.cover-section').length,1);
  assert.equal(all[1].children[1].text,'Child words');assert.equal(all[2].children[1].text,'Next words');
  assert.equal(all[3].children[1].text,'Empty heading body');assert.ok(all.every(n=>n.open));
});
test('1006 refused storage retains in-document preferences; corrupt stored state cannot close arbitrary sections',()=>{
  const {doc,paint}=fixture();
  Object.defineProperty(doc.defaultView,'localStorage',{get(){throw Error('storage denied');}});
  const sheet=paint();toggle(sections(sheet)[0],false);assert.equal(sections(paint())[0].open,false);
  const storage=new Map(),valid=fixture(storage);toggle(sections(valid.paint())[0],false);
  for(const key of storage.keys())storage.set(key,'{"closed":"not a list"}');
  assert.ok(sections(fixture(storage).paint()).every(n=>n.open));
});
test('1006 a cover with no headings remains exactly963, and complete HTML fences do not enter folding',()=>{
  const {paint,doc}=fixture();
  const plain=paint('Plain\nSecond').querySelector('.cover-stands');
  assert.equal(plain.className,'cover-words cover-stands');assert.equal(plain.children.length,0);assert.equal(plain.textContent,'Plain\nSecond');
  const rich='- **One**\n- Two',words=paint(rich).querySelector('.cover-stands');
  assert.deepEqual(words.children.map(tree),formatNodes(rich,{doc}).map(tree));assert.equal(sections(words).length,0);
  const html=paint('# Literal\n```html\n<button>Run</button>\n```');
  assert.equal(sections(html).length,0);assert.equal(html.querySelector('iframe').getAttribute('sandbox'),'allow-scripts');
});
