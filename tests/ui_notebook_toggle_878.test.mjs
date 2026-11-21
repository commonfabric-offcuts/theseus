import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { notebookFixture } from './fixtures/notebook_sheet_dom.mjs';
import { NotebookPage } from '../web/notebook-page.mjs';
import { openMessageMenu } from '../web/message-menu.mjs';

for(const docked of [true,false])test(`878 layout button and menu name their ${docked?'on':'off'} state`,async t=>{
  const f=notebookFixture(t);await f.sheet.open('p');f.sheet.setDocked(docked);
  assert.equal(f.sheet.dockButton.title,'Side by side');
  assert.equal(f.sheet.dockButton.getAttribute('aria-label'),'Side by side');
  assert.equal(f.sheet.dockButton.getAttribute('aria-pressed'),String(docked));
  const item=f.page.menuExtras('afterImage').find(x=>x.label==='Side by side');assert.ok(item);
  assert.equal(item.checked,docked);
  const menu=openMessageMenu({anchor:f.page.more,doc:f.doc,win:{innerWidth:1000,innerHeight:1000},items:[item]});
  t.after(()=>menu.close(false));
  assert.equal(menu.root.children[0].getAttribute('aria-checked'),String(docked));
  item.act();assert.equal(f.sheet.docked,!docked);assert.equal(f.sheet.dockButton.getAttribute('aria-pressed'),String(!docked));
  f.sheet.dockButton.onclick();assert.equal(f.sheet.docked,docked);
  assert.equal(f.page.menuExtras('afterImage')[0].checked,docked);
  assert.equal(f.sheet.dockButton.title,'Side by side');assert.equal(f.sheet.dockButton.getAttribute('aria-label'),'Side by side');
});

test('878 pressed decoration belongs only to the on state and uses theme colors',()=>{
  const css=readFileSync(new URL('../web/aim.css',import.meta.url),'utf8');
  const rule=css.match(/\.notebook-sheet-dock\[aria-pressed=true\]\{([^}]+)\}/)?.[1];
  assert.ok(rule,'on-state selector owns the decoration');
  assert.match(rule,/background:var\(--soft\)/);assert.match(rule,/box-shadow:inset 0 0 0 1px var\(--line\)/);
  assert.doesNotMatch(css,/\.notebook-sheet-dock(?:\[aria-pressed=false\])?\{[^}]*box-shadow/,'off state has no pressed edge');
});

for(const draft of [true,false])test(`878 Private Draft ${draft?'checked':'unchecked'} has no help line and preserves write protection`,t=>{
  const f=notebookFixture(t),p=f.page,writes=[];
  p.writing={pageState:{},value:{draft}};p.drafted=NotebookPage.prototype.drafted;p.readOnly=false;
  p.markDraft=value=>writes.push(value);
  const get=()=>NotebookPage.prototype.menuItems.call(p).find(x=>x.glyph==='draft');
  const item=get();assert.equal(item.label,'Private Draft');assert.equal(item.checked,draft);assert.equal(item.description,undefined);assert.equal(item.disabled,false);
  item.act();assert.deepEqual(writes,[!draft]);writes.length=0;
  p.readOnly=true;assert.equal(get().disabled,true);item.act();assert.deepEqual(writes,[],'a menu opened before permission loss cannot write');
});
