import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { notebookSheetChecks, sheetHead } from './notebook_sheet_native.mjs';
import { cardImageChecks } from './notebook_card_images_native.mjs';

// Notebook pages in the real browser against the real server: an outcome's
// pages are listed on the right rail of a topic (All of this outcome) and of
// its Conversation, never in the side rail (item 464), with More pages for the
// rest; a page the reader has read and
// an agent revised since wears its new revisions as a count, live, with no
// reload; opening it shows what changed since, as marked words, and puts the
// light out; a page in the topic's own Notebook wears the same light; at 390 wide, in light and in dark, the pages are in the
// sheet "Pipeline & pages" opens over the topic, nothing leaves the screen and the changed words stay readable; on the outcome's own page the pages
// follow the topics; a page opens in the composer over the feed (item 396), and what changed shows there; and a page's link opens the page as
// it stands in the composer, or at a revision in the Reader or in place, from the address bar
// or from a message's words, and the Reader's ⋯ copies it. On the cards page,
// a card being written moves with Tab and ⇧Tab, and goes on into the card
// beside with ↑ and ↓, each act read back from the page as saved, while the
// keys an input method composes with stay its own; and every key that leaves a
// card picked brings it into view with a tenth of the window beyond it (379).
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
    // Which document is up: its timeOrigin as first read, kept on the window (WebKit's can move 1 ms with no load).
    const before=await p.evaluate('(window.documentOrigin??=performance.timeOrigin)');
    await p.evaluate("dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))");
    await until(async()=>{try{return await p.evaluate(`document.body.dataset.ready==='true'&&(window.documentOrigin??=performance.timeOrigin)!==${before}`)}catch{return false;}},'a cached-page restore reloads a live writer');
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
    // Picked while a card is written, the image goes into that card (decks.md, "Images in a card"); pasted in Text, it
    // is attached to the page with no line, as before.
    const [pasted,picked]=(await current()).attachments;
    await until(async()=>(await current()).body.includes(`![notebook-chart.png](attachment:${picked.id})`),'the card names the image picked into it');
    assert.equal((await current()).body,`## First\n\nWriting.\n\n![notebook-chart.png](attachment:${picked.id})\n`);
    assert.equal(pasted.name,'notebook-paste.png');
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
  // The outcome's page on the right rail (its Notebook section, with All of this outcome on a topic), and on the outcome's own page.
  const RAIL_NOTEBOOK = '#things .things-sec[data-key="notebook"]', PENCIL = RAIL_NOTEBOOK + ' > summary .notebook-create:not([hidden])';
  const railRow = page => `${RAIL_NOTEBOOK} a.row[href$="page=${page}"]`;
  const id = 'notebook-release-plan', row = railRow(id), pageRow = `#outcome-references-list .reference[data-id="${id}"]`;
  const light = p => p.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(row + ' .unread-count')});return b?{text:b.textContent,className:b.className,said:document.querySelector(${JSON.stringify(row + ' .sr-only')})?.textContent}:null})()`);
  const listed = async () => (await view('memory_items', { owner_scope: { kind: 'workspace', id: 'w1' } })).items.find(item => item.id === id);
  let revision = 0;
  const revise = async body => {
    const answer = revision === 0
      ? await control({ method: 'outcome_reference', operation_id: `${id}-create`, item_id: id, title: 'Release plan', body })
      : await control({ method: 'memory_revise', operation_id: `${id}-revise-${revision}`, item_id: id, expected_revision: revision, title: 'Release plan', body });
    assert.equal(answer.status, 'committed', JSON.stringify(answer)); revision += 1;
  };
  const openRow = async (p, at = row) => {
    await p.evaluate(`document.querySelector(${JSON.stringify(at)}).scrollIntoView({block:'center',inline:'center',behavior:'instant'})`);
    await until(()=>p.evaluate(`new Promise(resolve=>{
      const e=document.querySelector(${JSON.stringify(at)});e.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
      const a=e.getBoundingClientRect();requestAnimationFrame(()=>{const b=e.getBoundingClientRect();resolve(a.top===b.top&&a.bottom===b.bottom&&b.top>=0&&b.bottom<=innerHeight);});
    })`),'Notebook row stays in view across an animation frame');
    await p.point(at);
    await sheetShows(p, 'Release plan');
  };
  // The right rail shows the whole outcome's things: on a topic, once All of this outcome is pressed (a Conversation
  // shows them from the start); on a phone or a middle width, in the sheet "Pipeline & pages" opens. A press aims
  // once its target holds its place, as a finger does.
  const steady = async (p, selector) => {
    let last = null;
    await until(async () => { const now = await p.box(selector), same = Boolean(last && now) && ['x','y','width','height'].every(key => now[key] === last[key]); last = now; return same; }, selector + ' holds its place');
    return last;
  };
  const aim = async (p, selector) => {
    const b = await steady(p, selector);
    if (!await p.evaluate("matchMedia('(pointer:coarse)').matches")) return p.point(selector);
    const x = b.x + b.width/2, y = b.y + b.height/2;
    await p.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x,y}]});
    await p.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
  };
  const wholeOutcome = async p => {
    await until(() => p.evaluate(`document.body.dataset.ready==='true' && Boolean(document.querySelector('#things-open'))`), 'the page is up');
    if (!await p.evaluate("matchMedia('(min-width: 1181px)').matches || document.documentElement.hasAttribute('data-things-open')")) {
      await aim(p, '#things-open');
      await until(() => p.evaluate(`document.documentElement.hasAttribute('data-things-open')`), 'the right rail opens');
    }
    const chip = '#things .things-scope .chip:last-child';
    await until(() => p.evaluate(`document.querySelector('#things .things-sections')?.getAttribute('aria-busy')!=='true'`), 'the right rail has read');
    if (await p.evaluate(`!document.querySelector('#things .things-scope').hidden && document.querySelector(${JSON.stringify(chip)}).getAttribute('aria-pressed')!=='true'`)) {
      await p.evaluate(`document.querySelector(${JSON.stringify(chip)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
      await aim(p, chip);
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(chip)}).getAttribute('aria-pressed')==='true' && document.querySelector('#things .things-sections').getAttribute('aria-busy')!=='true'`), 'the right rail shows the whole outcome');
    }
  };
  // A page on the right rail's Notebook, pressing More pages as a reader would while it lists only the first pages
  // (the checks before leave many).
  const railLists = async (p, page) => {
    const at = railRow(page), more = RAIL_NOTEBOOK + ' .things-more';
    const look = () => p.evaluate(`(()=>{const s=e=>Boolean(e&&e.getClientRects().length);return {here:s(document.querySelector(${JSON.stringify(at)})),more:s(document.querySelector(${JSON.stringify(more)})),
      rows:document.querySelectorAll(${JSON.stringify(RAIL_NOTEBOOK + ' .things-list a.row')}).length}})()`);
    for (;;) {
      const now = await until(async () => { const seen = await look(); return seen.here || seen.more ? seen : null; }, `the right rail lists ${page}`);
      if (now.here) return at;
      await p.evaluate(`document.querySelector(${JSON.stringify(more)}).scrollIntoView({block:'center',behavior:'instant'})`);
      await aim(p, more);
      await until(async () => { const seen = await look(); return seen.here || seen.rows > now.rows; }, `More pages brings more than ${now.rows}`);
    }
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
    // Every pencil sits beside the right rail's Notebook heading: the topic's while it lists the topic's pages, also
    // for a topic whose Notebook is still empty; the outcome's while it lists the outcome's, on a Conversation and on a
    // topic with All of this outcome. The side rail has none (item 464).
    const empty = ['t-notebook-empty', 't-notebook-empty-phone'];
    await control({method:'navigation_topics', topics:empty.map(id => ({id, title:'No pages yet'}))});
    for (const [scope, phone] of [[{kind:'workspace',id:'w1'},false],[{kind:'topic',id:'t1'},false],[{kind:'topic',id:empty[0]},false],[{kind:'topic',id:empty[1]},true],[{kind:'workspace',id:'w1'},true]]) {
      const label = scope.id + (phone ? '-phone' : '-desktop'), name = 'Create notes in ' + label;
      // The outcome's pencil: on its Conversation at a laptop's width, on a topic's All of this outcome on a phone.
      const where = scope.kind === 'topic' ? `?topic=${scope.id}` : phone ? '?topic=t1' : '?conversation=w1';
      const p = await page('notebook-create-' + label, null, true, {url: `${facts.origin}/${where}`, beforeNavigate: async q => {
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
      const host = RAIL_NOTEBOOK, button = PENCIL, input = host + ' input';
      if (scope.kind === 'workspace') await wholeOutcome(p);
      else if (phone) {
        await until(() => p.evaluate(`document.body.dataset.ready==='true' && Boolean(document.querySelector('#things-open'))`), 'the page is up');
        await press('#things-open');
        await until(() => p.evaluate(`document.documentElement.hasAttribute('data-things-open')`), 'the Notebook drawer opens');
      }
      await until(() => p.evaluate(`document.body.dataset.ready==='true' && document.querySelector(${JSON.stringify(button)})?.checkVisibility()===true`), 'the Notebook pencil is available');
      // Beside the rail's Notebook heading, one pencil showing, and none in the page between the rails or in the side rail.
      const placed = await p.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(button)}),r=b.getBoundingClientRect(),h=document.querySelector(${JSON.stringify(host + ' > summary')}).getBoundingClientRect();
        return {heading:document.querySelector(${JSON.stringify(host + ' > summary > span')}).textContent,beside:r.top>=h.top-1&&r.bottom<=h.bottom+1&&r.right<=h.right+1,
          inMain:document.querySelectorAll('#main .notebook-create').length,inRail:[...document.querySelectorAll('#things .notebook-create')].filter(e=>e.checkVisibility()).length,
          inSide:document.querySelectorAll('#rail .notebook-create, #rail #outcome-references').length,name:[b.getAttribute('aria-label'),b.title],
          touch:Math.round(r.width)>=44&&Math.round(r.height)>=44}})()`);
      assert.deepEqual(placed, {heading:'Notebook',beside:true,inMain:0,inRail:1,inSide:0,name:['New Notebook page','New Notebook page'],touch:true},
        `the ${scope.kind === 'topic' ? 'topic' : 'outcome'} pencil is beside the right rail's Notebook heading, and the side rail has none`);
      if (empty.includes(scope.id)) assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(host + ' .things-body')}).textContent`), 'No pages yet.', 'an empty topic Notebook keeps its heading');
      await p.evaluate(`document.querySelector(${JSON.stringify(button)}).scrollIntoView({block:'center'})`);
      await press(button);
      await until(() => p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(input)})`), 'one title line, focused');
      await shot(p, 'notebook-create-' + label + '-line');
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
      if (!phone) {
        // The title line that had the focus went as the page was made, so the browser has nothing to give the focus back
        // to as the sheet closes: the sheet gives it to the pencil that opened the page, and the browser's close event,
        // a frame later, leaves it there.
        await p.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,50))))');
        assert.equal(await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(button)}) || (document.activeElement?.id || document.activeElement?.tagName)`), true,
          'closing the new page gives the focus back to the pencil that opened it');
      }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 464: the side rail lists no Notebook, so the right rail lists every page of a whole outcome's: twenty, then
  // More pages for twenty more, read again with the rail from then on. Each state of the section, at a laptop's width
  // and a phone's narrowest (320, 375, 390) in light and dark: pages with More, every page once More has brought them,
  // and an empty Notebook with its pencil and its title line open. The keys and a finger reach More, and the keys
  // never land on what it leaves behind.
  await check('notebook the right rail lists a whole outcome\'s Notebook, twenty and then More pages, with its pencil, and the empty Notebook with its pencil and title line, at 320 375 390 and a laptop, light and dark', async () => {
    const many = 'nb-rail-many', none = 'nb-rail-none', count = 23;
    await control({ method: 'navigation_workspaces', workspaces: [{ id: many, title: 'Many pages' }, { id: none, title: 'No pages' }] });
    for (let n = 1; n <= count; n++) {
      const item = `nb-rail-page-${String(n).padStart(2, '0')}`;
      assert.equal((await control({ method: 'outcome_reference', operation_id: item, item_id: item, workspace_id: many, title: `Rail page ${n}`, body: `Page ${n}.` })).status, 'committed');
    }
    const SIZE = { laptop: { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, 320: { width: 320, height: 700, deviceScaleFactor: 2, mobile: true },
      375: { width: 375, height: 760, deviceScaleFactor: 2, mobile: true }, 390: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } };
    const ROWS = RAIL_NOTEBOOK + ' .things-list a.row', MORE = RAIL_NOTEBOOK + ' .things-more';
    // The section as drawn: its rows, its count, More, the pencil, and where each sits.
    const section = p => p.evaluate(`(()=>{const d=document.querySelector(${JSON.stringify(RAIL_NOTEBOOK)}),s=d.querySelector(':scope > summary'),v=e=>Boolean(e?.checkVisibility());
      const box=e=>{const r=e.getBoundingClientRect();return {x:r.left,y:r.top,r:r.right,b:r.bottom}},cross=(a,b)=>Math.min(a.r,b.r)-Math.max(a.x,b.x)>0.5&&Math.min(a.b,b.b)-Math.max(a.y,b.y)>0.5;
      const pencil=[...s.querySelectorAll('.notebook-create')].find(v),more=d.querySelector('.things-more'),sheet=document.getElementById('things').getBoundingClientRect();
      const parts=[s.querySelector(':scope > span'),pencil,s.querySelector('.sum')].filter(v).map(box);
      const phone=matchMedia('(max-width: 760px)').matches;
      return {rows:[...d.querySelectorAll('.things-list a.row')].length,short:[...d.querySelectorAll('.things-list a.row')].filter(a=>phone&&Math.round(a.getBoundingClientRect().height)<44).length,sum:s.querySelector('.sum').textContent,more:v(more)?more.textContent:null,
        quiet:d.querySelector('.things-quiet')?.textContent??null,pencil:pencil?[pencil.getAttribute('aria-label'),pencil.title]:null,
        overlaps:parts.flatMap((a,i)=>parts.slice(i+1).filter(b=>cross(a,b))).length,
        small:[pencil,v(more)?more:null].filter(Boolean).map(e=>e.getBoundingClientRect()).filter(r=>matchMedia('(max-width: 760px)').matches&&(Math.round(r.width)<44||Math.round(r.height)<44)).length,
        inside:[pencil,v(more)?more:null].filter(Boolean).every(e=>{const r=e.getBoundingClientRect();return r.left>=sheet.left-0.5&&r.right<=sheet.right+0.5}),
        sideways:document.documentElement.scrollWidth>innerWidth,side:document.querySelectorAll('#rail .notebook-create, #rail #outcome-references, #rail .reference').length}})()`);
    for (const size of ['laptop', 390, 375, 320]) for (const scheme of ['light', 'dark']) {
      const label = `${size}-${scheme}`, phone = size !== 'laptop';
      // Every page the outcome holds now: the twenty-three, and one more for each size and scheme before this one.
      const all = (await view('memory_items', { owner_scope: { kind: 'workspace', id: many }, limit: 100 })).items.length;
      const at = (name, url) => page(name, null, true, { url: facts.origin + url, beforeNavigate: async q => {
        await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
        await q.send('Emulation.setDeviceMetricsOverride', SIZE[size]);
        if (phone) await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      } });
      // Pages with More: twenty, the count saying there are more, the outcome's pencil beside the name.
      let p = await at('nb-rail-many-' + label, `/?conversation=${many}`);
      await wholeOutcome(p);
      await until(async () => (await section(p)).more === 'More pages', 'the section lists its first pages and More pages');
      assert.deepEqual(await section(p), { rows: 20, short: 0, sum: '20+', more: 'More pages', quiet: null, pencil: ['New Notebook page', 'New Notebook page'], overlaps: 0, small: 0, inside: true, sideways: false, side: 0 },
        `${label}: twenty pages, each a full touch target on a phone, More pages, the pencil clear of the name and the count`);
      for (const part of [ROWS, MORE]) assert.ok(await contrast(p, part) >= 4.5, `${label}: ${part} reads`);
      await p.evaluate(`document.querySelector(${JSON.stringify(MORE)}).scrollIntoView({block:'center',behavior:'instant'})`);
      await shot(p, 'notebook-rail-more-' + label);
      if (size === 'laptop' && scheme === 'light') {
        // The keys: ↓ from the last page reaches More, Return brings the rest and the focus lands on the first of them;
        // ↓ goes on through them and past the section, never to the More that went.
        await p.evaluate(`document.querySelectorAll(${JSON.stringify(ROWS)})[19].focus()`);
        await p.key('ArrowDown');
        assert.equal(await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(MORE)})`), true, '↓ from the last page is More');
        await p.key('Enter');
        await until(async () => (await section(p)).rows === all, 'Return on More brings the rest');
        await until(() => p.evaluate(`document.activeElement?.textContent==='Rail page 21'`), 'the focus lands on the first page More brought');
        const walk = [];
        for (let n = 0; n < 4; n++) { await p.key('ArrowDown'); walk.push(await p.evaluate(`(e=>e.closest('.things-sec')?.dataset.key+':'+(e.matches('summary')?'section':e.textContent.trim()))(document.activeElement)`)); }
        assert.deepEqual(walk.slice(0, 2), ['notebook:Rail page 22', 'notebook:Rail page 23'], '↓ goes on through the pages More brought');
        assert.notEqual(walk[2], 'notebook:More pages', 'and never to the More that went');
        assert.match(walk[2], /:section$/, 'past the last page, the next section');
        await p.key('ArrowUp');
        assert.equal(await p.evaluate(`document.activeElement?.textContent`), 'Rail page 23', '↑ comes back to the last page');
      } else {
        await aim(p, MORE);
        await until(async () => (await section(p)).rows === all, 'More pages brings the rest');
      }
      // Every page, once More has brought them: the count says so and More has gone; a reload of the rail keeps them.
      await until(async () => (await section(p)).more === null, 'More goes once nothing is left');
      assert.deepEqual(await section(p), { rows: all, short: 0, sum: String(all), more: null, quiet: null, pencil: ['New Notebook page', 'New Notebook page'], overlaps: 0, small: 0, inside: true, sideways: false, side: 0 },
        `${label}: every page, and no More`);
      await control({ method: 'outcome_reference', operation_id: `nb-rail-late-${label}`, item_id: `nb-rail-late-${label}`, workspace_id: many, title: `Late page ${label}`, body: 'Late.' });
      await until(() => p.evaluate(`[...document.querySelectorAll(${JSON.stringify(ROWS)})].some(a=>a.textContent.startsWith('Late page ${label}'))`), 'a page added since shows, and the rest stay');
      assert.equal((await section(p)).rows, all + 1, 'the pages More brought stay listed');
      await shot(p, 'notebook-rail-all-' + label);
      assert.deepEqual(p.errors, []); await p.close();
      // An empty Notebook: its heading, No pages yet and the pencil, whose title line opens in the section.
      p = await at('nb-rail-none-' + label, `/?conversation=${none}`);
      await wholeOutcome(p);
      await until(async () => (await section(p)).quiet === 'No pages yet.', 'the empty Notebook keeps its heading and its pencil');
      assert.deepEqual(await section(p), { rows: 0, short: 0, sum: '', more: null, quiet: 'No pages yet.', pencil: ['New Notebook page', 'New Notebook page'], overlaps: 0, small: 0, inside: true, sideways: false, side: 0 },
        `${label}: the empty Notebook`);
      await shot(p, 'notebook-rail-empty-' + label);
      await aim(p, PENCIL);
      const line = RAIL_NOTEBOOK + ' input';
      await until(() => p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(line)})`), 'the title line opens, focused');
      const fits = await p.evaluate(`(()=>{const i=document.querySelector(${JSON.stringify(line)}).getBoundingClientRect(),t=document.getElementById('things').getBoundingClientRect();
        return {inside:i.left>=t.left-0.5&&i.right<=t.right+0.5,sideways:document.documentElement.scrollWidth>innerWidth,label:document.querySelector(${JSON.stringify(line)}).getAttribute('aria-label')}})()`);
      assert.deepEqual(fits, { inside: true, sideways: false, label: 'New Notebook page title' }, `${label}: the title line stands inside the rail`);
      await shot(p, 'notebook-rail-line-' + label);
      await p.key('Escape');
      await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(line)})`), 'Escape closes the line');
      assert.equal((await view('memory_items', { owner_scope: { kind: 'workspace', id: none } })).items.length, 0, 'and writes nothing');
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // A page opened on a phone (390 wide, touch) or a laptop, and a press there: a finger aims once the target holds
  // its place, as on a phone; a laptop clicks.
  const opened = async (name, url, phone, script = null) => page(name, null, true, { url, beforeNavigate: async q => {
    if (script) await q.send('Page.addScriptToEvaluateOnNewDocument', { source: script });
    if (!phone) return;
    await q.send('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true});
    await q.send('Emulation.setTouchEmulationEnabled', {enabled:true,maxTouchPoints:1});
  } });
  const press = async (p, selector, phone) => {
    if (!phone) return p.point(selector);
    let last = null;
    await until(async () => { const now = await p.box(selector), same = Boolean(last && now) && ['x','y','width','height'].every(key => now[key] === last[key]); last = now; return same; }, selector + ' holds its place');
    const x = last.x + last.width/2, y = last.y + last.height/2;
    assert.ok(x>=0 && y>=0 && x<390 && y<844, selector + ' is on screen');
    await p.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x,y}]});
    await p.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
  };
  // Every saving sign the composer shows from the page's first paint, each once in turn (statusesSeen), so a reader
  // is never told, even for a moment, that writing of theirs is kept.
  const SIGNS = `globalThis.statusesSeen=[];new MutationObserver(()=>{const t=document.querySelector('#new-message-sheet .notebook-sheet-status')?.textContent;
    if(t&&globalThis.statusesSeen.at(-1)!==t)globalThis.statusesSeen.push(t);}).observe(document,{subtree:true,childList:true,characterData:true});`;
  const visible = (p, selector) => p.evaluate(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()===true`);
  const menuItems = p => p.evaluate(`[...document.querySelectorAll('.message-menu-list [role=menuitem]')].map(b=>b.textContent)`);
  const openRail = async (p, phone) => {
    await until(() => p.evaluate(`document.body.dataset.ready==='true' && Boolean(document.querySelector('#things-open'))`), 'the page is up');
    if (!phone) return;
    await press(p, '#things-open', phone);
    await until(() => p.evaluate(`document.documentElement.hasAttribute('data-things-open')`), 'the right rail opens');
  };

  // Items 371 and 383: the pencil, Edit page and every writing control show only to someone Core lets write
  // the Notebook, which a topic's owner and its outcome's owner may, taking part in it or not.
  await check('notebook the pencil and writing show only to someone Core lets write: none for a reader on the team, and a topic\'s owner who stepped out names and saves a page', async () => {
    for (const phone of [false, true]) {
      const label = phone ? 'phone' : 'laptop';
      // A topic the person reads, on its outcome's team, and neither started nor takes part in.
      const read = await control({ method: 'agent_topic', operation_id: 'nb-reader-' + label, title: 'Read here', body: 'The agent\'s topic.', team: true, watching: true });
      const theirs = 'nb-their-page-' + label;
      assert.equal((await control({ method: 'agent_page', operation_id: theirs, item_id: theirs, topic_id: read.topic_id, title: 'Their page', body: '## Theirs\n\nWords to read.\n' })).status, 'committed');
      assert.equal((await view('memory_items', { owner_scope: { kind: 'topic', id: read.topic_id } })).reader_may_write, false, 'Core says the person may not write it');
      let p = await opened('nb-reader-rail-' + label, `${facts.origin}/?topic=${read.topic_id}`, phone);
      await openRail(p, phone);
      await until(() => p.evaluate(`[...document.querySelectorAll(${JSON.stringify(RAIL_NOTEBOOK + ' .things-list a')})].some(a=>a.textContent.startsWith('Their page'))`), 'the rail lists the page');
      assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(PENCIL)})?.checkVisibility())`), false, 'no pencil for a reader Core does not let write');
      await shot(p, 'notebook-no-pencil-' + label);
      assert.deepEqual(p.errors, []); await p.close();
      // The page opens to read: no Draft, no Edit, New card or Undo, no Add image, no ask, its words not writable.
      p = await opened('nb-reader-sheet-' + label, `${facts.origin}/?topic=${read.topic_id}&page=${theirs}`, phone, SIGNS);
      await sheetShows(p, 'Their page');
      await until(() => p.evaluate("document.querySelector('#new-message-sheet .notebook-sheet-status').textContent==='To read'"), 'the saving sign says the page is to read');
      assert.deepEqual(await p.evaluate('globalThis.statusesSeen'), ['To read'], 'the saving sign never says anything of theirs is kept or saved');
      assert.deepEqual(await p.evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(SHEET_PAGE)}),v=e=>Boolean(e?.checkVisibility());
        return {draft:v(document.querySelector('#new-message-sheet .notebook-draft-toggle')),bar:[...s.querySelectorAll('.deck-bar button')].filter(v).length,
          image:v(s.querySelector('.notebook-images>button')),ask:s.querySelectorAll('.deck-ask').length,writable:!s.querySelector('.notebook-text').readOnly,
          status:document.querySelector('#new-message-sheet .notebook-sheet-status').textContent}})()`),
        { draft: false, bar: 0, image: false, ask: 0, writable: false, status: 'To read' });
      assert.deepEqual(p.errors, []); await p.close();
      // The Reader's ⋯ at a revision copies its links and offers no Edit page.
      p = await opened('nb-reader-menu-' + label, `${facts.origin}/?topic=${read.topic_id}&page=${theirs}&revision=1`, phone);
      await until(() => p.evaluate(`document.querySelector('#reader').open && document.querySelector('#reader-title').textContent==='Their page'`), 'the Reader shows the page');
      await until(() => p.evaluate("document.getAnimations().every(a=>a.playState!=='running')"), 'the Reader settled');
      await press(p, '#reader-menu', phone);
      await until(async () => (await menuItems(p)).includes('Copy Link to Revision 1'), 'the ⋯ opens');
      assert.equal((await menuItems(p)).includes('Edit page'), false, 'no Edit page for a reader Core does not let write');
      assert.deepEqual(p.errors, []); await p.close();

      // A topic the person started and stepped out of, in an outcome they do not own: theirs to write.
      const own = await control({ method: 'own_topic', operation_id: 'nb-owner-' + label, title: 'Mine, stepped out' });
      assert.equal((await view('topic', { topic_id: own.topic_id })).participants.some(x => x.actor_id === facts.actor && x.active !== false), false, 'the person takes no part in it');
      assert.equal((await view('memory_items', { owner_scope: { kind: 'topic', id: own.topic_id } })).reader_may_write, true);
      p = await opened('nb-owner-' + label, `${facts.origin}/?topic=${own.topic_id}`, phone);
      await openRail(p, phone);
      await until(() => visible(p, PENCIL), 'the pencil shows to the topic\'s owner');
      await p.evaluate(`document.querySelector(${JSON.stringify(PENCIL)}).scrollIntoView({block:'center'})`);
      await press(p, PENCIL, phone);
      const input = RAIL_NOTEBOOK + ' input', name = 'Owner\'s notes ' + label;
      await until(() => p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(input)})`), 'the title line, focused');
      await p.send('Input.insertText', { text: name });
      await p.key('Enter');
      const first = '#new-message-sheet.notebook-mode .notebook-sheet-page:not([hidden]) .deck-writing textarea';
      await until(() => p.evaluate(`document.querySelector('.notebook-sheet-title')?.textContent===${JSON.stringify(name)} && document.activeElement===document.querySelector(${JSON.stringify(first)})`), 'the named page opens, its first card ready');
      await p.send('Input.insertText', { text: 'First card\nWritten by its owner.' });
      await p.key('Escape');
      const made = (await view('memory_items', { owner_scope: { kind: 'topic', id: own.topic_id }, limit: 100 })).items.find(item => item.title === name);
      assert.ok(made, 'Core holds the named page in the topic\'s Notebook');
      await until(async () => (await view('memory_current', { item_id: made.id })).body.includes('Written by its owner.'), 'the card is saved in Core');
      assert.deepEqual((await view('memory_current', { item_id: made.id })).owner_scope, { kind: 'topic', id: own.topic_id });
      await shot(p, 'notebook-owner-page-' + label);
      assert.deepEqual(p.errors, []); await p.close();
      // And the Reader's ⋯ offers its owner Edit page.
      p = await opened('nb-owner-menu-' + label, `${facts.origin}/?topic=${own.topic_id}&page=${made.id}&revision=1`, phone);
      await until(() => p.evaluate(`document.querySelector('#reader').open && document.querySelector('#reader-title').textContent===${JSON.stringify(name)}`), 'the Reader shows the page');
      await until(() => p.evaluate("document.getAnimations().every(a=>a.playState!=='running')"), 'the Reader settled');
      await press(p, '#reader-menu', phone);
      await until(async () => (await menuItems(p)).includes('Edit page'), 'Edit page for the topic\'s owner');
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 391: a person who writes a page marks it a draft beside Text / Cards, in the composer and on the full page;
  // agents then get its title and that it is a draft, never its words; Undo, or the toggle, clears it; and while it is
  // marked its cards offer no speech bubble.
  await check('notebook a writer marks a page a draft and Undo clears it: agents get no words, its cards offer no bubble, light and dark', async () => {
    for (const phone of [false, true]) {
      const label = phone ? 'phone' : 'laptop', id = 'nb-draft-' + label;
      assert.equal((await control({ method: 'agent_page', operation_id: id, item_id: id, topic_id: 't1', title: 'Plan in progress', body: '## First\n\nHalf a thought.\n\n## Second\n\nAnother.\n' })).status, 'committed');
      const core = () => view('memory_current', { item_id: id }), agent = () => control({ method: 'agent_view', name: 'memory_current', args: { item_id: id } });
      const TOGGLE = '#new-message-sheet .notebook-sheet-views .notebook-draft-toggle', asks = p => p.evaluate(`document.querySelectorAll(${JSON.stringify(SHEET_PAGE + ' .deck-ask')}).length`);
      let p = await opened('nb-draft-sheet-' + label, `${facts.origin}/?topic=t1&page=${id}`, phone);
      await sheetShows(p, 'Plan in progress');
      await until(async () => (await asks(p)) === 2, 'each card offers its speech bubble');
      const control0 = await p.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(TOGGLE)}),r=b.getBoundingClientRect();return {name:b.textContent,pressed:b.getAttribute('aria-pressed'),title:b.title,height:r.height,width:r.width}})()`);
      assert.equal(control0.name, 'Draft'); assert.equal(control0.pressed, 'false'); assert.match(control0.title, /^Mark as a draft/);
      if (phone) assert.ok(Math.round(control0.height) >= 44 && Math.round(control0.width) >= 44, 'the toggle is 44 points on a phone: ' + JSON.stringify(control0));
      await press(p, TOGGLE, phone);
      await until(async () => (await core()).draft === true, 'the mark is saved in Core');
      assert.equal((await core()).source_ref.revision, 2, 'as a revision of its own');
      const withheld = await agent();
      assert.deepEqual([withheld.title, withheld.draft, withheld.withheld, withheld.body], ['Plan in progress', true, true, ''], 'an agent gets the title and the mark, never the words');
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(TOGGLE)}).getAttribute('aria-pressed')==='true'`), 'the toggle shows the mark');
      assert.match(await p.evaluate(`document.querySelector(${JSON.stringify(TOGGLE)}).title`), /agents do not read this page until the mark is cleared/);
      await until(async () => (await asks(p)) === 0, 'a draft page\'s cards offer no speech bubble');
      for (const scheme of ['light', 'dark']) {
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
        assert.ok(await contrast(p, TOGGLE) >= 4.5, `the Draft word reads in ${scheme}`);
        await shot(p, `notebook-draft-${label}-${scheme}`);
      }
      await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: '' }] });
      // Undo takes the mark back: another revision, the words the agents' again, the bubbles back.
      const undo = await p.evaluate(`[...document.querySelectorAll(${JSON.stringify(SHEET_PAGE + ' .deck-bar button')})].findIndex(b=>b.textContent==='Undo')+1`);
      assert.ok(undo > 0, 'the cards\' Undo');
      await press(p, `${SHEET_PAGE} .deck-bar button:nth-of-type(${undo})`, phone);
      await until(async () => (await core()).draft === false, 'Undo clears the mark in Core');
      assert.equal((await core()).source_ref.revision, 3);
      assert.equal((await agent()).body, '## First\n\nHalf a thought.\n\n## Second\n\nAnother.\n', 'the agents read the words again');
      await until(async () => (await asks(p)) === 2, 'the bubbles come back with the words');
      assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(TOGGLE)}).getAttribute('aria-pressed')`), 'false');
      assert.deepEqual(p.errors, []); await p.close();
      // On the full page the mark stands beside Text / Cards too; a person reading the page sees it in the listing
      // and in the Reader; in the Text view the toggle itself clears it.
      p = await opened('nb-draft-full-' + label, `${facts.origin}/?cards=${id}&view=text`, phone);
      const FULL = '#deck-page .notebook-tools .notebook-draft-toggle';
      await until(async () => await p.evaluate(`document.body.dataset.ready==='true'`) && await visible(p, FULL), 'the full page shows the toggle');
      assert.equal(await p.evaluate(`(()=>{const v=document.querySelector('#deck-page .notebook-views').getBoundingClientRect(),d=document.querySelector(${JSON.stringify(FULL)}).getBoundingClientRect();return Math.abs((v.top+v.bottom)/2-(d.top+d.bottom)/2)<2})()`), true, 'on the line of Text / Cards');
      await press(p, FULL, phone);
      await until(async () => (await core()).draft === true, 'marked from the full page');
      await shot(p, 'notebook-draft-full-' + label);
      assert.deepEqual(p.errors, []); await p.close();
      p = await opened('nb-draft-listed-' + label, `${facts.origin}/?topic=t1`, phone);
      await openRail(p, phone);
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(`${RAIL_NOTEBOOK} a[href*="page=${id}"] .draft-mark`)}))`), 'the listing marks it');
      assert.match(await p.evaluate(`document.querySelector(${JSON.stringify(`${RAIL_NOTEBOOK} a[href*="page=${id}"] .draft-mark`)}).title`), /agents do not read this page until the mark is cleared/);
      await p.evaluate(`document.querySelector(${JSON.stringify(`${RAIL_NOTEBOOK} a[href*="page=${id}"]`)}).scrollIntoView({block:'center'})`);
      await shot(p, 'notebook-draft-listed-' + label);
      assert.deepEqual(p.errors, []); await p.close();
      p = await opened('nb-draft-reader-' + label, `${facts.origin}/?topic=t1&page=${id}&revision=4`, phone);
      await until(() => p.evaluate(`document.querySelector('#reader').open && document.querySelector('#reader-origin')?.textContent.includes('Notebook · revision 4 · draft')`), 'the Reader names the revision a draft');
      assert.equal(await p.evaluate(`document.querySelector('#source-body').textContent.includes('Half a thought.')`), true, 'a person reads its words');
      assert.deepEqual(p.errors, []); await p.close();
      p = await opened('nb-draft-clear-' + label, `${facts.origin}/?cards=${id}&view=text`, phone);
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(FULL)})?.getAttribute('aria-pressed')==='true'`), 'the full page shows the mark');
      await press(p, FULL, phone);
      await until(async () => (await core()).draft === false, 'the toggle clears it in the Text view');
      assert.equal((await agent()).withheld, false);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Items 371 and 391 for someone who reads a draft page Core no longer lets them write, here its writer once the
  // outcome is reached: the mark without its toggle, beside Text / Cards in the composer's head (at 320 wide on a
  // phone, clear of the saving sign) and on the full page; To read; its image without Remove; and, opened in place at
  // its revision on the outcome's page, the revision named a draft and no Edit page.
  await check('notebook a draft page in a reached outcome reads as a draft to someone Core no longer lets write it: the mark without its toggle, To read, its image without Remove, and in place the revision named a draft with no Edit page', async () => {
    for (const phone of [false, true]) {
      const label = phone ? 'phone' : 'laptop', outcome = 'nb-reached-' + label, id = 'nb-reached-page-' + label;
      await control({ method: 'navigation_workspaces', workspaces: [{ id: outcome, title: 'Reached ' + label }] });
      assert.equal((await control({ method: 'outcome_reference', operation_id: id, item_id: id, workspace_id: outcome, draft: true, title: 'Final plan', body: '## Plan\n\nShip it.\n' })).status, 'committed');
      // While the outcome is open its writer attaches an image, pasted in the Text view as the images case does.
      let p = await page('nb-reached-image-' + label, null, true, { url: `${facts.origin}/?cards=${id}&view=text` });
      await until(() => p.evaluate("document.body.dataset.ready==='true' && Boolean(document.querySelector('#deck-page .notebook-draft-toggle[aria-pressed=true]'))"), 'its writer sees the page marked a draft');
      const bytes = (await readFile(new URL('fixtures/media/one.png', import.meta.url))).toString('base64');
      await p.point('#notebook-text');
      await p.evaluate(`(()=>{const d=new DataTransfer();d.items.add(new File([Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0))],'reached-chart.png',{type:'image/png'}));document.querySelector('#notebook-text').dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true}));})()`);
      await until(async () => (await view('memory_current', { item_id: id })).attachments.length === 1, 'the image is saved to the page');
      await until(() => p.evaluate("[...document.querySelectorAll('#deck-page .notebook-image button')].some(b=>b.textContent==='Remove'&&b.checkVisibility())"), 'its writer may remove the image');
      assert.deepEqual(p.errors, []); await p.close();
      for (const [kind, args] of [['outcome.kind_set', { kind: 'reach' }], ['outcome.reach', { words: 'Done', unmet_confirmed: true }]])
        assert.equal((await control({ method: 'targets', kind, operation_id: `${outcome}-${kind}`, workspace_id: outcome, args })).status, 'committed');
      const current = await view('memory_current', { item_id: id });
      assert.deepEqual([current.draft, current.reader_may_write], [true, false], 'Core holds a draft its writer may no longer write');
      // On the right rail of its Conversation the page is listed, marked a draft, with no pencil: Core no longer lets
      // its writer start a page there either (reader_may_write), and the side rail lists no Notebook (item 464).
      assert.equal((await view('memory_items', { owner_scope: { kind: 'workspace', id: outcome } })).reader_may_write, false);
      p = await opened('nb-reached-rail-' + label, `${facts.origin}/?conversation=${outcome}`, phone);
      await openRail(p, phone);
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(railRow(id) + ' .draft-mark')})?.checkVisibility())`), 'the right rail lists the page, marked a draft');
      assert.deepEqual(await p.evaluate(`[[...document.querySelectorAll('#things .notebook-create')].filter(e=>e.checkVisibility()).length,document.querySelectorAll('#rail .notebook-create, #rail #outcome-references').length]`), [0, 0],
        'no pencil on the right rail for a reader Core does not let write, and none in the side rail');
      await shot(p, 'notebook-reached-rail-' + label);
      assert.deepEqual(p.errors, []); await p.close();
      // In the composer: on a phone at 320 wide, the narrowest head.
      p = await page('nb-reached-sheet-' + label, null, true, { url: `${facts.origin}/?workspace=${outcome}&page=${id}`, beforeNavigate: async q => {
        await q.send('Page.addScriptToEvaluateOnNewDocument', { source: SIGNS });
        if (!phone) return;
        await q.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
        await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      } });
      await sheetShows(p, 'Final plan');
      await until(() => p.evaluate("document.querySelector('#new-message-sheet .notebook-sheet-status').textContent==='To read' && Boolean(document.querySelector('#new-message-sheet .notebook-image'))"), 'the page opens to read, its image listed');
      const reads = p => p.evaluate(`(()=>{const v=e=>Boolean(e?.checkVisibility()),q=s=>document.querySelector(s),note=q('#new-message-sheet .notebook-sheet-views .notebook-draft-note');
        return {toggle:v(q('#new-message-sheet .notebook-draft-toggle')),note:[v(note),note?.textContent,note?.title],
          images:document.querySelectorAll(${JSON.stringify(SHEET_PAGE + ' .notebook-image')}).length,
          remove:[...document.querySelectorAll(${JSON.stringify(SHEET_PAGE + ' .notebook-image button')})].filter(v).map(b=>b.textContent),
          add:v(q(${JSON.stringify(SHEET_PAGE + ' .notebook-images>button')})),writable:!q(${JSON.stringify(SHEET_PAGE + ' .notebook-text')}).readOnly}})()`);
      assert.deepEqual(await reads(p), { toggle: false, note: [true, 'Draft', 'A draft: agents do not read this page until the mark is cleared'], images: 1, remove: [], add: false, writable: false },
        'the page reads as a draft, with nothing to write with');
      assert.deepEqual(await p.evaluate('globalThis.statusesSeen'), ['To read'], 'the saving sign never says anything of theirs is kept or saved');
      if (phone) {
        const head = await sheetHead(p);
        assert.deepEqual({ parts: head.parts.slice(3, 6), overlaps: head.overlaps, off: head.off, small: head.small, cut: head.cut },
          { parts: ['Text', 'Cards', 'Draft'], overlaps: [], off: [], small: [], cut: null }, 'at 320 wide the Draft mark stands clear of To read');
      }
      await shot(p, 'notebook-reached-draft-' + label);
      assert.deepEqual(p.errors, []); await p.close();
      // On the full page, the mark beside Text / Cards.
      p = await opened('nb-reached-full-' + label, `${facts.origin}/?cards=${id}`, phone);
      await until(() => p.evaluate("document.body.dataset.ready==='true' && Boolean(document.querySelector('#deck-page .notebook-tools .notebook-draft-note')?.checkVisibility())"), 'the full page shows the mark');
      assert.equal(await visible(p, '#deck-page .notebook-draft-toggle'), false, 'and no toggle');
      assert.deepEqual(p.errors, []); await p.close();
      // In place on the outcome's page, at its revision.
      p = await opened('nb-reached-here-' + label, `${facts.origin}/?workspace=${outcome}&page=${id}&revision=${current.source_ref.revision}`, phone);
      await until(() => p.evaluate("!document.querySelector('#page-here').hidden && Boolean(document.querySelector('#page-here .page-here-body'))"), 'the page opens in place');
      assert.deepEqual(await p.evaluate(`({origin:document.querySelector('#page-here .muted').textContent,edit:Boolean(document.querySelector('#page-here .page-here-cards'))})`),
        { origin: `Notebook · revision ${current.source_ref.revision} · draft`, edit: false }, 'the revision is named a draft, and there is no Edit page');
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('notebook a page read and revised since wears its new revisions on the right rail until opened, and opening it shows what changed', async () => {
    await revise('Ship on Friday.\nDan reviews the notes.\n');
    const p = await page('notebook-light', null, true);
    await wholeOutcome(p);
    await railLists(p, id);
    assert.deepEqual(await p.evaluate(`[document.querySelector('#things').contains(document.querySelector(${JSON.stringify(row)})),document.querySelectorAll('#rail .reference, #rail #outcome-references').length]`), [true, 0],
      'the page is listed on the right rail, and the side rail lists no Notebook');
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
    await shot(p, 'notebook-rail-light');
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
    await wholeOutcome(p);
    await railLists(p, id);
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
      // On a phone the pages are in the right rail's sheet, "Pipeline & pages" over the topic, with All of this outcome.
      await wholeOutcome(p);
      await railLists(p, id);
      await revise(`Ship on ${scheme === 'light' ? 'Tuesday' : 'Wednesday'}.\nDan reviews the notes, and Warp signs off.\n`);
      await until(() => light(p), 'the light comes on');
      await p.evaluate(`document.querySelector(${JSON.stringify(row)}).scrollIntoView({block:'center',behavior:'instant'})`);
      const fit = await p.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(row)}).getBoundingClientRect(),d=document.getElementById('things').getBoundingClientRect();
        return {page:document.documentElement.scrollWidth,height:r.height,left:r.left,right:r.right,drawer:[d.left,d.right],side:document.querySelectorAll('#rail .reference, #rail #outcome-references').length}})()`);
      assert.ok(fit.page <= 390, `no sideways page scroll: ${fit.page}`);
      assert.ok(fit.height >= 44 && fit.left >= fit.drawer[0] && fit.right <= fit.drawer[1] + 0.5, `a touch-sized row inside the open sheet: ${JSON.stringify(fit)}`);
      assert.equal(fit.side, 0, 'the side rail lists no Notebook');
      assert.ok(await contrast(p, row) >= 4.5, 'the row title is readable');
      await shot(p, `notebook-phone-${scheme}-rail`);
      await openRow(p);
      assert.equal(await p.evaluate("document.documentElement.hasAttribute('data-things-open')"), false, 'opening the page puts the sheet away');
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
    const row = pageRow, light = p => p.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(pageRow + ' .unread-count')});return b?{text:b.textContent}:null})()`);
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
    await until(() => p.evaluate("document.getAnimations().filter(x=>x.effect?.getTiming().iterations!==Infinity).every(a=>a.playState!=='running')"), 'the Reader settled');
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
      body:document.querySelector('#page-here .page-here-body').textContent,at:location.search,edit:document.querySelector('#page-here .page-here-cards')?.textContent??null})`),
      { title: 'Linked plan', revision: 'Notebook · revision 1', body: 'Ship on Friday.\nDan reviews the notes.\n', at: '?workspace=w1', edit: 'Edit page' },
      'in place, a page its reader may write offers Edit page, and a revision not marked is not named a draft');
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

  await check('notebook on the cards page, every key that leaves a card picked brings it into view with a tenth of the window beyond it: ↑ ↓, ⌘↑ ⌘↓, ⇧⌘↓, Tab and ⇧Tab, ⌘Z, ⇧↓ and Escape, ⌘⌫, and Return and ⌘↓ on a card being written; a click scrolls nothing', async () => {
    const body = Array.from({ length: 30 }, (_, k) => `## Card ${k + 1}\n\nThe words of card ${k + 1}.\n`).join('\n');
    const id = 'notebook-cards-margin', p = await cards(id, body);
    // The picked card, or the card being written: its title, its box, the window's height, and how far the page is and can be scrolled.
    const at = () => p.evaluate(`(()=>{const w=document.querySelector('#deck-page .deck-writing'),r=w??document.querySelector('#deck-page .deck-card[aria-current=true]'),b=r.getBoundingClientRect();
      return {title:w?w.querySelector('textarea').value.split('\\n')[0]:r.querySelector('.deck-title').textContent,top:b.top,bottom:b.bottom,h:innerHeight,y:scrollY,max:document.documentElement.scrollHeight-innerHeight}})()`);
    const close = (a, b) => Math.abs(a - b) <= 1.5;
    // The keys' rule (docs/interaction.md): the card shows whole, with a tenth of the window below it and above it,
    // unless the page is scrolled as far as it goes that way.
    const roomy = async (title, words) => {
      const a = await at(), room = a.h * 0.1, said = `${words}: ${JSON.stringify(a)}`;
      if (title !== null) assert.equal(a.title, title, `${words}: the card the keys leave picked`);
      assert.ok(a.top >= -0.5 && a.bottom <= a.h + 0.5, `${said}: the card shows whole`);
      if (a.y < a.max - 0.5) assert.ok(a.bottom <= a.h - room + 1.5, `${said}: a tenth of the window shows below it`);
      if (a.y > 0.5) assert.ok(a.top >= room - 1.5, `${said}: a tenth of the window shows above it`);
      return a;
    };
    // Before a key: the page scrolled so the card stands 4px inside the window's top or bottom edge, whole, where
    // scrolling only as far as the card needs would leave it.
    const edge = async (side, words) => {
      await p.evaluate(`(()=>{const r=(document.querySelector('#deck-page .deck-writing')??document.querySelector('#deck-page .deck-card[aria-current=true]')).getBoundingClientRect();
        scrollBy({top:${side === 'bottom' ? 'r.bottom-(innerHeight-4)' : 'r.top-4'},behavior:'instant'})})()`);
      const a = await at();
      assert.ok(side === 'bottom' ? close(a.bottom, a.h - 4) : close(a.top, 4), `${words}: before the key, the card stands 4px inside the window's ${side}: ${JSON.stringify(a)}`);
    };
    let ys = [];
    for (let k = 2; k <= 30; k++) { await p.key('ArrowDown'); ys.push((await roomy(`Card ${k}`, `↓ onto Card ${k}`)).y); }
    assert.ok(new Set(ys).size >= 4, `↓ down the deck scrolled the page: ${JSON.stringify(ys)}`);
    for (let k = 29; k >= 18; k--) { await p.key('ArrowUp'); await roomy(`Card ${k}`, `↑ onto Card ${k}`); }
    // ⌘↓ moves Card 18 down the deck, each move a tenth inside the window, as each ↓ was.
    ys = [];
    for (let n = 1; n <= 8; n++) { await p.key('ArrowDown', 4); ys.push((await roomy('Card 18', `⌘↓ moves Card 18 down, ${n}`)).y); }
    assert.ok(new Set(ys).size >= 2, `⌘↓ down the deck scrolled the page: ${JSON.stringify(ys)}`);
    // Up the deck again, to a card the page can scroll to either edge of the window.
    for (let n = 1; n <= 12; n++) { await p.key('ArrowUp'); await roomy(null, `↑ back up the deck, ${n}`); }
    const mid = (await at()).title;
    await edge('bottom', '⌘↓'); await p.key('ArrowDown', 4); await roomy(mid, '⌘↓ from the window\'s bottom edge');
    await edge('top', '⌘↑'); await p.key('ArrowUp', 4); await roomy(mid, '⌘↑ from the window\'s top edge');
    await edge('bottom', '⇧⌘↓'); await p.key('ArrowDown', 12); await roomy(null, '⇧⌘↓ merges, from the window\'s bottom edge');
    await edge('bottom', '⌘Z'); await p.key('z', 4); await roomy(null, '⌘Z puts the merge back, from the window\'s bottom edge');
    // Safari's engine presses a check's Tab as ⌥Tab (webkit_native.mjs), which a picked card leaves to the browser.
    if (!p.pw) {
      await edge('bottom', 'Tab'); await p.key('Tab'); const tabbed = await roomy(null, 'Tab puts the card under the one above, from the window\'s bottom edge');
      await edge('bottom', '⇧Tab'); await p.key('Tab', 8); await roomy(tabbed.title, '⇧Tab takes it out, from the window\'s bottom edge');
    }
    await p.key('ArrowDown', 8); const extended = await roomy(null, '⇧↓ selects the card below with it');
    assert.equal(await p.evaluate("document.querySelectorAll('#deck-page .deck-selected').length"), 2, '⇧↓ selects two cards');
    await edge('bottom', 'Escape'); await p.key('Escape'); await roomy(extended.title, 'Escape ends the selection, from the window\'s bottom edge');
    assert.equal(await p.evaluate("document.querySelectorAll('#deck-page .deck-selected').length"), 0, 'Escape ends the selection');
    await edge('bottom', '⌘⌫'); await p.key('Backspace', 4); const after = await roomy(null, '⌘⌫ removes the card, from the window\'s bottom edge');
    assert.notEqual(after.title, extended.title, '⌘⌫ removed the picked card');
    await edge('bottom', 'Return'); await p.key('Enter'); await roomy('', 'Return opens a new card under it, from the window\'s bottom edge');
    await p.send('Input.insertText', { text: 'Written' });
    await edge('bottom', '⌘↓ in writing'); await p.key('ArrowDown', 4); await roomy('Written', '⌘↓ moves the card being written, from the window\'s bottom edge');
    await p.key('Escape');
    await until(async () => (await at()).title === 'Written' && !await p.evaluate("Boolean(document.querySelector('#deck-page .deck-writing'))"), 'Escape makes the card written');
    // A click on a card standing in the window's bottom tenth opens it for writing where it is: the page stays.
    await p.key('ArrowUp');
    const clicked = await at();
    await edge('bottom', 'a click');
    const still = await p.evaluate('scrollY');
    const word = await p.evaluate(`(()=>{const r=document.querySelector('#deck-page .deck-card[aria-current=true] .deck-words').getBoundingClientRect();return {x:r.left+4,y:r.top+r.height/2}})()`);
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...word });
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...word, button: 'left', clickCount: 1 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...word, button: 'left', clickCount: 1 });
    await until(async () => (await at()).title === clicked.title && await p.evaluate("Boolean(document.querySelector('#deck-page .deck-writing'))"), 'a click opens the card for writing');
    assert.equal(await p.evaluate('scrollY'), still, 'a click on a card in the window\'s bottom tenth scrolls nothing');
    await p.key('Escape');
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  // A page in the composer over the feed (item 396), in a module of its own.
  await notebookSheetChecks({ check, page, until, control, view, facts, shot });
  // Images in a card (item 321), in a module of its own.
  await cardImageChecks({ check, page, until, control, view, facts, shot });
}
