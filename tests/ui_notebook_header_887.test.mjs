import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { notebookFixture } from './fixtures/notebook_sheet_dom.mjs';
import { NotebookPage, notebookMenuItems } from '../web/notebook-page.mjs';
import { NotebookWriting } from '../web/notebook-writing.mjs';
import { DeckPage } from '../web/deck-page.mjs';

const css=readFileSync(new URL('../web/aim.css',import.meta.url),'utf8');

// Real sheet/menu/status handlers, memory-only page action ports. No native/layout claim.
async function fixture(t, options={}) {
  const f=notebookFixture(t,options), p=f.page, acts=[];
  p.doc=f.doc;p.node=(tag,cl='',text='')=>Object.assign(f.doc.createElement(tag),{className:cl,textContent:text});
  p.writing={base:{revision:2},pageState:{starred:false,reader_may_delete:true},value:{draft:false},images:[]};
  p.readOnly=false;p.undos=[{}];p.drafted=()=>false;p.menuItems=()=>notebookMenuItems(p);
  p.rename=()=>acts.push('rename');p.pageAction=(...args)=>acts.push(args);
  p.edit=()=>{acts.push('edit');p.editing={};};p.finish=()=>{acts.push('done');p.editing=null;};
  p.start=()=>acts.push('new');p.undo=()=>acts.push('undo');p.show=()=>acts.push('focus');
  p.bar=p.node('div','deck-bar');p.count=p.node('span','deck-count','2 cards');p.bar.append(p.count,p.node('button','','Edit'),p.node('button','','New card'),p.node('button','','Undo'));
  p.say=(...args)=>NotebookPage.prototype.say.call(p,...args);
  await f.sheet.open('p');p.host.append(p.bar);f.sheet.show(p);acts.length=0;
  return {...f,p,acts};
}
const choice=(p,key)=>p.menuItems().find(x=>x.key===key);
const savedTime=s=>{const time=s.saved.querySelector('time');assert.ok(time,'last confirmed save time remains');return time.dataset.ms;};

