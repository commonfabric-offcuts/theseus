import assert from 'node:assert/strict';

// The side rail inside an outcome and the page without a header bar (pipeline
// items 101 and 107), in the real browser against the real server, at 1280
// and 390 wide, light and dark. Every page has the logo block (the wordmark
// with its presence dot, the workspace name, the Health link and Turn on
// notifications) first in its rail, or first in its main column where it has
// no rail, with the guide's "? Pointer, keys and taps" under the name
// (docs/interaction.md), and no header
// bar or Refresh button. On a topic page the rail lists no outcomes: "←
// Outcomes" comes first, then the outcome's conversation and its own topics.
// On a phone (item 117) the topic comes first and the rail folds behind "☰
// Topics" at its top, which opens it as a drawer over the topic. The
// outcome's own page has no rail. An ask to the reader in another outcome
// lights "← Outcomes" live, with its words on a topic page; on the outcome
// page too when that outcome is one the reader is not on the team of, so its
// "Also waiting on you" line cannot name it.
// At 390 the drawer opens on the open topic, whole with a lit neighbour not
// cut; the dimmed page beside it, Escape and a topic in it close it. What
// Refresh did is done without it: writes elsewhere show with no
// reload, an unconfirmed state change says where the topic stands, the
// opening page follows a save made elsewhere while it holds no unsaved
// writing, and a second tab on a new outcome form opens when the first
// closes. Run by reader_persistence_native.mjs with --rail; screenshots are
// kept as rail-*.png for review.
const SIZES = { laptop: { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, phone: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } };
const COMBOS = [['laptop', 'light'], ['laptop', 'dark'], ['phone', 'light'], ['phone', 'dark']];

