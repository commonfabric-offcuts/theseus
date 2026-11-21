import assert from 'node:assert/strict';

export async function dossierCommandDown705Checks(
  { check, until, view, control, facts, shot, observations, engine },
  { seed, open, centre, press, card, words, into }
) {
  const init = `(()=>{window.commands705=[];const f=fetch;window.fetch=function(input,options){let b;try{b=JSON.parse(options?.body)}catch{};if(b?.kind)commands705.push(b);return f.call(this,input,options)}})()`;
  for (const surface of ['topic', 'conversation']) for (const device of ['laptop', 'phone']) for (const theme of ['light', 'dark']) {
    const name = `reading item 705 ${surface} ${device} ${theme}: Command Down archives Return selection`;
    await check(name, async () => {
      const prefix = `command705-${surface}-${device}-${theme}`, phases = [];
      let topic = prefix, ids = {}, p;
      const said = [
        ['other', { sender: 'aim-core', join: true, body: 'An unrelated dossier stays above More.' }],
        ['root', { sender: 'aim-core', body: 'The dossier selected by the shortcut.' }],
        ['child', { sender: 'aim-core', reply_to: 'root', reply_without_quote: 'Child selection must archive its actual dossier.', body: 'A message inside the selected dossier.' }],
      ].map(([key, more]) => [key, { ...more, addressees: [facts.actor], read: true, divergence_reason: 'Independent705 source '+key }]);
      if (surface === 'topic') ids = await seed(topic, said);
      else {
        const conversation = await control({ method: 'coordinator', operation_id: prefix + '-coordinator', coordinator: 'aim-core' });
        topic = conversation.topic_id;
        for (const [key, more] of said) {
          const { reply_to, join, ...rest } = more;
          const answer = await control({ method: 'agent_message', operation_id: prefix + '-' + key, topic_id: topic, whole_topic: !reply_to,
            ...rest, post_args: { divergence_reason: 'Independent705 Conversation source ' + key, addressees: [facts.actor], intent: 'tell' },
            ...(reply_to ? { reply_to: ids[reply_to] } : {}) });
          ids[key] = answer.result.message_id;
        }
      }
      const position = async (id, actor = null) => {
        const args = { topic_id: topic, message_ids: [id] };
        const answer = actor ? await control({ method: 'agent_view', actor, name: 'stack_positions', args }) : await view('stack_positions', args);
        return answer.items[0].stack_position;
      };
      const changes = () => p.evaluate("window.commands705.filter(c=>['stack.aside','stack.place','stack.join'].includes(c.kind))");
      const key = () => p.key('ArrowDown', 4);
      const hover = async selector => {
        // A stationary pointer after Undo deliberately does not change selection.
        await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
        await p.point(selector, 'move');
      };
      const selected = id => until(() => p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(card(id))})`), 'native input selects exactly the message Return would answer');
      const toggle = () => `#messages .reply-stack[data-stack="${ids.root}"] > .stack-toggle`;
      const openDossier = async () => {
        await centre(p, toggle());
        if (await p.evaluate(`document.querySelector(${JSON.stringify(toggle())})?.dataset.state!=='open'`)) await press(p, device, toggle());
        await until(() => p.evaluate(`document.querySelector(${JSON.stringify(toggle())})?.dataset.state==='open'`), 'native chevron opens the dossier');
      };
      const selectMessage = async () => {
        const selector = device === 'phone' ? card(ids.child) + ' .message-time' : words(ids.child);
        await centre(p, selector);
        if (device === 'phone') await press(p, device, selector); else await hover(selector);
        await selected(ids.child);
      };
      const archived = async label => {
        const before = (await changes()).length;
        await key();
        await until(async () => (await changes()).length > before, 'native shortcut sends an existing dossier command');
        const sent = (await changes()).slice(before);
        assert.equal(sent[0]?.kind, 'stack.aside', 'Command Down archives; it does not reorder');
        assert.equal(sent[0].target.message_id, ids.root, 'message selection resolves its containing dossier');
        assert.equal(sent.length, 1, 'one key act sends exactly one command');
        await until(async () => (await position(ids.root)).below === true, 'Core confirms the dossier below More');
        assert.equal((await position(ids.child)).root_id, ids.root);
        assert.equal((await position(ids.child)).below, true);
        assert.equal((await position(ids.other)).below, false);
        assert.equal((await position(ids.root, 'aim-core')).below, false, 'the move remains personal');
        await until(() => p.evaluate("document.activeElement?.matches('.stack-more')"), 'focus stays on actual More after the archive redraw');
        phases.push(label);
        await p.key('z', 4);
        await until(async () => (await position(ids.root)).below === false, 'real Command Z restores the whole dossier');
        phases.push('Undo ' + label);
      };
      try {
        p = await open(prefix, device, topic, ids.other, init, surface === 'conversation' ? '/?conversation=w1' : undefined,
          q => q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }));
        assert.equal(await p.evaluate("document.activeElement===document.body||document.activeElement?.id==='main'"), true, 'initial page has no feed selection');
        const beforeNone = (await changes()).length; await key();
        assert.equal((await changes()).length, beforeNone, 'nothing selected does nothing');
        phases.push('no-selection negative');
        await openDossier(); await selectMessage(); await archived(device === 'phone' ? 'last native touch selects child' : 'native hover selects child');

        // Arrow selection begins on the actual dossier control, then selects
        // its next message exactly as Return's owner does.
        await centre(p, toggle()); await press(p, device, toggle()); await p.key('ArrowDown');
        await selected(ids.child); await archived('native Arrow Down selects child');

        await centre(p, toggle());
        if (device === 'phone') await press(p, device, toggle()); else await hover(toggle());
        await until(() => p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(toggle())})`), 'dossier header owns its Return selection');
        await archived('dossier header selection');

        // The existing personal-star hold must stop the same shortcut too.
        const star = await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.child,
          operation_id: prefix + '-star', args: { starred: true } });
        assert.equal(star.status, 'committed');
        await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(`#messages .reply-stack[data-stack="${ids.root}"] .stack-star`)}))`), 'dossier reads the saved star');
        await centre(p, toggle()); if (device === 'phone') await press(p, device, toggle()); else await hover(toggle());
        const beforeStar = (await changes()).length; await key();
        assert.equal((await changes()).length, beforeStar, 'starred dossier does not emit an archive command');
        assert.equal((await position(ids.root)).below, false);
        phases.push('star hold negative');

        const writing = 'Unsent writing keeps its words and destination.';
        await until(() => p.evaluate("Boolean(document.querySelector('#inline-writing-body')?.getClientRects().length)"), 'new-message writing is present');
        await into(p, device, '#inline-writing-body'); await p.key('a', 4); await p.send('Input.insertText', { text: writing });
        const beforeWriting = (await changes()).length; await key();
        assert.equal((await changes()).length, beforeWriting, 'writing keeps Command Down');
        assert.equal(await p.evaluate("document.querySelector('#inline-writing-body').value"), writing);
        await until(async () => (await view('editor_state', { source_ref: { kind: 'topic', id: topic }, topic_id: topic })).draft?.body === writing, 'exact unsent writing reaches Core');
        phases.push('writing negative with exact Core draft');
        await shot(p, 'reading-item705-' + surface + '-' + device + '-' + theme);
        assert.deepEqual(p.errors, []);
        observations.push({ name, engine, phases, input: device === 'phone' ? 'native emulated touch plus Command keyboard events' : 'native mouse and keyboard' });
      } catch (error) {
        observations.push({ name, phases, error: error.message });
        if (p) await shot(p, 'reading-item705-' + surface + '-' + device + '-' + theme + '-failure');
        throw error;
      } finally { if (p) await p.close(); }
    });
  }
}
