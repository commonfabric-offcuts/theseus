import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// A Notebook page in the composer over the feed (item 396, docs/decks.md "Where it opens"), in the real browser
// against the real server, at a laptop's width with a pointer and keys and at a phone's with touch: a page opened
// from the right rail's whole outcome, the topic's own Notebook, the right rail's topic, the outcome's page and a link as it stands brings up
// the New message sheet with the page in it; a card being written survives ✕, a press outside and Escape, and the
// feed's place and focus come back; keys and a wheel never move the feed behind; a card's reply stack opens in the
// Reader and its way back brings the page back as it was, from the same topic and from another; opening another
// page replaces the first; what changed since it was read shows on opening; a revision made elsewhere reaches the
// page while it shows and costs a closed one nothing; a reload keeps a card half written.
// The sheet's head as drawn: its title, ↗, ✕, each chip beside the title (Text, Cards, and Draft, the toggle or the
// mark), and the saving sign's words and time. overlaps names each pair whose boxes cross; off, each part not wholly
// on screen; small, on touch, each control under 44 points; cut, the saving sign's words when they do not show whole;
// covered, each part whose middle a press would not reach, something else drawn there.
export const sheetHead = p => p.evaluate(`(()=>{const d=document.querySelector('#new-message-sheet'),shown=e=>e&&e.getClientRects().length&&!e.closest('[hidden]');
  const name=e=>e.getAttribute('aria-label')||e.textContent.trim()||e.className;
  const parts=[d.querySelector('.notebook-sheet-title'),d.querySelector('.notebook-sheet-full'),d.querySelector('.notebook-sheet-close'),
    ...d.querySelectorAll('.notebook-sheet-views button,.notebook-sheet-views .notebook-draft-note'),...d.querySelectorAll('.notebook-sheet-status .deck-status>*')].filter(shown)
    .map(e=>{const r=e.getBoundingClientRect();return {e,name:name(e),x:r.left,y:r.top,r:r.right,b:r.bottom}});
  const overlaps=[];for(const [i,a] of parts.entries())for(const b of parts.slice(i+1))if(Math.min(a.r,b.r)-Math.max(a.x,b.x)>0.5&&Math.min(a.b,b.b)-Math.max(a.y,b.y)>0.5)overlaps.push(a.name+' × '+b.name+' at x '+Math.round(Math.max(a.x,b.x)));
  const touch=matchMedia('(pointer:coarse)').matches,controls=parts.filter(q=>q.e.matches('button,a,.notebook-draft-note'));
  const words=d.querySelector('.notebook-sheet-status .deck-status>span');
  const covered=parts.filter(q=>{const at=document.elementFromPoint((q.x+q.r)/2,(q.y+q.b)/2);return !at||!(q.e===at||q.e.contains(at))}).map(q=>q.name);
  return {parts:parts.map(q=>q.name),overlaps,covered,off:parts.filter(q=>q.x<0||q.r>innerWidth+0.5).map(q=>q.name),
    small:touch?controls.filter(q=>q.r-q.x<43.5||q.b-q.y<43.5).map(q=>q.name+' '+Math.round(q.r-q.x)+'×'+Math.round(q.b-q.y)):[],
    cut:!words?'no saving sign':words.scrollWidth>words.clientWidth+1?words.textContent:null,sideways:document.documentElement.scrollWidth>innerWidth}})()`);

