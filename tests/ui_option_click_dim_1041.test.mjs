import test from 'node:test';
import assert from 'node:assert/strict';
import {RailDimming} from '../web/rail-dimming.mjs';
import {KEY_WORDS} from '../web/pane-keys.mjs';
import {RULES} from '../web/interaction-guide.mjs';
import {renderer799} from './fixtures/renderer799.mjs';
function fixture(kind){
 const {list}=renderer799(),doc=list.ownerDocument,handlers=new Map(),writes=[];
 list.addEventListener=(name,fn)=>handlers.set(name,fn);doc.addEventListener=()=>{};
 doc.defaultView={MutationObserver:class{observe(){}},addEventListener(){}};
 const group=doc.createElement('li');group.className='ol-outcome';group.dataset.workspaceId='w';list.append(group);
 const row=doc.createElement('a');row.className=kind==='topic'?'nav-item':'ol-name';if(kind==='topic')row.dataset.topicId='t';else row.dataset.workspaceId='w';group.append(row);
 const dim=new RailDimming({host:list,doc});dim.paint=()=>{};dim.choices.bind('scratch1041','reader');dim.choices.syncEdit=x=>writes.push(structuredClone(x));
 const press=mods=>{let prevented=0,stopped=0;const event={target:row,button:0,detail:1,metaKey:false,ctrlKey:false,altKey:false,shiftKey:false,...mods,preventDefault(){prevented++;},stopPropagation(){stopped++;}};handlers.get('pointerdown')(event);handlers.get('click')(event);return {event,prevented,stopped};};
 return {row,handlers,dim,writes,press};
}
for(const kind of ['topic','outcome']){
 test(`1041 ${kind} Command-click belongs to browser and writes no Dim choice`,()=>{const f=fixture(kind),event=f.press({metaKey:true});assert.equal(event.prevented,0);assert.equal(event.stopped,0);assert.deepEqual(f.writes,[]);assert.equal(f.dim.choices.selected,0);});
 test(`1041 ${kind} Option-click uses the retained ordinary choice writer`,()=>{const f=fixture(kind),event=f.press({altKey:true});assert.equal(event.prevented,1);assert.equal(event.stopped,1);assert.equal(f.dim.choices.selected,1);assert.equal(f.dim.choices.dimmed('w',kind==='topic'?'t':null),true);assert.equal(f.writes[0].kind,'choice');});
 test(`1041 ${kind} Option-Shift uses existing inverse`,()=>{const f=fixture(kind);f.press({altKey:true,shiftKey:true});assert.equal(f.writes.length,1);assert.equal(f.writes[0].kind,'inverse');assert.deepEqual(f.dim.choices.value.sets[0].focus,['w',kind==='topic'?'t':null]);});
 test(`1041 ${kind} Control-click/context menu is no longer consumed by Dim`,()=>{const f=fixture(kind),event=f.press({ctrlKey:true});f.handlers.get('contextmenu')?.(event.event);assert.equal(event.prevented,0);assert.deepEqual(f.writes,[]);});
}
test('1041 plain and mixed modifier clicks remain with existing owners',()=>{for(const mods of [{},{altKey:true,metaKey:true},{altKey:true,ctrlKey:true},{metaKey:true,shiftKey:true}]){const f=fixture('topic'),event=f.press(mods);assert.equal(event.prevented,0);assert.deepEqual(f.writes,[]);}});
test('1041 Keys legend and interaction guide name Option-click and browser Command-click',()=>{const legend=KEY_WORDS.map(x=>x.join(' ')).join(' '),guide=RULES.map(x=>x.join(' ')).join(' ');for(const text of [legend,guide]){assert.match(text,/Option-click/);assert.match(text,/Option-Shift/);assert.match(text,/Command-click.*new tab/);}});
