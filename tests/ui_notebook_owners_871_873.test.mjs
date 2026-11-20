import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { notebookFixture } from './fixtures/notebook_sheet_dom.mjs';
import { NotebookPage } from '../web/notebook-page.mjs';
import { InlineComposer } from '../web/inline-composer.mjs';
import { openMessageMenu } from '../web/message-menu.mjs';
import { shareLinksFrom } from '../web/links.mjs';
import { glyph } from '../web/glyphs.mjs';
import { APPROVED } from './menu_glyphs.mjs';
import { DRAFT_TIP } from '../web/topic-navigation.mjs';

const event=(target,key)=>({target,key,preventDefault(){this.defaultPrevented=true;},stopPropagation(){}});
const item=(page,label)=>{const found=NotebookPage.prototype.menuItems.call(page).find(x=>x.label===label);assert.ok(found,`menu offers ${label}`);return found;};
function menuPage(f) {
  const p=f.page,source={owner_scope:{kind:'topic',id:'t-fixture'},source_ref:{kind:'memory_item',id:'p-fixture',revision:2}};
  p.doc=f.doc;p.node=(tag,cl='',text='')=>Object.assign(f.doc.createElement(tag),{className:cl,textContent:text});
  p.writing={pageState:{starred:false,reader_may_delete:true},base:{source},value:{draft:true},closed:false};
  p.readOnly=false;p.drafted=NotebookPage.prototype.drafted;p.copyLink=NotebookPage.prototype.copyLink;
  return p;
}

test('871 dedicated Notebook dialog leaves the sole message composer and pencil display predicate intact',async t=>{
  const f=notebookFixture(t);await f.sheet.open('p');
  assert.ok(f.sheet.dialog!==f.dialog,'Notebook must not borrow New message');
  assert.equal(f.doc.getElementById('inline-composer').hidden,false,'existing pencil display rule still admits it');
  assert.equal(f.dialog.open,false);assert.equal(f.sheet.dialog.open,true);
  assert.equal(f.sheet.dialog.id,'notebook-sheet-dialog');assert.equal(f.sheet.docked,true);
  assert.equal([...f.doc.body.descendants()].filter(n=>n.id==='inline-composer').length,1);
});

test('871 default dock, Wide preference, resize and close retain one page and unsaved writing',async t=>{
  const f=notebookFixture(t);await f.sheet.open('p');
  const edit=f.doc.createElement('textarea');edit.value='Exact unsaved card';f.page.host.append(edit);f.page.editing={field:edit};f.page.host.scrollTop=421;
  assert.equal(f.sheet.docked,true,'eligible opening defaults beside Dossiers');
  assert.equal(f.sheet.dockButton.title,'Wide');f.sheet.dockButton.onclick();
  assert.equal(f.sheet.docked,false);assert.equal(f.sheet.dockButton.title,'Open with Dossiers');assert.equal(f.storage.get('notebook-docked'),'false');
  f.sheet.close();await f.sheet.open('p');assert.equal(f.sheet.docked,false);assert.equal(f.page.host.scrollTop,421);
  f.sheet.dockButton.onclick();f.media.matches=false;f.media.changed();assert.equal(f.sheet.docked,false);
  f.media.matches=true;f.media.changed();assert.equal(f.sheet.docked,true);assert.ok(f.sheet.current===f.page);assert.equal(edit.value,'Exact unsaved card');
  f.sheet.closer.onclick();assert.equal(f.sheet.showing,false,'docked Close must dismiss, not undock');assert.equal(f.sheet.dialog.open,false);
  assert.equal(f.doc.body.classList.contains('notebook-docked'),false);assert.equal(f.sheet.closer.title,'Close, keeping your writing');
  await f.sheet.open('p');f.emit('keydown',event(edit,'Escape'));assert.equal(f.sheet.showing,false);assert.equal(edit.value,'Exact unsaved card');
});
for(const options of [{wide:false},{feed:false},{storage:new Map([['notebook-docked','false']])}])test('871 narrow/non-topic/explicit Wide stays modal '+JSON.stringify(options),async t=>{
  const f=notebookFixture(t,options);await f.sheet.open('p');assert.equal(f.sheet.docked,false);assert.equal(f.calls.at(-1),'modal');
});

