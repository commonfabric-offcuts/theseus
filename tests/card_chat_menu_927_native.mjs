// Real isolated HTTP/Core page and Chrome for Testing input; no live records.
// AIM_CHROME and AIM_PLAYWRIGHT_CORE name the owned browser and module.
// node tests/card_chat_menu_927_native.mjs /absolute/evidence
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fixtureControl } from './fixture_control.mjs';
const { chromium }=createRequire(import.meta.url)(process.env.AIM_PLAYWRIGHT_CORE);
const evidence=process.argv[2];await mkdir(evidence,{recursive:true});
const child=spawn('/usr/bin/python3',['tests/fixtures/ui_http.py','--freshness']);
const {control,exit,errors:fixtureErrors}=fixtureControl(child);
let browser,page;const results=[];
try {
  browser=await chromium.launch({executablePath:process.env.AIM_CHROME,headless:true});
  const facts=await control({method:'ready'}),id='card-chat-menu-927';
  assert.equal((await control({method:'outcome_reference',operation_id:id,item_id:id,title:'Menu test',body:'## First\n\nFirst words\n\n## Second\n\nSecond words\n\n## Third\n\nThird words\n'})).status,'committed');
  await control({method:'coordinator',operation_id:'927-coordinator',coordinator:'fixture-notebook-agent'});
  for(const width of [1280,390]) for(const surface of ['page','composer']) {
    const root=surface==='page'?'#deck-page':'#notebook-sheet-dialog .notebook-sheet-page:not([hidden])';
    const context=await browser.newContext({viewport:{width,height:900},isMobile:width<760,hasTouch:width<760});
    page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(facts.origin+(surface==='page'?'/?cards='+id:'/?topic=t1&page='+id));
    await page.waitForFunction(root=>document.body.dataset.ready==='true'&&document.querySelectorAll(root+' .deck-card').length===3,root);
    const row=n=>page.locator(`${root} .deck-card[data-index="${n}"]`);
    const menu=page.getByRole('menu',{name:'This card'});
    const focused=async el=>{await page.waitForFunction(e=>document.activeElement===e,await el.elementHandle(),{timeout:5000});return true;};
    const press=el=>width<760?el.tap():el.click();
    assert.equal(await page.locator(root+' .deck-ask').count(),0);
    await row(0).focus();await page.keyboard.press('ArrowDown');assert.equal(await focused(row(1)),true);
    await page.keyboard.press('Shift+F10');await menu.waitFor();
    assert.equal(await focused(menu.getByRole('menuitem',{name:'Copy text',exact:true})),true);
    await page.keyboard.press('ArrowDown');assert.equal(await focused(menu.getByRole('menuitem',{name:'Copy link',exact:true})),true);
    await page.keyboard.press('ArrowUp');assert.equal(await focused(menu.getByRole('menuitem',{name:'Copy text',exact:true})),true);
    await page.keyboard.press('End');assert.equal(await focused(menu.getByRole('menuitem',{name:'Chat about this…',exact:true})),true);
    await page.screenshot({path:`${evidence}/menu-${surface}-${width}.png`});
    await page.keyboard.press('Enter');await menu.waitFor({state:'hidden'});
    const field=page.locator(root+' .deck-ask-field');await field.waitFor();assert.equal(await focused(field),true);
    assert.equal(await field.evaluate(e=>e.closest('.deck-card').querySelector('.deck-title').textContent),'Second');
    await field.fill(`Kept chat ${width}`);await page.keyboard.press('Escape');await field.waitFor({state:'hidden'});
    assert.equal(await focused(row(1)),true);
    await page.keyboard.press('ContextMenu');await menu.waitFor();await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
    assert.equal(await focused(row(1)),true);await page.keyboard.press('ArrowUp');assert.equal(await focused(row(0)),true);
    // The old arrow-to-control and Return door still work, independently of the new shortcut.
    await page.keyboard.press('ArrowRight');assert.equal(await focused(row(0).locator('.deck-menu')),true);
    await page.keyboard.press('Enter');await menu.waitFor();await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
    assert.equal(await focused(row(0).locator('.deck-menu')),true);
    // A pointer menu on another row owns that row; the previously kept chat returns only to its own card.
    // The deck suppresses hover while typing until the mouse actually moves.
    if(width>=760){await page.mouse.move(1,1);await row(2).hover();}
    await press(row(2).locator('.deck-menu'));await menu.waitFor();await press(menu.getByRole('menuitem',{name:'Chat about this…',exact:true}));
    await field.waitFor();assert.equal(await field.evaluate(e=>e.closest('.deck-card').querySelector('.deck-title').textContent),'Third');assert.equal(await field.inputValue(),'');
    await page.keyboard.press('Escape');await field.waitFor({state:'hidden'});
    await row(1).focus();await page.keyboard.press('Shift+F10');await menu.waitFor();await page.keyboard.press('End');await page.keyboard.press('Enter');
    await field.waitFor();assert.equal(await field.inputValue(),`Kept chat ${width}`);
    await page.keyboard.press('Escape');await field.waitFor({state:'hidden'});
    // Writing and new-card keys keep their original meaning.
    await page.keyboard.press('Meta+Enter');const writing=page.locator(root+' .deck-writing textarea');await writing.waitFor();
    assert.match(await writing.inputValue(),/^Second/);await page.keyboard.press('Shift+F10');assert.equal(await menu.count(),0);
    await page.keyboard.press('Escape');await writing.waitFor({state:'hidden'});
    await page.keyboard.press('Enter');await writing.waitFor();assert.equal(await writing.inputValue(),'');
    await page.keyboard.press('Escape');await writing.waitFor({state:'hidden'});
    assert.equal(await page.locator(root+' .deck-card').count(),3);assert.deepEqual(errors,[]);
    results.push({width,surface,passed:true,inputs:'native keyboard and '+(width<760?'emulated touch':'mouse'),scope:'menu, focus, cursor continuation, existing chat writer and kept writing; no send or physical mobile keyboard claim'});
    await context.close();page=null;
  }
} catch(error) {
  results.push({passed:false,error:error.stack});
  if(page){await page.screenshot({path:`${evidence}/failure.png`}).catch(()=>{});await writeFile(`${evidence}/failure.html`,await page.content().catch(()=>''));}
  throw error;
} finally {
  await browser?.close();child.stdin.end();const ended=await exit;
  await writeFile(`${evidence}/results.json`,JSON.stringify({results,fixtureExit:ended,fixtureErrors:fixtureErrors()},null,2));
  assert.equal(ended.code,0);
}
