// Item 738. Native gestures against an isolated real HTTP/Core fixture.
// Source controls swap real immutable Builds, never DOM or handler substitutes.
import assert from 'node:assert/strict';

const GATE = `window.holdReads=true;window.coverReadReceipts=[];window.coverSends=[];window.coverReceipts=[];window.coverGate='pass';window.coverReleases=[];
window.coverKeys=[];window.coverFocus=[];window.coverWatchKeys=false;
addEventListener('keydown',e=>{if(!window.coverWatchKeys)return;const r={key:e.key,alt:e.altKey,shift:e.shiftKey,trusted:e.isTrusted,target:e.target.tagName+'#'+e.target.id};window.coverKeys.push(r);queueMicrotask(()=>{r.prevented=e.defaultPrevented;r.after=document.activeElement?.tagName+'#'+document.activeElement?.id})},true);
addEventListener('focusin',e=>{if(window.coverWatchKeys)window.coverFocus.push({target:e.target.tagName+'#'+e.target.id,trusted:e.isTrusted})},true);
window.releaseCovers=()=>{window.coverGate='pass';for(const go of window.coverReleases.splice(0))go()};
{const send=window.fetch;window.fetch=async function(input,init){
 const b=typeof init?.body==='string' && String(input).endsWith('/api/command')?JSON.parse(init.body):null;
 if(b?.kind==='topic.read_through'){const r=await send.call(this,input,init);window.coverReadReceipts.push(await r.clone().json());return r}
 if(b?.kind!=='stack.cover_refresh')return send.call(this,input,init);
 window.coverSends.push(structuredClone(b));
 const mode=window.coverGate;
 if(mode==='hold')await new Promise(go=>window.coverReleases.push(go));
 if(mode==='offline')throw Error('Fixture transport interrupted before dispatch');
 const r=await send.call(this,input,init);window.coverReceipts.push(await r.clone().json());
 if(mode==='lost')throw Error('Fixture lost actual Core response');return r;
}}`;
const CONTROL = '.cover-refresh-glyph';

