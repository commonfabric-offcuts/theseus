// Prepared native cases. Merely importing this file starts nothing.
import assert from 'node:assert/strict';

export const tolerance781 = Object.freeze({ viewportEdgePx: 2, overflowPx: 1, paintedPx: .5, opacity: .02 });
export function assertLanding781(state, id) {
  const { viewportEdgePx, overflowPx, paintedPx } = tolerance781;
  assert.equal(state.reader, false, 'Reader remains closed');
  assert.equal(state.active, id, 'same exact message receives keyboard selection');
  assert.ok(state.lit.includes(id), 'same exact message is lit');
  assert.ok(state.width > paintedPx && state.height > paintedPx, 'paintedPx=.5: message has a real box');
  assert.ok(state.top >= -viewportEdgePx && state.top < state.viewportHeight - viewportEdgePx,
    'viewportEdgePx=2: selected message starts inside the viewport');
  assert.ok(state.right <= state.viewportWidth + overflowPx && state.left >= -overflowPx,
    'overflowPx=1: selected card fits horizontally');
}

// Instruments only, never dispatches a synthetic event. The driver supplies
// native pointer/touch. The animation hook records the real endpoint before
// the product removes its node; no sleep substitutes for animation.finished.
const instrumentation781 = `(()=>{
  window.reads781=[];window.checks781=[];window.inputs781=[];
  document.addEventListener('pointerdown',e=>{if(e.target.closest?.('.stack-new-action'))window.inputs781.push(e.pointerType)},true);
  const fetch781=window.fetch;window.fetch=async function(input,init){
    let b;try{b=JSON.parse(init?.body)}catch{};
    const answer=await fetch781.call(this,input,init);
    if(b?.kind==='topic.read_through')window.reads781.push({envelope:b,receipt:await answer.clone().json()});return answer;};
  const animate781=Element.prototype.animate;Element.prototype.animate=function(frames,options){
    const animation=animate781.call(this,frames,options);
    if(this.classList.contains('stack-new-action')){const fact={words:this.textContent,done:false,connected:this.isConnected,duration:options.duration};window.checks781.push(fact);
      animation.finished.then(()=>Object.assign(fact,{done:true,endpointOpacity:Number(getComputedStyle(this).opacity),playState:animation.playState,endpointConnected:this.isConnected}),()=>{fact.cancelled=true})};return animation;};
})()`;

