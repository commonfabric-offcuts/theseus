// Item 768, spec 9118 §7 + 9139/9149/9155/9217. Real parser/drawing contracts.
// TEXT_DISPLAY_SOURCE selects an extracted git source for the prefeature red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { doc, byClass, byTag, walk, formatted768, RULE } from './text_display_768_fixtures.mjs';
const root = process.env.TEXT_DISPLAY_SOURCE || fileURLToPath(new URL('..',import.meta.url));
const format = await import(pathToFileURL(path.join(root, 'web/message-format.mjs')));
let registry;
try { registry = await import(pathToFileURL(path.join(root, 'web/text-display-rules.mjs'))); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const draw = (body, enabled = [RULE]) => { const host = doc.createElement('div'); host.append(...format.formatNodes(body, {doc, displayRules:enabled})); return host; };
const reading = body => {
  assert.ok(registry, 'the display-rule stage exists');
  let blocks;
  const capture = {id:'item-768-capture', apply(input) { blocks=input; return input; }};
  registry.textDisplayRules.unshift(capture);
  try { draw(body, [capture.id]); } finally { registry.textDisplayRules.shift(); }
  return blocks;
};
const fingerprint = blocks => JSON.stringify(blocks);
const partitionWords = block => block.kind === 'paragraph' ? [block.words] : block.kind === 'list' ? block.items.flatMap(i => i.paragraphs?.map(p=>p.words) ?? [i.words]) : [];

test('item 768 actual formatted drawing splits sentences, running enumerators and inner list sentences', () => {
  assert.deepEqual(byClass(draw(formatted768[0]), 'md-p').map(n=>n.textContent), ['First sentence. ', 'Second bold sentence. ', 'Third sentence.']);
  assert.deepEqual(byClass(draw(formatted768[1]), 'md-p').map(n=>n.textContent), ['Choose ', '1) First ', '2) Second ', '3) Third']);
  assert.deepEqual(byClass(draw(formatted768[2]), 'md-p').map(n=>n.textContent), ['a) First ', 'i. Second ', '(a) Third']);
  const list=draw(formatted768[6]);
  assert.deepEqual(byClass(list,'md-marker').map(n=>n.textContent), ['1)','2)']);
  assert.deepEqual(byClass(list,'sentence-paragraph').map(n=>n.textContent), ['First sentence. ', 'Second sentence.', 'Next item. ', 'Last sentence.']);
  assert.equal(byClass(draw(formatted768[0], []),'md-p').length,1,'Off keeps authored paragraphs');
});

test('item 768 every mapped UTF-16 character and original run survives, pure and idempotent on formatted-word fixtures', () => {
  for (const body of formatted768) {
    const before=reading(body), snapshot=fingerprint(before), after=registry.applyTextDisplayRules(before,[RULE]);
    assert.equal(fingerprint(before),snapshot,'pure input: '+body);
    assert.deepEqual(registry.applyTextDisplayRules(after,[RULE]),after,'idempotent: '+body);
    const oldWords=before.flatMap(partitionWords), newWords=after.flatMap(partitionWords);
    const chars = parts => parts.flatMap(w=>Array.from({length:w.text.length},(_,k)=>[w.text[k],w.pos(k),body[w.pos(k)]]));
    assert.deepEqual(chars(newWords), chars(oldWords),'same characters, exact source positions, including CRLF and surrogate halves: '+body);
    for(const [character,,source] of chars(newWords)) assert.equal(character,source);
    assert.equal(newWords.map(w=>w.text).join(''),oldWords.map(w=>w.text).join(''));
  }
});

test('item 768 links/code/nested marks never split; headings/quotes/fences/tables retain identity', () => {
  for (const body of formatted768) {
    const before=reading(body), after=registry.applyTextDisplayRules(before,[RULE]);
    for(const b of before) {
      if(b.kind!=='paragraph'&&b.kind!=='list') assert.ok(after.includes(b),'protected block identity '+b.kind);
      if(b.kind!=='paragraph') continue;
      for(const span of b.protectedSpans) {
        const start=b.words.at(span.start),end=b.words.at(span.end);
        assert.ok(after.some(p=>p.kind==='paragraph'&&p.start<=start&&p.end>=end),'protected span stays whole '+body.slice(start,end));
      }
    }
    const off=draw(body,[]),on=draw(body);
    for(const tag of ['a','code','strong','em','s','table']) assert.deepEqual(byTag(on,tag).map(n=>n.textContent),byTag(off,tag).map(n=>n.textContent),'protected drawing '+tag);
  }
});

test('item 768 list markers, task state, carried mapping and depth stay authored; no running enumerators inside items', () => {
  const before=reading(formatted768[7]), after=registry.applyTextDisplayRules(before,[RULE]);
  for(let k=0;k<before[0].items.length;k++) {
    const {paragraphs,...actual}=after[0].items[k]; assert.deepEqual(actual,before[0].items[k]); assert.equal(paragraphs.length,2);
  }
  const list=draw('1) First 2) Second 3) Third');
  assert.equal(byClass(list,'md-item').length,1); assert.equal(byClass(list,'sentence-paragraph').length,0);
});

test('item 768 mapped selection across sentence/enumerator/list partitions takes exact authored source; marks and named links retain existing endpoints', () => {
  for(const [body,first,last,expected] of [
    [formatted768[0],'First','Third sentence. ',null],
    [formatted768[1],'First','Third','First 2) **Second** 3) Third'],
    [formatted768[6],'First','Last sentence.','First sentence. Second sentence.\n2) Next item. Last sentence.'],
    ['Before **bold** after. Next.','bold','bold','**bold**'],
    ['Before [label](https://example.com) after. Next.','label','label','[label](https://example.com)'],
  ]) {
    const host=draw(body),texts=walk(host).filter(n=>n.nodeType===3),start=texts.find(n=>n.data.includes(first)),end=texts.findLast(n=>n.data.includes(last.trimEnd()));
    assert.ok(start&&end,'selection endpoints drawn');
    const a=format.sourcePosition(start,start.data.indexOf(first)),b=format.sourcePosition(end,end.data.indexOf(last.trimEnd())+last.trimEnd().length,true);
    assert.equal(body.slice(a,b),expected??body,'exact endpoint projection');
  }
});

test('item 768 registry rejects character dropping, changed source runs, protected cuts, kind changes, list metadata and in-place mutation', () => {
  const before=reading('First **bold. Still bold.** end. Next sentence.');
  const split=(b,from,to,last)=>({kind:'paragraph',words:b.words.slice(from,to),start:b.words.at(from),end:b.words.at(to),passages:[{from:0,to:to-from}],sentenceParagraph:true,paragraphEnd:last});
  const invalid = [
    b=>[split(b[0],1,b[0].words.text.length,true)],
    b=>[{...b[0],words:{...b[0].words,runs:[[0,999]]}}],
    b=>[split(b[0],0,15,false),split(b[0],15,b[0].words.text.length,true)],
    b=>[{...b[0],kind:'heading'}],
    b=>{b[0].words.text='dropped';return b;},
  ];
  for(const apply of invalid) {
    const mutant={id:'item-768-invalid',apply};registry.textDisplayRules.push(mutant);
    try {assert.throws(()=>registry.applyTextDisplayRules(before,[mutant.id]),/preserve source|read only|readonly|Cannot assign/);}
    finally{registry.textDisplayRules.pop();}
  }
  const list=reading(formatted768[6]);
  const mutant={id:'item-768-invalid-list',apply:b=>[{...b[0],items:b[0].items.map(i=>({...i,marker:'9)'}))}]};registry.textDisplayRules.push(mutant);
  try {assert.throws(()=>registry.applyTextDisplayRules(list,[mutant.id]),/preserve source/);}finally{registry.textDisplayRules.pop();}
  const stages=[];
  for(const id of ['item-768-order-a','item-768-order-b']) registry.textDisplayRules.push({id,apply:b=>{stages.push(id);return b;}});
  try{registry.applyTextDisplayRules(before,['item-768-order-b','item-768-order-a']);assert.deepEqual(stages,['item-768-order-a','item-768-order-b']);}finally{registry.textDisplayRules.splice(-2);}
});

test('item 768 defaults Off; choice persists only for same instance/reader/device and denied storage keeps memory', () => {
  assert.ok(registry);const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},P=registry.TextDisplayPreferences;
  const own=new P('instance','reader',storage);assert.deepEqual(own.enabled,[]);own.toggle(RULE);
  assert.deepEqual(new P('instance','reader',storage).enabled,[RULE]);
  for(const p of [new P('other-instance','reader',storage),new P('instance','other-reader',storage),new P('instance','reader',{getItem:()=>null,setItem(){}})])assert.deepEqual(p.enabled,[]);
  own.toggle(RULE);assert.deepEqual(new P('instance','reader',storage).enabled,[]);
  const denied=new P('instance','reader',{getItem(){throw Error('denied');},setItem(){throw Error('denied');}});denied.toggle(RULE);assert.deepEqual(denied.enabled,[RULE]);
});

