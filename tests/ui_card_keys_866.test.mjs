import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAct, cardText, deckBody, parseDeck } from '../web/deck.mjs';
import { DeckPage } from '../web/deck-page.mjs';
import { WritingInput } from '../web/writing-input.mjs';

// Real writing and deck handlers with in-memory field/paint ports; no native gesture claim.
function field(value) {
  const handlers = [], commands = [], node = { value, selectionStart: value.length, selectionEnd: value.length,
    addEventListener(name, fn) { handlers.push([name, fn]); },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    setRangeText(text, start, end) { this.value = this.value.slice(0, start) + text + this.value.slice(end); this.setSelectionRange(start + text.length, start + text.length); },
    dispatchEvent(event) { for (const [name, fn] of handlers) if (name === event.type) fn(event); },
    ownerDocument: { execCommand(kind, _ui, text) { commands.push(kind); node.setRangeText(text, node.selectionStart, node.selectionEnd); node.dispatchEvent({ type: 'input', inputType: 'insertText' }); return true; } } };
  return { node, commands };
}
function page(body = '## Parent\n\n- one\n- two\n\n### Child\n\nchild words\n\n## Next\n\nnext words\n') {
  const p = Object.assign(Object.create(DeckPage.prototype), { host: {}, doc: { body: {} }, list: { contains: () => true },
    base: { body }, deck: parseDeck(body), picked: 0, selected: new Set(), folded: new Set(), acts: [], undos: [],
    header: { description: {} }, readOnly: false, paint() {}, show() {}, save() {}, keepFolds() {}, holdPage: () => () => {} });
  p.open = editing => { const f = field(editing.shown ?? editing.text); p.editing = { ...editing, field: f.node, input: new WritingInput({ field: f.node, mac: true }) }; p.fieldCommands = f.commands; };
  p.write = (at = p.picked) => { p.picked = at; const card = p.deck.cards[at], text = cardText(card); p.open({ text, shown: text, near: at, depth: card.depth, fresh: false }); };
  return p;
}
function key(p, name, extra = {}) {
  const event = { key: name, target: p.editing?.field ?? p.list, preventDefault() { this.defaultPrevented = true; }, ...extra };
  p.key(event); return event;
}

const body = '## A\n\n- a **marked**\n\n[Reply stack](https://fixture.invalid/?topic=t&message=a)\n\n### A child\n\n#### A grandchild\n\n## B\n\n[b link](https://fixture.invalid/b)\n\n[Reply stack](https://fixture.invalid/?topic=t&message=b)\n\n### B child\n\n## C\n';
for (const step of [-1, 1]) test(`866 merge ${step} appends moved title and words to the destination, then undo and redo restore child order`, () => {
  const original = parseDeck(body), i = step < 0 ? 3 : 0, j = step < 0 ? 0 : 3, source = original.cards[i], target = original.cards[j];
  const done = applyAct(original, { kind: 'merge', text: cardText(source), near: i, step });
  assert.equal(done.deck.cards[0].title, target.title);
  assert.equal(done.deck.cards[0].words, [target.words, source.title, source.words].join('\n\n'));
  assert.deepEqual(done.deck.cards.map(x => x.title), step < 0 ? ['A', 'A child', 'A grandchild', 'B child', 'C'] : ['B', 'B child', 'A child', 'A grandchild', 'C']);
  const undone = applyAct(parseDeck(deckBody(done.deck)), done.undo);
  assert.equal(deckBody(undone.deck), body);
  assert.equal(deckBody(applyAct(parseDeck(deckBody(undone.deck)), undone.undo).deck), deckBody(done.deck));
});