test('887 title and action order; header has no pop-out and the card count stays',async t=>{
  const {sheet:s,p}=await fixture(t);
  assert.ok(s.heading);assert.equal(s.heading.children.length,4);assert.ok(s.heading.children.every((n,i)=>n===[s.title,s.saved,s.renameButton,s.starButton][i]));
  assert.ok(s.actions);assert.equal(s.actions.children.length,4);assert.ok(s.actions.children.every((n,i)=>n===[s.newButton,s.dockButton,p.more,s.closer][i]));
  assert.equal(s.head.querySelector('a'),null);
  assert.equal(p.bar.children.length,1);assert.ok(p.bar.children[0]===p.count);assert.equal(p.count.textContent,'2 cards');
  assert.match(s.newButton.title,/Return/);assert.equal(s.newButton.hidden,false);
});
test('887 title Rename and stateful star delegate to current page menu, including read-only and pending states',async t=>{
  const {sheet:s,p,acts}=await fixture(t);
  s.renameButton.onclick();s.starButton.onclick();assert.deepEqual(acts,['rename',['memory.star',{starred:true}]]);
  p.writing.pageState.starred=true;s.paintHeader(p);
  assert.equal(s.starButton.getAttribute('aria-pressed'),'true');assert.equal(s.starButton.title,'Unstar');
  s.starButton.onclick();assert.deepEqual(acts.at(-1),['memory.star',{starred:false}]);
  p.readOnly=true;s.paintHeader(p);assert.equal(s.renameButton.hidden,true);assert.equal(s.newButton.hidden,true);
  s.renameButton.onclick();assert.equal(acts.filter(x=>x==='rename').length,1);
  p.writing.actionPending={};s.paintHeader(p);assert.equal(s.starButton.disabled,true);s.starButton.onclick();assert.equal(acts.length,3);
});
test('887 Cards menu owns Edit/Done and Undo; no New card menu row; full-page follows layout even on phone',async t=>{
  const {sheet:s,p,acts}=await fixture(t,{wide:false});
  assert.deepEqual(p.menuItems().slice(0,2).map(x=>[x.key,x.label,x.keys]),[['edit','Edit','⌘Return'],['undo','Undo','⌘Z']]);
  assert.equal(choice(p,'new'),undefined);assert.ok(choice(p,'fullpage'));assert.equal(choice(p,'layout'),undefined);
  choice(p,'edit').act();assert.equal(choice(p,'edit').label,'Done');choice(p,'edit').act();choice(p,'undo').act();s.newButton.onclick();
  assert.deepEqual(acts.filter(x=>x!=='focus'),['edit','done','undo','new']);
  p.mode='text';s.paintHeader(p);assert.equal(s.newButton.hidden,true);assert.equal(choice(p,'edit'),undefined);assert.equal(choice(p,'undo'),undefined);
  s.newButton.onclick();assert.equal(acts.filter(x=>x==='new').length,1);
});
test('887 stale card menu cannot write after permission loss, view switch, writer close or page replacement',async t=>{
  const {sheet:s,p,acts}=await fixture(t);const edit=choice(p,'edit'),undo=choice(p,'undo');assert.ok(edit&&undo,'card actions present');
  for(const change of [()=>p.readOnly=true,()=>{p.readOnly=false;p.mode='text';},()=>{p.mode='cards';p.writing.closed=true;},()=>{p.writing.closed=false;s.current={};}]) {
    change();edit.act();undo.act();
  }
  assert.deepEqual(acts,[]);s.current=p;
});
test('887 confirmed save dot keeps its time across saving/repaints; refusal removes dot and Retry stays live',async t=>{
  const {sheet:s,p,acts}=await fixture(t);
  const realNow=Date.now;let now=1000;Date.now=()=>now;t.after(()=>{Date.now=realNow;});
  p.say('Saved to Theseus','saved');now=2000;
  assert.equal(s.saved.getAttribute('role'),'status');assert.ok(s.saved.querySelector('[data-save="saved"]'),'confirmed save has a dot');assert.equal(s.saved.querySelector('[data-save="saved"]').getAttribute('role'),'img');
  const time=s.saved.querySelector('time'),stamp=time.dataset.ms;
  assert.match(s.saved.querySelector('[data-save="saved"]').getAttribute('aria-label'),/^Saved at /);
  assert.equal(p.status.text,'');assert.equal(s.saved.text.includes('Saved to Theseus'),false);
  p.say('Saving…','saving');assert.ok(s.saved.querySelector('[data-save="saving"]'));assert.equal(savedTime(s),stamp);
  p.say('Saved to Theseus','saved');assert.equal(savedTime(s),stamp);
  p.say('Permission refused. Words kept.','attention',()=>acts.push('retry'));
  assert.equal(s.saved.querySelector('[data-save]'),null);assert.match(p.status.text,/Permission refused/);assert.ok(p.status.querySelector('[data-save="attention"]'),'recovery keeps its wrapping status style');
  assert.ok(p.status.querySelector('button'),'retry button remains');p.status.querySelector('button').onclick();assert.equal(acts.at(-1),'retry');
  p.writing.base.revision=3;now=3000;p.say('Saved to Theseus','saved');assert.equal(savedTime(s),'3000');assert.ok(s.saved.querySelector('[data-save="saved"]'));assert.equal(p.status.text,'');
});
test('887 initial/unconfirmed state has no green dot, while saving retains an accessible status',async t=>{
  const {sheet:s,p}=await fixture(t);
  p.say('Reading…');assert.equal(s.saved.querySelector('[data-save="saved"]'),null);
  p.writing.base=null;p.say('Saving…','saving');assert.equal(s.saved.querySelector('time'),null);assert.ok(s.saved.querySelector('[data-save="saving"]'));
  p.say('Not saved','attention');assert.equal(s.saved.querySelector('[data-save]'),null);
});
test('887 a departing page save cannot overwrite the current page header',async t=>{
  const {sheet:s,p}=await fixture(t);p.say('Saved to Theseus','saved');const before=s.saved.text;
  s.current={};p.say('Old page failed','attention');assert.equal(s.saved.text,before);s.current=p;
});
test('887 full Notebook page keeps its normal status words and menu',async t=>{
  const {p}=await fixture(t);delete p.presentStatus;delete p.menuExtras;
  p.say('Saved to Theseus','saved');assert.match(p.status.text,/Saved to Theseus/);assert.ok(p.status.querySelector('time'));
  assert.equal(choice(p,'edit'),undefined);assert.equal(choice(p,'fullpage'),undefined);
  const doc=p.doc,host=p.node('div'),header={title:p.node('span'),description:p.node('span'),eyebrow:p.node('span')};
  const full=new DeckPage({doc,host,header,item:'full'});assert.deepEqual(full.bar.children.slice(1).map(n=>n.textContent),['Edit','New card','Undo']);full.listening.abort();
});
test('887 docked frame removes border while retaining both-theme shared inset and phone time',()=>{

  assert.match(css,/dialog\.notebook-sheet-dialog\.notebook-docked\[open\]\{[^}]*border:0/);
  assert.match(css,/dialog\.notebook-sheet-dialog\[open\]\{[^}]*box-shadow:var\(--stack-cover-inset\)/);
  assert.doesNotMatch(css,/@container[^}]*\.save-time\{display:none/);
  assert.ok(css.includes('.notebook-sheet-status .deck-status>span::before{display:none}'),'no dot on failure');
});

