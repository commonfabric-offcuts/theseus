import test from 'node:test';
import assert from 'node:assert/strict';
import { writingPort, painted867, card, NotebookPage, DeckPage, parseDeck } from './fixtures/card_menu_867.mjs';
import { literalWords, sourcePosition, drawnText, drawnRevision } from '../web/message-format.mjs';

console.log('1158 runtime '+JSON.stringify({version:process.version,execPath:process.execPath,pid:process.pid,ppid:process.ppid,cwd:process.cwd(),argv:process.argv,execArgv:process.execArgv}));

// Extend only this test's memory DOM with real tree relationships for the shared
// source-position owner. No hit testing, browser focus or native input is modeled.
function mappingDOM(doc) {
  const make=doc.createElement;
  const decorate=n=>{
    Object.defineProperties(n,{
      parentNode:{get(){return this.parent??null;}},
      firstChild:{get(){return this.childNodes?.[0]??null;}},
      lastChild:{get(){return this.childNodes?.at(-1)??null;}}
    });
    n.ownerDocument=doc;return n;
  };
  doc.createElement=tag=>decorate(make(tag));
  doc.createElementNS=(_,tag)=>doc.createElement(tag);
  doc.createTextNode=text=>decorate({nodeType:3,data:String(text),childNodes:[],
    get textContent(){return this.data;},
    remove(){if(this.parent){this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=null;}}
  });
}
async function fixture(t,raw=card('```command```','Body',null),{passages=false}={}) {
  const f=await writingPort(t,raw);mappingDOM(f.p.doc);painted867(t,f.p);
  f.p.mode='cards';f.p.paint=()=>NotebookPage.prototype.paint.call(f.p);
  f.p.source=f.w.base.source;const bindings=[];
  if(passages)f.p.passages={bind:(node,options)=>bindings.push({node,...options})};
  f.p.paint();return {...f,bindings};
}
const title=(p,at=0)=>p.list.children[at].querySelector(':scope > .deck-title');
const shown=p=>title(p).querySelector('.notebook-title-words')??title(p);
const texts=node=>node.nodeType===3?[node]:[...(node.childNodes??[])].flatMap(texts);
const repaint=(p,name)=>{p.deck=parseDeck(card(name,'Body',null));p.paint();};

test('1158 Notebook Display renders a compact title fence without a copy button',async t=>{
  const {p}=await fixture(t);
  assert.equal(Boolean(shown(p).querySelector('.md-pre')),true,'1158 title fence is rendered');
  assert.equal(shown(p).textContent,'command');
  assert.equal(shown(p).querySelectorAll('.fence-copy').length,0);
});

test('1158 title code reuses compact and inline fence parsing with literal payload',async t=>{
  const {p}=await fixture(t);
  for(const [raw,expected,kind] of [
    ['~~~~two <tag> & https://example.test~~~~','two <tag> & https://example.test','.md-pre'],
    ['````two ``` literal````','two ``` literal','.md-pre'],
    ['Use `x <tag>` now','Use x <tag> now','.md-code'],
    ['Use `` say `hi` `` now','Use say `hi` now','.md-code']
  ]) {
    repaint(p,raw);assert.ok(shown(p).querySelector(kind),raw);
    assert.equal(shown(p).textContent,expected,raw);
    assert.equal(shown(p).querySelectorAll('.fence-copy').length,0);
    assert.equal(shown(p).querySelectorAll('a').length,0,'payload never becomes a link');
    assert.equal(shown(p).querySelectorAll('iframe').length,0,'payload never executes HTML');
  }
});

test('1158 non-code title marks and unmatched delimiters remain literal',async t=>{
  const {p}=await fixture(t);
  for(const raw of ['**Literal** [label](https://example.test/)','## heading marks','before `unclosed','```unclosed','\\`escaped\\`']) {
    repaint(p,raw);assert.equal(shown(p).textContent,raw);
    assert.equal(shown(p).querySelectorAll('.md-code').length,0);
    assert.equal(shown(p).querySelectorAll('.md-pre').length,0);
    assert.equal(shown(p).querySelectorAll('strong').length,0);
    assert.equal(shown(p).querySelectorAll('a').length,0);
  }
});