export async function railChecks({ check, page, until, control, view, facts, shot }) {
  const open = (name, url, size = 'laptop', theme = 'light') => page(name, null, true, { url: facts.origin + url, beforeNavigate: async q => {
    await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await q.send('Emulation.setDeviceMetricsOverride', SIZES[size]);
    if (SIZES[size].mobile) await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  } });
  // What a page shows at its top, read from the page as drawn: the children of
  // the rail and of main that take up room, in order, by id or first class.
  const top = p => p.evaluate(`(()=>{
    const shown = e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    const name = e => e.id || e.classList[0] || e.tagName.toLowerCase();
    const rail = document.querySelector('.rail'), main = document.querySelector('main'), brand = document.querySelector('.brand');
    return { headers: document.querySelectorAll('.app-header').length, refresh: Boolean(document.getElementById('refresh')),
      buttons: [...document.querySelectorAll('button')].filter(b => /\\brefresh\\b/i.test(b.textContent)).length,
      railShown: shown(rail), railLabel: rail.getAttribute('aria-label'), control: shown(document.getElementById('rail-open')),
      title: Math.round(document.getElementById('topic-title').getBoundingClientRect().bottom), height: innerHeight,
      rail: [...rail.children].filter(shown).map(name), main: [...main.children].filter(shown).map(name),
      brandIn: brand.parentElement === rail ? 'rail' : brand.parentElement === main ? 'main' : 'elsewhere',
      brand: [...brand.children].map(name), dot: Boolean(brand.querySelector('.wordmark .presence-dot')),
      name: document.getElementById('instance-label').textContent,
      outcomes: document.querySelectorAll('#workspaces a').length, outcomesShown: shown(document.getElementById('outcome-navigation')),
      scroll: document.documentElement.scrollWidth, width: innerWidth, page: getComputedStyle(document.body).backgroundColor };
  })()`);
  // A finger on the middle of what the selector names, once nothing covers it there.
  const tap = async (p, selector) => {
    const b = await p.box(selector);
    assert.ok(b && b.width > 0 && b.height > 0, `${selector} is shown to tap`);
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${x}, ${y}))`), true, `nothing covers ${selector}`);
    await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const drawer = p => p.evaluate(`(()=>{const control=document.getElementById('rail-open');return {open:document.getElementById('rail').classList.contains('open'),
    backdrop:!document.getElementById('rail-backdrop').hidden,inert:document.getElementById('main').inert,expanded:control.getAttribute('aria-expanded'),
    focus:document.activeElement===control?'control':document.activeElement?.dataset?.topicId??document.activeElement?.id??null}})()`);
  const loaded = p => p.evaluate('performance.timeOrigin');
  const home = p => p.evaluate(`(()=>{const h=document.getElementById('outcomes-home'),l=h.querySelector('.outcome-light'),w=h.querySelector('.elsewhere-words');
    return {lit:Boolean(l)&&l.getClientRects().length>0,words:w&&w.getClientRects().length>0?w.textContent:null,said:w?.textContent??null,label:h.getAttribute('aria-label')}})()`);

  await check('rail no page has a header bar or Refresh; the logo block tops the rail inside an outcome and main on the outcome page and home, at 1280 and 390, light and dark', async () => {
    for (const [size, theme] of COMBOS) {
      const at = `${size} ${theme}`;
      // A topic page: the logo block, then "← Outcomes", then the outcome's topics.
      const t = await open(`rail-topic-${size}-${theme}`, '/?topic=t1', size, theme);
      await until(() => t.evaluate('Boolean(document.querySelector("#topics a[data-topic-id=t1]"))'), at + ': the topic rail is drawn');
      if (SIZES[size].mobile) {
        // On a phone the topic comes first: the rail is folded behind "☰ Topics" at the top of the topic.
        const folded = await until(async () => { const seen = await top(t); return seen.main[0] === 'topic-header' && seen; }, at + ': the topic heads the page');
        assert.deepEqual(folded.rail, [], at + ': the folded rail shows nothing above the topic');
        assert.equal(folded.control, true, at + ': "☰ Topics" is shown');
        assert.equal(await t.evaluate('document.getElementById("rail-open").textContent'), '☰ Topics');
        assert.ok(folded.title < folded.height / 4, at + `: the topic's title is near the top of the screen (${folded.title} of ${folded.height})`);
        assert.ok(folded.scroll <= folded.width, at + `: no sideways scroll on the folded topic page (${folded.scroll} of ${folded.width})`);
        await shot(t, `rail-topic-${size}-${theme}-folded`);
        await tap(t, '#rail-open');
        await until(async () => (await drawer(t)).open, at + ': "☰ Topics" opens the rail over the topic');
      }
      const topic = await until(async () => { const seen = await top(t); return seen.rail[0] === 'brand' && seen.rail[1] === 'outcomes-home' && seen; }, at + ': the logo block, then ← Outcomes');
      if (!SIZES[size].mobile) assert.equal(topic.control, false, at + ': no "☰ Topics" beside the rail');
      assert.deepEqual([topic.headers, topic.refresh, topic.buttons], [0, false, 0], at + ': no header bar and no Refresh on the topic page');
      assert.equal(topic.brandIn, 'rail', at + ': the logo block is in the rail');
      assert.deepEqual(topic.rail.slice(0, 4), ['brand', 'outcomes-home', 'conversation-navigation', 'topic-navigation'],
        at + ': the logo block, ← Outcomes, the outcome\'s conversation, then the topics');
      assert.deepEqual(topic.brand, ['wordmark', 'instance-label', 'guide-open', 'health-link', 'notify'], at + ': the wordmark, then the workspace name, the guide\'s ? (docs/interaction.md) under it, the Health link and Turn on notifications');
      assert.equal(topic.dot, true, at + ': the wordmark carries its presence dot');
      assert.match(topic.name, new RegExp('^' + facts.actor + ' · '), at + ': the workspace name is filled in');
      assert.deepEqual([topic.outcomesShown, topic.railLabel], [false, 'This outcome'], at + ': no list of outcomes inside an outcome');
      assert.ok(topic.scroll <= topic.width, at + `: no sideways scroll on the topic page (${topic.scroll} of ${topic.width})`);
      await shot(t, `rail-topic-${size}-${theme}`);
      assert.deepEqual(t.errors, []); await t.close();
      // The outcome's own page: no rail; the logo block, then "← Outcomes", head main.
      const o = await open(`rail-outcome-${size}-${theme}`, '/?workspace=w1', size, theme);
      const outcome = await until(async () => { const seen = await top(o); return seen.main[0] === 'brand' && seen; }, at + ': the logo block heads main');
      assert.deepEqual([outcome.headers, outcome.refresh, outcome.buttons], [0, false, 0], at + ': no header bar and no Refresh on the outcome page');
      assert.deepEqual([outcome.railShown, outcome.brandIn], [false, 'main'], at + ': the outcome page has no rail');
      assert.deepEqual(outcome.main.slice(0, 3), ['brand', 'outcomes-home', 'topic-header'], at + ': the logo block, ← Outcomes, then the outcome');
      assert.ok(outcome.scroll <= outcome.width, at + `: no sideways scroll on the outcome page (${outcome.scroll} of ${outcome.width})`);
      await shot(o, `rail-outcome-${size}-${theme}`);
      if (size === 'laptop' && theme === 'light') {
        // ← Outcomes opens the Outcomes home, where the list of outcomes is.
        await o.point('#outcomes-home');
        await until(() => o.evaluate('document.body?.dataset.ready==="true" && location.search==="" && document.querySelector("#topic-title").textContent==="Outcomes"').catch(() => false), 'the Outcomes home opened');
      }
      assert.deepEqual(o.errors, []); await o.close();
      // The Outcomes home: no rail either; the logo block heads main, above the outcomes.
      const h = await open(`rail-home-${size}-${theme}`, '/', size, theme);
      await until(() => h.evaluate('Boolean(document.querySelector("#workspaces a[data-workspace-id=w1]"))'), at + ': the outcomes are listed');
      const root = await top(h);
      assert.deepEqual([root.headers, root.refresh, root.buttons, root.railShown, root.main[0]], [0, false, 0, false, 'brand'], at + ': the home has the logo block first and no header or Refresh');
      assert.ok(root.scroll <= root.width, at + `: no sideways scroll on the home (${root.scroll} of ${root.width})`);
      await shot(h, `rail-home-${size}-${theme}`);
      assert.deepEqual(h.errors, []); await h.close();
    }
  });

  await check('rail the outcome\'s conversation row stands in its place while its read is out, so on a phone the topics in the open rail and the page below do not move when it lands', async () => {
    const t = await page('rail-conversation-held', null, true, { url: facts.origin + '/?topic=t1', beforeNavigate: async q => {
      await q.send('Emulation.setDeviceMetricsOverride', SIZES.phone);
      await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      q.intercept(payload => payload?.name === 'conversation');
    } });
    await until(() => t.evaluate('Boolean(document.querySelector("#topics a[data-topic-id=t1]"))'), 'the topic rail is drawn');
    await until(() => t.held.some(entry => entry.payload?.name === 'conversation'), 'the conversation\'s read is held');
    await tap(t, '#rail-open');
    await until(async () => (await drawer(t)).open, 'the rail is open over the topic');
    const where = () => t.evaluate(`(()=>{const top=s=>Math.round(document.querySelector(s).getBoundingClientRect().top);
      return {row:!document.querySelector('#conversation-navigation').hidden&&Boolean(document.querySelector('#conversation-row a.conversation-row')),topics:top('#topic-navigation'),title:top('#topic-title')}})()`);
    const before = await where();
    assert.equal(before.row, true, 'the row is in its place while its read is out');
    t.intercept(null);
    for (const entry of t.held.splice(0)) await t.release(entry);
    await t.evaluate('new Promise(resolve=>setTimeout(resolve,0))');
    const after = await where();
    assert.deepEqual(after, before, 'the read landing moves nothing');
    assert.deepEqual(t.errors, []); await t.close();
  });

  await check('rail an outcome with no conversation never draws its row: on a phone nothing stands there while the conversation\'s read is out, nor after it lands, and nothing moves', async () => {
    // An outcome made before version 28, not yet given its conversation.
    await control({ method: 'older_outcome', workspace_id: 'rail-older', title: 'Older outcome', topic_id: 'rail-older-topic', topic_title: 'Older topic' });
    const t = await page('rail-conversation-none', null, true, { url: facts.origin + '/?topic=rail-older-topic', beforeNavigate: async q => {
      await q.send('Emulation.setDeviceMetricsOverride', SIZES.phone);
      await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      q.intercept(payload => payload?.name === 'conversation');
    } });
    await until(() => t.evaluate('Boolean(document.querySelector("#topics a[data-topic-id=rail-older-topic]"))'), 'the topic rail is drawn');
    await until(() => t.held.some(entry => entry.payload?.name === 'conversation'), 'the conversation\'s read is held');
    const where = () => t.evaluate(`(()=>{const top=s=>Math.round(document.querySelector(s).getBoundingClientRect().top);
      return {row:!document.querySelector('#conversation-navigation').hidden||Boolean(document.querySelector('#conversation-row a')),topics:top('#topic-navigation'),title:top('#topic-title')}})()`);
    const before = await where();
    assert.equal(before.row, false, 'no row stands for a conversation the outcome does not have');
    t.intercept(null);
    for (const entry of t.held.splice(0)) await t.release(entry);
    await t.evaluate('new Promise(resolve=>setTimeout(resolve,0))');
    assert.deepEqual(await where(), before, 'the read landing draws nothing and moves nothing');
    assert.deepEqual(t.errors, []); await t.close();
  });

  await check('rail the pipeline page has a topic page\'s rail: ← Outcomes, the conversation, the Pipeline row, then the topics, at 1280 and 390, light and dark', async () => {
    const pipeline = (operation, enabled) => control({ method: 'pipeline', kind: 'pipeline.configure', operation_id: operation, target: { workspace_id: 'w1' }, args: { enabled } });
    await pipeline('rail-pipeline-on', true);
    try {
      for (const [size, theme] of COMBOS) {
        const at = `${size} ${theme}`;
        const p = await open(`rail-pipeline-${size}-${theme}`, '/?pipeline=w1', size, theme);
        await until(() => p.evaluate('Boolean(document.querySelector("#topics a[data-topic-id=t1]")) && Boolean(document.querySelector("#pipeline-links a"))'), at + ': the rail is drawn');
        if (SIZES[size].mobile) {
          // On a phone the pipeline comes first, as a topic does: the rail is folded behind "☰ Topics".
          const folded = await top(p);
          assert.deepEqual([folded.rail, folded.control], [[], true], at + ': the folded rail shows nothing above the pipeline, and "☰ Topics" is shown');
          await tap(p, '#rail-open');
          await until(async () => (await drawer(p)).open, at + ': "☰ Topics" opens the rail over the pipeline');
        }
        const seen = await top(p);
        assert.deepEqual(seen.rail.slice(0, 5), ['brand', 'outcomes-home', 'conversation-navigation', 'pipeline-navigation', 'topic-navigation'],
          at + ': the logo block, ← Outcomes, the outcome\'s conversation, its Pipeline row, then the topics');
        const row = await p.evaluate(`(()=>{const a=document.querySelector('#conversation-row a.conversation-row');return a&&{name:a.querySelector('.conversation-name').firstChild.textContent,href:a.getAttribute('href'),current:a.getAttribute('aria-current')}})()`);
        assert.deepEqual(row, { name: 'Isolated wiring', href: '?conversation=w1', current: null }, at + ': the row names the outcome and opens its conversation');
        assert.ok(seen.scroll <= seen.width, at + `: no sideways scroll on the pipeline page (${seen.scroll} of ${seen.width})`);
        await shot(p, `rail-pipeline-${size}-${theme}`);
        assert.deepEqual(p.errors, []); await p.close();
      }
    } finally {
      // The checks after this one expect the topic page's rail without a Pipeline row.
      await pipeline('rail-pipeline-off', false);
    }
  });

  await check('rail Tab from ← Outcomes reaches the conversation, New topic, then the first topic', async () => {
    const p = await open('rail-tab', '/?topic=t1');
    await until(() => p.evaluate('Boolean(document.querySelector("#topics a[data-topic-id=t1]")) && !document.querySelector("#new-topic").disabled'), 'the rail is ready');
    // A press on the workspace name starts Tab there, as it would for a person.
    await p.point('#instance-label');
    const focused = () => p.evaluate('document.activeElement.id || (document.activeElement.dataset.topicId ? "topic:" + document.activeElement.dataset.topicId : document.activeElement.classList.contains("conversation-row") ? "conversation" : document.activeElement.tagName)');
    for (let n = 0; n < 6 && await focused() !== 'outcomes-home'; ++n) await p.key('Tab');
    assert.equal(await focused(), 'outcomes-home', 'Tab reaches ← Outcomes from the logo block');
    const order = [];
    for (let n = 0; n < 3; ++n) { await p.key('Tab'); order.push(await focused()); }
    const first = await p.evaluate('"topic:" + document.querySelector("#topics a").dataset.topicId');
    assert.deepEqual(order, ['conversation', 'new-topic', first], 'then the outcome\'s conversation, New topic, then the first topic');
    assert.deepEqual(p.errors, []);
  });

  await check('rail an ask in another outcome lights ← Outcomes live, with words on a topic page, and on the outcome page when its Also-waiting line cannot name it; answering it clears the light', async () => {
    const p = await open('rail-light', '/?topic=t1');
    await until(async () => (await home(p)).lit === false, 'nothing waits elsewhere at first');
    const before = await loaded(p);
    // An agent asks the reader in an outcome of its own, through its CLI.
    const asked = await control({ method: 'elsewhere_ask', operation_id: 'rail-ask', body: 'Which deck do we send?' });
    const lit = await until(async () => { const h = await home(p); return h.lit && h; }, 'the ask lights ← Outcomes, live');
    assert.deepEqual(lit, { lit: true, words: '1 other outcome is waiting on you', said: '1 other outcome is waiting on you', label: 'Outcomes. 1 other outcome is waiting on you.' });
    assert.equal(await loaded(p), before, 'with no reload');
    await shot(p, 'rail-light-topic');
    // The ask's outcome has an empty team: the reader cannot list it, so the
    // page's Also-waiting line cannot name it, and the light says it in words.
    const o = await open('rail-light-outcome', '/?workspace=w1');
    const there = await until(async () => { const h = await home(o); return h.lit && h.words && h; }, 'the outcome page lights it too, with its words');
    assert.deepEqual(there, { lit: true, words: '1 other outcome is waiting on you', said: '1 other outcome is waiting on you', label: 'Outcomes. 1 other outcome is waiting on you.' });
    const page = await o.evaluate(`(()=>{const a=document.getElementById('also-waiting');return {also:a.getClientRects().length>0?a.textContent:null,
      said:document.querySelector('main').innerText.includes('1 other outcome is waiting on you'),listed:document.querySelectorAll('#workspaces a').length}})()`);
    assert.deepEqual([page.also, page.said], [null, true], 'no Also-waiting line can name it, and the page says it in words');
    assert.ok(page.listed > 0, 'the outcome list was read, without the ask\'s outcome in it');
    await shot(o, 'rail-light-outcome');
    // The reader answers in that topic: the light goes on both pages, live.
    const answeredFrom = await loaded(o);
    await control({ method: 'agent_message', operation_id: 'rail-answer', sender: 'person', topic_id: asked.topic_id, whole_topic: true, body: 'The short one.' });
    await until(async () => (await home(o)).lit === false, 'answered, the light goes on the outcome page');
    assert.equal((await home(o)).label, null);
    assert.equal(await loaded(o), answeredFrom, 'with no reload');
    await p.send('Page.bringToFront');
    await until(async () => (await home(p)).lit === false, 'and on the topic page');
    assert.deepEqual((await home(p)).said, '');
    assert.deepEqual([...p.errors, ...o.errors], []);
  });

  await check('rail waited on only in this outcome, a topic page never lights ← Outcomes as it loads; with a wait elsewhere too it counts one other', async () => {
    // An agent asks the reader in t1, in this outcome w1: only this outcome waits.
    await control({ method: 'agent_message', operation_id: 'rail-here-ask', body: 'Is the outline right?', topic_id: 't1', addressees: [facts.actor], intent: 'ask' });
    // Every state "← Outcomes" is drawn in, from the page's first script on.
    const watch = `(()=>{window.homeSeen=[];const seen=()=>{const h=document.getElementById('outcomes-home'),l=h?.querySelector('.outcome-light');
      const now=h?{lit:Boolean(l&&!l.hidden),label:h.getAttribute('aria-label')}:null,last=homeSeen.at(-1);
      if(now&&JSON.stringify(now)!==JSON.stringify(last))homeSeen.push(now)};new MutationObserver(seen).observe(document,{subtree:true,childList:true,attributes:true,characterData:true})})()`;
    const p = await page('rail-here', null, true, { url: facts.origin + '/?topic=t1', beforeNavigate: async q => {
      await q.send('Emulation.setDeviceMetricsOverride', SIZES.laptop);
      await q.send('Page.addScriptToEvaluateOnNewDocument', { source: watch });
    } });
    // The read that names this outcome has answered.
    const asked = e => e.method === 'Network.requestWillBeSent' && e.params.request.url === facts.origin + '/api/view' && /"name":"attention"/.test(e.params.request.postData ?? '') && /"workspace_id":"w1"/.test(e.params.request.postData ?? '');
    const read = await until(() => p.network.find(asked)?.params.requestId, 'the page asks about w1');
    await until(() => p.network.some(e => e.method === 'Network.loadingFinished' && e.params.requestId === read), 'the read about w1 answered');
    await until(() => p.evaluate('Boolean(document.querySelector("#topics a[data-topic-id=t1]"))'), 'the topic rail is drawn');
    const loading = await p.evaluate('homeSeen.length');
    // A wait in another outcome too: one other outcome, never two.
    const elsewhere = await control({ method: 'elsewhere_ask', operation_id: 'rail-here-elsewhere', body: 'And the cover?' });
    await until(async () => (await home(p)).lit, 'the wait elsewhere lights ← Outcomes, live');
    assert.deepEqual(await home(p), { lit: true, words: '1 other outcome is waiting on you', said: '1 other outcome is waiting on you', label: 'Outcomes. 1 other outcome is waiting on you.' });
    const seen = await p.evaluate('homeSeen');
    assert.ok(seen.length > 0, 'the watch saw ← Outcomes drawn');
    assert.deepEqual(seen.slice(0, loading).filter(state => state.lit || state.label !== null), [], 'while only this outcome waits, ← Outcomes is never lit nor labelled: ' + JSON.stringify(seen));
    assert.deepEqual(seen.slice(loading).map(state => state.label).filter(Boolean), ['Outcomes. 1 other outcome is waiting on you.'], 'once a wait elsewhere lands, it says one other, and only that');
    // Both answered, so the checks after this one start with nothing waiting.
    await control({ method: 'agent_message', operation_id: 'rail-here-answer', sender: 'person', topic_id: 't1', whole_topic: true, body: 'Yes.' });
    await control({ method: 'agent_message', operation_id: 'rail-here-elsewhere-answer', sender: 'person', topic_id: elsewhere.topic_id, whole_topic: true, body: 'The blue one.' });
    await until(async () => (await home(p)).lit === false, 'answered, the light goes');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail at 390 "☰ Topics" opens the rail over the topic on the open topic, whole with its lit neighbour; the dimmed page, Escape and a topic in it close it', async () => {
    // Twelve topics, newest first in the rail; the open one is the ninth, and
    // the one after it waits on the reader.
    const ids = Array.from({ length: 12 }, (_, n) => 'rail-drawer-' + String(n).padStart(2, '0'));
    for (const [n, id] of ids.entries()) {
      await control({ method: 'navigation_topics', topics: [{ id, title: 'Drawer topic ' + n }] });
      if (n === 2) await control({ method: 'topic_state', operation_id: 'rail-drawer-lit', topic_id: id, args: { state: 'waiting', waiting_on: [facts.actor] } });
    }
    for (const theme of ['light', 'dark']) {
      const p = await open('rail-drawer-' + theme, '/?topic=' + ids[3], 'phone', theme);
      await until(() => p.evaluate(`${JSON.stringify(ids)}.every(id => document.querySelector('#topics > a[data-topic-id="' + id + '"]'))`), theme + ': the rail holds every topic');
      const { focus: _unused, ...folded } = await drawer(p);
      assert.deepEqual(folded, { open: false, backdrop: false, inert: false, expanded: 'false' }, theme + ': folded as the page opens');
      await tap(p, '#rail-open');
      await until(async () => (await drawer(p)).open, theme + ': "☰ Topics" opens it');
      const seen = await p.evaluate(`(()=>{const r=document.getElementById('rail'),b=r.getBoundingClientRect(),rows=[...document.querySelectorAll('#topics > a')];
        const open=rows.find(a=>a.getAttribute('aria-current')==='page'),lit=rows[rows.indexOf(open)+1],box=e=>{const x=e.getBoundingClientRect();return [x.top,x.bottom]};
        return {index:rows.indexOf(open),litId:lit?.dataset.topicId,lit:Boolean(lit?.querySelector('.topic-state.mine')),drawer:[b.left,b.right,b.top,b.bottom],row:box(open),neighbour:box(lit),
          scrolled:r.scrollTop,room:r.scrollHeight-r.clientHeight,cover:document.elementFromPoint(innerWidth-12,innerHeight/2)?.id??null,
          flash:['rail-open','rail-backdrop'].map(id=>getComputedStyle(document.getElementById(id)).webkitTapHighlightColor),
          width:innerWidth,height:innerHeight,pageX:scrollX,pageY:scrollY,scroll:document.documentElement.scrollWidth}})()`);
      assert.equal(seen.index, 8, theme + ': the open topic is the ninth');
      assert.deepEqual([seen.litId, seen.lit], [ids[2], true], theme + ': the topic after it waits on the reader');
      assert.deepEqual(await drawer(p), { open: true, backdrop: true, inert: true, expanded: 'true', focus: ids[3] }, theme + ': open over the dimmed topic, the focus on the open topic');
      assert.ok(seen.drawer[0] === 0 && seen.drawer[1] <= seen.width * 0.86 + 1 && seen.drawer[2] === 0 && seen.drawer[3] === seen.height, theme + ': the drawer runs down the left of the screen, ' + JSON.stringify(seen.drawer));
      assert.equal(seen.cover, 'rail-backdrop', theme + ': the dimmed page covers the topic beside it');
      assert.deepEqual(seen.flash, ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'], theme + ': a tap on "☰ Topics" or the dimmed page leaves no highlight over the drawer');
      const whole = ([top, bottom]) => top >= seen.drawer[2] - 0.5 && bottom <= seen.drawer[3] + 0.5;
      assert.ok(whole(seen.row) && whole(seen.neighbour), theme + ': the open topic and its lit neighbour show whole: ' + JSON.stringify(seen));
      assert.ok(seen.room > 0 && seen.scrolled > 0, theme + `: the drawer scrolled itself to the open topic (${seen.scrolled} of ${seen.room})`);
      assert.ok(seen.pageX === 0 && seen.pageY === 0 && seen.scroll <= seen.width, theme + `: the page itself did not scroll (${seen.pageX}, ${seen.pageY}; ${seen.scroll} of ${seen.width})`);
      await shot(p, 'rail-drawer-' + theme);
      // A tap on the dimmed page beside it closes it, and "☰ Topics" has the focus back.
      await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: seen.width - 12, y: seen.height / 2 }] });
      await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await until(async () => !(await drawer(p)).open, theme + ': the dimmed page closes it');
      assert.deepEqual(await drawer(p), { open: false, backdrop: false, inert: false, expanded: 'false', focus: 'control' }, theme + ': closed, the focus back on "☰ Topics"');
      // Escape closes it too.
      await tap(p, '#rail-open'); await until(async () => (await drawer(p)).open, theme + ': open again');
      await p.key('Escape');
      await until(async () => !(await drawer(p)).open, theme + ': Escape closes it');
      assert.equal((await drawer(p)).focus, 'control', theme + ': the focus back on "☰ Topics"');
      // A topic in it opens that topic, at the top of the screen, and the drawer is closed.
      await tap(p, '#rail-open'); await until(async () => (await drawer(p)).open, theme + ': open once more');
      await tap(p, `#topics > a[data-topic-id="${ids[2]}"]`);
      await until(() => p.evaluate(`document.body.dataset.ready==="true" && new URL(location.href).searchParams.get("topic")===${JSON.stringify(ids[2])} && document.querySelector("#topic-title").textContent==="Drawer topic 2"`).catch(() => false), theme + ': the topic tapped opens');
      const after = await top(p);
      assert.deepEqual([(await drawer(p)).open, after.rail, after.main[0]], [false, [], 'topic-header'], theme + ': with the rail folded again and the topic first');
      assert.ok(after.title < after.height / 4, theme + `: its title near the top of the screen (${after.title} of ${after.height})`);
      await shot(p, 'rail-drawer-chosen-' + theme);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('rail at 390 New topic in the open drawer shows its title line at once, focused, in the drawer; Escape closes the line, and Return starts the topic', async () => {
    for (const theme of ['light', 'dark']) {
      const p = await open('rail-new-topic-' + theme, '/?topic=t1', 'phone', theme);
      await until(() => p.evaluate('Boolean(document.querySelector("#topics a[data-topic-id=t1]")) && !document.querySelector("#new-topic").disabled'), theme + ': the rail is ready');
      await tap(p, '#rail-open');
      await until(async () => (await drawer(p)).open, theme + ': "☰ Topics" opens it');
      // One tap: the line shows in the open drawer, under the Topics heading, with the focus in it.
      const line = () => p.evaluate(`(()=>{const l=document.getElementById('new-topic-title'),r=document.getElementById('rail'),b=l?.getBoundingClientRect(),d=r.getBoundingClientRect();
        return {shown:Boolean(l)&&l.getClientRects().length>0&&b.top>=d.top&&b.bottom<=d.bottom&&b.left>=d.left&&b.right<=d.right,focused:document.activeElement===l,open:r.classList.contains('open'),active:document.activeElement?.id??null}})()`);
      const tapped = () => until(() => p.evaluate('document.getElementById("new-topic").getAttribute("aria-expanded")==="true"'), theme + ': the tap reached New topic');
      await tap(p, '#new-topic'); await tapped();
      assert.deepEqual(await line(), { shown: true, focused: true, open: true, active: 'new-topic-title' }, theme + ': one tap shows the line, focused, in the open drawer');
      const seen = await p.evaluate('({scroll:document.documentElement.scrollWidth,width:innerWidth})');
      assert.ok(seen.scroll <= seen.width, theme + `: no sideways scroll (${seen.scroll} of ${seen.width})`);
      await shot(p, 'rail-new-topic-' + theme);
      // Escape closes the line and gives New topic the focus; the drawer stays open.
      await p.key('Escape');
      await until(() => p.evaluate('!document.getElementById("new-topic-title")'), theme + ': Escape closes the line');
      assert.deepEqual(await drawer(p), { open: true, backdrop: true, inert: true, expanded: 'true', focus: 'new-topic' }, theme + ': the drawer stays open, the focus on New topic');
      // Again, and Return starts the topic: it opens first on the page, the drawer folded.
      await tap(p, '#new-topic'); await tapped();
      assert.deepEqual(await line(), { shown: true, focused: true, open: true, active: 'new-topic-title' }, theme + ': the line again');
      const title = 'Started from the drawer ' + theme;
      await p.send('Input.insertText', { text: title }); await p.key('Enter');
      await until(() => p.evaluate(`document.body.dataset.ready==="true" && new URL(location.href).searchParams.has("topic") && document.querySelector("#topic-title").textContent===${JSON.stringify(title)}`).catch(() => false), theme + ': the new topic opens');
      const after = await top(p);
      assert.deepEqual([(await drawer(p)).open, after.rail, after.main[0]], [false, [], 'topic-header'], theme + ': with the rail folded and the new topic first');
      await shot(p, 'rail-new-topic-started-' + theme);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('rail a write elsewhere shows with no reload, and an unconfirmed state change says where the topic stands', async () => {
    const p = await open('rail-writes', '/?topic=t1');
    const before = await loaded(p);
    const text = 'Written by an agent through its CLI while the page is open';
    await control({ method: 'agent_message', operation_id: 'rail-write', body: text, topic_id: 't1' });
    await until(() => p.evaluate(`document.querySelector('#messages').textContent.includes(${JSON.stringify(text)})`), 'the write shows');
    assert.equal(await loaded(p), before, 'with no reload');
    // A state change whose answer is lost: Core took it, the page was not told.
    // Where it stands is in Topic settings, which the gear beside the title
    // opens: the note saves on Return, and the chip tapped after it is lost.
    await p.evaluate('scrollTo(0,0)');
    await p.point('#settings-open');
    await until(() => p.evaluate("document.querySelector('#topic-settings').open"), 'Topic settings is open');
    await p.point('#topic-state-note'); await p.send('Input.insertText', { text: 'Ready for a read' }); await p.key('Enter');
    await until(async () => (await view('topic', { topic_id: 't1' })).topic.state_note === 'Ready for a read', 'the note is saved');
    await until(() => p.evaluate("document.querySelector('#topic-state > p.notice')?.textContent === 'Saved'"), 'and said to be');
    const sentBefore = p.calls.filter(c => c.payload?.kind === 'topic.update').length;
    p.intercept(payload => payload?.kind === 'topic.update');
    await p.point('#topic-state [data-state=review]');
    const held = await until(() => p.held.find(h => h.payload?.kind === 'topic.update'), 'the state change reached Core');
    p.intercept(null);
    await p.send('Fetch.fulfillRequest', { requestId: held.event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify({ instance_id: facts.instance_id, status: 'unknown' })).toString('base64') });
    const notice = await until(async () => { const words = await p.evaluate("document.querySelector('#topic-state > p.notice')?.textContent ?? ''"); return words.startsWith('The change was not confirmed') && words; }, 'the panel says the change was not confirmed');
    assert.match(notice, new RegExp('^The change was not confirmed\\. It stands as: Ready for review · Ready for a read — you, (Yesterday )?\\d{1,2}:\\d{2} (AM|PM)\\.$'), 'and where the topic stands, as read again: ' + notice);
    assert.equal(p.calls.filter(c => c.payload?.kind === 'topic.update').length, sentBefore + 1, 'the change is never sent again');
    assert.equal((await view('topic', { topic_id: 't1' })).topic.state, 'review', 'Core holds the change the page reports');
    await shot(p, 'rail-state-unconfirmed');
    assert.deepEqual(p.errors, []);
  });

  await check('rail the opening page follows a save made elsewhere while it holds no unsaved writing, and keeps unsaved writing', async () => {
    // An opening's own page is where a topic started before is resumed (New topic is one title line).
    const p = await open('rail-opening', '/?workspace=w1&opening=rail-opening&opening_topic=rail-opening-topic');
    await until(() => p.evaluate('document.body.dataset.ready==="true" && new URL(location.href).searchParams.has("opening") && Boolean(document.querySelector("#opening-title-input"))').catch(() => false), 'the opening page');
    const opening = await p.evaluate('new URL(location.href).searchParams.get("opening")');
    const title = () => p.evaluate('document.querySelector("#opening-title-input").value');
    await p.point('#opening-title-input'); await p.send('Input.insertText', { text: 'Typed on this page' });
    await until(() => p.evaluate('document.querySelector("#opening-save-state").textContent==="Saved"'), 'saved');
    const before = await loaded(p);
    await control({ method: 'opening_save', operation_id: 'rail-opening-cli-1', opening_id: opening, title: 'Saved through the CLI' });
    await until(async () => await title() === 'Saved through the CLI', 'the page follows the save made elsewhere');
    assert.equal(await loaded(p), before, 'with no reload');
    assert.equal(await p.evaluate('document.querySelector("#opening-save-state").textContent'), 'Saved');
    // Writing the page has not saved yet is the person's: a save elsewhere does not replace it.
    p.recordResponses();
    await p.point('#opening-title-input'); await p.key('a', 4); await p.send('Input.insertText', { text: 'Not saved yet' });
    const typed = Date.now();
    await control({ method: 'opening_save', operation_id: 'rail-opening-cli-2', opening_id: opening, title: 'Saved through the CLI again' });
    const sent = Date.now();
    await until(() => p.responses.some(r => r.payload?.name === 'workspace_topics' && r.at >= sent), 'the page read again after that commit');
    assert.equal(p.calls.some(c => c.payload?.kind === 'opening.save' && c.at >= typed && c.at <= sent), false, 'the page had not saved its writing when the save elsewhere landed');
    assert.equal(await title(), 'Not saved yet', 'the unsaved title stays');
    await shot(p, 'rail-opening-kept');
    assert.deepEqual(p.errors, []);
  });

  await check('rail a second tab on one new outcome form turns editable when the first tab closes', async () => {
    const url = '/?new=outcome&intent=rail-two-tabs';
    const first = await open('rail-form-first', url);
    await first.point('#outcome-title-input'); await first.send('Input.insertText', { text: 'Started in the first tab' });
    await until(() => first.evaluate('document.querySelector("#outcome-page").textContent.includes("Form saved on this browser")'), 'the form saved');
    const second = await open('rail-form-second', url);
    assert.equal(await second.evaluate('document.querySelector("#outcome-page").textContent.includes("Open in another tab — read-only until that tab closes")'), true, 'the second tab is read-only and says until when');
    assert.equal(await second.evaluate('document.querySelector("#create-outcome").disabled'), true);
    const before = await loaded(second);
    await first.close();
    await until(() => second.evaluate('!document.querySelector("#create-outcome").disabled'), 'editable once the first tab closed');
    assert.equal(await second.evaluate('document.querySelector("#outcome-title-input").value'), 'Started in the first tab');
    assert.equal(await second.evaluate('document.querySelector("#outcome-page").textContent.includes("Form saved on this browser")'), true);
    assert.equal(await loaded(second), before, 'with no reload');
    assert.deepEqual(second.errors, []);
  });
}