test('871 docked Escape from the feed leaves Notebook showing and does not consume the key',async t=>{
  const f=notebookFixture(t);await f.sheet.open('p');
  const feedField=f.doc.createElement('textarea');f.doc.body.append(feedField);
  const escape=event(feedField,'Escape');f.emit('keydown',escape);
  assert.equal(f.sheet.showing,true,'Escape in the adjacent feed must leave the docked Notebook showing');
  assert.equal(f.sheet.dialog.open,true);assert.equal(f.sheet.docked,true);
  assert.equal(escape.defaultPrevented,undefined,'the feed keeps its Escape');
});

test('871 docked Escape inside Notebook closes it keeping its page and exact writing',async t=>{
  const f=notebookFixture(t);await f.sheet.open('p');
  const edit=f.doc.createElement('textarea');edit.value='Exact unsaved card\nsecond line';f.page.host.append(edit);f.page.editing={field:edit};
  const escape=event(edit,'Escape');f.emit('keydown',escape);
  assert.equal(escape.defaultPrevented,true);assert.equal(f.sheet.showing,false);assert.equal(f.sheet.dialog.open,false);
  assert.ok(f.sheet.current===f.page);assert.ok(f.page.editing.field===edit);assert.equal(edit.value,'Exact unsaved card\nsecond line');
  await f.sheet.open('p');assert.ok(f.sheet.current===f.page);assert.equal(edit.value,'Exact unsaved card\nsecond line');
});

test('871 modal Escape still closes Notebook with a target outside its dialog',async t=>{
  const f=notebookFixture(t,{wide:false});await f.sheet.open('p');
  const escape=event(f.doc.body,'Escape');f.emit('keydown',escape);
  assert.equal(escape.defaultPrevented,true);assert.equal(f.sheet.showing,false);assert.equal(f.sheet.dialog.open,false);
});

test('871 actual composer pop, close and confirmed send preserve docked page, scroll and editing',async t=>{
  const f=notebookFixture(t);await f.sheet.open('p');f.sheet.setDocked(true);
  const field=f.doc.createElement('textarea');field.value='Message';f.doc.getElementById('inline-composer').append(field);
  const edit=f.doc.createElement('textarea');edit.value='Notebook draft';f.page.host.append(edit);f.page.editing={field:edit};f.page.host.scrollTop=312;
  const composer={sheet:f.dialog,root:f.doc.getElementById('inline-composer'),field,bar:{fit(){},fold(){},holdSend:()=>false},naming:{sheet:{open:false}},
    editor:{draft:{body:'Message',addressees:[],attachments:[],whisper:false},context:{kind:'new'},localVersion:1,clientCycleId:'cycle',edit(){}},
    admits:()=>true,state:()=>({sendDisabled:false}),names:()=>[],kindOf:()=>null,callbacks:{send:async()=>({status:'confirmed'})},notice(error){throw error;}};
  InlineComposer.prototype.pop.call(composer);assert.equal(f.dialog.open,true,'pencil opens existing New message');
  const escape=event(field,'Escape');f.emit('keydown',escape);assert.equal(escape.defaultPrevented,undefined,'Notebook yields Escape to message modal');
  f.dialog.close();assert.equal(f.sheet.dialog.open,true);assert.equal(f.sheet.docked,true);
  InlineComposer.prototype.pop.call(composer);await InlineComposer.prototype.send.call(composer);assert.equal(f.dialog.open,false);
  assert.equal(f.sheet.dialog.open,true);assert.equal(f.sheet.docked,true);assert.ok(f.sheet.current===f.page);assert.equal(f.page.host.scrollTop,312);assert.equal(edit.value,'Notebook draft');
});

