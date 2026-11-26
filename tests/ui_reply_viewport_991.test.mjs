import test from 'node:test';
import assert from 'node:assert/strict';

// Actual module's persistent viewport owner, using bounded geometry/event ports.
// These are lifecycle/scroll-owner checks, not native phone/keyboard evidence.
import {viewport991 as fixture} from './fixtures/reply_viewport_991.mjs';

test('991 resize waits for layout, then reveals footer and Send with an8px gap',()=>fixture({},f=>{
 f.focus();f.emit('resize',{height:430});assert.deepEqual(f.moves,[],'no pre-layout scroll');
 f.state.boxBottom=770;f.state.sendBottom=814;f.pump();assert.equal(f.state.sendBottom,422);assert.deepEqual(f.moves,[{who:'window',by:392}]);
 assert.deepEqual([f.field.value,f.field.selectionStart,f.field.selectionEnd],['Keep this writing.',3,7]);
}));
test('991 an inline reply stays put on a same-height visual pan and re-settles on a second shrink',()=>fixture({},f=>{
 f.focus();f.emit('resize',{height:430,offsetTop:60});f.pump();assert.equal(f.state.sendBottom,482);
 const beforePan=f.moves.length;
 f.emit('scroll',{offsetTop:0});f.pump();
 assert.equal(f.moves.length,beforePan);assert.equal(f.state.sendBottom,482);
 f.emit('resize',{height:350});f.pump();assert.equal(f.state.sendBottom,342);
}));
test('991 writing growth while the viewport stays reduced keeps the act visible',()=>fixture({},f=>{
 f.focus();f.emit('resize',{height:430});f.pump();f.state.boxBottom+=60;f.state.sendBottom+=60;f.input();f.pump();assert.equal(f.state.sendBottom,422);
}));
test('991 a scrolling pencil composer moves itself, leaving the page alone',()=>fixture({internal:true},f=>{
 f.focus();f.emit('resize',{height:430});f.pump();assert.equal(f.state.scrollY,0);assert.ok(f.state.composerScroll>0);assert.ok(f.moves.every(m=>m.who==='composer'));assert.ok(f.state.sendBottom<=392);
}));
for(const reason of ['blurred','disconnected','hidden','readonly'])test('991 queued work ignores a field that becomes '+reason,()=>fixture({},f=>{
 f.focus();f.emit('resize',{height:430});
 if(reason==='blurred')f.doc.activeElement=null;if(reason==='disconnected')f.state.connected=false;if(reason==='hidden')f.state.visible=false;if(reason==='readonly')f.field.readOnly=true;
 f.pump();assert.deepEqual(f.moves,[]);
}));
test('991 repeated viewport signals coalesce and use the latest size',()=>fixture({},f=>{
 f.focus();f.emit('resize',{height:500});f.emit('resize',{height:430});f.emit('scroll',{offsetTop:30});f.pump();assert.equal(f.moves.length,1);assert.equal(f.state.sendBottom,452);
}));
test('991 unchanged desktop viewport does not add a scroll on focus or input',()=>fixture({width:1280},f=>{
 f.focus();f.input();f.emit('resize');f.emit('scroll');f.pump();assert.deepEqual(f.moves,[]);
}));
test('991 page scrolling without a visual-viewport bounds change never pulls writing back',()=>fixture({},f=>{
 f.focus();f.emit('resize',{height:430});f.pump();f.moves.length=0;f.state.boxTop-=300;f.state.boxBottom-=300;f.state.sendBottom-=300;
 f.emit('scroll');f.pump();assert.deepEqual(f.moves,[]);
}));
test('993 the already visible footer moves down to rest8px above the keyboard',()=>fixture({boxTop:100,boxBottom:200,sendBottom:244},f=>{
 f.focus();f.emit('resize',{height:430});f.pump();assert.deepEqual(f.moves,[{who:'window',by:-178}]);assert.equal(f.state.sendBottom,422);assert.equal(f.state.boxTop,278);
}));

test('993 a field taller than the visible space keeps its top visible',()=>fixture({boxTop:100,boxBottom:650,sendBottom:694},f=>{
 f.focus();f.emit('resize',{height:430});f.pump();assert.deepEqual(f.moves,[{who:'window',by:100}]);assert.equal(f.state.boxTop,0);assert.equal(f.state.sendBottom,594);
}));

test('993 a fractional top bound never scrolls the field above a panned viewport',()=>fixture({boxTop:100.5,boxBottom:650,sendBottom:694},f=>{
 f.focus();f.emit('resize',{height:430,offsetTop:30});f.pump();assert.deepEqual(f.moves,[{who:'window',by:70}]);assert.ok(f.state.boxTop>=30);
}));

test('991 restoring the full viewport cancels a pending keyboard adjustment',()=>fixture({},f=>{
 f.focus();f.emit('resize',{height:430});f.emit('resize',{height:844});f.pump();assert.deepEqual(f.moves,[]);
}));
test('991 disabled writing is ignored by a queued adjustment',()=>fixture({},f=>{
 f.focus();f.emit('resize',{height:430});f.field.disabled=true;f.pump();assert.deepEqual(f.moves,[]);
}));
test('991 an unrelated typing input never scrolls a composer',()=>fixture({},f=>{
 f.doc.activeElement={tagName:'INPUT',matches:()=>true,isConnected:true,closest:()=>null};f.emit('resize',{height:430});f.pump();assert.deepEqual(f.moves,[]);
}));
test('991 orientation-width changes reset keyboard settling',()=>fixture({},f=>{
 f.focus();f.state.width=844;f.emit('resize',{width:844,height:430});f.pump();assert.deepEqual(f.moves,[]);
}));
