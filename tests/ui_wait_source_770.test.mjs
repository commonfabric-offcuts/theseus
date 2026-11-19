import test from 'node:test';
import assert from 'node:assert/strict';
import { coverSheet, coverPills, coverKey } from '../web/dossier-cover.mjs';
import { openLinksWith } from '../web/links.mjs';
import { configureCoverAnswers } from '../web/cover-answers.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { renderer799 } from './fixtures/renderer799.mjs';
import { StackFeed } from '../web/stack-feed.mjs';
import { Reader } from '../web/reader.mjs';

const context = { viewer: 'reader', nameOf: id => id, topicId: 't1', rootId: 'root' };
const wait = more => ({ text: 'Choose a date', default: 'Keep it', ...more });
const cover = waiting => ({ owner: 'reader', stands: 'Date pending', waiting, payload: null });
const target = link => {assert.ok(link,'the waiting pill is an anchor');return new URL(link.href, 'https://fixture/').searchParams.get('message');};

test('770 each sheet wait links to message, recorded ask, or canonical root in that order', () => {
  const doc = miniDocument(), waits = [wait({message_id:'source', ask_id:'ask'}), wait({ask_id:'ask'}), wait({}), wait({message_id:null})];
  const sheet = coverSheet(doc, cover(waits), context);
  const links = sheet.querySelectorAll('a.topic-state');
  assert.deepEqual(links.map(target), ['source','ask','root','root']);
  assert.deepEqual(links.map(link=>link.text), Array(4).fill('Waits on you'));
  assert.deepEqual(sheet.querySelectorAll('.cover-note').map(node=>node.text), Array(4).fill('Default: Keep it.'));
  // Core removes inaccessible IDs; this is the exact projection shape after
  // both source fields are withheld, and therefore must open the root.
  assert.equal(target(coverSheet(doc,cover([wait({})]),context).querySelector('a.topic-state')),'root');
});

test('770 summary follows first wait and retains per-person words, choices and answer controls', async () => {
  const doc=miniDocument(), waiting=[wait({ask_id:'ask',actor_id:'reader',options:['Keep','Move'],go_ahead:true,answer_revision:0}),wait({message_id:'second',actor_id:'another'})];
  const answers=[];configureCoverAnswers(()=>({reactions:{answer:async(item,value)=>answers.push([item.id,item.reactions.answer_revision,value])},changed(){}}));
  try {
  const pills=coverPills(doc,cover(waiting),context), link=pills.querySelector('a.pill-waits');
  assert.equal(target(link),'ask');
  assert.match(link.text,/2 wait on you, another/);
  assert.match(link.title,/Options: Keep \| Move/);
  assert.ok(pills.querySelectorAll('button').length>0,'existing answer controls remain siblings, not inside the link');
  assert.equal(link.querySelectorAll('button').length,0);
  await pills.querySelectorAll('button')[0].onclick({stopPropagation(){}});
  assert.deepEqual(answers,[['ask',0,'yes']]);
  assert.notEqual(coverKey(cover(waiting),context),coverKey(cover(waiting),{...context,rootId:'joined'}));
  } finally {configureCoverAnswers(null);}
});

test('770 wait anchors use existing navigation and preserve modified clicks', () => {
  const doc=miniDocument(), link=coverSheet(doc,cover([wait({message_id:'source'})]),context).querySelector('a.topic-state'), opened=[];
  openLinksWith(route=>opened.push(route));
  try {
    assert.ok(link,'the waiting pill uses the shared anchor');
    let stopped=0,prevented=0;
    const event={button:0,stopPropagation:()=>stopped++,preventDefault:()=>prevented++};
    link.listeners.click(event);
    assert.deepEqual(opened,[{kind:'topic',id:'t1',message:'source'}]);
    assert.equal(stopped,1);assert.equal(prevented,1);
    link.listeners.click({...event,metaKey:true});
    assert.equal(opened.length,1);assert.equal(stopped,2);assert.equal(prevented,1);
  } finally {openLinksWith(null);}
});

test('770 partial feed and Reader lookup use the recorded canonical root and repaint after a join', () => {
  const r=renderer799('reader'), c=cover([wait({})]);
  const place=root=>({root_id:root,through:9,aside_revision:0,below:false,at:{messages:9,acts:2},cover:c,cover_revision:1});
  r.add([{id:'reply',seq:9,author_id:'reader',author_kind:'human',topic_id:'t1',reply_to:'root',acts:{cover:null},stack_position:place('root')}]);
  const link=()=>r.list.querySelector('a.topic-state');
  assert.equal(target(link()),'root','the loaded reply is not the fallback');
  const feed=Object.assign(Object.create(StackFeed.prototype),{list:r.list});
  assert.equal(feed.dossierCover('root')?.rootId,'root','Reader can ask by a root above the loaded page');
  r.messages.get('reply').stack_position=place('joined');r.add([]);
  assert.equal(target(link()),'joined');
  assert.equal(feed.dossierCover('joined')?.rootId,'joined');
  const prior=globalThis.document,doc=miniDocument();globalThis.document=doc;
  try {
    const reader=Object.assign(Object.create(Reader.prototype),{$:id=>doc.byId(id),callbacks:{dossierCover:()=>feed.dossierCover('joined'),actor:()=> 'reader'}});
    reader.paintCover({source_ref:{kind:'message',id:'reply'}});
    assert.equal(target(doc.byId('reader-cover').querySelector('a.topic-state')),'joined','Reader passes the same canonical fallback');
  } finally {if(prior===undefined)delete globalThis.document;else globalThis.document=prior;}
});

test('770 Reader repaint keeps active selection or restores the saved draft selection', () => {
  const previous=globalThis.document,doc=miniDocument();globalThis.document=doc;
  try {
    const field=doc.createElement('textarea');let value='Unsent reply';
    Object.defineProperty(field,'value',{get:()=>value,set:next=>{value=next;field.selectionStart=field.selectionEnd=next.length;field.selectionDirection='none';}});
    field.setSelectionRange=(start,end,direction)=>Object.assign(field,{selectionStart:start,selectionEnd:end,selectionDirection:direction});
    const draft={body:value,caret:{start:1,end:2,direction:'forward'}};
    const reader=Object.assign(Object.create(Reader.prototype),{mode:'note',field,source:{source_ref:{kind:'message'}},sessions:{note:{draft}},callbacks:{},$:id=>doc.byId(id),
      paintNoteToggle(){},paintImages(){},paintRecipients(){},paintChoice(){},paintStatus(){}});
    doc.activeElement=field;field.setSelectionRange(3,7,'backward');reader.drawEditor();
    assert.deepEqual([field.selectionStart,field.selectionEnd,field.selectionDirection],[3,7,'backward']);
    doc.activeElement=null;reader.drawEditor();
    assert.deepEqual([field.selectionStart,field.selectionEnd,field.selectionDirection],[1,2,'forward']);
    assert.equal(field.value,'Unsent reply');assert.deepEqual(draft.caret,{start:1,end:2,direction:'forward'});
  } finally {if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
