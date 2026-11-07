import assert from 'node:assert/strict';
import { pngPixels } from './png-bands.mjs';

// The top of a topic, Topic settings and the people at the bottom, in the real
// browser against the real server: the title with its gear and the note under
// it, the dialog's keyboard, pointer and phone behaviour, and one pill per
// person after the last message. Every press and key is a native input event.
export async function headerChecks({ check, page, until, control, view, facts, shot }) {
  const HINT = 'Open a message to read, quote, reply, or keep a private note.';
  const NOTE = 'Ongoing: each release and what comes next';
  const phone = async q => {
    await q.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await q.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  };
  const scheme = value => q => q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
  const both = (...steps) => async q => { for (const step of steps) await step(q); };
  // The focused element, by its id or its words; and whether it is inside Topic settings.
  const focused = p => p.evaluate(`(()=>{const a=document.activeElement;return a?(a.id||a.textContent.trim()):null})()`);
  const inside = p => p.evaluate(`Boolean(document.activeElement?.closest('#topic-settings'))`);
  const isOpen = p => p.evaluate(`document.querySelector('#topic-settings').open`);
  const subtitle = p => p.evaluate(`(()=>{const s=document.querySelector('#topic-description');return {text:s.textContent,hidden:s.hidden,states:[...s.querySelectorAll('.topic-state')].map(e=>e.textContent)}})()`);
  const setState = (operation_id, args, topic_id = 't1') => control({ method: 'topic_state', operation_id, topic_id, args });
  const choose = (p, state) => p.evaluate(`(s=>{s.value=${JSON.stringify(state)};s.dispatchEvent(new Event('change'))})(document.querySelector('#topic-state-choice'))`);
  const press = async (p, x, y) => {
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  const tap = async (p, x, y) => {
    await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const tapOn = async (p, selector) => {
    const b = await p.box(selector); assert.ok(b && b.width > 0 && b.height > 0, `visible ${selector}`);
    await tap(p, b.x + b.width / 2, b.y + b.height / 2);
  };
  const openByPointer = async p => {
    await p.evaluate(`scrollTo(0,0)`);
    await p.point('#settings-open');
    await until(async () => await isOpen(p) && await focused(p) === 'settings-title', 'Topic settings open, its title focused');
  };
  // Tab presses from where the focus is, naming each stop and requiring it in the dialog.
  const tabs = async (p, count, shift = false) => {
    const stops = [];
    for (let n = 0; n < count; n++) {
      await p.key('Tab', shift ? 8 : 0);
      stops.push(await focused(p));
      assert.equal(await inside(p), true, `the focus stays in Topic settings after ${stops.join(' → ')}`);
    }
    return stops;
  };
  const noSideways = p => p.evaluate(`document.documentElement.scrollWidth <= innerWidth`);

  await check('header the top of a topic is its title, the gear and its note; the hint and the state rows are gone', async () => {
    await setState('header-top-ongoing', { state: 'active', note: NOTE });
    const p = await page('header-top', null, true);
    await until(async () => (await subtitle(p)).text === 'Each release and what comes next', 'the subtitle shows the note without its "Ongoing:"');
    const top = await p.evaluate(`(()=>{const h=document.querySelector('main > header.topic-header > div'),row=document.querySelector('.title-row');
      const t=document.querySelector('#topic-title'),g=document.querySelector('#settings-open'),tb=t.getBoundingClientRect(),gb=g.getBoundingClientRect(),ts=getComputedStyle(t);
      const leaves=[...document.querySelectorAll('body *')];
      return {parts:[...h.children].map(e=>e.id||e.className),row:[...row.children].map(e=>e.id),
        gear:{name:g.getAttribute('aria-label'),title:g.title,popup:g.getAttribute('aria-haspopup'),hidden:g.hidden,size:[gb.width,gb.height],middle:gb.top+gb.height/2,left:gb.left},
        line:{top:tb.top+parseFloat(ts.paddingTop),height:parseFloat(ts.lineHeight),right:tb.right},
        hint:leaves.some(e=>e.textContent.trim()===${JSON.stringify(HINT)}),
        thisTopic:leaves.some(e=>e.textContent.trim()==='This topic'||e.getAttribute('aria-label')==='This topic'),
        stateInMain:Boolean(document.querySelector('main #topic-state')),stateInDialog:Boolean(document.querySelector('dialog#topic-settings #topic-state'))}})()`);
    assert.deepEqual(top.parts, ['workspace-name', 'title-row', 'topic-description'], 'the outcome\'s name, the title row, then the subtitle');
    assert.deepEqual(top.row, ['topic-title', 'settings-open'], 'the gear shares the title\'s row, after it');
    assert.deepEqual([top.gear.name, top.gear.title, top.gear.popup, top.gear.hidden, top.gear.size], ['Topic settings', 'Topic settings', 'dialog', false, [44, 44]]);
    assert.ok(top.gear.middle >= top.line.top && top.gear.middle <= top.line.top + top.line.height, 'the gear\'s middle is level with the title\'s first line: ' + JSON.stringify(top));
    assert.ok(top.gear.left >= top.line.right, 'the gear is at the upper right, beside the title');
    assert.deepEqual([top.hint, top.thisTopic, top.stateInMain, top.stateInDialog], [false, false, false, true], 'no hint, no "This topic" row, and where it stands only inside Topic settings');
    assert.deepEqual((await subtitle(p)).states, [], 'a plainly Active topic shows no state word');
    await shot(p, 'header-top');
    // Saved to Done in Topic settings: the subtitle follows at once, the word then the whole note.
    // Choosing another state starts its note empty, so the person types one.
    await openByPointer(p);
    await choose(p, 'done');
    assert.equal(await p.evaluate(`document.querySelector('#topic-state-note').value`), '', 'a new state starts with an empty note');
    await p.point('#topic-state-note');
    await p.send('Input.insertText', { text: 'Ongoing: shipped in release 21' });
    const before = p.calls.length;
    await p.point('#topic-state button.primary');
    await until(() => p.calls.slice(before).find(c => c.payload?.kind === 'topic.update'), 'the Save is sent');
    const done = await until(async () => { const s = await subtitle(p); return s.states[0] === 'Done' && s; }, 'the subtitle shows Done without a reload');
    assert.equal(done.text, 'Done Ongoing: shipped in release 21', 'the state word, a space, then every word of the note, "Ongoing:" kept');
    assert.equal((await view('topic', { topic_id: 't1' })).topic.state, 'done');
    await p.key('Escape');
    await until(async () => !await isOpen(p), 'Escape closes it');
    await shot(p, 'header-done');
    // Someone else sets it back to Active: the word goes again, live.
    await setState('header-top-active-again', { state: 'active', note: NOTE });
    await until(async () => { const s = await subtitle(p); return s.text === 'Each release and what comes next' && !s.states.length; }, 'back to Active hides the word');
    await setState('header-top-no-note', { state: 'active', note: '' });
    await until(async () => (await subtitle(p)).hidden, 'a plainly Active topic with no note has no subtitle');
    assert.deepEqual(p.errors, []);
  });

  await check('header the gear opens Topic settings with its form open; Escape closes it and the focus is back on the gear', async () => {
    await setState('header-gear-ongoing', { state: 'active', note: NOTE });
    const p = await page('header-gear', null, true);
    await until(async () => (await subtitle(p)).text === 'Each release and what comes next', 'page painted');
    await p.evaluate(`document.querySelector('#main').focus()`);
    await p.key('Tab');
    assert.equal(await focused(p), 'settings-open', 'Tab from the top of the page reaches the gear');
    await p.key('Enter');
    await until(() => isOpen(p), 'Return opens Topic settings');
    assert.equal(await p.evaluate(`document.querySelector('#topic-settings').matches(':modal')`), true, 'opened as a modal dialog');
    assert.equal(await focused(p), 'settings-title', 'its title takes the focus');
    const form = await p.evaluate(`(()=>{const d=document.querySelector('#topic-settings'),seen=s=>{const e=d.querySelector(s),b=e?.getBoundingClientRect();return Boolean(b&&b.width>0&&b.height>0)};
      const group=d.querySelector('.state-fields[role=group]');
      return {details:d.querySelectorAll('details,summary').length,visible:['#topic-state-choice','#topic-state-note','#topic-state button.primary'].map(seen),
        headings:[...d.querySelectorAll('h3')].map(h=>h.textContent),group:group?.getAttribute('aria-labelledby'),
        line:d.querySelector('.state-line').textContent,close:d.querySelector('#settings-close').getAttribute('aria-label')}})()`);
    assert.equal(form.details, 0, 'no disclosure inside Topic settings');
    assert.deepEqual(form.visible, [true, true, true], 'State, Note and Save show as soon as it opens');
    assert.deepEqual(form.headings, ['Where it stands', 'Change where it stands']);
    assert.equal(form.group, 'change-heading');
    assert.match(form.line, new RegExp('^Active · ' + NOTE + ' — you, '), 'where it stands keeps every word of the note, and says who set it');
    assert.equal(form.close, 'Close topic settings');
    await shot(p, 'header-settings-open');
    await p.key('Escape');
    await until(async () => !await isOpen(p), 'a real Escape closes it');
    assert.equal(await focused(p), 'settings-open', 'the focus is back on the gear');
    assert.deepEqual(p.errors, []);
  });

  await check('header Tab stays inside Topic settings for the outcome\'s owner', async () => {
    await setState('header-owner-active', { state: 'active', note: '' });
    const p = await page('header-tab-owner', null, true);
    await openByPointer(p);
    assert.deepEqual(await tabs(p, 1), ['settings-close'], 'from the title, Tab goes to ✕');
    // The owner and creator rename and archive it; as a participant they also say their own part.
    const loop = ['topic-state-choice', 'topic-state-note', 'Save', 'topic-rename', 'Rename', 'Archive', 'topic-responsibility', 'topic-responsibility-save', 'settings-close'];
    assert.deepEqual(await tabs(p, loop.length), loop, 'from the last stop Tab wraps to ✕');
    assert.deepEqual(await tabs(p, 1, true), ['topic-responsibility-save'], 'Shift+Tab from ✕ goes to the last stop');
    await p.evaluate(`document.querySelector('#settings-title').focus()`);
    assert.deepEqual(await tabs(p, 1, true), ['topic-responsibility-save'], 'Shift+Tab from the title goes to the last stop');
    await choose(p, 'waiting');
    await p.evaluate(`document.querySelector('#settings-close').focus()`);
    assert.deepEqual(await tabs(p, 4), ['topic-state-choice', 'topic-state-note', 'topic-state-waiting', 'Save'], 'Waiting on joins between Note and Save while Waiting is chosen');
    await shot(p, 'header-tab-owner');
    assert.deepEqual(p.errors, []);
  });

  await check('header Tab stays inside Topic settings for a participant who is neither the owner nor the creator', async () => {
    const made = await control({ method: 'agent_topic', operation_id: 'header-participant', title: 'Started by the agent', body: 'Over to you.' });
    const p = await page('header-tab-participant', null, true, { url: `${facts.origin}/?topic=${made.topic_id}` });
    await until(() => p.evaluate(`document.querySelector('#topic-title').textContent === 'Started by the agent' && !document.querySelector('#settings-open').hidden`), 'the agent\'s topic open');
    await openByPointer(p);
    assert.equal(await p.evaluate(`Boolean(document.querySelector('#topic-rename'))`), false, 'no Rename or Archive for a participant');
    assert.deepEqual(await tabs(p, 1), ['settings-close']);
    const loop = ['topic-state-choice', 'topic-state-note', 'Save', 'topic-responsibility', 'topic-responsibility-save', 'settings-close'];
    assert.deepEqual(await tabs(p, loop.length), loop);
    assert.deepEqual(await tabs(p, 1, true), ['topic-responsibility-save']);
    await shot(p, 'header-tab-participant');
    assert.deepEqual(p.errors, []);
  });

  // Whoever organises an outcome, its owner and its coordinator, renames and
  // archives its topics and changes who takes part, beside each topic's
  // creator. The open page learns of a handover or a cleared coordinator from
  // the outcome's own change key: no topic version moves, and nothing reloads.
  const managing = p => p.evaluate(`(()=>{const people=document.querySelector('#participants .people-add');
    return {rename:Boolean(document.querySelector('#topic-settings #topic-rename')),add:Boolean(people&&!people.hidden),
      removes:[...document.querySelectorAll('#participants [aria-label^="Remove "]')].map(b=>b.getAttribute('aria-label'))}})()`);
  const openTopic = async (suffix, made, title) => {
    const p = await page(suffix, null, true, { url: `${facts.origin}/?topic=${made.topic_id}` });
    await until(() => p.evaluate(`document.querySelector('#topic-title').textContent === ${JSON.stringify(title)} && !document.querySelector('#settings-open').hidden`), 'the agent\'s topic open');
    return p;
  };

  await check('header the outcome\'s coordinator renames a topic they did not start and changes who takes part, until they no longer coordinate', async () => {
    const made = await control({ method: 'agent_topic', operation_id: 'header-coordinator', title: 'Coordinated by the reader', body: 'Tidy this one.', coordinator: true });
    const p = await openTopic('header-coordinator', made, 'Coordinated by the reader');
    await until(async () => (await managing(p)).add, 'the add field shows for the coordinator');
    const coordinating = await managing(p);
    assert.deepEqual([coordinating.rename, coordinating.add, coordinating.removes.includes(`Remove ${facts.actor}`)], [true, true, true],
      'the coordinator renames, archives and changes who takes part: ' + JSON.stringify(coordinating));
    await openByPointer(p);
    await p.point('#topic-rename');
    await p.key('a', 4);
    await p.send('Input.insertText', { text: 'Renamed by its coordinator' });
    const before = p.calls.length;
    // The Rename button sits right after the title field, in its row.
    assert.equal(await p.evaluate(`document.querySelector('.state-fields:has(#topic-rename) > button').textContent`), 'Rename');
    await p.point('.state-fields:has(#topic-rename) > button');
    await until(() => p.calls.slice(before).find(c => c.payload?.kind === 'topic.update' && c.payload.args?.title === 'Renamed by its coordinator'), 'the rename is sent');
    await until(() => p.evaluate(`document.querySelector('#topic-title').textContent === 'Renamed by its coordinator'`), 'the title changes without a reload');
    assert.equal((await view('topic', { topic_id: made.topic_id })).topic.title, 'Renamed by its coordinator', 'Core took the coordinator\'s rename');
    await until(() => p.evaluate(`document.getAnimations().every(a=>a.playState!=='running')`), 'settled');
    await shot(p, 'header-coordinator');
    await p.key('Escape');
    await until(async () => !await isOpen(p), 'Escape closes it');
    // The owner takes the reader off the team: the outcome names no coordinator,
    // the reader still takes part, and the controls go while the page stays open.
    await control({ method: 'outcome_change', operation_id: 'header-coordinator-cleared', sender: facts.agent, workspace_id: made.workspace_id, member: facts.actor, present: false });
    await until(async () => { const m = await managing(p); return !m.rename && !m.add && !m.removes.length; }, 'Rename, the add field and the remove buttons go without a reload');
    assert.equal(await p.evaluate(`document.querySelector('#topic-title').textContent`), 'Renamed by its coordinator', 'the topic stays open');
    assert.deepEqual(p.errors, []);
  });

  await check('header an open topic page shows its outcome handed to the reader, and handed on again, without a reload', async () => {
    const made = await control({ method: 'agent_topic', operation_id: 'header-handover', title: 'Handed over', body: 'Yours soon.', team: true });
    const p = await openTopic('header-handover', made, 'Handed over');
    assert.deepEqual(await managing(p), { rename: false, add: false, removes: [] }, 'a member who neither owns, coordinates nor started it manages nothing');
    await control({ method: 'outcome_change', operation_id: 'header-handover-to-reader', sender: facts.agent, workspace_id: made.workspace_id, owner: facts.actor });
    await until(async () => { const m = await managing(p); return m.rename && m.add; }, 'the new owner\'s Rename and add field arrive without a reload');
    assert.equal((await view('workspace', { workspace_id: made.workspace_id })).workspace.owner_id, facts.actor);
    await control({ method: 'outcome_change', operation_id: 'header-handover-back', sender: facts.actor, workspace_id: made.workspace_id, owner: facts.agent });
    await until(async () => { const m = await managing(p); return !m.rename && !m.add; }, 'handed back, they go again without a reload');
    assert.deepEqual(p.errors, []);
  });

  await check('header the outcome\'s coordinator adds to its team on the outcome page, and the owner\'s chip stays fixed', async () => {
    const made = await control({ method: 'agent_topic', operation_id: 'header-team', title: 'Team topic', body: 'Who is on it?', coordinator: true });
    const p = await page('header-team', null, true, { url: `${facts.origin}/?workspace=${made.workspace_id}` });
    const team = () => p.evaluate(`(()=>{const add=document.querySelector('#team-people .people-add');
      return {shown:!document.querySelector('#outcome-team').hidden,add:Boolean(add&&!add.hidden),chips:[...document.querySelectorAll('#team-people .chips > *')].map(c=>c.firstChild.textContent),
        removes:[...document.querySelectorAll('#team-people [aria-label^="Remove "]')].map(b=>b.getAttribute('aria-label'))}})()`);
    await until(async () => (await team()).chips.length === 2, 'the team painted');
    const shown = await team();
    assert.deepEqual([shown.shown, shown.add], [true, true], 'the coordinator gets the add field');
    assert.ok(!shown.removes.includes(`Remove ${facts.agent}`), 'the owner cannot be removed: ' + JSON.stringify(shown));
    await p.point('#team-people .people-add input');
    await p.send('Input.insertText', { text: 'fixture-outside-agent' });
    await p.key('Enter');
    await until(async () => (await team()).chips.includes('fixture-outside-agent'), 'the coordinator\'s add shows on the team');
    const members = await view('workspace_members', { workspace_id: made.workspace_id });
    assert.ok(members.items.some(m => m.actor_id === 'fixture-outside-agent'), 'Core took it: ' + JSON.stringify(members.items));
    await shot(p, 'header-team-coordinator');
    assert.deepEqual(p.errors, []);
  });

  await check('header a press on the backdrop closes Topic settings and a press on its own empty space does not', async () => {
    const p = await page('header-backdrop', null, true);
    await openByPointer(p);
    const b = await p.box('#topic-settings');
    assert.ok(b.x > 40, 'there is backdrop beside the dialog at 1440');
    // Inside the dialog's box, on its own empty space at the bottom right corner.
    const corner = [b.x + b.width - 6, b.y + b.height - 6];
    assert.equal(await p.evaluate(`Boolean(document.elementFromPoint(${corner[0]},${corner[1]})?.closest('#topic-settings'))`), true, 'the corner is the dialog\'s own');
    await press(p, ...corner);
    assert.equal(await p.evaluate(`new Promise(r=>requestAnimationFrame(()=>r(document.querySelector('#topic-settings').open)))`), true, 'a press inside the dialog keeps it open');
    await press(p, b.x / 2, b.y + b.height / 2);
    await until(async () => !await isOpen(p), 'a press on the backdrop closes it');
    assert.equal(await focused(p), 'settings-open', 'the focus is back on the gear');
    await openByPointer(p);
    await p.point('#settings-close');
    await until(async () => !await isOpen(p), '✕ closes it');
    assert.equal(await focused(p), 'settings-open');
    assert.deepEqual(p.errors, []);
  });

  for (const theme of ['light', 'dark']) {
    await check(`header on a phone Topic settings fills the screen and only ✕ and Escape close it, ${theme}`, async () => {
      await setState('header-phone-' + theme, { state: 'done', note: 'Shipped: the server owns topic openings, and every reader sees the same place' });
      const p = await page('header-phone-' + theme, null, true, { beforeNavigate: both(phone, scheme(theme)) });
      await until(async () => (await subtitle(p)).states[0] === 'Done', 'phone page painted');
      const shut = await p.evaluate(`(()=>{const g=document.querySelector('#settings-open').getBoundingClientRect(),t=document.querySelector('#topic-title').getBoundingClientRect();return {gear:[g.width,g.height],row:g.top<t.bottom&&g.bottom>t.top,right:g.right<=innerWidth}})()`);
      assert.deepEqual(shut, { gear: [44, 44], row: true, right: true }, 'the gear stays on the title\'s row, 44 px square');
      assert.equal(await noSideways(p), true, 'no sideways scroll with the dialog shut');
      await tapOn(p, '#settings-open');
      await until(() => isOpen(p), 'a tap on the gear opens it');
      // Measured once its opening animation has run, as the person sees it.
      await until(() => p.evaluate(`document.getAnimations().every(a=>a.playState!=='running')`), 'the dialog settled');
      const full = await p.evaluate(`(()=>{const b=document.querySelector('#topic-settings').getBoundingClientRect();return {box:[b.x,b.y,b.width,b.height],viewport:[innerWidth,innerHeight],font:getComputedStyle(document.querySelector('#topic-state-note')).fontSize}})()`);
      assert.deepEqual(full.box, [0, 0, ...full.viewport], 'the dialog fills the screen');
      assert.equal(full.font, '16px', 'its fields are 16px, so the phone does not zoom');
      assert.equal(await noSideways(p), true, 'no sideways scroll with the dialog open');
      await tap(p, full.viewport[0] / 2, full.viewport[1] - 12);
      assert.equal(await p.evaluate(`new Promise(r=>requestAnimationFrame(()=>r(document.querySelector('#topic-settings').open)))`), true, 'a tap on the empty space at the bottom keeps it open');
      await shot(p, 'header-phone-open-' + theme);
      await tapOn(p, '#settings-close');
      await until(async () => !await isOpen(p), '✕ closes it');
      assert.equal(await focused(p), 'settings-open', 'the focus is back on the gear');
      await shot(p, 'header-phone-shut-' + theme);
      assert.deepEqual(p.errors, []);
    });
  }

  // The keyboard ring drawn around each button in a pill, read from the
  // screen: on every side of the button, just outside it, the ring's own
  // colour is painted. Nothing may hide it, not the pill itself.
  await check('header Tab through the people shows the whole focus ring around each button in a pill', async () => {
    await setState('header-rings-active', { state: 'active', note: '' });
    const p = await page('header-rings', null, true, { beforeNavigate: scheme('light') });
    const buttons = `[...document.querySelectorAll('#topic-people .person-pill button')]`;
    await until(() => p.evaluate(`${buttons}.length >= 3`), 'the people painted, with a pill button to open a colour and remove buttons');
    await p.evaluate(`document.querySelector('#topic-people').scrollIntoView({block:'center'})`);
    const rect = e => `(e=>{const b=e.getBoundingClientRect();return {left:b.left,top:b.top,right:b.right,bottom:b.bottom}})(${e})`;
    const screen = async () => pngPixels(Buffer.from((await p.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    // How much of each side's band, 1 to 6 px outside the button, holds the ring's colour.
    const ringSides = (image, b, color) => {
      const near = (x, y) => x >= 0 && y >= 0 && x < image.width && y < image.height && image.pixel(x, y).every((v, i) => Math.abs(v - color[i]) <= 30);
      const xs = [], ys = [];
      for (let x = Math.ceil(b.left); x < Math.floor(b.right); x++) xs.push(x);
      for (let y = Math.ceil(b.top); y < Math.floor(b.bottom); y++) ys.push(y);
      const band = (from, to) => { const out = []; for (let d = from; d <= to; d++) out.push(d); return out; };
      const share = (along, hit) => along.filter(hit).length / along.length;
      return {
        top: share(xs, x => band(1, 6).some(d => near(x, Math.floor(b.top) - d))),
        bottom: share(xs, x => band(0, 5).some(d => near(x, Math.ceil(b.bottom) + d))),
        left: share(ys, y => band(1, 6).some(d => near(Math.floor(b.left) - d, y))),
        right: share(ys, y => band(0, 5).some(d => near(Math.ceil(b.right) + d, y))),
      };
    };
    const focusColor = (await p.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--focus').trim()`)).match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i).slice(1).map(h => parseInt(h, 16));
    // With the focus away from the people, no button in a pill shows the ring's colour around it.
    await p.evaluate(`document.querySelector('#more-messages').hidden ? document.querySelector('#messages [data-id]').focus({preventScroll:true}) : document.querySelector('#more-messages').focus({preventScroll:true})`);
    const quiet = await screen();
    for (const b of await p.evaluate(`${buttons}.map(e=>${rect('e')})`)) {
      const sides = ringSides(quiet, b, focusColor);
      assert.ok(Object.values(sides).every(s => s === 0), 'no ring around an unfocused pill button: ' + JSON.stringify(sides));
    }
    // From the control just before the people, Tab stops on each pill button in turn.
    await p.evaluate(`(()=>{const people=document.querySelector('#topic-people'),all=[...document.querySelectorAll('button,input,a[href],[tabindex]:not([tabindex="-1"])')].filter(e=>!e.disabled&&e.getClientRects().length&&people.compareDocumentPosition(e)&Node.DOCUMENT_POSITION_PRECEDING);all.at(-1).focus({preventScroll:true})})()`);
    const expected = await p.evaluate(`${buttons}.map(e=>e.getAttribute('aria-label')||e.title)`);
    const seen = [];
    for (;;) {
      await p.key('Tab');
      const at = await p.evaluate(`(a=>({pill:Boolean(a.closest('.person-pill')),name:a.getAttribute('aria-label')||a.title,visible:a.matches(':focus-visible'),style:getComputedStyle(a).outlineStyle,box:${rect('a')}}))(document.activeElement)`);
      if (!at.pill) break;
      seen.push(at.name);
      assert.deepEqual([at.visible, at.style], [true, 'solid'], `${at.name}: the browser draws its keyboard ring`);
      await until(() => p.evaluate("document.getAnimations().every(a=>a.playState!=='running')"), 'settled');
      const sides = ringSides(await screen(), at.box, focusColor);
      if (seen.length === 1) await shot(p, 'header-ring-first-pill-button');
      for (const [side, share] of Object.entries(sides)) assert.ok(share >= 0.5, `${at.name}: the ring shows along its ${side} side (${share.toFixed(2)} of it): ${JSON.stringify(sides)}`);
    }
    assert.deepEqual(seen, expected, 'Tab stops on every button in the pills, in order');
    assert.ok(seen.some(name => name.startsWith('Change ')) && seen.some(name => name.startsWith('Remove ')), 'an agent\'s colour button and a remove button among them');
    assert.deepEqual(p.errors, []);
  });

  await check('header the people are one filled pill each after the last message, and a remove button sits in its pill', async () => {
    await setState('header-people-active', { state: 'active', note: '' });
    // More messages than one page, all read, so More messages shows below them.
    await control({ method: 'seed', messages: 32 });
    await control({ method: 'agent_message', operation_id: 'header-people-read', body: 'Read up to here.', read: true });
    const agent = facts.agent;
    const people = p => p.evaluate(`(()=>{const pills=[...document.querySelectorAll('#topic-people .person-pill')];return pills.map(e=>{const c=getComputedStyle(e),name=e.firstElementChild,out=e.querySelector('.pill-remove'),pb=e.getBoundingClientRect(),ob=out?.getBoundingClientRect();
      return {name:name.textContent,button:name.tagName==='BUTTON',title:name.title,fill:c.backgroundColor,border:[c.borderTopWidth,c.borderRightWidth,c.borderBottomWidth,c.borderLeftWidth],shadow:c.boxShadow,
        remove:out?{label:out.getAttribute('aria-label'),inside:ob.left>=pb.left-0.5&&ob.right<=pb.right+0.5&&ob.top>=pb.top-0.5&&ob.bottom<=pb.bottom+0.5,size:[ob.width,ob.height]}:null,
        buttonInButton:Boolean(e.querySelector('button button'))}})})()`);
    const below = p => p.evaluate(`(()=>{const cards=[...document.querySelectorAll('#messages [data-id]')].filter(e=>e.getBoundingClientRect().height>0),last=cards.at(-1).getBoundingClientRect(),more=document.querySelector('#more-messages');
      const top=document.querySelector('#topic-people').getBoundingClientRect().top;return {cards:cards.length,belowCard:top>=last.bottom,belowMore:more.hidden||top>=more.getBoundingClientRect().bottom,next:more.nextElementSibling.id}})()`);
    const p = await page('header-people', null, true, { beforeNavigate: scheme('light') });
    await until(async () => (await people(p)).length >= 2, 'the people painted');
    const first = await below(p);
    assert.deepEqual([first.belowCard, first.belowMore, first.next], [true, true, 'topic-people'], 'the people come right after More messages, below the last message: ' + JSON.stringify(first));
    assert.equal(await p.evaluate(`document.querySelector('#more-messages').hidden`), false, 'a topic with more than a page shows More messages');
    await p.evaluate(`document.querySelector('#more-messages').scrollIntoView({block:'center'})`);
    await p.point('#more-messages');
    const later = await until(async () => { const b = await below(p); return b.cards > first.cards && b; }, 'More messages loads the next page');
    assert.deepEqual([later.belowCard, later.belowMore], [true, true], 'still below the new last message');
    const light = await people(p);
    const own = light.find(x => x.name === facts.actor), theirs = light.find(x => x.name === agent);
    assert.deepEqual([own.button, own.fill], [false, 'rgb(0, 0, 0)'], 'the reader\'s own pill is black and opens nothing');
    assert.deepEqual([theirs.button, theirs.title], [true, `Change ${agent}'s color`], 'an agent\'s pill opens its colour picker');
    for (const pill of light) {
      assert.notEqual(pill.fill, 'rgba(0, 0, 0, 0)', `${pill.name}'s pill is filled`);
      assert.deepEqual([pill.border, pill.shadow, pill.buttonInButton], [['0px', '0px', '0px', '0px'], 'none', false], `${pill.name}'s pill has no ring`);
      assert.deepEqual([pill.remove?.label, pill.remove?.inside], [`Remove ${pill.name}`, true], `${pill.name}'s remove button is inside the pill`);
      assert.ok(pill.remove.size[0] >= 32 && pill.remove.size[1] >= 32, 'a finger hits the remove button: ' + pill.remove.size);
    }
    await p.evaluate(`document.querySelector('#topic-people').scrollIntoView({block:'center'})`);
    await shot(p, 'header-people-light');
    const dark = await page('header-people-dark', null, true, { beforeNavigate: scheme('dark') });
    await until(async () => (await people(dark)).length >= 2, 'the people painted, dark');
    for (const pill of await people(dark)) {
      if (pill.name === facts.actor) assert.deepEqual([pill.fill, pill.shadow === 'none'], ['rgb(0, 0, 0)', false], 'dark: the reader\'s pill is black with a thin edge');
      else assert.deepEqual([pill.fill === 'rgba(0, 0, 0, 0)', pill.shadow], [false, 'none'], `dark: ${pill.name}'s pill is filled, with no ring`);
    }
    await dark.evaluate(`document.querySelector('#topic-people').scrollIntoView({block:'center'})`);
    await shot(dark, 'header-people-dark');
    await dark.close();
    const small = await page('header-people-phone', null, true, { beforeNavigate: phone });
    await until(async () => (await people(small)).length >= 2, 'the people painted on a phone');
    for (const pill of await people(small)) assert.equal(pill.remove?.inside, true, `390: ${pill.name}'s remove button is inside the pill`);
    assert.equal(await noSideways(small), true, '390: no sideways scroll');
    await small.close();
    // The owner removes the agent with a real press on the button inside its pill.
    const remove = `#topic-people [aria-label="Remove ${agent}"]`;
    await p.evaluate(`document.querySelector(${JSON.stringify(remove)}).scrollIntoView({block:'center'})`);
    await p.point(remove);
    await until(async () => !(await people(p)).some(x => x.name === agent), 'its pill leaves');
    assert.equal(await p.evaluate(`document.activeElement?.matches('#participants .people-add input')`), true, 'the focus is on the add field');
    assert.equal((await view('topic', { topic_id: 't1' })).participants.some(row => row.actor_id === agent), false, 'Core took it out');
    assert.deepEqual(p.errors, []);
  });
}
