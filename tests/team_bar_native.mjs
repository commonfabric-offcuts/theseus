import assert from 'node:assert/strict';

// The topic's Team is exercised in the whispers step because that page runs in
// both Chromium and WebKit. Every press below is a native mouse click or tap.
export async function teamBarChecks({ check, page, until, shot, control, view }) {
  const opener = '#participants .add-chip', field = '#participants .people-add input';
  const shown = p => p.evaluate(`!document.querySelector('#participants .people-add').hidden`);
  const word = p => p.evaluate(`document.querySelector('${opener}').textContent`);
  const membership = async () => (await view('topic', { topic_id: 't1' })).participants.map(x => x.actor_id).sort();
  const fit = p => p.evaluate(`(()=>{const nodes=[...document.querySelectorAll('#topic-people h2,#participants button,#participants input,#participants .notice')].filter(e=>e.getClientRects().length);
    return {sideways:document.documentElement.scrollWidth>innerWidth,out:nodes.filter(e=>{const b=e.getBoundingClientRect();return b.left<-.5||b.right>innerWidth+.5}).map(e=>e.textContent||e.tagName),
      small:matchMedia('(pointer:coarse)').matches?nodes.filter(e=>e.matches('button')&&e.getBoundingClientRect().height<44).map(e=>e.textContent):[]}})()`);
  const place = p => p.evaluate(`['#topic-title','#topic-description','#people-heading','#participants .person-pill'].map(s=>{const b=document.querySelector(s).getBoundingClientRect();return [b.x,b.y,b.width,b.height]})`);
  for (const width of [320, 375, 390, 1280]) for (const theme of ['light', 'dark']) {
    const tag = `${width}-${theme}`;
    const setup = async p => {
      if (width < 760) await p.send('Emulation.setTouchEmulationEnabled', { enabled: true });
      await p.send('Emulation.setDeviceMetricsOverride', { width, height: width < 760 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 760 });
      await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    };
    const openPage = async suffix => {
      const p = await page(`item-643-${tag}-${suffix}`, null, true, { beforeNavigate: setup });
      await until(() => p.evaluate(`Boolean(document.querySelector('${opener}')?.getClientRects().length)&&Boolean(document.querySelector('#participants .person-pill'))`), 'Team is drawn');
      await p.evaluate('scrollTo(0,0)'); return p;
    };
    const press = async (p, selector) => {
      if (width >= 760) return p.point(selector);
      const b = await p.box(selector);
      await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
      await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const open = async p => { await press(p, opener); await until(() => shown(p), 'Add shows the choices and field'); };
    await check(`whispers item 643 Team spelling ${tag}`, async () => {
      const p = await openPage('spelling');
      await shot(p, `item-643-${tag}-closed`);
      const caption = await p.evaluate(`(()=>{const e=document.querySelector('#people-heading');return [e.textContent,getComputedStyle(e).textTransform]})()`);
      assert.equal(caption[0], 'Team'); assert.notEqual(caption[1], 'uppercase', 'Team is drawn as Team, not TEAM');
      assert.deepEqual(await fit(p), { sideways: false, out: [], small: [] });
      await p.close();
    });
    await check(`whispers item 643 Add becomes Done and closes without adding ${tag}`, async () => {
      const p = await openPage('toggle'), before = await membership(), placed = await place(p);
      await open(p);
      await until(() => p.evaluate(`document.querySelector('${field}')===document.activeElement`), 'the field has focus');
      await shot(p, `item-643-${tag}-open`);
      assert.equal(await word(p), 'Done', 'Add reads Done while the choices and field show');
      assert.equal(await p.evaluate(`document.querySelector('${opener}').getAttribute('aria-expanded')`), 'true');
      assert.deepEqual(await place(p), placed, 'opening moves neither title, subtitle, label nor first member');
      assert.deepEqual(await fit(p), { sideways: false, out: [], small: [] });
      await press(p, field); await p.send('Input.insertText', { text: 'not-added-item-643' });
      await press(p, opener); await until(async () => !await shown(p), 'Done closes the choices and field');
      assert.equal(await word(p), '+ Add');
      assert.equal(await p.evaluate(`document.querySelector('${opener}').getAttribute('aria-expanded')`), 'false');
      assert.deepEqual(await membership(), before, 'Done never submits the unconfirmed name');
      await open(p);
      assert.equal(await p.evaluate(`document.querySelector('${field}').value`), 'not-added-item-643', 'closing keeps the filter');
      await p.key('Escape'); await until(async () => !await shown(p), 'Escape still closes');
      assert.equal(await word(p), '+ Add');
      await p.close();
    });
    await check(`whispers item 643 outside closes and inside stays open ${tag}`, async () => {
      const p = await openPage('outside'), before = await membership();
      await open(p); await press(p, field);
      assert.equal(await shown(p), true, 'a press inside never closes');
      await p.send('Input.insertText', { text: 'not-added-item-643' });
      await press(p, '#topic-title');
      await until(async () => !await shown(p), 'a click outside closes as Done');
      assert.equal(await word(p), '+ Add');
      assert.deepEqual(await membership(), before, 'outside never adds a typed name');
      // The outside press must still do its own work, without a second press.
      await open(p); await press(p, '#new-message');
      await until(() => p.evaluate(`document.querySelector('#new-message-sheet').open`), 'the outside New message press also opens writing');
      assert.equal(await shown(p), false);
      await p.close();
    });
    for (const state of ['empty', 'refused', 'busy']) await check(`whispers item 643 ${state} picker closes with Done or outside ${tag}`, async () => {
      const p = await openPage(state), before = await membership(); await open(p);
      await press(p, field); await p.send('Input.insertText', { text: `unknown-item-643-${state}` });
      if (state === 'busy') {
        // Hold the real command's response, not its handler or the Store. This
        // same network boundary is available in both browser engines.
        await p.evaluate(`(()=>{const fetch=window.fetch;window.fetch=async(...args)=>{let body;try{body=JSON.parse(args[1]?.body)}catch{}const response=await fetch(...args);if(body?.kind==='participation.set'){window.item643ResponseHeld=true;await new Promise(resolve=>window.item643Release=resolve)}return response}})()`);
        await p.key('Enter');
        await until(() => p.evaluate('window.item643ResponseHeld===true'), 'real participation response held');
      } else if (state === 'refused') {
        await p.key('Enter');
        await until(() => p.evaluate(`!document.querySelector('#participants .notice').hidden`), 'the actual unknown name is refused');
      }
      await shot(p, `item-643-${tag}-${state}`);
      assert.equal(await word(p), 'Done'); assert.deepEqual(await fit(p), { sideways: false, out: [], small: [] });
      await press(p, state === 'refused' ? opener : '#topic-title');
      await until(async () => !await shown(p), `${state} picker closed`);
      if (state === 'busy') {
        await p.evaluate('window.item643Release()');
        await until(() => p.evaluate(`!document.querySelector('#participants .notice').hidden`), 'the held refusal arrives');
        assert.equal(await shown(p), false, 'late response never reopens the picker');
      }
      assert.deepEqual(await membership(), before, 'no unknown name is added');
      await p.close();
    });
  }
}
