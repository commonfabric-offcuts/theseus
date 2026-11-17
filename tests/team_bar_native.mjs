import assert from 'node:assert/strict';

// The topic's Team is exercised in the colors step because that page runs in
// both Chromium and WebKit. Every press below is a native mouse click or tap.
export async function teamBarChecks({ check, page, until, shot, control, view, facts }) {
  const opener = '#participants .add-chip', field = '#participants .people-add input';
  const shown = p => p.evaluate(`!document.querySelector('#participants .people-add').hidden`);
  const word = p => p.evaluate(`document.querySelector('${opener}').textContent`);
  const membership = async () => (await view('topic', { topic_id: 't1' })).participants.map(x => x.actor_id).sort();
  const fit = p => p.evaluate(`(()=>{const nodes=[...document.querySelectorAll('#topic-people h2,#participants button,#participants input,#participants .notice')].filter(e=>e.getClientRects().length);
    return {sideways:document.documentElement.scrollWidth>innerWidth,out:nodes.filter(e=>{const b=e.getBoundingClientRect();return b.left<-.5||b.right>innerWidth+.5}).map(e=>e.textContent||e.tagName),
      small:matchMedia('(pointer:coarse)').matches?nodes.filter(e=>e.matches('.add-chip,.people-add button')&&e.getBoundingClientRect().height<44).map(e=>e.textContent):[]}})()`);
  const place = p => p.evaluate(`['#topic-title','#topic-description','#people-heading','#participants .person-pill'].map(s=>{const e=document.querySelector(s),r=document.createRange();r.selectNodeContents(e);const b=s==='#topic-description'?r.getBoundingClientRect():e.getBoundingClientRect();return [b.x,b.y,b.width,b.height]})`);
  for (const width of [320, 375, 390, 1280]) for (const theme of ['light', 'dark']) {
    const tag = `${width}-${theme}`;
    const setup = async p => {
      if (width < 760) await p.send('Emulation.setTouchEmulationEnabled', { enabled: true });
      await p.send('Emulation.setDeviceMetricsOverride', { width, height: width < 760 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 760 });
      await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    };
    const candidate = 'fixture-outside-agent';
    const openPage = async suffix => {
      await control({ method: 'outcome_change', operation_id: `item-643-candidate-${tag}-${suffix}`, sender: 'fixture-person', workspace_id: 'w1', member: candidate, present: true });
      const p = await page(`item-643-${tag}-${suffix}`, null, true, { beforeNavigate: setup });
      await until(() => p.evaluate(`Boolean(document.querySelector('${opener}')?.getClientRects().length)&&Boolean(document.querySelector('#participants .person-pill'))`), 'Team is drawn');
      await until(() => p.evaluate(`!document.querySelector('#things [data-key=notebook]').hidden&&!document.querySelector('#things [data-key=images]').hidden`), 'Notebook and Images are drawn before the screenshot');
      await p.evaluate('scrollTo(0,0)'); return p;
    };
    const press = async (p, selector) => {
      if (width >= 760) return p.point(selector);
      const b = await p.box(selector);
      await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
      await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const open = async p => { await press(p, opener); await until(() => shown(p), 'Add shows the choices and field');
      if (!await p.evaluate(`document.querySelector('${field}').value`)) await until(() => p.evaluate(`Boolean(document.querySelector('#participants .people-chips button[data-id="${candidate}"]'))`), 'available agent pill shows'); };
    await check(`colors item 643 Team spelling ${tag}`, async () => {
      const p = await openPage('spelling');
      await shot(p, `item-643-${tag}-closed`);
      const caption = await p.evaluate(`(()=>{const e=document.querySelector('#people-heading');return [e.textContent,getComputedStyle(e).textTransform]})()`);
      assert.equal(caption[0], 'Team'); assert.notEqual(caption[1], 'uppercase', 'Team is drawn as Team, not TEAM');
      assert.deepEqual(await fit(p), { sideways: false, out: [], small: [] });
      await p.close();
    });
    await check(`colors item 643 Add becomes Done and closes without adding ${tag}`, async () => {
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
    await check(`colors item 643 outside closes and inside stays open ${tag}`, async () => {
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
    await check(`colors item 643 agent choice stays open and adds once ${tag}`, async () => {
      const p = await openPage('choice'); await open(p);
      const choice = `#participants .people-chips button[data-id="${candidate}"]`;
      await press(p, choice);
      await until(async () => (await membership()).includes(candidate), 'the native pill press adds its actor');
      assert.equal(await shown(p), true); assert.equal(await word(p), 'Done');
      await until(() => p.evaluate(`Boolean(document.querySelector('#participants .person-pill .pill-name[title="Change ${candidate}’s color"]'))||!document.querySelector('#participants .people-chips button[data-id="${candidate}"]')`), 'the chosen agent leaves the choices');
      const calls = p.calls.filter(c => c.payload?.kind === 'participation.set' && c.payload.args.actor_id === candidate && c.payload.args.present);
      assert.equal(calls.length, 1, 'a pill adds once');
      await press(p, opener); await until(async () => !await shown(p), 'Done closes after adding');
      await press(p, `#participants .pill-remove[aria-label="Remove ${candidate}"]`);
      await until(async () => !(await membership()).includes(candidate), 'this case restores its added member');
      await p.close();
    });
    await check(`colors item 643 read-only Team ${tag}`, async () => {
      const elsewhere = await control({ method: 'elsewhere_ask', operation_id: `item-643-readonly-${tag}`, body: 'Read-only Team fixture' });
      const p = await page(`item-643-${tag}-readonly`, null, true, { url: `${facts.origin}/?topic=${elsewhere.topic_id}`, beforeNavigate: setup });
      await until(() => p.evaluate(`Boolean(document.querySelector('#participants .person-pill'))`), 'read-only Team drawn');
      await shot(p, `item-643-${tag}-readonly`);
      assert.equal(await p.evaluate(`Boolean(document.querySelector('${opener}'))`), false, 'a reader cannot add people');
      assert.equal(await shown(p), false);
      assert.deepEqual(await fit(p), { sideways: false, out: [], small: [] });
      await p.close();
    });
    for (const state of ['empty', 'refused', 'error', 'busy']) await check(`colors item 643 ${state} picker closes with Done or outside ${tag}`, async () => {
      const p = await openPage(state), before = await membership(); await open(p);
      await press(p, field); await p.send('Input.insertText', { text: `unknown-item-643-${state}` });
      if (state === 'busy') {
        // Hold the real command's response, not its handler or the Store. This
        // same network boundary is available in both browser engines. Api
        // captures fetch at construction, but reads Response.json at delivery.
        await p.evaluate(`(()=>{const json=Response.prototype.json;Response.prototype.json=async function(){const body=await json.call(this);if(this.url.endsWith('/api/command')){window.item643ResponseHeld=true;await new Promise(resolve=>window.item643Release=resolve)}return body}})()`);
        await p.key('Enter');
        await until(() => p.evaluate('window.item643ResponseHeld===true'), 'real participation response held');
      } else if (state === 'refused' || state === 'error') {
        if (state === 'error') await p.evaluate(`(()=>{const json=Response.prototype.json;Response.prototype.json=async function(){if(this.url.endsWith('/api/command'))throw Error('item 643 lost response');return json.call(this)}})()`);
        await p.key('Enter');
        await until(() => p.evaluate(`!document.querySelector('#participants .notice').hidden`), 'the refused or unconfirmed change is reported');
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
