// Item 717: explicit records, native cover/source/owner gestures, both engines.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Shared with the browser-free oracle control; this is the actual native read.
export const promiseCoverMeasurement = (selector, configuredWidth) => `(()=>{
    const c=document.querySelector(${JSON.stringify(selector)});if(!c)return null;
    const b=c.getBoundingClientRect(),v=window.visualViewport,configuredWidth=${JSON.stringify(configuredWidth)};
    const viewport=Math.min(configuredWidth,innerWidth,v?.width??innerWidth);
    return {words:c.textContent,rows:[...c.querySelectorAll('.cover-promise')].map(e=>({text:e.textContent,state:e.dataset.state,
      old:[...e.querySelectorAll('s')].map(s=>({text:s.textContent,struck:getComputedStyle(s).textDecorationLine.includes('line-through')})),
      cite:e.querySelector('.cover-src')?.textContent,times:[...e.querySelectorAll('time')].map(t=>t.dateTime)})),
      left:b.left,right:b.right,viewport,overflow:document.documentElement.scrollWidth-viewport,done:c.dataset.done,
      metrics:{configuredWidth,innerWidth,innerHeight,clientWidth:document.documentElement.clientWidth,
        scrollWidth:document.documentElement.scrollWidth,scrollX,devicePixelRatio,
        visual:v?{width:v.width,height:v.height,scale:v.scale,offsetLeft:v.offsetLeft,offsetTop:v.offsetTop,pageLeft:v.pageLeft}:null}}})()`;

export function assertPromiseCoverFit(seen) {
  const EDGE_TOLERANCE_PX = 2; // Engine rounding only; the +160px width mutant must fail.
  assert.ok(seen.left >= -EDGE_TOLERANCE_PX && seen.right <= seen.viewport + EDGE_TOLERANCE_PX && seen.overflow <= EDGE_TOLERANCE_PX,
    `cover fits within ${EDGE_TOLERANCE_PX}px rounding tolerance: ${JSON.stringify(seen)}`);
}

// Passive observation, installed before production listeners. Event references
// are read again after p.key returns, including events stopped before window bubble.
export const PROMISE_NATIVE_TRACE = `(()=>{
  const identity=e=>e?{id:e.id??null,tag:e.tagName??e.nodeName}:null;
  const state=e=>{if(!e||e.nodeType!==1)return identity(e);const ancestry=[];let at=e;
    for(;at&&ancestry.length<24;at=at.parentElement){const s=getComputedStyle(at),b=at.getBoundingClientRect();
      ancestry.push({...identity(at),hidden:at.hidden,disabled:Boolean(at.disabled),inert:at.inert,
        ariaHidden:at.getAttribute('aria-hidden'),display:s.display,visibility:s.visibility,opacity:s.opacity,
        overflowX:s.overflowX,overflowY:s.overflowY,clip:s.clip,clipPath:s.clipPath,
        rect:{left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height}})}
    return {...identity(e),connected:e.isConnected,enabled:!e.matches(':disabled'),tabIndex:e.tabIndex,
      visible:e.getClientRects().length>0&&getComputedStyle(e).visibility==='visible',
      ancestry,ancestryTruncated:Boolean(at)}};
  let events=[],dropped=0,selector=null;
  const snapshot=()=>({activeElement:state(document.activeElement),target:state(document.querySelector(selector)),
    readerOpen:document.querySelector('#reader')?.open,visibility:document.visibilityState,hasFocus:document.hasFocus()});
  const describe=(event,phase)=>({type:event.type,phase,isTrusted:event.isTrusted,key:event.key,code:event.code,
    altKey:event.altKey,ctrlKey:event.ctrlKey,metaKey:event.metaKey,shiftKey:event.shiftKey,
    repeat:event.repeat,defaultPrevented:event.defaultPrevented,eventPhase:event.eventPhase,
    target:identity(event.target),targetState:state(event.target),relatedTarget:identity(event.relatedTarget),activeElement:identity(document.activeElement),
    path:event.composedPath().slice(0,24).map(identity)});
  for(const type of ['keydown','keyup','focusin','focusout'])for(const capture of [true,false])
    addEventListener(type,event=>{if(!selector)return;if(events.length>=128){dropped++;return}
      events.push({event,seen:describe(event,capture?'capture':'bubble')})},{capture,passive:true});
  window.promiseNativeTrace={begin:target=>{events=[];dropped=0;selector=target;return snapshot()},
    end:()=>{const after=snapshot(),answer={after,dropped,events:events.map(({event,seen})=>({...seen,
      afterHandlers:{defaultPrevented:event.defaultPrevented,activeElement:identity(document.activeElement)}}))};
      events=[];selector=null;return answer}};
})();`;

