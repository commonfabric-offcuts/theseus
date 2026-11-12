import assert from 'node:assert/strict';

// The pipeline (item 84; docs/pipeline.md) in the real browser against the
// real server. The outcome page offers Turn on while it is off, and turning it
// on is one tap; an item is added by one line and Return, its words and size
// set in place; the ⋯ menu steers by pointer and keyboard, ⌘↑ moves a focused
// row and Undo puts it back; an item being built has its own ⋯, and its Drop…
// asks first, where Keep it changes nothing; Set aside to Later… asks why in one
// line, keeps its words through a live change, and moves its whole piece to Later; a stage entered elsewhere shows
// with no reload and leaves what is being typed alone; the owner's word moves
// a gated stage on; a message in the Reader becomes a Candidate in one line,
// and a whisper is never offered as one;
// a busy Theseus while stages are changed is said in plain words with Try again,
// the stage name being typed keeps its words, and the page never prints null;
// a title kept under its line gives focus back to itself or its line after Try
// again, Return or Escape; an item whose answer is lost is said as not known to be
// saved, and Return on it sends the same change, so Core has it once;
// the rail's Pipeline row and the outcome page's line link the page; and the
// page and an item's record fit 1280 and 390, light and dark, with no People
// heading. Run by reader_persistence_native.mjs with --pipeline; screenshots
// are kept as pipeline-*.png for review.
const SIZES = { laptop: { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, phone: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } };
const COMBOS = [['laptop', 'light'], ['laptop', 'dark'], ['phone', 'light'], ['phone', 'dark']];

