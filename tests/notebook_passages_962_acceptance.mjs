// Real Notebook display gestures and actual Core draft quote receipts.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { access, mkdir, writeFile, readFile } from 'node:fs/promises';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { fixtureControl } from './fixture_control.mjs';
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const all=process.argv.includes('--all');
const evidence=process.argv[2];await mkdir(evidence,{recursive:true});
const child=spawn('/usr/bin/python3',['tests/fixtures/ui_http.py','--freshness','--live']);
const {control,exit}=fixtureControl(child);
const records=[],failures=[],errors=[],marker=`theseus-962-${process.pid}`;
const productFiles=['aim.css','app.mjs','dossier-selection-quote.mjs','feed-passages.mjs','message-format.mjs','notebook-page.mjs','notebook-sheet.mjs','page-here.mjs','notebook-passages.mjs','notebook-quote-transfer.mjs'];
const hashes=Object.fromEntries(await Promise.all(productFiles.map(async file=>[file,createHash('sha256').update(await readFile(new URL('../web/'+file,import.meta.url))).digest('hex')])));
records.push({phase:'product-source',base:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes});
let browser,page,facts,profile;
const check=async(name,act)=>{try{await act();records.push({name,pass:true});}catch(error){failures.push({name,error:error.stack});}};
const settle=()=>page.waitForFunction(()=>document.body.dataset.ready==='true');
const body='Opening words for a page. Another sentence.\n\n## First card\n\nChosen first sentence. A second sentence to extend.\n\n## Second card\n\nOther card words remain separate.';
async function point(root,needle,last=false){
 // The initial page read can replace its first paint. Reacquire the
 // locator only for that actual detachment; coordinates still hit real ink.
 for(let attempt=0;;attempt++){
  try{await root.scrollIntoViewIfNeeded();break;}
  catch(error){if(attempt>=2||!error.message.includes('not attached'))throw error;}
 }
 const p=await root.evaluate((el,{needle,last})=>{const walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;while(node=walk.nextNode()){const at=node.data.indexOf(needle);if(at<0)continue;const r=document.createRange(),i=at+(last?needle.length-1:0);r.setStart(node,i);r.setEnd(node,i+1);const b=r.getBoundingClientRect();return{x:last?b.right-.5:b.left+.5,y:b.top+b.height/2};}throw Error('No actual text for '+needle);},{needle,last});
 const hit=await root.evaluate((el,p)=>{const node=document.elementFromPoint(p.x,p.y);return p.y>=0&&p.y<innerHeight&&!!node&&el.contains(node);},p);
 assert.equal(hit,true,'native pointer target is an actual visible word');return p;
}
const lit=()=>page.evaluate(()=>[...CSS.highlights.get('notebook-lit-passage')??[]].map(r=>r.toString()).join(''));
const quoteSave=()=>page.waitForResponse(r=>{if(r.request().method()!=='POST')return false;try{const e=r.request().postDataJSON();return e.kind==='draft.save'&&e.args.quotes?.some(q=>q.source?.kind==='memory');}catch{return false;}},{timeout:10000});
async function receipt(wait,item,revision,excerpt){const r=await wait,e=r.request().postDataJSON(),reply=await r.json();assert.equal(reply.status,'committed');const q=e.args.quotes.at(-1);assert.deepEqual(q.source,{kind:'memory',id:item,revision});assert.equal(q.excerpt.trimEnd(),excerpt.trimEnd());records.push({phase:'actual-kept-quote',source:q.source,excerpt:q.excerpt,topic:e.args.topic_id});}
try{
 facts=await control({method:'ready'});
 let topicId;
 browser=await chromium.launch({executablePath:process.env.AIM_CHROME,headless:true,args:['--enable-automation',`--${marker}`]});
 const cdp=await browser.newBrowserCDPSession();profile=(await cdp.send('Browser.getBrowserCommandLine')).arguments.find(x=>x.startsWith('--user-data-dir='))?.slice(16);assert.ok(profile);await cdp.detach();
 await writeFile(evidence+'/ownership.json',JSON.stringify({marker,profile,fixturePid:child.pid,origin:facts.origin,nodePid:process.pid},null,2));
 const cells=[['full','Bookends','light'],['full','Bookends','dark'],['full','Paper','light'],['full','Paper','dark'],['sheet','Bookends','light'],['sheet','Paper','dark'],['dock','Bookends','dark'],['dock','Paper','light'],['page','Bookends','light'],['page','Paper','dark']];
 if(process.argv.includes('--quick'))cells.splice(2);
 if(!all&&(process.argv.includes('--edges')||process.argv.includes('--recovery')||process.argv.includes('--message')))cells.length=0;
 const surfaceOnly=process.argv.find(x=>x.startsWith('--surface='))?.split('=')[1];
 if(surfaceOnly)for(let i=cells.length-1;i>=0;i--)if(cells[i][0]!==surfaceOnly)cells.splice(i,1);
 for(const [surface,look,theme]of cells){
  const key=`${surface}-${look}-${theme}`,item='note962-'+key,width=surface==='sheet'?1100:surface==='dock'?1440:1280;
  assert.equal((await control({method:'outcome_reference',operation_id:item,item_id:item,title:'Notebook quote source',body})).status,'committed');
  if(!topicId){const cv=await control({method:'agent_view',name:'conversation',args:{workspace_id:'w1'}});topicId=cv.conversation?.topic_id;assert.match(topicId??'',/^t-[0-9a-f]{32}$/,JSON.stringify(cv));}
  const context=await browser.newContext({viewport:{width,height:1000},colorScheme:theme});page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push({key,error:e.message}));
  await page.goto(facts.origin+'/?topic='+topicId);await settle();await page.getByRole('button',{name:look,exact:true}).click();
  const route=surface==='full'?`/?cards=${item}&view=cards`:surface==='page'?`/?workspace=w1&page=${item}&revision=1`:`/?topic=${topicId}&page=${item}`;
  await page.goto(facts.origin+route);await settle();
  const root=surface==='page'?page.locator('.page-here-body'):page.locator((surface==='full'?'#deck-page':'#notebook-sheet-dialog')+' .deck-card:not(.deck-writing)').first();await root.waitFor();
  if(surface==='sheet'||surface==='dock')assert.equal(await page.locator('#notebook-sheet-dialog').evaluate(el=>el.classList.contains('notebook-docked')),surface==='dock');
  const first=await point(root,'Chosen first sentence.');await page.mouse.move(first.x-10,first.y);await page.mouse.move(first.x+1,first.y);
  await check(key+' actual hover lights the same first sentence',async()=>assert.equal((await lit()).trim(),'Chosen first sentence.'));
  const last=await point(root,'extend.',true);await page.keyboard.down('Shift');await page.mouse.move(last.x,last.y);await page.keyboard.up('Shift');
  await check(key+' Shift pointer extends the same shared passage range',async()=>assert.equal((await lit()).replace(/\s+/g,' ').trim(),'Chosen first sentence. A second sentence to extend.'));
  if(look==='Paper')await page.screenshot({path:evidence+'/'+key+'-lit.png',fullPage:true});
  records.push({key,paint:await root.evaluate(el=>{const s=getComputedStyle(el);return{field:s.backgroundImage,ink:s.getPropertyValue('--notebook-lit-ink'),paper:s.getPropertyValue('--paper'),look:document.documentElement.dataset.look};})});
  const from=await point(root,'First card'),to=await point(root,'Chosen first sentence.',true);
  await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:18});await page.mouse.up();
  await check(key+' a native drag spans heading and body',async()=>assert.match(await page.evaluate(()=>getSelection().toString()),/First card[\s\S]*Chosen first sentence\./));
  if(surface!=='page'){
   const other=page.locator((surface==='full'?'#deck-page':'#notebook-sheet-dialog')+' .deck-card.notebook-reading-words').nth(1);
   const p=await point(other,'Other card words');const selection=await page.evaluate(()=>getSelection().toString());await page.mouse.move(p.x+1,p.y);
   await check(key+' native selection keeps focus when the pointer crosses another card',async()=>{assert.equal(await page.evaluate(()=>getSelection().toString()),selection);assert.equal(await root.evaluate(el=>document.activeElement===el),true);});
  }
  const kept=quoteSave();kept.catch(()=>{});await page.keyboard.press('Enter');
  await check(key+' Return keeps exact page/revision in the existing composer',async()=>{
   await page.waitForFunction(()=>document.querySelector('#reader')?.open);assert.match(await page.locator('#writing-body').inputValue(),/> ## First card/);
   await receipt(kept,item,1,'## First card\n\nChosen first sentence.');
  });
  await page.screenshot({path:evidence+'/'+key+'-quote.png',fullPage:true});
  await page.locator('#reader-close').click();
  if(surface==='page'){
   await check(key+' revision display closes without starting page editing',async()=>assert.equal(await page.locator('.deck-writing').count(),0));
  }else{
   if(surface==='full'){await page.goto(facts.origin+route);await settle();await page.getByRole('button',{name:'Edit',exact:true}).click();}
   else{await page.locator('#notebook-sheet-dialog .deck-card').first().click();}
   const edit=page.locator('.deck-writing textarea');await edit.waitFor();await edit.fill('First card\nEditing stays literal.');await page.keyboard.press('Enter');
   await check(key+' editing Return stays literal and opens no Reader',async()=>{assert.equal(await edit.inputValue(),'First card\nEditing stays literal.\n');assert.equal(await page.locator('#reader').evaluate(el=>el.open),false);});
   await page.keyboard.press('Escape');
  }
  await context.close();
 }

 if(all||process.argv.includes('--edges')){
  // Desktop native mouse selection in a coarse-pointer phone context, then
  // native touch activation. This does not claim physical phone handles.
  for(const surface of ['full','sheet']){
   const key='phone-'+surface,item='note962-'+key;
   assert.equal((await control({method:'outcome_reference',operation_id:item,item_id:item,title:'Phone source',body})).status,'committed');
   if(!topicId)topicId=(await control({method:'agent_view',name:'conversation',args:{workspace_id:'w1'}})).conversation.topic_id;
   const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,colorScheme:'dark'});
   page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push({key,error:e.message}));
   await page.goto(facts.origin+(surface==='full'?`/?cards=${item}&view=cards`:`/?topic=${topicId}&page=${item}`));await settle();
   const root=page.locator((surface==='full'?'#deck-page':'#notebook-sheet-dialog')+' .deck-card.notebook-reading-words').first();await root.waitFor();
   assert.equal(await page.evaluate(()=>matchMedia('(pointer: coarse)').matches),true);
   const from=await point(root,'Chosen first sentence.'),to=await point(root,'Chosen first sentence.',true);
   await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:18});await page.mouse.up();
   assert.equal(await page.evaluate(()=>getSelection().toString()),'Chosen first sentence.');
   const pill=page.locator('#notebook-quote-selection');await pill.waitFor({state:'visible'});
   records.push({key,selection:await page.evaluate(()=>getSelection().toString()),modal:await pill.evaluate(el=>!!el.closest('dialog:modal'))});
   const kept=quoteSave();kept.catch(()=>{});await pill.tap();
   await check(key+' native touch pill keeps the exact selected revision',async()=>{await receipt(kept,item,1,'Chosen first sentence.');assert.match(await page.locator('#writing-body').inputValue(),/> Chosen first sentence\./);});
   await page.screenshot({path:evidence+'/'+key+'.png',fullPage:true});await context.close();

  }
  const item='note962-edge-source',raw='Opening source.\n\n## First **card**\n\nBefore gap.\n\n<!-- theseus-card: {"id":"c-11111111111111111111111111111111","aliases":[],"color":null} -->\n\nAfter gap. A [source link](https://example.test/target).\n\n```js\nconst n = 1;\n```'.replace('https://example.test/target',facts.origin+'/?workspace=w1');
  assert.equal((await control({method:'outcome_reference',operation_id:item,item_id:item,title:'Edge source',body:raw})).status,'committed');
  const context=await browser.newContext({viewport:{width:1280,height:1000},permissions:['clipboard-read','clipboard-write']});
  page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push({key:'edges',error:e.message}));
  const route=`/?cards=${item}&view=cards`,root=page.locator('#deck-page .deck-card.notebook-reading-words').first();
  await page.goto(facts.origin+route);await settle();await root.waitFor();
  await check('Notebook display retains literal card title markup',async()=>assert.equal(await root.locator('.deck-title').textContent(),'First **card**'));
  const hover=async needle=>{const p=await point(root,needle);await page.mouse.move(p.x-12,p.y);await page.mouse.move(p.x+1,p.y);};
  await hover('Before gap.');await page.keyboard.press('Meta+c');
  await check('lit Copy uses the shared exact Markdown passage',async()=>assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'Before gap.'));
  if(await page.evaluate(()=>/mac|iphone|ipad|ipod/i.test(navigator.platform))){
   await hover('After gap.');await page.keyboard.press('Control+c');
   await check('Mac Control-C retains its native meaning rather than taking Command-C',async()=>assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'Before gap.'));
   await hover('Before gap.');
  }
  const end=await point(root,'After gap.');await page.keyboard.down('Shift');await page.mouse.click(end.x+1,end.y);await page.keyboard.up('Shift');
  await check('native Shift-click extends passages without opening card editing',async()=>{assert.equal((await lit()).trim(),'Before gap.After gap.');await page.keyboard.press('Meta+c');assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'Before gap.\n\nAfter gap.');assert.equal(await page.locator('.deck-writing').count(),0);});
  await page.screenshot({path:evidence+'/edge-lit.png',fullPage:true});
  await page.keyboard.press('Tab');
  await check('Tab to a card control clears the light',async()=>{assert.equal(await lit(),'');assert.equal(await page.evaluate(()=>document.activeElement.tagName),'A');});
  for(let n=0;n<8&&!await page.evaluate(()=>document.activeElement.matches('.deck-menu'));n++)await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.matches('.deck-menu')),true);
  await page.keyboard.press('Enter');
  await check('Return on the focused menu control opens its menu',async()=>{await page.locator('.message-menu-list').waitFor();assert.equal(await page.locator('#reader').evaluate(el=>el.open),false);});
  await page.keyboard.press('Escape');
  await hover('const n = 1;');
  await check('code remains one shared fenced passage',async()=>{assert.equal((await lit()).trim(),'const n = 1;');await page.keyboard.press('Meta+c');assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'```js\nconst n = 1;\n```');});
  const popup=context.waitForEvent('page');popup.catch(()=>{});
  const sourceLink=root.getByRole('link',{name:'source link',exact:true});records.push({phase:'native-link',href:await sourceLink.getAttribute('href')});
  await sourceLink.click({modifiers:['Shift']});
  await check('native Shift-click on a Notebook link keeps the browser action',async()=>{const target=await popup;await target.waitForLoadState();assert.equal(target.url(),facts.origin+'/?workspace=w1');await target.close();assert.equal(await page.locator('#reader').evaluate(el=>el.open),false);assert.equal(await page.locator('.deck-writing').count(),0);});
  await page.bringToFront();
  const from=await point(root,'First **card**'),to=await point(root,'After gap.',true);
  await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:18});await page.mouse.up();
  const kept=quoteSave();kept.catch(()=>{});await page.keyboard.press('Enter');
  await check('hidden metadata projection keeps individually valid immutable source excerpts',async()=>{
   const r=await kept,e=r.request().postDataJSON();assert.equal((await r.json()).status,'committed');
   assert.equal(e.args.quotes.map(q=>q.excerpt).join(''),'## First **card**\n\nBefore gap.\n\nAfter gap.');
   assert.ok(e.args.quotes.length>1);for(const q of e.args.quotes){assert.ok(raw.includes(q.excerpt));assert.deepEqual(q.source,{kind:'memory',id:item,revision:1});}
   records.push({phase:'projected-kept-quote',quotes:e.args.quotes});
  });
  // An explicit send is confined to this scratch record and exercises Core's
  // actual immutable quote validation. Quoting itself sent no message.
  const sent=page.waitForResponse(r=>{try{return r.request().postDataJSON()?.kind==='message.send';}catch{return false;}},{timeout:10000});sent.catch(()=>{});
  await page.locator('#writing-body').fill((await page.locator('#writing-body').inputValue())+'Scratch validation.');await page.keyboard.press('Meta+Enter');
  await check('Core accepts the exact projected parts on explicit native send',async()=>assert.equal((await(await sent).json()).status,'committed'));
  await page.goto(facts.origin+route);await settle();await root.waitFor();await hover('Before gap.');
  const firstQuote=quoteSave();firstQuote.catch(()=>{});await page.keyboard.press('Enter');await receipt(firstQuote,item,1,'Before gap.\n\n');
  const draftSave=page.waitForResponse(r=>{try{const e=r.request().postDataJSON();return e.kind==='draft.save'&&e.args.body==='Existing unsent writing.';}catch{return false;}});draftSave.catch(()=>{});
  await page.locator('#writing-body').fill('Existing unsent writing.');await draftSave;
  await page.goto(facts.origin+route);await settle();await root.waitFor();await hover('Before gap.');
  const appended=quoteSave();appended.catch(()=>{});await page.keyboard.press('Enter');
  await check('a later Notebook quote appends to the existing unsent draft',async()=>{await appended;assert.ok((await page.locator('#writing-body').inputValue()).startsWith('Existing unsent writing.\n\n> Before gap.'));});
  await page.goto(facts.origin+route);await settle();await root.waitFor();await hover('Before gap.');
  assert.equal((await control({method:'memory_revise',operation_id:item+'-rev2',item_id:item,expected_revision:1,title:'Edge source',body:raw.replace('Before gap.','Revised first words.')})).status,'committed');
  await page.waitForFunction(()=>document.querySelector('#deck-page')?.textContent.includes('Revised first words.'));
  await check('an incoming real revision clears the old passage light',async()=>assert.equal(await lit(),''));
  await page.goto(facts.origin+`/?workspace=w1&page=${item}&revision=1`);await settle();
  const old=page.locator('.page-here-body'),p=await point(old,'Before gap.');await page.mouse.move(p.x-10,p.y);await page.mouse.move(p.x+1,p.y);
  const oldSave=quoteSave();oldSave.catch(()=>{});await page.keyboard.press('Enter');
  await check('explicit historical page selection keeps revision1 after revision2 exists',async()=>await receipt(oldSave,item,1,'Before gap.\n\n'));
  await context.close();
 }

 if(all||process.argv.includes('--recovery')){
  const saved=async(item)=> (await control({method:'agent_view',actor:facts.actor,name:'editor_state',args:{topic_id:topicId,source_ref:{kind:'memory',id:item,revision:1}}})).draft;
  for(const fault of ['keep','clear','source']){
   const item='note962-recovery-'+fault;
   assert.equal((await control({method:'outcome_reference',operation_id:item,item_id:item,title:'Recovery source',body})).status,'committed');
   if(!topicId)topicId=(await control({method:'agent_view',name:'conversation',args:{workspace_id:'w1'}})).conversation.topic_id;
   const context=await browser.newContext({viewport:{width:1280,height:1000}});
   if(fault!=='source')await context.addInitScript(fault=>{
    if(sessionStorage.getItem('962-storage-fault')==='off')return;
    const name=fault==='keep'?'setItem':'removeItem',original=Storage.prototype[name];
    Storage.prototype[name]=function(key,...rest){if(key.startsWith('notebook-quote:'))throw Error('962 '+fault+' storage refusal');return original.call(this,key,...rest);};
    window.restore962Storage=()=>{Storage.prototype[name]=original;sessionStorage.setItem('962-storage-fault','off');};
   },fault);
   page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push({key:fault,error:e.message}));
   await page.goto(facts.origin+`/?cards=${item}&view=cards`);await settle();
   const root=page.locator('#deck-page .deck-card.notebook-reading-words').first();await root.waitFor();const p=await point(root,'Chosen first sentence.');await page.mouse.move(p.x-10,p.y);await page.mouse.move(p.x+1,p.y);
   if(fault==='source')assert.equal((await control({method:'read_fault',name:'source',status:403,body:{error:{code:'FORBIDDEN',message:'962 source unavailable',retryable:false}}})).armed,true);
   const initial=fault==='clear'?quoteSave():null;initial?.catch(()=>{});
   await page.keyboard.press('Enter');
   if(fault==='keep'){
    await page.getByText('962 keep storage refusal',{exact:false}).waitFor();
    await check('private storage refusal opens no destination and alters no draft',async()=>{assert.equal(await page.locator('#reader').evaluate(el=>el.open),false);assert.equal((await saved(item))?.quotes.length??0,0);});
   }else{
    await page.getByText(fault==='clear'?'962 clear storage refusal':'962 source unavailable',{exact:false}).first().waitFor();
    if(fault==='clear'&&(await page.locator('#writing-body').inputValue()).includes('Chosen first sentence.')){await initial;records.push({phase:'observed-clear-failure-draft',draft:await saved(item)});}
    await check(fault+' refusal retains pending intent without changing the draft',async()=>{assert.equal((await saved(item))?.quotes.length??0,0);assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).some(k=>k.startsWith('notebook-quote:'))),true);});
    if(fault==='clear')await page.evaluate(()=>window.restore962Storage());
    const kept=quoteSave();kept.catch(()=>{});await page.goto(facts.origin+`/?topic=${topicId}&page=${item}&revision=1`);await settle();
    await check(fault+' recovery claims the exact quote once',async()=>{await receipt(kept,item,1,'Chosen first sentence.');assert.equal((await saved(item)).quotes.length,1);});
    await page.reload();await settle();
    await check(fault+' reload keeps the existing draft without a repeated quote',async()=>assert.equal((await saved(item)).quotes.length,1));
   }
   await page.screenshot({path:evidence+'/recovery-'+fault+'.png',fullPage:true});await context.close();
  }
 }

 if(all||process.argv.includes('--message')){
  const item='note962-message-control';
  assert.equal((await control({method:'agent_page',operation_id:item,item_id:item,topic_id:'t1',title:'Message owner control',body})).status,'committed');
  const context=await browser.newContext({viewport:{width:1100,height:1000}});page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push({key:'message',error:e.message}));
  await page.goto(facts.origin+'/?topic=t1');await settle();
  const words=page.locator('#messages .message-preview:visible').first();await words.waitFor();const before=await words.innerHTML();
  for(const phase of ['before','after']){
   if(phase==='after'){
    await page.goto(facts.origin+`/?topic=t1&page=${item}`);await settle();
    await page.locator('#notebook-sheet-dialog .deck-card.notebook-reading-words').first().waitFor();
    await page.locator('.notebook-sheet-close').click();
    await check('ordinary message formatted DOM remains byte-identical after Notebook display',async()=>assert.equal(await words.innerHTML(),before));
   }
   const p=await point(words,'Source 1 exact passage.');await page.mouse.move(p.x-10,p.y);await page.mouse.move(p.x+1,p.y);
   await check(phase+' Notebook: original message hover retains its own shared highlight',async()=>{assert.equal(await page.evaluate(()=>[...CSS.highlights.get('lit-passage')??[]].map(r=>r.toString()).join('')),'Source 1 exact passage. ');assert.equal(await lit(),'');});
   const kept=page.waitForResponse(r=>{try{const e=r.request().postDataJSON();return e.kind==='draft.save'&&e.args.quotes?.at(-1)?.source.kind==='message';}catch{return false;}});kept.catch(()=>{});await page.keyboard.press('Enter');
   await check(phase+' Notebook: original message Return keeps its exact source and revision',async()=>{const r=await kept,e=r.request().postDataJSON();assert.equal((await r.json()).status,'committed');assert.deepEqual(e.args.quotes.at(-1),{source:{...facts.sources[1],revision:1},excerpt:'Source 1 exact passage. '});});
   await page.locator('#reader-close').click();await page.mouse.move(0,0);
  }
  await context.close();
 }
 assert.deepEqual(errors,[]);
}catch(error){failures.push({fatal:error.stack});if(page&&!page.isClosed())await page.screenshot({path:evidence+'/failure.png',fullPage:true}).catch(()=>{});}
finally {
  if (browser) {
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n').map(line => { const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line); return m && { pid: +m[1], parent: +m[2], command: m[3] }; }).filter(Boolean);
    const owned = new Set(rows.filter(r => r.command.includes(marker) || profile && r.command.includes(profile)).map(r => r.pid));
    for (let n = 0; n < rows.length; n++) for (const r of rows) if (owned.has(r.parent)) owned.add(r.pid);
    await browser.close(); const live = new Set(execFileSync('ps', ['-axo', 'pid='], { encoding: 'utf8' }).trim().split(/\s+/).map(Number)); const remaining = [...owned].filter(pid => live.has(pid));
    const profileAbsent = await access(profile).then(() => false, error => { if (error.code === 'ENOENT') return true; throw error; });
    records.push({ browserClosed: !browser.isConnected(), profile, profileAbsent, ownedPids: [...owned], remaining }); assert.deepEqual(remaining, []); assert.equal(profileAbsent, true);
  }
  child.stdin.end(); const ended = await exit;
  let absent = false; try { process.kill(child.pid, 0); } catch (error) { absent = error.code === 'ESRCH'; }
  const portClosed = !facts || await new Promise(resolve => { const s = net.connect(new URL(facts.origin).port, '127.0.0.1'); s.on('connect', () => { s.destroy(); resolve(false); }); s.on('error', () => resolve(true)); s.setTimeout(1000, () => { s.destroy(); resolve(false); }); });
  records.push({ fixture: ended, fixturePid: child.pid, absent, port: facts && new URL(facts.origin).port, portClosed, errors, failures });
  await writeFile(`${evidence}/results.json`, JSON.stringify(records, null, 2)); assert.deepEqual(ended, { code: 0, signal: null }); assert.equal(absent, true); assert.equal(portClosed, true);
}
if (failures.length) { process.stderr.write(JSON.stringify(failures, null, 2) + '\n'); process.exitCode = 1; }