test('887 actual Notebook writer drives grey, failure and retry to green without losing writing or retry identity',async t=>{
  const {sheet:s,p}=await fixture(t);
  p.holdPage=()=>()=>{};p.paintDraft=()=>{};p.paintImages=()=>{};p.paintPageState=()=>{};
  p.list=p.node('ol');p.conflictPanel=p.node('section');p.revisionShown=()=>s.revised(p);
  let fail=true,held=null;const calls=[];
  const source={instance_id:'i',source_ref:{kind:'memory',id:'p',revision:1},owner_scope:{kind:'topic',id:'t'},
    title:'Notes',body:'## First',attachments:[],references:[],reader_may_write:true,starred:false};
  const w=new NotebookWriting({item:'p',bootstrap:{instance_id:'i',actor:'reader',authority:{authority_id:'a',authority_epoch:'e'}},
    store:{get:async()=>null,put:async value=>{held=structuredClone(value);}},delay:60000,
    api:{view:async()=>structuredClone(source),command:async envelope=>{
      assert.deepEqual(held.pending,envelope);calls.push(structuredClone(envelope));
      if(fail)throw Error('Connection lost');
      return {instance_id:'i',kind:envelope.kind,operation_id:envelope.operation_id,recorded:true,status:'committed',
        result:{item_id:'p',revision:2,source_ref:{kind:'memory',id:'p',revision:2}}};
    }},changed:()=>NotebookPage.prototype.writingChanged.call(p)});
  p.writing=w;t.after(()=>w.close());delete p.lastSavedAt;delete p.lastSavedRevision;
  await w.open();assert.ok(s.saved.querySelector('[data-save="saved"]'));
  const stamp=savedTime(s);
  w.edit({body:'## First\n\nExact new words'},w.capture());assert.ok(s.saved.querySelector('[data-save="saving"]'));
  assert.equal(savedTime(s),stamp);
  await w.flush();assert.equal(s.saved.querySelector('[data-save]'),null);assert.match(p.status.text,/Connection lost/);
  assert.equal(w.value.body,'## First\n\nExact new words');fail=false;
  assert.ok(p.status.querySelector('button'),'writer Retry button remains');await p.status.querySelector('button').onclick();assert.ok(s.saved.querySelector('[data-save="saved"]'));
  assert.equal(w.dirty,false);assert.equal(w.base.content.body,w.value.body);assert.equal(calls[1].operation_id,calls[0].operation_id);
});
test('887 actual view and writer notification hooks repaint header affordances',async t=>{
  const {sheet:s,p}=await fixture(t);
  p.textPanel=p.node('div');p.list=p.node('ol');p.keys=p.node('p');p.opening=p.node('div');p.deck={opening:''};p.viewButtons=[p.node('button'),p.node('button')];
  p.mode='text';NotebookPage.prototype.drawView.call(p);assert.equal(s.newButton.hidden,true);
  p.mode='cards';NotebookPage.prototype.drawView.call(p);assert.equal(s.newButton.hidden,false);
  p.writing.pageState.starred=true;s.revised(p);assert.equal(s.starButton.getAttribute('aria-pressed'),'true');
  p.readOnly=true;s.revised(p);assert.equal(s.renameButton.hidden,true);
});
test('887 full-page action follows layout and uses the current Text/Cards route',async t=>{
  const {sheet:s,p}=await fixture(t),routes=[];s.fullHref=(id,mode)=>`/page/${id}/${mode}`;s.goBack=url=>routes.push(url);
  const keys=p.menuItems().map(x=>x.key);assert.equal(keys[keys.indexOf('layout')+1],'fullpage');
  choice(p,'fullpage').act();p.mode='text';choice(p,'fullpage').act();assert.deepEqual(routes,['/page/p/cards','/page/p/text']);
});

