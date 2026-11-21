import assert from 'node:assert/strict';

// Real HTTP/Core writing, rendered fields and native input. The delay holds
// actual editor-state answers; it does not replace them or invent DOM state.
export async function savedInlineReply851Checks(
  { check, until, view, control, facts, shot, observations, engine },
  { seed, open, centre, press, closeReader, card, into }
) {
  for (const device of ['phone', 'laptop']) for (const theme of ['light', 'dark']) {
    const name = `reading item 851 ${device} ${theme}: saved replies restore without taking over`;
    await check(name, async () => {
      const topic = `reply851-${device}-${theme}`, other = topic + '-other';
      const bodies = { first: 'First saved reply — exact.\nTwo  spaces.', second: 'Second saved reply — different.\nKeep this.' };
      const ids = await seed(topic, [
        ['first', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'First source for saved writing.' }],
        ['second', { sender: 'aim-core', reply_to: 'first', reply_without_quote: 'A separate message with its own saved writing.', addressees: [facts.actor], body: 'Second source for independent writing.' }],
        ['foreign', { sender: 'aim-core', addressees: [facts.actor], body: 'Another reader has a private reply here.' }],
        ['plain', { sender: 'aim-core', addressees: [facts.actor], body: 'Ordinary reading stays here.\n\n' + 'Readable words on the page. '.repeat(70), read: true }]
      ].map(([key, args]) => [key, { ...args, divergence_reason: 'Independent saved-reply source ' + key }]));
      await control({ method: 'navigation_topics', topics: [{ id: other, title: 'Other place for851' }] });
      for (const key of ['first', 'second', 'foreign']) {
        const saved = await control({ method: 'private_writing', topic_id: topic, message_id: ids[key], kind: 'draft',
          sender: key === 'foreign' ? 'aim-core' : 'person', body: bodies[key] ?? 'Other reader private writing', operation_id: topic + '-draft-' + key });
        assert.equal(saved.status, 'committed');
      }
      const releaseKey = 'released-' + topic;
      const init = `(()=>{const f=fetch;window.held851=[];window.hold851=!sessionStorage.getItem(${JSON.stringify(releaseKey)});
        window.release851=()=>{window.hold851=false;sessionStorage.setItem(${JSON.stringify(releaseKey)},'yes');for(const go of window.held851.splice(0))go()};
        window.fetch=async function(input,options){let b;try{b=JSON.parse(options?.body)}catch{};const answer=await f.call(this,input,options);
          if(window.hold851&&b?.name==='editor_state'&&${JSON.stringify([ids.first, ids.second])}.includes(b.args?.source_ref?.id))
            await new Promise(go=>window.held851.push(go));return answer};})()`;
      const phases = [];
      let p;
      const field = key => `#reply-${ids[key]}-writing-body`;
      const read = key => view('editor_state', { source_ref: { kind: 'message', id: ids[key] }, topic_id: topic });
      const exact = async key => {
        const saved = await read(key);
        assert.equal(saved.draft.body, bodies[key]);
        assert.deepEqual(saved.source_ref, { kind: 'message', id: ids[key] });
        assert.equal(saved.destination.topic_id, topic);
      };
      const restored = () => until(() => p.evaluate(`(()=>{const expected=${JSON.stringify(['first', 'second'].map(key => [ids[key], bodies[key]]))};
        return expected.every(([id,body])=>{const f=document.getElementById('reply-'+id+'-writing-body');return f?.getClientRects().length&&f.value===body})})()`), name + ': both exact saved fields show');
      const replace = async (selector, text) => {
        await into(p, device, selector); await p.key('a', 4);
        if (text) await p.send('Input.insertText', { text }); else await p.key('Backspace');
      };
      const reload = async () => {
        const old = await p.evaluate('(window.document851=crypto.randomUUID())');
        await p.send('Page.reload');
        await until(() => p.evaluate(`window.document851!==${JSON.stringify(old)}&&document.body.dataset.ready==='true'&&Boolean(document.querySelector(${JSON.stringify(card(ids.plain))}))`), 'new document has the actual topic after reload');
      };
      const go = async target => {
        if (device === 'phone') { await centre(p, '#rail-open'); await press(p, device, '#rail-open'); await until(() => p.evaluate("document.querySelector('#rail-open').getAttribute('aria-expanded')==='true'"), 'topic drawer opens'); }
        const link = `#topics a[data-topic-id="${target}"]`;
        await until(() => p.evaluate(`(()=>{const a=document.querySelector(${JSON.stringify(link)});if(!a)return false;const b=a.getBoundingClientRect();return b.width>0&&b.height>0})()`), 'actual topic link is rendered');
        await centre(p, link);
        await until(() => p.evaluate(`(()=>{const a=document.querySelector(${JSON.stringify(link)});if(!a)return false;const b=a.getBoundingClientRect(),x=b.x+Math.min(12,b.width/2),y=b.y+Math.min(12,b.height/2);return b.width>0&&b.height>0&&a.contains(document.elementFromPoint(x,y))})()`), 'the rendered topic link is ready for native input after the rail redraw');
        await press(p, device, link);
        await until(() => p.evaluate(`new URL(location.href).searchParams.get('topic')===${JSON.stringify(target)}&&document.body.dataset.ready==='true'`), 'native topic navigation finishes');
      };
      try {
        p = await open(topic, device, topic, ids.plain, init, undefined, q => q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }));
        await until(() => p.evaluate('window.held851.length===2'), 'both real editor responses are held');
        // A real menu press and Escape return to the browser's reading target:
        // WebKit returns to main; Chrome restores the menu button. Preserve it.
        await centre(p, '#topic-menu'); await press(p, device, '#topic-menu'); await p.key('Escape');
        assert.equal(await p.evaluate('document.activeElement.id'), engine === 'webkit' ? 'main' : 'topic-menu');
        // Set up a reading position without claiming this setup is a gesture.
        await p.evaluate('window.scrollTo(0,120)');
        const position = () => p.evaluate(`({y:scrollY,active:document.activeElement.id,top:document.querySelector(${JSON.stringify(card(ids.plain))}).getBoundingClientRect().top})`);
        const before = await position(); await p.evaluate('window.release851()'); await restored();
        await p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
        const after = await position();
        observations.push({ name, phase: 'delayed restoration', before, after });
        assert.equal(after.active, before.active, 'paint does not take focus');
        assert.ok(Math.abs(after.top - before.top) <= 1, '1px subpixel tolerance: actual card being read stays in place');
        assert.ok(Math.abs(after.y - before.y) <= 1, 'paint does not scroll the page');
        assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(field('foreign'))}))`), false, 'other readers writing opens nothing');
        for (const key of ['first', 'second']) await exact(key);
        phases.push('two independent exact drafts; privacy; no paint focus/scroll');
        await shot(p, 'reading-item851-' + device + '-' + theme + '-restored');

        await reload(); await restored();
        phases.push('reload restores both');
        await centre(p, card(ids.first) + ' > .message-preview'); await press(p, device, card(ids.first) + ' > .message-preview');
        await until(() => p.evaluate("document.querySelector('#reader').open"), 'native body press opens Reader');
        assert.equal(await p.evaluate("document.querySelector('#writing-body').value"), bodies.first);
        assert.equal(await p.evaluate("[...document.querySelectorAll('.card-reply-composer')].some(e=>e.getClientRects().length)"), false, 'Reader has no visible duplicate card editor');
        bodies.first += '\nWritten in Reader.';
        await replace('#writing-body', bodies.first);
        await until(async () => (await read('first')).draft.body === bodies.first, 'Reader writing reaches real Core');
        await closeReader(p, device); await restored(); await exact('first');
        phases.push('Reader shares exact writing and destination');

        await centre(p, `#reply-${ids.first}-composer .card-reply-close`); await press(p, device, `#reply-${ids.first}-composer .card-reply-close`);
        await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(field('first'))}).getClientRects().length`), 'close finishes keeping the writing before hiding its field');
        await go(other); await go(topic); await restored();
        phases.push('manual close retains writing and return restores both');

        await replace(field('first'), '');
        await until(async () => (await read('first')).draft.body === '', 'cleared reply reaches real Core');
        await reload();
        await until(() => p.evaluate(`document.body.dataset.ready==='true'&&document.querySelector(${JSON.stringify(field('second'))})?.value===${JSON.stringify(bodies.second)}`), 'remaining saved reply restores');
        assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(field('first'))}))`), false, 'cleared draft opens nothing after reload');
        phases.push('cleared draft stays empty after reload');

        await into(p, device, field('second'));
        await centre(p, `#reply-${ids.second}-send`); await press(p, device, `#reply-${ids.second}-send`);
        await until(async () => (await view('topic_messages', { topic_id: topic, direction: 'before', limit: 50 })).items.some(m => m.body === bodies.second), 'actual Core publication');
        await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(field('second'))})?.getClientRects().length`), 'confirmed send closes its field');
        await reload();
        await until(() => p.evaluate(`document.body.dataset.ready==='true'&&Boolean(document.querySelector(${JSON.stringify(card(ids.plain))}))`), 'sent topic reloads');
        assert.equal(await p.evaluate('document.querySelectorAll(".card-reply-composer textarea").length'), 0, 'sent and cleared writing opens no fields');
        phases.push('confirmed send closes and reload stays closed');
        await shot(p, 'reading-item851-' + device + '-' + theme);
        assert.deepEqual(p.errors, []);
        observations.push({ name, engine, phases, input: device === 'phone' ? 'emulated touch taps and native keys' : 'native pointer and keys', layoutTolerancePx: 1 });
      } catch (error) {
        observations.push({ name, phases, error: error.message });
        if (p) await shot(p, 'reading-item851-' + device + '-' + theme + '-failure');
        throw error;
      } finally { if (p) { await p.evaluate('window.release851?.()'); await p.close(); } }
    });
  }
}