test('873 only page menu joins fixed title controls; toolbar and Add image leave scroller, notices remain',async t=>{
  const f=notebookFixture(t);await f.sheet.open('p');
  const head=f.sheet.title.parent;
  assert.equal(head.children.length,5,'title row includes the page menu');
  assert.ok(head.children.every((n,i)=>n===[f.sheet.title,f.page.more,f.sheet.dockButton,f.sheet.full,f.sheet.closer][i]));
  assert.equal(f.page.host.querySelector('.notebook-sheet-toolbar'),null);assert.equal(f.page.views.isConnected,false);assert.equal(f.page.draft.isConnected,false);
  assert.equal(f.page.addImage.isConnected,false);assert.ok(f.sheet.status.children[0]===f.page.status);
  assert.ok(f.page.host.children[0]===f.sheet.status);assert.ok(f.page.host.contains(f.page.pageNotice));
  f.page.status.textContent='Could not save. Retry';f.page.pageNotice.textContent='Action refused';
  f.sheet.close();await f.sheet.open('p');assert.equal(f.page.status.textContent,'Could not save. Retry');assert.equal(f.page.pageNotice.textContent,'Action refused');
});

test('873 common menu orders checked views, described Draft, sheet choices and existing acts',async t=>{
  const f=notebookFixture(t);await f.sheet.open('p');f.sheet.setDocked(true);const p=menuPage(f),acts=[];
  p.switchView=mode=>{acts.push(['view',mode]);p.mode=mode;};p.markDraft=value=>{acts.push(['draft',value]);p.writing.value.draft=value;};
  p.addImage.onclick=()=>acts.push(['image']);p.rename=()=>acts.push(['rename']);p.pageAction=(...args)=>acts.push(args);f.doc.defaultView.confirm=()=>true;
  let menu=NotebookPage.prototype.menuItems.call(p);
  assert.deepEqual(menu.map(x=>x.label),['Show as text','Show as cards','Draft','Choose dossier…','Add image…','Wide','Star','Rename','Delete','Copy Link']);
  assert.deepEqual(menu.slice(0,3).map(x=>x.checked),[false,true,true]);assert.equal(item(p,'Draft').description,DRAFT_TIP);
  item(p,'Show as text').act();assert.equal(item(p,'Show as text').checked,true);item(p,'Draft').act();item(p,'Add image…').act();
  item(p,'Star').act();item(p,'Rename').act();item(p,'Delete').act();
  assert.deepEqual(acts,[['view','text'],['draft',false],['image'],['memory.star',{starred:true}],['rename'],['memory.delete',{deleted:true}]]);
  item(p,'Choose dossier…').act();assert.equal(f.sheet.dossiers.showing,true);assert.ok(f.sheet.dossiers.anchor===p.more);
  item(p,'Wide').act();menu=NotebookPage.prototype.menuItems.call(p);assert.ok(!menu.some(x=>x.label==='Choose dossier…'));assert.ok(item(p,'Open with Dossiers'));
});

test('873 read-only/deleted menu and disabled shared-menu keyboard preserve Draft without a write',async t=>{
  const f=notebookFixture(t),p=menuPage(f);p.readOnly=true;let writes=0;p.markDraft=()=>writes++;p.addImage.onclick=()=>writes++;
  assert.equal(item(p,'Draft').checked,true);assert.equal(item(p,'Draft').disabled,true);assert.equal(item(p,'Add image…').disabled,true);
  item(p,'Draft').act();item(p,'Add image…').act();assert.equal(writes,0,'stale direct actions also enforce read-only');
  f.doc.body.append(p.more);const menu=openMessageMenu({anchor:p.more,doc:f.doc,win:{innerWidth:1000,innerHeight:1000},items:[
    {label:'Draft',glyph:'star',checked:true,disabled:true,description:DRAFT_TIP,act:()=>writes++},
    {label:'Enabled',glyph:'link',act:()=>{}}]});
  t.after(()=>menu.close(false));assert.equal(menu.root.children[0].disabled,true);assert.ok(f.doc.activeElement===menu.root.children[1]);
  menu.root.children[0].onclick(event(p.more));assert.equal(writes,0);assert.equal(menu.root.isConnected,true);
  menu.root.listeners.keydown(event(f.doc.activeElement,'Home'));assert.ok(f.doc.activeElement===menu.root.children[1]);
  p.writing.deleted=true;assert.deepEqual(NotebookPage.prototype.menuItems.call(p).map(x=>x.label),['Undo delete']);
});

