import assert from 'node:assert/strict';

// The side rail inside an outcome and the page without a header bar (pipeline
// items 101 and 107), in the real browser against the real server, at 1280
// and 390 wide, light and dark. Every page has the logo block (the wordmark
// with its presence dot, the workspace name and Turn on notifications) first
// in its rail, or first in its main column where it has no rail, and no header
// bar or Refresh button. On a topic page the rail lists no outcomes: "←
// Outcomes" comes first, then the outcome's own topics. The outcome's own page
// has no rail. An ask to the reader in another outcome lights "← Outcomes"
// live, with its words on a topic page; on the outcome page too when that
// outcome is one the reader is not on the team of, so its "Also waiting on
// you" line cannot name it.
// At 390 the open topic shows whole in the strip, with a lit neighbour not
// cut. What Refresh did is done without it: writes elsewhere show with no
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
      railShown: shown(rail), railLabel: rail.getAttribute('aria-label'),
      rail: [...rail.children].filter(shown).map(name), main: [...main.children].filter(shown).map(name),
      brandIn: brand.parentElement === rail ? 'rail' : brand.parentElement === main ? 'main' : 'elsewhere',
      brand: [...brand.children].map(name), dot: Boolean(brand.querySelector('.wordmark .presence-dot')),
      name: document.getElementById('instance-label').textContent,
      outcomes: document.querySelectorAll('#workspaces a').length, outcomesShown: shown(document.getElementById('outcome-navigation')),
      scroll: document.documentElement.scrollWidth, width: innerWidth, page: getComputedStyle(document.body).backgroundColor };
  })()`);
  const loaded = p => p.evaluate('performance.timeOrigin');
  const home = p => p.evaluate(`(()=>{const h=document.getElementById('outcomes-home'),l=h.querySelector('.outcome-light'),w=h.querySelector('.elsewhere-words');
    return {lit:Boolean(l)&&l.getClientRects().length>0,words:w&&w.getClientRects().length>0?w.textContent:null,said:w?.textContent??null,label:h.getAttribute('aria-label')}})()`);

  await check('rail no page has a header bar or Refresh; the logo block tops the rail inside an outcome and main on the outcome page and home, at 1280 and 390, light and dark', async () => {
    for (const [size, theme] of COMBOS) {
      const at = `${size} ${theme}`;
      // A topic page: the logo block, then "← Outcomes", then the outcome's topics.
      const t = await open(`rail-topic-${size}-${theme}`, '/?topic=t1', size, theme);
      await until(() => t.evaluate('Boolean(document.querySelector("#topics a[data-topic-id=t1]"))'), at + ': the topic rail is drawn');
      const topic = await until(async () => { const seen = await top(t); return seen.rail[0] === 'brand' && seen.rail[1] === 'outcomes-home' && seen; }, at + ': the logo block, then ← Outcomes');
      assert.deepEqual([topic.headers, topic.refresh, topic.buttons], [0, false, 0], at + ': no header bar and no Refresh on the topic page');
      assert.equal(topic.brandIn, 'rail', at + ': the logo block is in the rail');
      assert.deepEqual(topic.rail.slice(0, 3), ['brand', 'outcomes-home', 'topic-navigation'], at + ': the logo block, ← Outcomes, then the topics');
      assert.deepEqual(topic.brand, ['wordmark', 'instance-label', 'notify'], at + ': the wordmark, then the workspace name and Turn on notifications under it');
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

  await check('rail Tab from ← Outcomes reaches New topic, then the first topic', async () => {
    const p = await open('rail-tab', '/?topic=t1');
    await until(() => p.evaluate('Boolean(document.querySelector("#topics a[data-topic-id=t1]")) && !document.querySelector("#new-topic").disabled'), 'the rail is ready');
    // A press on the workspace name starts Tab there, as it would for a person.
    await p.point('#instance-label');
    const focused = () => p.evaluate('document.activeElement.id || (document.activeElement.dataset.topicId ? "topic:" + document.activeElement.dataset.topicId : document.activeElement.tagName)');
    for (let n = 0; n < 6 && await focused() !== 'outcomes-home'; ++n) await p.key('Tab');
    assert.equal(await focused(), 'outcomes-home', 'Tab reaches ← Outcomes from the logo block');
    const order = [];
    for (let n = 0; n < 2; ++n) { await p.key('Tab'); order.push(await focused()); }
    const first = await p.evaluate('"topic:" + document.querySelector("#topics a").dataset.topicId');
    assert.deepEqual(order, ['new-topic', first], 'then New topic, then the first topic');
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

  await check('rail at 390 the open topic shows whole in the strip, and a lit neighbour beside it is not cut', async () => {
    // Twelve topics, newest first in the strip; the open one is the ninth, and
    // the one after it waits on the reader.
    const ids = Array.from({ length: 12 }, (_, n) => 'rail-strip-' + String(n).padStart(2, '0'));
    for (const [n, id] of ids.entries()) {
      await control({ method: 'navigation_topics', topics: [{ id, title: 'Strip topic ' + n }] });
      if (n === 2) await control({ method: 'topic_state', operation_id: 'rail-strip-lit', topic_id: id, args: { state: 'waiting', waiting_on: [facts.actor] } });
    }
    for (const theme of ['light', 'dark']) {
      const p = await open('rail-strip-' + theme, '/?topic=' + ids[3], 'phone', theme);
      const strip = await until(() => p.evaluate(`(()=>{const s=document.getElementById('topics'),rows=[...s.children];const open=rows.find(r=>r.getAttribute('aria-current')==='page');
        if(!open||!${JSON.stringify(ids)}.every(id=>rows.some(r=>r.dataset.topicId===id)))return null;const lit=rows[rows.indexOf(open)+1],b=s.getBoundingClientRect(),o=open.getBoundingClientRect(),l=lit?.getBoundingClientRect();
        return {index:rows.indexOf(open),order:rows.map(r=>r.dataset.topicId),lit:Boolean(lit?.querySelector('.topic-state.mine')),litId:lit?.dataset.topicId,scrolled:s.scrollLeft,
          strip:[b.left,b.right],open:[o.left,o.right],neighbour:l?[l.left,l.right]:null,pageX:scrollX,scroll:document.documentElement.scrollWidth,width:innerWidth}})()`), theme + ': the strip holds every topic');
      assert.equal(strip.index, 8, theme + ': the open topic is the ninth: ' + strip.order.join(' '));
      assert.deepEqual([strip.litId, strip.lit], [ids[2], true], theme + ': the topic after it waits on the reader');
      const whole = ([left, right]) => left >= strip.strip[0] - 0.5 && right <= strip.strip[1] + 0.5;
      const settled = await until(async () => {
        const now = await p.evaluate(`(()=>{const s=document.getElementById('topics'),rows=[...s.children],open=rows.find(r=>r.getAttribute('aria-current')==='page'),lit=rows[rows.indexOf(open)+1];
          const o=open.getBoundingClientRect(),l=lit.getBoundingClientRect();return {open:[o.left,o.right],neighbour:[l.left,l.right],scrolled:s.scrollLeft}})()`);
        return whole(now.open) && whole(now.neighbour) && now;
      }, theme + ': the open topic and its lit neighbour show whole');
      assert.ok(settled.scrolled > 0, theme + ': the strip scrolled itself to the open topic');
      assert.ok(strip.pageX === 0 && strip.scroll <= strip.width, theme + `: the page itself does not scroll sideways (${strip.scroll} of ${strip.width})`);
      await shot(p, 'rail-strip-' + theme);
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
