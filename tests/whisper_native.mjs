import assert from 'node:assert/strict';

// Whispers in the real browser against the real server (docs/whispers.md):
// the choice above Send by keys and by pointer, the dashed line as you write
// and on the card, an answer arriving as a whisper, a second name making a
// Tell, the Reader that starts no topic from a whisper, New message, a phone's
// width, and light and dark.
export async function whispersChecks({ check, page, until, control, view, facts, replace, shot }) {
  const agent = facts.agent;
  const quiet = async (p, expression) => { try { return await p.evaluate(expression); } catch { return false; } };
  const choice = (p, row = '#intent-row') => p.evaluate(`Object.fromEntries([...document.querySelectorAll(${JSON.stringify(row + ' label[data-intent]')})].map(l=>[l.dataset.intent,
    (l.querySelector('input').checked?'checked':'')+(l.querySelector('input').disabled?'disabled':'')]))`);
  const line = (p, row = '#intent-row') => p.evaluate(`document.querySelector(${JSON.stringify(row + ' .audience-line')})?.textContent ?? null`);
  const word = (p, button = '#send-reply') => p.evaluate(`document.querySelector(${JSON.stringify(button + ' .send-word')}).textContent`);
  const dashed = (p, selector) => p.evaluate(`(e=>e&&getComputedStyle(e).borderTopStyle)(document.querySelector(${JSON.stringify(selector)}))`);
  const addressTo = async (p, name, input = '#recipient-input', chips = '#recipient-chips') => {
    await p.point(input); await p.send('Input.insertText', { text: name }); await p.key('Enter');
    await until(() => p.evaluate(`[...document.querySelectorAll(${JSON.stringify(chips + ' .chip')})].some(c=>c.dataset.name===${JSON.stringify(name)})`), 'recipient chip');
  };
  const sent = async (p, from) => {
    await p.point('#send-reply');
    const call = await until(() => p.calls.slice(from).find(c => c.payload?.kind === 'message.send'), 'message.send call');
    const receipt = await until(async () => { const r = await view('operation', { operation_id: call.payload.operation_id }); return r.status === 'committed' && r; }, 'send committed');
    return receipt.result.message_id;
  };
  const card = id => `#messages [data-id="${id}"]`;
  const cardShown = (p, id) => quiet(p, `(c=>c&&{whisper:c.classList.contains('whisper'),label:c.querySelector('.whisper-label')?.textContent??null,
    wait:c.querySelector('.whisper-wait')?.textContent??null,line:getComputedStyle(c).borderTopStyle,aria:c.getAttribute('aria-label')})(document.querySelector(${JSON.stringify(card(id))}))`);
  const openCard = async (p, id, words) => {
    await until(() => quiet(p, `Boolean(document.querySelector(${JSON.stringify(card(id))}))`), 'the card is drawn');
    await p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).scrollIntoView({block:'center'})`);
    await p.point(card(id));
    await until(() => quiet(p, `document.querySelector('#reader').open && document.querySelector('#source-body').textContent.includes(${JSON.stringify(words)})`), 'the Reader shows it');
    await until(() => p.evaluate("document.getAnimations().every(animation=>animation.playState!=='running')"), 'settled reader');
  };
  // Sending a reply closes the Reader on its own; otherwise its ✕ does.
  const closeReader = async p => {
    if (await p.evaluate('document.querySelector("#reader").open')) await p.point('#reader-close');
    await until(() => p.evaluate('!document.querySelector("#reader").open'), 'reader closed');
  };
  // What everyone in the topic sees of it: none of this moves for a whisper.
  const shared = async () => { const t = (await view('topic', { topic_id: 't1' })).topic; return { version: t.version, latest: t.latest_message_id ?? t.latest_seq ?? null, waiting: t.waiting_on, asks: t.asks }; };
  // The person's whisper to the agent, written through the store as the composer would, for a check that starts from one.
  const personWhispers = async (operation, body) => (await control({ method: 'agent_message', operation_id: operation, sender: 'person', body, addressees: [agent], whisper: true })).result.message_id;

  await check('whispers a reply to one agent starts as a whisper, keys and pointer choose, and Send sends one only the two of them see', async () => {
    const p = await page('whispers-reply', null, true); await p.open(1);
    assert.deepEqual(await choice(p), { whisper: 'disabled', tell: 'checked', ask: 'disabled' }, 'naming nobody, it is a Tell and nothing is owed');
    assert.match(await line(p), /^Everyone in this topic will see this\./);
    await replace(p, 'Is the launch date firm?');
    await addressTo(p, agent);
    assert.deepEqual(await choice(p), { whisper: 'checked', tell: '', ask: '' }, 'a reply to one agent starts as a whisper');
    assert.match(await line(p), new RegExp(`^Only you and ${agent} will see this\\.`));
    assert.equal(await word(p), 'Whisper');
    assert.equal(await dashed(p, '#writing-body'), 'dashed', 'the writing box has a dashed line while whispering');
    await shot(p, 'whispers-writing');
    // The keys of a radio group: an arrow moves the choice, and back.
    await p.evaluate(`document.querySelector('#intent-row input[value="whisper"]').focus()`);
    await p.key('ArrowRight');
    await until(async () => (await choice(p)).tell === 'checked', 'an arrow chooses Tell');
    assert.equal(await word(p), 'Send');
    assert.notEqual(await dashed(p, '#writing-body'), 'dashed', 'a Tell has no dashed line');
    assert.match(await line(p), /^Everyone in this topic will see this\./);
    await p.key('ArrowRight');
    await until(async () => (await choice(p)).ask === 'checked', 'the next arrow chooses Ask');
    assert.equal(await word(p), 'Ask');
    await p.key('ArrowLeft'); await p.key('ArrowLeft');
    await until(async () => (await choice(p)).whisper === 'checked', 'arrows come back to Whisper');
    // And by pointer.
    await p.point('#intent-row label[data-intent="tell"]');
    await until(async () => (await choice(p)).tell === 'checked', 'a tap chooses Tell');
    await p.point('#intent-row label[data-intent="whisper"]');
    await until(async () => (await choice(p)).whisper === 'checked', 'a tap chooses Whisper');
    assert.equal(await word(p), 'Whisper');
    const before = await shared();
    const whisperId = await sent(p, 0);
    const source = await view('source', { source_ref: { kind: 'message', id: whisperId } });
    assert.equal(source.whisper, true); assert.equal(source.private_to, agent);
    assert.equal(source.intent ?? null, null, 'a whisper neither asks nor tells');
    assert.deepEqual(await shared(), before, 'nothing everyone sees of the topic moved');
    await closeReader(p);
    const shown = await until(async () => { const c = await cardShown(p, whisperId); return c?.wait && c; }, 'the whisper card waits for its answer');
    assert.deepEqual([shown.whisper, shown.label, shown.wait, shown.line], [true, ` · whisper to ${agent}`, ' · no answer yet', 'dashed']);
    assert.match(shown.aria, new RegExp(`^${facts.actor}, whisper to ${agent}`), 'a screen reader hears it is a whisper: ' + shown.aria);
    await shot(p, 'whispers-card');
    assert.deepEqual(p.errors, []);
  });

  await check('whispers the Reader starts no topic from a whisper, and still does from a message on the record', async () => {
    const whisperId = await personWhispers('whispers-reader-whisper', 'Is the venue booked?');
    const p = await page('whispers-reader', null, true);
    await openCard(p, whisperId, 'Is the venue booked?');
    assert.equal(await p.evaluate(`document.querySelector('#start-from-message').hidden`), true, 'a whisper stays between its two people');
    assert.equal(await dashed(p, '#source-body'), 'dashed', 'the whisper read in the Reader carries the same line');
    await closeReader(p);
    await p.open(1);
    assert.equal(await p.evaluate(`document.querySelector('#start-from-message').hidden`), false, 'a message on the record still starts one');
    assert.notEqual(await dashed(p, '#source-body'), 'dashed');
    assert.deepEqual(p.errors, []);
  });

  await check('whispers the agent answers by whisper and it arrives on the open page, ending the wait', async () => {
    const whisperId = await personWhispers('whispers-answer-whisper', 'Is the date firm?');
    const p = await page('whispers-answer', null, true);
    await until(async () => (await cardShown(p, whisperId))?.wait, 'the whisper waits for its answer');
    const before = await shared();
    const answered = await control({ method: 'agent_message', operation_id: 'whispers-answer', body: 'Firm: the fourth.', reply_to: whisperId, addressees: [facts.actor], whisper: true });
    const answer = answered.result.message_id;
    const shown = await until(async () => { const c = await cardShown(p, answer); return c?.label && c; }, 'the answer arrives as it is sent');
    assert.deepEqual([shown.whisper, shown.label, shown.wait, shown.line], [true, ' · whisper to you', null, 'dashed']);
    await until(async () => (await cardShown(p, whisperId))?.wait === null, 'the whisper it answers no longer waits');
    assert.deepEqual(await shared(), before, 'the answer moved nothing everyone sees either');
    await shot(p, 'whispers-answered');
    assert.deepEqual(p.errors, []);
  });

  await check('whispers a second name makes a whisper a Tell and says why; taking it away makes it a whisper again', async () => {
    const second = 'fixture-planning-agent';
    await control({ method: 'agent_message', operation_id: 'whispers-second-joins', body: 'Joining to plan.', sender: second, join: true, whole_topic: true });
    const p = await page('whispers-second', null, true); await p.open(1);
    await replace(p, 'Who has the launch copy?');
    await addressTo(p, agent);
    assert.equal((await choice(p)).whisper, 'checked');
    await addressTo(p, second);
    assert.deepEqual(await choice(p), { whisper: 'disabled', tell: 'checked', ask: '' }, 'two names cannot whisper');
    assert.equal(await p.evaluate(`document.querySelector('#intent-row label[data-intent="whisper"]').title`), 'A whisper goes to one agent. With more than one name, choose Tell or Ask.');
    assert.match(await line(p), new RegExp(`^Everyone in this topic will see this\\. A whisper goes to one agent\\. Nothing you wrote is lost\\. Adding ${second} made this a Tell\\.`));
    assert.equal(await word(p), 'Send');
    assert.equal(await field(p), 'Who has the launch copy?', 'the words stay');
    await shot(p, 'whispers-switched');
    await p.point(`#recipient-chips .chip[data-name="${second}"] button`);
    await until(async () => (await choice(p)).whisper === 'checked', 'taking the second name away whispers again');
    assert.equal(await word(p), 'Whisper');
    assert.deepEqual(p.errors, []);
  });

  await check('whispers New message names nobody, then one agent, and its choice and line change', async () => {
    const p = await page('whispers-new', null, true);
    await p.evaluate('document.querySelector("#inline-composer").scrollIntoView({block:"center"})');
    await until(async () => (await choice(p, '#inline-intent-row')).tell === 'checked', 'New message offers its choice');
    assert.deepEqual(await choice(p, '#inline-intent-row'), { whisper: 'disabled', tell: 'checked', ask: 'disabled' });
    assert.match(await line(p, '#inline-intent-row'), /It goes to no one by name\.$/);
    await addressTo(p, agent, '#inline-recipient-input', '#inline-recipient-chips');
    assert.deepEqual(await choice(p, '#inline-intent-row'), { whisper: 'checked', tell: '', ask: '' });
    assert.match(await line(p, '#inline-intent-row'), new RegExp(`^Only you and ${agent} will see this\\.`));
    assert.equal(await word(p, '#inline-send'), 'Whisper');
    assert.equal(await dashed(p, '#inline-writing-body'), 'dashed');
    await shot(p, 'whispers-new-message');
    assert.deepEqual(p.errors, []);
  });

  await check('whispers at a phone\'s width the choice and its line fit, Send stays in view, and nothing scrolls sideways', async () => {
    const p = await page('whispers-phone', null, true);
    await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await p.open(1);
    await replace(p, 'Quick one: is it firm?');
    await addressTo(p, agent);
    assert.equal((await choice(p)).whisper, 'checked');
    const fit = await p.evaluate(`(()=>{const v=innerWidth,r=e=>e.getBoundingClientRect(),send=r(document.querySelector('#send-reply'));
      const out=[...document.querySelectorAll('#intent-row label, #intent-row .audience-line, #send-reply')].filter(e=>{const b=r(e);return b.left<0||b.right>v+0.5}).map(e=>e.id||e.className||e.dataset.intent);
      return {sideways:document.scrollingElement.scrollWidth>v,dialog:document.querySelector('#reader').scrollWidth>document.querySelector('#reader').clientWidth,out,
        send:send.top>=0&&send.bottom<=innerHeight+0.5,where:[send.top,send.bottom,innerHeight],more:getComputedStyle(document.querySelector('#intent-row .audience-more')).display,
        header:r(document.querySelector('#reader .reader-header')).height}})()`);
    await shot(p, 'whispers-phone');
    // The passage gives way to the reply's rows, and the header keeps its own height.
    assert.ok(fit.header < 100, `the Reader's header is not stretched (${fit.header}px)`);
    assert.deepEqual(fit, { sideways: false, dialog: false, out: [], send: true, where: fit.where, more: 'none', header: fit.header }, 'everything fits the width, Send is in view, and the line keeps its first words ' + JSON.stringify(fit.where));
    assert.match(await line(p), new RegExp(`^Only you and ${agent} will see this\\.`));
    assert.deepEqual(p.errors, []);
  });

  await check('whispers the dashed line shows in light and in dark', async () => {
    const p = await page('whispers-schemes', null, true);
    const contrast = async () => p.evaluate(`(()=>{const lum=c=>{const [r,g,b]=c.match(/[\\d.]+/g).slice(0,3).map(n=>{n/=255;return n<=0.03928?n/12.92:((n+0.055)/1.055)**2.4});return 0.2126*r+0.7152*g+0.0722*b};
      const f=document.querySelector('#writing-body'),s=getComputedStyle(f);let bg=s.backgroundColor,e=f;while(/rgba\\(.*, 0\\)|transparent/.test(bg)&&e.parentElement){e=e.parentElement;bg=getComputedStyle(e).backgroundColor;}
      const [a,b]=[lum(s.borderTopColor),lum(bg)].sort((x,y)=>y-x);return {style:s.borderTopStyle,ratio:(a+0.05)/(b+0.05)}})()`);
    await p.open(1);
    await replace(p, 'Light or dark?');
    await addressTo(p, agent);
    for (const scheme of ['light', 'dark']) {
      await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await until(() => p.evaluate(`matchMedia('(prefers-color-scheme: ${scheme})').matches`), scheme);
      const seen = await contrast();
      assert.equal(seen.style, 'dashed', scheme);
      assert.ok(seen.ratio >= 3, `the ${scheme} dashed line stands out from its field (${seen.ratio.toFixed(2)}:1)`);
      await shot(p, 'whispers-' + scheme);
    }
    assert.deepEqual(p.errors, []);
  });

  // Each check above reads the same field the Reader writes in.
  async function field(p) { return p.evaluate('document.querySelector("#writing-body").value'); }
}