test('866 Right at the end finishes writing, unfolds children and keeps the parent picked', () => {
  const p = page(); p.folded.add('Parent'); p.write(); p.editing.field.value += ' added'; p.editing.field.setSelectionRange(p.editing.field.value.length, p.editing.field.value.length);
  assert.equal(key(p, 'ArrowRight').defaultPrevented, true);
  assert.equal(Boolean(p.editing), false); assert.equal(p.picked, 0); assert.equal(p.folded.has('Parent'), false);
  assert.match(p.deck.cards[0].words, /added$/); assert.equal(p.layout().shown[1], true);
});
test('866 writing Tab and Shift-Tab indent lines through WritingInput without moving the card', () => {
  const p = page(); p.write(); const f = p.editing.field, original = f.value, at = f.value.indexOf('two'); f.setSelectionRange(at, at);
  assert.equal(key(p, 'Tab').defaultPrevented, true); assert.equal(f.value, original.replace('- two', '  - two'));
  assert.equal(p.deck.cards[0].depth, 0); assert.deepEqual(p.acts, []); assert.equal(f.selectionStart, at + 2);
  assert.equal(key(p, 'Tab', { shiftKey: true }).defaultPrevented, true); assert.equal(f.value, original); assert.equal(f.selectionStart, at);
  assert.deepEqual(p.fieldCommands, ['insertText', 'insertText']);
});
test('866 Shift-Command-Return finishes exactly as Escape without a fresh card', () => {
  const p = page(); p.write(); p.editing.field.value += ' kept'; key(p, 'Enter', { metaKey: true, shiftKey: true });
  assert.equal(Boolean(p.editing), false); assert.equal(p.deck.cards.length, 3); assert.match(p.deck.cards[0].words, /kept$/);
});
test('866 Option-Return finishes the current card and opens a fresh sibling directly above', () => {
  const p = page(); p.write(2); p.editing.field.value += ' kept';
  assert.equal(key(p, 'Enter', { altKey: true }).defaultPrevented, true);
  assert.equal(p.editing.fresh, true); assert.equal(p.editing.depth, 0); assert.equal(p.editing.after, 'Child\nchild words');
  assert.equal(p.editing.field.value, ''); assert.match(p.deck.cards[2].words, /kept$/);
});