export async function dossierNew781Checks({ check, until, view, control, shot, facts, observations, engine }, { seed, open, centre, press, card }) {
  for (const [device, width, input] of [['phone-320', 320, 'phone'], ['phone', 390, 'phone'], ['laptop', 1280, 'laptop']]) for (const theme of ['light', 'dark']) {
    for (const shape of ['head', 'replies', 'mixed', 'stale']) await check(`reading item 781 ${shape} ${width} ${theme}`, async () => {
      const topic = `new-781-${shape}-${width}-${theme}`, long = 'Newest exact words. ' + 'A full paragraph of the new reply. '.repeat(60) + 'Exact endpoint.';
      const said = [['head', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'Original exact words.', read: shape === 'replies' }]];
      // Earlier messages boundary, with read replies before the new ones.
      if (shape === 'replies') {
        said.push(['older', { sender: 'aim-core', reply_to: 'head', addressees: [facts.actor], body: 'older exact words.' }]);
        for (let n = 0; n < 9; n++) said.push(['read' + n, { sender: 'aim-ux', join: n === 0, reply_to: 'head', addressees: ['aim-core'], body: `Read reply ${n}` }]);
      }
      if (shape === 'replies' || shape === 'mixed') for (const name of shape === 'replies' ? ['middle', 'newest'] : ['older', 'middle', 'newest']) said.push([name,
        { sender: 'aim-core', reply_to: 'head', addressees: [facts.actor], body: name === 'newest' ? long : `${name} exact words.` }]);
      else said.push(['readReply', { sender: 'aim-ux', join: true, reply_to: 'head', addressees: ['aim-core'], body: 'A reply between other agents.' }]);
      const ids = await seed(topic, said);
      const rows = (await view('topic_messages', { topic_id: topic, limit: 50 })).items;
      if (shape === 'replies') await control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold', message_id: ids.middle,
        operation_id: topic + '-fold-middle', args: { folded: true } });
      const p = await open(topic, device, topic, ids.head, instrumentation781, '/?topic=' + topic,
        q => q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }));
      const section = `#messages .reply-stack[data-stack="${ids.head}"]`, mark = section + ' .stack-head .stack-new-action';
      const snapshot = () => p.evaluate(`(()=>{const ids=${JSON.stringify(ids)},e=document.querySelector(${JSON.stringify(section)}),c=document.activeElement?.closest('[data-id]'),b=c?.getBoundingClientRect();return {
        reader:document.querySelector('#reader').open,active:c?.dataset.id,lit:[...e.querySelectorAll('.lit[data-id]')].map(x=>x.dataset.id),
        mark:e.querySelector('.stack-new-action')?.textContent??null,order:[...e.querySelectorAll('.message-card[data-id]')].map(x=>x.dataset.id),
        words:c?.querySelector('.message-preview')?.textContent??'',writing:[...document.querySelectorAll('textarea')].map(x=>[x.id,x.value]),
        top:b?.top,left:b?.left,right:b?.right,width:b?.width,height:b?.height,viewportWidth:innerWidth,viewportHeight:innerHeight,
        reads:window.reads781,inputs:window.inputs781,checks:window.checks781}})()`);
      if (shape === 'stale') {
        await until(async () => (await snapshot()).mark === 'New', 'fixture starts with rendered head New');
        // Deliberately stale view fixture: update the actual retained message
        // predicate without repainting its tab. Product code and native input
        // still own the action and animation.
        await p.evaluate(`(async()=>{const script=[...document.scripts].find(s=>s.src.includes('/app.mjs'));
          const module=await import(new URL('reply-stacks.mjs',script.src).href),state=module.stackState(document.querySelector('#messages'));
          const stack=state.stacks.find(s=>s.id===${JSON.stringify(ids.head)});for(const item of [stack.head,...stack.replies])item.unread=false;})()`);
        await centre(p, mark); await press(p, input, mark);
        await until(async () => (await snapshot()).checks.some(c => c.done), 'actual stale check animation finishes');
        await p.evaluate('new Promise(done=>requestAnimationFrame(done))');
        const result = await snapshot(), animation = result.checks.at(-1);
        assert.equal(animation.words, '✓'); assert.equal(animation.connected, true); assert.equal(animation.cancelled, undefined);
        assert.equal(animation.playState, 'finished');
        assert.ok(Math.abs(animation.endpointOpacity) <= tolerance781.opacity, 'endpoint opacity tolerance .02');
        assert.equal(result.mark, null); assert.equal(result.reader, false); assert.equal(result.inputs.length, 1);
        observations.push({ item: 781, engine, width, theme, shape, result, fixture: 'stale retained predicate, actual native press and animation' });
        await shot(p, `item-781-stale-${width}-${theme}-endpoint`); return;
      }
      const before = await snapshot(), coreBefore = await view('topic_messages', { topic_id: topic, limit: 50 });
      const expected = shape === 'head' ? [ids.head] : [ids.newest, ids.middle, ids.older, ...(shape === 'mixed' ? [ids.head] : [])];
      const sequence = new Map(rows.map(row => [row.id, row.seq]));
      assert.deepEqual(expected.map(id => sequence.get(id)), expected.map(id => sequence.get(id)).sort((a, b) => b - a));
      for (let n = 0; n < expected.length; n++) {
        await centre(p, mark); await press(p, input, mark);
        await until(async () => (await snapshot()).active === expected[n] && (await snapshot()).mark ===
          (n === expected.length - 1 ? null : shape === 'mixed' ? 'New' : ` · ${expected.length - n - 1} new`), 'one explicit act selects and consumes the exact newest New');
        const result = await snapshot(); assertLanding781(result, expected[n]);
        assert.deepEqual(result.order, before.order, 'source order is unchanged'); assert.deepEqual(result.writing, before.writing, 'writing is unchanged');
        assert.equal(result.words, said.find(([name]) => ids[name] === expected[n])[1].body, 'whole exact text is shown in feed');
        assert.ok(result.reads.some(({ envelope, receipt }) => envelope.args.from_seq === sequence.get(expected[n]) && envelope.args.seq === sequence.get(expected[n]) && receipt.recorded === true && receipt.status === 'committed'));
        const coreAfter = await view('topic_messages', { topic_id: topic, limit: 50 });
        assert.equal(coreAfter.items.find(row => row.id === expected[n]).unread, false, 'Core owns read state');
        observations.push({ item: 781, engine, width, theme, shape, n, chosen: expected[n], result, coreBefore, coreAfter, nativeInput: input });
        await shot(p, `item-781-${shape}-${width}-${theme}-${n}`);
      }
      assert.equal((await snapshot()).inputs.length, expected.length, 'each native press reaches its header action once');
    });
  }
}
