import test from 'node:test';
import assert from 'node:assert/strict';
import { ThingsRail } from '../web/things-rail.mjs';
import { KeyTree } from '../web/key-tree.mjs';
import { panes } from '../web/panes.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

// Real rail/grid/tree key owners with supplied rectangles; no layout/gesture claim.
function fixture(t,{columns=3,count=8,reverse=false}={}){
 const doc=miniDocument(),make=doc.createElement;
 doc.createElement=tag=>{const el=make(tag);Object.defineProperties(el,{parentElement:{get:()=>el.parent},ownerDocument:{get:()=>doc}});el.hasAttribute=name=>el.getAttribute(name)!==null;el.contains=node=>el===node||[...el.descendants()].includes(node);el.checkVisibility=()=>!el.hidden;el.getBoundingClientRect=()=>el.box??{top:0,bottom:800,left:0,right:800,width:800,height:800};return el;};
 doc.body=doc.createElement('body');doc.body.root=true;doc.defaultView={innerHeight:800,innerWidth:1280,getComputedStyle:()=>({overflowY:'visible'}),scrollBy(){}};
 const main=doc.createElement('main'),feed=doc.createElement('button');main.id='main';main.append(feed);doc.body.append(main);doc.getElementById=id=>id==='main'?main:null;
 const host=doc.createElement('aside'),holder=doc.createElement('div'),section=doc.createElement('details'),header=doc.createElement('summary'),body=doc.createElement('div'),grid=doc.createElement('div');grid.className='things-thumbs';section.open=true;body.append(grid);section.append(header,body);holder.append(section);host.append(holder);doc.body.append(host);
 const cells=Array.from({length:count},(_,i)=>{const el=doc.createElement('a');el.setAttribute('href','?image='+i);el.textContent='image '+i;return el;});grid.append(...(reverse?[...cells].reverse():cells));
 const following=doc.createElement('summary');holder.append(following);
 const rows=[{el:header,level:1,set:holder,key:'images',expanded:true},...[...grid.children].map(el=>({el,level:2,set:section,parent:header,key:el.textContent})),{el:following,level:1,set:holder,key:'following',expanded:true}];
 const rail=Object.assign(Object.create(ThingsRail.prototype),{doc,host,holder});
 const tree=rail.tree={list:()=>rows.filter(row=>!row.el.hidden),rowOf:KeyTree.prototype.rowOf,ownKey:KeyTree.prototype.ownKey,stepIn:KeyTree.prototype.stepIn,go:row=>row?.el.focus(),act:(...args)=>rail.act(...args)};
 const before={things:panes.things,notebook:panes.notebook,feed:panes.feed};Object.assign(panes,{things:{leave(){}},notebook:null,feed:()=>{feed.focus();return true;}});t.after(()=>Object.assign(panes,before));
 const arrange=cols=>cells.forEach((el,i)=>{const left=(i%cols)*90,top=Math.floor(i/cols)*80;el.box={left,right:left+70,top,bottom:top+60,width:70,height:60};});arrange(columns);
 const press=(at,key,extra={})=>{at.focus();const event={target:at,key,...extra,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;}};rail.gridKey?.(event);KeyTree.prototype.key.call(tree,event);return event;};
 return {doc,rail,tree,header,following,cells,feed,grid,section,arrange,press};
}
for(const columns of [2,3,4])test(`1007 ${columns} real-position columns use horizontal and vertical neighbors`,t=>{
 const f=fixture(t,{columns,count:columns*3});f.press(f.cells[0],'ArrowRight');assert.ok(f.doc.activeElement===f.cells[1]);
 f.press(f.cells[1],'ArrowDown');assert.ok(f.doc.activeElement===f.cells[columns+1]);
 f.press(f.cells[columns+1],'ArrowLeft');assert.ok(f.doc.activeElement===f.cells[columns]);
 f.press(f.cells[columns],'ArrowUp');assert.ok(f.doc.activeElement===f.cells[0]);assert.equal(f.section.open,true);
});
test('1007 Right row edge stops and interior Left stays in the visual row',t=>{
 const f=fixture(t);f.press(f.cells[2],'ArrowRight');assert.ok(f.doc.activeElement===f.cells[2]);f.press(f.cells[2],'ArrowLeft');assert.ok(f.doc.activeElement===f.cells[1]);
});
test('1007 Up from every first-row image reaches its header without folding',t=>{
 const f=fixture(t);for(const cell of f.cells.slice(0,3)){f.press(cell,'ArrowUp');assert.ok(f.doc.activeElement===f.header);assert.equal(f.section.open,true);}
});
test('1007 first visual column Left keeps996 feed handoff',t=>{
 const f=fixture(t);for(const cell of [f.cells[0],f.cells[3],f.cells[6]]){f.press(cell,'ArrowLeft');assert.ok(f.doc.activeElement===f.feed);assert.equal(f.section.open,true);}
});
test('1007 a partial next row with no aligned image keeps the current cell',t=>{
 const f=fixture(t);f.press(f.cells[5],'ArrowDown');assert.ok(f.doc.activeElement===f.cells[5]);
});
test('1007 Down from any final-row cell continues after the grid',t=>{
 const f=fixture(t);for(const cell of f.cells.slice(6)){f.press(cell,'ArrowDown');assert.ok(f.doc.activeElement===f.following);}
});
test('1007 layout is read again after a column change',t=>{
 const f=fixture(t,{columns:2});f.press(f.cells[1],'ArrowDown');assert.ok(f.doc.activeElement===f.cells[3]);f.arrange(4);f.press(f.cells[1],'ArrowDown');assert.ok(f.doc.activeElement===f.cells[5]);
});
test('1007 visual neighbors win over reversed DOM order',t=>{
 const f=fixture(t,{reverse:true});f.press(f.cells[3],'ArrowRight');assert.ok(f.doc.activeElement===f.cells[4]);f.press(f.cells[4],'ArrowUp');assert.ok(f.doc.activeElement===f.cells[1]);
});
test('1007 hidden, inert and zero-size cells are not arrow targets',t=>{
 const f=fixture(t);for(const mode of ['hidden','inert','zero']){
  f.cells[1].hidden=mode==='hidden';f.cells[1].toggleAttribute('inert',mode==='inert');f.arrange(3);if(mode==='zero')f.cells[1].box.width=0;
  f.press(f.cells[0],'ArrowRight');assert.ok(f.doc.activeElement===f.cells[2],mode);
 }
});
test('1007 grid handler leaves modifiers, IME, menu keys and Return with their owners',t=>{
 const f=fixture(t);for(const[key,extra]of [['ArrowRight',{metaKey:true}],['ArrowDown',{ctrlKey:true}],['ArrowUp',{shiftKey:true}],['ArrowLeft',{isComposing:true}],['ArrowRight',{defaultPrevented:true}],['ContextMenu',{}],['F10',{shiftKey:true}],['Enter',{}],['Home',{}]]){
  const event={target:f.cells[1],key,...extra,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;}};f.rail.gridKey?.(event);assert.equal(event.stopped,undefined,key);
 }
});

test('1007 a grid move lands on the visible picture control that owns Return',t=>{
 const f=fixture(t),image=f.doc.createElement('img');image.className='image-thumb';f.cells[1].append(image);f.press(f.cells[0],'ArrowRight');assert.ok(f.doc.activeElement===image);
});
