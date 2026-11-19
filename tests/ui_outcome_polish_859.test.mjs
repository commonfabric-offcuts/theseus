import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { PeoplePanel } from '../web/people.mjs';
import { AgentInvite } from '../web/agent-invite.mjs';
import { OutcomeReferences } from '../web/outcome-references.mjs';
const source=n=>readFileSync(new URL('../web/'+n,import.meta.url),'utf8');
function fixture(t) {
 const prior=globalThis.document,doc=miniDocument(),make=doc.createElement,listeners=new Map();let pointerTarget;
 doc.createElement=tag=>{const n=make(tag);n.ownerDocument=doc;n.contains=other=>other===n||[...n.descendants()].includes(other);
 Object.defineProperty(n,'parentNode',{get:()=>n.parent});n.select=()=>{};return n;};
 doc.addEventListener=(name,fn)=>{const group=listeners.get(name)||new Set();group.add(fn);listeners.set(name,group);};
 doc.removeEventListener=(name,fn)=>listeners.get(name)?.delete(fn);
 doc.emit=(name,event)=>{if(name==='pointerup')pointerTarget=event.hit??event.target;for(const fn of listeners.get(name)||[])fn(event);};
 doc.elementFromPoint=()=>pointerTarget;globalThis.document=doc;t.after(()=>{globalThis.document=prior;});
 const node=()=>doc.createElement('div'),host=node(),promptHost=node(),outside=doc.createElement('button');host.root=true;promptHost.root=true;
 let sends=0;const panel=new PeoplePanel({host,label:'Team',dismissible:true,candidates:()=>[{id:'old',name:'Existing agent'}],add(){},remove(){}});
 const invite=new AgentInvite({host:promptHost,panel,invitation:{send:async()=>{sends++;return{agent:{id:'new',name:'New'},harness:'codex',prompt:'Exact prompt'};}},workspace:()=>({id:'w',version:1})});
 panel.paint([],true);invite.paint(true);
 const press=(from,to=from,{cancel=false,hit=to,...extra}={})=>{doc.emit('pointerdown',{target:from,button:0,pointerId:1,isPrimary:true,...extra});doc.emit(cancel?'pointercancel':'pointerup',{target:to,hit,pointerId:1,...extra});doc.emit('click',{target:to});};
 return{doc,node,host,promptHost,outside,panel,invite,press,sends:()=>sends};
}
test('859 Invite is the last choice in Add, keeps one owner through repaint and leaves Team at Add',t=>{
 const f=fixture(t);f.panel.toggle(true);
 assert.equal(f.panel.choices.children.at(-1),f.invite.opener);assert.equal(f.invite.opener.text,'+ Invite');
 assert.equal(f.invite.opener.className,'choice-chip');assert.equal(f.panel.chips.children.at(-1),f.panel.opener);
 assert.equal(f.panel.row.contains(f.invite.line),true);assert.equal(f.promptHost.contains(f.invite.prompt),true);
 f.invite.opener.focus();f.panel.paintChoices();assert.equal(f.doc.activeElement,f.invite.opener);
 assert.equal(f.panel.choices.children.at(-1),f.invite.opener);assert.equal(f.sends(),0);
});
test('859 secondary name closes on an outside press, Escape and Add closure without inviting',t=>{
 const f=fixture(t);f.panel.toggle(true);f.invite.toggle(true);f.invite.input.value='A name';
 f.press(f.invite.input,f.outside);assert.equal(f.invite.line.hidden,false,'drag from name is not outside click');
 f.press(f.outside,f.invite.input);assert.equal(f.invite.line.hidden,false,'ending inside is not outside click');
 f.press(f.outside,f.outside,{cancel:true});assert.equal(f.invite.line.hidden,false);
 f.panel.input.focus();f.press(f.panel.input);
 assert.equal(f.invite.line.hidden,true);assert.equal(f.panel.row.hidden,false);assert.equal(f.doc.activeElement,f.panel.input);
 f.invite.toggle(true);f.invite.line.listeners.keydown({key:'Escape',preventDefault(){},stopPropagation(){}});
 assert.equal(f.invite.line.hidden,true);assert.equal(f.doc.activeElement,f.invite.opener);
 f.invite.toggle(true);f.panel.toggle(false);assert.equal(f.invite.line.hidden,true);
 f.panel.toggle(true);assert.equal(f.invite.line.hidden,true,'reopening Add does not resurrect the secondary form');
 assert.equal(f.sends(),0);assert.equal(f.invite.input.value,'A name');
});
test('859 closing Add preserves a completed prompt; membership loss closes the secondary form',async t=>{
 const f=fixture(t);f.panel.toggle(true);f.invite.toggle(true);f.invite.input.value='New';await f.invite.go();
 assert.equal(f.sends(),1);f.panel.toggle(false);assert.equal(f.invite.prompt.hidden,false);assert.equal(f.invite.text.textContent,'Exact prompt');
 f.invite.closePrompt();assert.equal(f.doc.activeElement,f.panel.opener,'a closed Add keeps focus out of hidden choices');
 f.invite.showPrompt({agent:{name:'New'},harness:'codex',prompt:'Exact prompt'});
 f.panel.toggle(true);f.invite.toggle(true);f.panel.paint([],false);f.invite.paint(false);
 assert.equal(f.invite.line.hidden,true);assert.equal(f.invite.prompt.hidden,false);
});
test('859 dismissing a pending invitation keeps its request and shows its completed prompt',async t=>{
 const f=fixture(t);let finish,attempts=0;
 f.invite.invitation={send:()=>{attempts++;return new Promise(resolve=>{finish=resolve;});}};
 f.panel.toggle(true);f.invite.toggle(true);f.invite.input.value='Pending';const pending=f.invite.go();
 f.outside.focus();f.press(f.outside);assert.equal(f.panel.row.hidden,true);assert.equal(f.invite.line.hidden,true);assert.equal(attempts,1);
 finish({agent:{name:'Pending'},harness:'codex',prompt:'Pending prompt'});await pending;
 assert.equal(attempts,1);assert.equal(f.invite.prompt.hidden,false);assert.equal(f.invite.text.textContent,'Pending prompt');
 f.invite.dispose();f.panel.toggle(true);assert.equal(f.panel.choices.contains(f.invite.opener),false);
 assert.equal(f.panel.row.contains(f.invite.line),false);assert.equal(f.panel.extraChoice,null);
});
test('859 a long Notebook title retains its tooltip, accessible full name and adjacent count',async t=>{
 const f=fixture(t),list=f.node(),title='A long Notebook title that should occupy only two lines in its icon cell';
 const refs=new OutcomeReferences({scope:'w',host:f.node(),list,more:f.node(),message:Object.assign(f.node(),{hidden:true}),viewPreference:{get:()=> 'cards',listen(){}},
 read:async()=>({items:[{id:'p',seq:1,title,revision:3,read_revision:1,owner_scope:{kind:'workspace',id:'w'},source_ref:{kind:'memory',id:'p',revision:3}}],next_cursor:null}),open(){},denied:()=>false});
 await refs.load();const row=list.children[0],label=row.querySelector('.notebook-document-title');
 assert.equal(label.title,title);assert.equal(label.textContent,title);assert.equal(row.getAttribute('aria-label'),title+', Cards, 2 new revisions');
 assert.equal(label.parent.children[1].textContent,'2');
 const css=source('aim.css');assert.match(css,/\.notebook-document-title\{[^}]*-webkit-line-clamp:2/);
 assert.match(css,/\.notebook-document-title\{[^}]*min-width:0/);
 assert.match(css,/\.notebook-document-label\{[^}]*align-items:flex-start/);
 assert.match(css,/\.notebook-document-label \.unread-count\{[^}]*flex:none/);
});
test('859 outcome Team shares topic header markup and rules without outcome layout overrides',()=>{
 const css=source('aim.css'),html=source('index.html'),app=source('app.mjs');
 const header=html.match(/<header class="topic-header">([\s\S]*?)<\/header>/)?.[1];assert.ok(header);
 assert.match(header,/id="outcome-team" class="topic-people"/);assert.match(header,/id="team-people" class="participants"/);
 assert.doesNotMatch(css,/\.outcome-team[\s.{:#]/);assert.doesNotMatch(css,/#team-people\s*\{/);
 assert.doesNotMatch(app,/\$\('outcome-page'\)\.append\([^;]*\$\('outcome-team'\)/);
 assert.match(app,/new AgentInvite\(\{host:\$\('team-invite'\),panel:teamPanel/);
 assert.match(app,/\$\('team-invite'\),\$\('outcome-references'\)/,'the completed prompt stays just below Team, above Notebook');
});
test('859 outcome id is hidden only there and Topics pencil follows the heading',()=>{
 const css=source('aim.css'),app=source('app.mjs');assert.match(app,/\$\('workspace-name'\)\.hidden=true/);
 assert.match(app,/\$\('workspace-name'\)\.textContent = workspace.title/,'topic eyebrow remains');
 assert.match(css,/\.selection-page #topic-navigation>\.rail-heading\{[^}]*justify-content:flex-start/);
 assert.match(css,/\.selection-page #topic-navigation>\.rail-heading h2\{[^}]*flex:none/);
});
test('859 topic cards use selected siderail colors with distinct hover and focus',()=>{
 const css=source('aim.css');
 assert.match(css,/\.outcome-topic-card\{[^}]*background:var\(--soft\)/);
 assert.match(css,/\.outcome-topic-title\{[^}]*color:var\(--accent\)/);
 assert.match(css,/\.outcome-topic-card:hover\{[^}]*border-color:var\(--accent\)/);
 assert.match(css,/\.outcome-topic-card:focus-visible\{[^}]*outline:2px solid var\(--focus\)/);
});
