import test from 'node:test';
import assert from 'node:assert/strict';
import { ComposeBar } from '../web/compose-bar.mjs';

function fixture({ wanted = 60, tall = false, fit = 'auto', normal = 100 } = {}) {
  const attrs = new Set(tall ? ['data-tall'] : []), changes = [];
  const root = { hasAttribute: n => attrs.has(n), toggleAttribute(n, yes) { yes ? attrs.add(n) : attrs.delete(n); } };
  const field = { style: {}, scrollTop: 37, scrollHeight: wanted - 2, selectionStart: 3, selectionEnd: 11 };
  const bar = Object.assign(Object.create(ComposeBar.prototype), { root, field,
    holds: () => { changes.push('hold'); return () => changes.push('restore'); },
    win: { getComputedStyle: () => ({ getPropertyValue: () => fit, borderTopWidth:'1px', borderBottomWidth:'1px', maxHeight: `${root.hasAttribute('data-tall') ? 200 : normal}px` }) } });
  return { bar, root, field, changes, attrs, setNormal: value => { normal = value; } };
}
for (const [wanted, visible] of [[30,false],[98,false],[99.5,true],[100,true],[220,true]]) test(`975 visibility at measured height ${wanted}`, () => {
  const f=fixture({wanted});f.bar.fit();assert.equal(f.root.hasAttribute('data-full-field'),visible);
  assert.equal(f.field.style.height,`${Math.min(wanted,100)}px`);
  assert.deepEqual(f.changes,['hold','restore']);assert.deepEqual([f.field.scrollTop,f.field.selectionStart,f.field.selectionEnd],[37,3,11]);
});
test('975 expanded field uses normal threshold and retains its height choice across shrink/growth',()=>{
  const f=fixture({wanted:140,tall:true});f.bar.fit();assert.equal(f.root.hasAttribute('data-full-field'),true);assert.equal(f.field.style.height,'140px');
  f.field.scrollHeight=28;f.bar.fit();assert.equal(f.root.hasAttribute('data-full-field'),false);assert.equal(f.root.hasAttribute('data-tall'),true);
  f.field.scrollHeight=218;f.bar.fit();assert.equal(f.root.hasAttribute('data-full-field'),true);assert.equal(f.field.style.height,'200px');
});
test('975 width/style changes use the current normal maximum rather than a cached cap',()=>{
  const f=fixture({wanted:70,tall:true,normal:100});f.bar.fit();assert.equal(f.root.hasAttribute('data-full-field'),false);
  f.setNormal(60);f.bar.fit();assert.equal(f.root.hasAttribute('data-full-field'),true);assert.equal(f.root.hasAttribute('data-tall'),true);
});
test('975 fixed-height line/wide Reader clears the full marker without adjusting scroll',()=>{
  const f=fixture({fit:'none'});f.attrs.add('data-full-field');f.bar.fit();assert.equal(f.root.hasAttribute('data-full-field'),false);assert.equal(f.field.style.height,'');assert.deepEqual(f.changes,[]);assert.equal(f.field.scrollTop,37);
});

test('975 width notifications coalesce outside resize delivery and disposal cancels pending fitting',()=>{
  const previous=globalThis.ResizeObserver,frames=new Map(),observed=[];let notify,serial=0,fits=0,disconnected=false;
  globalThis.ResizeObserver=class{constructor(fn){notify=fn;}observe(node){observed.push(node);}disconnect(){disconnected=true;}};
  try{
    const root={ownerDocument:{},dataset:{},addEventListener(){}},field={addEventListener(){}};
    const win={matchMedia:()=>({addEventListener(){},removeEventListener(){}}),addEventListener(){},removeEventListener(){},
      requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:id=>frames.delete(id)};
    const bar=new ComposeBar({root,field,panels:{},openers:{},win});bar.fit=()=>{fits++;};
    assert.deepEqual(observed,[root,field]);
    const resize=width=>notify([{target:field,contentRect:{width,height:30}}]);
    resize(400);resize(350);assert.equal(fits,0,'resize delivery never writes the observed field height');assert.equal(frames.size,1);
    for(const [id,fn] of frames){frames.delete(id);fn();}assert.equal(fits,1);
    resize(350);resize(0);assert.equal(frames.size,0,'height-only and hidden notifications do not refit');
    resize(300);assert.equal(frames.size,1);bar.dispose();assert.equal(frames.size,0);assert.equal(disconnected,true);
    resize(250);assert.equal(frames.size,0);assert.equal(fits,1,'disposed field never fits again');
  }finally{globalThis.ResizeObserver=previous;}
});