// Source constraints on the actual sheet DOM, not measured browser geometry.
// Exact selectors are deliberately bounded; collect every occurrence so a
// later source override cannot silently leave these checks green.
const cssRule = (selector,width=1280) => {
  const text=css.replace(/\/\*[\s\S]*?\*\//g,''),stack=[],found=[];let start=0;
  for(let i=0;i<text.length;i++){
    if(text[i]==='{'){const head=text.slice(start,i).trim();stack.push({head,start:i+1});start=i+1;}
    else if(text[i]==='}'){
      const rule=stack.pop();start=i+1;
      if(rule.head.startsWith('@')||!rule.head.split(/,\s*(?![^()]*\))/).includes(selector))continue;
      const applies=stack.every(({head})=>{
        const match=/^@media\s*\((max-width|min-width):\s*([0-9.]+)px\)$/.exec(head);
        assert.ok(match,`unhandled header media ${head}`);
        return match[1]==='max-width'?width<=Number(match[2]):width>=Number(match[2]);
      });
      if(applies)found.push(Object.fromEntries(text.slice(rule.start,i).split(';').filter(x=>x.includes(':')).map(x=>{const at=x.indexOf(':');return [x.slice(0,at).trim(),x.slice(at+1).trim()];})));
    }
  }
  assert.ok(found.length,`rule for ${selector}`);return Object.assign({},...found);
};
const px = value => value.endsWith('rem') ? parseFloat(value)*16 : parseFloat(value);
test('887 review metadata sits immediately after the actual short title without a growing gap',async t=>{
  const {sheet:s,p}=await fixture(t);s.title.textContent='Notes';p.say('Saved to Theseus','saved');
  assert.equal(s.heading.children.indexOf(s.saved),s.heading.children.indexOf(s.title)+1);
  const title=cssRule('.'+s.title.className),heading=cssRule('.'+s.heading.className);
  assert.equal(title.flex,'0 1 auto','title must keep intrinsic width when room remains');
  assert.equal(title['min-width'],'0');assert.equal(title['text-overflow'],'ellipsis');assert.equal(title.overflow,'hidden');
  assert.equal(heading.gap,'.25rem');assert.equal(cssRule('.'+s.saved.className).flex,'none');
});
test('887 review actual phone header collects heading and actions onto one flex line at375 and390',async t=>{
  const {sheet:s,p}=await fixture(t,{wide:false});p.say('Saved to Theseus','saved');
  assert.equal(s.dockButton.hidden,true);assert.deepEqual(s.head.children.map(n=>n.className),['notebook-sheet-heading','notebook-sheet-actions']);
  const controls=s.actions.children.filter(n=>!n.hidden);assert.equal(controls.length,3);
  for(const width of [375,390]){
    const head=cssRule('.'+s.head.className,width),heading=cssRule('.'+s.heading.className,width),actions=cssRule('.'+s.actions.className,width);
    assert.equal(head.display,'flex');assert.equal(heading.flex,'1 1 0');assert.equal(heading['min-width'],'0');
    const phone=cssRule('.notebook-sheet :is(button,input,textarea,select,a[href],summary,[role=button],[role=link],[tabindex])',width);
    assert.equal(phone['min-width'],'2.75rem!important');assert.equal(phone['min-height'],'2.75rem!important');
    const button=cssRule('.notebook-sheet-head .sheet-glyph',width),floor=px(phone['min-width'].replace('!important',''));
    const actionWidth=controls.length*Math.max(px(button.width),floor)+(controls.length-1)*px(actions.gap);
    const padding=head.padding.split(' ').map(px),basis=px(heading.flex.split(' ').at(-1));
    // The phone dialog uses the viewport width; subtract its head padding.
    assert.equal(cssRule('dialog',width).width,'100%');assert.equal(cssRule('dialog',width).border,'0');
    const available=width-padding[1]-padding[3];
    assert.ok(basis+px(head.gap)+actionWidth<=available,`${width}: actions must fit on the same line before flex growth`);
    assert.ok(available-actionWidth-px(head.gap)>0,`${width}: heading gets remaining width`);
  }
});
test('887 review empty recovery region remains rendered and fills the same region on refusal',async t=>{
  const {sheet:s,p}=await fixture(t);
  const full=new DeckPage({doc:p.doc,host:p.node('div'),header:{title:p.node('span'),description:p.node('span'),eyebrow:p.node('span')},item:'status'});
  t.after(()=>full.listening.abort());p.status=full.status;s.status.replaceChildren(p.status);
  p.say('Saved to Theseus','saved');const region=p.status;
  assert.equal(region.getAttribute('role'),'status');assert.equal(region.children.length,0);assert.ok(region.isConnected);
  const empty=cssRule('.notebook-sheet-status:has(.deck-status:empty)'),hidden=cssRule('.sr-only');
  for(const property of ['position','width','height','padding','margin','overflow','clip','white-space','border']) assert.equal(empty[property],hidden[property],property);
  assert.notEqual(empty.display,'none');assert.notEqual(empty.visibility,'hidden');assert.equal(empty.position,'absolute');
  p.say('Permission refused. Words kept.','attention',()=>{});
  assert.ok(p.status===region);assert.ok(s.status.children[0]===region);assert.match(region.text,/Permission refused/);assert.ok(region.querySelector('button'));
  assert.notEqual(cssRule('.notebook-sheet-status').display,'none');assert.equal(s.status.hidden,false);assert.equal(region.hidden,false);
});
