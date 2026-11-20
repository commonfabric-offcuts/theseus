import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { miniDocument, matches } from './fixtures/mini_dom.mjs';
import { OutcomeTopicCards } from '../web/outcome-topic-cards.mjs';
import { OutcomeReferences } from '../web/outcome-references.mjs';
import { NotebookViews, notebookDocument } from '../web/notebook-view.mjs';
import { AgentInvite } from '../web/agent-invite.mjs';
import { panes, feedKey } from '../web/panes.mjs';

function fixture(t) {
  const previous=globalThis.document, doc=miniDocument(), make=doc.createElement;
  doc.defaultView={innerWidth:1400,innerHeight:900,getComputedStyle:()=>({}),scrollBy(){}};
  doc.createElement=tag=>{
    const n=make(tag);n.ownerDocument=doc;
    n.contains=other=>{for(let at=other;at;at=at.parent)if(at===n)return true;return false;};
    n.matches=selector=>selector.split(',').some(part=>{
      if(part.trim()==='#main h1')return false;
      const values=[...part.matchAll(/\[([\w-]+)="([^"]*)"\]/g)];
      return values.every(([,key,value])=>n.getAttribute(key)===value) && matches(n,part.replace(/\[([\w-]+)="[^"]*"\]/g,'[$1]'));
    });
    n.closest=selector=>{for(let at=n;at;at=at.parent)if(at.matches(selector))return at;return null;};
    n.checkVisibility=()=>!n.hidden;n.getBoundingClientRect=()=>({top:100,bottom:200,left:200,right:500,width:300,height:100});
    return n;
  };
  doc.body=doc.createElement('body');doc.body.root=true;doc.documentElement=doc.body;
  doc.getElementById=id=>doc.body.querySelector('#'+id);doc.querySelector=s=>s.startsWith('#main >')?null:doc.body.querySelector(s);doc.addEventListener=()=>{};
  globalThis.document=doc;t.after(()=>{globalThis.document=previous;});
  const main=doc.createElement('main');main.id='main';const host=doc.createElement('div');main.append(host);doc.body.append(main);
  const cards=new OutcomeTopicCards({host}), opened=[];
  const paint=(ids=['a','b','c'])=>cards.paint({reader:'reader',groups:[{name:'active',rows:ids.map(id=>({href:'?topic='+id,activate:()=>opened.push(id),item:{id,title:id,message_count:0}}))}]});
  paint();return{doc,main,host,cards,opened,paint};
}

test('852 actual pane keys land on the first topic, traverse cards and preserve both rail round trips', t=>{
  const f=fixture(t), kept={center:panes.center,outline:panes.outline,things:panes.things};t.after(()=>Object.assign(panes,kept));
  panes.center=()=>f.cards;
  f.host.getBoundingClientRect=()=>({top:1100,bottom:1500,left:200,right:500,width:300,height:400});
  for(const name of ['outline','things']){const host=f.doc.createElement('aside'),button=f.doc.createElement('button');host.append(button);f.doc.body.append(host);panes[name]={host,focus(){button.focus();return true;}};}
  const press=key=>{const e={key,target:f.doc.activeElement,preventDefault(){this.defaultPrevented=true;}};const result=feedKey(e,f.doc);return{result,e};};
  for(const key of ['ArrowUp','ArrowDown']){f.doc.activeElement=f.doc.body;assert.equal(press(key).result,true);assert.equal(f.doc.activeElement.dataset.topicId,'a');}
  assert.equal(press('ArrowDown').result,true);assert.equal(f.doc.activeElement.dataset.topicId,'b');
  f.doc.activeElement.onclick({});assert.deepEqual(f.opened,['b']);
  for(const [name,out,back] of [['outline','ArrowLeft','right'],['things','ArrowRight','left']]){
    assert.equal(press(out).result,true);assert.equal(panes[name].host.contains(f.doc.activeElement),true);
    assert.equal(panes.step(name,back,f.doc),true);assert.equal(f.doc.activeElement.dataset.topicId,'b');
  }
  assert.equal(press('End').result,true);assert.equal(f.doc.activeElement.dataset.topicId,'c');
  f.paint(['c','a']);assert.equal(press('ArrowDown').result,true);assert.equal(f.doc.activeElement.dataset.topicId,'a');
});

test('852 pane card movement respects writing, dialogs, modifiers, empty lists and page lifetime', t=>{
  const f=fixture(t), prior=panes.center,write=panes.write;t.after(()=>{panes.center=prior;panes.write=write;});panes.center=()=>f.cards;
  const press=extra=>feedKey({key:'ArrowDown',target:f.doc.activeElement,preventDefault(){},...extra},f.doc);
  const input=f.doc.createElement('input');f.host.append(input);input.focus();assert.equal(press(),false);
  f.doc.activeElement=f.doc.body;assert.equal(press({metaKey:true}),false);assert.equal(press({shiftKey:true}),false);
  const dialog=f.doc.createElement('dialog');dialog.setAttribute('open','');f.doc.body.append(dialog);assert.equal(press(),false);
  dialog.classList.add('notebook-docked');assert.equal(press(),true,'a docked Notebook leaves the feed keys available');
  const modal=f.doc.createElement('dialog');modal.setAttribute('open','');f.doc.body.append(modal);assert.equal(press(),false,'another dialog still owns its keys');modal.remove();dialog.remove();
  f.doc.body.append(dialog);const notebookButton=f.doc.createElement('button');dialog.append(notebookButton);notebookButton.focus();
  let notebookWrites=0;panes.write=()=>{notebookWrites++;return true;};assert.equal(press({key:'Enter',metaKey:true}),false,'Notebook keys must not start a feed message');assert.equal(notebookWrites,0);dialog.remove();f.doc.activeElement=f.doc.body;
  let written=0;panes.write=()=>{written++;return true;};assert.equal(press({key:'Enter',metaKey:true}),true);assert.equal(written,1);
  f.host.hidden=true;assert.equal(press(),false);f.host.hidden=false;
  f.paint([]);assert.equal(press(),false);f.paint();panes.center=()=>null;assert.equal(press(),false);
});

test('852 Notebook titles hold their count beside them, icons carry the mode, and Invite shares Add label markup', async t=>{
  const {doc}=fixture(t),node=()=>doc.createElement('div'),list=node(),views=new NotebookViews({instance_id:'i',actor:'a'},null);
  const refs=new OutcomeReferences({scope:'w',host:node(),list,more:node(),message:Object.assign(node(),{hidden:true}),viewPreference:views,
    read:async()=>({items:[{id:'p',seq:1,title:'Notes',revision:4,read_revision:2,owner_scope:{kind:'workspace',id:'w'},source_ref:{kind:'memory',id:'p',revision:4}}],next_cursor:null}),open(){},denied:()=>false});
  await refs.load();const row=list.children[0],line=row.querySelector('.notebook-document-label');
  assert.ok(line);assert.equal(line.querySelector('.notebook-document-title').textContent,'Notes');assert.equal(line.querySelector('.unread-count').textContent,'2');
  assert.equal(row.querySelector('.notebook-document-view'),null);assert.equal(row.getAttribute('aria-label'),'Notes, Cards, 2 new revisions');
  const picture=notebookDocument('cards',doc);assert.equal(picture.children.length,1);assert.equal(picture.children[0].getAttribute('data-glyph'),'stack');assert.equal(notebookDocument('text',doc).children.length,4);
  views.set('p','text');assert.equal(row.getAttribute('aria-label'),'Notes, Text, 2 new revisions');assert.equal(row.querySelector('.notebook-document').dataset.mode,'text');
  const invite=new AgentInvite({host:node(),invitation:{},workspace:()=>({id:'w'})});assert.equal(invite.opener.querySelector('span').textContent,'+ Invite agent');
});

test('852 page wiring shares center-pane routing, Team placement, heading and pencil intent',()=>{
  const source=n=>readFileSync(new URL('../web/'+n,import.meta.url),'utf8'),app=source('app.mjs'),css=source('aim.css'),html=source('index.html');
  assert.match(app,/centerPane: topicCards/);assert.match(source('rails.mjs'),/panes.center = \(\) => shell.handles\?\.centerPane/);
  assert.match(html,/<header class="topic-header">[\s\S]*?id="outcome-team" class="topic-people"[\s\S]*?<\/header>/);
  assert.doesNotMatch(css,/\.outcome-team\.topic-people\{[^}]*justify-content:flex-start/);
  assert.doesNotMatch(html,/id="notebook-heading">Outcome Notebook/);
  assert.match(app,/new-topic.*setAttribute\('aria-label', 'New topic'\)/);
  assert.match(css,/#topics-heading\{[^}]*text-transform:none/);
  assert.match(css,/\.notebook-document\[data-mode=cards\]/);
});