test('1158 title omits fence copy while body and 1157 card controls retain their owners',async t=>{
  const {p,w,calls}=await fixture(t,card('```title```','```\nbody payload\n```',null));
  assert.equal(shown(p).querySelectorAll('.fence-copy').length,0);
  assert.equal(p.list.children[0].querySelector('.deck-words').querySelectorAll('.fence-copy').length,1);
  assert.ok(p.list.children[0].querySelector('.notebook-card-copy'));
  assert.ok(p.list.children[0].querySelector('.notebook-card-add'));
  assert.equal(w.value.body,card('```title```','```\nbody payload\n```',null));
  assert.equal(calls.length,0,'painting creates no command or card identity');
});

test('1158 a formatted parent retains the existing chevron and raw edit text',async t=>{
  const raw='## ```Parent```\n\nBody\n\n### Child\n\nChild words\n';
  const {p,w,calls}=await fixture(t,raw),chevron=title(p).querySelector('.deck-fold');
  assert.ok(chevron);assert.equal(chevron.getAttribute('aria-expanded'),'true');
  assert.equal(shown(p).querySelector('.deck-fold'),null);
  const event={stopPropagation(){this.stopped=true;}};
  chevron.listeners.click(event);assert.equal(event.stopped,true);
  assert.ok(p.folded.has('```Parent```'));assert.equal(p.list.children[1].hidden,true);
  // Omit geometry from this semantic edit port; the real edit owner still
  // computes the raw title/body and hands it to its existing open owner.
  let opened;p.open=editing=>{opened=editing;};const list=p.list;
  p.list={querySelector:()=>null};p.edit();p.list=list;
  assert.equal(opened.text,'```Parent```\nBody');
  assert.equal(opened.shown,'```Parent```\nBody');
  assert.equal(w.value.body,raw);assert.equal(calls.length,0);
});

test('1158 title source mapping keeps delimiters and does not accumulate on rebinding',async t=>{
  const raw=card('```α command```','Body',null),{p,w,bindings}=await fixture(t,raw,{passages:true});
  const label=shown(p),code=label.querySelector('.md-pre'),text=texts(code)[0];
  assert.equal(drawnText(label),'```α command```');assert.equal(drawnRevision(label),1);
  const before=[sourcePosition(text,2),sourcePosition(text,7,true)];
  assert.equal(drawnText(p.list.children[0]).slice(...before),'comma');
  assert.equal(sourcePosition(text,0),0,'whole title includes heading marks');
  assert.equal(sourcePosition(text,text.data.length,true),'## ```α command```'.length);
  p.readingPassages();assert.deepEqual([sourcePosition(text,2),sourcePosition(text,7,true)],before);
  const binding=bindings.find(b=>b.node===p.list.children[0]);assert.ok(binding.current());
  assert.equal(w.value.body,raw);
});

test('1158 redraw uses a fresh title revision while read-only painting leaves writing intact',async t=>{
  const {p,w,calls}=await fixture(t,card('```old```','Body',null),{passages:true});
  const raw=card('~~~new~~~','Body',null);p.readOnly=true;
  p.source={...p.source,body:raw,source_ref:{...p.source.source_ref,revision:2}};
  w.base={...w.base,source:p.source,revision:2};w.value={...w.value,body:raw};p.deck=parseDeck(raw);p.paint();
  assert.equal(shown(p).textContent,'new');assert.equal(drawnRevision(shown(p)),2);
  assert.equal(w.value.body,raw);assert.equal(calls.length,0);
});

test('1158 Cards titles and default literal formatter keep their prior literal contract',async t=>{
  const {p}=await fixture(t);Object.setPrototypeOf(p,DeckPage.prototype);DeckPage.prototype.paint.call(p);
  assert.equal(title(p).textContent,'```command```');assert.equal(title(p).querySelector('.md-pre'),null);
  const label=p.doc.createElement('span');literalWords(label,'**Literal** `code`',4);
  assert.equal(label.textContent,'**Literal** `code`');assert.equal(label.querySelector('.md-code'),null);
  assert.equal(drawnRevision(label),4);
});
