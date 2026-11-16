import assert from 'node:assert/strict';
import { pngPixels } from './png-bands.mjs';

// The top of a topic, Topic settings and its Team, in the real browser against
// the real server: the title with its gear and the note under it, the dialog's
// keyboard, pointer and phone behaviour, and one pill per person in the Team on
// the title row's right (item 465). Every press and key is a native input event.
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
  // Where it stands, as the person sees it: the lit chips, and the topic as Core holds it.
  const lit = p => p.evaluate(`[...document.querySelectorAll('#topic-state button[aria-pressed=true]')].map(b=>b.textContent)`);
  const held = async (topic_id = 't1') => (await view('topic', { topic_id })).topic;
  const updates = (p, from = 0) => p.calls.slice(from).filter(c => c.payload?.kind === 'topic.update').map(c => c.payload);
  const notice = p => p.evaluate(`(n=>n.hidden?null:[n.textContent,n.classList.contains('quiet')])(document.querySelector('#topic-state .notice'))`);
  // The people a waiting topic offers, once shown.
  const offered = p => p.evaluate(`(g=>g&&!g.closest('[hidden]')?[...g.querySelectorAll('button')].map(b=>b.textContent):null)(document.querySelector('#topic-state .people-chips'))`);
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
      return {parts:[...h.children].filter(e=>!e.hidden).map(e=>e.id||e.className),row:[...row.children].map(e=>e.id),
        eyebrow:[...document.querySelector('.eyebrow-row').children].map(e=>[e.id,e.getClientRects().length>0]),
        gear:{name:g.getAttribute('aria-label'),title:g.title,popup:g.getAttribute('aria-haspopup'),hidden:g.hidden,size:[gb.width,gb.height],middle:gb.top+gb.height/2,left:gb.left},
        line:{top:tb.top+parseFloat(ts.paddingTop),height:parseFloat(ts.lineHeight),right:tb.right},
        hint:leaves.some(e=>e.textContent.trim()===${JSON.stringify(HINT)}),
        thisTopic:leaves.some(e=>e.textContent.trim()==='This topic'||e.getAttribute('aria-label')==='This topic'),
        stateInMain:Boolean(document.querySelector('main #topic-state')),stateInDialog:Boolean(document.querySelector('dialog#topic-settings #topic-state'))}})()`);
    assert.deepEqual(top.parts, ['eyebrow-row', 'title-row', 'topic-description', 'topic-people'], 'the outcome\'s name, the title row, then the subtitle and the Team (item 465)');
    assert.deepEqual(top.eyebrow, [['rail-open', false], ['workspace-name', true], ['things-open', false]], 'the outcome\'s name, with "☰ Outcomes" before it shown only on a phone, and "Pipeline & pages" after it only below laptop width');
    // New message, a quiet ✎, ends the row (docs/reader.md).
    assert.deepEqual(top.row, ['topic-title', 'settings-open', 'new-message'], 'the gear shares the title\'s row, after it, and New message ends it');
    assert.deepEqual([top.gear.name, top.gear.title, top.gear.popup, top.gear.hidden, top.gear.size], ['Topic settings', 'Topic settings', 'dialog', false, [44, 44]]);
    assert.ok(top.gear.middle >= top.line.top && top.gear.middle <= top.line.top + top.line.height, 'the gear\'s middle is level with the title\'s first line: ' + JSON.stringify(top));
    assert.ok(top.gear.left >= top.line.right, 'the gear is at the upper right, beside the title');
    assert.deepEqual([top.hint, top.thisTopic, top.stateInMain, top.stateInDialog], [false, false, false, true], 'no hint, no "This topic" row, and where it stands only inside Topic settings');
    assert.deepEqual((await subtitle(p)).states, [], 'a plainly Active topic shows no state word');
    await shot(p, 'header-top');
    // Done, tapped in Topic settings: the subtitle follows at once, the word
    // then the whole note, which stays with the topic across the tap.
    await openByPointer(p);
    const before = p.calls.length;
    await p.point('#topic-state [data-state=done]');
    const done = await until(async () => { const s = await subtitle(p); return s.states[0] === 'Done' && s; }, 'the subtitle shows Done without a reload');
    assert.equal(done.text, 'Done ' + NOTE, 'the state word, a space, then every word of the note, "Ongoing:" kept');
    assert.deepEqual(updates(p, before).map(u => u.args), [{ state: 'done', keep_note: true }], 'one tap, one change; Core keeps the note');
    // A new note, saved on Return, follows too; Return does not close Topic settings.
    await p.point('#topic-state-note'); await p.key('a', 4);
    await p.send('Input.insertText', { text: 'Ongoing: shipped in release 21' });
    await p.key('Enter');
    await until(async () => (await subtitle(p)).text === 'Done Ongoing: shipped in release 21', 'Return saves the note and the subtitle follows');
    assert.deepEqual([(await held()).state, (await held()).state_note, await isOpen(p)], ['done', 'Ongoing: shipped in release 21', true]);
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

  // Tony, 10 Nov: a shipped piece's topic waits Ready for review until he marks
  // it Done, with one tap at the top of the topic.
  const doneButton = p => p.evaluate(`(b=>b?{name:b.getAttribute('aria-label'),text:b.textContent,visible:b.getClientRects().length>0,height:b.getBoundingClientRect().height,
    beside:b.previousElementSibling?.classList.contains('topic-state')??false}:null)(document.querySelector('#topic-description .mark-done'))`);
  // The open outcome's Done group in the outline: its count, and the topics it lists once opened.
  const doneGroup = p => p.evaluate(`(()=>{const o=[...document.querySelectorAll('#outline .ol-outcome')].find(li=>li.querySelector('a[data-topic-id=t1]')||li.dataset.workspaceId==='w1');
    const d=[...(o?.querySelectorAll('details.topic-group')??[])].find(e=>e.querySelector('summary')?.textContent.startsWith('Done'));
    const row=o?.querySelector('a[data-topic-id=t1]');
    return d?{label:d.querySelector('summary').textContent,open:d.open,hidden:d.hidden,listed:[...d.querySelectorAll('a[data-topic-id]')].map(a=>a.dataset.topicId),
      inDone:Boolean(row&&row.closest('details.topic-group')===d),activeRow:Boolean(row&&!row.closest('details.topic-group'))}:null})()`);
  const space = async p => {
    const data = { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 };
    await p.send('Input.dispatchKeyEvent', { type: 'keyDown', ...data, text: ' ', unmodifiedText: ' ' });
    await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...data });
  };
  const LIVE = 'Live in release 43 since 9:05 AM Tue Nov 10';

  await check('header a topic Ready for review shows ✅ Done beside its state; a click marks it Done, into the Done group, and the button goes; an active topic shows none', async () => {
    await setState('header-done-active', { state: 'active', note: NOTE });
    const p = await page('header-done-click', null, true);
    await until(async () => (await subtitle(p)).text === 'Each release and what comes next', 'the active topic painted');
    assert.equal(await doneButton(p), null, 'an active topic shows no ✅');
    await setState('header-done-review', { state: 'review', note: LIVE });
    const shown = await until(async () => { const b = await doneButton(p); return b?.visible && b; }, '✅ Done shows, live, once the topic is Ready for review');
    assert.deepEqual([shown.name, shown.text, shown.beside, shown.height >= 44], ['Mark done', '✅ Done', true, true], 'a button named Mark done, right after the state, big enough to tap: ' + JSON.stringify(shown));
    assert.equal((await subtitle(p)).text, 'Ready for review ✅ Done ' + LIVE);
    const before = p.calls.length, count = Number(((await doneGroup(p))?.label.match(/\d+/) ?? [0])[0]);
    await shot(p, 'header-review-done-button');
    await p.point('#topic-description .mark-done');
    const done = await until(async () => { const s = await subtitle(p); return s.states[0] === 'Done' && s; }, 'one click: the topic reads Done');
    assert.equal(done.text, 'Done ' + LIVE, 'the note stays with it');
    assert.equal(await doneButton(p), null, 'and the button is gone');
    assert.deepEqual(updates(p, before).map(u => u.args), [{ state: 'done', keep_note: true }], 'one click, one change, as the Done chip makes it');
    assert.deepEqual([(await held()).state, (await held()).state_note, (await held()).state_by], ['done', LIVE, facts.actor]);
    // It moves into the outcome's Done group in the outline, as the chip moves it.
    await until(async () => { const g = await doneGroup(p); return g && !g.hidden && !g.activeRow && g.label === `Done (${count + 1})`; }, 'the outline counts it Done and lists it no more among the active topics');
    if (!(await doneGroup(p)).open) await p.point('#outline details.topic-group:not([hidden]) > summary');
    await until(async () => (await doneGroup(p))?.inDone, 'opened, the Done group lists it');
    await shot(p, 'header-review-marked-done');
    assert.deepEqual(p.errors, []);
  });

  await check('header ✅ Done is reached with Tab and pressed with Return or Space, and the focus lands on the subtitle saying Done', async () => {
    await setState('header-done-keys-review', { state: 'review', note: LIVE });
    const p = await page('header-done-keys', null, true);
    await until(async () => (await doneButton(p))?.visible, '✅ Done shows');
    for (const [press, name] of [[q => q.key('Enter'), 'Return'], [space, 'Space']]) {
      await until(async () => (await doneButton(p))?.visible, `✅ Done shows for ${name}`);
      await p.evaluate(`document.querySelector('#settings-open').focus()`);
      let stops = 0;
      const onIt = () => p.evaluate(`document.activeElement?.classList.contains('mark-done')`);
      while (!await onIt() && stops < 4) { await p.key('Tab'); stops += 1; }
      assert.equal(await p.evaluate(`document.activeElement?.classList.contains('mark-done')`), true, `Tab from the gear reaches ✅ Done (${name})`);
      assert.equal(await p.evaluate(`document.activeElement.matches(':focus-visible')`), true, 'its focus shows');
      const before = p.calls.length;
      await press(p);
      await until(async () => (await subtitle(p)).states[0] === 'Done' && !await doneButton(p), `${name} marks it Done and the button goes`);
      assert.deepEqual(updates(p, before).map(u => u.args), [{ state: 'done', keep_note: true }]);
      assert.equal(await focused(p), 'topic-description', 'the focus is on the subtitle, which says Done');
      if (name === 'Return') await setState('header-done-keys-again', { state: 'review', note: LIVE });
    }
    assert.deepEqual(p.errors, []);
  });

  await check('header a reader who may not say where a topic stands sees Ready for review and no ✅', async () => {
    const made = await control({ method: 'agent_topic', operation_id: 'header-done-watching', title: 'Shipped by the agent', body: 'Live now.', team: true, watching: true });
    await control({ method: 'agent_state', operation_id: 'header-done-watching-review', topic_id: made.topic_id, sender: 'fixture-notebook-agent', args: { state: 'review', note: LIVE } });
    assert.equal((await view('topic', { topic_id: made.topic_id })).topic.reader_may_say, false, 'Core does not let this reader say where it stands');
    const p = await page('header-done-watching', null, true, { url: `${facts.origin}/?topic=${made.topic_id}` });
    await until(async () => (await subtitle(p)).text === 'Ready for review ' + LIVE, 'the topic reads Ready for review');
    assert.equal(await doneButton(p), null, 'no ✅ for a reader Core does not let say where it stands');
    assert.equal(await p.evaluate(`document.querySelectorAll('#topic-state .state-chips button').length`), 0, 'and no chips in Topic settings either');
    assert.deepEqual(p.errors, []);
  });

  await check('header the gear opens Topic settings with where it stands set in place, no form; Escape closes it and the focus is back on the gear', async () => {
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
    const form = await p.evaluate(`(()=>{const d=document.querySelector('#topic-settings'),seen=e=>{const b=e?.getBoundingClientRect();return Boolean(b&&b.width>0&&b.height>0)};
      const note=d.querySelector('#topic-state-note'),rem=parseFloat(getComputedStyle(document.documentElement).fontSize);
      return {boxes:d.querySelectorAll('details,summary,select,textarea').length,saves:[...d.querySelectorAll('button')].filter(b=>/Save/.test(b.textContent)).length,
        chips:[...d.querySelectorAll('.state-chips button')].map(b=>[b.textContent,b.getAttribute('aria-pressed'),seen(b),b.getBoundingClientRect().width<=12*rem]),
        note:[seen(note),note.type,note.value,note.getBoundingClientRect().width<=32*rem],part:d.querySelector('#topic-responsibility').getBoundingClientRect().width<=32*rem,
        headings:[...d.querySelectorAll('h3')].map(h=>h.textContent),group:d.querySelector('.state-chips').getAttribute('aria-labelledby'),
        by:d.querySelector('.state-by').textContent,close:d.querySelector('#settings-close').getAttribute('aria-label')}})()`);
    assert.deepEqual([form.boxes, form.saves], [0, 0], 'no disclosure, dropdown, box or Save inside Topic settings');
    assert.deepEqual(form.chips, [['Active', 'true', true, true], ['Waiting', 'false', true, true], ['Ready for review', 'false', true, true], ['Done', 'false', true, true]],
      'four chips as soon as it opens, the one that holds lit, each as wide as its words');
    assert.deepEqual([form.note, form.part], [[true, 'text', NOTE, true], true], 'the note on one line, every word kept; no line wider than a sentence');
    assert.deepEqual(form.headings, ['Where it stands', 'Your part'], 'no second "Change where it stands"');
    assert.equal(form.group, 'stand-heading');
    assert.match(form.by, /^Set by you, /, 'and says who set it');
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
    const chips = ['Active', 'Waiting', 'Ready for review', 'Done'];
    const loop = [...chips, 'topic-state-note', 'topic-responsibility', 'Rename', 'Archive', 'settings-close'];
    assert.deepEqual(await tabs(p, loop.length), loop, 'from the last stop Tab wraps to ✕');
    assert.deepEqual(await tabs(p, 1, true), ['Archive'], 'Shift+Tab from ✕ goes to the last stop');
    await p.evaluate(`document.querySelector('#settings-title').focus()`);
    assert.deepEqual(await tabs(p, 1, true), ['Archive'], 'Shift+Tab from the title goes to the last stop');
    await p.point('#topic-state [data-state=waiting]');
    const people = await until(async () => { const names = await offered(p); return names?.length && names; }, 'Waiting offers the people');
    await p.evaluate(`document.querySelector('#settings-close').focus()`);
    assert.deepEqual(await tabs(p, chips.length + people.length + 1), [...chips, ...people, 'topic-state-note'], 'the people join between the chips and the note while it waits');
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
    const loop = ['Active', 'Waiting', 'Ready for review', 'Done', 'topic-state-note', 'topic-responsibility', 'settings-close'];
    assert.deepEqual(await tabs(p, loop.length), loop);
    assert.deepEqual(await tabs(p, 1, true), ['topic-responsibility']);
    await shot(p, 'header-tab-participant');
    assert.deepEqual(p.errors, []);
  });

  // Whoever organises an outcome, its owner and its coordinator, renames and
  // archives its topics and changes who takes part, beside each topic's
  // creator. The open page learns of a handover or a cleared coordinator from
  // the outcome's own change key: no topic version moves, and nothing reloads.
  const managing = p => p.evaluate(`(()=>{const people=document.querySelector('#participants .add-chip');
    return {rename:Boolean(document.querySelector('#topic-settings #topic-rename')),add:Boolean(people&&people.isConnected&&!people.hidden),
      removes:[...document.querySelectorAll('#participants [aria-label^="Remove "]')].map(b=>b.getAttribute('aria-label'))}})()`);
  const openTopic = async (suffix, made, title) => {
    const p = await page(suffix, null, true, { url: `${facts.origin}/?topic=${made.topic_id}` });
    await until(() => p.evaluate(`document.querySelector('#topic-title').textContent === ${JSON.stringify(title)} && !document.querySelector('#settings-open').hidden`), 'the agent\'s topic open');
    return p;
  };

  await check('header the outcome\'s coordinator renames a topic they did not start and changes who takes part, until they no longer coordinate', async () => {
    const made = await control({ method: 'agent_topic', operation_id: 'header-coordinator', title: 'Coordinated by the reader', body: 'Tidy this one.', coordinator: true });
    const p = await openTopic('header-coordinator', made, 'Coordinated by the reader');
    await until(async () => (await managing(p)).add, '"+ Add" shows for the coordinator');
    const coordinating = await managing(p);
    assert.deepEqual([coordinating.rename, coordinating.add, coordinating.removes.includes(`Remove ${facts.actor}`)], [true, true, true],
      'the coordinator renames, archives and changes who takes part: ' + JSON.stringify(coordinating));
    await openByPointer(p);
    // Rename puts the title on one line, all of it selected; Return saves it.
    await p.point('#topic-state .settings-actions button:first-of-type');
    await until(async () => await focused(p) === 'topic-rename', 'the title line takes the focus');
    const before = p.calls.length;
    await p.send('Input.insertText', { text: 'Renamed by its coordinator' });
    await p.key('Enter');
    await until(() => p.calls.slice(before).find(c => c.payload?.kind === 'topic.update' && c.payload.args?.title === 'Renamed by its coordinator'), 'the rename is sent');
    await until(() => p.evaluate(`document.querySelector('#topic-title').textContent === 'Renamed by its coordinator'`), 'the title changes without a reload');
    assert.equal((await view('topic', { topic_id: made.topic_id })).topic.title, 'Renamed by its coordinator', 'Core took the coordinator\'s rename');
    await until(() => p.evaluate(`document.getAnimations().filter(x=>x.effect?.getTiming().iterations!==Infinity).every(a=>a.playState!=='running')`), 'settled');
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
    const team = () => p.evaluate(`(()=>{const add=document.querySelector('#team-people .add-chip');
      return {shown:!document.querySelector('#outcome-team').hidden,add:Boolean(add&&add.isConnected&&!add.hidden),chips:[...document.querySelectorAll('#team-people .chips > :not(.add-chip)')].map(c=>c.firstChild.textContent),
        removes:[...document.querySelectorAll('#team-people [aria-label^="Remove "]')].map(b=>b.getAttribute('aria-label'))}})()`);
    await until(async () => (await team()).chips.length === 2, 'the team painted');
    const shown = await team();
    assert.deepEqual([shown.shown, shown.add], [true, true], 'the coordinator gets "+ Add"');
    assert.ok(!shown.removes.includes(`Remove ${facts.agent}`), 'the owner cannot be removed: ' + JSON.stringify(shown));
    // The outcome page puts its Target above the topics and the team (D11), so the team can sit below the fold.
    await p.evaluate(`document.querySelector('#team-people .add-chip').scrollIntoView({block:'center'})`);
    await p.point('#team-people .add-chip');
    await until(() => p.evaluate(`document.activeElement?.matches('#team-people .people-add input')`), '"+ Add" opens the filter with the caret in it');
    await p.send('Input.insertText', { text: 'fixture-outside-agent' });
    await p.key('Enter');
    await until(async () => (await team()).chips.includes('fixture-outside-agent'), 'the coordinator\'s add shows on the team');
    const members = await view('workspace_members', { workspace_id: made.workspace_id });
    assert.ok(members.items.some(m => m.actor_id === 'fixture-outside-agent'), 'Core took it: ' + JSON.stringify(members.items));
    await shot(p, 'header-team-coordinator');
    assert.deepEqual(p.errors, []);
  });

  await check('header renamed agent shows its current name in team and topic pickers while click and Return retain its identity', async () => {
    const id = 'fixture-outside-agent', name = 'codex';
    const made = await control({ method: 'agent_topic', operation_id: 'header-renamed-team', title: 'Current names', body: 'Keep the same agent.', coordinator: true });
    await control({ method: 'actor_name', actor_id: id, name });
    try {
      const p = await page('header-renamed-team', null, true, { url: `${facts.origin}/?workspace=${made.workspace_id}` });
      const chip = `#team-people .people-chips [data-id="${id}"]`;
      await until(() => p.evaluate(`Boolean(document.querySelector('#team-people .add-chip'))`), 'team management appears');
      await p.evaluate(`document.querySelector('#team-people .add-chip').scrollIntoView({block:'center'})`);
      await p.point('#team-people .add-chip');
      await p.send('Input.insertText', { text: name });
      await until(() => p.evaluate(`document.querySelector('${chip}')?.textContent === 'codex'`), 'the current name is offered');
      await p.point(chip);
      const inTeam = async () => (await view('workspace_members', { workspace_id: made.workspace_id })).items.some(m => m.actor_id === id && m.name === name);
      await until(inTeam, 'click adds the original actor, with its current name');
      await until(() => p.evaluate(`Boolean(document.querySelector('#team-people [aria-label="Remove codex"]'))`), 'team pill also uses the current name');
      await shot(p, 'header-renamed-team');
      await p.point('#team-people [aria-label="Remove codex"]');
      await until(async () => !await inTeam(), 'remove uses the same actor');
      await p.point('#team-people .people-add input');
      await p.key('a', 4);
      await p.send('Input.insertText', { text: 'CoDeX' });
      await p.key('Enter');
      await until(inTeam, 'Return resolves the current name to that same actor');

      const q = await page('header-renamed-topic', null, true, { url: `${facts.origin}/?topic=${made.topic_id}` });
      await until(() => q.evaluate(`Boolean(document.querySelector('#participants .add-chip'))`), 'topic management appears');
      await q.evaluate(`document.querySelector('#participants').scrollIntoView({block:'center'})`);
      await q.point('#participants .add-chip');
      await q.send('Input.insertText', { text: name });
      await until(() => q.evaluate(`document.querySelector('#participants [data-id="${id}"]')?.textContent === 'codex'`), 'topic picker offers current name');
      await q.key('Enter');
      await until(async () => (await view('topic', { topic_id: made.topic_id })).participants.some(m => m.actor_id === id && m.active), 'topic joins original actor');
      await until(() => q.evaluate(`Boolean(document.querySelector('#participants [aria-label="Remove codex"]')) && [...document.querySelectorAll('#participants .pill-name')].some(b => b.textContent === 'codex')`), 'the topic color/name button also uses current name');
      await shot(q, 'header-renamed-topic');
      const message = (await control({ method: 'agent_message', operation_id: 'header-renamed-message', sender: id, topic_id: made.topic_id, whole_topic: true, body: 'Same agent, current name.' })).result.message_id;
      const card = `#messages .message-card[data-id="${message}"]`;
      await until(() => q.evaluate(`document.querySelector('${card} .author-name')?.textContent === 'codex'`), 'the new message badge uses current name');
      assert.equal((await view('source', { source_ref: { kind: 'message', id: message } })).author, id, 'the message remains attributed to its original actor');
      await q.evaluate(`document.querySelector('${card}').scrollIntoView({block:'center'})`);
      await q.point(`${card} .message-preview`);
      await until(() => q.evaluate(`document.querySelector('#reader').open && document.querySelector('#reader-origin').textContent.startsWith('codex')`), 'the Reader also uses current name');
      await until(() => q.evaluate(`document.querySelector('#recipient-chips [data-name="${id}"]')?.textContent === 'codex'`), 'reply recipient choice uses current name');
      assert.equal(await q.evaluate(`document.querySelector('#who-chip').textContent`), 'Tell codex · everyone here');
      assert.equal(await q.evaluate(`document.querySelector('#writing-to').textContent`), 'To codex');
      assert.ok((await q.evaluate(`document.querySelector('#writing-body').placeholder`)).startsWith('Reply to codex'));
      await shot(q, 'header-renamed-reader');
      const body = 'Reply addressed to the same renamed agent.';
      await q.point('#writing-body');
      await q.send('Input.insertText', { text: body });
      await until(() => q.evaluate(`document.querySelector('#writing-body').value === ${JSON.stringify(body)}`), 'reply is written');
      await q.point('#send-reply');
      const sent = await until(async () => (await view('topic_messages', { topic_id: made.topic_id, direction: 'before', limit: 20 })).items.find(item => item.body === body), 'Core records the reply');
      assert.deepEqual(sent.addressees, [id], 'display names never replace canonical recipients');
      assert.equal(sent.reply_to, message, 'the renamed author keeps the same reply thread');
      assert.deepEqual([...p.errors, ...q.errors], []);
    } finally {
      await control({ method: 'actor_name', actor_id: id, name: id });
    }
  });

  await check('header a tap on a chip saves at once, and while it waits each person is a chip whose tap is saved, the focus staying on it', async () => {
    await setState('header-chips-active', { state: 'active', note: 'Kept across taps' });
    const p = await page('header-chips', null, true);
    await openByPointer(p);
    const before = p.calls.length;
    await p.point('#topic-state [data-state=waiting]');
    await until(async () => (await lit(p))[0] === 'Waiting', 'Waiting is lit once Core took it');
    assert.deepEqual([await focused(p), await notice(p)], ['Waiting', ['Saved', true]], 'the focus stays on the chip tapped, and a quiet Saved follows');
    const people = await until(async () => { const names = await offered(p); return names?.length && names; }, 'the people show as chips');
    assert.equal(people[0], 'you', 'the reader first, as you');
    assert.ok(people.includes(facts.agent), 'the agent in the topic among them: ' + people);
    const agentChip = `#topic-state .people-chips button:nth-child(${people.indexOf(facts.agent) + 1})`;
    await p.point(agentChip);
    await until(async () => (await held()).waiting_on?.join() === facts.agent, 'Core waits on the agent');
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(agentChip)}).getAttribute('aria-pressed') === 'true'`), 'its chip lit');
    assert.equal(await focused(p), facts.agent, 'the focus stays on the person tapped');
    await until(async () => (await subtitle(p)).states[0] === 'Waiting on ' + facts.agent, 'the subtitle says whom it waits on');
    await p.point('#topic-state .people-chips button:first-child');
    await until(async () => [...(await held()).waiting_on].sort().join() === [facts.actor, facts.agent].sort().join(), 'you too');
    await p.point(agentChip);
    await until(async () => (await held()).waiting_on?.join() === facts.actor, 'a lit person tapped again is taken away');
    const sent = updates(p, before);
    assert.deepEqual(sent.slice(0, 2).map(u => u.args), [{ state: 'waiting', keep_note: true }, { state: 'waiting', waiting_on: [facts.agent], keep_note: true }]);
    assert.equal(sent.length, 4, 'one change for each tap');
    assert.deepEqual(sent.map(u => u.expected.topic_fields.waiting_on), [[], [], [facts.agent], [facts.actor, facts.agent].sort()], 'each fenced on who it waited on after the one before');
    await shot(p, 'header-chips-waiting');
    await p.point('#topic-state [data-state=active]');
    await until(async () => (await held()).state === 'active' && !(await offered(p)), 'Active: nobody to wait on');
    assert.deepEqual([(await held()).state_note, (await held()).waiting_on], ['Kept across taps', []]);
    assert.deepEqual(p.errors, []);
  });

  await check('header the note and your part save on Return or on leaving the line; Escape puts back and a second Escape closes; a tap right after typing saves both, neither waiting on the other', async () => {
    await setState('header-lines-active', { state: 'active', note: '' });
    const p = await page('header-lines', null, true);
    await openByPointer(p);
    await p.point('#topic-state-note'); await p.send('Input.insertText', { text: 'Saved on Return' }); await p.key('Enter');
    await until(async () => (await held()).state_note === 'Saved on Return', 'Return saves the note');
    await until(async () => (await subtitle(p)).text === 'Saved on Return', 'the subtitle follows');
    assert.deepEqual(await notice(p), ['Saved', true]);
    await p.send('Input.insertText', { text: ', not this' });
    await p.key('Escape');
    assert.deepEqual([await p.evaluate(`document.querySelector('#topic-state-note').value`), await isOpen(p), await focused(p)], ['Saved on Return', true, 'topic-state-note'],
      'Escape puts back what is saved, and Topic settings stays open');
    const parts = () => p.calls.filter(c => c.payload?.kind === 'responsibility.set').map(c => c.payload.args.note);
    await p.point('#topic-responsibility'); await p.key('a', 4); await p.send('Input.insertText', { text: 'Writes the release notes' });
    await p.point('#topic-state-note');
    const mine = async () => (await view('topic', { topic_id: 't1' })).participants.find(row => row.actor_id === facts.actor)?.responsibility;
    await until(async () => await mine() === 'Writes the release notes', 'leaving the line saves your part');
    assert.deepEqual(parts(), ['Writes the release notes']);
    assert.equal(updates(p).length, 1, 'the note left as saved is not sent again');
    await p.key('Escape');
    await until(async () => !await isOpen(p), 'with nothing to put back, Escape closes Topic settings');
    assert.equal(await focused(p), 'settings-open');
    // Typed, then a chip tapped straight away: leaving the line saves the note as the tap saves the state, side by side
    // (fields are independent, docs/topic-settings.md), so either may reach Core first.
    await openByPointer(p);
    await p.point('#topic-state-note'); await p.key('a', 4); await p.send('Input.insertText', { text: 'Typed then tapped' });
    const before = p.calls.length;
    await p.point('#topic-state [data-state=review]');
    await until(async () => { const t = await held(); return t.state === 'review' && t.state_note === 'Typed then tapped'; }, 'both saved');
    await until(async () => (await notice(p))?.[0] === 'Saved', 'no refusal');
    const sent = updates(p, before).sort((a, b) => ('note' in b.args) - ('note' in a.args));
    assert.deepEqual(sent.map(u => [u.expected.topic_fields, u.args]), [[{ note: 'Saved on Return' }, { note: 'Typed then tapped' }], [{ state: 'active', waiting_on: [] }, { state: 'review', keep_note: true }]],
      'leaving the line saves the note; the tap sends only the state');
    await shot(p, 'header-lines');
    assert.deepEqual(p.errors, []);
  });

  await check('header words typed back to the saved note and left follow a newer note, and a tap never puts the old words back', async () => {
    await setState('header-retyped-old', { state: 'active', note: 'Old' });
    const p = await page('header-retyped', null, true);
    await openByPointer(p);
    await p.point('#topic-state-note'); await p.key('a', 4); await p.send('Input.insertText', { text: 'Old' });
    await p.key('Tab');
    const before = p.calls.length;
    await setState('header-retyped-theirs', { state: 'active', note: 'Theirs' });
    await until(async () => (await subtitle(p)).text === 'Theirs', 'the page learns of their note');
    assert.equal(await p.evaluate(`document.querySelector('#topic-state-note').value`), 'Theirs', 'the line shows their note');
    await p.point('#topic-state [data-state=review]');
    await until(async () => (await held()).state === 'review', 'the tap saved');
    assert.deepEqual(updates(p, before).map(u => u.args), [{ state: 'review', keep_note: true }], 'only the tap was sent; it keeps their note without sending it');
    assert.equal((await held()).state_note, 'Theirs', 'their note is not reverted');
    assert.deepEqual(p.errors, []);
  });

  await check('header a line typed back to the saved note and left after a newer note arrived sends nothing; new words over a newer note are refused, said beside it and kept', async () => {
    const CHANGED = 'Someone else changed the note first, so yours was not saved; your words are kept. It now reads “Newer”: press Return to save yours in its place.';
    const line = p => p.evaluate(`document.querySelector('#topic-state-note').value`);
    await setState('header-left-old', { state: 'active', note: 'Old' });
    const p = await page('header-left', null, true);
    await openByPointer(p);
    await p.point('#topic-state-note'); await p.key('a', 4); await p.send('Input.insertText', { text: 'Old' });
    const before = p.calls.length;
    await setState('header-left-theirs', { state: 'active', note: 'Theirs' });
    await until(async () => (await subtitle(p)).text === 'Theirs', 'the page learns of their note');
    assert.equal(await line(p), 'Old', 'the line the person is in keeps what they typed');
    await p.key('Tab');
    await until(async () => await line(p) === 'Theirs', 'the line, left, shows their note');
    assert.deepEqual(updates(p, before), [], 'leaving sent nothing');
    assert.deepEqual([(await held()).state_note, await notice(p)], ['Theirs', null], 'their note stands, and nothing says Saved');
    // New words, then a newer note while the person is still in the line: leaving is refused, said, and the words kept.
    await p.point('#topic-state-note'); await p.key('a', 4); await p.send('Input.insertText', { text: 'Mine' });
    await setState('header-left-newer', { state: 'active', note: 'Newer' });
    await until(async () => (await subtitle(p)).text === 'Newer', 'the page learns of the newer note');
    await p.key('Tab');
    await until(async () => (await notice(p))?.[0] === CHANGED, 'the refusal is said');
    assert.deepEqual(updates(p, before).map(u => u.args), [{ note: 'Mine' }]);
    assert.deepEqual([(await held()).state_note, await line(p), (await notice(p))[1]], ['Newer', 'Mine', false], 'the newer note stands; the words are kept');
    // Told, the person presses Return in the line, and their words are saved.
    await p.point('#topic-state-note'); await p.key('Enter');
    await until(async () => (await held()).state_note === 'Mine', 'Core holds their words');
    await until(async () => (await notice(p))?.join() === 'Saved,true', 'a quiet Saved');
    assert.deepEqual(p.errors, []);
  });

  await check('header Your part typed back to what was saved and left after a newer part arrived sends nothing', async () => {
    const line = p => p.evaluate(`document.querySelector('#topic-responsibility').value`);
    const sets = (p, from) => p.calls.slice(from).filter(c => c.payload?.kind === 'responsibility.set');
    const mine = async () => (await view('topic', { topic_id: 't1' })).participants.find(item => item.actor_id === facts.actor)?.responsibility;
    await control({ method: 'responsibility', operation_id: 'header-part-old', note: 'Old', sender: facts.actor });
    const p = await page('header-part', null, true);
    await openByPointer(p);
    await until(async () => await line(p) === 'Old', 'the line shows the saved part');
    await p.evaluate(`document.querySelector('#topic-responsibility').scrollIntoView({block:'center'})`);
    await p.point('#topic-responsibility'); await p.key('a', 4); await p.send('Input.insertText', { text: 'Old' });
    const before = p.calls.length;
    await control({ method: 'responsibility', operation_id: 'header-part-theirs', note: 'Theirs', sender: facts.actor });
    await until(async () => await mine() === 'Theirs', 'Core holds the newer part');
    // The page learns of it: the same participants read that paints the agent's parts live.
    await control({ method: 'responsibility', operation_id: 'header-part-agent', note: 'Reviews the copy' });
    await until(() => p.evaluate(`[...document.querySelectorAll('#topic-state .responsibilities li')].some(li=>li.textContent.includes('Reviews the copy'))`), 'the page read the parts again');
    assert.equal(await line(p), 'Old', 'the line the person is in keeps what they typed');
    await p.key('Tab');
    await until(async () => await line(p) === 'Theirs', 'the line, left, shows the newer part');
    assert.deepEqual([sets(p, before), await mine()], [[], 'Theirs'], 'leaving sent nothing, and the newer part stands');
    assert.deepEqual(p.errors, []);
  });

  await check('header words typed during a tap on a reopened topic, or after a save whose answer was lost, are saved on the next Return', async () => {
    const line = p => p.evaluate(`document.querySelector('#topic-state-note').value`);
    const DROPPED = 'Connection interrupted. Confirmation is unknown; your writing is kept.';
    await setState('header-lost-done', { state: 'done', note: '' });
    await control({ method: 'agent_message', operation_id: 'header-lost-reopen', body: 'A new message reopens it.' });
    await until(async () => (await held()).state_note === 'Reopened by a new message', 'a message reopened the topic');
    const p = await page('header-lost', null, true);
    await openByPointer(p);
    // The tap's answer, and any read of the topic, are held while the person begins typing in the note.
    const before = p.calls.length;
    p.intercept(payload => payload?.kind === 'topic.update' || payload?.name === 'topic');
    await p.point('#topic-state [data-state=waiting]');
    await until(() => p.held.some(entry => entry.payload?.kind === 'topic.update'), 'the tap reached Core; its answer is held');
    await p.point('#topic-state-note'); await p.key('a', 4); await p.send('Input.insertText', { text: 'My note' });
    p.intercept(null);
    const tap = p.held.findIndex(entry => entry.payload?.kind === 'topic.update');
    await p.release(p.held.splice(tap, 1)[0]);
    for (const entry of p.held.splice(0)) await p.release(entry);
    await until(async () => (await lit(p)).includes('Waiting'), 'the tap is painted');
    assert.deepEqual([(await held()).state_note, await line(p)], ['', 'My note'], 'Core started the note afresh; the line keeps the words');
    await p.key('Enter');
    await until(async () => (await held()).state_note === 'My note', 'Core holds the words');
    await until(async () => (await notice(p))?.join() === 'Saved,true', 'a quiet Saved');
    // A save that commits while the connection drops before its answer comes back.
    p.intercept(payload => payload?.kind === 'topic.update');
    await p.key('a', 4); await p.send('Input.insertText', { text: 'Mine' }); await p.key('Enter');
    await until(() => p.held.length === 1, 'the save reached Core; its answer is held');
    p.intercept(null);
    await p.fail(p.held.shift());
    await until(async () => (await notice(p))?.[0] === DROPPED, 'the lost answer is said');
    await until(() => p.evaluate(`document.querySelector('#topic-description .state-note')?.textContent === 'Mine'`), 'the page reads the saved words back');
    await p.send('Input.insertText', { text: ' more' }); await p.key('Enter');
    await until(async () => (await held()).state_note === 'Mine more', 'Core holds the next words');
    await until(async () => (await notice(p))?.join() === 'Saved,true', 'a quiet Saved, not a refusal');
    // The lost save goes again as itself before the next words: Core answers it from what it stored.
    const sent = updates(p, before);
    assert.deepEqual(sent.map(u => u.args), [{ state: 'waiting', keep_note: true }, { note: 'My note' }, { note: 'Mine' }, { note: 'Mine' }, { note: 'Mine more' }]);
    assert.equal(sent[3].operation_id, sent[2].operation_id, 'the same command');
    // The same for Your part.
    const mine = async () => (await view('topic', { topic_id: 't1' })).participants.find(item => item.actor_id === facts.actor)?.responsibility;
    const sets = () => p.calls.slice(before).filter(c => c.payload?.kind === 'responsibility.set').map(c => c.payload.args.note);
    await p.evaluate(`document.querySelector('#topic-responsibility').scrollIntoView({block:'center'})`);
    p.intercept(payload => payload?.kind === 'responsibility.set');
    await p.point('#topic-responsibility'); await p.key('a', 4); await p.send('Input.insertText', { text: 'Mine' }); await p.key('Enter');
    await until(() => p.held.length === 1, 'the part reached Core; its answer is held');
    p.intercept(null);
    await p.fail(p.held.shift());
    await until(async () => (await notice(p))?.[0] === DROPPED, 'the lost answer is said');
    await until(async () => await mine() === 'Mine', 'Core holds the part');
    // The page has read the parts again once it shows an agent's, set after.
    await control({ method: 'responsibility', operation_id: 'header-lost-agent', note: 'Checks the lost answer' });
    await until(() => p.evaluate(`[...document.querySelectorAll('#topic-state .responsibilities li')].some(li=>li.textContent.includes('Checks the lost answer'))`), 'the page read the parts again');
    await p.send('Input.insertText', { text: ' more' }); await p.key('Enter');
    await until(async () => (await notice(p))?.[0] !== DROPPED, 'the next Return is answered');
    assert.deepEqual([await notice(p), await mine(), sets()], [['Saved', true], 'Mine more', ['Mine', 'Mine', 'Mine more']]);
    assert.deepEqual(p.errors, []);
  });

  // One case for each line set in place, on the path most likely to lose words (docs/topic-settings.md).
  await check('header the note, left by closing Topic settings after someone else changed it, is refused beside their words, shown again, and saved on Return', async () => {
    const line = p => p.evaluate(`document.querySelector('#topic-state-note').value`);
    await setState('header-close-old', { state: 'active', note: 'Old' });
    const p = await page('header-close', null, true);
    await openByPointer(p);
    await p.point('#topic-state-note'); await p.key('a', 4); await p.send('Input.insertText', { text: 'Mine' });
    await setState('header-close-theirs', { state: 'active', note: 'Theirs' });
    await until(async () => (await subtitle(p)).text === 'Theirs', 'the page learns of their note');
    assert.equal(await line(p), 'Mine', 'the line the person is in keeps their words');
    const before = p.calls.length;
    await p.point('#settings-close');
    await until(async () => (await notice(p))?.[0]?.includes('It now reads “Theirs”'), 'the refusal shows their words');
    assert.deepEqual([await isOpen(p), (await held()).state_note, await line(p)], [true, 'Theirs', 'Mine'], 'Topic settings shows again; their note stands; the words are kept');
    assert.deepEqual(updates(p, before).map(u => [u.expected.topic_fields, u.args]), [[{ note: 'Old' }, { note: 'Mine' }]], 'fenced on the note the person began from');
    await p.point('#topic-state-note'); await p.key('Enter');
    await until(async () => (await held()).state_note === 'Mine', 'told, Return saves the words in place of theirs');
    await until(async () => (await notice(p))?.join() === 'Saved,true', 'a quiet Saved');
    assert.deepEqual(p.errors, []);
  });

  await check('header Your part, changed on another device while the person types, then a chip pressed: the part is refused beside the newer one and stays said; the tap saves; Return saves the part', async () => {
    const line = p => p.evaluate(`document.querySelector('#topic-responsibility').value`);
    const mine = async () => (await view('topic', { topic_id: 't1' })).participants.find(item => item.actor_id === facts.actor)?.responsibility;
    await setState('header-part-tap-active', { state: 'active', note: 'Kept by the tap' });
    await control({ method: 'responsibility', operation_id: 'header-part-tap-old', note: 'Old', sender: facts.actor });
    const p = await page('header-part-tap', null, true);
    await openByPointer(p);
    await until(async () => await line(p) === 'Old', 'the line shows the saved part');
    await p.evaluate(`document.querySelector('#topic-responsibility').scrollIntoView({block:'center'})`);
    await p.point('#topic-responsibility'); await p.key('a', 4); await p.send('Input.insertText', { text: 'Mine' });
    await control({ method: 'responsibility', operation_id: 'header-part-tap-theirs', note: 'Theirs', sender: facts.actor });
    await until(async () => await mine() === 'Theirs', 'Core holds the newer part');
    await p.evaluate(`document.querySelector('#topic-state [data-state=review]').scrollIntoView({block:'center'})`);
    // Each answer the panel says anything of sets the notice again: the part's, then the tap's.
    await p.evaluate(`(()=>{window.noticeSets=0;new MutationObserver(()=>window.noticeSets++).observe(document.querySelector('#topic-state .notice'),{childList:true})})()`);
    await p.point('#topic-state [data-state=review]');
    await until(async () => (await held()).state === 'review' && (await lit(p))[0] === 'Ready for review', 'the tap saves');
    await until(() => p.evaluate('window.noticeSets >= 2'), 'the panel has said what became of the part and of the tap');
    assert.deepEqual([(await notice(p))[0].startsWith('Your part changed elsewhere first'), await mine(), await line(p), (await held()).state_note],
      [true, 'Theirs', 'Mine', 'Kept by the tap'], 'still said after the tap\'s answer; the newer part stands; the words are kept; the tap kept the note');
    await p.point('#topic-responsibility'); await p.key('Enter');
    await until(async () => await mine() === 'Mine', 'told, Return saves the part');
    await until(async () => (await notice(p))?.join() === 'Saved,true', 'a quiet Saved');
    assert.deepEqual(p.errors, []);
  });

  await check('header a rename typed while someone else changes where the topic stands and its note is saved on Return, with nothing refused', async () => {
    await setState('header-rename-other-active', { state: 'active', note: 'Old note' });
    const p = await page('header-rename-other', null, true);
    await openByPointer(p);
    const original = (await held()).title;
    await p.point('#topic-state .settings-actions button:first-of-type');
    await until(async () => await focused(p) === 'topic-rename', 'the title line takes the focus');
    await p.send('Input.insertText', { text: 'Renamed while they wrote' });
    // Someone else changes where it stands before the page has read it: its topic reads are held.
    p.intercept(payload => payload?.name === 'topic');
    await setState('header-rename-other-theirs', { state: 'waiting', note: 'Their note' });
    await until(async () => (await held()).state_note === 'Their note', 'Core holds their change');
    const before = p.calls.length;
    await p.key('Enter');
    await until(async () => (await held()).title === 'Renamed while they wrote', 'Core holds the new title');
    await until(async () => (await notice(p))?.join() === 'Saved,true', 'a quiet Saved, not a refusal');
    p.intercept(null);
    for (const entry of p.held.splice(0)) await p.release(entry);
    assert.deepEqual(updates(p, before).map(u => [u.expected.topic_fields, u.args]), [[{ title: original }, { title: 'Renamed while they wrote' }]], 'fenced on the title alone');
    await until(async () => (await subtitle(p)).text.includes('Their note'), 'the page then learns of where it stands');
    assert.deepEqual([(await held()).state, (await held()).state_note], ['waiting', 'Their note'], 'their change stands');
    await p.point('#topic-state .settings-actions button:first-of-type');
    await until(async () => await focused(p) === 'topic-rename', 'the title line again');
    await p.send('Input.insertText', { text: original }); await p.key('Enter');
    await until(async () => (await held()).title === original, 'renamed back');
    assert.deepEqual(p.errors, []);
  });

  await check('header a chip pressed after someone else changed where it stands, before the page has read it, is refused in plain words, and theirs stands', async () => {
    const CHANGED = 'Someone else changed this topic first, so that was not saved. Here it is as it stands now; what you typed is kept. Try again.';
    await setState('header-tap-theirs-old', { state: 'active', note: 'Old' });
    const p = await page('header-tap-theirs', null, true);
    await openByPointer(p);
    p.intercept(payload => payload?.name === 'topic');
    await setState('header-tap-theirs-done', { state: 'done', note: 'Theirs' });
    await until(async () => (await held()).state === 'done', 'Core holds their state');
    const before = p.calls.length;
    await p.evaluate(`document.querySelector('#topic-state [data-state=review]').scrollIntoView({block:'center'})`);
    await p.point('#topic-state [data-state=review]');
    await until(() => updates(p, before).length === 1 && p.calls.slice(before).some(c => c.payload?.name === 'topic'), 'refused, the panel reads the topic once');
    p.intercept(null);
    for (const entry of p.held.splice(0)) await p.release(entry);
    await until(async () => (await notice(p))?.[0] === CHANGED, 'the refusal in plain words');
    assert.deepEqual([(await held()).state, (await held()).state_note, await lit(p)], ['done', 'Theirs', ['Done']], 'theirs stands, and the chips show it');
    assert.deepEqual(updates(p, before).map(u => [u.expected.topic_fields, u.args]), [[{ state: 'active', waiting_on: [] }, { state: 'review', keep_note: true }]]);
    assert.deepEqual(p.errors, []);
  });

  await check('header the note saved while its answer and the panel\'s read are both lost, then more words on Return: they save, and nothing of the person\'s is called someone else\'s', async () => {
    await setState('header-lost-old', { state: 'active', note: 'Old' });
    const p = await page('header-lost', null, true);
    await openByPointer(p);
    // Every notice the panel shows, even one replaced at once.
    await p.evaluate(`(n=>{window.noticesSaid=[];new MutationObserver(()=>{if(!n.hidden)window.noticesSaid.push(n.textContent)}).observe(n,{childList:true,characterData:true,subtree:true,attributes:true})})(document.querySelector('#topic-state .notice'))`);
    // The outage: Core saves the note but its answer is lost, and every read of the topic fails.
    let drop = true;
    p.intercept(payload => payload?.name === 'topic' || (payload?.kind === 'topic.update' && drop && !(drop = false)));
    await p.point('#topic-state-note'); await p.key('a', 4); await p.send('Input.insertText', { text: 'Mine' });
    const before = p.calls.length;
    await p.key('Enter');
    await until(() => p.held.some(entry => entry.payload?.kind === 'topic.update'), 'the note\'s answer is held');
    await p.fail(p.held.splice(p.held.findIndex(entry => entry.payload?.kind === 'topic.update'), 1)[0]);
    await until(async () => (await held()).state_note === 'Mine', 'Core saved the note');
    await until(async () => { for (const entry of p.held.splice(0)) await p.fail(entry); const said = await notice(p); return said && said[0] !== 'Saved'; }, 'the lost answer said, after the panel\'s read failed');
    await p.send('Input.insertText', { text: ' more' });
    const second = p.calls.length;
    await p.key('Enter');
    await until(() => p.calls.slice(second).some(c => c.payload?.kind === 'topic.update'), 'the lost save goes again, as itself');
    p.intercept(null);
    for (const entry of p.held.splice(0)) await p.release(entry);
    await until(async () => (await held()).state_note === 'Mine more', 'Core holds the next words');
    await until(async () => (await notice(p))?.join() === 'Saved,true', 'a quiet Saved');
    const sent = updates(p, before);
    assert.deepEqual(sent.map(u => [u.expected.topic_fields, u.args]),
      [[{ note: 'Old' }, { note: 'Mine' }], [{ note: 'Old' }, { note: 'Mine' }], [{ note: 'Mine' }, { note: 'Mine more' }]], 'the lost save asked again as itself, then the next words from what it saved');
    assert.equal(sent[1].operation_id, sent[0].operation_id, 'the same command, which Core answers from what it stored');
    assert.deepEqual((await p.evaluate('window.noticesSaid')).filter(words => /first, so|Someone else/.test(words)), [], 'nothing of the person\'s is called someone else\'s');
    assert.equal(await p.evaluate(`document.querySelector('#topic-state-note').value`), 'Mine more');
    assert.deepEqual(p.errors, []);
  });

  // The last review's worst paths (round 4), with real keys and taps: the
  // person's lost save shows as saved in the page's live read while their
  // next act is out. Nothing of theirs is called someone else's.
  const watchNotices = p => p.evaluate(`(n=>{window.noticesSaid=[];new MutationObserver(()=>{if(!n.hidden)window.noticesSaid.push(n.textContent)}).observe(n,{childList:true,characterData:true,subtree:true,attributes:true})})(document.querySelector('#topic-state .notice'))`);
  const lose = async (p, DROPPED) => {
    await until(() => p.held.some(entry => entry.payload?.kind === 'topic.update'), 'the save reached Core; its answer is held');
    await p.fail(p.held.splice(p.held.findIndex(entry => entry.payload?.kind === 'topic.update'), 1)[0]);
    await until(async () => { for (const entry of p.held.splice(0)) await p.fail(entry); return (await notice(p))?.[0] === DROPPED; }, 'the lost answer said, after the panel read failed');
  };
  const liveRead = async (p, shown, label) => until(async () => {
    for (const entry of p.held.filter(e => e.payload?.name === 'topic')) { p.held.splice(p.held.indexOf(entry), 1); await p.release(entry); }
    return shown();
  }, label);

  await check('header the note saved with its answer and the panel read lost; more words on Return; the live read shows the first saved while the next is out', async () => {
    const DROPPED = 'Connection interrupted. Confirmation is unknown; your writing is kept.';
    await setState('header-rv1-old', { state: 'active', note: 'Old' });
    const p = await page('header-rv1', null, true);
    await openByPointer(p);
    await watchNotices(p);
    p.intercept(payload => payload?.name === 'topic' || payload?.kind === 'topic.update');
    await p.point('#topic-state-note'); await p.key('a', 4); await p.send('Input.insertText', { text: 'A' });
    const before = p.calls.length;
    await p.key('Enter');
    await lose(p, DROPPED);
    assert.equal((await held()).state_note, 'A', 'Core saved the first words');
    await p.send('Input.insertText', { text: ' more' });
    await p.key('Enter');
    await until(() => p.held.some(entry => entry.payload?.kind === 'topic.update'), 'the lost save goes again; its answer is held');
    await liveRead(p, () => p.evaluate(`document.querySelector('#topic-description')?.textContent === 'A'`), 'the live read paints the first words');
    p.intercept(null);
    for (const entry of p.held.splice(0)) await p.release(entry);
    await until(async () => (await held()).state_note === 'A more', 'Core holds the next words');
    await until(async () => (await notice(p))?.join() === 'Saved,true', 'a quiet Saved');
    const sent = updates(p, before);
    assert.deepEqual(sent.map(u => [u.expected.topic_fields, u.args]), [[{ note: 'Old' }, { note: 'A' }], [{ note: 'Old' }, { note: 'A' }], [{ note: 'A' }, { note: 'A more' }]]);
    assert.equal(sent[1].operation_id, sent[0].operation_id, 'asked again as the same command');
    assert.deepEqual((await p.evaluate('window.noticesSaid')).filter(words => /first, so|Someone else/.test(words)), [], 'nothing of the person\'s is called someone else\'s');
    assert.deepEqual(p.errors, []);
  });

  await check('header a tap with its answer and the panel read lost, then another tap; the live read shows the first while the next is out', async () => {
    const DROPPED = 'Connection interrupted. Confirmation is unknown; your writing is kept.';
    await setState('header-rv2-old', { state: 'active', note: 'Kept' });
    const p = await page('header-rv2', null, true);
    await openByPointer(p);
    await watchNotices(p);
    await p.evaluate(`document.querySelector('#topic-state [data-state=review]').scrollIntoView({block:'center'})`);
    p.intercept(payload => payload?.name === 'topic' || payload?.kind === 'topic.update');
    const before = p.calls.length;
    await p.point('#topic-state [data-state=done]');
    await lose(p, DROPPED);
    assert.equal((await held()).state, 'done', 'Core saved Done');
    await p.point('#topic-state [data-state=review]');
    await until(() => p.held.some(entry => entry.payload?.kind === 'topic.update'), 'the lost tap goes again; its answer is held');
    await liveRead(p, async () => (await lit(p))[0] === 'Done', 'the live read paints Done');
    p.intercept(null);
    for (const entry of p.held.splice(0)) await p.release(entry);
    await until(async () => (await held()).state === 'review', 'Core holds Ready for review');
    await until(async () => (await notice(p))?.join() === 'Saved,true' && (await lit(p))[0] === 'Ready for review', 'a quiet Saved, and the chip lit');
    const sent = updates(p, before);
    assert.deepEqual(sent.map(u => [u.expected.topic_fields, u.args]),
      [[{ state: 'active', waiting_on: [] }, { state: 'done', keep_note: true }], [{ state: 'active', waiting_on: [] }, { state: 'done', keep_note: true }],
        [{ state: 'done', waiting_on: [] }, { state: 'review', keep_note: true }]]);
    assert.equal(sent[1].operation_id, sent[0].operation_id, 'asked again as the same command');
    assert.equal((await held()).state_note, 'Kept', 'no tap sent the note');
    assert.deepEqual((await p.evaluate('window.noticesSaid')).filter(words => /first, so|Someone else/.test(words)), [], 'nothing of the person\'s is called someone else\'s');
    assert.deepEqual(p.errors, []);
  });

  // Your part's answer says nothing of where the topic stands: a tap after it
  // still goes from what the lost tap saved (round 5's case P1).
  await check('header a tap with its answer and the panel read lost, then Your part saved, then another tap: it goes from the lost tap, nobody else blamed', async () => {
    const DROPPED = 'Connection interrupted. Confirmation is unknown; your writing is kept.';
    const mine = async () => (await view('topic', { topic_id: 't1' })).participants.find(row => row.actor_id === facts.actor)?.responsibility;
    await setState('header-rv5-old', { state: 'active', note: 'Kept' });
    const p = await page('header-rv5', null, true);
    await openByPointer(p);
    await watchNotices(p);
    await p.evaluate(`document.querySelector('#topic-state [data-state=review]').scrollIntoView({block:'center'})`);
    p.intercept(payload => payload?.name === 'topic' || payload?.kind === 'topic.update');
    const before = p.calls.length;
    await p.point('#topic-state [data-state=done]');
    await lose(p, DROPPED);
    assert.equal((await held()).state, 'done', 'Core saved Done');
    // Reads of the topic keep failing; Your part's save and answer go through.
    p.intercept(payload => payload?.name === 'topic');
    await p.evaluate(`document.querySelector('#topic-responsibility').scrollIntoView({block:'center'})`);
    await p.point('#topic-responsibility'); await p.key('a', 4); await p.send('Input.insertText', { text: 'Checks the release' }); await p.key('Enter');
    await until(async () => { for (const entry of p.held.splice(0)) await p.fail(entry); return await mine() === 'Checks the release' && (await notice(p))?.join() === 'Saved,true'; },
      'Core saved Your part, and its answer came');
    await p.evaluate(`document.querySelector('#topic-state [data-state=review]').scrollIntoView({block:'center'})`);
    await p.point('#topic-state [data-state=review]');
    await until(async () => { for (const entry of p.held.splice(0)) await p.fail(entry); return (await held()).state === 'review' || (await p.evaluate('window.noticesSaid')).some(words => /Someone else/.test(words)); },
      'the tap is answered');
    p.intercept(null);
    for (const entry of p.held.splice(0)) await p.fail(entry);
    assert.deepEqual((await p.evaluate('window.noticesSaid')).filter(words => /first, so|Someone else/.test(words)), [], 'nothing of the person\'s is called someone else\'s');
    await until(async () => (await held()).state === 'review' && (await lit(p))[0] === 'Ready for review', 'Core holds Ready for review, and the chip is lit');
    const sent = updates(p, before);
    assert.deepEqual(sent.map(u => [u.expected.topic_fields, u.args]),
      [[{ state: 'active', waiting_on: [] }, { state: 'done', keep_note: true }], [{ state: 'active', waiting_on: [] }, { state: 'done', keep_note: true }],
        [{ state: 'done', waiting_on: [] }, { state: 'review', keep_note: true }]]);
    assert.equal(sent[1].operation_id, sent[0].operation_id, 'asked again as the same command');
    assert.deepEqual(p.errors, []);
  });

  // An act made before a refusal comes back never goes over the newer words.
  // The person's next act, made once the refusal shows, queues behind it, so
  // what Core then holds says whether it went.
  await check('header the note saved on Return, then Topic settings closed by ✕ before the refusal comes back: nothing goes over the newer note; the next Return saves', async () => {
    const line = p => p.evaluate(`document.querySelector('#topic-state-note').value`);
    await setState('header-quick-old', { state: 'active', note: 'Old' });
    const p = await page('header-quick', null, true);
    await openByPointer(p);
    await p.point('#topic-state-note'); await p.key('a', 4); await p.send('Input.insertText', { text: 'Mine' });
    // Someone else changes the note before the page has read it; the save's answer is held too.
    p.intercept(payload => payload?.name === 'topic' || payload?.kind === 'topic.update');
    await setState('header-quick-theirs', { state: 'active', note: 'Theirs' });
    await until(async () => (await held()).state_note === 'Theirs', 'Core holds their note');
    const before = p.calls.length;
    await p.key('Enter');
    await until(() => p.held.some(entry => entry.payload?.kind === 'topic.update'), 'the save reached Core; its answer is held');
    await p.point('#settings-close');
    await until(async () => !(await isOpen(p)), 'Topic settings closed');
    p.intercept(null);
    for (const entry of p.held.splice(0)) await p.release(entry);
    await until(async () => (await notice(p))?.[0]?.includes('It now reads “Theirs”'), 'the refusal shows their words');
    assert.deepEqual([await isOpen(p), await line(p)], [true, 'Mine'], 'Topic settings shows again; the words are kept');
    await p.point('#topic-state-note'); await p.key('a', 4); await p.send('Input.insertText', { text: 'Mine more' }); await p.key('Enter');
    await until(async () => (await held()).state_note === 'Mine more', 'told, Return saves the words in place of theirs');
    await until(async () => (await notice(p))?.join() === 'Saved,true', 'a quiet Saved');
    assert.deepEqual(updates(p, before).map(u => [u.expected.topic_fields, u.args]), [[{ note: 'Old' }, { note: 'Mine' }], [{ note: 'Theirs' }, { note: 'Mine more' }]],
      'the leaving made before the refusal showed sent nothing; the Return made after it goes over their words');
    assert.deepEqual(p.errors, []);
  });

  await check('header a chip pressed while the refusal of the chip before it is out sends nothing; the next tap goes from the state that shows', async () => {
    const CHANGED = 'Someone else changed this topic first, so that was not saved. Here it is as it stands now; what you typed is kept. Try again.';
    await setState('header-taps-old', { state: 'active', note: 'Old' });
    const p = await page('header-taps', null, true);
    await openByPointer(p);
    p.intercept(payload => payload?.name === 'topic' || payload?.kind === 'topic.update');
    await setState('header-taps-done', { state: 'done', note: 'Theirs' });
    await until(async () => (await held()).state === 'done', 'Core holds their state');
    const before = p.calls.length;
    await p.evaluate(`document.querySelector('#topic-state [data-state=review]').scrollIntoView({block:'center'})`);
    await p.point('#topic-state [data-state=waiting]');
    await until(() => p.held.some(entry => entry.payload?.kind === 'topic.update'), 'the tap reached Core; its answer is held');
    await p.point('#topic-state [data-state=review]');
    p.intercept(null);
    for (const entry of p.held.splice(0)) await p.release(entry);
    await until(async () => (await notice(p))?.[0] === CHANGED && (await lit(p))[0] === 'Done', 'the refusal in plain words, and Done shows');
    await p.point('#topic-state [data-state=active]');
    await until(async () => (await held()).state === 'active', 'the tap made once Done showed saves');
    assert.deepEqual(updates(p, before).map(u => [u.expected.topic_fields, u.args]),
      [[{ state: 'active', waiting_on: [] }, { state: 'waiting', keep_note: true }], [{ state: 'done', waiting_on: [] }, { state: 'active', keep_note: true }]],
      'the tap pressed before the refusal showed sent nothing');
    assert.deepEqual(p.errors, []);
  });

  await check('header Rename and Archive are quiet words; Rename puts the title on one line, Escape puts the words back, Return saves it', async () => {
    const p = await page('header-rename', null, true);
    await openByPointer(p);
    const original = (await held()).title;
    const actions = await p.evaluate(`[...document.querySelectorAll('#topic-state .settings-actions button')].map(b=>{const c=getComputedStyle(b);return [b.textContent,c.borderTopWidth,c.backgroundColor]})`);
    assert.deepEqual(actions, [['Rename', '0px', 'rgba(0, 0, 0, 0)'], ['Archive', '0px', 'rgba(0, 0, 0, 0)']], 'words, not boxed buttons');
    const rename = '#topic-state .settings-actions button:first-of-type';
    const line = () => p.evaluate(`(t=>[t.hidden,t.value,t.selectionStart,t.selectionEnd,[...document.querySelectorAll('#topic-state .settings-actions button')].map(b=>b.hidden)])(document.querySelector('#topic-rename'))`);
    await p.point(rename);
    await until(async () => await focused(p) === 'topic-rename', 'the title line takes the focus');
    assert.deepEqual(await line(), [false, original, 0, original.length, [true, true]], 'the whole title selected, in place of the words');
    await p.key('Escape');
    assert.deepEqual([(await line())[0], await focused(p), await isOpen(p)], [true, 'Rename', true], 'Escape puts the words back, the focus on Rename, Topic settings open');
    await p.point(rename);
    await until(async () => await focused(p) === 'topic-rename', 'the title line again');
    await p.send('Input.insertText', { text: 'Renamed in place' }); await p.key('Enter');
    await until(async () => (await held()).title === 'Renamed in place', 'Return saves the title');
    await until(() => p.evaluate(`document.querySelector('#topic-title').textContent === 'Renamed in place'`), 'the page title follows');
    await until(async () => (await line())[0] === true && await focused(p) === 'Rename', 'the words come back, the focus on Rename');
    await shot(p, 'header-renamed');
    await p.point(rename); await until(async () => await focused(p) === 'topic-rename', 'the title line once more');
    await p.send('Input.insertText', { text: original }); await p.key('Enter');
    await until(async () => (await held()).title === original, 'renamed back');
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
      await until(() => p.evaluate(`document.getAnimations().filter(x=>x.effect?.getTiming().iterations!==Infinity).every(a=>a.playState!=='running')`), 'the dialog settled');
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
    const from = await p.evaluate(`(()=>{const people=document.querySelector('#topic-people'),all=[...document.querySelectorAll('button,input,a[href],[tabindex]:not([tabindex="-1"])')].filter(e=>!e.disabled&&!e.closest('[inert]')&&e.getClientRects().length&&people.compareDocumentPosition(e)&Node.DOCUMENT_POSITION_PRECEDING);all.at(-1).focus({preventScroll:true});const a=document.activeElement;return a.tagName+'#'+a.id+'.'+a.className+' '+a.textContent.slice(0,30)})()`);
    let stop = null;
    const expected = await p.evaluate(`${buttons}.map(e=>e.getAttribute('aria-label')||e.title)`);
    const seen = [];
    // A lit card's header star and bar buttons follow it in the Tab order (docs/interaction.md): up to four stops before the people.
    let past = 0;
    for (;;) {
      await p.key('Tab');
      const at = await p.evaluate(`(a=>({pill:Boolean(a.closest('.person-pill')),bar:Boolean(a.closest('.message-bar'))||a.classList.contains('card-star'),name:a.getAttribute('aria-label')||a.title,visible:a.matches(':focus-visible'),style:getComputedStyle(a).outlineStyle,box:${rect('a')}}))(document.activeElement)`);
      if (!at.pill && at.bar && !seen.length && past++ < 4) continue;
      if (!at.pill) { stop = await p.evaluate(`(a=>a.tagName+'#'+a.id+'.'+a.className+' '+a.textContent.slice(0,30))(document.activeElement)`); break; }
      seen.push(at.name);
      assert.deepEqual([at.visible, at.style], [true, 'solid'], `${at.name}: the browser draws its keyboard ring`);
      await until(() => p.evaluate("document.getAnimations().filter(x=>x.effect?.getTiming().iterations!==Infinity).every(a=>a.playState!=='running')"), 'settled');
      const sides = ringSides(await screen(), at.box, focusColor);
      if (seen.length === 1) await shot(p, 'header-ring-first-pill-button');
      for (const [side, share] of Object.entries(sides)) assert.ok(share >= 0.5, `${at.name}: the ring shows along its ${side} side (${share.toFixed(2)} of it): ${JSON.stringify(sides)}`);
    }
    assert.deepEqual(seen, expected, `Tab stops on every button in the pills, in order (from ${from}, stopped on ${stop})`);
    assert.ok(seen.some(name => name.startsWith('Change ')) && seen.some(name => name.startsWith('Remove ')), 'an agent\'s colour button and a remove button among them');
    assert.deepEqual(p.errors, []);
  });

  // Item 465: the people are the topic's Team, on the title row's right, under the title (under the subtitle on a
  // phone), a filled pill each with "+ Add"; nothing of them is left after the messages.
  await check('header the Team is one filled pill each on the title row\'s right, under the title, and a remove button sits in its pill', async () => {
    await setState('header-people-active', { state: 'active', note: NOTE });
    // More messages than one page, all read, so More messages shows below them.
    await control({ method: 'seed', messages: 32 });
    await control({ method: 'agent_message', operation_id: 'header-people-read', body: 'Read up to here.', read: true });
    const agent = facts.agent;
    const people = p => p.evaluate(`(()=>{const pills=[...document.querySelectorAll('#topic-people .person-pill')];return pills.map(e=>{const c=getComputedStyle(e),name=e.firstElementChild,out=e.querySelector('.pill-remove'),pb=e.getBoundingClientRect(),ob=out?.getBoundingClientRect();
      return {name:name.textContent,button:name.tagName==='BUTTON',title:name.title,fill:c.backgroundColor,border:[c.borderTopWidth,c.borderRightWidth,c.borderBottomWidth,c.borderLeftWidth],shadow:c.boxShadow,
        remove:out?{label:out.getAttribute('aria-label'),inside:ob.left>=pb.left-0.5&&ob.right<=pb.right+0.5&&ob.top>=pb.top-0.5&&ob.bottom<=pb.bottom+0.5,size:[ob.width,ob.height]}:null,
        buttonInButton:Boolean(e.querySelector('button button'))}})})()`);
    // Where the Team is: in the header, headed Team, under the title row; on a laptop flush with the title row's
    // right and right of the subtitle, on a phone under the subtitle; nothing of it overlaps the title row or the
    // subtitle, and no People section follows the messages.
    const placed = p => p.evaluate(`(()=>{const team=document.querySelector('#topic-people'),t=team.getBoundingClientRect(),row=document.querySelector('.topic-header .title-row').getBoundingClientRect(),
      sub=document.querySelector('#topic-description').getBoundingClientRect(),add=document.querySelector('#participants .add-chip')?.getBoundingClientRect(),pills=[...team.querySelectorAll('.person-pill, .add-chip')].map(e=>e.getBoundingClientRect());
      const apart=(a,b)=>a.right<=b.left+0.5||b.right<=a.left+0.5||a.bottom<=b.top+0.5||b.bottom<=a.top+0.5;
      return {header:Boolean(team.closest('.topic-header')),heading:document.querySelector('#people-heading').textContent,underTitle:t.top>=row.bottom-0.5,
        right:Math.round(row.right-Math.max(...pills.map(b=>b.right))),besideSubtitle:sub.right<=t.left+0.5&&t.top<sub.bottom,underSubtitle:t.top>=sub.bottom-0.5,
        clear:apart(t,row)&&apart(t,sub),afterMessages:Boolean(document.querySelector('#messages ~ #topic-people, #messages ~ * #topic-people')),add:Boolean(add),sideways:document.documentElement.scrollWidth>innerWidth}})()`);
    const p = await page('header-people', null, true, { beforeNavigate: scheme('light') });
    await until(async () => (await people(p)).length >= 2, 'the people painted');
    const laptop = await placed(p);
    assert.deepEqual([laptop.header, laptop.heading, laptop.underTitle, laptop.besideSubtitle, laptop.clear, laptop.afterMessages, laptop.add, laptop.sideways],
      [true, 'Team', true, true, true, false, true, false], 'the Team is in the header under the title, right of the subtitle, with "+ Add", and nothing follows the messages: ' + JSON.stringify(laptop));
    assert.ok(Math.abs(laptop.right) <= 2, 'its pills end flush with the title row\'s right: ' + JSON.stringify(laptop));
    assert.equal(await p.evaluate(`document.querySelector('#more-messages').hidden`), false, 'a topic with more than a page shows More messages');
    // More messages loads the next page; the Team stays where it was, at the top.
    const loaded = () => p.evaluate(`document.querySelectorAll('#messages [data-id]').length`), first = await loaded();
    await p.evaluate(`document.querySelector('#more-messages').scrollIntoView({block:'center'})`);
    await p.point('#more-messages');
    await until(async () => await loaded() > first, 'More messages loads the next page');
    assert.deepEqual(await placed(p).then(x => [x.header, x.underTitle, x.afterMessages]), [true, true, false], 'still in the header after More messages');
    await p.evaluate(`scrollTo(0, 0)`);
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
    await shot(p, 'header-people-light');
    const dark = await page('header-people-dark', null, true, { beforeNavigate: scheme('dark') });
    await until(async () => (await people(dark)).length >= 2, 'the people painted, dark');
    for (const pill of await people(dark)) {
      if (pill.name === facts.actor) assert.deepEqual([pill.fill, pill.shadow === 'none'], ['rgb(0, 0, 0)', false], 'dark: the reader\'s pill is black with a thin edge');
      else assert.deepEqual([pill.fill === 'rgba(0, 0, 0, 0)', pill.shadow], [false, 'none'], `dark: ${pill.name}'s pill is filled, with no ring`);
    }
    assert.deepEqual(await placed(dark).then(x => [x.header, x.underTitle, x.besideSubtitle, x.clear]), [true, true, true, true], 'dark: the Team in the same place');
    await shot(dark, 'header-people-dark');
    await dark.close();
    // On a phone, at each of its widths, light and dark: under the subtitle, clear of the title row, no sideways scroll.
    for (const theme of ['light', 'dark']) {
      const small = await page('header-people-phone-' + theme, null, true, { beforeNavigate: both(phone, scheme(theme)) });
      await until(async () => (await people(small)).length >= 2, 'the people painted on a phone');
      for (const width of [320, 375, 390]) {
        await small.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
        const at = await placed(small);
        assert.deepEqual([at.header, at.heading, at.underSubtitle, at.clear, at.add, at.sideways], [true, 'Team', true, true, true, false], `${width}: the Team under the subtitle, clear of the title row, with "+ Add", nothing sideways: ` + JSON.stringify(at));
        for (const pill of await people(small)) assert.equal(pill.remove?.inside, true, `${width}: ${pill.name}'s remove button is inside the pill`);
        assert.equal(await noSideways(small), true, `${width}: no sideways scroll`);
        await shot(small, `header-people-phone-${width}-${theme}`);
      }
      await small.close();
    }
    // The owner removes the agent with a real press on the button inside its
    // pill, and a commit that repaints the people while the button is held
    // down does not swallow the press.
    const remove = `#topic-people [aria-label="Remove ${agent}"]`;
    await p.evaluate(`document.querySelector(${JSON.stringify(remove)}).scrollIntoView({block:'center'})`);
    // The pointer goes to the button as a person's does, and the press is aimed
    // where the button then shows.
    const centre = async () => { const out = await p.box(remove); return [out.x + out.width / 2, out.y + out.height / 2]; };
    const [x0, y0] = await centre();
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 });
    const [x, y] = await centre();
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    assert.equal(await p.evaluate(`document.elementFromPoint(${x}, ${y}) === document.querySelector(${JSON.stringify(remove)})`), true, 'the remove button is what is pressed');
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    // The page reloads after every commit: it reads the wake lights, which set
    // the wakes notice's hidden attribute, and in the same turn paints the
    // people again. A record of that attribute is that repaint having run.
    await p.evaluate(`(()=>{window.wakesPainted=0;new MutationObserver(records=>{window.wakesPainted+=records.length;}).observe(document.querySelector('#wakes-status'),{attributes:true,attributeFilter:['hidden']});})()`);
    await control({ method: 'agent_message', operation_id: 'header-people-repaint', body: 'A commit while the button is held down.', read: true });
    await until(() => p.evaluate('window.wakesPainted > 0'), 'the commit repaints the people while the button is down');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await until(async () => !(await people(p)).some(x => x.name === agent), 'its pill leaves');
    assert.equal(await p.evaluate(`document.activeElement?.matches('#participants .add-chip')`), true, 'the focus is on "+ Add"');
    assert.equal((await view('topic', { topic_id: 't1' })).participants.some(row => row.actor_id === agent), false, 'Core took it out');
    assert.deepEqual(p.errors, []);
  });

  // Item 465: the header's arrow-key row holds every button drawn in it, so the Team's pills and "+ Add" join Topic
  // settings and New message in it: → from New message walks the Team to "+ Add", ← walks back, and ↓ from any of
  // them leaves the row for the first message, never along the pills.
  await check('header → and ← move from New message along the Team\'s pills to "+ Add" and back, as one row; ↓ leaves for the first message', async () => {
    await setState('header-row-active', { state: 'active', note: '' });
    const p = await page('header-row', null, true, { beforeNavigate: scheme('light') });
    await until(() => p.evaluate(`Boolean(document.querySelector('#participants .add-chip')) && document.querySelectorAll('#topic-people .person-pill').length >= 1`), 'the Team painted with "+ Add"');
    const at = () => p.evaluate(`(a=>a.closest('#topic-people')?'team:'+(a.matches('.add-chip')?'add':a.getAttribute('aria-label')||a.title||a.textContent):a.closest('#messages [data-id]')?'message':a.id)(document.activeElement)`);
    const team = await p.evaluate(`[...document.querySelectorAll('#topic-people button')].filter(b=>b.getClientRects().length).map(b=>'team:'+(b.matches('.add-chip')?'add':b.getAttribute('aria-label')||b.title||b.textContent))`);
    // The keys start on New message, the last of the title row's buttons.
    await p.evaluate(`document.querySelector('#new-message').focus({preventScroll:true})`);
    const walked = [];
    for (let n = 0; n < team.length; n++) { await p.key('ArrowRight'); walked.push(await at()); }
    assert.deepEqual(walked, team, '→ walks the Team\'s buttons in order, from New message to "+ Add"');
    const back = [];
    for (let n = 0; n < team.length; n++) { await p.key('ArrowLeft'); back.push(await at()); }
    assert.deepEqual(back, [...team.slice(0, -1).reverse(), 'new-message'], '← walks back to New message');
    await p.key('ArrowRight');
    await p.key('ArrowDown');
    assert.equal(await at(), 'message', '↓ from a pill leaves the row for the first message');
    assert.deepEqual(p.errors, []);
  });

  // Item 465, the Team with "+ Add" open: the people to add come in under its pills, and the label stays with them,
  // beside the first pill at the row's top, not floating between the two rows; the row of people to add takes no width
  // of its own, so on a laptop the subtitle keeps the lines it had with "+ Add" closed, where the pills leave it room.
  // Closed is the negative: the label beside the first pill already. At 1280 and 1440 by the pointer and at 390 by a
  // finger, in light and dark.
  await check('header the Team with "+ Add" open keeps its label beside its first pill, and the subtitle on its line', async () => {
    await setState('header-add-open', { state: 'active', note: NOTE });
    // The label's and the first pill's boxes, whether the people to add show under the pills, and the subtitle's
    // lines, counted from where its words' boxes start.
    const measure = p => p.evaluate(`(()=>{const label=document.querySelector('#people-heading').getBoundingClientRect(),pill=document.querySelector('#topic-people .person-pill').getBoundingClientRect(),
      add=document.querySelector('#participants .people-add'),a=add.getBoundingClientRect(),sub=document.querySelector('#topic-description'),walk=document.createTreeWalker(sub,NodeFilter.SHOW_TEXT),tops=[];
      for(let t=walk.nextNode();t;t=walk.nextNode()){const r=document.createRange();r.selectNodeContents(t);for(const b of r.getClientRects())if(b.width>0)tops.push(b.top)}
      const lines=tops.sort((x,y)=>x-y).filter((top,i)=>!i||top-tops[i-1]>8).length;
      return {addOpen:!add.hidden&&a.height>0,addUnder:add.hidden||a.top>=pill.bottom-0.5,label:[label.top,label.bottom].map(Math.round),pill:[pill.top,pill.bottom].map(Math.round),
        offset:Math.round((label.top+label.height/2)-(pill.top+pill.height/2)),lines,sideways:document.documentElement.scrollWidth>innerWidth}})()`);
    for (const [device, width] of [['laptop', 1280], ['laptop', 1440], ['phone', 390]]) for (const theme of ['light', 'dark']) {
      const size = q => q.send('Emulation.setDeviceMetricsOverride', { width, height: device === 'phone' ? 844 : 900, deviceScaleFactor: 1, mobile: device === 'phone' });
      const p = await page(`header-add-open-${device}-${width}-${theme}`, null, true, { beforeNavigate: device === 'phone' ? both(phone, size, scheme(theme)) : both(size, scheme(theme)) });
      await until(() => p.evaluate(`Boolean(document.querySelector('#participants .add-chip')?.getClientRects().length) && Boolean(document.querySelector('#topic-people .person-pill'))`), `${width}: the Team painted with "+ Add"`);
      await p.evaluate('scrollTo(0, 0)');
      const closed = await measure(p);
      assert.deepEqual([closed.addOpen, Math.abs(closed.offset) <= 2, closed.sideways], [false, true, false], `${width} ${theme}: closed, the label sits beside the first pill: ${JSON.stringify(closed)}`);
      if (device === 'phone') await tapOn(p, '#participants .add-chip'); else await p.point('#participants .add-chip');
      await until(() => p.evaluate(`!document.querySelector('#participants .people-add').hidden`), `${width} ${theme}: the people to add show`);
      const open = await measure(p);
      assert.deepEqual([open.addOpen, open.addUnder, open.sideways], [true, true, false], `${width} ${theme}: the people to add show under the pills, nothing sideways: ${JSON.stringify(open)}`);
      assert.ok(Math.abs(open.offset) <= 2 && open.label[0] < open.pill[1], `${width} ${theme}: with "+ Add" open, the label stays beside the first pill, at the row's top: ${JSON.stringify({ closed, open })}`);
      // Its lines, not its box: the subtitle shares its row with the Team, and its box grows with the row.
      if (device === 'laptop') assert.equal(open.lines, closed.lines, `${width} ${theme}: with "+ Add" open, the subtitle keeps its lines: ${JSON.stringify({ closed, open })}`);
      await shot(p, `header-add-open-${device}-${width}-${theme}`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 465, a long Team on a laptop: the subtitle beside it keeps at least 6rem, the Team wrapping its pills rather
  // than leave it less, so the topic's state stays words ("Waiting on you" on one line), not a column one letter wide.
  // A short Team, the person alone, is the negative: it keeps its own width, its pill on one line, and the subtitle
  // takes the rest. At 1280 and 1440, in light and dark.
  await check('header a long Team wraps before the subtitle beside it has less than 6rem', async () => {
    const waiters = ['fixture-planning-agent', 'fixture-reviewing-agent', 'fixture-writing-agent'];
    await control({ method: 'navigation_topics', topics: [{ id: 'header-short-team', title: 'A short Team' }, { id: 'header-long-team', title: 'A long Team' }] });
    await control({ method: 'agent_message', operation_id: 'header-long-team-join', topic_id: 'header-long-team', source: 'topic', join: true, body: 'The first message here.' });
    await setState('header-short-team-state', { state: 'active', note: NOTE }, 'header-short-team');
    await control({ method: 'topic_state', operation_id: 'header-long-team-state', topic_id: 'header-long-team', participants: waiters,
      args: { state: 'waiting', waiting_on: ['fixture-notebook-agent', ...waiters, 'fixture-person'] } });
    // The title row's grid and its gap, the root's rem, the Team's and the subtitle's boxes, the pills' tops, and how
    // many lines "Waiting on you" takes in the state.
    const measure = p => p.evaluate(`(()=>{const row=document.querySelector('.topic-header>div'),style=getComputedStyle(row),team=document.querySelector('#topic-people').getBoundingClientRect(),
      sub=document.querySelector('#topic-description').getBoundingClientRect(),state=document.querySelector('#topic-description .topic-state')?.getBoundingClientRect();
      return {row:Math.round(row.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)),gap:parseFloat(style.columnGap),team:Math.round(team.width),sub:Math.round(sub.width),
        rem:parseFloat(getComputedStyle(document.documentElement).fontSize),you:(text=>{if(!text||!text.data.startsWith('Waiting on you'))return null;const r=document.createRange();r.setStart(text,0);r.setEnd(text,'Waiting on you'.length);
          return new Set([...r.getClientRects()].filter(b=>b.width>0).map(b=>Math.round(b.top))).size})(document.querySelector('#topic-description .topic-state')?.firstChild),
        state:state&&[Math.round(state.width),Math.round(state.height)],pillRows:new Set([...document.querySelectorAll('#topic-people .person-pill')].map(pill=>Math.round(pill.getBoundingClientRect().top))).size,
        pills:document.querySelectorAll('#topic-people .person-pill').length,sideways:document.documentElement.scrollWidth>innerWidth}})()`);
    for (const width of [1280, 1440]) for (const theme of ['light', 'dark']) {
      const size = q => q.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      const seen = {};
      for (const [id, pills] of [['header-short-team', 1], ['header-long-team', 5]]) {
        const p = await page(`header-team-width-${id}-${width}-${theme}`, null, true, { url: `${facts.origin}/?topic=${id}`, beforeNavigate: both(size, scheme(theme)) });
        await until(() => p.evaluate(`document.querySelectorAll('#topic-people .person-pill').length >= ${pills} && Boolean(document.querySelector('#topic-description').textContent)`), `${width} ${theme}: ${id} painted with its Team`);
        await p.evaluate('scrollTo(0, 0)');
        seen[id] = await measure(p);
        if (id === 'header-long-team') await shot(p, `header-long-team-${width}-${theme}`);
        assert.deepEqual(p.errors, []); await p.close();
      }
      const { 'header-short-team': short, 'header-long-team': long } = seen, at = `${width} ${theme}: ${JSON.stringify(seen)}`;
      assert.equal(short.pillRows, 1, `a short Team keeps its pill on one line: ${at}`);
      assert.ok(Math.abs(short.sub - (short.row - short.gap - short.team)) <= 1 && short.sub > 6 * short.rem, `a short Team keeps its own width, and the subtitle takes the rest: ${at}`);
      assert.ok(long.pillRows > 1, `a long Team wraps its pills: ${at}`);
      assert.ok(long.sub >= 6 * long.rem - 1, `the subtitle keeps at least 6rem: ${at}`);
      assert.equal(long.you, 1, `the topic's state reads "Waiting on you" on one line: ${at}`);
      assert.equal(long.sideways, false, `nothing goes sideways: ${at}`);
    }
  });
}