export async function pipelineChecks({ check, page, until, control, view, facts, shot }) {
  const open = (name, url, size = 'laptop', theme = 'light') => page(name, null, true, { url: facts.origin + url, beforeNavigate: async q => {
    await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await q.send('Emulation.setDeviceMetricsOverride', SIZES[size]);
    if (SIZES[size].mobile) await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  } });
  const ready = p => until(() => p.evaluate('document.body?.dataset.ready==="true"').catch(() => false), 'the page is ready');
  const loaded = p => p.evaluate('performance.timeOrigin');
  // A pointer press on a control that may be below the fold: brought into view first, as a person scrolls to it.
  const tap = async (p, selector) => {
    assert.ok(await p.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e?.scrollIntoView({block:'center'});return Boolean(e)})()`), `${selector} is on the page`);
    await p.point(selector);
  };
  const type = async (p, selector, text) => { await tap(p, selector); await p.send('Input.insertText', { text }); };
  const focused = p => p.evaluate(`(()=>{const a=document.activeElement;return {role:a?.dataset?.role??null,key:a?.closest?.('[data-key]')?.dataset.key??null,
    label:a?.getAttribute?.('aria-label')??null,text:a?.textContent??'',value:a?.value??null,id:a?.id||null}})()`);
  // The rows of a section as drawn, by number, and as Core keeps them.
  const drawn = (p, section) => p.evaluate(`[...document.querySelectorAll('section[aria-label=${JSON.stringify(section)}] .pl-row')].map(r=>Number(r.dataset.number))`);
  const kept = async section => (await view('pipeline', { workspace_id: 'w1', section, limit: 100 })).items.map(item => item.number);
  const record = async number => (await view('pipeline_item', { workspace_id: 'w1', number })).item;
  // A menu item by its words, pressed with the pointer.
  const pick = async (p, number, label) => {
    await until(() => p.evaluate(`document.querySelectorAll('[data-key="item:${number}"] .pl-menu button').length > 0`), `the menu of ${number} is open`);
    const index = await p.evaluate(`[...document.querySelectorAll('[data-key="item:${number}"] .pl-menu button')].findIndex(b=>b.firstChild.textContent===${JSON.stringify(label)})`);
    assert.ok(index >= 0, `${label} is in the menu of ${number}`);
    await tap(p, `[data-key="item:${number}"] .pl-menu button:nth-of-type(${index + 1})`);
  };
  const menu = (p, number) => p.evaluate(`[...document.querySelectorAll('[data-key="item:${number}"] .pl-menu button')].map(b=>b.firstChild.textContent)`);
  let serial = 0;
  const pipeline = (kind, target, args, more = {}) => control({ method: 'pipeline', operation_id: `pipeline-native-${++serial}`, kind, target, args, ...more });

  await check('pipeline turning it on is one tap from the outcome page, and one line and Return adds an item whose words and size are set in place', async () => {
    const o = await open('pipeline-outcome-off', '/?workspace=w1');
    const line = await until(() => o.evaluate(`(()=>{const l=document.getElementById('pipeline-line');return l&&!l.hidden&&l.getClientRects().length>0&&l.textContent})()`), 'the outcome page offers Turn on');
    assert.equal(line, 'Pipeline: off · Turn on', 'its owner is offered Turn on while it is off');
    await o.point('#pipeline-line a');
    await until(() => o.evaluate('document.body?.dataset.ready==="true" && location.search==="?pipeline=w1"').catch(() => false), 'Turn on opens the pipeline page');
    const off = await o.evaluate(`(()=>{const shown=e=>Boolean(e)&&e.getClientRects().length>0;return {button:shown(document.querySelector('[data-role=turn-on]')),
      people:shown(document.getElementById('topic-people')),rail:shown(document.getElementById('pipeline-navigation')),
      named:[...document.querySelectorAll('main h2, main h3')].filter(shown).some(h=>/people/i.test(h.textContent))}})()`);
    assert.deepEqual(off, { button: true, people: false, rail: false, named: false }, 'one Turn on, no People heading, and no Pipeline row in the rail while it is off');
    const before = await loaded(o);
    await o.point('[data-role=turn-on]');
    await until(async () => (await focused(o)).label === 'Pipeline title', 'on, focus goes to its title, which changes in place');
    assert.equal((await view('pipeline', { workspace_id: 'w1', limit: 1 })).pipeline.enabled, true);
    await until(() => o.evaluate(`document.querySelector('#pipeline-links a')?.textContent==='Pipeline'`), 'the rail shows its Pipeline row, live');
    assert.equal(await o.evaluate(`document.querySelector('#pipeline-links a').getAttribute('aria-current')`), 'page');
    // One line at the top of each section, every one shown while empty, about a sentence wide.
    const lines = await o.evaluate(`[...document.querySelectorAll('.pl-line-input')].map(i=>[i.closest('section').getAttribute('aria-label'),i.placeholder,i.getBoundingClientRect().width])`);
    assert.deepEqual(lines.map(([section, placeholder]) => [section, placeholder]), [['Now', 'Add an item…'], ['Next', 'Add an item…'], ['Later', 'Add an item…'], ['Candidates', 'Add an item…']]);
    for (const [section, , width] of lines) assert.ok(width <= 36 * 16, `${section}'s line is a sentence wide, not the page's (${width}px)`);
    await type(o, '[data-key="add:next"] input', 'Say which release is live');
    await o.key('Enter');
    await until(async () => (await drawn(o, 'Next')).join() === '1', 'Return adds it, last in Next');
    const added = await o.evaluate(`(()=>{const n=document.querySelector('[data-key="add:next"] .pl-line-note');return {note:n?.textContent,
      line:document.querySelector('[data-key="add:next"] input').value,words:Boolean(document.querySelector('[data-key="item:1"] [data-role=words]')),
      sizes:[...document.querySelectorAll('[data-key="item:1"] .pl-size')].map(b=>[b.textContent,b.getAttribute('aria-pressed')])}})()`);
    assert.deepEqual(added, { note: 'Added 1, last in Next. Words and a size are optional; set them on it below.', line: '', words: true,
      sizes: [['S', 'false'], ['M', 'false'], ['L', 'false']] }, 'the line clears, says what it did, and opens the item’s words and size in place');
    const line1 = await focused(o);
    assert.deepEqual([line1.role, line1.key], ['add-title', 'add:next'], 'focus stays on the line, for the next title');
    assert.deepEqual([(await record(1)).title, (await record(1)).raised_by], ['Say which release is live', facts.actor]);
    // Size is a chip, saved on its tap; words save on ⌘Return or when the reader clicks away.
    await tap(o, '[data-key="item:1"] [data-role=size-small]');
    await until(() => o.evaluate(`document.querySelector('[data-key="item:1"] [data-role=size-small]')?.getAttribute('aria-pressed')==='true'`), 'the S chip is pressed');
    assert.equal((await record(1)).size, 'small');
    await type(o, '[data-key="item:1"] [data-role=words]', 'The page says which release is live.');
    await o.key('Enter', 4);
    await until(async () => (await record(1)).description === 'The page says which release is live.', 'its words saved on ⌘Return');
    await until(() => o.evaluate(`document.querySelector('[data-key="item:1"] .pl-details-note')?.textContent==='Saved.'`), 'and it says so');
    assert.equal(await o.evaluate(`[...document.querySelectorAll('button')].filter(b=>/^\\s*save\\s*$/i.test(b.textContent)).length`), 0, 'no Save button anywhere');
    // The owner's title, in place: Return saves it.
    await tap(o, '.pl-title-input'); await o.key('a', 4); await o.send('Input.insertText', { text: 'Release pipeline' }); await o.key('Enter');
    await until(async () => (await view('pipeline', { workspace_id: 'w1', limit: 1 })).pipeline.title === 'Release pipeline', 'the title saved on Return');
    await until(() => o.evaluate(`document.querySelector('#pipeline-links a')?.textContent==='Release pipeline'`), 'the rail row says it, live');
    assert.equal(await loaded(o), before, 'all with no reload');
    await shot(o, 'pipeline-turned-on');
    assert.deepEqual(o.errors, []); await o.close();
  });

  await check('pipeline a busy Theseus while stages are changed says so in plain words with Try again, keeps the stage name being typed, and the page never prints null', async () => {
    // Item 192. Theseus answers every pipeline read of the page with its own busy refusal (503 SERVER_BUSY, its own
    // words), as its full read lane does, until the check withdraws it; changes still go through. The check reads
    // Core in the background lane, which the refusal leaves alone.
    const BUSY = { method: 'read_fault', name: 'pipeline', read_class: 'foreground', status: 503,
      body: { error: { code: 'SERVER_BUSY', message: 'This read could not enter its bounded lane.', retryable: true } }, count: 10000 };
    const stages = async () => (await (await fetch(facts.origin + '/api/view', { method: 'POST', headers: { Authorization: `Bearer ${facts.token}`, Origin: facts.origin,
      'Content-Type': 'application/json', 'X-AIM-Read-Class': 'background' }, body: JSON.stringify({ name: 'pipeline', args: { workspace_id: 'w1', limit: 1 } }) })).json()).pipeline?.stages.map(stage => stage.name) ?? [];
    const refused = async () => (await control({ method: 'admission_events' })).events.filter(event => event.event === 'fault-applied' && event.name === 'pipeline').length;
    // What the page shows, whole: the words a person reads on it and in the page's status line.
    const shown = p => p.evaluate(`(()=>({page:document.getElementById('pipeline-page').innerText,status:document.getElementById('app-status').hidden?'':document.getElementById('app-status').textContent}))()`);
    // Every null, undefined or server word for being busy the page shows, each as found.
    const unplain = text => [...text.matchAll(/null|undefined|bounded lane|request lane|retain its operation/g)].map(found => found[0]);
    const said = (p, key) => p.evaluate(`[...document.querySelectorAll('[data-key="${key}"] [role=status]')].map(e=>e.textContent)`);
    const addStage = async (p, name) => { await type(p, '[data-key="add-stage"] input', name); await p.key('Enter'); };
    const busyStages = async () => {
      const p = await open('pipeline-busy', '/?pipeline=w1');
      await ready(p);
      await tap(p, '[data-role=edit-stages]');
      await until(() => p.evaluate(`Boolean(document.querySelector('[data-key="add-stage"] input'))`), 'Change stages opens its lines');
      await addStage(p, 'Build');
      await until(() => p.evaluate(`[...document.querySelectorAll('[data-role=stage-name]')].map(i=>i.value).join()==='Build'`), 'a stage added while Theseus answers shows');
      // Tony's moment: a stage added while every read of the page is refused as busy.
      await control(BUSY);
      await addStage(p, 'Review');
      await until(async () => (await stages()).join() === 'Build,Review', 'Review is saved');
      await until(async () => (await said(p, 'add-stage')).length > 0, 'the page says what happened under the line');
      const busy = await shown(p);
      assert.deepEqual({ said: await said(p, 'add-stage'), unplain: unplain(busy.page), status: busy.status },
        { said: ['Saved. Theseus was busy, so this page does not show it yet. Try again'], unplain: [], status: '' },
        'a busy Theseus said in plain words, with Try again, under the line it was added on; no null, and none of the server’s own words');
      assert.equal(await p.evaluate(`document.querySelector('[data-key="add-stage"] input').value`), '', 'the line is clear: Review is saved');
      // The stage name being typed, while live changes are read and refused as busy, keeps its words, focus and caret.
      await tap(p, '[data-role=stage-name]');
      await p.key('a', 4); await p.send('Input.insertText', { text: 'Build it' });
      for (const sized of [false, true]) {
        const before = await refused();
        await pipeline('pipeline.configure', { workspace_id: 'w1' }, { enabled: true, sized });
        await until(async () => (await refused()) > before, 'the page reads the live change and Theseus refuses it as busy');
      }
      const typing = await focused(p);
      assert.deepEqual([typing.role, typing.value, await p.evaluate('document.activeElement.selectionStart')], ['stage-name', 'Build it', 'Build it'.length],
        'the name being typed keeps its words, its focus and its caret');
      const still = await shown(p);
      assert.deepEqual({ said: await said(p, 'add-stage'), unplain: unplain(still.page), status: still.status },
        { said: ['Saved. Theseus was busy, so this page does not show it yet. Try again'], unplain: [], status: '' }, 'the busy line stays where it was said');
      await p.evaluate(`document.querySelector('[data-key="add-stage"]').scrollIntoView({block:'center'})`);
      await shot(p, 'pipeline-busy-laptop-light');
      // Return on the name, still busy: the page does not show Review yet, so it reads before it sends the name on
      // a revision Theseus has moved past; that read is refused, so nothing is sent and the stage says so, keeping the name.
      const build = await p.evaluate(`document.querySelector('[data-role=stage-name]').closest('[data-key]').dataset.key`);
      assert.deepEqual(await said(p, build), [], 'nothing is said on the stage before Return');
      const asked = await refused();
      await p.key('Enter');
      await until(async () => (await said(p, build)).join() === 'Not saved: Theseus was busy. Try again', 'the stage says it is not saved');
      assert.ok(await refused() > asked, 'the page read before sending, and Theseus refused the read');
      assert.deepEqual({ stage: await said(p, build), added: await said(p, 'add-stage'), name: await p.evaluate(`document.querySelector('[data-key="${build}"] [data-role=stage-name]').value`),
        core: await stages(), unplain: unplain((await shown(p)).page) },
      { stage: ['Not saved: Theseus was busy. Try again'], added: ['Saved. Theseus was busy, so this page does not show it yet. Try again'], name: 'Build it',
        core: ['Build', 'Review'], unplain: [] }, 'the name not saved and kept, Review saved: each said where it was made');
      // A new stage typed on its line, still busy: the same read first is refused, so it is not sent. Its title is
      // kept on a line of its own under the add line, said as not saved beside it, and Review stays said as saved
      // under the add line, with one Try again between them. The title is corrected where it stands, and the next
      // one typed on the add line meanwhile stays there.
      const held = '[data-key^="held:add-stage:"]';
      const asked2 = await refused();
      await addStage(p, 'Shp');
      await until(async () => (await said(p, 'add-stage')).length === 1 && (await p.evaluate(`document.querySelectorAll('${held}').length`)) === 1, 'the title not saved is kept under the line');
      assert.ok(await refused() > asked2, 'the page read before sending, and Theseus refused the read');
      const lines = () => p.evaluate(`({line:document.querySelector('[data-key="add-stage"] input').value,held:[...document.querySelectorAll('${held} input')].map(i=>i.value),
        heldSaid:[...document.querySelectorAll('${held} [role=status]')].map(e=>e.textContent),
        tries:document.querySelectorAll('[data-key="add-stage"] [data-role=try-again], ${held} [data-role=try-again]').length})`);
      assert.deepEqual({ added: await said(p, 'add-stage'), ...await lines(), core: await stages() },
        { added: ['Saved. Theseus was busy, so this page does not show it yet.'], line: '', held: ['Shp'], heldSaid: ['Not saved: Theseus was busy. Try again'], tries: 1, core: ['Build', 'Review'] },
        'Shp is kept and not saved, beside its own words; Review is said to be saved; the line is clear');
      // Escape on a title kept lets it go, sends nothing, and focus goes to the line it was typed on, for the next title.
      await addStage(p, 'Gone');
      await until(() => p.evaluate(`document.querySelectorAll('${held}').length===2`), 'Gone is kept too');
      const gone = await p.evaluate(`[...document.querySelectorAll('${held}')].find(f=>f.querySelector('input').value==='Gone').dataset.key`);
      await tap(p, `[data-key="${gone}"] input`); await p.key('Escape');
      await until(() => p.evaluate(`document.querySelectorAll('${held}').length===1`), 'Escape lets Gone go');
      const left = await focused(p);
      assert.deepEqual([left.key, left.role, left.value, (await lines()).held, await stages()], ['add-stage', 'add-title', '', ['Shp'], ['Build', 'Review']],
        'focus is on the Add a stage line; Shp stays; nothing was sent');
      await tap(p, `${held} input`); await p.key('a', 4); await p.send('Input.insertText', { text: 'Ship' });
      await type(p, '[data-key="add-stage"] input', 'Rev');
      assert.deepEqual(await lines(), { line: 'Rev', held: ['Ship'], heldSaid: ['Not saved: Theseus was busy. Try again'], tries: 1 }, 'each kept where it was typed');
      await p.evaluate(`document.querySelector('[data-key="add-stage"]').scrollIntoView({block:'center'})`);
      await shot(p, 'pipeline-busy-held');
      // Try again while Theseus is still busy reads again, is refused, and says the same.
      const before = await refused();
      await tap(p, `[data-key="${build}"] [data-role=try-again]`);
      await until(async () => (await refused()) > before, 'Try again reads the page again');
      await until(async () => (await said(p, build)).join() === 'Not saved: Theseus was busy. Try again', 'still busy, it says so again');
      assert.equal(await p.evaluate(`document.querySelector('[data-key="${build}"] [data-role=stage-name]').value`), 'Build it');
      // The kept title's Try again, then Return on it, while Theseus is still busy: each reads again and is refused,
      // the title stays as corrected, and focus, on what the send took away, goes back onto the title.
      for (const how of ['Try again', 'Return']) {
        await tap(p, `${held} input`);
        const asked3 = await refused();
        if (how === 'Try again') await tap(p, `${held} [data-role=try-again]`); else await p.key('Enter');
        await until(async () => (await refused()) > asked3 && (await lines()).heldSaid.length === 1, `${how}: the page reads again and Ship is said again`);
        const back = await focused(p);
        assert.deepEqual([back.role, back.value, (await lines()).held, (await lines()).heldSaid], ['held-title', 'Ship', ['Ship'], ['Not saved: Theseus was busy. Try again']],
          `${how}: focus is back on Ship, still kept`);
      }
      // Theseus answers again: Try again reads the page, then saves the name.
      await control({ method: 'read_fault_clear' });
      await tap(p, `[data-key="${build}"] [data-role=try-again]`);
      await until(async () => (await stages()).join() === 'Build it,Review', 'Try again saves the name typed');
      await until(() => p.evaluate(`[...document.querySelectorAll('[data-role=stage-name]')].map(i=>i.value).join()==='Build it,Review'`), 'the page shows both stages');
      // The kept title's Try again adds the words it shows, once; the line keeps what was typed on it.
      assert.deepEqual((await lines()).held, ['Ship'], 'a repaint keeps the title as corrected');
      await tap(p, `${held} input`);
      await tap(p, `${held} [data-role=try-again]`);
      await until(async () => (await stages()).join() === 'Build it,Review,Ship', 'Try again adds Ship');
      await until(() => p.evaluate(`[...document.querySelectorAll('[data-role=stage-name]')].map(i=>i.value).join()==='Build it,Review,Ship'`), 'the page shows Ship');
      assert.deepEqual(await lines(), { line: 'Rev', held: [], heldSaid: [], tries: 0 }, 'Ship is added, and Rev stays on the line');
      const added = await focused(p);
      assert.deepEqual([added.key, added.role, added.value], ['add-stage', 'add-title', 'Rev'], 'Ship added, focus goes to the Add a stage line, where Rev is');
      await until(() => p.evaluate(`!document.querySelector('#pipeline-page [data-role=try-again]')`), 'nothing busy is left to try again');
      assert.deepEqual(unplain((await shown(p)).page), []);
      assert.doesNotMatch((await shown(p)).page, /busy/);
      assert.deepEqual(p.errors, []); await p.close();
      // How a busy moment looks, light and dark, on a laptop and a phone.
      for (const [size, theme] of COMBOS.slice(1)) {
        const q = await open(`pipeline-busy-${size}-${theme}`, '/?pipeline=w1', size, theme);
        await ready(q);
        await tap(q, '[data-role=edit-stages]');
        await until(() => q.evaluate(`Boolean(document.querySelector('[data-key="add-stage"] input'))`), `${size} ${theme}: Change stages opens its lines`);
        await control(BUSY);
        await addStage(q, `Seen ${size} ${theme}`);
        await until(async () => (await said(q, 'add-stage')).join() === 'Saved. Theseus was busy, so this page does not show it yet. Try again', `${size} ${theme}: the busy line shows`);
        const seen = await q.evaluate(`(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,text:document.getElementById('pipeline-page').innerText}))()`);
        assert.ok(seen.scroll <= seen.width, `${size} ${theme}: no sideways scroll (${seen.scroll} of ${seen.width})`);
        assert.deepEqual(unplain(seen.text), []);
        await q.evaluate(`document.querySelector('[data-key="add-stage"]').scrollIntoView({block:'center'})`);
        await shot(q, `pipeline-busy-${size}-${theme}`);
        await control({ method: 'read_fault_clear' });
        assert.deepEqual(q.errors, []); await q.close();
      }
    };
    // However this check ends, the server answers as itself again for the checks after it.
    try { await busyStages(); } finally { await control({ method: 'read_fault_clear' }); }
  });

  await check('pipeline the ⋯ menu steers by pointer and keyboard, ⌘↑ moves a focused row, and Undo and Restore put it back', async () => {
    for (const title of ['Fold the shipped list', 'Make the rail shorter']) await pipeline('pipeline.item_add', { workspace_id: 'w1' }, { title, section: 'next', sources: [{ note: 'the check' }] });
    assert.deepEqual(await kept('next'), [1, 2, 3]);
    const p = await open('pipeline-steer', '/?pipeline=w1');
    await ready(p);
    await until(async () => (await drawn(p, 'Next')).join() === '1,2,3', 'the rows are drawn in order');
    // The keyboard: ⋯ opens the menu with focus in it, the arrows move through it, Escape closes it back onto ⋯.
    await tap(p, '[data-key="item:3"] [data-role=steer]');
    await until(async () => (await focused(p)).text === 'Move up⌘↑', 'the menu opens with its first item focused');
    assert.deepEqual(await menu(p, 3), ['Move up', 'Move to Now', 'Move to Later', 'Move to Candidates', 'Open its record', 'Drop…'],
      'the last row moves up but not down, and its own section is left out');
    assert.equal(await p.evaluate(`document.querySelector('[data-key="item:3"] [data-role=steer]').getAttribute('aria-expanded')`), 'true');
    await p.key('ArrowDown');
    assert.equal((await focused(p)).text, 'Move to Now');
    await p.key('Escape');
    await until(async () => (await focused(p)).label === 'Steer 3', 'Escape closes it and gives focus back to ⋯');
    assert.equal(await p.evaluate(`document.querySelectorAll('.pl-menu').length`), 0);
    // ⌘↑ on the focused row moves it up one; the row says so, with Undo.
    await p.key('ArrowUp', 4);
    await until(async () => (await kept('next')).join() === '1,3,2', '⌘↑ moves 3 above 2');
    await until(async () => (await drawn(p, 'Next')).join() === '1,3,2', 'and the page shows it');
    assert.equal((await focused(p)).key, 'item:3', 'focus stays on the row that moved');
    const moved = await p.evaluate(`document.querySelector('[data-key="item:3"] .pl-note')?.textContent`);
    assert.match(moved, /^Moved above 2 by you, .+\.Undo$/);
    await tap(p, '[data-key="item:3"] [data-role=undo]');
    await until(async () => (await kept('next')).join() === '1,2,3', 'Undo puts it back');
    await until(async () => (await drawn(p, 'Next')).join() === '1,2,3', 'and the page shows it');
    // The pointer: Move to Later, then Drop… on a row not being built drops it at once, and Restore brings it back.
    await tap(p, '[data-key="item:2"] [data-role=steer]');
    await pick(p, 2, 'Move to Later');
    await until(async () => (await kept('later')).join() === '2', 'Move to Later moves it');
    await until(async () => (await drawn(p, 'Later')).join() === '2', 'and the page shows it');
    await tap(p, '[data-key="item:2"] [data-role=steer]');
    await pick(p, 2, 'Drop…');
    await until(async () => (await kept('dropped')).join() === '2', 'Drop… on an item not being built drops it');
    await until(() => p.evaluate(`Boolean(document.querySelector('section[aria-label=Dropped] [data-key="item:2"] [data-role=undo]'))`), 'it shows under Dropped, with Restore');
    await tap(p, 'section[aria-label=Dropped] [data-key="item:2"] [data-role=undo]');
    await until(async () => (await kept('later')).join() === '2', 'Restore puts it back in Later');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('pipeline an item being built has its own ⋯ and Drop… asks first, Keep it changes nothing; a stage entered elsewhere shows live, leaving the line being typed alone; the owner’s word moves it on', async () => {
    await pipeline('pipeline.stages_set', { workspace_id: 'w1' }, { stages: [{ stage_id: 'build', name: 'Build' },
      { stage_id: 'review', name: 'Review', gate: { owner: true, words: 'say when the review reads well.' } }] });
    const { result: { number } } = await pipeline('pipeline.item_add', { workspace_id: 'w1' }, { title: 'Build me', section: 'now', size: 'medium', sources: [{ note: 'the check' }] });
    const { result: { piece_id: piece } } = await pipeline('pipeline.piece_start', { workspace_id: 'w1' }, { numbers: [number], topic_id: 't1', stage_id: 'build' });
    const p = await open('pipeline-underway', '/?pipeline=w1');
    await ready(p);
    const card = `[data-key="piece:${piece}"]`, item = `${card} [data-key="item:${number}"]`;
    await until(() => p.evaluate(`document.querySelector('${card} .pl-chip[aria-current=step]')?.textContent==='Build'`), 'the piece card shows it in Build');
    await tap(p, `${item} [data-role=steer]`);
    await until(async () => (await focused(p)).text === 'Open its record', 'its ⋯ opens with focus in the menu');
    assert.deepEqual(await menu(p, number), ['Open its record', 'Set aside to Later…', 'Drop…'], 'an item being built is not ordered or moved from its card');
    await pick(p, number, 'Drop…');
    const asked = await until(() => p.evaluate(`document.querySelector('${item} .pl-confirm')?.textContent`), 'Drop… asks first');
    assert.equal(asked, `Drop ${number}? It is being built now, so this stops work under way. Drop itKeep it`);
    assert.equal((await focused(p)).role, 'drop-keep', 'focus goes to Keep it');
    await p.point(`${item} [data-role=drop-keep]`);
    await until(() => p.evaluate(`!document.querySelector('.pl-confirm')`), 'Keep it closes the question');
    assert.equal((await focused(p)).label, `Steer ${number}`, 'and gives focus back to ⋯');
    const still = await record(number);
    assert.deepEqual([still.section, still.pieces.length, still.pieces[0].stage?.stage_id], ['now', 1, 'build'], 'Keep it changes nothing');
    // Half a title typed in Next's line while an agent, elsewhere, moves the piece into Review.
    await type(p, '[data-key="add:next"] input', 'Half typed');
    const before = await loaded(p);
    const entered = await pipeline('pipeline.stage_enter', { piece_id: piece }, { stage_id: 'review', left_outcome: 'approved' }, { sender: 'agent', ask: 'Does the review read well?' });
    assert.equal(entered.status, 'committed');
    await until(() => p.evaluate(`document.querySelector('${card} .pl-chip[aria-current=step]')?.textContent==='Review'`), 'Review shows on the card, live');
    const gate = await p.evaluate(`(()=>({you:document.querySelector('${card} .pl-gate-you')?.textContent,done:document.querySelector('${card} [data-role=leave]')?.textContent,
      chips:[...document.querySelectorAll('${card} .pl-chip')].map(c=>c.className.replace('pl-chip ',''))}))()`);
    assert.deepEqual(gate, { you: 'Waiting on you: say when the review reads well.', done: 'Done with this stage', chips: ['done', 'now'] });
    assert.equal(await loaded(p), before, 'with no reload');
    const kept_ = await focused(p);
    assert.deepEqual([kept_.key, kept_.value], ['add:next', 'Half typed'], 'what was being typed keeps its focus and its words');
    assert.equal(await p.evaluate(`document.activeElement.selectionStart`), 'Half typed'.length, 'and its caret');
    await p.key('Escape');
    assert.deepEqual([(await focused(p)).key, (await focused(p)).value], ['add:next', ''], 'Escape clears the line and keeps focus on it');
    await shot(p, 'pipeline-underway');
    // The owner's word: Done with this stage finishes the piece.
    await tap(p, `${card} [data-role=leave]`);
    await until(async () => Boolean((await record(number)).shipped?.done_ms), 'Done with this stage finishes it');
    await until(() => p.evaluate(`[...document.querySelectorAll('section[aria-label=Done] .pl-shipped-title')].map(a=>a.textContent).includes('Build me')`), 'it shows under Done');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('pipeline an item being built is set aside to Later in one line: Escape keeps it, and Return with why closes its piece and moves every item of it, its stages kept; the why being typed keeps its words through a live change', async () => {
    const add = async title => (await pipeline('pipeline.item_add', { workspace_id: 'w1' }, { title, section: 'now', size: 'small', sources: [{ note: 'the check' }] })).result.number;
    const first = await add('Set me aside'), second = await add('And me');
    const { result: { piece_id: piece } } = await pipeline('pipeline.piece_start', { workspace_id: 'w1' }, { numbers: [first, second], topic_id: 't1', stage_id: 'build' });
    const later = [...await kept('later'), first, second].join();
    const p = await open('pipeline-aside', '/?pipeline=w1');
    await ready(p);
    const card = `[data-key="piece:${piece}"]`, item = `${card} [data-key="item:${first}"]`;
    await until(() => p.evaluate(`Boolean(document.querySelector('${item} [data-role=steer]'))`), 'the piece card is drawn');
    await tap(p, `${item} [data-role=steer]`);
    assert.deepEqual(await menu(p, first), ['Open its record', 'Set aside to Later…', 'Drop…']);
    await pick(p, first, 'Set aside to Later…');
    const asked = await until(async () => { const f = await focused(p); return f.role === 'aside-note' && f; }, 'one line asks why, focused');
    assert.equal(asked.label, `Why set ${first} and ${second} aside to Later`);
    await p.key('Escape');
    await until(async () => (await focused(p)).label === `Steer ${first}`, 'Escape closes the line and gives focus back to ⋯');
    assert.deepEqual([(await record(first)).section, await p.evaluate(`Boolean(document.querySelector('[data-role=aside-note]'))`)], ['now', false], 'Escape changes nothing');
    await tap(p, `${item} [data-role=steer]`);
    await pick(p, first, 'Set aside to Later…');
    await until(async () => (await focused(p)).role === 'aside-note', 'the line asks again');
    // Half a reason typed while an agent, elsewhere, adds an item to Next: the page shows it live and the reason keeps its words.
    await p.send('Input.insertText', { text: 'The tests miss' });
    const before = await loaded(p), next = (await drawn(p, 'Next')).length;
    await pipeline('pipeline.item_add', { workspace_id: 'w1' }, { title: 'Added elsewhere', section: 'next', sources: [{ note: 'the check' }] }, { sender: 'agent' });
    await until(async () => (await drawn(p, 'Next')).length === next + 1, 'the item added elsewhere shows in Next, live');
    assert.equal(await loaded(p), before, 'with no reload');
    const typing = await focused(p);
    assert.deepEqual([typing.role, typing.key, typing.value], ['aside-note', `aside:${first}`, 'The tests miss'], 'the reason being typed keeps its focus and its words');
    assert.equal(await p.evaluate(`document.activeElement.selectionStart`), 'The tests miss'.length, 'and its caret');
    await p.send('Input.insertText', { text: ' the real case' });
    await p.key('Enter');
    await until(async () => (await drawn(p, 'Later')).join() === later, 'every item of the piece moves last in Later, the one set aside first');
    assert.equal((await kept('later')).join(), later);
    assert.equal(await p.evaluate(`Boolean(document.querySelector('${card}'))`), false, 'its piece has left Now');
    const note = await p.evaluate(`document.querySelector('section[aria-label=Later] [data-key="item:${second}"] .pl-note')?.textContent`);
    assert.match(note, new RegExp(`^Set aside to Later with ${first} by you, .+, after Build: The tests miss the real case`));
    const last = (await record(second)).pieces[0].stages_so_far.at(-1);
    assert.deepEqual([last.left_outcome, last.left_note], ['set aside', 'Set aside: The tests miss the real case']);
    await shot(p, 'pipeline-aside');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('pipeline a message in the Reader becomes a Candidate in one line, and the outcome page links the pipeline', async () => {
    const body = 'Could the page say which release is live? It would save a question each morning.';
    const message = (await control({ method: 'agent_message', operation_id: 'pipeline-native-message', body })).result.message_id;
    const r = await open('pipeline-reader', '/?topic=t1');
    const card = `#messages [data-id="${message}"]`;
    await until(() => r.evaluate(`Boolean(document.querySelector('${card}'))`).catch(() => false), 'the message is drawn');
    await tap(r, card);
    await until(() => r.evaluate(`document.querySelector('#reader').open && document.querySelector('#source-body').textContent.includes(${JSON.stringify(body)})`), 'the Reader shows it');
    await until(() => r.evaluate(`(()=>{const b=document.getElementById('add-to-pipeline');return Boolean(b)&&!b.hidden})()`), 'a message offers Add to pipeline while it is on');
    assert.equal(await r.evaluate(`document.querySelector('#pipeline-links a')?.textContent`), 'Release pipeline', 'the rail inside the outcome has its Pipeline row');
    await r.point('#add-to-pipeline');
    const first = await until(async () => { const f = await focused(r); return f.role === 'add-title' && f.value; }, 'one line opens under the message, focused');
    assert.equal(first, 'Could the page say which release is live?', 'its title is the message’s first sentence');
    await r.key('Escape');
    // Add to pipeline is in the Reader's ⋯ (docs/reader.md): Escape goes back there.
    await until(async () => (await focused(r)).id === 'reader-menu', 'Escape closes it, back onto the ⋯ that held Add to pipeline');
    assert.equal(await r.evaluate(`document.getElementById('pipeline-add').hidden`), true);
    const before = await kept('candidates');
    await r.point('#add-to-pipeline');
    await until(async () => (await focused(r)).role === 'add-title', 'it opens again');
    await r.key('Enter');
    const done = await until(() => r.evaluate(`document.querySelector('#pipeline-add [role=status]')?.textContent`), 'Return adds it');
    const number = Number(/^Added (\d+) to Candidates\./.exec(done)?.[1]);
    assert.equal(done, `Added ${number} to Candidates.Open it`);
    assert.equal((await focused(r)).text, 'Open it', 'focus goes to Open it');
    assert.deepEqual(await kept('candidates'), [...before, number]);
    const item = await record(number);
    const source = item.sources.shown[0];
    assert.deepEqual([item.title, item.section, item.raised_by, source.kind, source.message_id], [first, 'candidates', facts.agent, 'message', message],
      'it came from that message, raised by its author');
    assert.deepEqual(r.errors, []); await r.close();
    const o = await open('pipeline-outcome-on', '/?workspace=w1');
    const line = await until(() => o.evaluate(`(()=>{const l=document.getElementById('pipeline-line');return l&&!l.hidden&&l.textContent})()`), 'the outcome page has its pipeline line');
    assert.equal(line, 'Pipeline: Release pipeline ›');
    assert.equal(await o.evaluate(`document.querySelector('#pipeline-line a').getAttribute('href')`), '?pipeline=w1');
    assert.deepEqual(o.errors, []); await o.close();
  });

  await check('pipeline a person\'s whisper in the Reader is offered as an item, an agent\'s whisper never, and a message on the record still is', async () => {
    // A person's whisper counts as their Tell (docs/whispers.md): it may become an item, its title shown to the person
    // before Return. An agent's whisper only answers, so it is never offered.
    const said = 'The page could say which release is live.', kept = 'Just between us: the release notes are late.', back = 'Noted; I will chase them.';
    // On when the checks before it ran; on its own, the person turns it on as their CLI does.
    if (!(await view('pipeline', { workspace_id: 'w1', limit: 1 })).pipeline?.enabled) await pipeline('pipeline.configure', { workspace_id: 'w1' }, { enabled: true });
    const message = (await control({ method: 'agent_message', operation_id: 'pipeline-native-record', body: said })).result.message_id;
    const whisper = (await control({ method: 'agent_message', operation_id: 'pipeline-native-whisper', sender: 'person', body: kept,
      addressees: [facts.agent], whisper: true })).result.message_id;
    const answer = (await control({ method: 'agent_message', operation_id: 'pipeline-native-whisper-answer', body: back, reply_to: whisper,
      addressees: [facts.actor], whisper: true })).result.message_id;
    const r = await open('pipeline-reader-whisper', '/?topic=t1');
    const show = async (id, words) => {
      const card = `#messages [data-id="${id}"]`;
      await until(() => r.evaluate(`Boolean(document.querySelector('${card}'))`).catch(() => false), 'the card is drawn');
      if (await r.evaluate(`document.querySelector('#reader').open`)) {
        await r.point('#reader-close');
        await until(() => r.evaluate(`!document.querySelector('#reader').open`), 'the Reader closes');
      }
      await tap(r, card);
      await until(() => r.evaluate(`document.querySelector('#reader').open && document.querySelector('#source-body').textContent.includes(${JSON.stringify(words)})`), 'the Reader shows it');
    };
    const offered = () => r.evaluate(`(()=>{const b=document.getElementById('add-to-pipeline');return Boolean(b)&&!b.hidden})()`);
    await show(message, said);
    await until(offered, 'a message on the record offers Add to pipeline');
    await show(whisper, kept);
    await until(offered, 'a person\'s whisper offers Add to pipeline');
    await show(answer, back);
    assert.equal(await offered(), false, 'an agent\'s whisper does not offer Add to pipeline');
    assert.equal(await r.evaluate(`document.getElementById('pipeline-add').hidden`), true, 'and no line opens under it');
    await show(message, said);
    await until(offered, 'back on the message on the record, Add to pipeline is offered again');
    assert.deepEqual(r.errors, []); await r.close();
  });

  await check('pipeline the page and an item’s record fit 1280 and 390, light and dark, with no People heading and no sideways scroll', async () => {
    for (const [size, theme] of COMBOS) {
      const at = `${size} ${theme}`;
      for (const [name, url] of [['page', '/?pipeline=w1'], ['record', '/?pipeline=w1&item=1']]) {
        const p = await open(`pipeline-${name}-${size}-${theme}`, url, size, theme);
        await ready(p);
        await until(() => p.evaluate(`Boolean(document.querySelector('#pipeline-page .pl-section, #pipeline-page .pl-item'))`), `${at}: the ${name} is drawn`);
        const seen = await p.evaluate(`(()=>{const shown=e=>Boolean(e)&&e.getClientRects().length>0;return {people:shown(document.getElementById('topic-people')),
          messages:shown(document.getElementById('messages')),scroll:document.documentElement.scrollWidth,width:innerWidth,
          wide:[...document.querySelectorAll('#pipeline-page *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>e.className||e.tagName).slice(0,3)}})()`);
        assert.deepEqual([seen.people, seen.messages], [false, false], `${at}: the ${name} has no People heading and no messages`);
        assert.ok(seen.scroll <= seen.width, `${at}: no sideways scroll on the ${name} (${seen.scroll} of ${seen.width})`);
        assert.deepEqual(seen.wide, [], `${at}: nothing on the ${name} runs past the screen`);
        if (name === 'record') assert.equal(await p.evaluate(`document.getElementById('topic-title').textContent`), '1. Say which release is live');
        await shot(p, `pipeline-${name}-${size}-${theme}`);
        assert.deepEqual(p.errors, []); await p.close();
      }
    }
  });

  await check('pipeline an item added on Next’s line whose answer is lost, though Core has it, is not said as not saved, and Return on it sends that same change: Core has it once', async () => {
    // Item 192, the reviewer's case: a phone over the tailnet whose connection drops after Core has made the change
    // and answered. The answer is lost on its way back, the connection closed, so the page has no answer at all.
    const title = 'Count the releases', held = '[data-key^="held:add:next:"]';
    const count = async () => (await view('pipeline', { workspace_id: 'w1', section: 'next', limit: 100 })).items.filter(item => item.title === title).length;
    // On when the checks before it ran; on its own, the person turns it on as their CLI does.
    if (!(await view('pipeline', { workspace_id: 'w1', limit: 1 })).pipeline?.enabled) await pipeline('pipeline.configure', { workspace_id: 'w1' }, { enabled: true });
    const p = await open('pipeline-lost', '/?pipeline=w1');
    await ready(p);
    let lost = false;
    const losing = (payload, url) => !lost && url === facts.origin + '/api/command' && payload?.kind === 'pipeline.item_add' && payload.args?.title === title;
    if (p.pw) await p.pw.route(facts.origin + '/api/command', async route => {
      if (!losing(route.request().postDataJSON(), route.request().url())) return route.continue();
      lost = true; await route.fetch(); await route.abort('connectionreset');
    });
    else p.intercept(async (payload, event) => {
      if (!losing(payload, event.request.url)) return false;
      lost = true; await p.fail({ event }); return true;
    });
    await type(p, '[data-key="add:next"] input', title); await p.key('Enter');
    await until(() => lost, 'Core takes the item and its answer is lost');
    await until(() => p.evaluate(`document.querySelectorAll('${held}').length===1`), 'the title is kept under the line');
    assert.equal(await count(), 1, 'Core has it');
    const kept = () => p.evaluate(`(()=>{const i=document.querySelector('${held} input');return i&&{value:i.value,label:i.getAttribute('aria-label'),readOnly:i.readOnly,
      said:[...document.querySelectorAll('${held} [role=status]')].map(e=>e.textContent)}})()`);
    assert.deepEqual(await kept(), { value: title, label: 'Add an item to Next, not known if saved', readOnly: true,
      said: ['Not known whether this was saved: Theseus did not confirm it. Try again'] }, 'not known, kept as it was sent');
    assert.doesNotMatch(await p.evaluate(`document.getElementById('pipeline-page').innerText`), /not saved|null|undefined/i);
    await shot(p, 'pipeline-lost');
    // Return on it sends the same change again, under its operation; Core answers with what it recorded.
    await tap(p, `${held} input`); await p.key('Enter');
    await until(() => p.evaluate(`!document.querySelector('${held}')`), 'Core answers, and the title is let go');
    assert.equal(await count(), 1, 'Core has it once');
    await until(() => p.evaluate(`[...document.querySelectorAll('section[aria-label=Next] .pl-row')].filter(r=>r.textContent.includes(${JSON.stringify(title)})).length===1`), 'the page shows it once');
    // The title is let go as Core answers, before the page reads again; focus comes back once that read is shown.
    const back = await until(async () => { const f = await focused(p); return f.key !== null && f; }, 'focus comes back into the page');
    assert.deepEqual([back.key, back.role, back.value], ['add:next', 'add-title', ''], 'focus goes to Next’s line');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('pipeline an ask that holds a piece shows Held on its row, with who it waits on and the ask’s first line linking to it, until it is answered; a plain ask leaves the row as it was', async () => {
    // Item 259. The piece is built in t1, and an agent on the team asks the person there.
    await pipeline('pipeline.configure', { workspace_id: 'w1' }, { enabled: true });
    await pipeline('pipeline.stages_set', { workspace_id: 'w1' }, { stages: [{ stage_id: 'build', name: 'Build' }] });
    const { result: { number } } = await pipeline('pipeline.item_add', { workspace_id: 'w1' }, { title: 'Watch the files', section: 'now', size: 'small', sources: [{ note: 'the check' }] });
    const { result: { piece_id: piece } } = await pipeline('pipeline.piece_start', { workspace_id: 'w1' }, { numbers: [number], topic_id: 't1', stage_id: 'build' });
    const ask = (name, body, more = {}) => control({ method: 'agent_message', operation_id: `pipeline-held-${name}`, member: true, whole_topic: true, body,
      post_args: { addressees: [facts.actor], intent: 'ask', ...more } });
    const plain = await ask('plain', 'Which colour for the header?');
    assert.equal(plain.status, 'committed', JSON.stringify(plain));
    const p = await open('pipeline-held', '/?pipeline=w1');
    await ready(p);
    const card = `[data-key="piece:${piece}"]`;
    const held = () => p.evaluate(`[...document.querySelectorAll('${card} .pl-held')].map(h=>({text:h.textContent,href:h.querySelector('a')?.getAttribute('href')??null}))`);
    await until(() => p.evaluate(`document.querySelector('${card} .pl-chip[aria-current=step]')?.textContent==='Build'`), 'the piece card shows it in Build');
    assert.deepEqual(await held(), [], 'a plain ask holds nothing on the row');
    const before = await loaded(p);
    const blocking = await ask('blocking', 'Please restart fseventsd.\nIt stopped at 9.', { blocks: { kind: 'piece', ref: piece } });
    assert.equal(blocking.status, 'committed', JSON.stringify(blocking));
    const message = blocking.result.message_id;
    await until(async () => (await held()).length === 1, 'the row says it is held, live');
    assert.deepEqual(await held(), [{ text: 'Held: waiting on you — Please restart fseventsd.', href: `?topic=t1&message=${message}` }],
      'who it waits on, and the ask’s first line linking to the ask');
    assert.equal(await loaded(p), before, 'with no reload');
    assert.ok(await p.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'no sideways scroll');
    await p.evaluate(`document.querySelector('${card} .pl-held').scrollIntoView({block:'center'})`);
    await shot(p, 'pipeline-held');
    // The person answers in the topic: the row is as it was, live.
    await control({ method: 'agent_message', operation_id: 'pipeline-held-answer', sender: 'person', whole_topic: true, body: 'Restarted.' });
    await until(async () => (await held()).length === 0, 'the answer clears it, live');
    assert.equal(await loaded(p), before, 'with no reload');
    // Asked again, its link opens the ask in its topic.
    const again = await ask('again', 'Restart it once more?', { blocks: { kind: 'piece', ref: piece } });
    await until(async () => (await held()).length === 1, 'held again');
    await tap(p, `${card} .pl-held a`);
    await until(() => p.evaluate(`(()=>{const u=new URL(location.href).searchParams;return u.get('topic')==='t1'})()`), 'the link opens the topic');
    assert.deepEqual(p.errors, []); await p.close();
    // The person answers, and the piece finishes, so t1 holds no piece for the cases after.
    await control({ method: 'agent_message', operation_id: 'pipeline-held-answer-2', sender: 'person', whole_topic: true, body: 'Done.' });
    assert.equal(again.status, 'committed');
    assert.equal((await pipeline('pipeline.piece_finish', { piece_id: piece }, {})).status, 'committed');
  });
}