test('873 Copy Link uses canonical page identity, preserves errors, reports refusal and ignores late closed writer',async t=>{
  const f=notebookFixture(t),p=menuPage(f),copied=[];shareLinksFrom('https://fixture.example');t.after(()=>shareLinksFrom(null));
  p.pageNotice.append(p.node('p','','Existing action error'));
  f.set('navigator',{clipboard:{writeText:async text=>copied.push(text)}});
  await item(p,'Copy Link').act();assert.equal(copied[0],'https://fixture.example/?topic=t-fixture&page=p-fixture');
  assert.match(p.pageNotice.text,/Existing action error/);assert.match(p.pageNotice.text,/Link copied/);
  globalThis.navigator.clipboard.writeText=async()=>{throw Error('denied');};await item(p,'Copy Link').act();assert.match(p.pageNotice.text,/Could not copy/);assert.match(p.pageNotice.text,/https:\/\/fixture.example/);
  let finish;globalThis.navigator.clipboard.writeText=()=>new Promise(resolve=>finish=resolve);
  const before=p.pageNotice.text,pending=item(p,'Copy Link').act();p.writing.closed=true;finish();await pending;assert.equal(p.pageNotice.text,before);
});

test('871 CSS confines New message to the docked feed column and gives Notebook its own dialog rule',()=>{
  const css=readFileSync(new URL('../web/aim.css',import.meta.url),'utf8');
  assert.ok(/dialog\.notebook-sheet-dialog\.notebook-docked\[open\]/.test(css),'dedicated Notebook dock CSS');
  const rule=css.match(/body\.notebook-docked #new-message-sheet\[open\]\[data-width-edges\]\{([^}]+)\}/)?.[1];assert.ok(rule,'late width rule owns feed-column message placement');
  assert.match(rule,/inset:auto auto 1\.5rem 19rem/);assert.match(rule,/width:min\(var\(--composer-width/);assert.match(rule,/max-width:calc\(\(100vw - 18rem\)\/2 - 2rem\)/);
});


test('873 menu Draft uses the same captured revision and Undo owner as its old toggle',t=>{
  const f=notebookFixture(t),p=menuPage(f),edits=[];p.mode='cards';p.undos=[];
  p.textSeen={revision:2,content:{body:'Text',draft:true}};p.cardsSeen={revision:2,content:{body:'Card',draft:true}};
  p.markDraft=NotebookPage.prototype.markDraft;
  p.writing.edit=(change,seen,mode)=>{edits.push({change,revision:seen.revision,body:seen.content.body,mode});Object.assign(p.writing.value,change);return true;};
  item(p,'Draft').act();assert.deepEqual(edits,[{change:{draft:false},revision:2,body:'Card',mode:'cards'}]);
  assert.deepEqual(p.undos,[{kind:'draft',draft:true}]);assert.equal(p.textSeen.content.draft,false);assert.equal(p.cardsSeen.content.draft,false);
  NotebookPage.prototype.undo.call(p);assert.equal(p.drafted(),true);assert.equal(p.undos.length,0);
});

test('871 retirement removes only Notebook and closing a docked page preserves moved feed position',async t=>{
  const f=notebookFixture(t);await f.sheet.open('p');let scrolls=0;f.set('scrollTo',()=>scrolls++);globalThis.scrollY=900;
  f.sheet.close();assert.equal(scrolls,0);await f.sheet.open('p');f.dialog.showModal();
  f.sheet.retire();assert.equal(f.sheet.dialog.isConnected,false);assert.equal(f.dialog.open,true);assert.equal(f.doc.getElementById('inline-composer').hidden,false);
});

test('873 menu glyphs keep the chosen card drawing and draw the four new meanings',t=>{
  const f=notebookFixture(t),p=menuPage(f);
  for(const [label,name] of [['Show as text','text'],['Show as cards','stack'],['Draft','draft'],['Add image…','image']])assert.equal(item(p,label).glyph,name);
  for(const name of ['text','draft','image','dossier']){
    const drawing=glyph(name,f.doc);assert.equal(drawing.getAttribute('aria-hidden'),'true');assert.equal(drawing.children[0].getAttribute('d'),APPROVED[name].d);assert.ok(APPROVED[name].d.length>15);
  }
});