export async function coverRefreshChecks({ check, until, view, control, shot, facts, observations, engine }, helpers) {
  const { seed, open, centre, tap, press, openReader, closeReader, card } = helpers;
  const inputFor = device => device === 'laptop' ? 'laptop' : 'phone';
  const write = async (topic, root, args, suffix, sender = 'aim-core') => {
    const r = await control({ method: 'stack_act', kind: 'stack.cover', sender, message_id: root, args, operation_id: `${topic}-${suffix}` });
    assert.equal(r.status, 'committed', JSON.stringify(r)); return r.result;
  };
  const read = root => view('dossier_cover', { message_id: root });
  const setup = async (topic, single = false) => {
    const ids = await seed(topic, [
      ['root', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'Cabin weekend: check the latest road report.' }],
      ...(!single ? [['answer', { sender: 'aim-core', reply_to: 'root', addressees: [facts.actor], body: 'The lake opens in May; the road report is linked.' }]] : []),
    ]);
    await write(topic, ids.root, { stands: 'Road checked; waiting for the booking', waiting: [{ text: 'Book the cabin?', default: 'Friday if no answer' }],
      payload: { text: 'The May weekend', message_id: ids.answer ?? ids.root, kind: 'answer', link: 'https://example.test/cabin' } }, 'cover');
    return ids;
  };
  const scope = (surface, root) => surface === 'reader' ? '#reader-cover .dossier-cover' : surface === 'singleton'
    ? `${card(root)} > .row-pills` : `#messages .reply-stack[data-stack="${root}"] > .dossier-cover`;
  const exposeReply = async (p, device, root) => {
    const toggle = `#messages .reply-stack[data-stack="${root}"] > .stack-toggle`;
    // Actual owner levels are head/folded/open. A read reply vanishes from
    // folded after reload; cycle its visible owner until all replies show.
    for (let n = 0; n < 3; n++) {
      const state = await p.evaluate(`document.querySelector(${JSON.stringify(toggle)})?.dataset.state`);
      if (state === 'open') return;
      assert.ok(['head', 'folded'].includes(state), 'known dossier owner level: ' + state);
      await centre(p, toggle); await press(p, inputFor(device), toggle);
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(toggle)})?.dataset.state!==${JSON.stringify(state)}`), 'native dossier owner changes level');
    }
    assert.fail('native dossier owner did not open all replies');
  };
  const show = async (p, device, topic, ids, surface) => {
    if (surface === 'reader') {
      await exposeReply(p, device, ids.root);
      const folded = card(ids.answer) + ' > .message-folded > .folded-words';
      if (await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(folded)})?.getClientRects().length)`)) {
        await centre(p, folded); await press(p, inputFor(device), folded);
      }
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(ids.answer) + ' > .message-preview')})?.getClientRects().length)`), 'actual reply words revealed before activation');
      await openReader(p, inputFor(device), ids.answer, 'The lake opens in May');
      await press(p, inputFor(device), '#reader-cover > summary');
    }
    const where = surface === 'singleton' && await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(scope('sheet', ids.root))}))`) ? scope('sheet', ids.root) : scope(surface, ids.root);
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(where + ' ' + CONTROL)}))`), surface + ': refresh is drawn');
    await centre(p, where + ' ' + CONTROL);
    return where;
  };
  const look = (p, where) => p.evaluate(`(()=>{const h=document.querySelector(${JSON.stringify(where)}),c=h?.querySelector('.cover-refresh-glyph'),s=h?.querySelector('.cover-refresh-status'),d=c?.querySelector('.item-waiting'),b=c?.getBoundingClientRect();
    return {tag:c?.tagName,pending:c?.dataset.pending,status:s?.textContent,dots:d?.children.length??0,svg:c?.querySelector('svg')?.dataset.glyph,
      busy:c?.getAttribute('aria-disabled'),words:h?.textContent,title:c?.title,href:c?.getAttribute('href'),box:b?{x:b.x,y:b.y,width:b.width,height:b.height}:null,
      overflow:document.documentElement.scrollWidth-innerWidth,focused:c===document.activeElement,
      reduced:matchMedia('(prefers-reduced-motion:reduce)').matches,animation:d?[...d.children].map(e=>getComputedStyle(e).animationName):[]}})()`);
  const pendingShape = (state, checkLabel = true) => {
    assert.equal(state.tag, 'A', 'pending control opens the recorded request');
    assert.equal(state.pending, 'true');
    if (checkLabel) assert.equal(state.status, '', 'Tony8505: no visible pending label');
    assert.equal(state.dots, 3, 'actual shared waitingDots component');
    assert.deepEqual(state.animation, Array(3).fill(state.reduced ? 'none' : 'item-waiting'), 'existing sent-message animation honors actual reduced-motion preference');
  };
  // #7715: 1 CSS px covers fractional engine rounding; a 1px target mutant
  // remains 42px below the 44px phone minimum and cannot pass this check.
  const geometry = (state, device) => {
    const targetTolerancePx738 = 1, overflowTolerancePx738 = 1;
    assert.ok(state.box.width >= (device === 'laptop' ? 32 : 44) - targetTolerancePx738, 'target width (targetTolerancePx738=1)');
    assert.ok(state.box.height >= (device === 'laptop' ? 32 : 44) - targetTolerancePx738, 'target height (targetTolerancePx738=1)');
    assert.ok(state.overflow <= overflowTolerancePx738, 'page fits (overflowTolerancePx738=1)');
  };
  const activate = async (p, device, selector, keyboard = false) => {
    await centre(p, selector);
    if (!keyboard) return press(p, inputFor(device), selector);
    const reverse = await p.evaluate(`(()=>{const target=document.querySelector(${JSON.stringify(selector)}),active=document.activeElement;
      return !!target?.closest('dialog[open]') && !!(target.compareDocumentPosition(active)&Node.DOCUMENT_POSITION_FOLLOWING)})()`);
    const trace = [];
    await p.evaluate('window.coverWatchKeys=true;window.coverKeys=[];window.coverFocus=[]');
    let plainTab = false;
    for (let n = 0; n < 120; n++) {
      if (await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`)) break;
      const before = await p.evaluate(`({tag:document.activeElement?.tagName,id:document.activeElement?.id,className:document.activeElement?.className})`);
      await p.key('Tab', reverse ? 8 : 0, { plainTab });
      const after = await p.evaluate(`({tag:document.activeElement?.tagName,id:document.activeElement?.id,className:document.activeElement?.className})`);
      trace.push({before, after, plainTab});
      // The WebKit adapter normally translates to Option-Tab. If that exact
      // native key leaves focus unmoved, compare native plain Tab on the same
      // rendered control. Neither path sets focus or invokes a handler.
      if (engine === 'webkit' && n === 0 && JSON.stringify(before) === JSON.stringify(after)) plainTab = true;
    }
    const reached = await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`);
    const receipt = await p.evaluate(`({keys:window.coverKeys,focus:window.coverFocus,active:document.activeElement?.outerHTML,
      details:[...document.querySelectorAll('#reader details')].map(e=>({id:e.id,open:e.open})),target:(()=>{const e=document.querySelector(${JSON.stringify(selector)}),b=e?.getBoundingClientRect();return {html:e?.outerHTML,box:b?{x:b.x,y:b.y,width:b.width,height:b.height}:null}})()})`);
    observations.push({name:'item 738 native keyboard', selector, reverse, plainTab, reached, trace, receipt});
    await p.evaluate('window.coverWatchKeys=false');
    if (!reached) await shot(p, 'refresh738-keyboard-failure-' + observations.length);
    assert.equal(reached, true, 'native Tab reaches refresh: ' + JSON.stringify({reverse,trace,receipt}));
    await p.evaluate('window.coverWatchKeys=true');
    await p.key('Enter');
    observations.push({name:'item 738 native key activation', selector, receipt:await p.evaluate('({keys:window.coverKeys,focus:window.coverFocus})')});
    await p.evaluate('window.coverWatchKeys=false');
  };
  const source = async (phase, key, action) => {
    const receipt = await control({ method: 'item_738_runtime', phase });
    assert.ok(receipt?.candidate_hashes, 'source control must return a hash-bound receipt');
    observations.push({ name: 'item 738 source phase', key, ...receipt });
    try { return await action(receipt); }
    finally {
      const restored = await control({ method: 'item_738_runtime', phase: 'restored' });
      assert.equal(restored.restored, true);
      assert.deepEqual(restored.hashes, receipt.candidate_hashes, 'exact candidate bytes restored');
      observations.push({ name: 'item 738 source restore', key, ...restored });
    }
  };
  const draftText = 'Keep exactly: cabin, May 16–18.\nDo not send this reply.';
  const writingAt = surface => surface === 'reader' ? '#writing-body' : '#inline-writing-body';
  const writing = (p, surface) => p.evaluate(`(()=>{const reader=${surface === 'reader'},field=document.querySelector(${JSON.stringify(writingAt(surface))});return {text:field?.value,to:document.querySelector(reader?'#writing-to':'#inline-writing-to')?.textContent,named:document.querySelector(reader?'#recipient-named':'#inline-recipient-named')?.textContent}})()`);
  const assertWriting = async (p, surface, expected, reason) => {
    await until(async () => (await writing(p, surface)).text === expected.text, reason + ': restored text');
    assert.deepEqual(await writing(p, surface), expected, reason);
  };
  const keepWriting = async (p, device, surface) => {
    const field = writingAt(surface);
    if (await p.evaluate(`document.querySelector(${JSON.stringify(field)}).value===''`)) {
      await centre(p, field); await press(p, inputFor(device), field);
      await p.send('Input.insertText', { text: draftText });
    }
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(field)}).value===${JSON.stringify(draftText)}`), 'exact native writing present');
    const saved = surface === 'reader' ? '#save-state' : '#inline-save-state';
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(saved)}).textContent.startsWith('Saved to')`), 'actual draft saved before reload');
    return writing(p, surface);
  };
  const startFrames = (p, where, surface) => p.evaluate(`(()=>{window.coverFrames=[];window.coverFrameOn=true;
    const frame=t=>{if(!window.coverFrameOn)return;const h=document.querySelector(${JSON.stringify(where)}),c=h?.querySelector('.cover-refresh-glyph');
      window.coverFrames.push({t,tag:c?.tagName,pending:c?.dataset.pending,status:h?.querySelector('.cover-refresh-status')?.textContent,
        stands:h?.querySelector('.cover-stands')?.textContent,words:h?.textContent,writing:document.querySelector(${JSON.stringify(writingAt(surface))})?.value});requestAnimationFrame(frame)};requestAnimationFrame(frame)})()`);
  const stopFrames = async (p, topic, phase, surface, singleton = false) => {
    await p.evaluate('new Promise(done=>requestAnimationFrame(done))');
    const frames = await p.evaluate('(()=>{window.coverFrameOn=false;return window.coverFrames})()');
    observations.push({ name: 'item 738 actual animation frames', topic, phase, frames });
    assert.ok(frames.length > 0, 'actual rendered frames retained');
    for (const frame of frames) {
      assert.equal(frame.writing, draftText, 'exact writing on every sampled animation frame');
      assert.ok(!frame.status?.includes('Awaiting new cover'), 'no forbidden visible pending words on sampled frames');
      // A singleton becomes a folder at publication, so its old pills leave
      // the DOM. Do not invent frames for a selector that has ceased to exist.
      if (!singleton) {
        assert.ok(['BUTTON', 'A'].includes(frame.tag), 'cover control stays present on sampled frames');
        assert.ok(frame.words.includes('The May weekend') && frame.words.includes('Friday if no answer'), 'payload and default retained on sampled frames');
      }
    }
  };
  const originalCover = state => ({ stands: state.cover.stands, waiting: state.cover.waiting, payload: state.cover.payload, by: state.cover.by, at_ms: state.cover.at_ms });

  for (const device of ['laptop', 'phone-320', 'phone-375', 'phone']) for (const theme of ['light', 'dark']) {
    for (const surface of ['sheet', 'singleton', 'reader']) await check(`reading item 738 ${surface} ${device} ${theme}: native request, busy, durable pending, request link and real writer completion`, async () => {
      const topic = `refresh738-${surface}-${device}-${theme}`, ids = await setup(topic, surface === 'singleton');
      const before = await read(ids.root);
      // The actual live source at the supplied live94 commit, on these same
      // invented records after real read reports settle, gives unmodified before
      // images. Later reports are held in both versions to keep equal read state.
      await source('live', topic, async receipt => {
        let old;
        try {
          old = await open(topic + '-live', device, topic, ids.root, GATE.replace('window.holdReads=true', 'window.holdReads=false'));
          await old.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
          if (surface === 'reader') { await exposeReply(old, device, ids.root); await openReader(old, inputFor(device), ids.answer, 'The lake opens in May'); await press(old, inputFor(device), '#reader-cover > summary'); }
          await keepWriting(old, device, surface);
          const at = scope(surface, ids.root); await centre(old, at);
          await until(() => old.evaluate('window.coverReadReceipts.length>0 && window.fetchesOut===0'), 'actual live read reports settled before equal-state capture');
          await old.evaluate('window.holdReads=true');
          observations.push({ name: 'item 738 baseline actual read receipts', topic, receipts: await old.evaluate('window.coverReadReceipts') });
          assert.equal(await old.evaluate(`Boolean(document.querySelector(${JSON.stringify(at + ' ' + CONTROL)}))`), false, 'live source has no refresh glyph');
          assert.equal(await old.evaluate(`document.querySelector('script[type="module"][src]').src.includes('/b/${receipt.stamp}/')`), true);
          await shot(old, topic + '-before');
        } finally { if (old) await old.close(); }
      });
      let p;
      try {
        p = await open(topic, device, topic, ids.root, GATE);
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        let where = await show(p, device, topic, ids, surface);
        const heldWriting = await keepWriting(p, device, surface);
        await centre(p, where);
        const idle = await look(p, where); geometry(idle, device); assert.equal(idle.svg, 'refresh');
        await shot(p, topic + '-idle');
        await startFrames(p, where, surface);
        await p.evaluate("window.coverGate='hold'");
        await activate(p, device, where + ' ' + CONTROL, surface === 'reader' || device === 'laptop');
        await until(() => p.evaluate('window.coverReleases.length===1'), 'request held before real dispatch');
        const busy = await look(p, where);
        assert.equal(busy.status, 'Requesting update…'); assert.equal(busy.dots, 3);
        assert.equal((await read(ids.root)).refresh, null, 'busy is not a Core pending fact');
        await shot(p, topic + '-busy');
        await activate(p, device, where + ' ' + CONTROL);
        assert.equal(await p.evaluate('window.coverSends.length'), 1, 'repeated pending tap coalesces before dispatch');
        await p.evaluate('window.releaseCovers()');
        await until(async () => (await read(ids.root)).refresh?.state === 'pending', 'Core records actual pending');
        if (surface === 'singleton') where = scope('sheet', ids.root);
        await until(async () => (await look(p, where)).tag === 'A', 'pending reaches native surface');
        const pending = await read(ids.root), painted = await look(p, where);
        pendingShape(painted, false); geometry(painted, device);
        assert.equal(pending.refresh.recipient, 'aim-core', 'recorded writer, no hardcoded coordinator');
        assert.deepEqual(originalCover(pending), originalCover(before), 'whole original cover preserved');
        assert.ok(painted.href.includes(pending.refresh.request_message_id), 'request link names actual published message');
        await shot(p, topic + '-pending');
        observations.push({ name: 'item 738 native lifecycle', topic, device, theme, surface, idle, busy, pending, painted,
          envelopes: await p.evaluate('window.coverSends'), receipts: await p.evaluate('window.coverReceipts') });
        await assertWriting(p, surface, heldWriting, 'request preserves exact writing and To');
        await stopFrames(p, topic, 'idle-busy-pending', surface, surface === 'singleton');
        // A new page is a genuine reload of the same isolated origin, with no
        // browser-context error swallowed while the old document goes away.
        await p.close(); p = await open(topic + '-reload', device, topic, ids.root, GATE);
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        where = await show(p, device, topic, ids, surface);
        await assertWriting(p, surface, heldWriting, 'reload restores exact writing and To');
        const reloaded = await look(p, where); pendingShape(reloaded, false);
        assert.equal(await p.evaluate('window.coverSends.length'), 0, 'reload sends no new request');
        await shot(p, topic + '-reload');
        await activate(p, device, where + ' ' + CONTROL, device === 'laptop');
        await until(() => p.evaluate(`document.querySelector('#reader').open && document.querySelector('#source-body').textContent.includes('Please rewrite this dossier')`), 'pending link opens the actual recorded request');
        await shot(p, topic + '-request');
        assert.equal((await control({ method: 'item_738_audit', root: ids.root })).requests.filter(x => JSON.parse(x.addressees).includes('aim-core') && x.intent === 'ask').length, 1, 'exactly one ordinary request in Core');
        await closeReader(p, inputFor(device));
        if (surface === 'reader') where = await show(p, device, topic, ids, surface);

        await assertWriting(p, surface, heldWriting, 'opening actual request and returning preserves writing and To');
        await startFrames(p, where, surface);
        await write(topic, ids.root, { stands: 'Human checked the road again' }, 'human', facts.actor);
        assert.equal((await read(ids.root)).refresh.state, 'pending', 'human edit cannot complete');
        await until(async () => (await look(p, where)).words.includes('Human checked the road again'), 'actual human cover reaches native render while pending');
        await assertWriting(p, surface, heldWriting, 'human cover preserves writing and To');
        await centre(p, where); await shot(p, topic + '-human');
        await write(topic, ids.root, { stands: 'Human checked the road again' }, 'noop');
        assert.equal((await read(ids.root)).refresh.state, 'pending', 'no-op agent write cannot complete');
        pendingShape(await look(p, where));
        await shot(p, topic + '-noop');
        await control({ method: 'agent_thumb', sender: facts.actor, message_id: ids.answer ?? ids.root, operation_id: topic + '-done' });
        assert.equal((await read(ids.root)).refresh.state, 'pending', 'owner Done cannot complete');
        await until(async () => (await look(p, where)).words.includes('done · your 👍'), 'actual owner Done reaches native cover while pending');
        await assertWriting(p, surface, heldWriting, 'owner Done preserves writing and To');
        await shot(p, topic + '-owner-done');
        const newCover = await write(topic, ids.root, { stands: 'The cabin is booked for May' }, 'real-writer');
        await until(async () => (await read(ids.root)).refresh?.state === 'completed', 'real agent Core cover command completes');
        await until(async () => (await look(p, where)).tag === 'BUTTON', 'native control follows actual completion');
        const completed = await read(ids.root);
        assert.equal(completed.refresh.completed_revision, newCover.cover_revision);
        assert.equal(completed.cover.payload.done.how, 'thumb');
        await assertWriting(p, surface, heldWriting, 'completion preserves exact writing and To');
        await stopFrames(p, topic, 'human-noop-ownerDone-real-completion', surface);
        assert.equal(completed.cover.payload.link, before.cover.payload.link);
        assert.deepEqual(completed.cover.waiting, before.cover.waiting);
        await centre(p, where);
        await shot(p, topic + '-completed');
        assert.deepEqual([painted.status, reloaded.status], ['', ''], 'Tony8505: no visible pending label before or after reload');
        assert.deepEqual(p.errors, []);
      } finally { if (p) await p.close(); }
    });
  }

  for (const device of ['laptop', 'phone-320', 'phone-375', 'phone']) for (const theme of ['light', 'dark']) {
    for (const failure of ['offline', 'storage', 'unavailable', 'missing', 'readonly', 'lost']) await check(`reading item 738 ${failure} ${device} ${theme}: honest failure, exact retry and unchanged cover`, async () => {
      const topic = `refresh738-${failure}-${device}-${theme}`, ids = await setup(topic);
      if (failure === 'unavailable') await write(topic, ids.root, { stands: 'Human latest cover' }, 'human', facts.actor);
      if (failure === 'missing') await write(topic, ids.root, { stands: null, waiting: [], payload: null }, 'clear');
      const before = await read(ids.root);
      const init = GATE + (failure === 'storage' ? `
{const keep=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('aim-next-cover-refresh:'))throw Error('Fixture read-only storage');return keep.call(this,k,v)}}` : '');
      let p, closed = false;
      const end = async state => {
        const result = await control({ method: 'item_738_end', state, operation_id: topic + '-end-' + state });
        assert.equal(result.status, 'committed');
      };
      try {
        p = await open(topic, device, topic, ids.root, init);
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        const heldWriting = await keepWriting(p, device, 'sheet');
        if (failure === 'readonly') { await end('archived'); closed = true; }
        if (failure === 'missing') {
          assert.equal((await read(ids.root)).cover, null);
          assert.equal(await p.evaluate(`Boolean(document.querySelector('#messages .cover-refresh-glyph'))`), false, 'missing cover advertises no rewrite');
          await centre(p, `#messages .reply-stack[data-stack="${ids.root}"]`);
          await shot(p, topic + '-missing');
          assert.equal(await p.evaluate('window.coverSends.length'), 0);
          await write(topic, ids.root, { stands: 'Actual writer supplies a new cover' }, 'new-cover');
          await show(p, device, topic, ids, 'sheet');
          assert.deepEqual(p.errors, []); return;
        }
        const where = await show(p, device, topic, ids, 'sheet');
        if (failure === 'offline' || failure === 'lost') await p.evaluate(`window.coverGate=${JSON.stringify(failure)}`);
        await activate(p, device, where + ' ' + CONTROL, device === 'laptop');
        if (failure === 'lost') {
          await until(async () => (await read(ids.root)).refresh?.state === 'pending', 'lost transport response still has a real Core pending record');
          await until(async () => { const state = await look(p, where); return state.tag === 'A' && state.status === ''; }, 'Core read reconciles the actual lost receipt');
          pendingShape(await look(p, where));
          await assertWriting(p, 'sheet', heldWriting, 'lost response preserves exact writing and To');
          const sent = await p.evaluate('window.coverSends'), receipts = await p.evaluate('window.coverReceipts');
          assert.equal(sent.length, 1); assert.equal(receipts.length, 1); assert.equal(receipts[0].status, 'committed');
          assert.deepEqual(originalCover(await read(ids.root)), originalCover(before));
          await shot(p, topic + '-lost-response');
          await p.close(); p = await open(topic + '-reload', device, topic, ids.root, GATE);
          await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
          await show(p, device, topic, ids, 'sheet'); pendingShape(await look(p, where));
          await assertWriting(p, 'sheet', heldWriting, 'lost response reload preserves writing and To');
          assert.equal(await p.evaluate('window.coverSends.length'), 0, 'reload reconciles without a duplicate prompt');
          await shot(p, topic + '-reload');
          observations.push({ name: 'item 738 actual lost receipt', topic, device, theme, sent, receipts, pending: await read(ids.root) });
          assert.deepEqual(p.errors, []); return;
        }
        await until(async () => { const state = await look(p, where); return state.busy !== 'true' && Boolean(state.status); }, 'honest error appears beside original cover');
        await assertWriting(p, 'sheet', heldWriting, 'refusal preserves exact writing and To');
        const failed = await look(p, where); geometry(failed, device);
        if (failure === 'storage') { assert.match(failed.status, /Nothing was sent/); assert.equal(await p.evaluate('window.coverSends.length'), 0); }
        else if (failure === 'readonly') assert.match(failed.status, /archived/);
        else if (failure === 'unavailable') assert.match(failed.status, /No available cover writer/);
        else assert.match(failed.status, /not confirmed/);
        assert.equal((await read(ids.root)).refresh, null);
        assert.deepEqual(originalCover(await read(ids.root)), originalCover(before));
        await shot(p, topic + '-error');
        const sent = await p.evaluate('window.coverSends');
        await p.close(); p = await open(topic + '-reload', device, topic, ids.root, GATE);
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await show(p, device, topic, ids, 'sheet');
        await assertWriting(p, 'sheet', heldWriting, 'refused reload preserves exact writing and To');
        if (failure === 'readonly') { await end('open'); closed = false; }
        if (failure === 'unavailable') {
          await write(topic, ids.root, { stands: 'Actual agent takes over' }, 'takeover');
          await until(async () => (await look(p, where)).words.includes('Actual agent takes over'), 'actual new writer reaches the page before a fresh deliberate retry');
        }
        // Read-only storage failure made no envelope. An unconfirmed transport
        // request retains its original operation, authority and revision.
        {
          await activate(p, device, where + ' ' + CONTROL);
          await until(async () => (await read(ids.root)).refresh?.state === 'pending', 'deliberate retry records actual pending');
          if (failure === 'offline') assert.deepEqual(await p.evaluate('window.coverSends'), sent, 'reload retries the same complete envelope');
          await until(async () => (await look(p, where)).tag === 'A', 'retry reaches durable activity');
          pendingShape(await look(p, where));
          await assertWriting(p, 'sheet', heldWriting, 'exact retry preserves writing and To');
          await shot(p, topic + '-retry');
        }
        observations.push({ name: 'item 738 failure boundary', topic, failure, device, theme, failed, sent });
        assert.deepEqual(p.errors, []);
      } finally { if (p) await p.close(); if (closed) await end('open'); }
    });
  }

  await check('reading item 738 applied source controls: lost pending, forbidden visible label, undersized target and missing keyboard stop each fail the actual assertion, exact restore', async () => {
    const topic = 'refresh738-mutants', ids = await setup(topic);
    const r = await control({ method: 'stack_act', kind: 'stack.cover_refresh', sender: facts.actor, message_id: ids.root, args: {}, operation_id: topic + '-request' });
    assert.equal(r.status, 'committed');
    for (const phase of ['lost-pending', 'visible-text', 'small-target', 'keyboard-target']) await source(phase, topic, async receipt => {
      let p;
      try {
        p = await open(topic + '-' + phase, 'phone', topic, ids.root, GATE);
        const where = await show(p, 'phone', topic, ids, phase === 'keyboard-target' ? 'reader' : 'sheet');
        assert.equal(await p.evaluate(`document.querySelector('script[type="module"][src]').src.includes('/b/${receipt.stamp}/')`), true);
        if (phase === 'keyboard-target') {
          await assert.rejects(activate(p, 'phone', where + ' ' + CONTROL, true), /native Tab reaches refresh/, 'source removing the real keyboard stop must fail native key access');
          observations.push({ name: 'item 738 killed native keyboard mutant', phase });
          return;
        }
        const state = await look(p, where);
        assert.throws(() => phase === 'small-target' ? geometry(state, 'phone') : pendingShape(state), { name: 'AssertionError' }, 'applied source mutant must fail the real native assertion');
        await shot(p, topic + '-' + phase);
        observations.push({ name: 'item 738 killed native mutant', phase, state });
      } finally { if (p) await p.close(); }
    });
    let p;
    try {
      p = await open(topic + '-restored', 'phone', topic, ids.root, GATE);
      const where = await show(p, 'phone', topic, ids, 'reader'); pendingShape(await look(p, where)); geometry(await look(p, where), 'phone');
      await activate(p, 'phone', where + ' ' + CONTROL, true);
      await until(() => p.evaluate(`document.querySelector('#source-body').textContent.includes('Please rewrite this dossier')`), 'exact source restore restores actual keyboard access to request');
    } finally { if (p) await p.close(); }
  });
}