// Live 721/838 docks a nonmodal Reader in the card. Its visible message words
// still belong to MessageMenu; only a full modal Reader owns its own selection.
test('item 768 selected Copy keeps authored words while an inline reply is open, and respects modal and writing guards', async () => {
  const { MessageMenu } = await import(pathToFileURL(path.join(root, 'web/message-menu.mjs')));
  const body = 'First **bold** sentence. Second sentence.';
  const words = doc.createElement('span');
  format.formatWords(words, body, { doc, displayRules: [RULE] });
  const start = walk(words).find(node => node.nodeType === 3);
  const card = { matches: selector => selector === '.message', querySelector: () => words };
  let mode = 'inline', writing = false;
  const page = {
    activeElement: { tagName: 'DIV', closest: () => writing ? {} : null },
    querySelector: selector => mode === 'modal' || mode === 'inline' && selector === 'dialog[open]' ? {} : null,
    getSelection: () => ({ rangeCount: 1, isCollapsed: false, getRangeAt: () => ({ startContainer: start }) }),
  };
  const menu = { doc: page, host: { closest: () => null }, entryOf: () => card,
    passages: { selected: () => ({ text: body }) } };
  const copy = () => {
    const result = { prevented: false, text: null };
    MessageMenu.prototype.copySelection.call(menu, { defaultPrevented: false,
      preventDefault: () => { result.prevented = true; }, clipboardData: { setData: (type, text) => { assert.equal(type, 'text/plain'); result.text = text; } } });
    return result;
  };
  assert.deepEqual(copy(), { prevented: true, text: body }, 'inline reply leaves the displayed card selection owned by MessageMenu');
  mode = 'modal'; assert.deepEqual(copy(), { prevented: false, text: null }, 'full Reader owns its selection');
  mode = 'inline'; writing = true; assert.deepEqual(copy(), { prevented: false, text: null }, 'writing keeps native Copy');
  writing = false; format.formatWords(words, body, { doc, displayRules: [] });
  assert.deepEqual(copy(), { prevented: false, text: null }, 'Off keeps native Copy');
});
