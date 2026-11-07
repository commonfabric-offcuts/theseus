import assert from 'node:assert/strict';

// An outcome's target, its kind and its checks (items 14, 104, 12; docs/targets.md) in the real browser against
// the real server. On the outcome page its owner reads "No target yet" and the kind as two chips, one tap each;
// "Write the target" opens in place, Escape leaves the words as they were, Return saves them, and there is no
// Save button; a run of the checks shows with no reload, grouped, each group and check opened from the keyboard;
// Measurements lists every reading; a topic opens with the target as one closed line; in the improvement loop a
// chart says the reading of the mark under the pointer or reached by Tab, Ship it anyway opens by keyboard and
// accepts on Return only with words, and the problems line opens its topic; Reached opens in place,
// asks him to confirm when nothing checks it, and folds the outcome into "Reached (1)". Each page fits 1280 and
// 390, light and dark, with no sideways scroll. Run by reader_persistence_native.mjs with --targets; screenshots
// are kept as targets-*.png for review.
const SIZES = { laptop: { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, phone: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } };
const COMMIT = 'a'.repeat(40);

export async function targetsChecks({ check, page, until, control, view, facts, shot }) {
  const open = (name, url, size = 'laptop', theme = 'light') => page(name, null, true, { url: facts.origin + url, beforeNavigate: async q => {
    await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await q.send('Emulation.setDeviceMetricsOverride', SIZES[size]);
    if (SIZES[size].mobile) await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  } });
  const ready = p => until(() => p.evaluate('document.body?.dataset.ready==="true"').catch(() => false), 'the page is ready');
  const tap = async (p, selector) => {
    assert.ok(await p.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e?.scrollIntoView({block:'center'});return Boolean(e)})()`), `${selector} is on the page`);
    await p.point(selector);
  };
  const focusedKey = p => p.evaluate(`document.activeElement?.closest?.('[data-key]')?.dataset.key ?? document.activeElement?.tagName ?? null`);
  const sideways = p => p.evaluate('document.documentElement.scrollWidth - innerWidth');
  const checks = async (workspace = 'w1') => view('outcome_checks', { workspace_id: workspace });
  // The page reads its panels again on every commit, its own included, and a repaint replaces their nodes: a
  // step after a command waits for that read of the target to land and be painted, or a tap can fall on a node
  // the repaint is about to replace. `before` is the page's network log length before the command was sent;
  // `reads` is how many reads of the target follow it: the commit's, and the panel's own after a command it sent.
  const reread = async (p, before, reads = 1) => {
    const sent = (from, test) => p.network.slice(from).filter(e => e.method === 'Network.requestWillBeSent' && test(e.params.request));
    const command = await until(() => sent(before, r => r.url.endsWith('/api/command'))[0], 'the command was sent');
    const ids = await until(() => { const found = sent(p.network.indexOf(command), r => r.url.endsWith('/api/view') && (r.postData ?? '').includes('"outcome_checks"'));
      return found.length >= reads && found.map(e => e.params.requestId); }, 'the page reads the target again after the commit');
    await until(() => ids.every(id => p.network.some(e => e.method === 'Network.loadingFinished' && e.params.requestId === id)), 'and those reads land');
    await p.evaluate('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(true))))');
  };
  let serial = 0;
  const act = (kind, args, more = {}) => control({ method: 'targets', operation_id: `targets-native-${++serial}`, kind, args, ...more });
  const panel = p => p.evaluate(`(()=>{const h=document.getElementById('target-panel');const shown=e=>Boolean(e)&&e.getClientRects().length>0;
    return {shown:shown(h),text:h?.textContent??'',chips:[...h.querySelectorAll('.kind-chip')].map(b=>[b.dataset.key,b.getAttribute('aria-pressed')]),
      buttons:[...h.querySelectorAll('button')].filter(shown).map(b=>b.textContent),groups:[...h.querySelectorAll('details.tg-group')].map(d=>[d.querySelector('.tg-group-name')?.textContent,d.open])}})()`);

  await check('targets the owner reads No target yet and the kind as two chips, and one tap changes the kind', async () => {
    const p = await open('targets-outcome', '/?workspace=w1');
    await ready(p);
    const first = await until(async () => { const seen = await panel(p); return seen.shown && seen.chips.length ? seen : null; }, 'the target panel shows');
    assert.match(first.text, /No target yet/);
    assert.deepEqual(first.chips, [['kind:reach', 'false'], ['kind:keep', 'true']]);
    assert.equal(await p.evaluate(`document.querySelectorAll('#target-panel select, #target-panel input[type=radio]').length`), 0, 'chips, not a dropdown or radios');
    const widths = await p.evaluate(`[...document.querySelectorAll('.kind-chip')].map(b=>b.getBoundingClientRect().width)`);
    for (const width of widths) assert.ok(width <= 19.5 * 16 + 1, `a chip is no wider than its words allow (${width}px)`);
    const choosing = p.network.length;
    await tap(p, '[data-key="kind:reach"]');
    await until(async () => (await checks()).kind.kind === 'reach', 'one tap makes it an outcome to reach');
    await reread(p, choosing, 2);
    await until(async () => (await panel(p)).chips.map(([, pressed]) => pressed).join() === 'true,false', 'the chip pressed moves, live');
    assert.equal(await focusedKey(p), 'kind:reach', 'the chip keeps the focus across the repaint');
    assert.ok((await panel(p)).buttons.includes('Say it is reached'), 'an outcome to reach offers Say it is reached');
    await tap(p, '[data-key="kind:keep"]');
    await until(async () => (await checks()).kind.kind === 'keep', 'and one tap back');
    await until(async () => (await panel(p)).chips.map(([, pressed]) => pressed).join() === 'false,true', 'the chip pressed moves back, live');
    assert.ok(!(await panel(p)).buttons.includes('Say it is reached'), 'an outcome to keep is never said to be reached');
    assert.ok(await sideways(p) <= 0, 'no sideways scroll at 1280');
    await shot(p, 'targets-outcome-empty');
    assert.deepEqual(p.errors, []);
  });

  await check('targets Write the target opens in place: Escape leaves the words as they were, Return saves them, and there is no Save button', async () => {
    const p = await open('targets-write', '/?workspace=w1');
    await ready(p);
    await until(async () => (await panel(p)).buttons.includes('Write the target'), 'the owner is offered Write the target');
    await tap(p, '[data-key="write-open"]');
    await until(async () => (await focusedKey(p)) === 'writer', 'the box opens in place with the caret in it');
    assert.deepEqual((await panel(p)).buttons.filter(text => /save/i.test(text)), [], 'Return saves; there is no Save button');
    await p.send('Input.insertText', { text: 'Every topic keeps its place.' });
    await p.key('Escape');
    await until(async () => (await focusedKey(p)) === 'write-open', 'Escape closes the box and gives the button its focus back');
    assert.equal((await checks()).target, null, 'nothing was saved');
    await tap(p, '[data-key="write-open"]');
    await until(async () => (await focusedKey(p)) === 'writer', 'the box opens again');
    await p.send('Input.insertText', { text: 'Every topic keeps its place.' });
    await p.key('Enter');
    await until(async () => (await checks()).target?.text === 'Every topic keeps its place.', 'Return saves the words');
    await until(() => p.evaluate(`document.querySelector('#target-panel .tg-text')?.textContent==='Every topic keeps its place.'`), 'the words show as the target');
    assert.equal(await p.evaluate(`document.querySelector('[data-key="writer"]')`), null, 'the box closes once saved');
    await shot(p, 'targets-written');
    assert.deepEqual(p.errors, []);
  });

  await check('targets a run of the checks shows with no reload, grouped, and each group and check opens from the keyboard; Measurements lists every reading', async () => {
    const p = await open('targets-checks', '/?workspace=w1');
    await ready(p);
    const loaded = await p.evaluate('performance.timeOrigin');
    await act('check.define', { check: { check_id: 'units', group_name: 'Checks', position: 1, name: 'Unit checks', kind: 'pass', source: 'release-check:units' } });
    await act('check.define', { check: { check_id: 'duration', group_name: 'Measures', position: 2, name: 'Release check time', kind: 'measure', source: 'release-check:duration',
      unit: 'min', better: 'lower', target_value: 20, tolerance: 0.25, proves: 'Releases are quick' } });
    await act('record_checks', null, { run: { commit: COMMIT, started_at: '2026-11-06T05:00:00-08:00', finished_at: '2026-11-06T05:18:00-08:00', tools: { 'release-check': 't-1' },
      steps: [], note: '', readings: [{ check_id: 'units', result: 'passed', value: 1846, words: '1,846 pass' }, { check_id: 'duration', result: 'measured', value: 18, words: '18 minutes' }] } });
    await until(async () => (await panel(p)).groups.length === 2, 'the checks show, live');
    assert.equal(await p.evaluate('performance.timeOrigin'), loaded, 'with no reload');
    assert.deepEqual((await panel(p)).groups, [['Checks', false], ['Measures', false]], 'every group closed while nothing fails or waits');
    await p.evaluate(`document.querySelector('[data-fold="group:Measures"] > summary').focus()`);
    await p.key('Enter');
    await until(async () => (await panel(p)).groups[1][1] === true, 'Return on a group opens it');
    await p.evaluate(`document.querySelector('[data-fold="check:duration"] > summary').focus()`);
    await p.key('Enter');
    const opened = await until(() => p.evaluate(`(()=>{const d=document.querySelector('[data-fold="check:duration"]');return d?.open?d.textContent:null})()`), 'and on a check');
    assert.match(opened, /18 minutes/);
    assert.match(opened, /Releases are quick/);
    await shot(p, 'targets-checks');
    await tap(p, '#target-panel .tg-card > .tg-links a');
    await until(() => p.evaluate('document.body?.dataset.ready==="true" && location.search==="?measurements=w1"').catch(() => false), 'Open Measurements opens its page');
    const page = await p.evaluate(`(()=>({title:document.getElementById('topic-title').textContent,sections:[...document.querySelectorAll('#measurements-page .tg-measure h3')].map(h=>h.textContent),
      rows:[...document.querySelectorAll('#measurements-page tbody tr')].map(r=>r.children[2]?.textContent)}))()`);
    assert.equal(page.title, 'Measurements: Isolated wiring');
    assert.deepEqual(page.sections, ['Unit checks', 'Release check time']);
    assert.ok(page.rows.includes('1,846 pass') && page.rows.includes('18 minutes'), JSON.stringify(page.rows));
    assert.ok(await sideways(p) <= 0, 'no sideways scroll on Measurements');
    await shot(p, 'targets-measurements');
    assert.deepEqual(p.errors, []);
  });

  await check('targets a topic opens with its outcome\'s target as one closed line that opens to its words', async () => {
    const p = await open('targets-topic', '/?topic=t1');
    await ready(p);
    const line = await until(() => p.evaluate(`(()=>{const h=document.getElementById('topic-target');const d=h?.querySelector('details');
      return h&&!h.hidden&&d?{open:d.open,summary:d.querySelector('summary').textContent}:null})()`), 'the target line shows');
    assert.equal(line.open, false, 'closed at first');
    assert.match(line.summary, /^Target .*Isolated wiring/);
    await tap(p, '#topic-target summary');
    assert.equal(await p.evaluate(`document.querySelector('#topic-target .tg-text').textContent`), 'Every topic keeps its place.');
    assert.equal(await p.evaluate(`document.querySelector('#topic-target details').open`), true);
    await shot(p, 'targets-topic-line');
    assert.deepEqual(p.errors, []);
  });

  await check('targets the outcome page and Measurements fit 390 with no sideways scroll, light and dark', async () => {
    for (const [url, name] of [['/?workspace=w1', 'outcome'], ['/?measurements=w1', 'measurements']]) {
      for (const theme of ['light', 'dark']) {
        const p = await open(`targets-${name}-phone-${theme}`, url, 'phone', theme);
        await ready(p);
        await until(() => p.evaluate(`document.querySelectorAll('${name === 'outcome' ? '#target-panel .tg-group' : '#measurements-page .tg-measure'}').length > 0`), 'the checks show');
        assert.ok(await sideways(p) <= 0, `no sideways scroll at 390 (${name}, ${theme})`);
        await shot(p, `targets-${name}-phone-${theme}`);
        assert.deepEqual(p.errors, []);
      }
    }
  });

  await check('targets the loop: a chart says the mark under the pointer and the one Tab reaches; Ship it anyway opens by keyboard, sends nothing without words and accepts on Return; the problems line opens its topic', async () => {
    const SHA_19 = '1'.repeat(40), SHA_NEW = '3'.repeat(40), tools = { 'release-check': 't-1', chrome: '142' };
    await control({ method: 'light_outcome', outcome: 'tg-speed', title: 'Speed', topic: { id: 'tg-speed-work', title: 'Speed work' } });
    const on = { workspace_id: 'tg-speed' };
    await act('check.define', { check: { check_id: 'units', group_name: 'Checks', position: 1, name: 'Unit checks', kind: 'pass', source: 'release-check:units' } }, on);
    await act('check.define', { check: { check_id: 'duration', group_name: 'Measures', position: 2, name: 'Release check time', kind: 'measure', source: 'release-check:duration',
      unit: 'min', better: 'lower', target_value: 20, tolerance: 0.25 } }, on);
    await act('check.define', { check: { check_id: 'found-problems', group_name: 'Measures', position: 3, name: 'Problems you find that no check caught', kind: 'measure',
      source: 'found-problems', better: 'lower', counted_since_ms: Date.parse('2026-11-01T00:00:00-08:00') } }, on);
    await act('release', null, { record: { release: 19, commit: SHA_19, deployed_at: '2026-11-01T05:00:00-08:00', items: [], source: 'backfill' } });
    const readings = minutes => [{ check_id: 'units', result: 'passed', value: 1000, words: '1,000 pass' }, { check_id: 'duration', result: 'measured', value: minutes, words: `${minutes} minutes` }];
    const at = time => ({ started_at: time, finished_at: time, tools, steps: [], note: '' });
    await act('record_checks', null, { ...on, run: { commit: SHA_19, ...at('2026-11-01T05:00:00-08:00'), readings: readings(17) } });
    await act('record_checks', null, { ...on, run: { commit: SHA_NEW, ...at('2026-11-03T05:00:00-08:00'), readings: readings(25),
      base: { commit: SHA_19, ...at('2026-11-03T04:00:00-08:00'), note: 'rerun', readings: readings(17) } } });
    const opening = (await view('topic_messages', { topic_id: 'tg-speed-work', direction: 'before', limit: 30 })).items[0].id;
    await act('problem.file', { what: 'The New line jumped', kind: 'defect', message_id: opening }, on);
    assert.equal((await checks('tg-speed')).loop.candidate.state, 'stopped', 'the candidate is held on the worse measure');

    const p = await open('targets-loop', '/?workspace=tg-speed');
    await ready(p);
    const chart = '#loop-panel svg[aria-label="Release check time, by release"]';
    const line = `${chart} + .chart-readout`;
    const said = () => p.evaluate(`document.querySelector(${JSON.stringify(line)})?.textContent ?? null`);
    await until(() => p.evaluate(`document.querySelectorAll(${JSON.stringify(chart + ' rect.chart-mark')}).length === 2`), 'the chart shows release 19 and the candidate');
    assert.equal(await said(), '', 'the line is empty until a mark is pointed at or focused');
    await p.evaluate(`document.querySelector(${JSON.stringify(chart)}).scrollIntoView({block:'center'})`);
    await p.point(`${chart} rect.chart-mark`, 'move');
    await until(async () => (await said()) === 'Release 19: 17 min', 'the pointer on a mark says its reading');
    await p.point('#loop-panel .chart-card:has(svg[aria-label="Release check time, by release"]) figcaption strong', 'move');
    await until(async () => (await said()) === '', 'the pointer leaving the chart empties the line');
    await p.evaluate(`document.querySelector(${JSON.stringify(chart + ' rect.chart-mark')}).focus()`);
    await until(async () => (await said()) === 'Release 19: 17 min', 'a focused mark says its reading');
    await p.key('Tab');
    assert.equal(await p.evaluate(`document.activeElement===document.querySelectorAll(${JSON.stringify(chart + ' rect.chart-mark')})[1]`), true, 'Tab moves to the next mark');
    await until(async () => (await said()) === 'Release 20 candidate: 25 min', 'and the line follows it');
    assert.match(await p.evaluate(`document.querySelectorAll(${JSON.stringify(chart + ' rect.chart-mark')})[1].getAttribute('class')`), /hollow/, 'the candidate is hollow');

    const accept = '[data-fold="accept:duration"]';
    await p.evaluate(`(s=>{s.scrollIntoView({block:'center'});s.focus()})(document.querySelector('${accept} > summary'))`);
    await p.key('Enter');
    await until(() => p.evaluate(`document.querySelector('${accept}').open`), 'Return on Ship it anyway opens it');
    await p.key('Tab');
    await until(async () => (await focusedKey(p)) === 'accept-why:duration', 'Tab reaches the box for why');
    await p.key('Enter');
    await until(() => p.evaluate(`document.querySelector('${accept}')?.textContent.includes('Say why the trade is worth it first')`), 'Return with no words says why first');
    assert.equal((await checks('tg-speed')).loop.candidate.state, 'stopped', 'and nothing was sent');
    assert.equal(await focusedKey(p), 'accept-why:duration', 'the caret stays in the box');
    await p.send('Input.insertText', { text: 'Worth it for the faster wakes.' });
    const accepting = p.network.length;
    await p.key('Enter');
    await until(async () => (await checks('tg-speed')).loop.candidate.state === 'accepted', 'Return accepts it');
    await reread(p, accepting, 2);
    await until(() => p.evaluate(`document.querySelector('#loop-panel .tg-accepted')?.textContent ?? ''`), 'the page shows who accepted it and why');

    const problems = '#problems-panel [data-fold="problems"]';
    await p.evaluate(`(s=>{s.scrollIntoView({block:'center'});s.focus()})(document.querySelector('${problems} > summary'))`);
    await p.key('Enter');
    await until(() => p.evaluate(`document.querySelector('${problems}').open`), 'Return opens the problems line');
    assert.match(await p.evaluate(`document.querySelector('${problems}').textContent`), /The New line jumped/);
    await shot(p, 'targets-loop');
    await p.point(`${problems} .tg-problems a`);
    await until(() => p.evaluate(`document.body?.dataset.ready==="true" && new URLSearchParams(location.search).get('topic')==='tg-speed-work'`).catch(() => false), 'the problem opens the topic it was found in');
    assert.deepEqual(p.errors, []);
  });

  await check('targets Reached opens in place, asks him to confirm when nothing checks it, and folds the outcome into Reached (1)', async () => {
    await control({ method: 'light_outcome', outcome: 'tg-office', title: 'Office move', topic: { id: 'tg-office-plan', title: 'Plan' } });
    const p = await open('targets-reach', '/?workspace=tg-office');
    await ready(p);
    await until(async () => (await panel(p)).chips.length === 2, 'the kind chips show');
    await tap(p, '[data-key="kind:reach"]');
    await until(async () => (await panel(p)).buttons.includes('Say it is reached'), 'an outcome to reach offers Say it is reached');
    await tap(p, '[data-key="say-reached"]');
    await until(async () => (await focusedKey(p)) === 'reach-words', 'the box opens in place with the caret in it');
    assert.match(await p.evaluate(`document.querySelector('.tg-reach').textContent`), /nothing checks it yet/);
    await p.send('Input.insertText', { text: 'We moved on Friday.' });
    const before = p.network.length;
    await p.key('Enter');
    await until(() => p.evaluate(`document.querySelector('.tg-reach .notice')?.textContent ?? ''`), 'unconfirmed, Core refuses and the box says why');
    assert.equal((await checks('tg-office')).reached, null);
    // The refusal is still a recorded act, so the page reads its panels again (see reread).
    await reread(p, before);
    await tap(p, '[data-key="reach-anyway"]');
    await until(() => p.evaluate(`document.querySelector('[data-key="reach-anyway"]')?.checked === true`), 'the tap ticks Mark it reached anyway');
    await p.evaluate(`document.querySelector('[data-key="reach-words"]').focus()`);
    await p.key('Enter');
    await until(async () => (await checks('tg-office')).reached?.words === 'We moved on Friday.', 'confirmed, Return marks it reached');
    assert.equal((await view('topic', { topic_id: 'tg-office-plan' })).topic.state, 'done', 'its topics close');
    const home = await open('targets-home-reached', '/');
    await ready(home);
    const folded = await until(() => home.evaluate(`(()=>{const d=document.querySelector('.reached-outcomes');return d&&!d.hidden?d.querySelector('summary').textContent:null})()`), 'the Reached line shows');
    assert.equal(folded, 'Reached (1)');
    assert.equal(await home.evaluate(`Boolean(document.querySelector('#workspaces a[data-workspace-id="tg-office"]'))`), false, 'it leaves the list');
    await tap(home, '.reached-outcomes summary');
    await until(() => home.evaluate(`[...document.querySelectorAll('.reached-outcomes a')].some(a=>a.textContent.startsWith('Office move'))`), 'opening the line lists it');
    const row = await home.evaluate(`(()=>{const a=document.querySelector('.reached-outcomes a'),[name,when]=[a.querySelector('span'),a.querySelector('small')].map(e=>e.getBoundingClientRect());
      return {below:when.top>=name.bottom-1,tall:a.getBoundingClientRect().height}})()`);
    assert.ok(row.below, 'when it was reached sits on its own line under the name, as on the outcome rows');
    assert.ok(row.tall >= 44, `the row is a full tap target (${row.tall}px)`);
    await shot(home, 'targets-home-reached');
    assert.deepEqual([...p.errors, ...home.errors], []);
  });
}