export async function promiseChecks(api, helpers) {
  const { check, until, view, control, shot, facts, observations, engine } = api;
  // Both actual reading entrypoints take CHROME EVIDENCE MODE FILTER. Keep this family's
  // supplemental sources here, without changing every step's shared harness or source list.
  const evidence = process.argv[3], root = fileURLToPath(new URL('../', import.meta.url));
  assert.ok(path.isAbsolute(evidence), 'the actual entrypoint supplies its absolute evidence folder');
  const sources = {};
  for (const name of ['tests/dossier_promises_native.mjs', 'tests/topic_reading_native.mjs',
    'tests/reader_persistence_native.mjs', 'tests/webkit_native.mjs', 'web/index.html', 'web/aim.css',
    'web/layout.mjs', 'web/arrow-reach.mjs', 'web/message-menu.mjs', 'web/dossier-cover.mjs', 'web/reader.mjs', 'web/stack-look.css',
    'aim_next/cover_promises.py', 'aim_next/cover_values.py', 'aim_next/covers.py', 'aim_next/cli_covers.py']) {
    const bytes = await readFile(path.join(root, name));
    const target = path.join(evidence, 'source', name);
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes);
    sources[name] = createHash('sha256').update(bytes).digest('hex');
  }
  await writeFile(path.join(evidence, '717-sources.json'), JSON.stringify(sources, null, 2));
  observations.push({ name: 'item 717 supplemental source hashes before mutations', sources });
  const { seed, open, centre, press, openReader, closeReader, card } = helpers;
  const sizes = [['320', 'phone-320'], ['375', 'phone-375'], ['390', 'phone'], ['laptop', 'laptop']];
  const text = 'I will book the cabin.';
  let serial = 0;
  const write = (root, args, op) => control({ method: 'stack_act', sender: 'aim-core', kind: 'stack.cover', message_id: root, operation_id: op, args });
  const held = async (topic, root) => {
    const read = await control({ method: 'acts_as', reader: facts.actor, topic_id: topic });
    return read.acts.items.find(x => x.message_id === root)?.acts?.cover;
  };
  const make = async phase => {
    const topic = `promise-717-${phase}-${++serial}`;
    const ids = await seed(topic, [
      ['root', { sender: facts.actor, body: 'Cabin booking dossier' }],
      ['answer', { sender: 'aim-core', join: true, reply_to: 'root', addressees: [facts.actor], body: text }],
      ['note', { sender: facts.actor, reply_to: 'root', body: 'The lake road is clear.' }],
    ]);
    const result = await write(ids.root, { stands: 'Road clear', waiting: [{ text: 'Which cabin?', default: 'the lakeside one' }],
      payload: { text: 'The cabin booking', message_id: ids.answer } }, `${topic}-cover`);
    assert.equal(result.status, 'committed', JSON.stringify(result));
    const promise = { id: 'cabin', text, message_id: ids.answer, source_revision: 1,
      due: { at_ms: 1795024800000, time_zone: 'America/Los_Angeles' }, state: 'promised' };
    return { topic, ids, promise };
  };
  const covers = root => `#messages .reply-stack[data-stack="${root}"] > .dossier-cover`;
  const measure = (p, selector, width) => p.evaluate(promiseCoverMeasurement(selector, width === 'laptop' ? 1280 : Number(width)));
  const verify = (seen, state, expected, moved) => {
    assert.ok(seen && seen.rows.length === 1, 'one explicit promise appears');
    assert.equal(seen.rows[0].state, state);
    assert.ok(seen.rows[0].text.includes(text));
    assert.ok(seen.rows[0].text.includes(expected));
    assert.ok(seen.rows[0].cite, 'source attribution is linked');
    if (moved) assert.ok(seen.rows[0].old.some(x => x.struck && x.text.includes('America/Los_Angeles')), 'the prior time is visibly struck');
    assertPromiseCoverFit(seen);
    assert.equal(seen.done, 'false', 'a kept promise never gives Done');
    assert.ok(seen.words.includes('Which cabin?') && seen.words.includes('Road clear') && seen.words.includes('payload proposed'), 'existing cover fields survive');
  };
  const scheme = async (p, theme) => {
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await until(() => p.evaluate(`matchMedia('(prefers-color-scheme: ${theme})').matches`), 'theme selected');
  };
  const scenario = async (phase, baseline = false, capture = true, selected = null) => {
    const fixture = await make(phase);
    const { topic, ids, promise } = fixture;
    // Capture genuine live92 layout at every requested size/theme before asserting the missing act.
    if (baseline) for (const [width, shape] of sizes) for (const theme of ['light', 'dark']) {
      // Each viewport/theme owns its topic: reading a source in one cannot fold the next one's source.
      const fixture = await make(`base-${width}-${theme}`);
      const p = await open(`${fixture.topic}`, shape, fixture.topic, fixture.ids.root);
      try { await scheme(p, theme); await centre(p, covers(fixture.ids.root)); await shot(p, `717-base-feed-${width}-${theme}`);
        // The payload citation stays visible even after reading folds its source message.
        const device = shape.startsWith('phone') ? 'phone' : 'laptop';
        const citation = covers(fixture.ids.root) + ' .cover-payload .cover-src';
        await centre(p, citation); await press(p, device, citation);
        await until(() => p.evaluate('document.querySelector("#reader").open'), 'the visible source citation opens the Reader');
        await press(p, device, '#reader-cover-line');
        await until(() => p.evaluate('document.querySelector("#reader-cover").hasAttribute("open")'), 'baseline disclosure opens');
        await shot(p, `717-base-reader-${width}-${theme}`);
      } finally { await p.close(); }
    }
    const result = await write(ids.root, { promises: [promise] }, `${topic}-promise`);
    assert.equal(result.status, 'committed', `explicit promise write: ${JSON.stringify(result)}`);
    for (const [width, shape] of sizes) for (const theme of ['light', 'dark']) {
      const { topic, ids, promise } = await make(`${phase}-${width}-${theme}`);
      const device = shape.startsWith('phone') || shape === 'phone' ? 'phone' : 'laptop';
      const p = await open(`${topic}-${width}-${theme}`, shape, topic, ids.root);
      try { await scheme(p, theme);
      let rev = 0;
      for (const [branch, state, due, expected] of [
        ['normal', 'promised', promise.due, '2026-11-18 10:00 -08:00 · America/Los_Angeles'],
        ['missing-time', 'promised', null, 'No time given'],
        ['moved-timezone', 'promised', { at_ms: 1795111200000, time_zone: 'Pacific/Auckland' }, 'Pacific/Auckland'],
        ['missed', 'missed', { at_ms: 1795111200000, time_zone: 'Pacific/Auckland' }, 'missed'],
        ['kept', 'kept', { at_ms: 1795111200000, time_zone: 'Pacific/Auckland' }, 'kept'],
      ]) {
        const update = await write(ids.root, { promises: [{ ...promise, state, due }] }, `${topic}-${width}-${theme}-${++rev}`);
        assert.equal(update.status, 'committed', JSON.stringify(update));
        if (selected && selected !== branch) continue;
        await until(async () => { const c = await measure(p, covers(ids.root), width); return c?.rows[0]?.state === state && c.rows[0].text.includes(expected); }, `recorded ${state} / ${expected} arrives`);
        await centre(p, covers(ids.root));
        const seen = await measure(p, covers(ids.root), width);
        observations.push({ name: 'item 717 cover state', phase, engine, width, theme, state, seen });
        verify(seen, state, expected, rev >= 3);
        if (capture) await shot(p, `717-${phase}-${state}-${rev}-feed-${width}-${theme}`);
        // Open the cover's native source link by touch; keyboard reaches the same link with Tab on a laptop.
        const link = covers(ids.root) + ' .cover-promise > .cover-src';
        if (device === 'phone') {
          const TARGET_TOLERANCE_PX = 1; // 44px target, accepts rounding; a 24px target must fail.
          const b = await p.box(link);
          assert.ok(b.height >= 44 - TARGET_TOLERANCE_PX && b.width >= 44 - TARGET_TOLERANCE_PX, 'promise source is a 44px touch target within named tolerance');
        }
        await centre(p, link);
        if (device === 'phone') await press(p, device, link);
        else {
          let reached = false;
          for (let n = 0; n < 120; n++) { await p.key('Tab'); if (await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(link)})`)) { reached = true; break; } }
          assert.ok(reached, 'native Tab reaches the promise source'); await p.key('Enter');
        }
        await until(() => p.evaluate('document.querySelector("#reader").open'), 'source link opens the Reader');
        await press(p, device, '#reader-cover-line');
        await until(() => p.evaluate('document.querySelector("#reader-cover").hasAttribute("open")'), 'native cover disclosure opens');
        const readerSeen = await measure(p, '#reader-cover .dossier-cover', width);
        observations.push({ name: 'item 717 Reader cover state', phase, engine, width, theme, state, seen: readerSeen });
        verify(readerSeen, state, expected, rev >= 3);
        if (capture) await shot(p, `717-${phase}-${state}-${rev}-reader-${width}-${theme}`);
        await closeReader(p, device);
      }
      assert.equal((await held(topic, ids.root)).payload.done, null, 'no inferred Done in Core');
      assert.deepEqual(p.errors, []);
      } finally { await p.close(); }
    }
    return { topic, ids, promise };
  };
  await check('reading item 717 promises carry exact words explicit times history kept and missed on the cover and Reader at 320 375 390 laptop light dark', async () => scenario('final', !(await readFile(new URL('../web/dossier-cover.mjs', import.meta.url), 'utf8')).includes('function promiseRow(')));

  for (const branch of ['missing-time', 'moved-timezone', 'missed', 'kept']) {
    await check(`reading item 717 ${branch} is explicit on the cover and Reader at 320 375 390 laptop light dark`,
      () => scenario(branch, false, false, branch));
  }

  await check('reading item 717 a single message shows a promise pill and no Reader cover at 320 375 390 laptop light dark', async () => {
    for (const [width, shape] of sizes) for (const theme of ['light', 'dark']) {
      const topic = `promise-717-lone-${++serial}`;
      const ids = await seed(topic, [['root', { sender: 'aim-core', join: true, body: text, addressees: [facts.actor] }]]);
      const promise = { id: 'cabin', text, message_id: ids.root, source_revision: 1, due: null, state: 'promised' };
      assert.equal((await write(ids.root, { promises: [promise] }, topic + '-promise')).status, 'committed');
      const p = await open(topic, shape, topic, ids.root), device = shape.startsWith('phone') ? 'phone' : 'laptop';
      try {
        await scheme(p, theme);
        const pill = card(ids.root) + ' .pill-promise';
        await until(() => p.evaluate(`document.querySelector(${JSON.stringify(pill)})?.textContent.includes('No time given')`), 'the lone promise pill is drawn');
        await centre(p, pill); await shot(p, `717-lone-${width}-${theme}`);
        await openReader(p, device, ids.root, text);
        assert.equal(await p.evaluate('document.querySelector("#reader-cover").hidden'), true,
          'a single message keeps the existing pill-only form, with no dossier cover in the Reader');
        await shot(p, `717-lone-reader-${width}-${theme}`);
        assert.deepEqual(p.errors, []);
      } finally { await p.close(); }
    }
  });

  const sourceOpen = async (p, device, root) => {
    const citation = covers(root) + ' .cover-payload .cover-src';
    await centre(p, citation); await press(p, device, citation);
    await until(() => p.evaluate('document.querySelector("#reader").open'), 'payload source opens natively');
    await press(p, device, '#reader-cover-line');
    await until(() => p.evaluate('document.querySelector("#reader-cover").hasAttribute("open")'), 'cover disclosure opens natively');
  };
  const tracedKey = async (p, key, selector, trace, modifiers = 0) => {
    const before = await p.evaluate(`window.promiseNativeTrace.begin(${JSON.stringify(selector)})`);
    const step = { key, modifiers, before };
    trace.push(step);
    let error;
    try { await p.key(key, modifiers); } catch (caught) { error = caught; }
    if (error) step.error = String(error);
    const delivered = await p.evaluate('window.promiseNativeTrace.end()');
    Object.assign(step, delivered);
    if (error) throw error;
    return p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`);
  };
  const calibrateTab = async p => {
    const calibration = { name: 'item 717 native same-document Tab calibration', engine, trace: [] };
    observations.push(calibration);
    try {
      // Only after the production traversal has failed. Escape is native;
      // no pointer, focus(), showModal(), handler call or mapping change.
      await tracedKey(p, 'Escape', '#reader', calibration.trace);
      await until(() => p.evaluate('!document.querySelector("#reader").open'), 'native Escape closes Reader before calibration');
      await p.evaluate(`(()=>{const host=document.createElement('aside');host.id='promise-tab-calibration';
        host.style.cssText='position:fixed;top:0;left:0;z-index:2147483647;background:Canvas;color:CanvasText';
        const details=document.createElement('details'),summary=document.createElement('summary'),button=document.createElement('button');
        summary.id='promise-tab-summary';summary.textContent='Tab calibration';
        button.id='promise-tab-button';button.type='button';button.textContent='Next native stop';
        details.append(summary,button);host.append(details);document.body.append(host)})()`);
      let summaryReached = false;
      for (let n = 0; n < 120 && !summaryReached; n++) summaryReached = await tracedKey(p, 'Tab', '#promise-tab-summary', calibration.trace);
      calibration.summaryReached = summaryReached;
      if (!summaryReached) return;
      await tracedKey(p, 'Enter', '#promise-tab-summary', calibration.trace);
      calibration.detailsOpen = await p.evaluate('document.querySelector("#promise-tab-summary").parentElement.open');
      calibration.buttonReached = await tracedKey(p, 'Tab', '#promise-tab-button', calibration.trace);
    } catch (error) { calibration.error = String(error); }
    finally {
      try { await p.evaluate('document.querySelector("#promise-tab-calibration")?.remove()'); }
      catch (error) { calibration.cleanupError = String(error); }
    }
  };
  const activate = async (p, device, selector) => {
    await centre(p, selector);
    if (device === 'phone') return press(p, device, selector);
    const focusTrace = [];
    const diagnostic = { name: 'item 717 acceptance native delivery', engine, selector, focusTrace };
    observations.push(diagnostic); // Retain successful delivery as well as red.
    let reached = await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`);
    for (let n = 0; n < 120 && !reached; n++) {
      reached = await tracedKey(p, 'Tab', selector, focusTrace);
    }
    diagnostic.reached = reached;
    if (!reached) await calibrateTab(p);
    assert.ok(reached, 'native Tab reaches acceptance');
    await tracedKey(p, 'Enter', selector, focusTrace);
  };
  const disclosureKeys = async (p, meta, legacy = false) => {
    const trace = [], entry = { name: 'item 717 disclosure native keys', engine, ...meta, trace };
    observations.push(entry);
    let onLine = await p.evaluate('document.activeElement===document.querySelector("#reader-cover-line")');
    for (let n = 0; n < 120 && !onLine; n++) onLine = await tracedKey(p, 'Tab', '#reader-cover-line', trace);
    assert.ok(onLine, 'native Tab reaches the disclosure itself');
    const first = '#reader-cover .cover-payload .cover-src';
    // One ordinary next stop, not a traversal that can wrap around a broken disclosure.
    assert.ok(await tracedKey(p, 'Tab', first, trace), 'native Tab leaves the open cover line for its first source');
    if (legacy) return;
    assert.ok(await tracedKey(p, 'Tab', '#reader-cover-line', trace, 8), 'native Shift-Tab returns to the cover line');
    for (const [key, expanded] of [[' ', false], ['Enter', true], ['Enter', false], [' ', true]]) {
      assert.ok(await tracedKey(p, key, '#reader-cover-line', trace), 'disclosure activation keeps native focus');
      const seen = await p.evaluate(`(()=>{const line=document.querySelector('#reader-cover-line'),host=line.parentElement,
        sheet=document.getElementById(line.getAttribute('aria-controls'));
        return {tag:line.tagName,expanded:line.getAttribute('aria-expanded'),open:host.hasAttribute('open'),
          sheetShown:sheet.getClientRects().length>0,words:line.textContent,
          ring:getComputedStyle(line).outlineStyle}})()`);
      entry.states ??= []; entry.states.push({ key, ...seen });
      assert.deepEqual([seen.tag, seen.expanded, seen.open, seen.sheetShown], ['BUTTON', String(expanded), expanded, expanded]);
      assert.notEqual(seen.ring, 'none', 'keyboard disclosure focus stays visible');
    }
  };
  const beginFrames = p => p.evaluate(`(()=>{const frames=[];let running=true;
    const tick=()=>{if(!running)return;const host=document.querySelector('#reader-cover'),line=document.querySelector('#reader-cover-line'),
      sheet=document.querySelector('#reader-cover .dossier-cover'),thumb=document.querySelector('#thumb-source'),notice=document.querySelector('#reader-notice');
      frames.push({frame:frames.length,readerOpen:document.querySelector('#reader').open,coverHidden:host.hidden,coverShown:host.getClientRects().length>0,
        open:host.hasAttribute('open'),expanded:line.getAttribute('aria-expanded'),sheetShown:Boolean(sheet?.getClientRects().length),
        focused:document.activeElement.id,thumbDisabled:thumb.disabled,noticeHidden:notice.hidden,notice:notice.textContent,
        promiseState:sheet?.querySelector('.cover-promise')?.dataset.state??null});requestAnimationFrame(tick)};
    requestAnimationFrame(tick);window.promiseFrames=()=>{running=false;return frames}})()`);
  const endFrames = async (p, meta) => {
    const frames = await p.evaluate('window.promiseFrames()');
    observations.push({ name: 'item 717 acceptance frames', engine, ...meta, frames });
    assert.ok(frames.length > 0, 'the actual presentation had observed frames');
    for (const frame of frames) if (frame.readerOpen && frame.coverShown) {
      assert.equal(frame.expanded, String(frame.open), 'expanded semantics agree on every observed frame');
      assert.equal(frame.sheetShown, frame.open, 'only the open sheet is drawn on every observed frame');
      assert.equal(frame.promiseState, 'kept', 'acceptance never rewrites the promise on any observed frame');
    }
  };
  // Hold a real native thumb request before transport in both engines; no handler is called.
  const HOLD_THUMB = `(()=>{const f=window.fetch;window.promiseThumbQueue=[];window.promiseHold=true;
    window.fetch=function(input,init){let b;try{b=JSON.parse(init?.body)}catch{};
      if(b?.kind==='message.thumb'&&window.promiseHold)return new Promise(go=>window.promiseThumbQueue.push(()=>go(f.call(this,input,init))));
      return f.call(this,input,init)};
    window.releasePromiseThumb=()=>{window.promiseHold=false;for(const go of window.promiseThumbQueue.splice(0))go()}})()`;
  for (const stage of ['pending', 'refused', 'retried']) await check(`reading item 717 owner acceptance ${stage} keeps the committed promise and only the owner gives Done at 320 375 390 laptop light dark`, async () => {
    for (const [width, shape] of sizes) for (const theme of ['light', 'dark']) {
      const { topic, ids, promise } = await make(`owner-${stage}-${width}-${theme}`);
      assert.equal((await write(ids.root, { promises: [{ ...promise, state: 'kept' }] }, topic + '-kept')).status, 'committed');
      const device = shape.startsWith('phone') ? 'phone' : 'laptop';
      const p = await open(topic, shape, topic, ids.root, PROMISE_NATIVE_TRACE + HOLD_THUMB);
      try {
        const meta = { stage, width, theme };
        await scheme(p, theme); await centre(p, covers(ids.root)); await shot(p, `717-${stage}-page-before-${width}-${theme}`);
        await beginFrames(p); await sourceOpen(p, device, ids.root);
        await disclosureKeys(p, meta); await shot(p, `717-${stage}-reader-before-${width}-${theme}`);
        await p.evaluate('window.staleThumb=true');
        await activate(p, device, '#thumb-source');
        await until(() => p.evaluate('window.promiseThumbQueue.length===1'), 'the native thumb is queued before transport');
        assert.equal((await held(topic, ids.root)).payload.done, null, 'a pending acceptance is not Done');
        assert.equal((await measure(p, '#reader-cover .dossier-cover', width)).rows[0].state, 'kept');
        if (stage === 'pending') await shot(p, `717-owner-pending-${width}-${theme}`);
        await p.evaluate('window.releasePromiseThumb()');
        await until(() => p.evaluate('!document.querySelector("#reader-notice").hidden && document.querySelector("#reader-notice").textContent.length>0'), 'Core refusal is said by the real Reader');
        assert.equal((await held(topic, ids.root)).payload.done, null, 'refused acceptance changes nothing');
        assert.equal(await p.evaluate('document.querySelector("#reader").open'), true, 'refusal leaves the Reader open');
        if (stage === 'refused') await shot(p, `717-owner-refused-${width}-${theme}`);
        await disclosureKeys(p, { ...meta, after: 'refusal' });
        if (stage === 'retried') {
          await until(() => p.evaluate('!document.querySelector("#thumb-source").disabled'), 'refused thumb is ready for a native retry');
          await activate(p, device, '#thumb-source');
          await until(async () => (await held(topic, ids.root)).payload.done?.by === facts.actor, 'the owner gives Done through the retry gesture');
          await until(() => p.evaluate('!document.querySelector("#reader").open'), 'accepted thumb closes the Reader');
          await until(async () => (await measure(p, covers(ids.root), width))?.words.includes('done · your'), 'owner acceptance arrives on the cover');
          assert.equal((await held(topic, ids.root)).promises[0].state, 'kept');
          await centre(p, covers(ids.root)); await shot(p, `717-owner-retried-${width}-${theme}`);
        }
        await endFrames(p, meta);
        assert.deepEqual(p.errors, []);
      } finally { await p.close(); }
    }
  });

  await check('reading item 717 a nonowner native thumbs-up never accepts the kept promise payload at 320 375 390 laptop light dark', async () => {
    // Owner transfer is a real existing act, restored even on failure. No alternate actor's DOM is injected.
    await control({ method: 'outcome_change', sender: facts.actor, workspace_id: 'w1', member: 'fixture-other-person', present: true, operation_id: '717-other-owner-member' });
    await control({ method: 'outcome_change', sender: facts.actor, workspace_id: 'w1', owner: 'fixture-other-person', operation_id: '717-other-owner' });
    try {
      for (const [width, shape] of sizes) for (const theme of ['light', 'dark']) {
        const { topic, ids, promise } = await make(`nonowner-${width}-${theme}`);
        assert.equal((await write(ids.root, { promises: [{ ...promise, state: 'kept' }] }, topic + '-kept')).status, 'committed');
        const p = await open(topic, shape, topic, ids.root, PROMISE_NATIVE_TRACE), device = shape.startsWith('phone') ? 'phone' : 'laptop';
        try {
          const meta = { stage: 'nonowner', width, theme };
          await scheme(p, theme); await centre(p, covers(ids.root)); await shot(p, `717-nonowner-page-before-${width}-${theme}`);
          await beginFrames(p); await sourceOpen(p, device, ids.root);
          await disclosureKeys(p, meta); await shot(p, `717-nonowner-reader-before-${width}-${theme}`);
          assert.ok((await measure(p, '#reader-cover .dossier-cover', width)).words.includes('Waits on'));
          await activate(p, device, '#thumb-source');
          await until(() => p.evaluate('!document.querySelector("#reader").open'), 'the nonowner thumbs the source natively');
          assert.equal((await held(topic, ids.root)).payload.done, null, 'a nonowner thumb never accepts');
          await centre(p, covers(ids.root)); await shot(p, `717-nonowner-${width}-${theme}`);
          await endFrames(p, meta);
          assert.deepEqual(p.errors, []);
        } finally { await p.close(); }
      }
    } finally {
      await control({ method: 'outcome_change', sender: 'fixture-other-person', workspace_id: 'w1', owner: facts.actor, operation_id: '717-owner-restored' });
    }
  });

  for (const branch of ['empty', 'read-only', 'refused-edit']) await check(`reading item 717 ${branch} keeps the cover truth at 320 375 390 laptop light dark`, async () => {
    for (const [width, shape] of sizes) for (const theme of ['light', 'dark']) {
      const { topic, ids, promise } = await make(`${branch}-${width}-${theme}`);
      await write(ids.root, { promises: [promise] }, topic + '-promise');
      const p = await open(topic, shape, topic, ids.root), device = shape.startsWith('phone') ? 'phone' : 'laptop';
      let archived = false;
      try {
        await scheme(p, theme);
        if (branch === 'empty') {
          assert.equal((await write(ids.root, { stands: null, waiting: [], payload: null, promises: [] }, topic + '-clear')).status, 'committed');
          await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(covers(ids.root))})`), 'an empty cover draws no sheet');
          assert.equal(await held(topic, ids.root), null);
          await centre(p, card(ids.root));
        } else if (branch === 'refused-edit') {
          const before = await held(topic, ids.root);
          const refused = await write(ids.root, { promises: [{ ...promise, text: 'Invented words' }] }, topic + '-refused');
          assert.equal(refused.status, 'rejected');
          assert.deepEqual(await held(topic, ids.root), before, 'the refused edit changes no cover fact');
          const retry = await write(ids.root, { promises: [promise] }, topic + '-retried');
          assert.equal(retry.result.changed, false, 'a valid identical retry creates no history');
          await sourceOpen(p, device, ids.root);
          assert.equal((await measure(p, '#reader-cover .dossier-cover', width)).rows[0].state, 'promised');
        } else {
          await control({ method: 'targets', kind: 'outcome.end_set', args: { state: 'archived' }, operation_id: topic + '-archive' });
          archived = true;
          await sourceOpen(p, device, ids.root);
          const refused = await write(ids.root, { promises: [{ ...promise, state: 'kept' }] }, topic + '-closed-edit');
          assert.equal(refused.error?.code, 'OUTCOME_ARCHIVED');
          assert.equal((await held(topic, ids.root)).promises[0].state, 'promised');
          assert.equal((await measure(p, '#reader-cover .dossier-cover', width)).rows[0].state, 'promised', 'read-only cover stays readable');
        }
        await shot(p, `717-${branch}-${width}-${theme}`);
        assert.deepEqual(p.errors, []);
      } finally {
        await p.close();
        if (archived) await control({ method: 'targets', kind: 'outcome.end_set', args: { state: 'open' }, operation_id: topic + '-reopen' });
      }
    }
  });

  await check('reading item 717 native Reader disclosure mutant catches the stuck next stop and exact restored control passes', async () => {
    const markup = new URL('../web/index.html', import.meta.url), reader = new URL('../web/reader.mjs', import.meta.url);
    const files = [markup, reader], originals = await Promise.all(files.map(file => readFile(file, 'utf8')));
    const from = [
      '<div id="reader-cover" class="reader-cover" hidden><button id="reader-cover-line" type="button" aria-expanded="false" aria-controls="reader-cover-sheet"></button></div>',
      "    this.$('reader-cover-line').onclick = () => this.setCoverOpen(!this.$('reader-cover').hasAttribute('open'));\n",
    ];
    const to = ['<details id="reader-cover" class="reader-cover" hidden><summary id="reader-cover-line"></summary></details>', ''];
    const mutated = originals.map((s, n) => {
      assert.equal(s.split(from[n]).length, 2, 'one actual disclosure mutation target'); return s.replace(from[n], to[n]);
    });
    const hash = s => createHash('sha256').update(s).digest('hex');
    const record = { name: 'item 717 disclosure applied mutant', engine,
      original: originals.map(hash), mutated: mutated.map(hash), applied: false, restored: false };
    observations.push(record);
    const restart = async expected => {
      await control({ method: 'server_stop' }); const next = await control({ method: 'server_start' });
      assert.equal(next.origin, facts.origin); facts.token = next.token;
      for (let n = 0; n < files.length; n++) {
        assert.equal(await readFile(files[n], 'utf8'), expected[n], 'actual product bytes on disk');
        const served = await (await fetch(facts.origin + (n ? '/reader.mjs' : '/'))).text();
        if (n) assert.equal(served, expected[n], 'actual Reader module bytes served');
        else {
          // The server stamps HTML with its isolated fixture session. Only compare
          // the disclosure, never retain or print that generated session value.
          const disclosure = expected[n].match(/<(?:div|details) id="reader-cover"[^\n]+/)[0];
          assert.ok(served.includes(disclosure), 'the actual disclosure markup is served');
        }
      }
    };
    const probe = async (phase, legacy) => {
      const { topic, ids, promise } = await make(phase);
      assert.equal((await write(ids.root, { promises: [{ ...promise, state: 'kept' }] }, topic + '-kept')).status, 'committed');
      const p = await open(topic, 'laptop', topic, ids.root, PROMISE_NATIVE_TRACE);
      try {
        await sourceOpen(p, 'laptop', ids.root); await shot(p, `717-${phase}-reader-laptop-light`);
        await disclosureKeys(p, { stage: phase, width: 'laptop', theme: 'light' }, legacy);
      } finally { await p.close(); }
    };
    let failed;
    try {
      for (let n = 0; n < files.length; n++) await writeFile(files[n], mutated[n]);
      await restart(mutated); record.applied = true;
      try { await probe('disclosure-mutant', true); } catch (error) { failed = error; record.error = String(error); record.stack = error.stack; }
    } finally {
      for (let n = 0; n < files.length; n++) await writeFile(files[n], originals[n]);
      await restart(originals); record.restored = true; record.restoredHashes = (await Promise.all(files.map(file => readFile(file, 'utf8')))).map(hash);
      try { await probe('disclosure-restored', false); record.restoredControlPassed = true; }
      catch (error) { record.restoredControlPassed = false; record.restoredControlError = String(error); record.restoredControlStack = error.stack; }
    }
    if (engine === 'webkit') assert.match(String(failed), /native Tab leaves the open cover line for its first source/, 'restoring native details catches the product keyboard failure');
    else assert.equal(failed, undefined, 'Chromium remains the unchanged native-disclosure control');
    assert.equal(record.restoredControlPassed, true, record.restoredControlError);
  });

  await check('reading item 717 applied rendering mutants fail the same own case and restored bytes pass', async () => {
    const url = new URL('../web/dossier-cover.mjs', import.meta.url), original = await readFile(url, 'utf8');
    if (!original.includes('for (const promise of cover.promises ?? [])')) {
      observations.push({ name: 'item 717 final-only mutants excluded at unchanged product baseline' });
      return;
    }
    const restart = async () => {
      await control({ method: 'server_stop' });
      const next = await control({ method: 'server_start' });
      assert.equal(next.origin, facts.origin, 'owned server returns on its isolated origin');
      facts.token = next.token;
    };
    const promiseMutations = [
      { name: 'promise omitted', from: 'for (const promise of cover.promises ?? []) sheet.append', to: 'for (const promise of []) sheet.append' },
      { name: 'prior time not struck', from: "element(doc, 's', 'promise-prior')", to: "element(doc, 'span', 'promise-prior')" },
      { name: 'missed credited kept', from: "row.dataset.state = promise.state;", to: "row.dataset.state = promise.state === 'missed' ? 'kept' : promise.state;" },
      { name: 'source target too small', from: '  return node;\n}\n\nfunction promiseRow', to: "  node.style.minWidth = '24px'; node.style.minHeight = '24px'; return node;\n}\n\nfunction promiseRow" },
      { name: 'cover too wide', from: "sheet.setAttribute('role', 'note');", to: "sheet.style.width = 'calc(100% + 160px)'; sheet.setAttribute('role', 'note');" },
    ];
    for (const mutant of promiseMutations) {
      assert.equal(original.split(mutant.from).length, 2, mutant.name + ' has one real target');
      const changed = original.replace(mutant.from, mutant.to);
      const evidence = { name: 'item 717 mutant attempt', mutant: mutant.name,
        intendedFailure: false, restoredControlPassed: false, applied: false, mutatedServed: false, restoredServed: false,
        original_sha256: createHash('sha256').update(original).digest('hex'), mutated_sha256: createHash('sha256').update(changed).digest('hex') };
      observations.push(evidence);
      let failure;
      try {
        await writeFile(url, changed); assert.equal(await readFile(url, 'utf8'), changed, 'mutation applied');
        evidence.applied = true;
        await restart();
        const served = await (await fetch(facts.origin + '/dossier-cover.mjs')).text();
        assert.equal(served, changed, 'the owned server serves the actual mutated bytes');
        evidence.mutatedServed = true;
        await scenario('mutant-' + serial, false, false);
      } catch (error) { failure = error; Object.assign(evidence, { error: String(error), stack: error.stack }); }
      finally { await writeFile(url, original); assert.equal(await readFile(url, 'utf8'), original, 'original bytes restored'); await restart();
        evidence.restored_sha256 = createHash('sha256').update(await readFile(url)).digest('hex');
        assert.equal(await (await fetch(facts.origin + '/dossier-cover.mjs')).text(), original, 'restored bytes are served too');
        evidence.restoredServed = true; }
      const intended = { 'promise omitted': /recorded promised/, 'prior time not struck': /prior time is visibly struck/, 'missed credited kept': /recorded missed/, 'cover too wide': /cover fits within/, 'source target too small': /44px touch target/ };
      Object.assign(evidence, { error: String(failure), stack: failure?.stack,
        intendedFailure: intended[mutant.name].test(String(failure)) });
      // A wrong error remains red, but cannot prevent the exact restored control
      // from running and retaining its own result (the original fifth-mutant gap).
      try { await scenario('restored-' + serial, false, false); evidence.restoredControlPassed = true; }
      catch (error) { evidence.restoredControlError = String(error); evidence.restoredControlStack = error.stack; }
      assert.ok(failure, mutant.name + ' must fail');
      assert.match(String(failure), intended[mutant.name], 'the mutation fails the intended product assertion');
      assert.ok(evidence.restoredControlPassed, `the exact restored control passes: ${evidence.restoredControlError ?? ''}`);
    }
  });
}
