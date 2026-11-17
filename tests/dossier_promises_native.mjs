// Item 717: explicit records, native cover/source/owner gestures, both engines.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

export async function promiseChecks(api, helpers) {
  const { check, until, view, control, shot, facts, observations, engine } = api;
  const { seed, open, centre, press, openReader, closeReader, card } = helpers;
  const sizes = [['320', 'phone-320'], ['375', 'phone-375'], ['390', 'phone'], ['laptop', 'laptop']];
  const text = 'I will book the cabin.';
  let serial = 0;
  const write = (root, args, op) => control({ method: 'stack_act', sender: 'aim-core', kind: 'stack.cover', message_id: root, operation_id: op, args });
  const held = async (topic, root) => {
    const read = await control({ method: 'acts_as', reader: facts.actor, topic_id: topic });
    return read.acts.items.find(x => x.message_id === root)?.acts?.cover;
  };
  const make = async phase => {
    const topic = `promise-717-${phase}-${++serial}`;
    const ids = await seed(topic, [
      ['root', { sender: facts.actor, body: 'Cabin booking dossier' }],
      ['answer', { sender: 'aim-core', join: true, reply_to: 'root', addressees: [facts.actor], body: text }],
      ['note', { sender: facts.actor, reply_to: 'root', body: 'The lake road is clear.' }],
    ]);
    const result = await write(ids.root, { stands: 'Road clear', waiting: [{ text: 'Which cabin?', default: 'the lakeside one' }],
      payload: { text: 'The cabin booking', message_id: ids.answer } }, `${topic}-cover`);
    assert.equal(result.status, 'committed', JSON.stringify(result));
    const promise = { id: 'cabin', text, message_id: ids.answer, source_revision: 1,
      due: { at_ms: 1795024800000, time_zone: 'America/Los_Angeles' }, state: 'promised' };
    return { topic, ids, promise };
  };
  const covers = root => `#messages .reply-stack[data-stack="${root}"] > .dossier-cover`;
  const measure = (p, selector) => p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(selector)});if(!c)return null;
    const b=c.getBoundingClientRect();return {words:c.textContent,rows:[...c.querySelectorAll('.cover-promise')].map(e=>({text:e.textContent,state:e.dataset.state,
      old:[...e.querySelectorAll('s')].map(s=>({text:s.textContent,struck:getComputedStyle(s).textDecorationLine.includes('line-through')})),
      cite:e.querySelector('.cover-src')?.textContent,times:[...e.querySelectorAll('time')].map(t=>t.dateTime)})),
      left:b.left,right:b.right,viewport:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,done:c.dataset.done}})()`);
  const verify = (seen, state, expected, moved) => {
    const EDGE_TOLERANCE_PX = 2; // Engine rounding only; the +160px width mutant must fail.
    assert.ok(seen && seen.rows.length === 1, 'one explicit promise appears');
    assert.equal(seen.rows[0].state, state);
    assert.ok(seen.rows[0].text.includes(text));
    assert.ok(seen.rows[0].text.includes(expected));
    assert.ok(seen.rows[0].cite, 'source attribution is linked');
    if (moved) assert.ok(seen.rows[0].old.some(x => x.struck && x.text.includes('America/Los_Angeles')), 'the prior time is visibly struck');
    assert.ok(seen.left >= -EDGE_TOLERANCE_PX && seen.right <= seen.viewport + EDGE_TOLERANCE_PX && seen.overflow <= EDGE_TOLERANCE_PX,
      `cover fits within ${EDGE_TOLERANCE_PX}px rounding tolerance: ${JSON.stringify(seen)}`);
    assert.equal(seen.done, 'false', 'a kept promise never gives Done');
    assert.ok(seen.words.includes('Which cabin?') && seen.words.includes('Road clear') && seen.words.includes('payload proposed'), 'existing cover fields survive');
  };
  const scheme = async (p, theme) => {
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await until(() => p.evaluate(`matchMedia('(prefers-color-scheme: ${theme})').matches`), 'theme selected');
  };
  const scenario = async (phase, baseline = false, capture = true, selected = null) => {
    const fixture = await make(phase);
    const { topic, ids, promise } = fixture;
    // Capture genuine live92 layout at every requested size/theme before asserting the missing act.
    if (baseline) for (const [width, shape] of sizes) for (const theme of ['light', 'dark']) {
      // Each viewport/theme owns its topic: reading a source in one cannot fold the next one's source.
      const fixture = await make(`base-${width}-${theme}`);
      const p = await open(`${fixture.topic}`, shape, fixture.topic, fixture.ids.root);
      try { await scheme(p, theme); await centre(p, covers(fixture.ids.root)); await shot(p, `717-base-feed-${width}-${theme}`);
        // The payload citation stays visible even after reading folds its source message.
        const device = shape.startsWith('phone') ? 'phone' : 'laptop';
        const citation = covers(fixture.ids.root) + ' .cover-payload .cover-src';
        await centre(p, citation); await press(p, device, citation);
        await until(() => p.evaluate('document.querySelector("#reader").open'), 'the visible source citation opens the Reader');
        await press(p, device, '#reader-cover > summary');
        await until(() => p.evaluate('document.querySelector("#reader-cover").open'), 'baseline disclosure opens');
        await shot(p, `717-base-reader-${width}-${theme}`);
      } finally { await p.close(); }
    }
    const result = await write(ids.root, { promises: [promise] }, `${topic}-promise`);
    assert.equal(result.status, 'committed', `explicit promise write: ${JSON.stringify(result)}`);
    for (const [width, shape] of sizes) for (const theme of ['light', 'dark']) {
      const { topic, ids, promise } = await make(`${phase}-${width}-${theme}`);
      const device = shape.startsWith('phone') || shape === 'phone' ? 'phone' : 'laptop';
      const p = await open(`${topic}-${width}-${theme}`, shape, topic, ids.root);
      try { await scheme(p, theme);
      let rev = 0;
      for (const [branch, state, due, expected] of [
        ['normal', 'promised', promise.due, '2026-11-18 10:00 -08:00 · America/Los_Angeles'],
        ['missing-time', 'promised', null, 'No time given'],
        ['moved-timezone', 'promised', { at_ms: 1795111200000, time_zone: 'Pacific/Auckland' }, 'Pacific/Auckland'],
        ['missed', 'missed', { at_ms: 1795111200000, time_zone: 'Pacific/Auckland' }, 'missed'],
        ['kept', 'kept', { at_ms: 1795111200000, time_zone: 'Pacific/Auckland' }, 'kept'],
      ]) {
        const update = await write(ids.root, { promises: [{ ...promise, state, due }] }, `${topic}-${width}-${theme}-${++rev}`);
        assert.equal(update.status, 'committed', JSON.stringify(update));
        if (selected && selected !== branch) continue;
        await until(async () => { const c = await measure(p, covers(ids.root)); return c?.rows[0]?.state === state && c.rows[0].text.includes(expected); }, `recorded ${state} / ${expected} arrives`);
        await centre(p, covers(ids.root));
        const seen = await measure(p, covers(ids.root)); verify(seen, state, expected, rev >= 3);
        observations.push({ name: 'item 717 cover state', phase, engine, width, theme, state, seen });
        if (capture) await shot(p, `717-${phase}-${state}-${rev}-feed-${width}-${theme}`);
        // Open the cover's native source link by touch; keyboard reaches the same link with Tab on a laptop.
        const link = covers(ids.root) + ' .cover-promise > .cover-src';
        if (device === 'phone') {
          const TARGET_TOLERANCE_PX = 1; // 44px target, accepts rounding; a 24px target must fail.
          const b = await p.box(link);
          assert.ok(b.height >= 44 - TARGET_TOLERANCE_PX && b.width >= 44 - TARGET_TOLERANCE_PX, 'promise source is a 44px touch target within named tolerance');
        }
        await centre(p, link);
        if (device === 'phone') await press(p, device, link);
        else {
          let reached = false;
          for (let n = 0; n < 120; n++) { await p.key('Tab'); if (await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(link)})`)) { reached = true; break; } }
          assert.ok(reached, 'native Tab reaches the promise source'); await p.key('Enter');
        }
        await until(() => p.evaluate('document.querySelector("#reader").open'), 'source link opens the Reader');
        await press(p, device, '#reader-cover > summary');
        await until(() => p.evaluate('document.querySelector("#reader-cover").open'), 'native cover disclosure opens');
        verify(await measure(p, '#reader-cover .dossier-cover'), state, expected, rev >= 3);
        if (capture) await shot(p, `717-${phase}-${state}-${rev}-reader-${width}-${theme}`);
        await closeReader(p, device);
      }
      assert.equal((await held(topic, ids.root)).payload.done, null, 'no inferred Done in Core');
      assert.deepEqual(p.errors, []);
      } finally { await p.close(); }
    }
    return { topic, ids, promise };
  };
  await check('reading item 717 promises carry exact words explicit times history kept and missed on the cover and Reader at 320 375 390 laptop light dark', async () => scenario('final', !(await readFile(new URL('../web/dossier-cover.mjs', import.meta.url), 'utf8')).includes('function promiseRow(')));

  for (const branch of ['missing-time', 'moved-timezone', 'missed', 'kept']) {
    await check(`reading item 717 ${branch} is explicit on the cover and Reader at 320 375 390 laptop light dark`,
      () => scenario(branch, false, false, branch));
  }

  await check('reading item 717 a single message shows a promise pill and opens its complete Reader history at 320 375 390 laptop light dark', async () => {
    for (const [width, shape] of sizes) for (const theme of ['light', 'dark']) {
      const topic = `promise-717-lone-${++serial}`;
      const ids = await seed(topic, [['root', { sender: 'aim-core', join: true, body: text, addressees: [facts.actor] }]]);
      const promise = { id: 'cabin', text, message_id: ids.root, source_revision: 1, due: null, state: 'promised' };
      assert.equal((await write(ids.root, { promises: [promise] }, topic + '-promise')).status, 'committed');
      const p = await open(topic, shape, topic, ids.root), device = shape.startsWith('phone') ? 'phone' : 'laptop';
      try {
        await scheme(p, theme);
        const pill = card(ids.root) + ' .pill-promise';
        await until(() => p.evaluate(`document.querySelector(${JSON.stringify(pill)})?.textContent.includes('No time given')`), 'the lone promise pill is drawn');
        await centre(p, pill); await shot(p, `717-lone-${width}-${theme}`);
        await openReader(p, device, ids.root, text);
        await until(() => p.evaluate(`document.querySelector('#reader-cover-line').textContent.includes(${JSON.stringify(text)})`), 'a promise-only cover names its words on the quiet line');
        await press(p, device, '#reader-cover > summary');
        await until(() => p.evaluate('document.querySelector("#reader-cover").open'), 'the promise-only sheet opens natively');
        const at = await measure(p, '#reader-cover .dossier-cover');
        assert.equal(at.rows.length, 1); assert.ok(at.rows[0].text.includes('No time given')); assert.equal(at.done, 'false');
        await shot(p, `717-lone-reader-${width}-${theme}`);
        assert.deepEqual(p.errors, []);
      } finally { await p.close(); }
    }
  });

  const sourceOpen = async (p, device, root) => {
    const citation = covers(root) + ' .cover-payload .cover-src';
    await centre(p, citation); await press(p, device, citation);
    await until(() => p.evaluate('document.querySelector("#reader").open'), 'payload source opens natively');
    await press(p, device, '#reader-cover > summary');
    await until(() => p.evaluate('document.querySelector("#reader-cover").open'), 'cover disclosure opens natively');
  };
  // Hold a real native thumb request before transport in both engines; no handler is called.
  const HOLD_THUMB = `(()=>{const f=window.fetch;window.promiseThumbQueue=[];window.promiseHold=true;
    window.fetch=function(input,init){let b;try{b=JSON.parse(init?.body)}catch{};
      if(b?.kind==='message.thumb'&&window.promiseHold)return new Promise(go=>window.promiseThumbQueue.push(()=>go(f.call(this,input,init))));
      return f.call(this,input,init)};
    window.releasePromiseThumb=()=>{window.promiseHold=false;for(const go of window.promiseThumbQueue.splice(0))go()}})()`;
  for (const stage of ['pending', 'refused', 'retried']) await check(`reading item 717 owner acceptance ${stage} keeps the committed promise and only the owner gives Done at 320 375 390 laptop light dark`, async () => {
    for (const [width, shape] of sizes) for (const theme of ['light', 'dark']) {
      const { topic, ids, promise } = await make(`owner-${stage}-${width}-${theme}`);
      assert.equal((await write(ids.root, { promises: [{ ...promise, state: 'kept' }] }, topic + '-kept')).status, 'committed');
      const device = shape.startsWith('phone') ? 'phone' : 'laptop';
      const p = await open(topic, shape, topic, ids.root, HOLD_THUMB);
      try {
        await scheme(p, theme); await sourceOpen(p, device, ids.root);
        await p.evaluate('window.staleThumb=true');
        await centre(p, '#thumb-source'); await press(p, device, '#thumb-source');
        await until(() => p.evaluate('window.promiseThumbQueue.length===1'), 'the native thumb is queued before transport');
        assert.equal((await held(topic, ids.root)).payload.done, null, 'a pending acceptance is not Done');
        assert.equal((await measure(p, '#reader-cover .dossier-cover')).rows[0].state, 'kept');
        if (stage === 'pending') await shot(p, `717-owner-pending-${width}-${theme}`);
        await p.evaluate('window.releasePromiseThumb()');
        await until(() => p.evaluate('!document.querySelector("#reader-notice").hidden && document.querySelector("#reader-notice").textContent.length>0'), 'Core refusal is said by the real Reader');
        assert.equal((await held(topic, ids.root)).payload.done, null, 'refused acceptance changes nothing');
        assert.equal(await p.evaluate('document.querySelector("#reader").open'), true, 'refusal leaves the Reader open');
        if (stage === 'refused') await shot(p, `717-owner-refused-${width}-${theme}`);
        if (stage === 'retried') {
          await until(() => p.evaluate('!document.querySelector("#thumb-source").disabled'), 'refused thumb is ready for a native retry');
          await centre(p, '#thumb-source'); await press(p, device, '#thumb-source');
          await until(async () => (await held(topic, ids.root)).payload.done?.by === facts.actor, 'the owner gives Done through the retry gesture');
          await until(() => p.evaluate('!document.querySelector("#reader").open'), 'accepted thumb closes the Reader');
          await until(async () => (await measure(p, covers(ids.root)))?.words.includes('done · your'), 'owner acceptance arrives on the cover');
          assert.equal((await held(topic, ids.root)).promises[0].state, 'kept');
          await centre(p, covers(ids.root)); await shot(p, `717-owner-retried-${width}-${theme}`);
        }
        assert.deepEqual(p.errors, []);
      } finally { await p.close(); }
    }
  });

  await check('reading item 717 a nonowner native thumbs-up never accepts the kept promise payload at 320 375 390 laptop light dark', async () => {
    // Owner transfer is a real existing act, restored even on failure. No alternate actor's DOM is injected.
    await control({ method: 'outcome_change', sender: facts.actor, workspace_id: 'w1', member: 'fixture-other-person', present: true, operation_id: '717-other-owner-member' });
    await control({ method: 'outcome_change', sender: facts.actor, workspace_id: 'w1', owner: 'fixture-other-person', operation_id: '717-other-owner' });
    try {
      for (const [width, shape] of sizes) for (const theme of ['light', 'dark']) {
        const { topic, ids, promise } = await make(`nonowner-${width}-${theme}`);
        assert.equal((await write(ids.root, { promises: [{ ...promise, state: 'kept' }] }, topic + '-kept')).status, 'committed');
        const p = await open(topic, shape, topic, ids.root), device = shape.startsWith('phone') ? 'phone' : 'laptop';
        try {
          await scheme(p, theme); await sourceOpen(p, device, ids.root);
          assert.ok((await measure(p, '#reader-cover .dossier-cover')).words.includes('Waits on'));
          await centre(p, '#thumb-source'); await press(p, device, '#thumb-source');
          await until(() => p.evaluate('!document.querySelector("#reader").open'), 'the nonowner thumbs the source natively');
          assert.equal((await held(topic, ids.root)).payload.done, null, 'a nonowner thumb never accepts');
          await centre(p, covers(ids.root)); await shot(p, `717-nonowner-${width}-${theme}`);
          assert.deepEqual(p.errors, []);
        } finally { await p.close(); }
      }
    } finally {
      await control({ method: 'outcome_change', sender: 'fixture-other-person', workspace_id: 'w1', owner: facts.actor, operation_id: '717-owner-restored' });
    }
  });

  for (const branch of ['empty', 'read-only', 'refused-edit']) await check(`reading item 717 ${branch} keeps the cover truth at 320 375 390 laptop light dark`, async () => {
    for (const [width, shape] of sizes) for (const theme of ['light', 'dark']) {
      const { topic, ids, promise } = await make(`${branch}-${width}-${theme}`);
      await write(ids.root, { promises: [promise] }, topic + '-promise');
      const p = await open(topic, shape, topic, ids.root), device = shape.startsWith('phone') ? 'phone' : 'laptop';
      let archived = false;
      try {
        await scheme(p, theme);
        if (branch === 'empty') {
          assert.equal((await write(ids.root, { stands: null, waiting: [], payload: null, promises: [] }, topic + '-clear')).status, 'committed');
          await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(covers(ids.root))})`), 'an empty cover draws no sheet');
          assert.equal(await held(topic, ids.root), null);
          await centre(p, card(ids.root));
        } else if (branch === 'refused-edit') {
          const before = await held(topic, ids.root);
          const refused = await write(ids.root, { promises: [{ ...promise, text: 'Invented words' }] }, topic + '-refused');
          assert.equal(refused.status, 'rejected');
          assert.deepEqual(await held(topic, ids.root), before, 'the refused edit changes no cover fact');
          const retry = await write(ids.root, { promises: [promise] }, topic + '-retried');
          assert.equal(retry.result.changed, false, 'a valid identical retry creates no history');
          await sourceOpen(p, device, ids.root);
          assert.equal((await measure(p, '#reader-cover .dossier-cover')).rows[0].state, 'promised');
        } else {
          await control({ method: 'targets', kind: 'outcome.end_set', args: { state: 'archived' }, operation_id: topic + '-archive' });
          archived = true;
          await sourceOpen(p, device, ids.root);
          const refused = await write(ids.root, { promises: [{ ...promise, state: 'kept' }] }, topic + '-closed-edit');
          assert.equal(refused.error?.code, 'OUTCOME_ARCHIVED');
          assert.equal((await held(topic, ids.root)).promises[0].state, 'promised');
          assert.equal((await measure(p, '#reader-cover .dossier-cover')).rows[0].state, 'promised', 'read-only cover stays readable');
        }
        await shot(p, `717-${branch}-${width}-${theme}`);
        assert.deepEqual(p.errors, []);
      } finally {
        await p.close();
        if (archived) await control({ method: 'targets', kind: 'outcome.end_set', args: { state: 'open' }, operation_id: topic + '-reopen' });
      }
    }
  });

  await check('reading item 717 applied rendering mutants fail the same own case and restored bytes pass', async () => {
    const url = new URL('../web/dossier-cover.mjs', import.meta.url), original = await readFile(url, 'utf8');
    if (!original.includes('for (const promise of cover.promises ?? [])')) {
      observations.push({ name: 'item 717 final-only mutants excluded at unchanged product baseline' });
      return;
    }
    const restart = async () => {
      await control({ method: 'server_stop' });
      const next = await control({ method: 'server_start' });
      assert.equal(next.origin, facts.origin, 'owned server returns on its isolated origin');
      facts.token = next.token;
    };
    const definitions = [
      { name: 'promise omitted', from: 'for (const promise of cover.promises ?? []) sheet.append', to: 'for (const promise of []) sheet.append' },
      { name: 'prior time not struck', from: "element(doc, 's', 'promise-prior')", to: "element(doc, 'span', 'promise-prior')" },
      { name: 'missed credited kept', from: "row.dataset.state = promise.state;", to: "row.dataset.state = promise.state === 'missed' ? 'kept' : promise.state;" },
      { name: 'cover too wide', from: "sheet.setAttribute('role', 'note');", to: "sheet.style.width = 'calc(100% + 160px)'; sheet.setAttribute('role', 'note');" },
    ];
    for (const mutant of definitions) {
      assert.equal(original.split(mutant.from).length, 2, mutant.name + ' has one real target');
      const changed = original.replace(mutant.from, mutant.to);
      await writeFile(url, changed); assert.equal(await readFile(url, 'utf8'), changed, 'mutation applied');
      let failure;
      try {
        await restart();
        const served = await (await fetch(facts.origin + '/dossier-cover.mjs')).text();
        assert.equal(served, changed, 'the owned server serves the actual mutated bytes');
        await scenario('mutant-' + serial, false, false);
      } catch (error) { failure = error; }
      finally { await writeFile(url, original); assert.equal(await readFile(url, 'utf8'), original, 'original bytes restored'); await restart();
        assert.equal(await (await fetch(facts.origin + '/dossier-cover.mjs')).text(), original, 'restored bytes are served too'); }
      assert.ok(failure, mutant.name + ' must fail');
      const intended = { 'promise omitted': /recorded promised/, 'prior time not struck': /prior time is visibly struck/, 'missed credited kept': /recorded missed/, 'cover too wide': /cover fits within/ };
      assert.match(String(failure), intended[mutant.name], 'the mutation fails the intended product assertion');
      observations.push({ name: 'item 717 killed mutant', mutant: mutant.name, error: String(failure), original_sha256: createHash('sha256').update(original).digest('hex'), mutated_sha256: createHash('sha256').update(changed).digest('hex'), restored_sha256: createHash('sha256').update(await readFile(url)).digest('hex') });
      await scenario('restored-' + serial, false, false);
    }
  });
}
