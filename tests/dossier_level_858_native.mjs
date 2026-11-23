import assert from 'node:assert/strict';

// Prepared below the shared slot. Run only through the existing isolated
// topic-reading fixture after its explicit clean handoff.
// Input goes through the native engine adapter (protocol pointer/touch/keys),
// never DOM handler invocation. This makes no physical-device claim.
export async function dossierLevel858Checks(
  { check, until, view, control, facts, shot, observations, engine },
  { seed, open, centre, press, card }
) {
  for (const device of ['laptop', 'phone']) {
    await check(`reading item 858 ${device}: dossier choice survives reload and a second page`, async () => {
      const topic = `level858-${device}`;
      const ids = await seed(topic, [
        ['root', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'Persist this dossier choice.' }],
        ['first', { sender: 'aim-ux', join: true, reply_to: 'root', addressees: [facts.actor], body: 'A reply folded independently of the dossier.' }],
        ['middle', { sender: 'aim-core', reply_to: 'root', addressees: [facts.actor], body: 'An ordinary earlier answer with its own visible card.' }],
        ['last', { sender: 'aim-core', reply_to: 'root', addressees: [facts.actor], body: 'The latest answer stays readable.' }],
      ].map(([key, args]) => [key, { ...args, read: true,
        ...(args.reply_to ? { reply_without_quote: 'An isolated reading-state reply for858' }
          : { divergence_reason: 'Separate isolated dossier-level858 reading check' }) }]));
      const section = `#messages .reply-stack[data-stack="${ids.root}"]`, toggle = section + ' > .stack-toggle';
      const capture = `(()=>{window.level858=[];const f=window.fetch;window.fetch=async function(input,init){
        let request;try{request=JSON.parse(init?.body??'null')}catch{};
        const answer=await f.call(this,input,init);
        if(request?.kind==='stack.level'){const response=await answer.clone().json();window.level858.push({request,response})}
        return answer;
      }})()`;
      const p = await open(`level858-${device}-first`, device, topic, ids.root, capture);
      const level = pg => pg.evaluate(`document.querySelector(${JSON.stringify(section)})?.dataset.fold`);
      const visible = (pg, id) => pg.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(id))})?.getClientRects().length)`);
      const position = async () => (await view('stack_positions', { topic_id: topic, message_ids: [ids.last] })).items[0].stack_position;
      await until(async () => await level(p) === 'open', 'ordinary dossier begins expanded');
      assert.equal(await visible(p, ids.middle), true, 'an ordinary earlier reply is visibly expanded');
      const initialPosition = await position();
      const foldedMessage = await control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold',
        message_id: ids.first, operation_id: topic + '-individual-fold', args: { folded: true } });
      assert.equal(foldedMessage.status, 'committed');
      await centre(p, toggle); await press(p, device, toggle);
      await until(async () => await level(p) === 'folded', 'explicit native collapse is drawn');
      await until(async () => !(await visible(p, ids.middle)) && await visible(p, ids.last),
        'collapse visibly hides earlier read replies while retaining the latest');
      await until(() => p.evaluate('window.fetchesOut === 0'), 'collapse request settles before leaving the page');
      const collapseRaw = await p.evaluate('window.level858');
      observations.push({ name: `858 ${device} actual collapse`, engine, actor: facts.actor, topic, ids,
        userAgent: await p.evaluate('navigator.userAgent'),
        initialPosition, collapsedPosition: await position(), level: await level(p),
        middleVisible: await visible(p, ids.middle), latestVisible: await visible(p, ids.last), collapseRaw });

      // Actual-base visible red comes before inspecting the new API shape:
      // on336 the same control collapses locally, then reload loses it.
      const origin = await p.evaluate('(window.level858Origin??=performance.timeOrigin)');
      await p.send('Page.reload');
      await until(() => p.evaluate(`(window.level858Origin??=performance.timeOrigin)!==${origin} && document.body?.dataset.ready==='true' && Boolean(document.querySelector(${JSON.stringify(card(ids.root))}))`).catch(() => false),
        'the new document is ready after reload');
      const afterReload = await level(p);
      observations.push({ name: `858 ${device} actual reload`, engine, level: afterReload,
        middleVisible: await visible(p, ids.middle), latestVisible: await visible(p, ids.last) });
      await shot(p, `level858-${device}-reloaded`);
      assert.equal(afterReload, 'folded', '858 a reload restores the explicit collapsed choice from Core');
      assert.equal(await visible(p, ids.middle), false, 'reload keeps earlier read material visibly collapsed');
      const held = await position();
      assert.equal(held.root_id, ids.root); assert.equal(held.level, 'folded'); assert.equal(held.level_revision, 1);

      const q = await open(`level858-${device}-second`, device, topic, ids.root, capture);
      assert.equal(await level(q), 'folded', 'a fresh page session restores the same server choice');
      if (device === 'laptop') {
        await q.evaluate(`document.querySelector(${JSON.stringify(toggle)}).focus()`);
        await q.key('ArrowRight');
      } else { await centre(q, toggle); await press(q, device, toggle); }
      await until(async () => (await position()).level === 'open', 'the second page commits its explicit open choice');
      if (device === 'laptop') {
        await q.key('z', 4);
        await until(async () => (await position()).level === 'folded', 'native Command-Z restores the prior stored preference');
        const undone = await position();
        await q.key('ArrowRight');
        await until(async () => (await position()).level === 'open', 'native arrow opens again after Undo');
        observations.push({ name: '858 laptop native Undo and next choice', undone, reopened: await position() });
      }
      await p.send('Page.bringToFront');
      await until(async () => await level(p) === 'open', 'the first page learns the second session choice');
      assert.equal(await visible(p, ids.middle), true, 'the other session\'s open choice visibly reveals earlier replies');

      // Restore real Core writing, then type through the engine while another
      // session changes the dossier preference. A refresh must keep the exact
      // writing, caret, focus and visible composer, even inside a collapsed run.
      const draftBody = 'Unsent858 writing — exact.\nTwo  spaces.';
      const savedWriting = await control({ method: 'private_writing', topic_id: topic,
        message_id: ids.middle, kind: 'draft', sender: 'person', body: draftBody,
        operation_id: topic + '-writing' });
      assert.equal(savedWriting.status, 'committed');
      const documentBeforeWriting = await p.evaluate('performance.timeOrigin');
      await p.send('Page.reload');
      const field = `#reply-${ids.middle}-writing-body`;
      await until(() => p.evaluate(`performance.timeOrigin!==${documentBeforeWriting} && document.querySelector(${JSON.stringify(field)})?.getClientRects().length>0`),
        'saved inline writing is visible after reload');
      assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(field)}).value`), draftBody);
      await centre(p, field); await press(p, device, field); await p.key('a', 4);
      const typed = draftBody + '\nTyped through the native input adapter.';
      await p.send('Input.insertText', { text: typed });
      const writing = () => view('editor_state', { source_ref: { kind: 'message', id: ids.middle }, topic_id: topic });
      await until(async () => (await writing()).draft?.body === typed, 'native writing reaches real Core');
      const editor = () => p.evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(field)});return {body:f.value,active:document.activeElement.id,start:f.selectionStart,end:f.selectionEnd,visible:Boolean(f.getClientRects().length)}})()`);
      const beforeRefresh = await editor();
      const remoteChoice = await control({ method: 'stack_act', sender: facts.actor, kind: 'stack.level',
        message_id: ids.root, operation_id: topic + '-remote-while-writing', args: { level: 'folded' } });
      assert.equal(remoteChoice.status, 'committed');
      await until(async () => await level(p) === 'folded', 'remote preference reaches the writing page');
      assert.deepEqual(await editor(), beforeRefresh, 'remote hydration preserves visible writing, focus and caret');
      assert.equal((await writing()).draft.body, typed);
      const restoreOpen = await control({ method: 'stack_act', sender: facts.actor, kind: 'stack.level',
        message_id: ids.root, operation_id: topic + '-remote-open', args: { level: 'open' } });
      assert.equal(restoreOpen.status, 'committed');
      await until(async () => await level(p) === 'open', 'restored open preference reaches the page');
      observations.push({ name: `858 ${device} writing survives remote level`, savedWriting, typed,
        beforeRefresh, afterRefresh: await editor(), remoteChoice, restoreOpen, editorState: await writing() });

      const beforeOther = await position();
      const theirs = await control({ method: 'stack_act', sender: 'aim-core', kind: 'stack.level',
        message_id: ids.root, operation_id: topic + '-other-reader', args: { level: 'folded' } });
      assert.equal(theirs.status, 'committed');
      const otherActs = await control({ method: 'acts_as', reader: 'aim-core', topic_id: topic });
      const theirRoot = otherActs.acts.items.find(item => item.message_id === ids.root);
      assert.equal(theirRoot.acts.level, 'folded', 'the other reader has their own stored choice');
      const ours = await position();
      assert.equal(ours.level, 'open'); assert.equal(ours.level_revision, beforeOther.level_revision);
      assert.equal(await level(p), 'open', 'another reader\'s choice changes no presentation here');
      const ourActs = await view('message_acts', { topic_id: topic });
      assert.equal(ourActs.items.find(item => item.message_id === ids.first).acts.folded, true,
        'dossier open and collapse never undo a separate message fold');
      const raw = await q.evaluate('window.level858');
      assert.ok(raw.some(item => item.request.target.message_id === ids.root && item.request.kind === 'stack.level' &&
        item.response.status === 'committed'), 'retain actual foreground command and Core receipt');
      observations.push({ name: `858 ${device} Core and native input`, engine, actor: facts.actor,
        topic, ids, input: device === 'laptop' ? 'protocol pointer collapse and ArrowRight open, with programmatic button focus as setup' : 'protocol touch collapse/open',
        firstSaved: held, own: ours, other: otherActs, messageActs: ourActs, collapseRaw, raw });
      await shot(p, `level858-${device}-remote-open`);
    });
  }
}
