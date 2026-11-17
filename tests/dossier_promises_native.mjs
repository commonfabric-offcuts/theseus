// Item 717: explicit records, native cover/source/owner gestures, both engines.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

export async function promiseChecks(api, helpers) {
  const { check, until, view, control, shot, facts, observations, engine } = api;
  const { seed, open, centre, press, openReader, closeReader, card, light } = helpers;
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
  const scenario = async (phase, baseline = false) => {
    const { topic, ids, promise } = await make(phase);
    // Capture genuine live92 layout at every requested size/theme before asserting the missing act.
    if (baseline) for (const [width, shape] of sizes) {
      const p = await open(`${topic}-${width}`, shape, topic, ids.root);
      for (const theme of ['light', 'dark']) { await scheme(p, theme); await centre(p, covers(ids.root)); await shot(p, `717-base-feed-${width}-${theme}`);
        // The payload citation stays visible even after reading folds its source message.
        const device = shape.startsWith('phone') ? 'phone' : 'laptop';
        const citation = covers(ids.root) + ' .cover-payload .cover-src';
        await centre(p, citation); await press(p, device, citation);
        await until(() => p.evaluate('document.querySelector("#reader").open'), 'the visible source citation opens the Reader');
        await press(p, device, '#reader-cover > summary');
        await shot(p, `717-base-reader-${width}-${theme}`); await closeReader(p, shape.startsWith('phone') ? 'phone' : 'laptop'); }
      await p.close();
    }
    const result = await write(ids.root, { promises: [promise] }, `${topic}-promise`);
    assert.equal(result.status, 'committed', `explicit promise write: ${JSON.stringify(result)}`);
    for (const [width, shape] of sizes) for (const theme of ['light', 'dark']) {
      const device = shape.startsWith('phone') || shape === 'phone' ? 'phone' : 'laptop';
      const p = await open(`${topic}-${width}-${theme}`, shape, topic, ids.root); await scheme(p, theme);
      let rev = 0;
      for (const [state, due, expected] of [
        ['promised', promise.due, '2026-11-18 10:00 -08:00 · America/Los_Angeles'],
        ['promised', null, 'No time given'],
        ['promised', { at_ms: 1795111200000, time_zone: 'Pacific/Auckland' }, 'Pacific/Auckland'],
        ['missed', { at_ms: 1795111200000, time_zone: 'Pacific/Auckland' }, 'missed'],
        ['kept', { at_ms: 1795111200000, time_zone: 'Pacific/Auckland' }, 'kept'],
      ]) {
        const update = await write(ids.root, { promises: [{ ...promise, state, due }] }, `${topic}-${width}-${theme}-${++rev}`);
        assert.equal(update.status, 'committed', JSON.stringify(update));
        await until(async () => { const c = await measure(p, covers(ids.root)); return c?.rows[0]?.state === state && c.rows[0].text.includes(expected); }, `recorded ${state} / ${expected} arrives`);
        await centre(p, covers(ids.root));
        const seen = await measure(p, covers(ids.root)); verify(seen, state, expected, rev >= 3);
        observations.push({ name: 'item 717 cover state', phase, engine, width, theme, state, seen });
        await shot(p, `717-${phase}-${state}-${rev}-feed-${width}-${theme}`);
        // Open the cover's native source link by touch; keyboard reaches the same link with Tab on a laptop.
        const link = covers(ids.root) + ' .cover-promise > .cover-src';
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
        await shot(p, `717-${phase}-${state}-${rev}-reader-${width}-${theme}`);
        await closeReader(p, device);
      }
      assert.equal((await held(topic, ids.root)).payload.done, null, 'no inferred Done in Core');
      assert.deepEqual(p.errors, []); await p.close();
    }
    return { topic, ids, promise };
  };
  await check('reading item 717 promises carry exact words explicit times history kept and missed on the cover and Reader at 320 375 390 laptop light dark', () => scenario('final', true));

  await check('reading item 717 applied rendering mutants fail the same own case and restored bytes pass', async () => {
    const url = new URL('../web/dossier-cover.mjs', import.meta.url), original = await readFile(url, 'utf8');
    const definitions = [
      { name: 'promise omitted', from: 'for (const promise of cover.promises ?? [])', to: 'for (const promise of [])' },
      { name: 'prior time not struck', from: "element(doc, 's', 'promise-prior')", to: "element(doc, 'span', 'promise-prior')" },
      { name: 'missed credited kept', from: "row.dataset.state = promise.state;", to: "row.dataset.state = promise.state === 'missed' ? 'kept' : promise.state;" },
      { name: 'cover too wide', from: "sheet.setAttribute('role', 'note');", to: "sheet.style.width = 'calc(100% + 160px)'; sheet.setAttribute('role', 'note');" },
    ];
    for (const mutant of definitions) {
      assert.equal(original.split(mutant.from).length, 2, mutant.name + ' has one real target');
      const changed = original.replace(mutant.from, mutant.to);
      await writeFile(url, changed); assert.equal(await readFile(url, 'utf8'), changed, 'mutation applied');
      let failure;
      try { await scenario('mutant-' + serial); } catch (error) { failure = error; }
      finally { await writeFile(url, original); assert.equal(await readFile(url, 'utf8'), original, 'original bytes restored'); }
      assert.ok(failure, mutant.name + ' must fail');
      observations.push({ name: 'item 717 killed mutant', mutant: mutant.name, error: String(failure) });
      await scenario('restored-' + serial);
    }
  });
}