for (const change of ['no children', 'unfolded', 'inside', 'selection', 'fresh', 'empty', 'shift', 'command', 'option', 'composing', 'ime229', 'prevented', 'other field']) test('866 Right stays in the writing box: '+change, () => {
  const p=page(); p.folded.add('Parent'); p.write(change==='no children'?2:0); const field=p.editing.field, extra={};
  if(change==='unfolded')p.folded.clear();
  if(change==='inside')field.setSelectionRange(3,3);
  if(change==='selection')field.setSelectionRange(0,field.value.length);
  if(change==='fresh')p.editing.fresh=true;
  if(change==='empty'){field.value='';field.setSelectionRange(0,0);}
  if(change==='shift')extra.shiftKey=true;
  if(change==='command')extra.metaKey=true;
  if(change==='option')extra.altKey=true;
  if(change==='composing')extra.isComposing=true;
  if(change==='ime229')extra.keyCode=229;
  if(change==='prevented')extra.defaultPrevented=true;
  if(change==='other field')extra.target={};
  const before=field.value;key(p,'ArrowRight',extra);
  assert.equal(Boolean(p.editing),true);assert.equal(p.editing.field,field);assert.equal(field.value,before);assert.deepEqual(p.acts,[]);
});
test('866 Right after a parent rename opens its children and retires its old fold name',()=>{
  const p=page();p.folded.add('Parent');p.write();const f=p.editing.field;f.value=f.value.replace('Parent','Renamed');f.setSelectionRange(f.value.length,f.value.length);
  key(p,'ArrowRight');assert.equal(Boolean(p.editing),false);assert.equal(p.deck.cards[0].title,'Renamed');assert.equal(p.layout().shown[1],true);assert.equal(p.folded.has('Parent'),false);
});
for(const body of ['', '## First\n', '## First\n\n### Child\n\n## Last\n'])test('866 Option-Return above handles first and empty cards '+JSON.stringify(body),()=>{
  const p=page(body);if(p.deck.cards.length)p.write();else p.open({text:'',fresh:true,after:null,depth:0,near:-1});
  const before=deckBody(p.deck);key(p,'Enter',{altKey:true});assert.equal(p.editing.fresh,true);assert.equal(p.editing.after,null);assert.equal(p.editing.depth,0);assert.equal(deckBody(p.deck),before);
  p.editing.field.value='Inserted';key(p,'Escape');assert.equal(p.deck.cards[0].title,'Inserted');
});
for(const name of ['Escape','Enter'])test('866 finishing an empty fresh box creates nothing via '+name,()=>{
  const p=page();p.open({text:'',fresh:true,after:null,depth:0,near:-1});const before=deckBody(p.deck);
  key(p,name,{metaKey:name==='Enter',shiftKey:name==='Enter'});assert.equal(Boolean(p.editing),false);assert.equal(deckBody(p.deck),before);
});
test('866 picked Tab still moves the whole card and picked merge uses the destination title',()=>{
  const p=page('## A\n\n## B\n');p.picked=1;key(p,'Tab');assert.deepEqual(p.deck.cards.map(x=>x.depth),[0,1]);
  key(p,'Tab',{shiftKey:true});assert.deepEqual(p.deck.cards.map(x=>x.depth),[0,0]);
  p.picked=0;key(p,'ArrowDown',{metaKey:true,shiftKey:true});assert.equal(p.deck.cards.length,1);assert.equal(p.deck.cards[0].title,'B');assert.equal(p.deck.cards[0].words,'A');
});
for(const [value,start,end,shift,expected,selection] of [
  ['Title\n- one\n- two\nlast',6,18,false,'Title\n  - one\n  - two\nlast',[8,22]],
  ['Title\n  - one\n  - two',8,21,true,'Title\n- one\n- two',[6,17]],
  ['  - one',1,1,true,'- one',[0,0]],
  ['\t- one',3,3,true,'- one',[2,2]],
  ['',0,0,false,'  ',[2,2]],
  ['\nlast',0,0,false,'  \nlast',[2,2]],
])test('866 shared line indentation preserves selection '+JSON.stringify([value,start,end,shift]),()=>{
  const f=field(value),input=new WritingInput({field:f.node});f.node.setSelectionRange(start,end);
  const event={key:'Tab',shiftKey:shift,preventDefault(){this.defaultPrevented=true;}};
  assert.equal(input.indentKey(event),true);assert.equal(event.defaultPrevented,true);assert.equal(f.node.value,expected);assert.deepEqual([f.node.selectionStart,f.node.selectionEnd],selection);
  f.node.value=value;f.node.dispatchEvent({type:'input',inputType:'historyUndo'});assert.deepEqual([f.node.selectionStart,f.node.selectionEnd],[start,end]);
  f.node.value=expected;f.node.dispatchEvent({type:'input',inputType:'historyRedo'});assert.deepEqual([f.node.selectionStart,f.node.selectionEnd],selection);
});
for(const change of ['outdent edge','option','readonly','surface readonly','command','composing','ime229'])test('866 Tab guards keep text and card identity: '+change,()=>{
  const p=page();p.write();const f=p.editing.field,before=f.value,extra={};
  if(change==='outdent edge')extra.shiftKey=true;
  if(change==='option')extra.altKey=true;
  if(change==='readonly')f.readOnly=true;
  if(change==='surface readonly')p.editing.input.surfaceReadOnly=()=>true;
  if(change==='command')extra.metaKey=true;
  if(change==='composing')extra.isComposing=true;
  if(change==='ime229')extra.keyCode=229;
  const event=key(p,'Tab',extra);assert.equal(f.value,before);assert.deepEqual(p.acts,[]);assert.equal(p.editing.field,f);
  assert.equal(Boolean(event.defaultPrevented),!['command','composing','ime229'].includes(change));
});
test('866 line indentation fallback still dispatches the existing save input event',()=>{
  const f=field('Title\n- item'),input=new WritingInput({field:f.node}),saved=[];f.node.ownerDocument.execCommand=()=>false;
  f.node.addEventListener('input',()=>saved.push(f.node.value));
  input.indentKey({key:'Tab',preventDefault(){}});assert.deepEqual(saved,['Title\n  - item']);
});

test('866 a moved title containing Markdown stays one plain line, with an exact undo',()=>{
  const text='## ## Literal *title*\n\n- kept **body**\n\n## Destination\n\nkept\n',deck=parseDeck(text);
  const done=applyAct(deck,{kind:'merge',text:cardText(deck.cards[0]),near:0,step:1}),roundTrip=parseDeck(deckBody(done.deck));
  assert.equal(roundTrip.cards.length,1);assert.equal(roundTrip.cards[0].title,'Destination');
  assert.equal(roundTrip.cards[0].words,'kept\n\n\\#\\# Literal \\*title\\*\n\n- kept **body**');
  assert.equal(deckBody(applyAct(roundTrip,done.undo).deck),text);
});
