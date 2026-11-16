import assert from 'node:assert/strict';

// An outcome's target, its kind and its checks (items 14, 104, 12; docs/targets.md) in the real browser against
// the real server. On the outcome page its owner reads "No target yet" and the kind as two chips, one tap each;
// "Write the target" opens in place, Escape leaves the words as they were, Return saves them, and there is no
// Save button; a run of the checks shows with no reload, grouped, each group and check opened from the keyboard;
// Measurements lists every reading; a topic opens with the target as one closed line; in the improvement loop a
// chart says the reading of the mark under the pointer or reached by Tab, Ship it anyway opens with a press and
// accepts on Return only with words, and the problems line opens its topic; Reached opens in place,
// asks him to confirm when nothing checks it, and folds the outcome into "Reached (1)". A press held down while a
// commit lands and the page repaints still clicks what was pressed: the kind chip, Write the target, a group, Ship
// it anyway and Say it is reached, across a commit elsewhere or one that changes the panel itself (web/repaint.mjs). Each page fits 1280 and
// 390, light and dark, with no sideways scroll. Run by reader_persistence_native.mjs with --targets; screenshots
// are kept as targets-*.png for review.
const SIZES = { laptop: { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, phone: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
  phone320: { width: 320, height: 640, deviceScaleFactor: 2, mobile: true }, phone375: { width: 375, height: 812, deviceScaleFactor: 2, mobile: true } };
// Item 404: each control and the box it sits in, measured where it is drawn. An "edge" is a left border unlike the
// right one, or an inset shadow: the coloured left edge or bar no card or line may carry (docs/experience-guidelines.md).
const MEASURE = `(selectors => selectors.map(selector => {
  const e = document.querySelector(selector);
  if (!e || !e.getClientRects().length) return { selector, missing: true };
  const b = e.getBoundingClientRect(), boxes = [e, e.closest('.tg-end, .standing-last, .ended-row, .ended-outcomes, .outcome-kept')].filter(Boolean);
  const edge = boxes.some(x => { const c = getComputedStyle(x);
    return (c.borderLeftStyle !== 'none' && parseFloat(c.borderLeftWidth) > 0 && (c.borderLeftWidth !== c.borderRightWidth || c.borderRightStyle === 'none')) || /inset/.test(c.boxShadow); });
  return { selector, height: b.height, inside: b.left >= -0.5 && b.right <= innerWidth + 0.5, edge, text: e.textContent };
}))`;
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
  let serial = 0;
  const act = (kind, args, more = {}) => control({ method: 'targets', operation_id: `targets-native-${++serial}`, kind, args, ...more });
  // A commit elsewhere: a message in t1, which changes nothing on an outcome page, but which the page reads again for.
  const elsewhere = () => control({ method: 'agent_message', operation_id: `targets-elsewhere-${++serial}`, body: 'A commit while a button is held down.', read: true });
  // A real press on what `selector` names, held down while `commit` lands and the outcome page has read its target
  // again and painted it, then let go. `changes`, when set, is a panel the commit must visibly change first.
  const pressAcross = async (p, selector, commit, { changes = null } = {}) => {
    await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
    const box = await p.box(selector), x = box.x + box.width / 2, y = box.y + box.height / 2;
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${x}, ${y}))`), true, `${selector} is what is pressed`);
    if (changes) await p.evaluate(`(()=>{window.panelChanged=0;new MutationObserver(records=>{window.panelChanged+=records.length;}).observe(document.querySelector(${JSON.stringify(changes)}),{subtree:true,childList:true,characterData:true,attributes:true});})()`);
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    const before = p.network.length;
    await commit();
    const sent = await until(() => p.network.slice(before).find(e => e.method === 'Network.requestWillBeSent' && e.params.request.url.endsWith('/api/view')
      && (e.params.request.postData ?? '').includes('"outcome_checks"')), 'the page reads the target again after the commit');
    await until(() => p.network.some(e => e.method === 'Network.loadingFinished' && e.params.requestId === sent.params.requestId), 'and that read lands');
    await p.evaluate('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(true))))');
    if (changes) await until(() => p.evaluate('window.panelChanged > 0'), 'the commit repaints the panel while the button is down');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
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
    await pressAcross(p, '[data-key="kind:reach"]', elsewhere);
    await until(async () => (await checks()).kind.kind === 'reach', 'one tap, held across a commit elsewhere, makes it an outcome to reach');
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
    await pressAcross(p, '[data-key="write-open"]', elsewhere);
    await until(async () => (await focusedKey(p)) === 'writer', 'a press held across a commit elsewhere opens the box in place with the caret in it');
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
    // Which document is up: its timeOrigin as first read, kept on the window (WebKit's can move 1 ms with no load).
    const loaded = await p.evaluate('(window.documentOrigin??=performance.timeOrigin)');
    await act('check.define', { check: { check_id: 'units', group_name: 'Checks', position: 1, name: 'Unit checks', kind: 'pass', source: 'release-check:units' } });
    await act('check.define', { check: { check_id: 'duration', group_name: 'Measures', position: 2, name: 'Release check time', kind: 'measure', source: 'release-check:duration',
      unit: 'min', better: 'lower', target_value: 20, tolerance: 0.25, proves: 'Releases are quick' } });
    await act('record_checks', null, { run: { commit: COMMIT, started_at: '2026-11-06T05:00:00-08:00', finished_at: '2026-11-06T05:18:00-08:00', tools: { 'release-check': 't-1' },
      steps: [], note: '', readings: [{ check_id: 'units', result: 'passed', value: 1846, words: '1,846 pass' }, { check_id: 'duration', result: 'measured', value: 18, words: '18 minutes' }] } });
    await until(async () => (await panel(p)).groups.length === 2, 'the checks show, live');
    assert.equal(await p.evaluate('(window.documentOrigin??=performance.timeOrigin)'), loaded, 'with no reload');
    assert.deepEqual((await panel(p)).groups, [['Checks', false], ['Measures', false]], 'every group closed while nothing fails or waits');
    // A run that lands while the group is pressed changes what the panel shows, its group's line among it.
    await pressAcross(p, '[data-fold="group:Checks"] > summary', () => act('record_checks', null, { run: { commit: COMMIT, started_at: '2026-11-06T06:00:00-08:00',
      finished_at: '2026-11-06T06:18:00-08:00', tools: { 'release-check': 't-1' }, steps: [], note: '',
      readings: [{ check_id: 'units', result: 'passed', value: 1846, words: '1,846 pass' }, { check_id: 'duration', result: 'measured', value: 18, words: '18 minutes' }] } }),
    { changes: '#target-panel' });
    await until(async () => (await panel(p)).groups[0][1] === true, 'a press on a group held across a commit that changes the panel opens it');
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

  await check('targets the loop: a chart says the mark under the pointer and the one Tab reaches; Ship it anyway opens with a press held across a commit, sends nothing without words and accepts on Return; the problems line opens from the keyboard and opens its topic', async () => {
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
    await pressAcross(p, `${accept} > summary`, elsewhere);
    await until(() => p.evaluate(`document.querySelector('${accept}').open`), 'a press on Ship it anyway held across a commit opens it');
    await p.key('Tab');
    await until(async () => (await focusedKey(p)) === 'accept-why:duration', 'Tab reaches the box for why');
    await p.key('Enter');
    await until(() => p.evaluate(`document.querySelector('${accept}')?.textContent.includes('Say why the trade is worth it first')`), 'Return with no words says why first');
    assert.equal((await checks('tg-speed')).loop.candidate.state, 'stopped', 'and nothing was sent');
    assert.equal(await focusedKey(p), 'accept-why:duration', 'the caret stays in the box');
    await p.send('Input.insertText', { text: 'Worth it for the faster wakes.' });
    await p.key('Enter');
    await until(async () => (await checks('tg-speed')).loop.candidate.state === 'accepted', 'Return accepts it');
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
    await pressAcross(p, '[data-key="say-reached"]', elsewhere);
    await until(async () => (await focusedKey(p)) === 'reach-words', 'the box opens in place with the caret in it');
    assert.match(await p.evaluate(`document.querySelector('.tg-reach').textContent`), /nothing checks it yet/);
    await p.send('Input.insertText', { text: 'We moved on Friday.' });
    await p.key('Enter');
    await until(() => p.evaluate(`document.querySelector('.tg-reach .notice')?.textContent ?? ''`), 'unconfirmed, Core refuses and the box says why');
    assert.equal((await checks('tg-office')).reached, null);
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

  // Item 404 (docs/targets.md, "Archived and completed"): the owner archives or completes an outcome with one press,
  // and brings it back with one press, from its page, the Outcomes home's "Archived (N)" line or a topic of it.
  const tapAt = async (p, selector) => {
    await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
    const b = await p.box(selector); assert.ok(b && b.width > 0 && b.height > 0, `visible ${selector}`);
    const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${at.x},${at.y}))`), true, `${selector} is not covered where it is tapped`);
    await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
    await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const keyOn = async (p, selector, name) => {
    await p.evaluate(`(e=>{e.scrollIntoView({block:'center'});e.focus()})(document.querySelector(${JSON.stringify(selector)}))`);
    assert.equal(await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`), true, `${selector} takes the keys`);
    await p.key(name);
  };
  const shown = (p, selector) => p.evaluate(`(e=>Boolean(e)&&e.getClientRects().length>0)(document.querySelector(${JSON.stringify(selector)}))`).catch(() => false);
  const standing = p => p.evaluate(`document.getElementById('outcome-standing')?.textContent ?? ''`);
  const ended = async workspace => (await checks(workspace)).end?.state ?? 'open';
  const homeIds = p => p.evaluate(`[...document.querySelectorAll('#workspaces a[data-workspace-id]')].map(a=>a.dataset.workspaceId)`);
  const endedCount = async () => (await view('workspaces', { limit: 20 })).ended_count;
  const origin = p => p.evaluate('(window.documentOrigin??=performance.timeOrigin)');
  const openArchived = async (p, workspace, by = 'press') => {
    await until(() => shown(p, '.ended-outcomes summary'), 'the Archived line shows');
    if (!await p.evaluate(`document.querySelector('.ended-outcomes').open`)) {
      if (by === 'keys') await keyOn(p, '.ended-outcomes summary', 'Enter'); else await tap(p, '.ended-outcomes summary');
    }
    await until(() => shown(p, `.ended-row[data-workspace-id="${workspace}"]`), 'opening the line lists it');
  };
  // A page in the background is told of commits only once it is in front again (web/freshness.mjs), as a person's is.
  const front = p => p.send('Page.bringToFront');
  // Every selector is drawn inside the window with no edge; the buttons among them (not the Archived line's summary,
  // which is a line like Reached's) are 44px or taller at a phone's width.
  const sized = async (p, selectors, size) => {
    const seen = await p.evaluate(`(${MEASURE})(${JSON.stringify(selectors)})`);
    for (const one of seen) {
      assert.ok(!one.missing, `${one.selector} is drawn (${size})`);
      if (size !== 'laptop' && !one.selector.endsWith('summary')) assert.ok(one.height >= 44, `${one.selector} is 44px or taller at ${SIZES[size].width} (${one.height}px)`);
      assert.ok(one.inside, `${one.selector} is inside the window at ${SIZES[size].width}`);
      assert.equal(one.edge, false, `${one.selector} carries no coloured edge or bar`);
    }
    assert.ok(await sideways(p) <= 0, `no sideways scroll at ${SIZES[size].width}`);
    return seen;
  };

  await check('targets the owner\'s Complete · Archive, and Bring back on the page, the home and a topic, are 44px tall at 320, 375 and 390 and fit a laptop, light and dark, with no sideways scroll and no edge', async () => {
    await control({ method: 'light_outcome', outcome: 'tg-shed', title: 'Garden shed', topic: { id: 'tg-shed-plan', title: 'Shed plan' } });
    const each = async (name, url, wait, selectors, before = async () => {}) => {
      for (const size of ['phone320', 'phone375', 'phone', 'laptop']) for (const theme of ['light', 'dark']) {
        const p = await open(`targets-end-${name}-${size}-${theme}`, url, size, theme);
        await ready(p);
        await before(p);
        await until(() => shown(p, wait), `${wait} shows (${name}, ${size}, ${theme})`);
        await sized(p, selectors, size);
        await p.evaluate(`document.querySelector(${JSON.stringify(selectors[0])}).scrollIntoView({block:'center'})`);
        await shot(p, `targets-end-${name}-${size === 'phone' ? 'phone390' : size}-${theme}`);
        // Its errors are read while it is open: a topic page reports its messages read on opening (topic.read_through)
        // and reads its views again on that commit, and a release of one of those reads that the close cuts off is
        // refused by the closed session, the harness's own act, not the page's.
        assert.deepEqual(p.errors, [], `no page error (${name}, ${size}, ${theme})`);
        await p.close?.();
      }
    };
    await each('open', '/?workspace=tg-shed', '#target-panel .tg-end', ['[data-key="end:completed"]', '[data-key="end:archived"]']);
    assert.equal(await ended('tg-shed'), 'open', 'measuring sends nothing');
    await act('outcome.end_set', { state: 'archived' }, { workspace_id: 'tg-shed' });
    await each('page-archived', '/?workspace=tg-shed', '#outcome-standing [data-hold="bring-back"]', ['#outcome-standing [data-hold="bring-back"]']);
    await each('home-archived', '/', '.ended-outcomes summary', ['.ended-outcomes summary', '[data-key="bring-back:tg-shed"]'], p => openArchived(p, 'tg-shed'));
    await each('topic-archived', '/?topic=tg-shed-plan', '#outcome-kept [data-key="bring-back"]', ['#outcome-kept [data-key="bring-back"]']);
    await act('outcome.end_set', { state: 'completed' }, { workspace_id: 'tg-shed' });
    await each('page-completed', '/?workspace=tg-shed', '#outcome-standing [data-hold="bring-back"]', ['#outcome-standing [data-hold="bring-back"]']);
    await act('outcome.end_set', { state: 'open' }, { workspace_id: 'tg-shed' });
  });

  await check('targets the owner archives by touch and the outcome leaves the home live; Archived (1) opens to its row, and Bring back by keys returns it to its place with the keys on its row; on the page Return and Space archive, complete and bring back, the keys landing each time', async () => {
    await control({ method: 'light_outcome', outcome: 'tg-round', title: 'Round trip', topic: { id: 'tg-round-plan', title: 'Round plan' } });
    const home = await open('targets-end-home', '/');
    await ready(home);
    const before = await until(async () => { const ids = await homeIds(home); return ids.includes('tg-round') && ids; }, 'the outcome is on the home');
    const homeLoaded = await origin(home);
    const p = await open('targets-end-round', '/?workspace=tg-round', 'phone', 'light');
    await ready(p);
    const pageLoaded = await origin(p);
    await until(() => shown(p, '[data-key="end:archived"]'), 'the owner is offered Archive');
    const sent = p.calls?.length ?? 0;
    await front(p);
    await tapAt(p, '[data-key="end:archived"]');
    await until(async () => (await ended('tg-round')) === 'archived', 'one tap archives it, with no confirm step');
    await until(async () => /^Where it standsi?Archived · .*archived it ?Bring back/.test(await standing(p)), 'Where it stands says it is archived, with Bring back');
    await until(async () => (await focusedKey(p)) === 'bring-back', 'the keys move to Bring back');
    assert.equal(await shown(p, '#target-panel .tg-end'), false, 'Complete · Archive goes');
    assert.equal(await shown(p, '[data-key="say-reached"]'), false, '"Say it is reached" is not offered');
    if (p.calls) assert.equal(p.calls.slice(sent).filter(call => call.payload?.kind === 'outcome.end_set').length, 1, 'one tap sends once');
    await shot(p, 'targets-end-round-archived');

    // A second page, the home, sees it leave with no reload.
    await front(home);
    await until(async () => !(await homeIds(home)).includes('tg-round'), 'the home sees it leave, live');
    const count = await endedCount();
    await until(() => home.evaluate(`document.querySelector('.ended-outcomes summary')?.textContent`).then(text => text === `Archived (${count})`), `the Archived line says Archived (${count})`);
    const placed = await home.evaluate(`(()=>{const a=document.querySelector('.ended-outcomes'),r=a.nextElementSibling;return r?.classList.contains('reached-outcomes')&&!r.classList.contains('ended-outcomes')})()`);
    assert.equal(placed, true, 'directly above Reached (N)');
    await openArchived(home, 'tg-round', 'keys');
    const row = await home.evaluate(`(()=>{const r=document.querySelector('.ended-row[data-workspace-id="tg-round"]'),a=r.querySelector('a'),[name,when]=[a.querySelector('span'),a.querySelector('small')];
      return {name:name.textContent,when:when.textContent,below:when.getBoundingClientRect().top>=name.getBoundingClientRect().bottom-1,outside:!a.contains(r.querySelector('button'))}})()`);
    assert.equal(row.name, 'Round trip');
    assert.match(row.when, /^Archived [A-Z][a-z]{2} \d{1,2}$/, 'it says Archived and the date, with no dot');
    assert.ok(row.below, 'the date sits on its own line under the name');
    assert.ok(row.outside, 'Bring back sits outside the link');
    await shot(home, 'targets-end-home-archived');
    await keyOn(home, '.ended-row[data-workspace-id="tg-round"] a', 'Tab');
    await until(async () => (await focusedKey(home)) === 'bring-back:tg-round', 'Tab reaches Bring back');
    const ring = await home.evaluate(`(c=>c.outlineStyle!=='none'&&parseFloat(c.outlineWidth)>0)(getComputedStyle(document.activeElement))`);
    assert.equal(ring, true, 'its focus ring shows');
    await home.key('Enter');
    await until(async () => JSON.stringify(await homeIds(home)) === JSON.stringify(before), 'Return brings it back to its place in the list');
    await until(() => home.evaluate(`document.activeElement?.dataset?.workspaceId==='tg-round'&&document.activeElement.closest('#workspaces')!==null`), 'and the keys land on its row');
    assert.equal(await endedCount(), count - 1);
    assert.equal(await origin(home), homeLoaded, 'the home never reloaded');
    // The outcome page sees it come back with no reload.
    await front(p);
    await until(() => shown(p, '#target-panel .tg-end'), 'the page sees it come back, live');
    assert.equal(await origin(p), pageLoaded, 'the page never reloaded');

    // By keys on the page: Return archives, Return brings back to Archive; Space completes, Space brings back to Complete.
    await keyOn(p, '[data-key="end:archived"]', 'Enter');
    await until(async () => (await ended('tg-round')) === 'archived', 'Return archives it');
    await until(async () => (await focusedKey(p)) === 'bring-back', 'the keys move to Bring back');
    await front(home);
    await until(async () => !(await homeIds(home)).includes('tg-round'), 'the home sees it leave again');
    await front(p);
    await p.key('Enter');
    await until(async () => (await ended('tg-round')) === 'open', 'Return brings it back');
    await until(async () => (await focusedKey(p)) === 'end:archived', 'the keys go to Archive, which ended it');
    await front(home);
    await until(async () => (await homeIds(home)).includes('tg-round'), 'the home sees it come back');
    await front(p);
    await keyOn(p, '[data-key="end:completed"]', ' ');
    await until(async () => (await ended('tg-round')) === 'completed', 'Space completes it');
    await until(async () => /Done · completed .*completed it ?Bring back/.test(await standing(p)), 'Where it stands says Done · completed');
    await until(async () => (await focusedKey(p)) === 'bring-back', 'the keys move to Bring back');
    assert.equal((await checks('tg-round')).reached, null, 'completing records no Reached');
    await shot(p, 'targets-end-round-completed');
    await p.key(' ');
    await until(async () => (await ended('tg-round')) === 'open', 'Space brings it back');
    await until(async () => (await focusedKey(p)) === 'end:completed', 'the keys go to Complete, which ended it');
    await front(home);
    await until(async () => JSON.stringify(await homeIds(home)) === JSON.stringify(before), 'the home has it in its place again');
    assert.deepEqual([...p.errors, ...home.errors], []);
  });

  await check('targets someone on the team who does not own the outcome sees no Complete, Archive or Bring back, on its page or on the home', async () => {
    await control({ method: 'team_outcome', operation_id: 'targets-end-member', workspace_id: 'tg-member', title: 'Borrowed boat', team: [facts.agent], owner: facts.agent });
    const p = await open('targets-end-member', '/?workspace=tg-member');
    await ready(p);
    await until(async () => (await panel(p)).shown, 'the target panel shows');
    await until(() => p.evaluate(`document.getElementById('outcome-standing')?.textContent.length > 0`), 'Where it stands shows');
    assert.equal(await p.evaluate(`document.querySelectorAll('.tg-end, [data-key^="end:"], [data-hold="bring-back"]').length`), 0, 'no control while it is open');
    await act('outcome.end_set', { state: 'archived' }, { workspace_id: 'tg-member', sender: facts.agent });
    await until(async () => /Archived · .*archived it/.test(await standing(p)), 'the page sees its owner archive it, live');
    assert.equal(await p.evaluate(`document.querySelectorAll('.tg-end, [data-key^="end:"], [data-hold="bring-back"]').length`), 0, 'and offers nobody but its owner Bring back');
    const home = await open('targets-end-member-home', '/');
    await ready(home);
    await openArchived(home, 'tg-member');
    assert.equal(await home.evaluate(`document.querySelectorAll('.ended-row[data-workspace-id="tg-member"] button').length`), 0, 'its row has no Bring back');
    await shot(home, 'targets-end-member-home');
    await act('outcome.end_set', { state: 'open' }, { workspace_id: 'tg-member', sender: facts.agent });
    await front(home);
    await until(async () => !(await shown(home, '.ended-row[data-workspace-id="tg-member"]')), 'its owner brings it back, and the open line drops its row, live');
    assert.deepEqual([...p.errors, ...home.errors], []);
  });

  await check('targets a message into an archived outcome is refused in Core\'s words with its writing kept for review; the topic says it is kept to read, and after Bring back by keys a message sends', async () => {
    // An outcome of its own, lit here, so the case runs alone as well as after the others.
    await control({ method: 'light_outcome', outcome: 'tg-door', title: 'Door frame', topic: { id: 'tg-door-plan', title: 'Door plan' } });
    await act('outcome.end_set', { state: 'archived' }, { workspace_id: 'tg-door' });
    const p = await open('targets-end-topic', '/?topic=tg-door-plan', 'phone', 'dark');
    await ready(p);
    const line = await until(() => p.evaluate(`(h=>h&&!h.hidden&&h.getClientRects().length?h.textContent:null)(document.getElementById('outcome-kept'))`), 'the line shows in the header');
    assert.equal(line, 'This outcome is archived; its topics are kept to read Bring back');
    const messages = async () => JSON.stringify((await view('topic_messages', { topic_id: 'tg-door-plan', direction: 'before', limit: 30 })).items);
    const write = async words => {
      await p.evaluate(`document.getElementById('inline-writing-body').scrollIntoView({block:'center'})`);
      await p.point('#inline-writing-body');
      await p.send('Input.insertText', { text: words });
      await p.evaluate(`document.getElementById('inline-send').scrollIntoView({block:'center'})`);
      await p.point('#inline-send');
    };
    const words = 'Measured the shed door twice.';
    await write(words);
    // The send is refused whole: nothing lands, and the reply's line says it did not send, with the writing kept.
    await until(() => shown(p, '#inline-pending button'), 'the reply\'s line offers its review');
    assert.ok(!(await messages()).includes(words), 'nothing was sent');
    await p.point('#inline-pending button');
    const card = await until(() => p.evaluate(`(()=>{const c=[...document.querySelectorAll('#review-content .pending-card')].find(c=>c.querySelector('pre')?.textContent===${JSON.stringify(words)});
      const why=c?.querySelector('[data-refusal]');return c&&why&&!why.hidden?{head:c.querySelector('h3').textContent,why:why.textContent}:null})()`), 'the review shows the writing and why');
    assert.deepEqual(card, { head: 'Not sent — writing kept', why: 'Door frame is archived; bring it back to change anything in it.' }, 'in Core\'s words, which say who brings it back');
    assert.ok(await sideways(p) <= 0, 'no sideways scroll at 390');
    await shot(p, 'targets-end-topic-refused');
    await p.key('Escape');
    await until(async () => !(await p.evaluate(`document.getElementById('version-review').open`)), 'the review closes');
    await keyOn(p, '#outcome-kept [data-key="bring-back"]', 'Enter');
    await until(async () => (await ended('tg-door')) === 'open', 'Return on Bring back brings it back');
    await until(async () => !(await shown(p, '#outcome-kept')), 'the line goes');
    await until(() => p.evaluate(`document.activeElement?.id==='inline-writing-body'`), 'the keys go to the writing');
    await write('The door is 81 cm.');
    await until(async () => (await messages()).includes('The door is 81 cm.'), 'a message sends now');
    assert.deepEqual(p.errors, []);
  });

  await check('targets a person\'s own message offers Edit in its ⋯ while its outcome is open, and no Edit once the outcome is archived or completed', async () => {
    await control({ method: 'light_outcome', outcome: 'tg-quill', title: 'Quill pens', topic: { id: 'tg-quill-notes', title: 'Quill notes' } });
    const mine = (await control({ method: 'agent_message', operation_id: `targets-quill-${++serial}`, topic_id: 'tg-quill-notes', source: 'topic',
      sender: 'person', body: 'Trimmed the goose feathers.' })).result.message_id;
    const words = `#messages .message-card[data-id="${mine}"] > .message-preview`;
    // The ⋯ of the person's own message, from the bar its words light under the pointer: its items' words.
    const menu = async p => {
      await p.evaluate(`document.querySelector(${JSON.stringify(words)}).scrollIntoView({block:'center'})`);
      await p.point(words, 'move');
      await until(() => p.evaluate(`[...document.querySelectorAll('#messages .lit[data-id]')].some(e=>e.dataset.id===${JSON.stringify(mine)})
        && Boolean(document.querySelector('.message-bar:not([hidden]) [data-act=more]')?.getClientRects().length)`), 'the message lights with its bar');
      await p.point('.message-bar [data-act=more]');
      await until(() => p.evaluate(`Boolean(document.querySelector('.message-menu-list'))`), 'its ⋯ opens');
      const items = await p.evaluate(`[...document.querySelectorAll('.message-menu-list button')].map(b=>b.firstChild.textContent)`);
      await p.key('Escape');
      await until(() => p.evaluate(`!document.querySelector('.message-menu-list')`), 'Escape closes it');
      return items;
    };
    const kept = p => until(() => p.evaluate(`(h=>h&&!h.hidden&&h.getClientRects().length?h.textContent:null)(document.getElementById('outcome-kept'))`), 'the topic says it is kept to read');
    const first = await open('targets-edit-open', '/?topic=tg-quill-notes');
    await ready(first);
    assert.ok((await menu(first)).includes('Edit'), 'open, the person\'s own message offers Edit');
    for (const [state, theme] of [['archived', 'light'], ['completed', 'dark']]) {
      await act('outcome.end_set', { state }, { workspace_id: 'tg-quill' });
      const p = await open(`targets-edit-${state}`, '/?topic=tg-quill-notes', 'laptop', theme);
      await ready(p);
      // The line shows once the page has read the outcome's light, which is also what tells the page it is kept to read.
      assert.match(await kept(p), state === 'archived' ? /^This outcome is archived; its topics are kept to read/ : /^This outcome was completed/);
      const items = await menu(p);
      assert.ok(items.includes('Copy Link'), `${state}: the ⋯ opens with its other items: ${items.join(', ')}`);
      assert.equal(items.includes('Edit'), false, `${state}: the person\'s own message offers no Edit: ${items.join(', ')}`);
      await shot(p, `targets-edit-${state}-laptop-${theme}`);
      assert.deepEqual(p.errors, []);
      await act('outcome.end_set', { state: 'open' }, { workspace_id: 'tg-quill' });
    }
    assert.deepEqual(first.errors, []);
  });
}

