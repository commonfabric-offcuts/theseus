import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { notebookSheetChecks } from './notebook_sheet_native.mjs';

// Notebook pages in the real browser against the real server: an outcome's
// pages sit in the sidebar after its topics; a page the reader has read and
// an agent revised since wears its new revisions as a count, live, with no
// reload; opening it shows what changed since, as marked words, and puts the
// light out; a page in the topic's own Notebook wears the same light; at 390 wide, in light and in dark, the pages are in the
// rail "☰ Topics" opens over the topic, nothing leaves the screen and the changed words stay readable; on the outcome's own page the pages
// follow the topics; a page opens in the composer over the feed (item 396), and what changed shows there; and a page's link opens the page as
// it stands in the composer, or at a revision in the Reader or in place, from the address bar
// or from a message's words, and the Reader's ⋯ copies it. On the cards page,
// a card being written moves with Tab and ⇧Tab, and goes on into the card
// beside with ↑ and ↓, each act read back from the page as saved, while the
// keys an input method composes with stay its own.
export async function notebookChecks({ check, page, until, control, view, facts, shot }) {
  await check('notebook a competing revision is reviewed without replacing active writing and a second tab cannot take its journal', async () => {
    const item='notebook-writing-conflict';
    assert.equal((await control({method:'outcome_reference',operation_id:item,item_id:item,title:'Concurrent notes',body:'Original writing.'})).status,'committed');
    const p=await page(item,null,true,{url:`${facts.origin}/?cards=${item}&view=text`,beforeNavigate:async q=>{
      await q.send('Page.addScriptToEvaluateOnNewDocument',{source:`const originalFetch=fetch.bind(globalThis);let firstSave=true;globalThis.fetch=async(...args)=>{let kind;try{kind=JSON.parse(args[1]?.body).kind}catch{}if(kind==='memory.revise'&&firstSave){firstSave=false;await new Promise(done=>globalThis.releaseNotebookSave=done);}return originalFetch(...args);};`});
    }});
    await until(()=>p.evaluate("document.body.dataset.ready==='true' && document.querySelector('#notebook-text')?.value==='Original writing.'"),'Notebook opens');
    await p.point('#notebook-text');await p.key('a',4);await p.send('Input.insertText',{text:'My unconfirmed writing.'});
    await until(()=>p.evaluate("Boolean(globalThis.releaseNotebookSave)"),'the first save is held at the transport boundary');
    assert.equal((await control({method:'memory_revise',operation_id:item+'-remote',item_id:item,expected_revision:1,title:'Concurrent notes',body:'The agent added this.'})).status,'committed');
    await p.evaluate('globalThis.releaseNotebookSave()');
    await until(()=>p.evaluate("!document.querySelector('.notebook-conflict').hidden"),'remote change is offered for review');
    assert.equal(await p.evaluate("document.querySelector('#notebook-text').value"),'My unconfirmed writing.','active field is not replaced');
    assert.equal(await p.evaluate("document.querySelector('.notebook-latest').textContent"),'The agent added this.');
    await p.key('a',4);await p.send('Input.insertText',{text:'My reviewed version.'});
    const q=await page(item+'-other-tab',null,true,{url:`${facts.origin}/?cards=${item}&view=text`});
    await until(()=>q.evaluate("document.body.dataset.ready==='true'"),'other tab reads');
    assert.equal(await q.evaluate("document.querySelector('#notebook-text').readOnly"),true);
    assert.match(await q.evaluate("document.querySelector('.deck-status').textContent"),/another tab/);
    await q.close();
    await p.point('.notebook-conflict button:first-of-type');
    await until(async()=>(await view('memory_current',{item_id:item})).body==='My reviewed version.','explicit choice saves against the competing revision');
    assert.equal((await view('memory_current',{item_id:item})).source_ref.revision,3);
    await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await until(()=>p.evaluate('innerWidth===390'),'phone width');
    assert.equal(await p.evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'writing fits on a phone');
    await shot(p,'notebook-writing-phone');
    assert.deepEqual(p.errors,[]);assert.deepEqual(q.errors,[]);await p.close();
  });
  await check('notebook a permission refusal offers native Try again and Discard controls without losing words',async()=>{
    const item='notebook-permission-recovery';
    assert.equal((await control({method:'outcome_reference',operation_id:item,item_id:item,title:'Retained writing',body:'Saved words.'})).status,'committed');
    const p=await page(item,null,true,{url:`${facts.origin}/?cards=${item}&view=text`,beforeNavigate:async q=>{
      await q.send('Page.addScriptToEvaluateOnNewDocument',{source:`
        globalThis.notebookRefuse=true;const originalFetch=fetch.bind(globalThis);
        globalThis.fetch=async(...args)=>{let e;try{e=JSON.parse(args[1]?.body)}catch{}
          if(e?.kind==='memory.revise'&&notebookRefuse)return new Response(JSON.stringify({instance_id:e.instance_id,operation_id:e.operation_id,kind:e.kind,status:'rejected',recorded:false,error:{code:'FORBIDDEN',message:'Access temporarily removed'}}),{status:200,headers:{'content-type':'application/json'}});
          return originalFetch(...args);
        };`});
    }});
    await until(()=>p.evaluate("document.body.dataset.ready==='true' && document.querySelector('#notebook-text')?.value==='Saved words.'"),'Notebook opens');
    await p.point('#notebook-text');await p.key('a',4);await p.send('Input.insertText',{text:'Retained words.'});
    await until(()=>p.evaluate("document.querySelector('#notebook-text').readOnly && document.querySelectorAll('.deck-status button').length===2"),'refusal offers recovery');
    assert.equal(await p.evaluate("document.querySelector('#notebook-text').value"),'Retained words.');
    await p.evaluate('notebookRefuse=false');await p.point('.deck-status .deck-again');
    await until(async()=>(await view('memory_current',{item_id:item})).body==='Retained words.','Try again saves with restored access');
    await p.evaluate('notebookRefuse=true');await p.point('#notebook-text');await p.key('a',4);await p.send('Input.insertText',{text:'Discard these words.'});
    await until(()=>p.evaluate("document.querySelector('#notebook-text').readOnly && document.querySelectorAll('.deck-status button').length===2"),'another refusal offers recovery');
    await p.point('.deck-status button:last-child');
    await until(()=>p.evaluate("document.querySelector('#notebook-text').value==='Retained words.'"),'Discard restores the saved words');
    assert.equal((await view('memory_current',{item_id:item})).body,'Retained words.');
    assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('notebook recovery stores image bytes once and removes confirmed journals, including a cached-page return', async () => {
    const item='notebook-journal-storage';
    assert.equal((await control({method:'outcome_reference',operation_id:item,item_id:item,title:'Recovery storage',body:'Words.'})).status,'committed');
    const p=await page(item,null,true,{url:`${facts.origin}/?cards=${item}&view=text`,beforeNavigate:async q=>{
      await q.send('Page.addScriptToEvaluateOnNewDocument',{source:`
        globalThis.imagePuts=0;globalThis.inlineBytePuts=0;
        const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){if(this.name==='images')imagePuts++;if(this.name==='writing'&&value?.images?.some(i=>i.bytes))inlineBytePuts++;return put.call(this,value,...args);};
        const originalFetch=fetch.bind(globalThis);let firstUpload=true;globalThis.fetch=async(...args)=>{if(String(args[0]).includes('/api/media/upload')&&firstUpload){firstUpload=false;await new Promise(done=>globalThis.releaseNotebookUpload=done);}return originalFetch(...args);};
      `});
    }});
    await until(()=>p.evaluate("document.body.dataset.ready==='true'"),'writing page opens');
    const bytes=(await readFile(new URL('fixtures/media/one.png',import.meta.url))).toString('base64');
    await p.point('#notebook-text');
    await p.evaluate(`(()=>{const d=new DataTransfer();d.items.add(new File([Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0))],'kept.png',{type:'image/png'}));document.querySelector('#notebook-text').dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true}));})()`);
    await until(()=>p.evaluate('Boolean(globalThis.releaseNotebookUpload)'),'image upload is held');
    for(const text of [' One.',' Two.',' Three.'])await p.send('Input.insertText',{text});
    await until(async()=>(await view('memory_current',{item_id:item})).body.includes('Three.'),'words save while the image waits');
    assert.deepEqual(await p.evaluate('({bytes:imagePuts,inline:inlineBytePuts})'),{bytes:1,inline:0},'typing never rewrites the bytes or embeds them in the writing record');
    await p.evaluate('globalThis.releaseNotebookUpload()');
    await until(async()=>(await view('memory_current',{item_id:item})).attachments.length===1,'image is associated and confirmed');
    const held=()=>p.evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('theseus-notebook-writing-v1',2);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('writing','readonly'),q=tx.objectStore('writing').getAll();q.onsuccess=()=>resolve(q.result.filter(v=>v.binding.item_id===${JSON.stringify(item)}).length);tx.oncomplete=()=>db.close();};})`);
    await until(async()=>await held()===0,'confirmed journal is deleted');
    const before=await p.evaluate('performance.timeOrigin');
    await p.evaluate("dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))");
    await until(async()=>{try{return await p.evaluate(`document.body.dataset.ready==='true'&&performance.timeOrigin!==${before}`)}catch{return false;}},'a cached-page restore reloads a live writer');
    await p.point('#notebook-text');await p.send('Input.insertText',{text:' Still saving.'});
    await until(async()=>(await view('memory_current',{item_id:item})).body.includes('Still saving.'),'writing after the restored-page event still saves');
    assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('notebook images paste and img picker save verified page attachments in Text and Cards', async () => {
    const item='notebook-writing-images';
    assert.equal((await control({method:'outcome_reference',operation_id:item,item_id:item,title:'Images in notes',body:'## First\n\nWriting.\n'})).status,'committed');
    const topicId=(await view('conversation',{workspace_id:'w1'})).conversation.topic_id;
    assert.equal((await control({method:'agent_message',operation_id:item+'-image',topic_id:topicId,body:'A chart to reuse.',attachments:[{name:'notebook-chart.png',image:'screen.png'}]})).status,'committed');
    const p=await page(item,null,true,{url:`${facts.origin}/?cards=${item}&view=text`});
    await until(()=>p.evaluate("document.body.dataset.ready==='true'"),'Notebook writing opens');
    // Injected clipboard payload boundary, not a claim about the OS clipboard.
    const bytes=(await readFile(new URL('fixtures/media/one.png',import.meta.url))).toString('base64');
    await p.point('#notebook-text');
    await p.evaluate(`(()=>{const d=new DataTransfer();d.items.add(new File([Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0))],'notebook-paste.png',{type:'image/png'}));document.querySelector('#notebook-text').dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true}));})()`);
    const current=()=>view('memory_current',{item_id:item});
    await until(async()=>(await current()).attachments.length===1,'pasted bytes publish and become a Notebook attachment');
    assert.equal((await current()).attachments[0].name,'notebook-paste.png');
    await p.point('.notebook-views button:nth-child(2)');await p.point('.deck-card .deck-words');
    await until(()=>p.evaluate("Boolean(document.querySelector('.deck-writing textarea'))"),'card opens');
    await p.key('a',4);await p.send('Input.insertText',{text:'First\nWriting. #imgnotebook-chart'});
    await until(()=>p.evaluate("document.querySelector('.image-option-name')?.textContent==='notebook-chart.png'"),'img picker lists the topic image');
    await p.key('Enter');
    await until(async()=>(await current()).attachments.length===2,'picked image is copied, published and saved to the same page');
    assert.equal((await current()).body.includes('#imgnotebook-chart'),false,'the picker token is removed from the actual saved body');
    assert.ok((await current()).body.includes('Writing.'),'picking an image preserves the surrounding words');
    await p.point('.notebook-views button:first-child');
    await shot(p,'notebook-writing-images');
    assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('notebook Text and Cards share exact words and both save while still writing', async () => {
    const item='notebook-shared-writing', original='# Notes\n\n## First\n\nOriginal words.\n\n## Second\n\nKeep these.\n';
    assert.equal((await control({method:'outcome_reference',operation_id:item,item_id:item,title:'Shared writing',body:original})).status,'committed');
    const p=await page(item,null,true,{url:`${facts.origin}/?cards=${item}&view=text`});
    await until(()=>p.evaluate("document.body.dataset.ready==='true' && document.querySelector('#notebook-text')?.value.length>0"),'Text opens with the page');
    const current=()=>view('memory_current',{item_id:item});
    const revision=(await current()).source_ref.revision;
    await p.point('.notebook-views button:nth-child(2)');
    await until(()=>p.evaluate("document.querySelector('.notebook-views button:nth-child(2)').getAttribute('aria-pressed')==='true'"),'Cards is selected');
    assert.equal((await current()).source_ref.revision,revision,'switching views makes no revision');
    await p.point('.notebook-views button:first-child');
    await p.point('#notebook-text'); await p.key('a',4);
    const text=original.replace('Original words.','Written in Text.');
    await p.send('Input.insertText',{text});
    await until(async()=>(await current()).body===text,'Text saves before leaving the field');
    assert.equal(await p.evaluate("document.activeElement.id"),'notebook-text','autosave leaves the cursor in Text');
    await p.point('.notebook-views button:nth-child(2)');
    await until(()=>p.evaluate("document.querySelector('.deck-words')?.textContent==='Written in Text.'"),'Cards shows those same words');
    await p.point('.deck-card .deck-words');
    await until(()=>p.evaluate("Boolean(document.querySelector('.deck-writing textarea'))"),'card opens to write');
    await p.key('a',4); await p.send('Input.insertText',{text:'First\nWritten in Cards.'});
    await until(async()=>(await current()).body.includes('Written in Cards.'),'unfinished card autosaves');
    assert.equal(await p.evaluate("document.activeElement.matches('.deck-writing textarea')"),true,'autosave preserves card focus');
    await p.point('.notebook-views button:first-child');
    await until(()=>p.evaluate("document.querySelector('#notebook-text').value.includes('Written in Cards.')"),'Text immediately includes the unfinished card');
    assert.equal((await current()).body.includes('Keep these.'),true,'other cards retain their words');
    await shot(p,'notebook-text-cards-shared');
    await p.close();
    const q=await page(item+'-reload',null,true,{url:`${facts.origin}/?cards=${item}&view=text`});
    await until(()=>q.evaluate("document.querySelector('#notebook-text')?.value.includes('Written in Cards.')"),'reload reads the saved revision');
    assert.deepEqual(p.errors,[]); assert.deepEqual(q.errors,[]); await q.close();
  });
  const id = 'notebook-release-plan', row = `#outcome-references-list .reference[data-id="${id}"]`;
  const light = p => p.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(row + ' .unread-count')});return b?{text:b.textContent,className:b.className,said:document.querySelector(${JSON.stringify(row + ' .sr-only')})?.textContent}:null})()`);
  const listed = async () => (await view('memory_items', { owner_scope: { kind: 'workspace', id: 'w1' } })).items.find(item => item.id === id);
  let revision = 0;
  const revise = async body => {
    const answer = revision === 0
      ? await control({ method: 'outcome_reference', operation_id: `${id}-create`, item_id: id, title: 'Release plan', body })
      : await control({ method: 'memory_revise', operation_id: `${id}-revise-${revision}`, item_id: id, expected_revision: revision, title: 'Release plan', body });
    assert.equal(answer.status, 'committed', JSON.stringify(answer)); revision += 1;
  };
  const openRow = async p => {
    await p.evaluate(`document.querySelector(${JSON.stringify(row)}).scrollIntoView({block:'center',inline:'center',behavior:'instant'})`);
    await until(()=>p.evaluate(`new Promise(resolve=>{
      const e=document.querySelector(${JSON.stringify(row)});e.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
      const a=e.getBoundingClientRect();requestAnimationFrame(()=>{const b=e.getBoundingClientRect();resolve(a.top===b.top&&a.bottom===b.bottom&&b.top>=0&&b.bottom<=innerHeight);});
    })`),'Notebook row stays in view across an animation frame');
    await p.point(row);
    await sheetShows(p, 'Release plan');
  };
  // A page opens in the composer over the feed (item 396), what changed since it was read above its cards.
  const SHEET_PAGE = '#new-message-sheet .notebook-sheet-page:not([hidden])', CHANGES = SHEET_PAGE + ' .notebook-sheet-changes';
  const sheetShows = (p, title) => until(() => p.evaluate(`document.querySelector('#new-message-sheet').open && !document.querySelector('#reader').open
    && document.querySelector('.notebook-sheet-title')?.textContent === ${JSON.stringify(title)} && document.querySelector(${JSON.stringify(SHEET_PAGE + ' .notebook-text')})?.value.length > 0`), `the composer shows the page ${title}`);
  const closeSheet = async p => { await p.point('#new-message-sheet .notebook-sheet-close'); await until(() => p.evaluate("!document.querySelector('#new-message-sheet').open"), 'the sheet closes'); };
  const changesShown = p => p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(CHANGES)});return Boolean(c&&!c.hidden&&c.querySelector('.source-changes'))})()`);
  // WCAG contrast of an element's text on the nearest opaque background behind it.
  const contrast = (p, selector) => p.evaluate(`(()=>{
    const rgb=c=>c.match(/[\\d.]+/g).map(Number);
    const lum=([r,g,b])=>[r,g,b].map(v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[0.2126,0.7152,0.0722][i],0);
    const e=document.querySelector(${JSON.stringify(selector)});let at=e,bg=null;
    while(at){const c=rgb(getComputedStyle(at).backgroundColor);if(c.length<4||c[3]>0.99){if(c.length>=3&&!(c.length===4&&c[3]===0)){bg=c;break;}}at=at.parentElement;}
    bg??=rgb(getComputedStyle(document.body).backgroundColor);
    const a=lum(rgb(getComputedStyle(e).color)),b=lum(bg);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
  })()`);

  await check('notebook creation pencil opens a title line and creates the exact scoped page ready to write', async () => {
    // A topic's pencil sits beside the Notebook section of the right rail, also
    // for a topic whose Notebook is still empty; the outcome's sits in the outline.
    const empty = ['t-notebook-empty', 't-notebook-empty-phone'];
    await control({method:'navigation_topics', topics:empty.map(id => ({id, title:'No pages yet'}))});
    for (const [scope, phone] of [[{kind:'workspace',id:'w1'},false],[{kind:'topic',id:'t1'},false],[{kind:'topic',id:empty[0]},false],[{kind:'topic',id:empty[1]},true],[{kind:'workspace',id:'w1'},true]]) {
      const label = scope.id + (phone ? '-phone' : '-desktop'), name = 'Create notes in ' + label;
      const p = await page('notebook-create-' + label, null, true, {url: `${facts.origin}/?topic=${scope.kind === 'topic' ? scope.id : 't1'}`, beforeNavigate: async q => {
        if (phone) {
          await q.send('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true});
          await q.send('Emulation.setTouchEmulationEnabled', {enabled:true,maxTouchPoints:1});
        }
      }});
      const press = async selector => {
        if (!phone) return p.point(selector);
        // A finger aims once the target holds its place (the right rail's sheet slides up).
        let last = null;
        await until(async () => { const now = await p.box(selector), same = Boolean(last && now) && ['x','y','width','height'].every(key => now[key] === last[key]); last = now; return same; }, selector + ' holds its place');
        const b = last, x = b.x + b.width/2, y = b.y + b.height/2;
        assert.ok(x>=0 && y>=0 && x<390 && y<844, selector + ' is on screen');
        await p.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x,y}]});
        await p.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
      };
      const host = scope.kind === 'workspace' ? '#outcome-references' : '#things .things-sec[data-key="notebook"]';
      const button = host + (scope.kind === 'workspace' ? ' .notebook-create' : ' > summary .notebook-create'), input = host + ' input';
      if (phone) {
        const opener = scope.kind === 'workspace' ? '#rail-open' : '#things-open';
        await until(() => p.evaluate(`document.body.dataset.ready==='true' && Boolean(document.querySelector(${JSON.stringify(opener)}))`), 'the page is up');
        await press(opener);
        await until(() => p.evaluate(scope.kind === 'workspace' ? `document.getElementById('rail').classList.contains('open')` : `document.documentElement.hasAttribute('data-things-open')`), 'the Notebook drawer opens');
      }
      await until(() => p.evaluate(`document.body.dataset.ready==='true' && document.querySelector(${JSON.stringify(button)})?.checkVisibility()===true`), 'the Notebook pencil is available');
      if (scope.kind === 'topic') {
        // Beside the rail's Notebook heading, and nowhere in the page between the rails.
        const where = await p.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(button)}).getBoundingClientRect(),h=document.querySelector(${JSON.stringify(host + ' > summary')}).getBoundingClientRect();
          return {heading:document.querySelector(${JSON.stringify(host + ' > summary > span')}).textContent,beside:b.top>=h.top-1&&b.bottom<=h.bottom+1&&b.right<=h.right+1,
            inMain:document.querySelectorAll('#main .notebook-create').length,inRail:document.querySelectorAll('#things .notebook-create').length}})()`);
        assert.deepEqual(where, {heading:'Notebook',beside:true,inMain:0,inRail:1}, 'the topic pencil is beside the right rail\'s Notebook heading');
        if (empty.includes(scope.id)) assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(host + ' .things-body')}).textContent`), 'No pages yet.', 'an empty topic Notebook keeps its heading');
      }
      await p.evaluate(`document.querySelector(${JSON.stringify(button)}).scrollIntoView({block:'center'})`);
      await press(button);
      await until(() => p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(input)})`), 'one title line, focused');
      if (scope.kind === 'topic') await shot(p, 'notebook-create-' + label + '-line');
      await p.send('Input.insertText', {text:'Cancelled notes'});
      await p.key('Escape');
      assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(input)}))`), false, 'Escape closes the line');
      const before = await view('memory_items', {owner_scope:scope});
      assert.equal(before.items.some(item => item.title==='Cancelled notes'), false, 'Escape creates nothing');
      if (phone) await press(button);
      else {
        // The keys reach it too: Escape gives the focus back to the pencil, and Return presses it.
        assert.equal(await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(button)})`), true, 'Escape gives the focus back to the pencil');
        await p.key('Enter');
      }
      await until(() => p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(input)})`), 'the line opens again, focused');
      await p.key('a', 4);
      await p.send('Input.insertText', {text:name});
      await p.key('Enter');
      // The new page comes up in the composer over the feed, its first card ready to write (item 396).
      const first = '#new-message-sheet.notebook-mode .notebook-sheet-page:not([hidden]) .deck-writing textarea';
      await until(() => p.evaluate(`document.querySelector('#new-message-sheet').open && document.querySelector('.notebook-sheet-title')?.textContent===${JSON.stringify(name)} && Boolean(document.querySelector(${JSON.stringify(first)}))`), 'the new page opens in the composer with its first card ready to write');
      assert.equal(await p.evaluate(`new URL(location.href).searchParams.has('cards')`), false, 'over the page it was started from');
      const id = (await view('memory_items', {owner_scope:scope, limit:100})).items.find(item => item.title === name)?.id;
      const made = await view('memory_current', {item_id:id});
      assert.deepEqual(made.owner_scope, scope); assert.equal(made.title, name); assert.equal(made.body, '');
      assert.equal(await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(first)})`), true, 'the cursor is in the first card');
      await p.send('Input.insertText', {text:'First card\nThe new page is writable.'});
      await p.key('Escape');
      await until(async () => (await view('memory_current',{item_id:id})).body.includes('The new page is writable.'), 'the first card is saved in Core');
      await shot(p, 'notebook-create-' + label);
      if (phone) await press('#new-message-sheet .notebook-sheet-close'); else await p.key('Escape');
      await until(() => p.evaluate(`!document.querySelector('#new-message-sheet').open`), 'the sheet closes');
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('notebook a page read and revised since wears its new revisions in the sidebar until opened, and opening it shows what changed', async () => {
    await revise('Ship on Friday.\nDan reviews the notes.\n');
    const p = await page('notebook-light', null, true);
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(row)}))`), 'the page is listed in the sidebar');
    assert.equal(await p.evaluate(`document.querySelector('.rail').contains(document.querySelector(${JSON.stringify(row)}))`), true);
    assert.equal(await light(p), null, 'a page never read wears no light');
    await openRow(p);
    await until(async () => (await listed())?.read_revision === 1, 'Core records the read');
    assert.equal(await changesShown(p), false, 'nothing to compare on a first read');
    await closeSheet(p);
    await revise('Ship on Monday.\nDan reviews the notes.\n');
    const lit = await until(() => light(p), 'the light comes on live, with no reload');
    assert.deepEqual(lit, { text: '1', className: 'unread-count changed', said: ', changed since you read it, 1 new revision' });
    // The light is the unread count's: same shape and colour as a topic's.
    const looks = await p.evaluate(`(()=>{const s=getComputedStyle(document.querySelector(${JSON.stringify(row + ' .unread-count')}));return [s.backgroundColor,s.borderRadius,s.fontSize]})()`);
    const probe = await p.evaluate(`(()=>{const b=document.createElement('span');b.className='unread-count';document.querySelector('#topics').append(b);const s=getComputedStyle(b);const v=[s.backgroundColor,s.borderRadius,s.fontSize];b.remove();return v})()`);
    assert.deepEqual(looks, probe);
    await shot(p, 'notebook-sidebar-light');
    await openRow(p);
    await until(() => changesShown(p), 'what changed shows above the page');
    const changes = await p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(CHANGES)}),q=s=>[...c.querySelectorAll(s)].map(e=>e.lastChild.previousSibling.textContent);
      return {title:c.querySelector('summary').textContent,open:c.querySelector('details').open,added:q('.changes-added'),removed:q('.changes-removed'),
      struck:getComputedStyle(c.querySelector('.changes-removed')).textDecorationLine,
      above:c.compareDocumentPosition(document.querySelector(${JSON.stringify(SHEET_PAGE + ' .deck-bar')}))===Node.DOCUMENT_POSITION_FOLLOWING}})()`);
    assert.deepEqual(changes, { title: 'What changed since you read revision 1', open: true, added: ['Monday'], removed: ['Friday'], struck: 'line-through', above: true });
    await shot(p, 'notebook-sheet-changes');
    await until(async () => (await light(p)) === null, 'the light goes out once the page is read');
    await closeSheet(p);
    assert.deepEqual(p.errors, []);
  });

  await check('notebook a page in the topic\'s own Notebook wears the same light, live, and opening it puts the light out', async () => {
    const seeded = await control({ method: 'seed', memory_items: 1 }), topicPage = seeded.item_ids[0];
    const card = `#memory-items .memory-card[data-id="${topicPage}"]`;
    const cardLight = p => p.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(card + ' .unread-count')});return b?{text:b.textContent,className:b.className,said:document.querySelector(${JSON.stringify(card + ' .sr-only')})?.textContent}:null})()`);
    const read = async () => (await view('memory_items', { owner_scope: { kind: 'topic', id: 't1' } })).items.find(item => item.id === topicPage)?.read_revision;
    const p = await page('notebook-topic-light', null, true);
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card)}))`), 'the topic\'s Notebook lists the page');
    assert.equal(await cardLight(p), null, 'a page never read wears no light');
    const openCard = async () => {
      await p.evaluate(`document.querySelector(${JSON.stringify(card)}).scrollIntoView({block:'center'})`);
      await p.point(card);
      await sheetShows(p, 'Fixture item 0');
    };
    await openCard();
    await until(async () => (await read()) === 1, 'Core records the read');
    await closeSheet(p);
    const answer = await control({ method: 'memory_revise', operation_id: `${topicPage}-revise`, item_id: topicPage, expected_revision: 1, title: 'Fixture item 0', body: 'Fixture Notebook body, revised.' });
    assert.equal(answer.status, 'committed', JSON.stringify(answer));
    assert.deepEqual(await until(() => cardLight(p), 'the light comes on live, with no reload'),
      { text: '1', className: 'unread-count changed', said: ', changed since you read it, 1 new revision' });
    await shot(p, 'notebook-topic-light');
    await openCard();
    await until(() => changesShown(p), 'what changed shows above the page');
    await until(async () => (await cardLight(p)) === null, 'the light goes out once the page is read');
    // A page with nothing to compare, opened next, carries none of the changes just shown.
    await closeSheet(p);
    await openRow(p);
    await until(async () => (await listed())?.read_revision === (await listed())?.revision, 'it is read as it stands');
    assert.equal(await changesShown(p), false, 'the next page shows none of the first page\'s changes');
    await closeSheet(p);
    assert.deepEqual(p.errors, []);
  });

  await check('notebook at 390 wide, in light and in dark, the pages and what changed stay on screen and readable', async () => {
    for (const scheme of ['light', 'dark']) {
      const p = await page(`notebook-phone-${scheme}`, null, true);
      await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(row)}))`), 'the page is listed');
      await revise(`Ship on ${scheme === 'light' ? 'Tuesday' : 'Wednesday'}.\nDan reviews the notes, and Warp signs off.\n`);
      await until(() => light(p), 'the light comes on');
      // On a phone the pages are in the rail, folded behind "☰ Topics" over the topic.
      await p.point('#rail-open');
      await until(() => p.evaluate("document.getElementById('rail').classList.contains('open')"), 'the rail opens over the topic');
      const fit = await p.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(row)}).getBoundingClientRect(),d=document.getElementById('rail').getBoundingClientRect();
        return {page:document.documentElement.scrollWidth,height:r.height,left:r.left,right:r.right,drawer:[d.left,d.right]}})()`);
      assert.ok(fit.page <= 390, `no sideways page scroll: ${fit.page}`);
      assert.ok(fit.height >= 44 && fit.left >= fit.drawer[0] && fit.right <= fit.drawer[1] + 0.5, `a touch-sized row inside the open rail: ${JSON.stringify(fit)}`);
      assert.ok(await contrast(p, row) >= 4.5, 'the row title is readable');
      await shot(p, `notebook-phone-${scheme}-sidebar`);
      await openRow(p);
      assert.equal(await p.evaluate("document.getElementById('rail').classList.contains('open')"), false, 'opening the page folds the rail away');
      await until(() => changesShown(p), 'what changed shows');
      const box = await p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(CHANGES)}).getBoundingClientRect(),d=document.querySelector('#new-message-sheet').getBoundingClientRect();return {left:c.left,right:c.right,page:document.documentElement.scrollWidth,sheet:[d.left,d.right]}})()`);
      assert.ok(box.left >= 0 && box.right <= 390 && box.page <= 390 && box.sheet[0] >= 0 && box.sheet[1] <= 390, `the changes stay inside the screen: ${JSON.stringify(box)}`);
      for (const selector of [`${CHANGES} .changes-added`, `${CHANGES} .changes-removed`, `${CHANGES} summary`]) {
        const ratio = await contrast(p, selector);
        assert.ok(ratio >= 4.5, `${scheme}: ${selector} contrast ${ratio.toFixed(2)}`);
      }
      await shot(p, `notebook-phone-${scheme}-changes`);
      await closeSheet(p);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('notebook an outcome page lists its pages after its topics with the same light, and one opens in the composer with what changed', async () => {
    const p = await page('notebook-outcome', null, true, { url: facts.origin + '/?workspace=w1' });
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(row)}))`), 'the page is listed on the outcome page');
    assert.equal(await p.evaluate(`document.querySelector('#outcome-page').contains(document.querySelector(${JSON.stringify(row)})) &&
      document.querySelector('#topic-navigation').compareDocumentPosition(document.querySelector('#outcome-references'))===Node.DOCUMENT_POSITION_FOLLOWING`), true);
    await revise('Ship on Thursday.\nDan reviews the notes, and Warp signs off.\n');
    await until(() => light(p), 'the light comes on');
    // The Target (item 14) and Where it stands sit above the topics and pages (D11), so the row may be below the fold.
    await p.evaluate(`document.querySelector(${JSON.stringify(row)}).scrollIntoView({block:'center'})`);
    await p.point(row);
    await sheetShows(p, 'Release plan');
    await until(() => changesShown(p), 'the page opens in the composer with what changed');
    const here = await p.evaluate(`({body:document.querySelector(${JSON.stringify(SHEET_PAGE + ' .notebook-text')}).value,inPlace:!document.querySelector('#page-here').hidden,
      added:[...document.querySelectorAll(${JSON.stringify(CHANGES + ' .changes-added')})].map(e=>e.lastChild.previousSibling.textContent)})`);
    assert.deepEqual(here, { body: 'Ship on Thursday.\nDan reviews the notes, and Warp signs off.\n', inPlace: false, added: ['Thursday'] });
    await until(async () => (await light(p)) === null, 'the light goes out');
    await shot(p, 'notebook-outcome-page');
    await closeSheet(p);
    assert.equal(await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(row)})`), true, '✕ gives the focus back to the row');
    assert.deepEqual(p.errors, []);
  });

  await check('notebook a page\'s link opens the page as it stands in the composer, and at a revision in the Reader on a topic\'s page and in place on its outcome\'s, opens here from a message, and the Reader\'s ⋯ copies it and edits it', async () => {
    const linked = (await control({ method: 'seed', memory_items: 1 })).item_ids[0];
    const first = await view('source', { source_ref: { kind: 'memory', id: linked, revision: 1 } });
    const revised = await control({ method: 'memory_revise', operation_id: `${linked}-link`, item_id: linked, expected_revision: 1, title: 'Linked page', body: 'The linked page, revised.' });
    assert.equal(revised.status, 'committed', JSON.stringify(revised));
    // The Reader draws a page's words as their Markdown reads (docs/topic-reading.md, "Formatted words"):
    // whitespace at the end is no words and is not drawn, yet its passages cover every character of the page.
    const shows = (p, title, body) => until(() => p.evaluate(`(()=>{const s=document.querySelector('#source-body'),b=${JSON.stringify(body)};
      return document.querySelector('#reader').open && document.querySelector('#reader-title').textContent === ${JSON.stringify(title)}
        && s.textContent.trimEnd() === b.trimEnd() && s.firstElementChild?.dataset.start === '0' && s.lastElementChild?.dataset.end === String(b.length)})()`), `the Reader shows ${title}`);
    const items = p => p.evaluate(`[...document.querySelectorAll('.message-menu-list [role=menuitem]')].map(b=>b.textContent)`);
    const choose = async (p, label) => {
      await p.point('#reader-menu');
      await until(async () => (await items(p)).includes(label), 'the Reader\'s ⋯ offers ' + label);
      await p.point(`.message-menu-list [role=menuitem]:nth-child(${(await items(p)).indexOf(label) + 1})`);
      await until(() => p.evaluate(`!document.querySelector('.message-menu-list')`), 'the menu closed');
    };
    // As it stands, in the composer over its topic's page; the address then names the topic alone.
    let p = await page('notebook-link-latest', null, true, { url: `${facts.origin}/?topic=t1&page=${linked}` });
    await sheetShows(p, 'Linked page');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(SHEET_PAGE + ' .notebook-text')}).value`), 'The linked page, revised.');
    assert.equal(await p.evaluate('location.search'), '?topic=t1');
    assert.deepEqual(p.errors, []);
    await p.close();
    // At a revision, in the Reader, whose ⋯ copies its two links and edits the page in the composer.
    p = await page('notebook-link-revision', null, true, { url: `${facts.origin}/?topic=t1&page=${linked}&revision=1` });
    await shows(p, first.title, first.body);
    await until(() => p.evaluate("document.getAnimations().every(a=>a.playState!=='running')"), 'the Reader settled');
    // The page's own clipboard, never the Mac's.
    await p.evaluate(`(()=>{window.copied=[];Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async text=>{window.copied.push(text)}});return true})()`);
    await p.point('#reader-menu');
    await until(async () => JSON.stringify((await items(p)).slice(0, 3)) === JSON.stringify(['Copy Link', 'Copy Link to Revision 1', 'Edit page']), 'the ⋯ offers the page\'s two links and Edit page');
    await p.point('.message-menu-list [role=menuitem]:nth-child(1)');
    await until(() => p.evaluate(`!document.querySelector('.message-menu-list')`), 'the menu closed');
    await choose(p, 'Copy Link to Revision 1');
    assert.deepEqual(await p.evaluate('window.copied'), [`${facts.origin}/?topic=t1&page=${linked}`, `${facts.origin}/?topic=t1&page=${linked}&revision=1`]);
    await shot(p, 'notebook-link-reader');
    await choose(p, 'Edit page');
    await sheetShows(p, 'Linked page');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(SHEET_PAGE + ' .notebook-text')}).value`), 'The linked page, revised.', 'Edit page opens the page as it stands in the composer, in the Reader\'s place');
    assert.deepEqual(p.errors, []);
    await p.close();
    // An outcome's page opens on the outcome's own page, in place, at its revision.
    const plan = 'notebook-linked-plan';
    for (const [n, body] of ['Ship on Friday.\nDan reviews the notes.\n', 'Ship on Monday.\nDan reviews the notes.\n'].entries()) {
      const answer = n === 0 ? await control({ method: 'outcome_reference', operation_id: `${plan}-create`, item_id: plan, title: 'Linked plan', body })
        : await control({ method: 'memory_revise', operation_id: `${plan}-revise`, item_id: plan, expected_revision: 1, title: 'Linked plan', body });
      assert.equal(answer.status, 'committed', JSON.stringify(answer));
    }
    p = await page('notebook-link-outcome', null, true, { url: `${facts.origin}/?workspace=w1&page=${plan}&revision=1` });
    await until(() => p.evaluate("!document.querySelector('#page-here').hidden && Boolean(document.querySelector('#page-here .page-here-body'))"), 'the page opens in place');
    assert.deepEqual(await p.evaluate(`({title:document.querySelector('#page-here h2').textContent,revision:document.querySelector('#page-here .muted').textContent,
      body:document.querySelector('#page-here .page-here-body').textContent,at:location.search})`),
      { title: 'Linked plan', revision: 'Notebook · revision 1', body: 'Ship on Friday.\nDan reviews the notes.\n', at: '?workspace=w1' });
    assert.deepEqual(p.errors, []);
    await p.close();
    // As it stands, on the outcome's own page, in the composer over it, nothing opening in place.
    p = await page('notebook-link-outcome-latest', null, true, { url: `${facts.origin}/?workspace=w1&page=${plan}` });
    await sheetShows(p, 'Linked plan');
    assert.deepEqual(await p.evaluate(`({body:document.querySelector(${JSON.stringify(SHEET_PAGE + ' .notebook-text')}).value,inPlace:!document.querySelector('#page-here').hidden})`),
      { body: 'Ship on Monday.\nDan reviews the notes.\n', inPlace: false }, 'the outcome page\'s link as it stands opens the page in the composer');
    assert.deepEqual(p.errors, []);
    await p.close();
    // Pasted into a message, the outcome page's link opens the page in the composer, here.
    const message = (await control({ method: 'agent_message', operation_id: 'notebook-link-message', topic_id: 't1', body: `The plan: ${facts.origin}/?workspace=w1&page=${plan} as it stands.` })).result.message_id;
    p = await page('notebook-link-message', null, true);
    const anchor = `#messages [data-id="${message}"] a.words-link`;
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(anchor)}))`), 'the message shows the link');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(anchor)}).getAttribute('href')`), `?workspace=w1&page=${plan}`);
    await p.evaluate(`document.querySelector(${JSON.stringify(anchor)}).scrollIntoView({block:'center'})`);
    await p.point(anchor);
    await sheetShows(p, 'Linked plan');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(SHEET_PAGE + ' .notebook-text')}).value`), 'Ship on Monday.\nDan reviews the notes.\n');
    assert.equal(await p.evaluate('location.search'), '?topic=t1', 'opened here, without leaving the topic');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // The cards page (docs/decks.md) on an outcome page made from `body`, and what Core holds of the page.
  const cards = async (id, body) => {
    const answer = await control({ method: 'outcome_reference', operation_id: `${id}-create`, item_id: id, title: 'Cards', body });
    assert.equal(answer.status, 'committed', JSON.stringify(answer));
    const p = await page(id, null, true, { url: `${facts.origin}/?cards=${id}` });
    await until(() => p.evaluate("document.querySelectorAll('#deck-page .deck-card').length > 0"), 'the cards show');
    return p;
  };
  const saved = (id, body, words) => until(async () => (await view('memory_current', { item_id: id })).body === body, words)
    .catch(async error => { assert.equal((await view('memory_current', { item_id: id })).body, body, words); throw error; });
  // The card being written: its words, the cursor, its depth, the title of the card that shows above it, and whether it has the focus.
  const box = p => p.evaluate(`(()=>{const f=document.querySelector('#deck-page .deck-writing textarea');if(!f)return null;
    let above=f.closest('li').previousElementSibling;while(above?.hidden)above=above.previousElementSibling;
    return {words:f.value,at:[f.selectionStart,f.selectionEnd],depth:f.closest('li').style.getPropertyValue('--depth'),above:above?.querySelector('.deck-title')?.textContent??null,focused:document.activeElement===f}})()`);
  const writing = (p, want, words) => until(async () => JSON.stringify(await box(p)) === JSON.stringify(want), words)
    .catch(async error => { assert.deepEqual(await box(p), want, words); throw error; });
  const cursor = (p, at) => p.evaluate(`(()=>{document.querySelector('#deck-page .deck-writing textarea').setSelectionRange(${at},${at});return true})()`);

  // Review probes for 302 (warp): two checks to put before the first "while a card is written" case in tests/notebook_pages_native.mjs.
  const panel = p => p.evaluate("Boolean(document.querySelector('.notebook-conflict') && !document.querySelector('.notebook-conflict').hidden)");
  await check('notebook probe 302: while a card is written, an agent’s change to another card shows on the cards and asks nothing', async () => {
    const id = 'probe302-merge', body = '## Plan\n\nShip it.\n\n## Notes\n\nDan reviews.\n\n## Risks\n\nNone yet.\n', p = await cards(id, body);
    await p.key('Enter', 4);
    await until(() => p.evaluate("Boolean(document.querySelector('#deck-page .deck-writing textarea'))"), 'Plan opens for writing');
    await p.send('Input.insertText', { text: ' Soon.' });
    // 302 saves the unfinished card; before 302 it waits for Escape. Either way nothing is left unsaved by the page's own choice.
    await until(async () => (await view('memory_current', { item_id: id })).body.includes('Soon.'), 'autosave', 4000).catch(() => {});
    const now = await view('memory_current', { item_id: id });
    const agent = await control({ method: 'memory_revise', operation_id: `${id}-agent`, item_id: id, expected_revision: now.source_ref.revision, title: 'Cards', body: now.body.replace('None yet.', 'Two risks.') });
    assert.equal(agent.status, 'committed', JSON.stringify(agent));
    await until(async () => await panel(p) || await p.evaluate("[...document.querySelectorAll('#deck-page .deck-words')].some(n=>n.textContent.includes('Two risks.'))"), 'the page hears of the agent’s change');
    assert.equal(await panel(p), false, 'a choice between whole versions is asked for, though only another card changed');
    await p.key('Escape');
    await saved(id, '## Plan\n\nShip it. Soon.\n\n## Notes\n\nDan reviews.\n\n## Risks\n\nTwo risks.\n', 'finishing Plan keeps the agent’s change to Risks and the writing on Plan');
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await check('notebook probe 302: after Use saved version, a later change elsewhere shows on the cards without asking again', async () => {
    const id = 'probe302-use-saved', body = '## Plan\n\nShip it.\n\n## Notes\n\nDan reviews.\n\n## Risks\n\nNone yet.\n', p = await cards(id, body);
    await p.key('Enter', 4);
    await until(() => p.evaluate("Boolean(document.querySelector('#deck-page .deck-writing textarea'))"), 'Plan opens for writing');
    await p.send('Input.insertText', { text: ' Soon.' });
    await saved(id, body.replace('Ship it.', 'Ship it. Soon.'), 'the unfinished card autosaves');
    let now = await view('memory_current', { item_id: id });
    assert.equal((await control({ method: 'memory_revise', operation_id: `${id}-agent-1`, item_id: id, expected_revision: now.source_ref.revision, title: 'Cards', body: now.body.replace('Ship it. Soon.', 'Changed by the agent.') })).status, 'committed');
    await until(() => panel(p), 'the change asks for a choice while Plan is written');
    await p.point('.notebook-conflict button:nth-of-type(2)');
    await until(async () => !(await panel(p)) && !(await p.evaluate("Boolean(document.querySelector('#deck-page .deck-writing textarea'))")), 'Use saved version closes the panel and the writing box');
    now = await view('memory_current', { item_id: id });
    assert.equal((await control({ method: 'memory_revise', operation_id: `${id}-agent-2`, item_id: id, expected_revision: now.source_ref.revision, title: 'Cards', body: now.body.replace('Dan reviews.', 'Dan approves.') })).status, 'committed');
    await until(async () => await panel(p) || await p.evaluate("[...document.querySelectorAll('#deck-page .deck-words')].some(n=>n.textContent.includes('Dan approves.'))"), 'the page hears of the later change');
    assert.equal(await panel(p), false, 'with no card being written, the later change asks for a choice again');
    assert.deepEqual(p.errors, []);
    await p.close();
  });


  const wPanel = p => p.evaluate("Boolean(document.querySelector('.notebook-conflict') && !document.querySelector('.notebook-conflict').hidden)");
  const wRecords = p => p.evaluate("new Promise(r=>{const q=indexedDB.open('theseus-notebook-writing-v1');q.onsuccess=()=>{const db=q.result;const c=db.transaction('writing').objectStore('writing').count();c.onsuccess=()=>{r(c.result);db.close();};};})");
  // A slow device store: every IndexedDB transaction reports its completion late.
  const wSlowStore = (p, ms) => p.evaluate(`(()=>{const d=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');Object.defineProperty(IDBTransaction.prototype,'oncomplete',{configurable:true,get(){return d.get.call(this);},set(fn){d.set.call(this,fn&&((...a)=>setTimeout(()=>fn.apply(this,a),${ms})));}});return true;})()`);
  const wViews = p => p.evaluate("performance.getEntriesByType('resource').filter(e=>e.name.endsWith('/api/view')).length");
  await check('notebook warp probe 302: while a card is written, an agent’s change to another card shows on the cards and asks nothing', async () => {
    const id = 'w302-merge', body = '## Plan\n\nShip it.\n\n## Notes\n\nDan reviews.\n\n## Risks\n\nNone yet.\n', p = await cards(id, body);
    await p.key('Enter', 4);
    await until(() => p.evaluate("Boolean(document.querySelector('#deck-page .deck-writing textarea'))"), 'Plan opens for writing');
    await p.send('Input.insertText', { text: ' Soon.' });
    await until(async () => (await view('memory_current', { item_id: id })).body.includes('Soon.'), 'autosave', 4000).catch(() => {});
    const now = await view('memory_current', { item_id: id });
    const agent = await control({ method: 'memory_revise', operation_id: `${id}-agent`, item_id: id, expected_revision: now.source_ref.revision, title: 'Cards', body: now.body.replace('None yet.', 'Two risks.') });
    assert.equal(agent.status, 'committed', JSON.stringify(agent));
    await until(async () => await wPanel(p) || await p.evaluate("[...document.querySelectorAll('#deck-page .deck-words')].some(n=>n.textContent.includes('Two risks.'))"), 'the page hears of the agent’s change');
    assert.equal(await wPanel(p), false, 'a choice between whole versions is asked for, though only another card changed');
    await p.key('Escape');
    await saved(id, '## Plan\n\nShip it. Soon.\n\n## Notes\n\nDan reviews.\n\n## Risks\n\nTwo risks.\n', 'finishing Plan keeps the agent’s change to Risks and the writing on Plan');
    const statusLine = () => p.evaluate("document.querySelector('#deck-page .deck-status > span')?.textContent ?? ''");
    await until(async () => (await statusLine()) === 'Saved to Theseus' && (await wRecords(p)) === 0, 'the page settles as saved', 5000).catch(() => {});
    const status = await statusLine(), kept = await wRecords(p);
    // Then the person switches to Text, and the agent changes Notes.
    await p.point('.notebook-views button:first-child');
    const later = await view('memory_current', { item_id: id });
    assert.equal((await control({ method: 'memory_revise', operation_id: `${id}-agent-2`, item_id: id, expected_revision: later.source_ref.revision, title: 'Cards', body: later.body.replace('Dan reviews.', 'Dan approves.') })).status, 'committed');
    await until(async () => await wPanel(p) || await p.evaluate("document.querySelector('#notebook-text').value.includes('Dan approves.')"), 'the page hears of the second change');
    const asked = await wPanel(p), offered = await p.evaluate("Boolean(document.querySelector('.notebook-conflict button:first-of-type')?.getClientRects().length)");
    let laterChangeKept = true;
    if (asked && offered) {
      // The person wrote nothing since the merge; "Save my version" is what the panel offers first.
      const shown = (await view('memory_current', { item_id: id })).source_ref.revision;
      await p.point('.notebook-conflict button:first-of-type');
      await until(async () => (await view('memory_current', { item_id: id })).source_ref.revision > shown, 'Save my version saves', 10000).catch(() => {});
      laterChangeKept = (await view('memory_current', { item_id: id })).body.includes('Dan approves.');
    }
    assert.deepEqual({ status, kept, asked, offered, laterChangeKept }, { status: 'Saved to Theseus', kept: 0, asked: false, offered: false, laterChangeKept: true }, 'after a merge: the status line, the device record, a later change in Text, and Save my version');
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await check('notebook warp probe 302: after Use saved version on the same card, a later change elsewhere shows on the cards without asking again', async () => {
    const id = 'w302-use-saved', body = '## Plan\n\nShip it.\n\n## Notes\n\nDan reviews.\n\n## Risks\n\nNone yet.\n', p = await cards(id, body);
    await p.key('Enter', 4);
    await until(() => p.evaluate("Boolean(document.querySelector('#deck-page .deck-writing textarea'))"), 'Plan opens for writing');
    await p.send('Input.insertText', { text: ' Soon.' });
    await saved(id, body.replace('Ship it.', 'Ship it. Soon.'), 'the unfinished card autosaves');
    await p.send('Input.insertText', { text: ' Maybe.' });
    let now = await view('memory_current', { item_id: id });
    assert.equal((await control({ method: 'memory_revise', operation_id: `${id}-agent-1`, item_id: id, expected_revision: now.source_ref.revision, title: 'Cards', body: now.body.replace('Ship it. Soon.', 'Ship it on Friday.') })).status, 'committed');
    await until(() => wPanel(p), 'a change to the card being written asks for a choice');
    await p.point('.notebook-conflict button:nth-of-type(2)');
    await until(async () => !(await wPanel(p)) && !(await p.evaluate("Boolean(document.querySelector('#deck-page .deck-writing textarea'))")), 'Use saved version closes the wPanel and the writing box');
    now = await view('memory_current', { item_id: id });
    assert.equal((await control({ method: 'memory_revise', operation_id: `${id}-agent-2`, item_id: id, expected_revision: now.source_ref.revision, title: 'Cards', body: now.body.replace('Dan reviews.', 'Dan approves.') })).status, 'committed');
    await until(async () => await wPanel(p) || await p.evaluate("[...document.querySelectorAll('#deck-page .deck-words')].some(n=>n.textContent.includes('Dan approves.'))"), 'the page hears of the later change');
    assert.equal(await wPanel(p), false, 'with no card being written, the later change asks for a choice again');
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await check('notebook warp probe 302: a keystroke in Text while a newer revision is being taken does not write the old words back', async () => {
    const id = 'w302-race-text';
    assert.equal((await control({ method: 'outcome_reference', operation_id: id, item_id: id, title: 'Race', body: 'Original words.' })).status, 'committed');
    const p = await page(id, null, true, { url: `${facts.origin}/?cards=${id}&view=text` });
    await until(() => p.evaluate("document.body.dataset.ready==='true' && document.querySelector('#notebook-text')?.value==='Original words.'"), 'Text opens');
    await p.point('#notebook-text');
    await wSlowStore(p, 4000);
    const before = await wViews(p);
    assert.equal((await control({ method: 'memory_revise', operation_id: `${id}-agent`, item_id: id, expected_revision: 1, title: 'Race', body: 'Agent words.' })).status, 'committed');
    // The page reads the Notebook's version, then the page itself: after the second read the writer holds the newer words.
    await until(async () => (await wViews(p)) >= before + 2, 'the page reads the newer revision');
    const shown = await p.evaluate("document.querySelector('#notebook-text').value");
    await p.evaluate("(()=>{const t=document.querySelector('#notebook-text');t.setSelectionRange(t.value.length,t.value.length);return true})()");
    await p.send('Input.insertText', { text: ' X' });
    await until(async () => (await view('memory_current', { item_id: id })).source_ref.revision >= 3 || await wPanel(p), 'the keystroke is saved, or a choice is asked', 30000);
    const after = await view('memory_current', { item_id: id }), asked = await wPanel(p);
    assert.equal(shown, 'Original words.', '(setup) the old words still showed when the key was pressed');
    assert.ok(asked || after.body.includes('Agent words.'), `the agent’s words were written over without a question: page now ${JSON.stringify(after.body)}`);
    await p.close();
  });
  await check('notebook warp probe 302: a card act while a newer revision is being taken does not write the old cards back', async () => {
    const id = 'w302-race-cards', body = '## Plan\n\nShip it.\n\n## Notes\n\nDan reviews.\n\n## Risks\n\nNone yet.\n', p = await cards(id, body);
    await wSlowStore(p, 4000);
    const before = await wViews(p);
    assert.equal((await control({ method: 'memory_revise', operation_id: `${id}-agent`, item_id: id, expected_revision: 1, title: 'Cards', body: body.replace('None yet.', 'Two risks.') })).status, 'committed');
    await until(async () => (await wViews(p)) >= before + 2, 'the page reads the newer revision');
    const shown = await p.evaluate("[...document.querySelectorAll('#deck-page .deck-words')].map(n=>n.textContent).join('|')");
    await p.key('ArrowDown', 4);
    await until(async () => (await view('memory_current', { item_id: id })).source_ref.revision >= 3 || await wPanel(p), 'the move is saved, or a choice is asked', 30000);
    const after = await view('memory_current', { item_id: id }), asked = await wPanel(p);
    assert.equal(shown.includes('Two risks.'), false, '(setup) the cards still showed the old Risks when the key was pressed');
    assert.ok(asked || after.body.includes('Two risks.'), `the agent’s change was written over without a question: page now ${JSON.stringify(after.body)}`);
    await p.close();
  });

  await check('notebook warp probe 302: a keystroke in a card being written while a newer revision is being taken keeps the agent’s change to another card', async () => {
    const id = 'w302-race-writing', body = '## Plan\n\nShip it.\n\n## Notes\n\nDan reviews.\n\n## Risks\n\nNone yet.\n', p = await cards(id, body);
    await p.key('Enter', 4);
    await until(() => p.evaluate("Boolean(document.querySelector('#deck-page .deck-writing textarea'))"), 'Plan opens for writing');
    await p.send('Input.insertText', { text: ' Soon.' });
    await saved(id, body.replace('Ship it.', 'Ship it. Soon.'), 'the unfinished card autosaves');
    await wSlowStore(p, 8000);
    const before = await wViews(p), now = await view('memory_current', { item_id: id });
    assert.equal((await control({ method: 'memory_revise', operation_id: `${id}-agent`, item_id: id, expected_revision: now.source_ref.revision, title: 'Cards', body: now.body.replace('None yet.', 'Two risks.') })).status, 'committed');
    await until(async () => (await wViews(p)) >= before + 2, 'the page reads the newer revision');
    const shown = await p.evaluate("[...document.querySelectorAll('#deck-page .deck-words')].map(n=>n.textContent).join('|')");
    await p.send('Input.insertText', { text: ' X' });
    await until(async () => (await view('memory_current', { item_id: id })).body.includes('Soon. X') || await wPanel(p), 'the keystroke is saved, or a choice is asked', 60000);
    const after = await view('memory_current', { item_id: id }), asked = await wPanel(p);
    assert.equal(shown.includes('Two risks.'), false, '(setup) the cards still showed the old Risks when the key was pressed');
    assert.ok(asked || after.body.includes('Two risks.'), `the agent’s change to Risks was written over without a question: page now ${JSON.stringify(after.body)}`);
    await p.close();
  });

  const w3Panel = p => p.evaluate("Boolean(document.querySelector('.notebook-conflict') && !document.querySelector('.notebook-conflict').hidden)");
  const w3Held = p => p.evaluate("new Promise(r=>{const q=indexedDB.open('theseus-notebook-writing-v1');q.onsuccess=()=>{const db=q.result;const s=db.transaction('writing').objectStore('writing');const c=s.getAll();c.onsuccess=()=>{r(JSON.stringify(c.result.map(v=>({conflict:Boolean(v?.conflict),body:v?.value?.body}))));db.close();};};})");
  await check('notebook warp probe 302 r3: after Discard my writing, the status does not say the words are kept', async () => {
    const item = 'w302-discard-status';
    assert.equal((await control({ method: 'outcome_reference', operation_id: item, item_id: item, title: 'Discarded writing', body: 'Saved words.' })).status, 'committed');
    const p = await page(item, null, true, { url: `${facts.origin}/?cards=${item}&view=text`, beforeNavigate: async q => {
      await q.send('Page.addScriptToEvaluateOnNewDocument', { source: `
        const originalFetch=fetch.bind(globalThis);
        globalThis.fetch=async(...args)=>{let e;try{e=JSON.parse(args[1]?.body)}catch{}
          if(e?.kind==='memory.revise')return new Response(JSON.stringify({instance_id:e.instance_id,operation_id:e.operation_id,kind:e.kind,status:'rejected',recorded:false,error:{code:'FORBIDDEN',message:'Access removed'}}),{status:200,headers:{'content-type':'application/json'}});
          return originalFetch(...args);
        };` });
    } });
    await until(() => p.evaluate("document.body.dataset.ready==='true' && document.querySelector('#notebook-text')?.value==='Saved words.'"), 'Notebook opens');
    await p.point('#notebook-text'); await p.key('a', 4); await p.send('Input.insertText', { text: 'Words to discard.' });
    await until(() => p.evaluate("document.querySelector('#notebook-text').readOnly && document.querySelectorAll('.deck-status button').length===2"), 'the refusal offers recovery');
    await p.point('.deck-status button:last-child');
    await until(() => p.evaluate("document.querySelector('#notebook-text').value==='Saved words.'"), 'Discard shows the saved words');
    const after = await p.evaluate("({status:document.querySelector('.deck-status > span')?.textContent??'',buttons:[...document.querySelectorAll('.deck-status button')].map(b=>b.textContent)})");
    assert.equal(/kept/i.test(after.status), false, `after Discard the status says: ${JSON.stringify(after)}`);
    await p.close();
  });
  await check('notebook warp probe 302 r3: after a reload with a choice pending, Text shows the kept writing and keeps what is typed', async () => {
    const id = 'w302-reload-choice';
    assert.equal((await control({ method: 'outcome_reference', operation_id: id, item_id: id, title: 'Reload', body: 'Original words.' })).status, 'committed');
    const url = `${facts.origin}/?cards=${id}&view=text`;
    let p = await page(id, null, true, { url });
    await until(() => p.evaluate("document.body.dataset.ready==='true' && document.querySelector('#notebook-text')?.value==='Original words.'"), 'Text opens');
    await p.point('#notebook-text');
    // Hold the save back so the agent's revision lands first.
    await p.evaluate("(()=>{const f=fetch.bind(globalThis);globalThis.fetch=async(...a)=>{let e;try{e=JSON.parse(a[1]?.body)}catch{}if(e?.kind==='memory.revise')await new Promise(r=>setTimeout(r,60000));return f(...a);};return true})()");
    await p.evaluate("(()=>{const t=document.querySelector('#notebook-text');t.setSelectionRange(t.value.length,t.value.length);return true})()");
    await p.send('Input.insertText', { text: ' Mine.' });
    assert.equal((await control({ method: 'memory_revise', operation_id: `${id}-agent`, item_id: id, expected_revision: 1, title: 'Reload', body: 'Agent words.' })).status, 'committed');
    await until(() => w3Panel(p), 'the agent’s revision asks for a choice', 30000).catch(() => {});
    const asked = await w3Panel(p);
    await until(async () => (await w3Held(p)).includes('"conflict":true'), 'the choice is kept on this device', 10000).catch(() => {});
    const held = await w3Held(p);
    await p.close();
    p = await page(id, null, true, { url });
    await until(() => p.evaluate("document.body.dataset.ready==='true'"), 'the page opens again');
    await until(() => w3Panel(p), 'the choice shows again', 10000).catch(() => {});
    const shown = await p.evaluate("document.querySelector('#notebook-text').value");
    await p.point('#notebook-text');
    await p.evaluate("(()=>{const t=document.querySelector('#notebook-text');t.setSelectionRange(t.value.length,t.value.length);return true})()");
    await p.send('Input.insertText', { text: ' More.' });
    await p.point('.notebook-conflict button:first-of-type');
    await until(async () => (await view('memory_current', { item_id: id })).source_ref.revision >= 3, 'Save my version saves', 15000).catch(() => {});
    const saved = (await view('memory_current', { item_id: id })).body;
    assert.deepEqual({ asked, held: held.includes('"conflict":true'), shown, saved }, { asked: true, held: true, shown: 'Original words. Mine.', saved: 'Original words. Mine. More.' }, 'a reload with a choice pending');
    await p.close();
  });

  await check('notebook warp probe 302 r3: a move past a card the agent just changed merges without a question', async () => {
    const id = 'w302-move-past', body = '## Plan\n\nShip it.\n\n## Notes\n\nDan reviews.\n\n## Risks\n\nNone yet.\n', p = await cards(id, body);
    // Hold the device write so the move is made from the cards as they showed before the agent's change.
    const slow = "(()=>{const d=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');Object.defineProperty(IDBTransaction.prototype,'oncomplete',{configurable:true,get(){return d.get.call(this);},set(fn){d.set.call(this,fn&&((...a)=>setTimeout(()=>fn.apply(this,a),8000)));}});return true;})()";
    await p.evaluate(slow);
    const before = await p.evaluate("performance.getEntriesByType('resource').filter(e=>e.name.endsWith('/api/view')).length");
    assert.equal((await control({ method: 'memory_revise', operation_id: `${id}-agent`, item_id: id, expected_revision: 1, title: 'Cards', body: body.replace('Dan reviews.', 'Dan approves.') })).status, 'committed');
    await until(async () => (await p.evaluate("performance.getEntriesByType('resource').filter(e=>e.name.endsWith('/api/view')).length")) >= before + 2, 'the page reads the newer revision');
    await p.key('ArrowDown', 4);   // Cmd-Down: Plan moves past Notes
    await until(async () => (await view('memory_current', { item_id: id })).source_ref.revision >= 3 || await w3Panel(p), 'the move is saved, or a choice is asked', 60000);
    const asked = await w3Panel(p), after = (await view('memory_current', { item_id: id })).body;
    assert.deepEqual({ asked, after }, { asked: false, after: '## Notes\n\nDan approves.\n\n## Plan\n\nShip it.\n\n## Risks\n\nNone yet.\n' }, 'Plan moved past Notes while the agent changed Notes');
    await p.close();
  });

  await check('notebook warp probe 302 r3: a move made just before the agent changes the card it passed merges without a question', async () => {
    const id = 'w302-move-then-agent', body = '## Plan\n\nShip it.\n\n## Notes\n\nDan reviews.\n\n## Risks\n\nNone yet.\n', p = await cards(id, body);
    await p.key('ArrowDown', 4);   // Cmd-Down: Plan moves past Notes; the page saves it after its usual pause
    const agent = await control({ method: 'memory_revise', operation_id: `${id}-agent`, item_id: id, expected_revision: 1, title: 'Cards', body: body.replace('Dan reviews.', 'Dan approves.') });
    assert.equal(agent.status, 'committed', `(setup) the agent wrote before the move was saved: ${JSON.stringify(agent.error ?? null)}`);
    await until(async () => (await view('memory_current', { item_id: id })).source_ref.revision >= 3 || await w3Panel(p), 'the move is saved, or a choice is asked', 30000);
    const asked = await w3Panel(p), after = (await view('memory_current', { item_id: id })).body;
    assert.deepEqual({ asked, after }, { asked: false, after: '## Notes\n\nDan approves.\n\n## Plan\n\nShip it.\n\n## Risks\n\nNone yet.\n' }, 'Plan moved past Notes; the agent changed Notes a moment later');
    await p.close();
  });

  const w3bPanel = p => p.evaluate("Boolean(document.querySelector('.notebook-conflict') && !document.querySelector('.notebook-conflict').hidden)");
  const w3bHeld = p => p.evaluate("new Promise(r=>{const q=indexedDB.open('theseus-notebook-writing-v1');q.onsuccess=()=>{const db=q.result;const s=db.transaction('writing').objectStore('writing');const c=s.getAll();c.onsuccess=()=>{r(JSON.stringify(c.result.map(v=>({conflict:Boolean(v?.conflict),body:v?.value?.body}))));db.close();};};})");
  await check('notebook warp probe 302 r3: after a reload with a choice pending, the cards show the kept writing and a new card does not replace it', async () => {
    const id = 'w302-reload-cards', body = '## Plan\n\nShip it.\n\n## Notes\n\nDan reviews.\n\n## Risks\n\nNone yet.\n';
    let p = await cards(id, body);
    await p.key('Enter', 4);
    await until(() => p.evaluate("Boolean(document.querySelector('#deck-page .deck-writing textarea'))"), 'Plan opens for writing');
    await p.send('Input.insertText', { text: ' Soon.' });
    await saved(id, body.replace('Ship it.', 'Ship it. Soon.'), 'the unfinished card autosaves');
    await p.send('Input.insertText', { text: ' Maybe.' });
    const now = await view('memory_current', { item_id: id });
    assert.equal((await control({ method: 'memory_revise', operation_id: `${id}-agent`, item_id: id, expected_revision: now.source_ref.revision, title: 'Cards', body: now.body.replace('Ship it. Soon.', 'Ship it on Friday.') })).status, 'committed');
    await until(() => w3bPanel(p), 'a change to the card being written asks for a choice');
    await until(async () => (await w3bHeld(p)).includes('"conflict":true'), 'the choice is kept on this device', 10000);
    const held = await w3bHeld(p);
    await p.close();
    p = await page(id, null, true, { url: `${facts.origin}/?cards=${id}` });
    await until(() => p.evaluate("document.body.dataset.ready==='true'"), 'the page opens again');
    await until(() => w3bPanel(p), 'the choice shows again', 10000).catch(() => {});
    const again = await w3bPanel(p), shownCards = await p.evaluate("document.querySelectorAll('#deck-page .deck-card').length"), focus = await p.evaluate("document.activeElement?.tagName+'.'+(document.activeElement?.className??'')");
    await p.key('Enter');
    const writing = await until(() => p.evaluate("Boolean(document.querySelector('#deck-page .deck-writing textarea'))"), 'a new card opens for writing', 5000).then(() => true, () => false);
    if (writing) { await p.send('Input.insertText', { text: 'New' }); await p.key('Escape'); }
    const offered = await p.evaluate("Boolean(document.querySelector('.notebook-conflict button:first-of-type')?.getClientRects().length)");
    if (offered) await p.point('.notebook-conflict button:first-of-type');
    await until(async () => (await view('memory_current', { item_id: id })).source_ref.revision >= 4, 'Save my version saves', 15000).catch(() => {});
    const after = (await view('memory_current', { item_id: id })).body;
    assert.deepEqual({ again, shownCards, writing, offered, keptPlan: after.includes('Ship it. Soon. Maybe.'), keptNotes: after.includes('Dan reviews.') },
      { again: true, shownCards: 3, writing: true, offered: true, keptPlan: true, keptNotes: true }, `held ${held}; focus ${focus}; page now ${JSON.stringify(after)}`);
    await p.close();
  });

  await check('notebook while a card is written, Tab puts it under the card above and shift-Tab takes it out, keeping the writing and the cursor', async () => {
    const id = 'notebook-cards-tab', body = '## Plan\n\nShip it.\n\n## Notes\n\nDan reviews.\n\n## Risks\n\nNone yet.\n', p = await cards(id, body);
    // Risks, picked with ↓ and opened with ⌘Return, gets a few words more, and the cursor goes inside its title.
    await p.key('ArrowDown'); await p.key('ArrowDown'); await p.key('Enter', 4);
    await writing(p, { words: 'Risks\nNone yet.', at: [15, 15], depth: '0', above: 'Notes', focused: true }, 'Risks opens for writing');
    await p.send('Input.insertText', { text: ' Maybe two.' });
    await cursor(p, 3);
    await p.key('Tab');
    await writing(p, { words: 'Risks\nNone yet. Maybe two.', at: [3, 3], depth: '1', above: 'Notes', focused: true }, 'Tab puts it under Notes, still written');
    await saved(id, body.replace('## Risks', '### Risks').replace('None yet.', 'None yet. Maybe two.'), 'the move and unfinished words are saved together');
    await p.key('Tab', 8);
    await writing(p, { words: 'Risks\nNone yet. Maybe two.', at: [3, 3], depth: '0', above: 'Notes', focused: true }, 'shift-Tab takes it out again');
    await saved(id, body.replace('None yet.', 'None yet. Maybe two.'), 'shift-Tab saves the current words too');
    await p.key('Tab');
    await writing(p, { words: 'Risks\nNone yet. Maybe two.', at: [3, 3], depth: '1', above: 'Notes', focused: true }, 'under Notes again');
    await p.key('Escape');
    const under = '## Plan\n\nShip it.\n\n## Notes\n\nDan reviews.\n\n### Risks\n\nNone yet. Maybe two.\n';
    await saved(id, under, 'finishing saves what was written where the card went');
    // On the first card there is nowhere to go: the card stays, and so does the focus.
    await p.key('ArrowUp'); await p.key('ArrowUp'); await p.key('Enter', 4);
    await writing(p, { words: 'Plan\nShip it.', at: [13, 13], depth: '0', above: null, focused: true }, 'Plan opens for writing');
    await p.key('Tab');
    assert.deepEqual(await box(p), { words: 'Plan\nShip it.', at: [13, 13], depth: '0', above: null, focused: true }, 'Tab on the first card moves nothing and keeps the box');
    await p.key('Escape');
    // A new card, not yet made, only changes where it will go: under Notes, after Risks.
    await p.key('ArrowDown'); await p.key('Enter');
    await writing(p, { words: '', at: [0, 0], depth: '0', above: 'Risks', focused: true }, 'a new card opens after Notes and its children');
    await p.send('Input.insertText', { text: 'Later' });
    await p.key('Tab');
    await writing(p, { words: 'Later', at: [5, 5], depth: '1', above: 'Risks', focused: true }, 'Tab puts the new card under Notes');
    await p.key('Escape');
    await saved(id, `${under}\n### Later\n`, 'the new card is made where Tab put it');
    // A new card begun among siblings, after Risks with Later still to come: shift-Tab takes it out of Notes after all
    // the children of Notes, as it would a made card there, so Later stays under Notes and not under the new card.
    await p.key('ArrowUp'); await p.key('Enter');
    await writing(p, { words: '', at: [0, 0], depth: '1', above: 'Risks', focused: true }, 'a new card opens between Risks and Later');
    await p.send('Input.insertText', { text: 'Soon' });
    await p.key('Tab', 8);
    await writing(p, { words: 'Soon', at: [4, 4], depth: '0', above: 'Later', focused: true }, 'shift-Tab takes the new card out of Notes, after Later');
    await p.key('Escape');
    await saved(id, `${under}\n### Later\n\n## Soon\n`, 'the new card is made beside Notes, and Later stays under Notes');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('notebook while a card is written, ↑ at its very start and ↓ at its very end go on writing the card that shows beside it', async () => {
    const id = 'notebook-cards-arrows', p = await cards(id, '## Plan\n\nShip it.\n\n### Steps\n\nOne, two.\n\n## Notes\n\nDan reviews.\n\n## Risks\n\nNone yet.\n');
    // Plan's child folded away with ←, Notes picked with ↓ (which passes over it) and opened with ⌘Return.
    await p.key('ArrowLeft'); await p.key('ArrowDown'); await p.key('Enter', 4);
    await writing(p, { words: 'Notes\nDan reviews.', at: [18, 18], depth: '0', above: 'Plan', focused: true }, 'Notes opens for writing');
    await p.send('Input.insertText', { text: ' Warp signs off.' });
    // ↑ short of the very start keeps writing Notes.
    await cursor(p, 2); await p.key('ArrowUp');
    assert.equal((await box(p))?.words, 'Notes\nDan reviews. Warp signs off.', '↑ inside the first line stays in the card');
    // At the very start it finishes Notes, saved, and goes on writing Plan, the card that shows above, at its end.
    await cursor(p, 0); await p.key('ArrowUp');
    await writing(p, { words: 'Plan\nShip it.', at: [13, 13], depth: '0', above: null, focused: true }, '↑ goes on into Plan, at its end');
    const notes = '## Plan\n\nShip it.\n\n### Steps\n\nOne, two.\n\n## Notes\n\nDan reviews. Warp signs off.\n\n## Risks\n\nNone yet.\n';
    await saved(id, notes, 'Notes is saved as written');
    // On the first card ↑ goes nowhere.
    await cursor(p, 0); await p.key('ArrowUp');
    assert.deepEqual(await box(p), { words: 'Plan\nShip it.', at: [0, 0], depth: '0', above: null, focused: true }, '↑ at the first card stays');
    // ↓ at the very end goes on into Notes, past the folded Steps, at its start.
    await cursor(p, 13); await p.key('ArrowDown');
    await writing(p, { words: 'Notes\nDan reviews. Warp signs off.', at: [0, 0], depth: '0', above: 'Plan', focused: true }, '↓ goes on into Notes, at its start');
    // ↓ short of the very end keeps writing Notes; at the very end it goes on into Risks.
    await cursor(p, 5); await p.key('ArrowDown');
    assert.equal((await box(p))?.words, 'Notes\nDan reviews. Warp signs off.', '↓ at the end of the first line stays in the card');
    await cursor(p, 34); await p.key('ArrowDown');
    await writing(p, { words: 'Risks\nNone yet.', at: [0, 0], depth: '0', above: 'Notes', focused: true }, '↓ goes on into Risks');
    // On the last card ↓ goes nowhere.
    await cursor(p, 15); await p.key('ArrowDown');
    assert.deepEqual(await box(p), { words: 'Risks\nNone yet.', at: [15, 15], depth: '0', above: 'Notes', focused: true }, '↓ at the last card stays');
    // A new card with nothing written is dropped on the way up; one with words is made first.
    await p.key('Escape'); await p.key('Enter');
    await writing(p, { words: '', at: [0, 0], depth: '0', above: 'Risks', focused: true }, 'a new card opens after Risks');
    await p.key('ArrowUp');
    await writing(p, { words: 'Risks\nNone yet.', at: [15, 15], depth: '0', above: 'Notes', focused: true }, 'the empty new card is dropped and Risks opens at its end');
    await p.key('Escape'); await p.key('Enter');
    await writing(p, { words: '', at: [0, 0], depth: '0', above: 'Risks', focused: true }, 'another new card opens');
    await p.send('Input.insertText', { text: 'Later' });
    await cursor(p, 0); await p.key('ArrowUp');
    await writing(p, { words: 'Risks\nNone yet.', at: [15, 15], depth: '0', above: 'Notes', focused: true }, 'Risks opens at its end');
    await saved(id, `${notes}\n## Later\n`, 'the new card is made as written');
    await p.key('Escape');
    // Plan, its child Steps shown again with →, cleared of all its text: ↓ removes it with Steps, as finishing does,
    // and goes on into Notes, the card after them.
    await p.key('ArrowUp'); await p.key('ArrowUp'); await p.key('ArrowRight'); await p.key('Enter', 4);
    await writing(p, { words: 'Plan\nShip it.', at: [13, 13], depth: '0', above: null, focused: true }, 'Plan opens for writing');
    await p.key('a', 4); await p.key('Backspace');
    await writing(p, { words: '', at: [0, 0], depth: '0', above: null, focused: true }, 'Plan is cleared');
    await p.key('ArrowDown');
    await writing(p, { words: 'Notes\nDan reviews. Warp signs off.', at: [0, 0], depth: '0', above: null, focused: true }, '↓ goes on into Notes, past the child that went with Plan');
    await saved(id, '## Notes\n\nDan reviews. Warp signs off.\n\n## Risks\n\nNone yet.\n\n## Later\n', 'Plan is removed with Steps');
    await p.key('Escape');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('notebook while a card is written, the keys an input method composes with stay its own', async () => {
    const id = 'notebook-cards-composing', body = '## Plan\n\nShip it.\n\n## Notes\n\nDan reviews.\n\n## Risks\n\nNone yet.\n', p = await cards(id, body);
    // A key sent into the box as a browser sends it while an input method composes (isComposing), as Safari sends the
    // key that ends a composition (keyCode 229, isComposing false), or plainly; true when the page left it alone.
    const dispatch = (key, { composing = false, keyCode = 0 } = {}) => p.evaluate(`(()=>{const e=new KeyboardEvent('keydown',{key:${JSON.stringify(key)},isComposing:${composing},bubbles:true,cancelable:true});
      if(${keyCode})Object.defineProperty(e,'keyCode',{value:${keyCode}});return document.querySelector('#deck-page .deck-writing textarea').dispatchEvent(e)})()`);
    const notes = at => ({ words: 'Notes\nDan reviews.', at: [at, at], depth: '0', above: 'Plan', focused: true });
    await p.key('ArrowDown'); await p.key('Enter', 4);
    await writing(p, notes(18), 'Notes opens for writing');
    for (const [key, at] of [['ArrowUp', 0], ['ArrowDown', 18], ['Tab', 18], ['Escape', 18]]) {
      for (const how of [{ composing: true }, { keyCode: 229 }]) {
        await cursor(p, at);
        assert.equal(await dispatch(key, how), true, `${key} ${JSON.stringify(how)} is the input method's`);
        assert.deepEqual(await box(p), notes(at), `${key} ${JSON.stringify(how)} leaves the card as it was`);
      }
    }
    // The same ↓ sent plainly is the deck's, and goes on into Risks.
    await cursor(p, 18);
    assert.equal(await dispatch('ArrowDown'), false, 'a plain ↓ at the very end is the deck\'s');
    await writing(p, { words: 'Risks\nNone yet.', at: [0, 0], depth: '0', above: 'Notes', focused: true }, 'the plain ↓ goes on into Risks');
    assert.equal((await view('memory_current', { item_id: id })).body, body, 'no key of the input method\'s moved or saved a card');
    await p.key('Escape');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('notebook on the cards page, → gives a card\'s speech bubble the focus, once none of its children are folded away', async () => {
    // Each card has a reply stack, so its bubble shows whoever the page's agents are.
    const stack = name => `[Reply stack](${facts.origin}/?topic=t1&message=m-${name})`;
    const id = 'notebook-cards-bubble', p = await cards(id, `## Plan\n\nShip it.\n\n${stack('plan')}\n\n### Steps\n\nOne, two.\n\n${stack('steps')}\n\n## Notes\n\nDan reviews.\n\n${stack('notes')}\n`);
    // The card with the focus, whether its speech bubble has it, and whether Steps shows.
    const focus = () => p.evaluate(`(()=>{const a=document.activeElement,row=a?.closest?.('#deck-page .deck-card');
      return {card:row?.querySelector('.deck-title')?.textContent??null,bubble:Boolean(a?.classList.contains('deck-bubble')),steps:[...document.querySelectorAll('#deck-page .deck-card')].some(r=>!r.hidden&&r.querySelector('.deck-title')?.textContent==='Steps')}})()`);
    const focused = (want, words) => until(async () => JSON.stringify(await focus()) === JSON.stringify(want), words)
      .catch(async error => { assert.deepEqual(await focus(), want, words); throw error; });
    await until(() => p.evaluate("document.querySelectorAll('#deck-page .deck-bubble').length === 3"), 'each card has its speech bubble');
    await p.key('ArrowRight');
    await focused({ card: 'Plan', bubble: true, steps: true }, '→ on Plan, its child showing, gives its speech bubble the focus');
    await p.key('ArrowLeft');
    await focused({ card: 'Plan', bubble: false, steps: true }, '← gives the focus back to Plan');
    await p.key('ArrowLeft');
    await focused({ card: 'Plan', bubble: false, steps: false }, '← folds Steps away');
    await p.key('ArrowRight');
    await focused({ card: 'Plan', bubble: false, steps: true }, '→ shows Steps again, the focus staying on Plan');
    await p.key('ArrowRight');
    await focused({ card: 'Plan', bubble: true, steps: true }, 'and the next → gives the speech bubble the focus');
    await p.key('ArrowLeft'); await p.key('ArrowRight', 4);
    await focused({ card: 'Steps', bubble: false, steps: true }, '⌘→ goes down to Plan\'s first child');
    await p.key('ArrowRight');
    await focused({ card: 'Steps', bubble: true, steps: true }, '→ on Steps, which has no children, gives its speech bubble the focus');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('notebook while a card is written, cmd-Up and cmd-Down move it past the card beside it, keeping the writing and the cursor', async () => {
    const id = 'notebook-cards-move', body = '## Plan\n\nShip it.\n\n## Notes\n\nDan reviews.\n\n## Risks\n\nNone yet.\n', p = await cards(id, body);
    await p.key('ArrowDown'); await p.key('Enter', 4);
    await p.send('Input.insertText', { text: ' Warp too.' });
    await cursor(p, 3);
    const notes = (above, words) => writing(p, { words: 'Notes\nDan reviews. Warp too.', at: [3, 3], depth: '0', above, focused: true }, words);
    await p.key('ArrowUp', 4);
    await notes(null, 'cmd-Up takes Notes past Plan, still written, the cursor where it was');
    await saved(id, '## Notes\n\nDan reviews. Warp too.\n\n## Plan\n\nShip it.\n\n## Risks\n\nNone yet.\n', 'the move and unfinished words are saved together');
    await p.key('ArrowUp', 4);
    assert.deepEqual(await box(p), { words: 'Notes\nDan reviews. Warp too.', at: [3, 3], depth: '0', above: null, focused: true }, 'cmd-Up on the first card moves nothing and keeps the box');
    await p.key('ArrowDown', 4);
    await notes('Plan', 'cmd-Down takes it back past Plan');
    await saved(id, body.replace('Dan reviews.', 'Dan reviews. Warp too.'), 'and the current words are saved in that place too');
    await p.key('ArrowDown', 4);
    await notes('Risks', 'cmd-Down takes it past Risks');
    await p.key('Escape');
    const moved = '## Plan\n\nShip it.\n\n## Risks\n\nNone yet.\n\n## Notes\n\nDan reviews. Warp too.\n';
    await saved(id, moved, 'finishing saves what was written where the card went');
    // A new card, not yet made, only changes where it will go: past Notes, after Risks.
    await p.key('Enter');
    await writing(p, { words: '', at: [0, 0], depth: '0', above: 'Notes', focused: true }, 'a new card opens after Notes');
    await p.send('Input.insertText', { text: 'Later' });
    await p.key('ArrowUp', 4);
    await writing(p, { words: 'Later', at: [5, 5], depth: '0', above: 'Risks', focused: true }, 'cmd-Up takes the new card past Notes');
    await p.key('Escape');
    await saved(id, moved.replace('## Notes', '## Later\n\n## Notes'), 'the new card is made where cmd-Up put it');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('notebook while a card is written, option-Up and option-Down move the line the cursor is on, and the composer\'s line keys work', async () => {
    const id = 'notebook-cards-lines', p = await cards(id, '## Plan\n\nShip it.\n\n## Notes\n\nOne.\nTwo.\nThree.\n');
    const notes = (words, at) => ({ words, at: [at, at], depth: '0', above: 'Plan', focused: true });
    await p.key('ArrowDown'); await p.key('Enter', 4);
    await writing(p, notes('Notes\nOne.\nTwo.\nThree.', 22), 'Notes opens for writing');
    await cursor(p, 12); await p.key('ArrowUp', 1);
    await writing(p, notes('Notes\nTwo.\nOne.\nThree.', 7), 'option-Up moves Two. above One., the cursor with it');
    await p.key('z', 4);
    await writing(p, notes('Notes\nOne.\nTwo.\nThree.', 12), 'cmd-Z puts it back, the cursor where it was');
    await p.key('ArrowUp', 1);
    await writing(p, notes('Notes\nTwo.\nOne.\nThree.', 7), 'option-Up moves it again');
    await p.key('ArrowDown', 1); await p.key('ArrowDown', 1);
    await writing(p, notes('Notes\nOne.\nThree.\nTwo.', 19), 'option-Down twice moves it below Three.');
    // Control-U, a line key of the composer's, deletes back to the start of the line.
    await cursor(p, 22); await p.key('u', 2);
    await writing(p, notes('Notes\nOne.\nThree.\n', 18), 'control-U deletes back to the start of the line');
    await p.key('Escape');
    await saved(id, '## Plan\n\nShip it.\n\n## Notes\n\nOne.\nThree.\n', 'what was written is saved');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('notebook a card keeps its height and its text stays where it stood between showing and being written', async () => {
    const long = 'A title long enough to wrap beside its bubble while it shows, and fit one line in its box';
    const id = 'notebook-cards-still', p = await cards(id, `## Plan\n\n## Notes\n\nDan reviews the slides.\nWarp signs off.\n\n### Steps\n\nOne, two.\n\n## Risks\n\nNone yet.\n\n## ${long}\n`);
    // Where a card's title and the first line of its words stand, its chevron, its height and the top of the card
    // after it: from the letters while it shows, from its box's lines while it is written.
    const where = title => p.evaluate(`(()=>{const rows=[...document.querySelectorAll('#deck-page .deck-card')],box=document.querySelector('#deck-page .deck-writing textarea');
      const row=box?box.closest('li'):rows.find(r=>r.querySelector('.deck-title')?.lastChild?.textContent===${JSON.stringify(title)}),next=rows[rows.indexOf(row)+1];
      const letter=node=>{const range=document.createRange();range.setStart(node,0);range.setEnd(node,1);const r=range.getBoundingClientRect();return {left:r.left,middle:(r.top+r.bottom)/2};};
      const fold=row.querySelector('.deck-fold')?.getBoundingClientRect(),r=row.getBoundingClientRect();let title,words=null,lines=null;
      if(box){const s=getComputedStyle(box),b=box.getBoundingClientRect(),line=parseFloat(s.lineHeight),top=b.top+parseFloat(s.borderTopWidth)+parseFloat(s.paddingTop);
        title={left:b.left+parseFloat(s.borderLeftWidth)+parseFloat(s.paddingLeft)+parseFloat(s.textIndent),middle:top+line/2};if(box.value.includes('\\n'))words=top+line*1.5;}
      else{const h=row.querySelector('.deck-title');title=letter(h.lastChild);lines=Math.round(h.getBoundingClientRect().height/parseFloat(getComputedStyle(h).lineHeight));
        const walk=document.createTreeWalker(row.querySelector('.deck-words'),NodeFilter.SHOW_TEXT);let node;while((node=walk.nextNode())&&!/\\S/.test(node.textContent));if(node)words=letter(node).middle;}
      return {height:r.height,next:next?next.getBoundingClientRect().top:null,scroll:scrollY,left:title.left,words,title:title.middle,lines,fold:fold?[fold.left,fold.top]:null}})()`);
    // The card keeps its height and the cards after it stay where they are, both laid out from the faces' line heights
    // alone, and its words stay on their lines. The title takes the words' face while it is written, so it may move by
    // the difference between the two faces' lines.
    const near = (shown, written, by) => shown === written || Math.abs(shown - written) <= by;
    const still = (shown, written, words) => {
      for (const key of ['scroll', 'height', 'next']) assert.ok(near(shown[key], written[key], 0.1), `${words}: ${key} ${shown[key]} shown, ${written[key]} written`);
      for (const key of ['left', 'words']) assert.ok(near(shown[key], written[key], 1), `${words}: ${key} ${shown[key]} shown, ${written[key]} written`);
      assert.ok(near(shown.title, written.title, 6), `${words}: the title's line at ${shown.title} shown, ${written.title} written`);
      assert.equal(Boolean(written.fold), Boolean(shown.fold), `${words}: the chevron ${shown.fold ? 'stays' : 'stays away'} while it is written`);
      assert.ok(!shown.fold || shown.fold.every((at, i) => near(at, written.fold[i], 1)), `${words}: the chevron at ${shown.fold} shown, ${written.fold} written`);
    };
    for (const [title, words] of [['Plan', 'a card with a title alone'], ['Notes', 'a card with words and a child'], ['Steps', 'a child card'],
      ['Risks', 'a card with a line of words'], [long, 'a card whose title wraps beside its bubble while it shows']]) {
      const shown = await where(title);
      if (title === long) assert.ok(shown.lines >= 2, `the long title takes ${shown.lines} lines while it shows`);
      if (title === 'Notes') await shot(p, 'notebook-cards-shown');
      await p.key('Enter', 4);
      await until(() => p.evaluate("Boolean(document.querySelector('#deck-page .deck-writing textarea'))"), `${title} opens for writing`);
      if (title === 'Notes') await shot(p, 'notebook-cards-written');
      still(shown, await where(title), words);
      await p.key('Escape'); await p.key('ArrowDown');
    }
    // A press around the box, in the card's own margin, leaves the writing as it was.
    for (let n = 0; n < 4; n++) await p.key('ArrowUp');
    await p.key('Enter', 4);
    await until(() => p.evaluate("Boolean(document.querySelector('#deck-page .deck-writing textarea'))"), 'Plan opens for writing');
    const plan = await where('Plan');
    const margin = await p.evaluate("(()=>{const r=document.querySelector('#deck-page .deck-writing').getBoundingClientRect();return {x:r.left+40,y:r.top+4}})()");
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await p.send('Input.dispatchMouseEvent', { type, ...margin, button: 'left', clickCount: 1 });
    assert.ok(await p.evaluate("document.activeElement === document.querySelector('#deck-page .deck-writing textarea')"), 'a press in the card around its box leaves the box the focus');
    // Words that need more room make the box taller, and only then.
    await p.send('Input.insertText', { text: ' for the week' });
    await until(() => p.evaluate("document.querySelector('#deck-page .deck-writing textarea').value === 'Plan for the week'"), 'the words go in where the cursor was');
    assert.equal((await where('Plan')).height, plan.height, 'words that fit the line leave the card its height');
    for (const line of ['One.', 'Two.', 'Three.']) { await p.key('Enter'); await p.send('Input.insertText', { text: line }); }
    await until(async () => (await where('Plan')).height > plan.height + 60, 'three more lines make the box three lines taller');
    await p.key('Escape');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('notebook on the cards page, a card under a still pointer shows no speech bubble while the keys are in use, until the mouse moves', async () => {
    // A page in t1, where the fixture's agent takes part, so each card has a bubble to ask it about the card.
    const item = (await control({ method: 'seed', memory_items: 1 })).item_ids[0];
    const revised = await control({ method: 'memory_revise', operation_id: 'notebook-cards-pointer-revise', item_id: item, title: 'Cards', expected_revision: 1,
      body: '## Plan\n\nShip it.\n\n## Notes\n\nDan reviews.\n\n## Risks\n\nNone yet.\n\n## Later\n' });
    assert.equal(revised.status, 'committed', JSON.stringify(revised));
    const p = await page('notebook-cards-pointer', null, true, { url: `${facts.origin}/?cards=${item}` });
    await until(() => p.evaluate("document.querySelectorAll('#deck-page .deck-ask').length === 4"), 'each card has a bubble to ask about it');
    // The cards whose bubbles show, and those with a border of their own: the picked card's, or the pointer's highlight.
    const lit = () => p.evaluate(`(()=>{const rows=[...document.querySelectorAll('#deck-page .deck-card')],plain=getComputedStyle(rows.at(-1)).borderColor,title=r=>r.querySelector('.deck-title').textContent;
      return {bubbles:rows.filter(r=>getComputedStyle(r.querySelector('.deck-ask')).opacity==='1').map(title),borders:rows.filter(r=>getComputedStyle(r).borderColor!==plain).map(title)}})()`);
    const showing = (want, words) => until(async () => JSON.stringify(await lit()) === JSON.stringify(want), words)
      .catch(async error => { assert.deepEqual(await lit(), want, words); throw error; });
    const risks = await p.evaluate("(()=>{const r=[...document.querySelectorAll('#deck-page .deck-card')].find(r=>r.querySelector('.deck-title').textContent==='Risks').getBoundingClientRect();return {x:r.left+r.width/3,y:r.top+r.height/2}})()");
    const move = dx => p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: risks.x + dx, y: risks.y });
    const only = cards => ({ bubbles: cards, borders: cards });
    await showing(only(['Plan']), 'at first the picked card alone shows its bubble');
    await move(0); await move(6);
    await showing(only(['Plan', 'Risks']), 'the card under a moving pointer shows its bubble and the pointer\'s highlight');
    // macOS hides the pointer while a person types, so the card it rests on shows nothing until the mouse moves.
    await p.key('ArrowDown');
    await showing(only(['Notes']), 'once a key is pressed the card under the still pointer shows neither, and the picked card its own');
    await move(6);
    await showing(only(['Notes']), 'a move to where the pointer already is, as the page sends when it scrolls under it, shows neither');
    await move(12);
    await showing(only(['Notes', 'Risks']), 'a move of the mouse shows them again');
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  // A page in the composer over the feed (item 396), in a module of its own.
  await notebookSheetChecks({ check, page, until, control, view, facts, shot });
}