export async function notebookSheetChecks({ check, page, until, control, view, facts, shot }) {
  const SHEET = '#new-message-sheet', PAGE = `${SHEET} .notebook-sheet-page:not([hidden])`;
  // What the sheet shows: whether it is open as a Notebook page, whether it is on screen (drawn, and a press on its
  // title reaches it: a dialog in a box that is not drawn is open and shows nothing), its title, whether the Reader is
  // open over the feed instead, the cards that show, how many pages it holds, and the card box with its words, cursor
  // and focus.
  const state = p => p.evaluate(`(()=>{const d=document.querySelector(${JSON.stringify(SHEET)}),pg=d.querySelector('.notebook-sheet-page:not([hidden])'),f=pg?.querySelector('.deck-writing textarea');
    const t=d.querySelector('.notebook-sheet-title')?.getBoundingClientRect(),at=t&&t.width&&t.height?document.elementFromPoint(t.left+Math.min(t.width/2,40),t.top+t.height/2):null;
    return {open:d.open&&d.classList.contains('notebook-mode'),seen:d.getClientRects().length>0&&Boolean(at&&d.contains(at)),title:d.querySelector('.notebook-sheet-title')?.textContent??null,reader:document.querySelector('#reader').open,
      cards:[...(pg?.querySelectorAll('.deck-card:not([hidden]) .deck-title')??[])].map(e=>e.textContent),pages:d.querySelectorAll('.notebook-sheet-page').length,
      box:f?{words:f.value,at:[f.selectionStart,f.selectionEnd],focused:document.activeElement===f}:null}})()`);
  const waitFor = (p, probe, want, words) => until(async () => probe(await state(p)), words)
    .catch(async error => { assert.deepEqual(await state(p), want, words); throw error; });
  const opened = (p, title, cards) => waitFor(p, s => s.open && s.seen && s.title === title && !s.reader && JSON.stringify(s.cards) === JSON.stringify(cards),
    { open: true, seen: true, title, reader: false, cards }, `the page ${title} opens in the New message sheet over the feed, on screen, not in the Reader`);
  const closed = p => waitFor(p, s => !s.open, { open: false }, 'the sheet closes');
  const words = p => p.evaluate(`document.querySelector(${JSON.stringify(PAGE + ' .notebook-text')})?.value ?? null`);
  const settle = p => p.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,50))))');
  const scrolled = p => p.evaluate('scrollY');
  // A page's smooth scroll from a key or a wheel runs on after it starts: wait until two frames agree.
  const rested = async p => { let last = await scrolled(p); for (;;) { await settle(p); const now = await scrolled(p); if (now === last) return now; last = now; } };
  // Core's page holds these words; a failure says what Core's page held instead.
  const saved = (id, part, said) => until(async () => (await view('memory_current', { item_id: id })).body.includes(part), said)
    .catch(async error => { const body = (await view('memory_current', { item_id: id })).body; assert.ok(body.includes(part), `${said}: Core's page reads ${JSON.stringify(body)}`); throw error; });
  const outcomePage = async (id, title, body) => {
    const answer = await control({ method: 'outcome_reference', operation_id: `${id}-create`, item_id: id, title, body });
    assert.equal(answer.status, 'committed', JSON.stringify(answer));
    return id;
  };
  const topicPage = async (title, body) => {
    const id = (await control({ method: 'seed', memory_items: 1 })).item_ids[0];
    const answer = await control({ method: 'memory_revise', operation_id: `${id}-cards`, item_id: id, expected_revision: 1, title, body });
    assert.equal(answer.status, 'committed', JSON.stringify(answer));
    return id;
  };
  // A page in the topic's own Notebook, in the outcome's on its own page, and in the outcome's on the right rail (its
  // Notebook section with All of this outcome; the side rail lists no Notebook, item 464).
  const RAIL_NOTEBOOK = '#things .things-sec[data-key="notebook"]';
  const card = id => `#memory-items .memory-card[data-id="${id}"]`, row = id => `#outcome-references-list .reference[data-id="${id}"]`, railRow = id => `${RAIL_NOTEBOOK} a.row[href$="page=${id}"]`;
  // The right rail shows the whole outcome's things: All of this outcome, once the rail has read.
  const wholeOutcome = async p => {
    const chip = '#things .things-scope .chip:last-child';
    await until(() => p.evaluate(`document.body.dataset.ready==='true' && !document.querySelector('#things .things-scope').hidden && document.querySelector('#things .things-sections')?.getAttribute('aria-busy')!=='true'`), 'the right rail has read');
    // The rail scrolls in itself, and a row pressed before may have taken its chips out of view.
    await p.evaluate(`document.querySelector(${JSON.stringify(chip)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
    await p.point(chip);
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(chip)}).getAttribute('aria-pressed')==='true' && document.querySelector('#things .things-sections').getAttribute('aria-busy')!=='true'`), 'the right rail shows the whole outcome');
  };
  // A page listed in the topic's Notebook, the outcome's page or the right rail, pressing More as a reader would while
  // the list holds only its first pages (the checks before these leave many). A row or More counts once it shows.
  const listed = async (p, selector, said) => {
    const [more, rows] = selector.startsWith('#memory-items') ? ['#more-memory', '#memory-items > *'] : selector.startsWith('#things') ? [`${RAIL_NOTEBOOK} .things-more`, `${RAIL_NOTEBOOK} .things-list a.row`] : ['#more-references', '#outcome-references-list > *'];
    const look = () => p.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(more)});const shown=e=>Boolean(e&&e.getClientRects().length);return {here:shown(document.querySelector(${JSON.stringify(selector)})),more:shown(b)&&!b.disabled&&b.getAttribute('aria-disabled')!=='true',rows:document.querySelectorAll(${JSON.stringify(rows)}).length}})()`);
    for (;;) {
      const now = await until(async () => { const at = await look(); return at.here || at.more ? at : null; }, said);
      if (now.here) return;
      // More shown here may be the one an earlier press is still reading for: when that read brings the list's last
      // page, More goes away as it is aimed at, and the list is looked at again rather than More pressed.
      try { await press(p, more); } catch (error) { if ((await look()).more) throw error; continue; }
      // More while the list is being read again does nothing (outcome-references.mjs): once the read is done, More
      // is pressed again unless it brought the page.
      await until(async () => { const at = await look(); return at.here || at.rows > now.rows || at.more; }, `${said}, after More`);
    }
  };
  // A pointer on a control in view; the topic's own Notebook is at the end of the feed, scrolled to as a reader would.
  // The sidebar scrolls smoothly: brought into view at once, so the pointer aims where it stays.
  const press = async (p, selector) => {
    await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
    await p.point(selector);
  };
  // A finger, once its target holds its place.
  const tap = async (p, selector) => {
    let last = null;
    await until(async () => { const now = await p.box(selector), same = Boolean(last && now) && ['x', 'y', 'width', 'height'].every(key => now[key] === last[key]); last = now; return same; }, selector + ' holds its place');
    const x = last.x + last.width / 2, y = last.y + last.height / 2;
    assert.ok(x >= 0 && y >= 0 && x < last.viewportWidth && y < last.viewportHeight, selector + ' is on screen');
    await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  // A laptop's window short enough that the topic's page scrolls under the sheet.
  const laptop = { beforeNavigate: q => q.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 600, deviceScaleFactor: 1, mobile: false }) };
  const phone = { beforeNavigate: async q => {
    await q.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  } };
  // The card of that title in the sheet, by its index.
  const cardOf = async (p, title) => {
    const index = await p.evaluate(`[...document.querySelectorAll(${JSON.stringify(PAGE + ' .deck-card')})].find(r=>r.querySelector('.deck-title')?.textContent===${JSON.stringify(title)})?.dataset.index ?? null`);
    assert.notEqual(index, null, `the card ${title} shows`);
    return `${PAGE} .deck-card[data-index="${index}"]`;
  };
  // A press in a card's words opens its box there; ⌃E takes the cursor to the end of the line, and the words go in.
  const writeIn = async (p, title, text) => {
    await p.point(`${await cardOf(p, title)} .deck-words`);
    await waitFor(p, s => s.box?.focused, { box: { focused: true } }, `the card ${title} opens to write`);
    await p.key('e', 2);
    await p.send('Input.insertText', { text });
  };
  // A key as a keyboard sends it: Chrome's harness names letters' key codes alone, so the paging keys go with their
  // own (WebKit's harness presses them by name).
  const CODES = { PageUp: 33, PageDown: 34, End: 35, Home: 36, ' ': 32 };
  const keyed = async (p, name) => {
    if (p.pw || !(name in CODES)) return p.key(name);
    const data = { key: name, code: name === ' ' ? 'Space' : name, windowsVirtualKeyCode: CODES[name], ...(name === ' ' ? { text: ' ', unmodifiedText: ' ' } : {}) };
    await p.send('Input.dispatchKeyEvent', { type: name === ' ' ? 'keyDown' : 'rawKeyDown', ...data });
    await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...data });
  };
  const cardsBody = '## Plan\n\nShip it.\n\n### Steps\n\nOne, two.\n\n## Notes\n\nDan reviews.\n';
  // The page's saving, as it went (items 421, 422): before the app starts, its fetch is wrapped so every memory.revise
  // the page sends (operation, expected revision, body) is kept with its receipt (status, revision, refusal), every
  // memory_current it reads with the revision and body it got, and every change of the saving sign's words; and the
  // card box's cursor and focus at each focus, input, redraw and cursor set, with the cards' words then.
  const TRAIL = `(()=>{const trail=[];Object.defineProperty(window,'__notebookTrail',{value:trail});
    const own=window.fetch.bind(window),t0=performance.now(),at=()=>Math.round(performance.now()-t0),reads=[];
    // A read of the page held, its answer read in full, until a card box's or the Text box's next input: let go in that
    // input's first listener, the page takes the answer before the box's own listeners run. After a save: the first
    // read once a save commits.
    window.__notebookReadsToInput=0;window.__notebookReadAfterSave=false;
    document.addEventListener('input',e=>{if(e.target?.classList?.contains('deck-editor')||e.target?.classList?.contains('notebook-text'))reads.splice(0).forEach(go=>go());},true);
    window.fetch=async(input,init)=>{
      let ask=null;try{ask=typeof init?.body==='string'?JSON.parse(init.body):null;}catch{}
      const url=String(input?.url??input),revise=url.endsWith('/api/command')&&ask?.kind==='memory.revise',read=url.endsWith('/api/view')&&ask?.name==='memory_current';
      if(!revise&&!read)return own(input,init);
      const entry=revise?{kind:'revise',at:at(),operation:ask.operation_id,expected:ask.expected?.item_revision,body:ask.args?.body}:{kind:'read',at:at()};
      trail.push(entry);
      const toInput=read&&window.__notebookReadsToInput>0;if(toInput)window.__notebookReadsToInput--;
      try{let response=await own(input,init);
        if(toInput){
          const text=await response.text(),{status,statusText}=response,headers=[...response.headers];
          entry.held=at();await new Promise(go=>reads.push(go));entry.released=at();
          response=new Response(text,{status,statusText,headers});response.json=async()=>JSON.parse(text);}
        if(revise&&window.__notebookReadAfterSave){const r=await response.clone().json();if(r.status==='committed'){window.__notebookReadAfterSave=false;window.__notebookReadsToInput=1;}}
        response.clone().json().then(r=>{entry.answered=at();
          if(revise)Object.assign(entry,{status:r.status,revision:r.result?.revision??null,code:r.error?.code??null});
          else Object.assign(entry,{revision:r.source_ref?.revision??null,body:r.body??null,code:r.error?.code??null});},()=>{entry.answered='unreadable';});
        return response;}
      catch(error){entry.thrown=String(error?.message??error);throw error;}};
    const box=e=>e?.classList?.contains('deck-editor');
    const cursor=(why,e)=>trail.push({kind:'cursor',at:at(),why,sel:[e.selectionStart,e.selectionEnd],len:e.value.length,shown:Boolean(e.getClientRects().length),focused:document.activeElement===e,
      active:(a=>a&&a.tagName+(a.id?'#'+a.id:'')+(a.className&&typeof a.className==='string'?'.'+a.className.split(' ')[0]:''))(document.activeElement),
      deck:[...(e.closest('.deck-page')?.querySelectorAll('.deck-card .deck-words')??[])].map(w=>w.textContent)});
    const range=HTMLTextAreaElement.prototype.setSelectionRange;
    HTMLTextAreaElement.prototype.setSelectionRange=function(...args){const r=range.apply(this,args);if(box(this))cursor('set '+args.slice(0,2).join(','),this);return r;};
    for(const type of ['focusin','focusout','input'])document.addEventListener(type,e=>{if(box(e.target))cursor(type,e.target);},true);
    new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes){const e=n.querySelector?.('.deck-editor');if(e)cursor('drawn',e);}}).observe(document,{subtree:true,childList:true});
    let said=null;new MutationObserver(()=>{const s=document.querySelector('#new-message-sheet .notebook-sheet-status .deck-status')?.textContent??null;
      if(s!==said){said=s;trail.push({kind:'sign',at:at(),words:s});}}).observe(document,{subtree:true,childList:true,characterData:true});})()`;
  const traced = setup => ({ beforeNavigate: async q => { await setup.beforeNavigate(q); await q.send('Page.addScriptToEvaluateOnNewDocument', { source: TRAIL }); } });
  // At each step: the card box's words, the saving sign, the cards shown, whether the page asks for a choice, what the
  // page sent and read since the last step, and Core's page as it stands. A failure carries every step taken.
  const tracer = (id, steps = []) => {
    const taken = new WeakMap();
    const step = async (p, name) => {
      const seen = taken.get(p) ?? 0;
      const page = await p.evaluate(`(()=>{const d=document.querySelector(${JSON.stringify(SHEET)}),pg=d.querySelector('.notebook-sheet-page:not([hidden])'),f=pg?.querySelector('.deck-writing textarea');
        return {open:d.open,box:f?f.value:null,at:f?[f.selectionStart,f.selectionEnd]:null,sign:d.querySelector('.notebook-sheet-status .deck-status')?.textContent??null,
          cards:[...(pg?.querySelectorAll('.deck-card:not([hidden]) .deck-title')??[])].map(e=>e.textContent),
          choice:Boolean(pg&&pg.querySelector('.notebook-conflict')&&!pg.querySelector('.notebook-conflict').hidden),
          trail:(window.__notebookTrail??[]).slice(${seen}),traced:(window.__notebookTrail??[]).length}})()`).catch(error => ({ unreadable: error.message }));
      if (page.traced !== undefined) taken.set(p, page.traced);
      delete page.traced;
      const core = await view('memory_current', { item_id: id });
      steps.push({ step: name, page, core: { revision: core.source_ref?.revision ?? null, body: core.body ?? null } });
    };
    const kept = async (p, action) => {
      try { return await action(); }
      catch (error) {
        await step(p, 'on failure').catch(() => {});
        throw new Error(`${error.message}\nSteps (items 421, 422): ${JSON.stringify(steps)}`, { cause: error });
      }
    };
    return { step, kept, steps };
  };

  // Item 642: geometry fixtures use the real writer's rendering branches, without making
  // fake Core requests. Actual typing/autosave is checked separately below. Each fixture
  // starts from a real page, and the rendered writer snapshot is never persisted.
  const statusStates642 = [
    ['saved', {}, 'Saved to Theseus'],
    ['device-copy', {journalPending:1}, 'Keeping your writing on this device…'],
    ['saving', {busy:true}, 'Saving…'],
    ['device-saved', {dirty:true}, 'Saved on this device · saving to Theseus…'],
    ['uploading', {images:[{id:'fixture-image',name:'Image',media:'fixture-media',associated:false}]}, 'Uploading image…'],
    ['image-error', {images:[{id:'fixture-image',name:'Image',error:'Upload failed',associated:false}]}, 'An image needs attention. Your words are kept.'],
    ['conflict', {conflict:{revision:2,content:{body:'Changed elsewhere.'}},hasLocal:true}, 'Your writing is kept on this device. Review the changed page.'],
    ['error', {error:'The save could not be confirmed. Your words are kept.'}, 'The save could not be confirmed. Your words are kept.'],
    ['refused', {readOnly:true,error:'Only those taking part in this topic, its owner and its outcome\'s owner write its Notebook'}, 'Only those taking part in this topic, its owner and its outcome\'s owner write its Notebook'],
    ['paused', {readOnly:true}, 'Writing is paused. Your words are kept on this device.'],
    ['to-read', {reading:true}, 'To read'],
    ['journal-error', {journalError:'Storage is full'}, 'Device copy unavailable: Storage is full. Keep this page open.'],
    ['unavailable', {unavailable:'Another tab keeps the writing for this page.'}, 'Another tab keeps the writing for this page.'],
    ['image-refused', {imageError:'notes.pdf was not added: it is not a PNG, JPEG, GIF or WebP image.'}, 'notes.pdf was not added: it is not a PNG, JPEG, GIF or WebP image.'],
    ['empty', {empty:true}, ''],
  ];
  const boxes642 = p => p.evaluate(`(()=>{const d=document.querySelector('#new-message-sheet');return [...d.querySelectorAll('.notebook-sheet-views button')].filter(b=>!b.hidden).map(b=>{const r=b.getBoundingClientRect();return {words:b.textContent,x:r.x,y:r.y,width:r.width,height:r.height}})})()`);
  const frame642 = p => p.evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');
  const observePage642 = async p => {
    await until(()=>p.evaluate("document.body.dataset.ready==='true'"),'item 642 topic is ready');
    await p.evaluate(`(async()=>{const {NotebookPage}=await import('/notebook-page.mjs'),{NotebookSheet}=await import('/notebook-sheet.mjs');const open=NotebookSheet.prototype.open;
      NotebookSheet.prototype.open=async function(...args){const answer=await open.apply(this,args);globalThis.opened642=true;return answer};
      const changed=NotebookPage.prototype.writingChanged;
      NotebookPage.prototype.writingChanged=function(...args){globalThis.page642=this;return changed.apply(this,args)};})()`);
  };
  const render642 = (p, changes) => p.evaluate(`(()=>{const pg=page642;
    pg.original642??={writer:pg.writing,revisionShown:pg.revisionShown};
    const changes=${JSON.stringify(changes)},w=pg.original642.writer;
    pg.writing={...w,dirty:false,busy:false,hasLocal:false,journalPending:0,journalError:null,error:null,readOnly:false,reading:false,conflict:null,images:[],...changes};
    pg.unavailable=changes.unavailable??null;pg.imageError=changes.imageError??null;pg.revisionShown=()=>{};
    pg.writingChanged();if(changes.empty)pg.say('');
  })()`);
  const sign642 = p => p.evaluate(`(()=>{const d=document.querySelector('#new-message-sheet'),s=d.querySelector('.notebook-sheet-status'),r=s.getBoundingClientRect();return {words:s.querySelector('.deck-status>span')?.textContent??'',below:[...d.querySelectorAll('.notebook-sheet-title,.notebook-sheet-views,.notebook-sheet-full,.notebook-sheet-close')].every(e=>e.getBoundingClientRect().bottom<=r.top+.5)}})()`);
  const faults642 = (before,after,sign,head,expectedWords) => {
    const faults=[];
    if(JSON.stringify(before)!==JSON.stringify(after))faults.push({before,after});
    if(sign.words!==expectedWords||!sign.below||head.overlaps.length||head.covered.length||head.off.length||head.small.length||(expectedWords&&head.cut)||head.sideways)faults.push({sign,head});
    return faults;
  };
  for (const [stateName, changes, expectedWords] of statusStates642) {
    await check(`notebook item 642 ${stateName}: Text Cards and Draft keep their boxes while the saving words change, at 320 375 390 and laptop in light and dark`, async () => {
      const id=await topicPage('Steady card buttons',cardsBody),failures=[];
      for(const width of [320,375,390,1440]) {
      const p=await page(`item-642-${stateName}-${width}`,null,true,{beforeNavigate:async q=>{
        await q.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<760});
        if(width<760)await q.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
      }});
      try {
        await observePage642(p);
        await listed(p,card(id),'item 642 page is listed');await press(p,card(id));
        await opened(p,'Steady card buttons',['Plan','Steps','Notes']);
        await until(()=>p.evaluate("Boolean(globalThis.opened642&&globalThis.page642?.images)"),'item 642 writer has loaded');
        await p.point(`${PAGE} .deck-card .deck-words`);
        await until(()=>p.evaluate("document.activeElement.matches('.deck-writing textarea')"),'item 642 card is open for writing');
        const writing=await state(p);
        for(const theme of ['light','dark']) {
          await p.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
          await until(()=>p.evaluate(`innerWidth===${width}&&matchMedia('(prefers-color-scheme: ${theme})').matches`),'item 642 viewport and theme applied');
          // Compare every state against the same controls in their quiet form. A read-only
          // page intentionally has no Draft toggle, so its two view buttons are compared.
          await render642(p,changes.readOnly?{readOnly:true}:changes.reading?{reading:true}:{});
          await frame642(p);const before=await boxes642(p);
          await render642(p,changes);await frame642(p);
          const after=await boxes642(p),head=await sheetHead(p);
          const sign=await sign642(p);
          await shot(p,`item-642-${stateName}-${width}-${theme}`);
          failures.push(...faults642(before,after,sign,head,expectedWords).map(fault=>({width,theme,...fault})));
          const now=await state(p);
          assert.equal(now.box.words,writing.box.words,'item 642 status changes never change the card writing');
          assert.deepEqual(now.box.at,writing.box.at,'item 642 status changes never move its cursor');
          assert.equal(now.box.focused,true,'item 642 status changes never take focus');
        }
        assert.deepEqual(p.errors,[]);
      } finally {
        await p.evaluate('(()=>{const pg=globalThis.page642;if(pg?.original642){pg.writing=pg.original642.writer;pg.revisionShown=pg.original642.revisionShown;pg.unavailable=null;pg.imageError=null}})()');
        await p.close();
      }
      }
      assert.deepEqual(failures,[],`${stateName}: item 642 buttons never move and the status has its own place`);
    });
  }
  await check('notebook item 642 typing: every painted save status keeps all three button boxes and exact card writing, at 320 375 390 and laptop in light and dark',async()=>{
    const id=await topicPage('Typing with steady buttons',cardsBody);
    for(const width of [320,375,390,1440])for(const theme of ['light','dark']) {
      const p=await page(`item-642-typing-${width}-${theme}`,null,true,{beforeNavigate:async q=>{
        await q.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<760});
        if(width<760)await q.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
        await q.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
        await q.send('Page.addScriptToEvaluateOnNewDocument',{source:`const own=fetch.bind(globalThis);globalThis.fetch=async(...args)=>{let e;try{e=JSON.parse(args[1]?.body)}catch{}
          if(e?.kind==='memory.revise')await new Promise(resolve=>globalThis.release642=resolve);return own(...args)};`});
      }});
      try {
        await observePage642(p);
        await listed(p,card(id),'item 642 page is listed');await press(p,card(id));await opened(p,'Typing with steady buttons',['Plan','Steps','Notes']);
        await until(()=>p.evaluate('globalThis.opened642===true'),'item 642 sheet opening has completed');
        if(!(await state(p)).box)await p.point(`${PAGE} .deck-card .deck-words`);
        await until(()=>p.evaluate("document.activeElement.matches('.deck-writing textarea')"),'item 642 card writing has focus');
        await p.evaluate(`(()=>{const d=document.querySelector('#new-message-sheet'),boxes=()=>[...d.querySelectorAll('.notebook-sheet-views button')].map(b=>{const r=b.getBoundingClientRect();return [r.x,r.y,r.width,r.height]});
          const baseline=JSON.stringify(boxes());globalThis.frames642=[];globalThis.stop642=false;
          const sample=()=>{frames642.push({words:d.querySelector('.deck-status').textContent,moved:JSON.stringify(boxes())!==baseline});if(!stop642)requestAnimationFrame(sample)};requestAnimationFrame(sample)})()`);
        const before=(await state(p)).box.words,coreBefore=(await view('memory_current',{item_id:id})).body;
        await p.send('Input.insertText',{text:' Typed.'});
        await until(()=>p.evaluate('Boolean(globalThis.release642)'),'item 642 actual save is in flight');
        await until(()=>p.evaluate("frames642.some(f=>f.words==='Saving…')"),'item 642 Saving is painted');
        assert.equal((await view('memory_current',{item_id:id})).body,coreBefore,'item 642 held save has not changed Core');
        await p.evaluate('release642()');
        await until(()=>p.evaluate("document.querySelector('#new-message-sheet .deck-status>span')?.textContent==='Saved to Theseus'"),'item 642 confirmed save is shown');
        await frame642(p);
        const frames=await p.evaluate('(stop642=true,frames642)');
        assert.deepEqual(frames.filter(f=>f.moved),[],`item 642 ${width} ${theme}: no painted status moves the three buttons`);
        const box=(await state(p)).box;
        assert.equal(box.focused,true);assert.equal(box.words.replace(' Typed.',''),before);
        assert.ok((await view('memory_current',{item_id:id})).body.includes(' Typed.'),'item 642 actual autosave kept the typed words');
        assert.deepEqual(p.errors,[]);
      } finally {await p.close();}
    }
  });

  const layoutMutants642 = [
    {name:'laptop status column',width:1440,
      old:'grid-template-columns:minmax(0,1fr) auto auto auto;grid-template-areas:"title views full close" "status status status status";',
      broken:'grid-template-columns:minmax(0,1fr) auto auto auto auto;grid-template-areas:"title views status full close";'},
    {name:'phone status shares chips row',width:375,
      old:'.notebook-sheet-status{flex:0 0 100%;max-width:none;container-type:inline-size}',
      broken:'.notebook-sheet-status{flex:1 1 8rem;max-width:none;container-type:inline-size}'},
  ];
  for(const mutant of layoutMutants642)await check(`notebook item 642 mutant ${mutant.name}: the geometry assertion fails with the CSS rule broken and passes after restoration`,async()=>{
    const id=await topicPage('Steady card buttons',cardsBody);
    const p=await page(`item-642-mutant-${mutant.width}`,null,true,{beforeNavigate:async q=>{
      await q.send('Emulation.setDeviceMetricsOverride',{width:mutant.width,height:900,deviceScaleFactor:1,mobile:mutant.width<760});
      if(mutant.width<760)await q.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    }});
    try {
      await observePage642(p);await listed(p,card(id),'item 642 mutant page is listed');await press(p,card(id));
      await opened(p,'Steady card buttons',['Plan','Steps','Notes']);
      await until(()=>p.evaluate('globalThis.opened642===true'),'item 642 mutant sheet opening is complete');
      const css=await readFile(new URL('../web/aim.css',import.meta.url),'utf8');
      assert.equal(css.split(mutant.old).length-1,1,'item 642 mutation changes exactly one production rule');
      const probe=async()=>{
        await render642(p,{});await frame642(p);const before=await boxes642(p);
        await render642(p,{busy:true});await frame642(p);
        return faults642(before,await boxes642(p),await sign642(p),await sheetHead(p),'Saving…');
      };
      assert.deepEqual(await probe(),[],'item 642 original layout control');
      await p.evaluate(`(()=>{const link=[...document.querySelectorAll('link[rel=stylesheet]')].find(l=>new URL(l.href).pathname==='/aim.css');
        if(!link)throw Error('item 642 production stylesheet was not found');globalThis.link642=link;link.disabled=true;
        const style=document.createElement('style');style.id='mutant-642';style.textContent=${JSON.stringify(css.replace(mutant.old,mutant.broken))};document.head.append(style)})()`);
      await frame642(p);
      const applied=await p.evaluate(`(()=>{const head=document.querySelector('.notebook-sheet-head'),sign=document.querySelector('.notebook-sheet-status');return {disabled:link642.disabled,grid:getComputedStyle(head).gridTemplateAreas,basis:getComputedStyle(sign).flexBasis}})()`);
      assert.equal(applied.disabled,true,'item 642 the mutated sheet replaced the production sheet');
      if(mutant.width>760)assert.equal(applied.grid,'"title views status full close"','item 642 the old status column actually applied');
      else assert.equal(applied.basis,'128px','item 642 the old phone basis actually applied');
      const faults=await probe();let caught;
      try {assert.deepEqual(faults,[],'item 642 buttons never move and the status has its own place');}
      catch(error){caught=error;}
      assert.equal(caught?.code,'ERR_ASSERTION','item 642 the same geometry assertion kills the applied CSS mutant');
      await p.evaluate("(()=>{link642.disabled=false;document.querySelector('#mutant-642').remove()})()");
      await frame642(p);assert.deepEqual(await probe(),[],'item 642 restored production layout control');
      process.stdout.write(JSON.stringify({item:642,mutant:mutant.name,width:mutant.width,applied,caught:caught.message,restored:true})+'\n');
      assert.deepEqual(p.errors,[]);
    } finally {
      await p.evaluate(`(()=>{if(globalThis.link642){link642.disabled=false;document.querySelector('#mutant-642')?.remove()}const pg=globalThis.page642;if(pg?.original642){pg.writing=pg.original642.writer;pg.revisionShown=pg.original642.revisionShown;pg.unavailable=null;pg.imageError=null}})()`);
      await p.close();
    }
  });

  await check('notebook in the composer: a page opened from the right rail\'s whole outcome, the topic\'s Notebook, the right rail and the outcome\'s page comes up in the New message sheet over the feed, with its title, Text and Cards, Full page and ✕, at a laptop\'s width and a phone\'s', async () => {
    const plan = await outcomePage('sheet-entry-plan', 'Sheet plan', cardsBody);
    const notes = await topicPage('Sheet notes', '## First\n\nThe topic\'s own page.\n\n## Second\n\nMore.\n');
    let p = await page('notebook-sheet-entries', null, true);
    // The right rail's Notebook, with All of this outcome: the outcome's pages (the side rail lists none, item 464).
    await wholeOutcome(p);
    await listed(p, railRow(plan), 'the right rail lists the outcome\'s page');
    await press(p, railRow(plan));
    await opened(p, 'Sheet plan', ['Plan', 'Steps', 'Notes']);
    const head = await p.evaluate(`(()=>{const d=document.querySelector(${JSON.stringify(SHEET)}),q=s=>d.querySelector(s),keys=q('.notebook-sheet-page:not([hidden]) .deck-keys>span:not([style*="hidden"])');
      return {full:[q('.notebook-sheet-full').getAttribute('href'),q('.notebook-sheet-full').getAttribute('aria-label'),q('.notebook-sheet-full').title],
        close:[q('.notebook-sheet-close').getAttribute('aria-label'),q('.notebook-sheet-close').title],
        views:[...d.querySelectorAll('.notebook-sheet-views button')].map(b=>[b.textContent,b.getAttribute('aria-pressed')]),
        saving:Boolean(q('.notebook-sheet-status .deck-status')),inline:q('#inline-composer').hidden,
        keys:{words:keys.textContent,fits:keys.scrollWidth<=keys.clientWidth+1,long:keys.title.length}}})()`);
    assert.deepEqual({ ...head, full: [head.full[0].replace(/^.*\?/, '?'), head.full[1], head.full[2]], keys: { ...head.keys, long: head.keys.long > 100 } }, {
      full: [`?cards=${plan}`, 'Open as a full page', 'Open as a full page'], close: ['Close, keeping your writing', 'Close, keeping your writing'],
      views: [['Text', 'false'], ['Cards', 'true'], ['Draft', 'false']], saving: true, inline: true,
      keys: { words: '↑ ↓ pick · Return new card · ⌘Return edit', fits: true, long: true } }, 'the sheet\'s head, and its keys in one short line with the full page\'s line as its tooltip');
    // Text and Cards switch in place, writing nothing.
    const revision = (await view('memory_current', { item_id: plan })).source_ref.revision;
    await p.point(`${SHEET} .notebook-sheet-views button:first-child`);
    await until(async () => (await p.evaluate(`!document.querySelector(${JSON.stringify(PAGE + ' .notebook-text-panel')}).hidden && document.activeElement===document.querySelector(${JSON.stringify(PAGE + ' .notebook-text')})`)) && (await words(p)) === cardsBody, 'Text shows the page\'s words, ready to write');
    await shot(p, 'notebook-sheet-text');
    await p.point(`${SHEET} .notebook-sheet-views button:nth-child(2)`);
    await opened(p, 'Sheet plan', ['Plan', 'Steps', 'Notes']);
    assert.equal((await view('memory_current', { item_id: plan })).source_ref.revision, revision, 'switching views writes nothing');
    await shot(p, 'notebook-sheet-cards');
    await p.point(`${SHEET} .notebook-sheet-close`);
    await closed(p);
    await p.evaluate(`document.querySelector('#things .things-scope .chip:first-child').scrollIntoView({block:'nearest',behavior:'instant'})`);
    await p.point('#things .things-scope .chip:first-child');
    await until(() => p.evaluate(`document.querySelector('#things .things-scope .chip:first-child').getAttribute('aria-pressed')==='true'`), 'Just this topic');
    // The topic's own Notebook.
    await listed(p, card(notes), 'the topic\'s Notebook lists its page');
    await press(p, card(notes));
    await opened(p, 'Sheet notes', ['First', 'Second']);
    await p.key('Escape');
    await closed(p);
    // The right rail's Notebook, which lists the topic's own pages.
    const rail = `#things .things-sec[data-key="notebook"]`, link = `${rail} a.row[href*="page=${notes}"]`;
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(link)}))`), 'the right rail lists the page');
    if (!await p.evaluate(`document.querySelector(${JSON.stringify(rail)}).open`)) await p.point(`${rail} > summary`);
    await press(p, link);
    await opened(p, 'Sheet notes', ['First', 'Second']);
    assert.equal(await p.evaluate('location.search'), '?topic=t1', 'opened over the topic, which stays where it is');
    await p.point(`${SHEET} .notebook-sheet-close`);
    await closed(p);
    assert.deepEqual(p.errors, []);
    await p.close();
    // The outcome's own page, which lists its pages after its topics.
    p = await page('notebook-sheet-outcome-entry', null, true, { url: `${facts.origin}/?workspace=w1` });
    await listed(p, row(plan), 'the outcome page lists the page');
    await press(p, row(plan));
    await opened(p, 'Sheet plan', ['Plan', 'Steps', 'Notes']);
    assert.equal(await p.evaluate("document.querySelector('#page-here').hidden"), true, 'nothing opens in place below the list');
    assert.deepEqual(p.errors, []);
    await p.close();
    // At a phone's width, by touch, in light and in dark: the head takes two lines and one card fills the rest.
    for (const scheme of ['light', 'dark']) {
      p = await page(`notebook-sheet-phone-${scheme}`, null, true, phone);
      await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await listed(p, card(notes), 'the topic\'s Notebook lists its page');
      await p.evaluate(`document.querySelector(${JSON.stringify(card(notes))}).scrollIntoView({block:'center'})`);
      await tap(p, card(notes));
      await opened(p, 'Sheet notes', ['First', 'Second']);
      await settle(p);
      const fit = await p.evaluate(`(()=>{const d=document.querySelector(${JSON.stringify(SHEET)}),r=s=>d.querySelector(s).getBoundingClientRect(),picked=d.querySelector('.notebook-sheet-page:not([hidden]) .deck-card[aria-current=true]').getBoundingClientRect();
        const small=[...d.querySelectorAll('.notebook-sheet-close,.notebook-sheet-full,.notebook-sheet-views button,.notebook-sheet-page:not([hidden]) .notebook-images>button,.notebook-sheet-page:not([hidden]) .deck-bar button')]
          .filter(b=>b.getClientRects().length).map(b=>[b.getAttribute('aria-label')||b.textContent,Math.round(b.getBoundingClientRect().width),Math.round(b.getBoundingClientRect().height)]).filter(([,w,h])=>w<44||h<44);
        return {sideways:document.documentElement.scrollWidth>innerWidth||d.scrollWidth>d.clientWidth,wraps:r('.notebook-sheet-views').top>=r('.notebook-sheet-title').bottom-1,
          small,fills:picked.height>=innerHeight*0.4&&picked.left>=0&&picked.right<=innerWidth}})()`);
      assert.deepEqual(fit, { sideways: false, wraps: true, small: [], fills: true }, `${scheme}: the sheet at a phone's width`);
      await shot(p, `notebook-sheet-phone-${scheme}`);
      await tap(p, `${SHEET} .notebook-sheet-close`);
      await closed(p);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  // The head at every width: each part stays clear; item 642 gives the saving sign
  // its own row in every state, even when it could fit beside the chips.
  await check('notebook in the composer: the sheet\'s head stands clear at every width, its title, ↗, ✕, Text, Cards, Draft and saving sign never over one another, on phones 320 to 414 wide and on a laptop', async () => {
    const id = await topicPage('Sheet head widths', cardsBody), seen = {}, clear = {}, sizes = {};
    for (const [width, touch] of [[320, true], [360, true], [375, true], [390, true], [414, true], [761, false], [1024, false]]) {
      const p = await page(`notebook-sheet-head-${width}`, null, true, { beforeNavigate: async q => {
        await q.send('Emulation.setDeviceMetricsOverride', { width, height: touch ? 740 : 800, deviceScaleFactor: 1, mobile: touch });
        if (touch) await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      }, url: `${facts.origin}/?topic=t1&page=${id}` });
      await opened(p, 'Sheet head widths', ['Plan', 'Steps', 'Notes']);
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(SHEET + ' .notebook-sheet-status')}).textContent.includes('Saved to Theseus')`), 'the saving sign says the page is saved');
      await settle(p);
      const head = await sheetHead(p);
      seen[width] = { parts: head.parts.slice(3, 6), overlaps: head.overlaps, covered: head.covered, off: head.off, small: head.small, cut: head.cut, sideways: head.sideways };
      clear[width] = { parts: ['Text', 'Cards', 'Draft'], overlaps: [], covered: [], off: [], small: [], cut: null, sideways: false };
      // What the head has to fit, should it not: the chips' width and the saving sign's words' own.
      sizes[width] = await p.evaluate(`[document.querySelector('#new-message-sheet .notebook-sheet-views').scrollWidth,document.querySelector('#new-message-sheet .notebook-sheet-status .deck-status>span').scrollWidth]`);
      if (width === 320 || width === 375) await shot(p, `notebook-sheet-head-${width}`);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
    assert.deepEqual(seen, clear, `each part of the sheet's head stands clear, on screen and whole, at each width (chips and words wide: ${JSON.stringify(sizes)})`);
  });

  // A refusal is the sign's widest state: its words and Try again and Discard my writing. It takes a line of its own
  // under the head at every width, its words whole, so nothing in it lies over the chips, and a press on Cards
  // reaches Cards (and sends nothing again).
  await check('notebook in the composer: a refused save takes a line of its own under the sheet\'s head at every width, its words whole and Try again and Discard my writing over nothing, and a press on Cards reaches Cards', async () => {
    // Core's own words for a topic's Notebook (aim_next/memory.py), longer than any phone's line.
    const seen = {}, clear = {}, WHY = 'Only those taking part in this topic, its owner and its outcome\'s owner write its Notebook';
    const REFUSE = `globalThis.revisesRefused=0;const originalFetch=fetch.bind(globalThis);
      globalThis.fetch=async(...args)=>{let e;try{e=JSON.parse(args[1]?.body)}catch{}
        if(e?.kind==='memory.revise'){revisesRefused++;return new Response(JSON.stringify({instance_id:e.instance_id,operation_id:e.operation_id,kind:e.kind,status:'rejected',recorded:false,error:{code:'FORBIDDEN',message:${JSON.stringify(WHY)}}}),{status:200,headers:{'content-type':'application/json'}});}
        return originalFetch(...args);};`;
    const pressed = p => p.evaluate(`[...document.querySelectorAll(${JSON.stringify(SHEET + ' .notebook-sheet-views .notebook-views button')})].filter(b=>b.getAttribute('aria-pressed')==='true').map(b=>b.textContent)`);
    // One page at every width: Discard my writing at the end of each leaves nothing of it kept on the device.
    const id = await topicPage('Sheet head refused', cardsBody);
    for (const [width, touch] of [[320, true], [360, true], [375, true], [390, true], [414, true], [761, false], [1024, false]]) {
      const p = await page(`notebook-sheet-refused-${width}`, null, true, { beforeNavigate: async q => {
        await q.send('Page.addScriptToEvaluateOnNewDocument', { source: REFUSE });
        await q.send('Emulation.setDeviceMetricsOverride', { width, height: touch ? 740 : 800, deviceScaleFactor: 1, mobile: touch });
        if (touch) await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      }, url: `${facts.origin}/?topic=t1&page=${id}` });
      const press = selector => touch ? tap(p, selector) : p.point(selector);
      await opened(p, 'Sheet head refused', ['Plan', 'Steps', 'Notes']);
      await press(`${SHEET} .notebook-sheet-views .notebook-views button:first-of-type`);
      await until(async () => JSON.stringify(await pressed(p)) === '["Text"]', 'Text shows');
      await press(`${PAGE} .notebook-text`);
      await p.send('Input.insertText', { text: ' Refused.' });
      await until(() => p.evaluate(`document.querySelectorAll(${JSON.stringify(SHEET + ' .notebook-sheet-status .deck-status button')}).length===2`), 'the refusal offers Try again and Discard my writing');
      await settle(p);
      const head = await sheetHead(p), sent = await p.evaluate('revisesRefused');
      // The sign's line: below every other part of the head.
      const below = await p.evaluate(`(()=>{const d=document.querySelector(${JSON.stringify(SHEET)}),sign=d.querySelector('.notebook-sheet-status').getBoundingClientRect().top;
        return [...d.querySelectorAll('.notebook-sheet-title,.notebook-sheet-full,.notebook-sheet-close,.notebook-sheet-views')].every(e=>e.getBoundingClientRect().bottom<=sign+0.5)})()`);
      if (width === 320 || width === 390 || width === 1024) await shot(p, `notebook-sheet-refused-${width}`);
      await press(`${SHEET} .notebook-sheet-views .notebook-views button:nth-of-type(2)`);
      await until(async () => JSON.stringify(await pressed(p)) === '["Cards"]', 'a press on Cards shows Cards').catch(() => {});
      seen[width] = { parts: head.parts.slice(3), overlaps: head.overlaps, covered: head.covered, off: head.off, small: head.small, cut: head.cut, sideways: head.sideways, below,
        cards: await pressed(p), sentAgain: (await p.evaluate('revisesRefused')) - sent };
      clear[width] = { parts: ['Text', 'Cards', WHY, 'Try again', 'Discard my writing'], overlaps: [], covered: [], off: [], small: [], cut: null, sideways: false, below: true,
        cards: ['Cards'], sentAgain: 0 };
      // Discard my writing: the page as Core holds it, and nothing of this writing left on the device to send.
      await press(`${SHEET} .notebook-sheet-status .deck-status button:last-of-type`);
      await until(() => p.evaluate(`document.querySelectorAll(${JSON.stringify(SHEET + ' .notebook-sheet-status .deck-status button')}).length===0`), 'Discard my writing leaves nothing to send');
      await waitFor(p, s => JSON.stringify(s.cards) === '["Plan","Steps","Notes"]', { cards: ['Plan', 'Steps', 'Notes'] }, 'the page is as Core holds it');
      assert.deepEqual(p.errors, []);
      await p.close();
    }
    assert.deepEqual(seen, clear, `a refusal stands on its own line under the head, whole, at each width, and Cards takes its press: ${JSON.stringify(seen)}`);
  });

  await check('notebook in the composer: a card being written survives ✕, a press outside and Escape, which first finishes it; the feed comes back where it was, the focus on what opened the page, and the box is open again on reopening', async () => {
    const id = await topicPage('Sheet kept', cardsBody);
    const { step, kept } = tracer(id);
    const p = await page('notebook-sheet-close', null, true, traced(laptop));
    await kept(p, async () => {
    await listed(p, card(id), 'the topic\'s Notebook lists its page');
    await p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).scrollIntoView({block:'center'})`);
    const at = await scrolled(p);
    assert.ok(at > 0, 'the feed is scrolled down to the topic\'s Notebook');
    const back = async how => {
      await closed(p);
      await settle(p);
      assert.deepEqual(await p.evaluate(`({y:scrollY,focus:document.activeElement===document.querySelector(${JSON.stringify(card(id))})})`), { y: at, focus: true },
        `${how}: the feed is where it was read and the focus is on the card that opened the page`);
    };
    const reopen = async () => { await p.point(card(id)); await waitFor(p, s => s.open && s.title === 'Sheet kept' && !s.reader, { open: true, title: 'Sheet kept', reader: false }, 'the page opens again in the sheet'); };
    await reopen();
    await writeIn(p, 'Notes', ' Kept by ✕.');
    await step(p, 'written, before ✕');
    // While a card is written the short keys line is the writing's, its long words in the tooltip.
    assert.deepEqual(await p.evaluate(`(()=>{const l=document.querySelector(${JSON.stringify(PAGE + ' .deck-keys>span:not([style*="hidden"])')});return [l.textContent,l.title.startsWith('Escape')]})()`),
      ['Escape done · ⌘Return next card', true], 'the keys line says what the keys do while a card is written');
    await p.point(`${SHEET} .notebook-sheet-close`);
    await back('✕');
    await step(p, 'after ✕');
    await reopen();
    await step(p, 'reopened after ✕');
    await waitFor(p, s => s.box?.focused && s.box.words === 'Notes\nDan reviews. Kept by ✕.' && s.box.at[0] === s.box.words.length,
      { box: { words: 'Notes\nDan reviews. Kept by ✕.', focused: true } }, 'after ✕ the card is open again to write, the cursor where it was');
    await saved(id, 'Dan reviews. Kept by ✕.', 'the unfinished card saved as it was written');
    await p.send('Input.insertText', { text: ' And outside.' });
    await step(p, 'written, before the press outside');
    // A press on the backdrop, beside the sheet.
    const side = await p.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(SHEET)}).getBoundingClientRect();return {x:Math.max(4,r.left/2),y:r.top+r.height/2}})()`);
    assert.ok(side.x < (await p.box(SHEET)).x, 'the press is outside the sheet');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...side });
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...side, button: 'left', clickCount: 1 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...side, button: 'left', clickCount: 1 });
    await back('a press outside');
    await step(p, 'after the press outside');
    await reopen();
    await step(p, 'reopened after the press outside');
    const outsideWords = 'Notes\nDan reviews. Kept by ✕. And outside.', end = [outsideWords.length, outsideWords.length];
    await waitFor(p, s => s.box?.focused && s.box.words === outsideWords && s.box.at.join() === end.join(), { box: { words: outsideWords, at: end, focused: true } },
      'after a press outside the card is open again to write, the cursor where it was');
    // Escape: the first finishes the card, the second closes.
    await p.send('Input.insertText', { text: ' Done by Escape.' });
    await step(p, 'written, before the first Escape');
    await p.key('Escape');
    await step(p, 'after the first Escape');
    await waitFor(p, s => s.open && !s.box, { open: true, box: null }, 'the first Escape finishes the card and leaves the sheet open');
    await saved(id, 'And outside. Done by Escape.', 'the finished card is saved');
    await p.key('Escape');
    await back('the second Escape');
    await step(p, 'after the second Escape');
    await reopen();
    await step(p, 'reopened after the second Escape');
    assert.equal((await state(p)).box, null, 'a card finished stays finished');
    await p.point(`${SHEET} .notebook-sheet-close`);
    await closed(p);
    assert.deepEqual(p.errors, []);
    });
    await p.close();
    // On a phone, by touch: a card written, ✕, and open again on reopening.
    const q = await page('notebook-sheet-close-phone', null, true, traced(phone));
    await kept(q, async () => {
    await listed(q, card(id), 'the topic\'s Notebook lists its page');
    await q.evaluate(`document.querySelector(${JSON.stringify(card(id))}).scrollIntoView({block:'center'})`);
    const phoneAt = await scrolled(q);
    await tap(q, card(id));
    await step(q, 'opened on a phone');
    await opened(q, 'Sheet kept', ['Plan', 'Steps', 'Notes']);
    await tap(q, `${PAGE} .deck-bar button:first-of-type`);
    await waitFor(q, s => s.box?.focused, { box: { focused: true } }, 'Edit opens the card in view to write');
    const written = (await state(q)).box.words;
    await q.send('Input.insertText', { text: ' Phone.' });
    await step(q, 'written on a phone, before ✕');
    await tap(q, `${SHEET} .notebook-sheet-close`);
    await closed(q);
    await settle(q);
    assert.equal(await scrolled(q), phoneAt, 'the feed is where it was read');
    await tap(q, card(id));
    await step(q, 'reopened on a phone');
    await waitFor(q, s => s.open && s.box?.words === written + ' Phone.', { open: true, box: { words: written + ' Phone.' } }, 'on a phone the card is open again to write');
    await tap(q, `${SHEET} .notebook-sheet-close`);
    await closed(q);
    assert.deepEqual(q.errors, []);
    });
    await q.close();
  });

  // The topic's New message composer where it rests in the feed and a Notebook page share the sheet. Closing the page folds the
  // composer back to its one line, its writing kept, as every close of the sheet does, whatever the composer was when
  // the page opened: a line, being written, or being written with its + panel open (fold's three branches). The focus
  // goes back to the card that opened the page, not to New message. At a laptop's width, the page opened by the keys,
  // and on phones 320, 375 and 390 wide, by touch.
  await check('notebook in the composer: closing a page folds the topic\'s New message composer back to its line, its writing kept and the focus on the card, whether the composer was a line, being written or had its + panel open, at a laptop\'s width and on phones 320, 375 and 390 wide', async () => {
    const id = await topicPage('Sheet and composer', cardsBody);
    const composer = p => p.evaluate(`(()=>{const r=document.querySelector('#inline-composer'),v=e=>Boolean(e?.checkVisibility()),a=document.activeElement;
      return {compose:r.dataset.compose,panel:r.dataset.panel??null,panels:[...r.querySelectorAll('.compose-panel')].filter(v).map(e=>e.id),
        expanded:[...r.querySelectorAll('#inline-who-chip,#inline-plus-button')].filter(e=>e.getAttribute('aria-expanded')==='true').map(e=>e.id),
        send:v(document.querySelector('#inline-send')),words:document.querySelector('#inline-writing-body').value,
        focus:a===document.querySelector(${JSON.stringify(card(id))})?'the card':(a?.id||a?.tagName||null)}})()`);
    for (const [label, width, height] of [['laptop', 1440, 600], ['phone-320', 320, 568], ['phone-375', 375, 667], ['phone-390', 390, 844]]) {
      const touch = label !== 'laptop';
      const p = await page(`notebook-sheet-composer-${label}`, null, true, { beforeNavigate: async q => {
        await q.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch });
        if (touch) await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      } });
      const hit = async selector => {
        await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
        if (touch) await tap(p, selector); else await p.point(selector);
      };
      await listed(p, card(id), 'the topic\'s Notebook lists its page');
      await until(() => p.evaluate("!document.querySelector('#inline-composer').hidden"), 'the topic\'s New message composer at the page\'s end');
      for (const state of ['line', 'writing', 'panel']) {
        const said = `${label}, the composer ${{ line: 'a line', writing: 'being written', panel: 'being written, its + panel open' }[state]}`;
        if (state !== 'line') {
          await hit('#inline-writing-body');
          await until(async () => (await composer(p)).compose === 'writing', `${said}: the composer opens to write`);
          await p.send('Input.insertText', { text: ` Kept ${state} ${label}.` });
        }
        if (state === 'panel') {
          await hit('#inline-plus-button');
          await until(async () => (await composer(p)).panel === 'plus', `${said}: the + panel opens`);
        }
        const before = await composer(p);
        assert.deepEqual([before.compose, before.panel, before.send], [state === 'line' ? 'line' : 'writing', state === 'panel' ? 'plus' : null, state !== 'line'], `${said}, as the page opens: ${JSON.stringify(before)}`);
        if (state !== 'line') assert.ok(before.words.includes(` Kept ${state} ${label}.`), `${said}: the words are in the composer: ${JSON.stringify(before)}`);
        // The page opens from its card: on a laptop by the keys (the focus on the card, as Tab puts it, and Return), so
        // a + panel open stays open until the page hides the composer; on a phone by a finger.
        if (touch) await hit(card(id));
        else { await p.evaluate(`(c=>{c.scrollIntoView({block:'center',behavior:'instant'});c.focus();})(document.querySelector(${JSON.stringify(card(id))}))`); await p.key('Enter'); }
        await opened(p, 'Sheet and composer', ['Plan', 'Steps', 'Notes']);
        // Closed by ✕; on a laptop, the composer being written, by Escape.
        if (!touch && state === 'writing') await p.key('Escape'); else await hit(`${SHEET} .notebook-sheet-close`);
        await closed(p);
        // The browser's close event comes with a later frame: what it does is done by then.
        await settle(p); await settle(p);
        assert.deepEqual(await composer(p), { compose: 'line', panel: null, panels: [], expanded: [], send: false, words: before.words, focus: 'the card' },
          `${said}: closing the page folds the composer back to its line, its writing kept, and the focus is on the card that opened the page`);
      }
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('notebook in the composer: keys the page does not use, and a wheel or trackpad over the backdrop or the sheet\'s head, move nothing behind it', async () => {
    const id = await topicPage('Sheet keys', cardsBody);
    const p = await page('notebook-sheet-keys', null, true, laptop);
    await listed(p, card(id), 'the topic\'s Notebook lists its page');
    await p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).scrollIntoView({block:'center'})`);
    const wheel = async (point, deltaY) => { await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY }); await settle(p); };
    // Without the sheet a wheel over the feed moves it: what follows measures a real wheel.
    const feed = await p.evaluate(`(()=>{const r=document.querySelector('#messages').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(Math.min(innerHeight-40,Math.max(40,r.top+r.height/2)))}})()`);
    const start = await scrolled(p);
    assert.ok(start > 0, 'the feed is scrolled down to the topic\'s Notebook');
    await wheel(feed, -120);
    await until(async () => (await scrolled(p)) < start, 'a wheel moves the feed while nothing is open over it');
    await rested(p);
    // Nor do the paging keys: a real Page Up moves the feed while nothing is open over it.
    await p.evaluate(`(()=>{document.querySelector(${JSON.stringify(card(id))}).scrollIntoView({block:'center'});document.activeElement?.blur();return true})()`);
    const paged = await scrolled(p);
    await keyed(p, 'PageUp');
    await until(async () => (await scrolled(p)) < paged, 'Page Up moves the feed while nothing is open over it');
    await rested(p);
    await p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).scrollIntoView({block:'center'})`);
    const at = await rested(p);
    await p.point(card(id));
    await opened(p, 'Sheet keys', ['Plan', 'Steps', 'Notes']);
    const still = async said => { await settle(p); assert.equal(await scrolled(p), at, said); };
    const count = () => p.evaluate(`document.querySelector(${JSON.stringify(PAGE + ' .deck-count')}).textContent`);
    await still('opening the page moves nothing behind');
    // ↑ on the first card has nowhere to go; ↓ goes through the cards and on the last has nowhere to go.
    await p.key('ArrowUp'); await still('↑ on the first card moves nothing behind');
    for (let step = 0; step < 3; step++) await p.key('ArrowDown');
    assert.equal(await count(), '3 of 3', 'the arrows the cards use still pick');
    await still('↓ past the last card moves nothing behind');
    for (const name of ['PageDown', 'End', 'PageUp', 'Home', ' ']) { await keyed(p, name); await still(`${name === ' ' ? 'Space' : name} on a card moves nothing behind`); }
    // The keys from the sheet's own controls too.
    await p.evaluate(`document.querySelector(${JSON.stringify(SHEET + ' .notebook-sheet-full')}).focus()`);
    for (const name of ['ArrowDown', 'PageDown', 'End']) { await keyed(p, name); await still(`${name} on Full page moves nothing behind`); }
    assert.equal((await state(p)).open, true, 'and the sheet stays open');
    // A wheel over the backdrop, over the sheet's head, and over cards that have nowhere to scroll.
    const sheet = await p.box(SHEET), title = await p.box(`${SHEET} .notebook-sheet-title`), cards = await p.box(`${PAGE} .deck-cards`);
    const side = { x: Math.round(sheet.x / 2), y: Math.round(sheet.y + sheet.height / 2) }, feedUnder = { x: feed.x, y: Math.round(sheet.y / 2) };
    assert.ok(sheet.x > 20 && sheet.y > 8, 'the backdrop shows beside and above the sheet');
    for (const [where, point] of [['the backdrop beside the sheet', side], ['the backdrop over the feed, above the sheet', feedUnder], ['the sheet\'s head', { x: title.x + 10, y: title.y + title.height / 2 }], ['the cards', { x: cards.x + 40, y: cards.y + 20 }]]) {
      await wheel(point, 400); await still(`a wheel down over ${where} moves nothing behind`);
      await wheel(point, -400); await still(`a wheel up over ${where} moves nothing behind`);
    }
    await p.point(`${SHEET} .notebook-sheet-close`);
    await closed(p);
    await wheel(feed, -120);
    await until(async () => (await scrolled(p)) < at, 'once the sheet is closed the wheel moves the feed again');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('notebook in the composer: on a phone a finger dragged on the sheet\'s head or a card moves nothing behind it, a swipe still goes through the cards, and ✕ puts the feed back where it was read however it moved', async () => {
    const id = await topicPage('Sheet finger', cardsBody);
    const p = await page('notebook-sheet-finger', null, true, phone);
    // WebKit's harness taps but has no finger drag (webkit_native.mjs): the drags are Chrome's.
    if (p.pw) { await p.close(); return; }
    // A finger set down, drawn by (dx, dy) in ten moves, and lifted.
    const drag = async (from, dx, dy) => {
      await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
      for (let step = 1; step <= 10; step++) await p.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + dx * step / 10, y: from.y + dy * step / 10 }] });
      await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      return rested(p);
    };
    await listed(p, card(id), 'the topic\'s Notebook lists its page');
    await p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).scrollIntoView({block:'center',behavior:'instant'})`);
    // Without the sheet a finger drawn down the feed moves it: what follows measures a real drag.
    const start = await rested(p);
    assert.ok(start > 0, 'the feed is scrolled down to the topic\'s Notebook');
    // The finger's scroll runs on after it lifts, to the page's scrollend, and can still take a last pixel well after
    // two frames agree: the feed's place is read once it has ended, so that pixel cannot land as the page opens.
    await p.evaluate(`(()=>{window.fingerScrolled=new Promise(r=>addEventListener('scrollend',r,{once:true}));return true})()`);
    await drag({ x: 195, y: 300 }, 0, 150);
    assert.ok((await scrolled(p)) < start, 'a finger drag moves the feed while nothing is open over it');
    await p.evaluate('window.fingerScrolled.then(()=>true)');
    await p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).scrollIntoView({block:'center',behavior:'instant'})`);
    const at = await rested(p);
    await tap(p, card(id));
    await opened(p, 'Sheet finger', ['Plan', 'Steps', 'Notes']);
    const still = async said => { assert.equal(await rested(p), at, said); assert.equal((await state(p)).open, true, `${said}, and the sheet stays open`); };
    await still('opening the page moves nothing behind');
    // Down and up on each part of the head, and on the card that fills the sheet, which has nowhere to go that way.
    for (const [where, selector] of [['the title', `${SHEET} .notebook-sheet-title`], ['the Text and Cards chips', `${SHEET} .notebook-sheet-views button:first-child`],
      ['the saving sign', `${SHEET} .notebook-sheet-status`], ['the card', `${PAGE} .deck-card[aria-current=true]`]]) {
      const b = await p.box(selector);
      assert.ok(b && b.width > 0 && b.height > 0, `${where} shows`);
      const from = { x: Math.round(b.x + Math.min(b.width / 2, 40)), y: Math.round(b.y + Math.min(b.height / 2, 20)) };
      await drag(from, 0, 150); await still(`a finger drawn down on ${where} moves nothing behind`);
      await drag(from, 0, -Math.min(150, from.y - 2)); await still(`a finger drawn up on ${where} moves nothing behind`);
    }
    // A box in the sheet that scrolls that way keeps the finger: a swipe goes on to the next card.
    const cards = `${PAGE} .deck-cards`, swiped = () => p.evaluate(`document.querySelector(${JSON.stringify(cards)}).scrollLeft`);
    const b = await p.box(`${PAGE} .deck-card[aria-current=true]`), left = await swiped();
    await drag({ x: Math.round(b.x + b.width - 30), y: Math.round(b.y + Math.min(b.height / 2, 120)) }, -240, 0);
    await until(async () => (await swiped()) > left, 'a swipe across the card goes on through the cards');
    await still('a swipe through the cards moves nothing behind');
    // However the feed moved while the sheet was up (its scrollbar dragged, which no harness here sends, stands
    // as a scroll by the page), ✕ puts it back where it was read.
    await p.evaluate(`(()=>{scrollTo({top:${at - 200},behavior:'instant'});return true})()`);
    assert.equal(await rested(p), at - 200, 'the feed moved behind the sheet');
    await tap(p, `${SHEET} .notebook-sheet-close`);
    await closed(p);
    assert.equal(await rested(p), at, '✕ puts the feed back where it was read');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('notebook in the composer: a card\'s reply stack opens in the Reader with the way back to the page, and closing it brings the page back as it was, in the same topic and from another topic with the feed where it was', async () => {
    const stack = (topic, message) => `[Reply stack](${facts.origin}/?topic=${topic}&message=${message})`;
    // In the same topic: the stack opens in this page's Reader, over the feed.
    const here = (await control({ method: 'agent_message', operation_id: 'notebook-sheet-stack-here', topic_id: 't1', body: 'The stack about the plan, here.' })).result.message_id;
    const id = await topicPage('Sheet stacks', `## Plan\n\nShip it.\n\n${stack('t1', here)}\n\n## Notes\n\nDan reviews.\n`);
    let p = await page('notebook-sheet-stack-here', null, true, laptop);
    await listed(p, card(id), 'the topic\'s Notebook lists its page');
    await p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).scrollIntoView({block:'center'})`);
    let at = await scrolled(p);
    await p.point(card(id));
    await opened(p, 'Sheet stacks', ['Plan', 'Notes']);
    await writeIn(p, 'Notes', ' Mine.');
    await p.point(`${await cardOf(p, 'Plan')} a.deck-bubble`);
    await until(() => p.evaluate(`document.querySelector('#reader').open && document.querySelector('#source-body').textContent.includes('The stack about the plan, here.')`), 'the stack opens in the Reader');
    assert.deepEqual(await p.evaluate(`(()=>{const b=document.querySelector('#reader .notebook-back');return {back:b&&!b.hidden?[b.textContent,b.getAttribute('aria-label'),b.title]:null,sheet:document.querySelector(${JSON.stringify(SHEET)}).open,topic:document.querySelector('#reader-parent').hidden}})()`),
      { back: ['← Sheet stacks', 'Back to the Notebook page Sheet stacks', 'Back to Sheet stacks, as you left it'], sheet: false, topic: true }, 'the Reader\'s header has the way back to the page, in place of its way to the topic');
    await shot(p, 'notebook-sheet-stack-reader');
    await p.point('#reader .notebook-back');
    await waitFor(p, s => s.open && !s.reader && s.box?.focused && s.box.words === 'Notes\nDan reviews. Mine.', { open: true, reader: false, box: { words: 'Notes\nDan reviews. Mine.', focused: true } },
      'the way back brings the page back as it was, the card still being written');
    await p.key('Escape'); await p.key('Escape');
    await closed(p);
    await settle(p);
    assert.deepEqual(await p.evaluate(`({y:scrollY,focus:document.activeElement===document.querySelector(${JSON.stringify(card(id))})})`), { y: at, focus: true },
      'closing the page puts the feed where it was read and gives the focus back to its card');
    assert.deepEqual(p.errors, []);
    await p.close();
    // From another topic: an outcome's page asks in its Conversation, so the stack opens there, and its way back
    // comes back to this topic, the feed where it was and the page open over it with its card box as it was.
    const conversation = (await view('conversation', { workspace_id: 'w1' })).conversation.topic_id;
    const there = (await control({ method: 'agent_message', operation_id: 'notebook-sheet-stack-there', topic_id: conversation, whole_topic: true, sender: 'person', body: 'The stack about the ask, in the Conversation.' })).result.message_id;
    const asks = await outcomePage('sheet-stack-asks', 'Sheet asks', `## Ask\n\nWhat next?\n\n${stack(conversation, there)}\n\n## Draft\n\nWords.\n`);
    p = await page('notebook-sheet-stack-there', null, true, laptop);
    await wholeOutcome(p);
    await listed(p, railRow(asks), 'the right rail lists the page');
    await p.evaluate(`(()=>{document.querySelector(${JSON.stringify(railRow(asks))}).scrollIntoView({block:'center'});scrollTo(0,Math.min(300,document.documentElement.scrollHeight-innerHeight));return true})()`);
    at = await scrolled(p);
    assert.ok(at > 0, 'the feed is scrolled down');
    await p.point(railRow(asks));
    await opened(p, 'Sheet asks', ['Ask', 'Draft']);
    await writeIn(p, 'Draft', ' Unsent.');
    await p.point(`${await cardOf(p, 'Ask')} a.deck-bubble`);
    await until(() => p.evaluate(`location.search!=='?topic=t1' && document.querySelector('#reader')?.open && document.querySelector('#source-body').textContent.includes('The stack about the ask, in the Conversation.')`), 'the stack opens in the Reader on the Conversation');
    await until(() => p.evaluate(`(()=>{const b=document.querySelector('#reader .notebook-back');return Boolean(b&&!b.hidden&&b.textContent==='← Sheet asks')})()`), 'the Reader there has the way back to the page');
    // Closed any way: Escape.
    await p.key('Escape');
    await until(() => p.evaluate(`location.search==='?topic=t1' && document.body.dataset.ready==='true'`), 'the way back comes back to this topic');
    await waitFor(p, s => s.open && s.title === 'Sheet asks' && s.box?.focused && s.box.words === 'Draft\nWords. Unsent.', { open: true, title: 'Sheet asks', box: { words: 'Draft\nWords. Unsent.', focused: true } },
      'the page is open over the topic again with its card box as it was');
    await saved(asks, 'Words. Unsent.', 'the unfinished card is saved');
    await p.point(`${SHEET} .notebook-sheet-close`);
    await closed(p);
    await settle(p);
    assert.equal(await scrolled(p), at, 'closing the page puts the feed where it was read before the stack');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('notebook while a card is written, ← at its very start folds away its children, and stays the box\'s on a card with none or mid-text; ⌘Return goes on to a new card below, and over the feed sends no message', async () => {
    // On the cards page.
    const id = await outcomePage('sheet-left-return', 'Cards keys', cardsBody);
    let p = await page('notebook-left-return', null, true, { url: `${facts.origin}/?cards=${id}` });
    const FULL = '#deck-page';
    const box = () => p.evaluate(`(()=>{const f=document.querySelector('${FULL} .deck-writing textarea');return f?{words:f.value,at:[f.selectionStart,f.selectionEnd],focused:document.activeElement===f,above:(()=>{let a=f.closest('li').previousElementSibling;while(a?.hidden)a=a.previousElementSibling;return a?.querySelector('.deck-title')?.textContent??null})()}:null})()`);
    const shows = () => p.evaluate(`({cards:[...document.querySelectorAll('${FULL} .deck-card:not([hidden]) .deck-title')].map(e=>e.textContent),count:document.querySelector('${FULL} .deck-count').textContent,
      focus:document.activeElement?.closest?.('.deck-card')?.querySelector('.deck-title')?.textContent??null})`);
    await until(() => p.evaluate(`document.querySelectorAll('${FULL} .deck-card').length === 3`), 'the cards show');
    await p.key('Enter', 4);
    await until(async () => (await box())?.words === 'Plan\nShip it.', '⌘Return opens Plan to write');
    // ← moves the cursor through the words, then from the very start finishes the card and folds its children away.
    for (let step = 0; step < 'Plan\nShip it.'.length; step++) await p.key('ArrowLeft');
    assert.deepEqual(await box(), { words: 'Plan\nShip it.', at: [0, 0], focused: true, above: null }, '← mid-text moves the cursor and leaves the box open');
    await p.key('ArrowLeft');
    await until(async () => !(await box()), '← at the very start finishes the card');
    assert.deepEqual(await shows(), { cards: ['Plan', 'Notes'], count: '1 of 2 · 1 folded', focus: 'Plan' }, 'its children are folded away, the card picked and focused');
    assert.equal((await view('memory_current', { item_id: id })).body, cardsBody, 'folding writes nothing');
    // On a card with no children, ← at the very start stays the box's.
    await p.key('ArrowDown'); await p.key('Enter', 4);
    await until(async () => (await box())?.words === 'Notes\nDan reviews.', '⌘Return opens Notes to write');
    for (let step = 0; step <= 'Notes\nDan reviews.'.length; step++) await p.key('ArrowLeft');
    assert.deepEqual(await box(), { words: 'Notes\nDan reviews.', at: [0, 0], focused: true, above: 'Plan' }, '← at the very start of a card with no children leaves the box open');
    // ⌘Return finishes the card and opens a new one below it.
    await p.key('Enter', 4);
    await until(async () => JSON.stringify(await box()) === JSON.stringify({ words: '', at: [0, 0], focused: true, above: 'Notes' }), '⌘Return opens a new card below to write')
      .catch(async error => { assert.deepEqual(await box(), { words: '', at: [0, 0], focused: true, above: 'Notes' }, '⌘Return opens a new card below to write'); throw error; });
    await p.send('Input.insertText', { text: 'Next\nWritten after.' });
    await p.key('Enter', 4);
    await until(async () => JSON.stringify(await box()) === JSON.stringify({ words: '', at: [0, 0], focused: true, above: 'Next' }), 'and again below the card just written');
    await until(async () => (await view('memory_current', { item_id: id })).body === cardsBody + '\n## Next\n\nWritten after.\n', 'the new card is saved after Notes')
      .catch(async error => { assert.equal((await view('memory_current', { item_id: id })).body, cardsBody + '\n## Next\n\nWritten after.\n'); throw error; });
    // From an empty box ⌘Return only finishes: it never makes an empty card.
    await p.key('Enter', 4);
    await until(async () => !(await box()), '⌘Return in an empty box only finishes');
    assert.deepEqual((await shows()).cards, ['Plan', 'Notes', 'Next'], 'no empty card is made');
    assert.deepEqual(p.errors, []);
    await p.close();
    // Over the feed, in the composer: ⌘Return goes on to a new card and sends nothing.
    const topicId = await topicPage('Sheet return', '## Only\n\nOne card.\n');
    const messages = async () => (await view('topic_messages', { topic_id: 't1', direction: 'before', limit: 100 })).items.length;
    const sent = await messages();
    p = await page('notebook-sheet-return', null, true);
    await listed(p, card(topicId), 'the topic\'s Notebook lists its page');
    await press(p, card(topicId));
    await opened(p, 'Sheet return', ['Only']);
    await until(() => p.evaluate(`document.activeElement?.matches?.(${JSON.stringify(PAGE + ' .deck-card')})`), 'the picked card has the focus');
    await p.key('Enter', 4);
    await waitFor(p, s => s.box?.words === 'Only\nOne card.', { box: { words: 'Only\nOne card.' } }, '⌘Return opens the card to write');
    await p.key('Enter', 4);
    await waitFor(p, s => s.box?.focused && s.box.words === '', { box: { words: '', focused: true } }, '⌘Return opens a new card below');
    await p.send('Input.insertText', { text: 'Over the feed\nNo message.' });
    await p.key('Enter', 4); await p.key('Enter', 4);
    await waitFor(p, s => s.open && !s.box && JSON.stringify(s.cards) === JSON.stringify(['Only', 'Over the feed']), { open: true, box: null, cards: ['Only', 'Over the feed'] }, 'the cards are written and the sheet stays open');
    await saved(topicId, '## Over the feed\n\nNo message.', 'the card is saved');
    assert.equal(await messages(), sent, '⌘Return sends no message in the topic');
    await p.key('Escape');
    await closed(p);
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('notebook in the composer: a page opened from the keys right after ✕ closed another stays open, and its ✕ gives the focus back to its own card', async () => {
    const first = await topicPage('Sheet keyed one', cardsBody), second = await topicPage('Sheet keyed two', '## Other\n\nAnother page.\n');
    const p = await page('notebook-sheet-keyed', null, true, laptop);
    await listed(p, card(second), 'the topic\'s Notebook lists both pages');
    await press(p, card(first));
    await opened(p, 'Sheet keyed one', ['Plan', 'Steps', 'Notes']);
    // ✕, then at once Tab to the next card and Return: the browser's close event for the first page comes after the
    // second has opened, and must not put the second away.
    await p.point(`${SHEET} .notebook-sheet-close`);
    await p.key('Tab'); await p.key('Enter');
    await opened(p, 'Sheet keyed two', ['Other']);
    await settle(p); await settle(p);
    const still = await state(p);
    assert.deepEqual([still.open, still.title, still.reader, still.cards], [true, 'Sheet keyed two', false, ['Other']], 'the second page stays open over the feed');
    await p.point(`${SHEET} .notebook-sheet-close`);
    await closed(p);
    await settle(p);
    assert.equal(await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(card(second))})`), true, 'its ✕ gives the focus back to the card that opened it');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('notebook in the composer: opening another page replaces the first, whose unfinished card goes on to Core and opens again with it', async () => {
    const first = await topicPage('Sheet first', cardsBody);
    const second = await outcomePage('sheet-second', 'Sheet second', '## Other\n\nAnother page.\n');
    const p = await page('notebook-sheet-replace', null, true);
    await listed(p, card(first), 'the topic\'s Notebook lists its page');
    await press(p, card(first));
    await opened(p, 'Sheet first', ['Plan', 'Steps', 'Notes']);
    await writeIn(p, 'Notes', ' Left open.');
    await p.point(`${SHEET} .notebook-sheet-close`);
    await closed(p);
    await wholeOutcome(p);
    await listed(p, railRow(second), 'the right rail lists the second page');
    await press(p, railRow(second));
    await opened(p, 'Sheet second', ['Other']);
    assert.equal((await state(p)).pages, 1, 'the second page replaces the first in the sheet');
    await saved(first, 'Dan reviews. Left open.', 'the first page\'s unfinished card goes on to Core');
    // Its keys went with it: ↓ picks in the page that shows, and nowhere else.
    await p.key('ArrowDown');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(PAGE + ' .deck-count')}).textContent`), '1 of 1');
    await p.point(`${SHEET} .notebook-sheet-close`);
    await closed(p);
    await press(p, card(first));
    await waitFor(p, s => s.open && s.title === 'Sheet first' && s.pages === 1 && s.box?.focused && s.box.words === 'Notes\nDan reviews. Left open.',
      { open: true, title: 'Sheet first', pages: 1, box: { words: 'Notes\nDan reviews. Left open.', focused: true } }, 'the first page comes back alone, its card box open again');
    await p.key('Escape'); await p.key('Escape');
    await closed(p);
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('notebook in the composer: a revision made elsewhere shows in the sheet while it is open, and a closed sheet\'s page is not read again until it opens', async () => {
    const id = await topicPage('Sheet live', '## One\n\nFirst words.\n');
    const p = await page('notebook-sheet-live', null, true);
    await listed(p, card(id), 'the topic\'s Notebook lists its page');
    await press(p, card(id));
    await opened(p, 'Sheet live', ['One']);
    let revision = (await view('memory_current', { item_id: id })).source_ref.revision;
    // What Core holds the person has read of the page.
    const readOf = async () => {
      for (let cursor = 0; ;) {
        const listed = await view('memory_items', { owner_scope: { kind: 'topic', id: 't1' }, cursor });
        const item = listed.items.find(entry => entry.id === id);
        if (item || listed.next_cursor === null) return item?.read_revision ?? null;
        cursor = listed.next_cursor;
      }
    };
    await until(async () => (await readOf()) === revision, 'opening the page reads it')
      .catch(async error => { assert.equal(await readOf(), revision, 'opening the page reads it'); throw error; });
    const revise = async body => {
      const answer = await control({ method: 'memory_revise', operation_id: `${id}-live-${revision}`, item_id: id, expected_revision: revision, title: 'Sheet live', body });
      assert.equal(answer.status, 'committed', JSON.stringify(answer)); revision += 1;
    };
    await revise('## One\n\nFirst words.\n\n## Two\n\nAn agent added this.\n');
    await opened(p, 'Sheet live', ['One', 'Two']);
    // Watched as it arrived, the revision is read: Core holds it read, and the page's card wears no light.
    await until(async () => (await readOf()) === revision, 'the revision that reached the page while it showed is read')
      .catch(async error => { assert.equal(await readOf(), revision, 'the revision that reached the page while it showed is read'); throw error; });
    await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(card(id) + ' .unread-count')})`), 'the topic\'s Notebook card wears no light for it');
    // The person's own revision Core counts as read already: a card they write sends no read of it.
    const marked = () => p.calls.filter(call => call.payload?.kind === 'memory.read' && call.payload.target?.item_id === id).length, readBefore = marked();
    assert.ok(readBefore > 0, 'the reads so far are counted');
    await writeIn(p, 'Two', ' Mine.');
    await p.key('Escape');
    await saved(id, 'An agent added this. Mine.', 'the person\'s card is saved');
    revision = (await view('memory_current', { item_id: id })).source_ref.revision;
    const mine = (await control({ method: 'agent_message', operation_id: 'notebook-sheet-live-mine', topic_id: 't1', body: 'A message after the person\'s own revision.' })).result.message_id;
    await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${mine}"]'))`), 'a message after the person\'s revision reaches the feed');
    await settle(p);
    assert.equal(marked() - readBefore, 0, 'the person\'s own revision sends no read');
    // Nor, all that while, was anything drawn over the cards for the revision watched as it came.
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(PAGE + ' .notebook-sheet-changes')}).hidden`), true, 'nothing is drawn above the cards for a revision watched as it came');
    await p.point(`${SHEET} .notebook-sheet-close`);
    await closed(p);
    const reads = () => p.calls.filter(call => call.payload?.name === 'memory_current' && call.payload.args?.item_id === id).length;
    const before = reads();
    await revise('## One\n\nFirst words.\n\n## Two\n\nAn agent added this.\n\n## Three\n\nWhile it was closed.\n');
    // The commit reached the page: the card in the topic's Notebook lights, and a message after it shows.
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(id) + ' .unread-count')})?.textContent==='1'`), 'the topic\'s Notebook card lights for the new revision');
    const after = (await control({ method: 'agent_message', operation_id: 'notebook-sheet-live-after', topic_id: 't1', body: 'A message after the revision.' })).result.message_id;
    await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${after}"]'))`), 'a later message reaches the feed');
    await settle(p);
    assert.equal(reads() - before, 0, 'a page whose sheet is closed is not read again on a commit');
    await press(p, card(id));
    await opened(p, 'Sheet live', ['One', 'Two', 'Three']);
    assert.ok(reads() > before, 'opening it again reads it');
    await p.point(`${SHEET} .notebook-sheet-close`);
    await closed(p);
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('notebook in the composer: a reload while a card is written keeps the writing, and its box opens again with the page', async () => {
    const id = await topicPage('Sheet reload', cardsBody);
    // The first save is held on its way, on the first document only, so the writing is on this device alone.
    const p = await page('notebook-sheet-reload', null, true, { beforeNavigate: async q => {
      await q.send('Page.addScriptToEvaluateOnNewDocument', { source: `if(!sessionStorage.getItem('sheet-reload-held')){sessionStorage.setItem('sheet-reload-held','1');
        const originalFetch=fetch.bind(globalThis);globalThis.fetch=async(...args)=>{let kind;try{kind=JSON.parse(args[1]?.body).kind}catch{}
          if(kind==='memory.revise'){globalThis.heldSave=true;return new Promise(()=>{});}return originalFetch(...args);};}` });
    } });
    await listed(p, card(id), 'the topic\'s Notebook lists its page');
    await press(p, card(id));
    await opened(p, 'Sheet reload', ['Plan', 'Steps', 'Notes']);
    await writeIn(p, 'Notes', ' Before the reload.');
    await until(() => p.evaluate('globalThis.heldSave===true'), 'the save is on its way and held');
    assert.equal((await view('memory_current', { item_id: id })).body.includes('Before the reload.'), false, 'Core does not have it yet');
    await p.send('Page.reload', {});
    await until(async () => { try { return await p.evaluate(`document.body.dataset.ready==='true' && !globalThis.heldSave`); } catch { return false; } }, 'the page loads again');
    // The page is the topic's newest, which may be past the Notebook's first pages: More brings it, as before the reload.
    await listed(p, card(id), 'the topic\'s Notebook lists its page again');
    await press(p, card(id));
    await waitFor(p, s => s.open && s.box?.focused && s.box.words === 'Notes\nDan reviews. Before the reload.', { open: true, box: { words: 'Notes\nDan reviews. Before the reload.', focused: true } },
      'the card is open again to write, with what was written before the reload');
    await saved(id, 'Dan reviews. Before the reload.', 'the writing kept on this device goes on to Core');
    await p.key('Escape'); await p.key('Escape');
    await closed(p);
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // Item 422: the page read again after a save of its own (the commit followed while the sheet shows) is taken
  // between one listener of a key's input and the next, before the box's own listener gives the words to the
  // writing. Held in the page, so this order comes every time: the read's answer waits for the box's next input.
  await check('notebook in the composer: words typed into a card as the page is read again stay in the card being written, and Escape saves the card once, with them', async () => {
    const id = await topicPage('Sheet read at input', cardsBody);
    const { step, kept } = tracer(id);
    const p = await page('notebook-sheet-read-at-input', null, true, traced(laptop));
    await kept(p, async () => {
      await listed(p, card(id), 'the topic\'s Notebook lists its page');
      await p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).scrollIntoView({block:'center'})`);
      await p.point(card(id));
      await opened(p, 'Sheet read at input', ['Plan', 'Steps', 'Notes']);
      const trail = () => p.evaluate('window.__notebookTrail.map(t=>({...t,body:undefined}))');
      const from = (await trail()).length;
      // The page's next read waits for the box's next input.
      await p.evaluate('window.__notebookReadAfterSave=true');
      await writeIn(p, 'Notes', ' Kept.');
      await until(async () => { const t = (await trail()).slice(from), at = t.findIndex(e => e.kind === 'revise' && e.status === 'committed');
        return at >= 0 && t.slice(at).some(e => e.kind === 'read' && e.held !== undefined && e.released === undefined); }, 'the card saves, and the page\'s read after the save waits');
      await step(p, 'saved, the read waiting');
      await p.send('Input.insertText', { text: ' And.' });
      await until(async () => (await trail()).slice(from).every(e => e.kind !== 'read' || e.answered !== undefined), 'the read is answered as the words go in');
      await settle(p);
      await step(p, 'the read taken as the words went in');
      const words = 'Notes\nDan reviews. Kept. And.';
      assert.deepEqual((await state(p)).box, { words, at: [words.length, words.length], focused: true }, 'the card is still being written, with every word typed');
      await saved(id, '## Notes\n\nDan reviews. Kept. And.\n', 'the words typed as the page was read again save as the card is written');
      await p.send('Input.insertText', { text: ' Done.' });
      await p.key('Escape');
      await waitFor(p, s => s.open && !s.box, { open: true, box: null }, 'Escape finishes the card');
      await step(p, 'after Escape');
      await saved(id, '## Notes\n\nDan reviews. Kept. And. Done.\n', 'the words typed before Escape are in Core after it');
      // Written once: one Notes card, saved once, and nothing said of a card changed elsewhere.
      assert.deepEqual((await state(p)).cards, ['Plan', 'Steps', 'Notes'], 'the card written is one card');
      assert.equal(((await view('memory_current', { item_id: id })).body.match(/^## Notes$/gm) ?? []).length, 1, 'Core holds the card once');
      assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(SHEET + ' .notebook-sheet-status')}).textContent.includes('changed elsewhere')`), false, 'nothing says the card changed elsewhere');
      assert.deepEqual(p.errors, []);
    });
    await p.close();
  });

  // Item 422, the Text view: the same read, taken between one listener of the Text box's input and the next, before
  // the box's own listener gives the words to the writing. The Text box is drawn from the writing as the page is read
  // again, so it keeps them only if they reach the writing first.
  await check('notebook in the composer: words typed into Text as the page is read again stay in Text, and are saved once, with them', async () => {
    const id = await topicPage('Sheet text read at input', cardsBody);
    const { step, kept } = tracer(id);
    const p = await page('notebook-sheet-text-read-at-input', null, true, traced(laptop));
    const text = p => p.evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(PAGE + ' .notebook-text')});return f?{words:f.value,at:[f.selectionStart,f.selectionEnd],focused:document.activeElement===f}:null})()`);
    await kept(p, async () => {
      await listed(p, card(id), 'the topic\'s Notebook lists its page');
      await p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).scrollIntoView({block:'center'})`);
      await p.point(card(id));
      await opened(p, 'Sheet text read at input', ['Plan', 'Steps', 'Notes']);
      await p.point(`${SHEET} .notebook-sheet-views button:first-child`);
      await until(async () => { const t = await text(p); return t?.focused && t.words === cardsBody; }, 'Text shows the page\'s words, ready to write');
      assert.deepEqual(await text(p), { words: cardsBody, at: [cardsBody.length, cardsBody.length], focused: true }, 'Text opens with the cursor after the page\'s words');
      const trail = () => p.evaluate('window.__notebookTrail.map(t=>({...t,body:undefined}))');
      const from = (await trail()).length;
      // The page's next read waits for the Text box's next input.
      await p.evaluate('window.__notebookReadAfterSave=true');
      await p.send('Input.insertText', { text: 'Kept.' });
      await until(async () => { const t = (await trail()).slice(from), at = t.findIndex(e => e.kind === 'revise' && e.status === 'committed');
        return at >= 0 && t.slice(at).some(e => e.kind === 'read' && e.held !== undefined && e.released === undefined); }, 'the words save, and the page\'s read after the save waits');
      await step(p, 'saved, the read waiting');
      await p.send('Input.insertText', { text: ' And.' });
      await until(async () => (await trail()).slice(from).every(e => e.kind !== 'read' || e.answered !== undefined), 'the read is answered as the words go in');
      await settle(p);
      await step(p, 'the read taken as the words went in');
      const words = cardsBody + 'Kept. And.';
      assert.deepEqual(await text(p), { words, at: [words.length, words.length], focused: true }, 'Text keeps every word typed, the cursor after them');
      await saved(id, 'Dan reviews.\nKept. And.', 'the words typed as the page was read again save');
      await p.send('Input.insertText', { text: ' Done.' });
      await saved(id, 'Dan reviews.\nKept. And. Done.', 'the words typed after them save after them');
      await step(p, 'after the last words');
      // Written once: the words once in Core, and no choice between two versions.
      assert.equal(((await view('memory_current', { item_id: id })).body.match(/Kept\./g) ?? []).length, 1, 'Core holds the words once');
      assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(PAGE + ' .notebook-conflict:not([hidden])')}))`), false, 'the page asks for no choice');
      assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(SHEET + ' .notebook-sheet-status')}).textContent.includes('changed elsewhere')`), false, 'nothing says the page changed elsewhere');
      assert.deepEqual(p.errors, []);
    });
    await p.close();
  });

  // Item 421: the page is read again (a commit of its own save, followed while the sheet shows) and the read's answer
  // comes while a press outside the sheet is down, so the deck is drawn again with the focus away from the box. Held
  // at the server, so this order comes every time: the read waits until the press is down.
  await check('notebook in the composer: a card being written keeps its cursor where it was when the page is read again while the sheet is closed, so words typed after reopening go where the cursor was and Escape saves them there', async () => {
    const id = await topicPage('Sheet read late', cardsBody);
    const { step, kept } = tracer(id);
    const p = await page('notebook-sheet-read-late', null, true, traced(laptop));
    const hold = `read-late-${id}`;
    let armed = false;
    await kept(p, async () => {
      try {
        await listed(p, card(id), 'the topic\'s Notebook lists its page');
        await p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).scrollIntoView({block:'center'})`);
        await p.point(card(id));
        await opened(p, 'Sheet read late', ['Plan', 'Steps', 'Notes']);
        const trail = () => p.evaluate('window.__notebookTrail.map(t=>({...t,body:undefined}))');
        await writeIn(p, 'Notes', ' Kept.');
        await saved(id, 'Dan reviews. Kept.', 'the card being written saves as it is written');
        await until(async () => { const t = await trail(), at = t.findLastIndex(e => e.kind === 'revise' && e.status === 'committed');
          return at >= 0 && t.slice(at).some(e => e.kind === 'read' && e.answered !== undefined) && t.every(e => e.kind !== 'read' || e.answered !== undefined); }, 'the page is read again after the save');
        await step(p, 'written and saved');
        // The next read of the page waits at the server; nothing here reads it while it waits.
        await control({ method: 'read_hold', hold_id: hold, name: 'memory_current', phase: 'callback', count: 1 });
        armed = true;
        const sent = (await trail()).length;
        await p.send('Input.insertText', { text: ' And outside.' });
        // Its save commits, and the commit has the page read again, which waits.
        await until(async () => (await trail()).slice(sent).some(t => t.kind === 'revise' && t.status === 'committed'), 'the words written save');
        await until(async () => { const t = await trail(); const at = t.slice(sent).findIndex(e => e.kind === 'revise'); return t.slice(sent + at).some(e => e.kind === 'read' && e.answered === undefined); }, 'the page is read again after its save, and the read waits');
        const side = await p.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(SHEET)}).getBoundingClientRect();return {x:Math.max(4,r.left/2),y:r.top+r.height/2}})()`);
        await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...side });
        await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...side, button: 'left', clickCount: 1 });
        // The read comes back while the press is down.
        await control({ method: 'read_release', hold_id: hold });
        armed = false;
        await until(async () => (await trail()).slice(sent).every(t => t.kind !== 'read' || t.answered !== undefined), 'the page\'s read comes back while the press is down');
        await settle(p);
        await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...side, button: 'left', clickCount: 1 });
        await closed(p);
        await step(p, 'read again while closed');
        await p.point(card(id));
        await step(p, 'reopened');
        const words = 'Notes\nDan reviews. Kept. And outside.';
        await waitFor(p, s => s.open && s.box?.focused && s.box.words === words && s.box.at[0] === words.length && s.box.at[1] === words.length,
          { open: true, box: { words, at: [words.length, words.length], focused: true } }, 'reopened, the card is open to write with the cursor where it was, at the end of what was written');
        await p.send('Input.insertText', { text: ' Done by Escape.' });
        await p.key('Escape');
        await waitFor(p, s => s.open && !s.box, { open: true, box: null }, 'Escape finishes the card');
        await step(p, 'after Escape');
        await saved(id, '## Notes\n\nDan reviews. Kept. And outside. Done by Escape.\n', 'the words typed before Escape are in Core after it, where the cursor was');
        // Written once: one Notes card, saved once.
        assert.deepEqual((await state(p)).cards, ['Plan', 'Steps', 'Notes'], 'the card written is one card');
        assert.equal(((await view('memory_current', { item_id: id })).body.match(/^## Notes$/gm) ?? []).length, 1, 'Core holds the card once');
        assert.deepEqual(p.errors, []);
      } finally {
        if (armed) { await control({ method: 'read_cancel', hold_id: hold }).catch(() => {}); await control({ method: 'read_release', hold_id: hold }); }
      }
    });
    await p.close();
  });
}
