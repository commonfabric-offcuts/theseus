// Item 674: real browser selection, native input and real isolated Reader/Core.
// Mouse dragging in a touch-enabled desktop engine is not iOS handle/menu proof.
import assert from 'node:assert/strict';

export async function dossierSelectionQuoteChecks({ check, until, view, control, shot, facts, observations, engine }, h) {
  const { seed, open, becomes, centre, tap, card, words, closeReader } = h;
  const pill = '#dossier-quote-selection', phrase = 'Amber birds';
  const source = 'Amber birds rest here. A second sentence stays readable.';
  const visible = p => p.evaluate(`Boolean(document.querySelector('${pill}') && !document.querySelector('${pill}').hidden)`);
  const frames = p => p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
  const field = p => p.evaluate("document.querySelector('#writing-body').value");
  const closed = async p => assert.equal(await p.evaluate("document.querySelector('#reader').open"), false, 'selection alone opens nothing');
  const theme = (p, value) => p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
  const setup = async topic => {
    const ids = await seed(topic, [
      ['root', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'A dossier keeps its original message.' }],
      ['last', { sender: 'aim-core', reply_to: 'root', addressees: [facts.actor], body: source }],
    ]);
    return ids;
  };
  const show = async (p, device, ids, tone) => {
    await theme(p, tone);
    const toggle = `#messages .reply-stack[data-stack="${ids.root}"] > .stack-toggle`;
    await centre(p, toggle);
    if (device === 'laptop') await p.point(toggle); else await tap(p, toggle);
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(toggle)}).dataset.state === 'open'`), 'item 674 dossier open');
    await centre(p, words(ids.last)); await frames(p);
  };
  // Range is only a ruler. No addRange, DOM selection setter, handler call or synthetic event.
  const pointOf = (p, selector, text, edge) => p.evaluate(`(()=>{const w=document.querySelector(${JSON.stringify(selector)}),walk=document.createTreeWalker(w,4),t=${JSON.stringify(text)};
    for(let n=walk.nextNode();n;n=walk.nextNode()){const at=n.data.indexOf(t);if(at<0)continue;
      const r=document.createRange(),i=at+${edge === 'end' ? 't.length-1' : '0'};r.setStart(n,i);r.setEnd(n,i+1);
      const b=r.getBoundingClientRect(),x=${edge === 'end' ? 'b.right-.25' : 'b.left+.25'},y=b.top+b.height/2;
      return {x,y,hit:w.contains(document.elementFromPoint(x,y)),inside:x>0&&x<innerWidth&&y>0&&y<innerHeight};}
    return null})()`);
  const drag = async (p, from, to) => {
    assert.ok(from?.hit && to?.hit && from.inside && to.inside, 'native selection endpoints hit visible source words');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 });
    for (let n = 1; n <= 6; n++) await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x+(to.x-from.x)*n/6, y: from.y+(to.y-from.y)*n/6, button: 'left', buttons: 1 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 });
    await frames(p);
  };
  const select = async (p, id, text = phrase) => {
    // A drag starting inside an old selection starts native text dragging.
    // Clear it by an actual click on the inert workspace label first.
    await centre(p, '#workspace-name'); await p.point('#workspace-name');
    await centre(p, words(id)); await frames(p);
    await drag(p, await pointOf(p, words(id), text, 'start'), await pointOf(p, words(id), text, 'end'));
    assert.equal(await p.evaluate('getSelection().toString()'), text, 'native drag selected exact words');
  };
  const quoteState = async (topic, id) => (await view('editor_state', { source_ref: { kind: 'message', id }, topic_id: topic })).draft;
  const assertQuote = async (p, topic, id, body) => {
    await until(() => p.evaluate("document.querySelector('#reader').open"), 'item 674 native activation opened Reader');
    await becomes(() => field(p), body, 'existing Reader appends the exact selected words');
    let draft;
    await until(async () => { draft = await quoteState(topic, id); return draft?.body === body; }, 'item 674 exact writing is held by Core');
    assert.deepEqual(draft.quotes.map(q => [q.source, q.excerpt]), [[{ kind: 'message', id, revision: 1 }, phrase]], 'quote names the selected reply and displayed revision');
    assert.equal(await p.evaluate("document.activeElement === document.querySelector('#writing-body')"), true, 'native activation leaves the caret in writing');
    assert.deepEqual(await p.evaluate("(()=>{const f=document.querySelector('#writing-body');return [f.selectionStart,f.selectionEnd]})()"), [body.length,body.length]);
    return draft;
  };
  const runtime = async (phase, key, action) => {
    const receipt = await control({ method: 'item_674_runtime', phase });
    observations.push({ name: 'item 674 source phase start', key, ...receipt });
    try { return await action(receipt); }
    finally {
      const restored = await control({ method: 'item_674_runtime', phase: 'restored' });
      assert.equal(restored.restored, true); assert.deepEqual(restored.hashes, receipt.candidate_hashes);
      observations.push({ name: 'item 674 source restored', key, ...restored });
    }
  };
  const expectedRed = async (key, action) => {
    let failure;
    try { await action(); }
    catch (error) { if (!(error instanceof assert.AssertionError)) throw error; failure = error; }
    assert.ok(failure, key + ': the intended assertion must fail');
    observations.push({ name: 'item 674 expected red', key, error: failure.stack, actual: failure.actual, expected: failure.expected });
  };
  const withPage = async (key, device, topic, ids, tone, action) => {
    const p = await open(key, device, topic, ids.last);
    try { await show(p, device, ids, tone); await action(p); assert.deepEqual(p.errors, []); }
    finally { await p.close(); }
  };
  observations.push({ name: 'item 674 physical limits', engine,
    limits: 'Desktop native mouse selection and touch activation only. No physical iOS handles, Copy menu, software keyboard or system UI occlusion proof.' });

  for (const device of ['phone-320','phone-375','phone','laptop']) for (const tone of ['light','dark']) {
    const key = `item-674-${device}-${tone}`;
    await check(`reading item 674 exact quote and unchanged default ${device} ${tone}`, async () => {
      const topic = key, ids = await setup(topic);
      const startingIds=(await view('topic_messages',{topic_id:topic,direction:'before',limit:20})).items.map(m=>m.id).sort();
      await control({ method: 'private_writing', kind: 'draft', message_id: ids.last, topic_id: topic, operation_id: key+'-draft', body: 'My existing reply' });
      await control({ method: 'private_writing', kind: 'note', message_id: ids.last, topic_id: topic, operation_id: key+'-note', body: 'My private note' });
      // Exact pre-feature public bytes, not a reconstructed screenshot.
      await runtime('original', key, () => withPage(key+'-before', device, topic, ids, tone, async p => {
        await shot(p, key+'-before');
        if (device !== 'laptop') await expectedRed(key+'-original-selection-and-offer', async () => {
          await select(p, ids.last); assert.equal(await visible(p), true, 'a selected phone phrase offers Quote');
        });
        else {
          await drag(p, await pointOf(p, words(ids.last), phrase, 'start'), await pointOf(p, words(ids.last), phrase, 'end'));
          assert.equal(await p.evaluate('getSelection().toString()'), '', 'unchanged desktop card button has no native text selection');
        }
      }));
      await withPage(key+'-after', device, topic, ids, tone, async p => {
        if (device === 'laptop') {
          await drag(p, await pointOf(p, words(ids.last), phrase, 'start'), await pointOf(p, words(ids.last), phrase, 'end'));
          assert.equal(await p.evaluate('getSelection().toString()'), '', 'desktop card selection behavior is unchanged');
        } else await select(p, ids.last);
        await closed(p);
        assert.equal(await p.evaluate("matchMedia('(pointer:coarse)').matches"), device !== 'laptop', 'actual coarse-pointer media condition');
        assert.equal(await visible(p), device !== 'laptop', 'only the coarse-pointer selection offers the pill');
        await shot(p, key+'-selected');
        if (device === 'laptop') return;
        const geometry = await p.evaluate(`(()=>{const p=document.querySelector('${pill}'),b=p.getBoundingClientRect(),t=document.querySelector('#quote-selection');return {width:b.width,height:b.height,left:b.left,top:b.top,right:b.right,bottom:b.bottom,screen:innerWidth,screenH:innerHeight,label:p.textContent,template:t.textContent}})()`);
        const tolerancePx = .5; // CSS fractional layout rounding, not permission for a smaller target.
        assert.ok(geometry.width >= 44-tolerancePx && geometry.height >= 44-tolerancePx, JSON.stringify(geometry));
        assert.ok(geometry.left >= 0 && geometry.top >= 0 && geometry.right <= geometry.screen+tolerancePx && geometry.bottom <= geometry.screenH+tolerancePx);
        assert.equal(geometry.label, geometry.template, 'the actual composer pill markup is reused');
        await tap(p, pill);
        const body = 'My existing reply\n\n> '+phrase+'\n\n';
        const draft = await assertQuote(p, topic, ids.last, body);
        assert.deepEqual(draft.addressees, ['aim-core'], 'the current Reader destination stays with its owner');
        const state = await view('editor_state', { source_ref: { kind: 'message', id: ids.last }, topic_id: topic });
        assert.equal(state.note.body, 'My private note');
        await p.send('Input.insertText', { text: 'Still writing' });
        assert.equal(await field(p), body+'Still writing', 'native typing follows the quote without overwriting the draft');
        await shot(p, key+'-quoted');
        assert.deepEqual((await view('topic_messages', { topic_id: topic, direction: 'before', limit: 20 })).items.map(m=>m.id).sort(), startingIds, 'quote and typing send nothing');
        await closeReader(p, 'phone');
      });
    });
  }

  for (const device of ['phone-320','phone-375','phone']) for (const tone of ['light','dark']) {
    const key = `item-674-guards-${device}-${tone}`;
    await check(`reading item 674 empty cross-message hidden folded repainted selections ${device} ${tone}`, async () => {
      const topic=key, ids=await setup(topic);
      await withPage(key, device, topic, ids, tone, async p => {
        assert.equal(await visible(p), false, 'empty selection offers nothing'); await shot(p,key+'-empty');
        await select(p,ids.last); assert.equal(await visible(p),true);
        // Native selection across message boundaries, even though all words are visible.
        await centre(p, words(ids.root));
        await drag(p,await pointOf(p,words(ids.root),'A dossier','start'),await pointOf(p,words(ids.last),phrase,'end'));
        assert.ok((await p.evaluate('getSelection().toString()')).includes(phrase));
        assert.equal(await visible(p),false,'cross-message selection has no quote'); await closed(p); await shot(p,key+'-cross');
        await select(p,ids.last);
        // DOM visibility perturbation is a guard input, not a claimed native fold gesture.
        await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.last))}).hidden=true`); await frames(p);
        assert.equal(await visible(p),false,'hidden source invalidates selection'); await shot(p,key+'-hidden');
        await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.last))}).hidden=false`); await frames(p);
        assert.equal(await visible(p),false,'making the source visible does not revive invalidated words');
        await select(p,ids.last);
        await control({ method:'agent_edit',sender:'aim-core',message_id:ids.last,revision:1,operation_id:key+'-edit',body:'New words replace the selected revision.' });
        await until(()=>p.evaluate(`document.querySelector(${JSON.stringify(words(ids.last))}).textContent==='New words replace the selected revision.'`),'item 674 source repaint arrived');
        assert.equal(await visible(p),false,'repainted selection has no stale quote'); await closed(p); await shot(p,key+'-repainted');
        await select(p,ids.last,'New words');
        await control({method:'stack_act',sender:facts.actor,kind:'message.fold',message_id:ids.last,operation_id:key+'-fold',args:{folded:true}});
        await until(()=>p.evaluate(`document.querySelector(${JSON.stringify(card(ids.last))}).dataset.folded==='true'`),'source folded through existing Core act');
        assert.equal(await visible(p),false,'folded selection offers nothing'); await closed(p); await shot(p,key+'-folded');
      });
    });
  }

  await check('reading item 674 wrong quote source mutant is caught and exact source restored', async () => {
    const key='item-674-mutant',topic=key,ids=await setup(topic);
    await runtime('wrong-quote',key,async receipt=>{
      assert.equal(receipt.mutation.count,1);assert.notEqual(receipt.mutation.before,receipt.mutation.after);
      await withPage(key,'phone',topic,ids,'light',async p=>{
        await select(p,ids.last);assert.equal(await visible(p),true);await tap(p,pill);
        await until(()=>p.evaluate("document.querySelector('#reader').open && document.querySelector('#writing-body').value.includes('Wrong words')"),'applied quote mutant reached writing');
        await expectedRed(key,async()=>assert.equal(await field(p),'> '+phrase+'\n\n','exact words reject wrong quote mutant'));
        await shot(p,key+'-wrong-quote');
      });
    });
    const cleanTopic=key+'-restored',clean=await setup(cleanTopic);
    await withPage(key+'-restored','phone',cleanTopic,clean,'light',async p=>{
      await select(p,clean.last);await tap(p,pill);await assertQuote(p,cleanTopic,clean.last,'> '+phrase+'\n\n');await shot(p,key+'-restored');
    });
  });

  for (const tone of ['light','dark']) await check(`reading item 674 keyboard activation and cancelled native press ${tone}`,async()=>{
    const key='item-674-key-'+tone,topic=key,ids=await setup(topic);
    await withPage(key,'phone',topic,ids,tone,async p=>{
      await select(p,ids.last);assert.equal(await visible(p),true);
      if(engine==='chrome'){
        const b=await p.box(pill),x=b.x+b.width/2,y=b.y+b.height/2;
        await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
        await p.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await frames(p);
        await closed(p);assert.equal((await quoteState(topic,ids.last))?.quotes?.length??0,0,'cancelled native press inserts no quote');
        await shot(p,key+'-cancelled');
      } else observations.push({name:'item 674 unreached native cancellation',engine,reason:'existing WebKit adapter exposes whole taps only; no native touchCancel or drag'});
      await select(p,ids.last);
      let reached=false;
      for(let n=0;n<80;n++){
        await p.key('Tab');
        if(await p.evaluate(`document.activeElement===document.querySelector('${pill}')`)){reached=true;break;}
      }
      assert.equal(reached,true,'native Tab reaches offered Quote');await shot(p,key+'-focused');
      await p.key('Enter');await assertQuote(p,topic,ids.last,'> '+phrase+'\n\n');await shot(p,key+'-activated');
    });
  });

  for(const state of ['busy','refused','error']) await check(`reading item 674 ${state} existing opening owner and recovered activation`,async()=>{
    const key='item-674-'+state,topic=key,ids=await setup(topic),hold=key+'-hold';
    let held=false;
    try{
      await withPage(key,'phone',topic,ids,'light',async p=>{
        await select(p,ids.last);assert.equal(await visible(p),true);
        const since=(await control({method:'admission_events'})).next;
        if(state==='busy'){
          await control({method:'read_hold',hold_id:hold,name:'editor_state',read_class:'foreground',phase:'callback',count:1});held=true;
        }else await control({method:'read_fault',name:'source',read_class:'foreground',count:1,status:state==='refused'?403:503,body:{error:{code:state==='refused'?'not_allowed':'unavailable',message:'The selected message cannot be opened right now.',retryable:state!=='refused'}}});
        await tap(p,pill);
        if(state==='busy'){
          await until(async()=>(await control({method:'admission_events',after:since})).events.some(e=>e.event==='hold-enter'&&e.hold_id===hold),'actual foreground opening is interrupted');
          assert.equal(await visible(p),false,'pending quote offers no second action');await shot(p,key+'-busy');
          await control({method:'read_release',hold_id:hold});held=false;
          await assertQuote(p,topic,ids.last,'> '+phrase+'\n\n');await shot(p,key+'-recovered');
        }else{
          await until(()=>p.evaluate("document.querySelector('#app-status').textContent.includes('cannot') || document.querySelector('#reader-notice').textContent.includes('cannot')"),'opening refusal is visible');
          await closed(p);assert.equal((await quoteState(topic,ids.last))?.quotes?.length??0,0,'failed open never inserts quote');await shot(p,key+'-'+state);
          await control({method:'read_fault_clear'});
          await select(p,ids.last);await tap(p,pill);await assertQuote(p,topic,ids.last,'> '+phrase+'\n\n');await shot(p,key+'-recovered');
        }
      });
    }finally{if(held)await control({method:'read_release',hold_id:hold});await control({method:'read_fault_clear'});}
  });
}
