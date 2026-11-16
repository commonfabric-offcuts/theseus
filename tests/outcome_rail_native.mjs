import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// The side rail inside an outcome and the page without a header bar (pipeline
// items 101 and 107), in the real browser against the real server, at 1280
// and 390 wide, light and dark. Every page has the logo block (the wordmark
// with its presence dot, the workspace name, the Health link and Turn on
// notifications) first in its rail, or first in its main column where it has
// no rail, with the guide's "? Pointer, keys and taps" under the name
// (docs/interaction.md), and no header
// bar or Refresh button. On a topic page and a Conversation the rail is the
// outline of every outcome (item 272, docs/rails.md): each outcome's light,
// name (its Conversation) and where it stands, its topics folded under it,
// and "N new" and "N waiting on you" across them all; moving between those
// pages loads nothing again, and the outline stays the same element with its
// folds and its scroll. The outcome's things are on the right (item 131).
// On a phone (item 117) the topic comes first and the outline folds behind
// "☰ Outcomes" at its top, which carries the total and opens it as a drawer
// over the topic. The outcome's own page has no rail. An ask to the reader
// in another outcome lights that outcome's row live; on the outcome page it
// lights "← Outcomes" when that outcome is one the reader is not on the team
// of, so its "Also waiting on you" line cannot name it.
// At 390 the drawer opens on the open topic, whole with a lit neighbour not
// cut; the dimmed page beside it, Escape and a topic in it close it. What
// Refresh did is done without it: writes elsewhere show with no
// reload, an unconfirmed state change says where the topic stands, the
// opening page follows a save made elsewhere while it holds no unsaved
// writing, and a second tab on a new outcome form opens when the first
// closes. What the keys select in the rails, on the header's buttons and back
// in the messages comes into view with a tenth of its pane beyond it (379).
// Run by reader_persistence_native.mjs with --rail; screenshots are
// kept as rail-*.png for review.
const SIZES = { laptop: { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, phone: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
  w320: { width: 320, height: 640, deviceScaleFactor: 2, mobile: true }, w375: { width: 375, height: 812, deviceScaleFactor: 2, mobile: true } };
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
  // Which document is up: its timeOrigin as first read, kept on the window (WebKit's can move 1 ms with no load).
  const loaded = p => p.evaluate('(window.documentOrigin??=performance.timeOrigin)');
  // The outline as drawn: its totals, and each outcome shown with whether it is
  // open, its count, its light, whether it is the page, where its name goes,
  // and the topics shown under it.
  const outline = p => p.evaluate(`(()=>{const shown=e=>Boolean(e)&&e.getClientRects().length>0,o=document.getElementById('outline');
    const chip=id=>{const c=document.getElementById(id);return {text:c.textContent.trim(),pressed:c.getAttribute('aria-pressed'),disabled:c.disabled}};
    return {shown:shown(o),scroll:document.getElementById('rail').scrollTop,fresh:chip('outline-only-new'),waiting:chip('outline-only-waiting'),
      outcomes:Object.fromEntries([...o.querySelectorAll('.ol-outcome')].filter(li=>!li.hidden).map(li=>{const name=li.querySelector('.ol-name'),badge=name.querySelector('.unread-count');
        return [li.dataset.workspaceId,{open:li.hasAttribute('data-open'),count:badge?Number(badge.textContent):0,lit:Boolean(name.querySelector('.outcome-light[data-light=waiting]')),
          current:name.getAttribute('aria-current'),href:name.getAttribute('href'),standing:li.querySelector('.standing')?.textContent??'',
          topics:[...li.querySelectorAll('.ol-topics a[data-topic-id]')].filter(shown).map(a=>({id:a.dataset.topicId,unread:Number(a.querySelector('.unread-count')?.textContent??0),current:a.getAttribute('aria-current')}))}]}))}})()`);
  const home = p => p.evaluate(`(()=>{const h=document.getElementById('outcomes-home'),l=h.querySelector('.outcome-light'),w=h.querySelector('.elsewhere-words');
    return {lit:Boolean(l)&&l.getClientRects().length>0,words:w&&w.getClientRects().length>0?w.textContent:null,said:w?.textContent??null,label:h.getAttribute('aria-label')}})()`);

  await check('rail no page has a header bar or Refresh; the logo block tops the rail inside an outcome and main on the outcome page and home, at 1280 and 390, light and dark', async () => {
    for (const [size, theme] of COMBOS) {
      const at = `${size} ${theme}`;
      // A topic page: the logo block, then "← Outcomes", then the outcome's topics.
      const t = await open(`rail-topic-${size}-${theme}`, '/?topic=t1', size, theme);
      await until(() => t.evaluate('Boolean(document.querySelector("#topics a[data-topic-id=t1]"))'), at + ': the topic rail is drawn');
      if (SIZES[size].mobile) {
        // On a phone the topic comes first: the outline is folded behind "☰ Outcomes" at the top of the topic.
        const folded = await until(async () => { const seen = await top(t); return seen.main[0] === 'topic-header' && seen; }, at + ': the topic heads the page');
        assert.deepEqual(folded.rail, [], at + ': the folded rail shows nothing above the topic');
        assert.equal(folded.control, true, at + ': "☰ Outcomes" is shown');
        assert.match(await t.evaluate('document.getElementById("rail-open").textContent'), /^☰ Outcomes/);
        assert.ok(folded.title < folded.height / 4, at + `: the topic's title is near the top of the screen (${folded.title} of ${folded.height})`);
        assert.ok(folded.scroll <= folded.width, at + `: no sideways scroll on the folded topic page (${folded.scroll} of ${folded.width})`);
        await shot(t, `rail-topic-${size}-${theme}-folded`);
        await tap(t, '#rail-open');
        await until(async () => (await drawer(t)).open, at + ': "☰ Outcomes" opens the outline over the topic');
      }
      const topic = await until(async () => { const seen = await top(t); return seen.rail[0] === 'brand' && seen.rail[1] === 'outline' && seen; }, at + ': the logo block, then the outline');
      if (!SIZES[size].mobile) assert.equal(topic.control, false, at + ': no "☰ Outcomes" beside the rail');
      assert.deepEqual([topic.headers, topic.refresh, topic.buttons], [0, false, 0], at + ': no header bar and no Refresh on the topic page');
      assert.equal(topic.brandIn, 'rail', at + ': the logo block is in the rail');
      assert.deepEqual(topic.rail, ['brand', 'outline'], at + ': the logo block, then the outline, and nothing else');
      const drawn = await until(async () => { const seen = await outline(t); return seen.outcomes.w1?.topics.some(row => row.id === 't1') && seen; }, at + ': the outline holds this outcome, open, with its topics');
      assert.deepEqual([drawn.outcomes.w1.open, drawn.outcomes.w1.href, drawn.outcomes.w1.topics.find(row => row.id === 't1').current], [true, '?conversation=w1', 'page'],
        at + ': the outcome being read is open, its name opens its Conversation, and the open topic is marked');
      assert.deepEqual(topic.brand, ['wordmark', 'instance-label', 'guide-open', 'health-link', 'notify'], at + ': the wordmark, then the workspace name, the guide\'s ? (docs/interaction.md) under it, the Health link and Turn on notifications');
      assert.equal(topic.dot, true, at + ': the wordmark carries its presence dot');
      assert.match(topic.name, new RegExp('^' + facts.actor + ' · '), at + ': the workspace name is filled in');
      assert.deepEqual([topic.outcomesShown, topic.railLabel], [false, 'Outcomes'], at + ': the outline stands for the old list of outcomes');
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
        await until(() => o.evaluate('document.body?.dataset.ready==="true" && location.search==="" && Boolean(document.querySelector("#workspaces a[data-workspace-id=w1]"))').catch(() => false), 'the Outcomes home opened');
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

  // Where the keys are (docs/interaction.md, "Keys across the panes"): an
  // outline row (topic:ID, name:OUTCOME, fold:OUTCOME, or outline:WHAT for the
  // rest of the outline), the right rail (things:SECTION, things:SECTION:ROW),
  // a message (message:ID), or the element's id or tag.
  const keyedAt = p => p.evaluate(`(()=>{const e=document.activeElement;if(!e||e===document.body)return 'body';const li=e.closest('.ol-outcome');
    if(e.closest('#outline')){if(e.dataset.topicId)return 'topic:'+e.dataset.topicId;if(e.classList.contains('ol-name'))return 'name:'+li.dataset.workspaceId;
      if(e.classList.contains('ol-fold'))return 'fold:'+li.dataset.workspaceId;return 'outline:'+(e.id||e.textContent.trim())}
    if(e.closest('#things')){const s=e.closest('.things-sec');return 'things:'+(s?.dataset.key??'')+(e.tagName==='SUMMARY'?'':':'+(e.getAttribute('href')??e.textContent.trim()))}
    const m=e.closest('#messages [data-id]');return m?'message:'+m.dataset.id:e.id||e.tagName.toLowerCase()})()`);
  // The outline as a tree: its role, its Tab stops, whether every row says its
  // level and place and every outcome whether it is open, that it has no fold
  // triangle, the ring on the focused row, and the rows shown.
  const keyTree = p => p.evaluate(`(()=>{const t=document.querySelector('#outline .ol-list'),shown=e=>e.checkVisibility();
    const owned=(t.getAttribute('aria-owns')??'').split(' ').filter(Boolean).map(id=>document.getElementById(id)).filter(Boolean);
    const items=[...owned,...t.querySelectorAll('[role=treeitem]')].filter(e=>shown(e)&&e.getAttribute('role')==='treeitem'),focus=document.activeElement;
    const said=e=>e.dataset.topicId?'topic:'+e.dataset.topicId:e.classList.contains('ol-name')?'name:'+e.closest('.ol-outcome').dataset.workspaceId:'outline:'+(e.id||e.textContent.trim());
    return {role:t.getAttribute('role'),stops:[...owned,...t.querySelectorAll('a[href],button,summary,input,textarea,[tabindex]')].filter(e=>shown(e)&&e.tabIndex>=0).length,
      folds:t.querySelectorAll('.ol-fold').length===0,
      named:items.length>0&&items.every(e=>['aria-level','aria-setsize','aria-posinset'].every(a=>e.hasAttribute(a))),
      names:[...t.querySelectorAll('.ol-name')].filter(shown).every(e=>['true','false'].includes(e.getAttribute('aria-expanded'))),
      ring:focus&&(t.contains(focus)||owned.includes(focus))?getComputedStyle(focus).outlineStyle:null,rows:items.map(said),
      said:t.nextElementSibling?.getAttribute('role')==='status'?t.nextElementSibling.textContent:null}})()`);
  // The outcomes shown in the outline, top to bottom.
  const outcomeOrder = p => p.evaluate(`[...document.querySelectorAll('#outline .ol-outcome')].filter(li=>!li.hidden).map(li=>li.dataset.workspaceId)`);
  // From the workspace name, Tab to the outline's one stop.
  const tabToOutline = async p => {
    // The rail may have scrolled the place being read into view, past the workspace name.
    await p.evaluate("document.getElementById('instance-label').scrollIntoView({block:'center'})");
    await p.point('#instance-label');
    for (let n = 0; n < 12 && !/^(topic|name):/.test(await keyedAt(p)); ++n) await p.key('Tab');
  };
  // Into the outline, then Home and ↓ to the row named (as keyedAt names it).
  const keysTo = async (p, row) => {
    await tabToOutline(p);
    await p.key('Home');
    const rows = (await keyTree(p)).rows;
    assert.ok(rows.includes(row), `${row} is a row of the outline: ${rows.join(' ')}`);
    for (let n = 0; n < rows.length && await keyedAt(p) !== row; ++n) await p.key('ArrowDown');
    assert.equal(await keyedAt(p), row, `↓ reaches ${row}`);
  };

  await check('rail the outline names an outcome by its light and name, which opens its Conversation; one with no conversation opens its page, and nothing moves when that read lands', async () => {
    // An outcome made before version 28, not yet given its conversation.
    await control({ method: 'older_outcome', workspace_id: 'rail-older', title: 'Older outcome', topic_id: 'rail-older-topic', topic_title: 'Older topic' });
    const t = await page('rail-conversation-none', null, true, { url: facts.origin + '/?topic=rail-older-topic', beforeNavigate: async q => {
      await q.send('Emulation.setDeviceMetricsOverride', SIZES.laptop);
      q.intercept(payload => payload?.name === 'conversation' && payload.args?.workspace_id === 'rail-older');
    } });
    await until(async () => (await outline(t)).outcomes['rail-older']?.topics.some(row => row.id === 'rail-older-topic'), 'the outline holds the outcome being read, open');
    await until(() => t.held.some(entry => entry.payload?.name === 'conversation'), 'the conversation\'s read is held');
    const where = () => t.evaluate(`(()=>{const top=s=>Math.round(document.querySelector(s).getBoundingClientRect().top);
      return {topic:top('#outline a[data-topic-id="rail-older-topic"]'),title:top('#topic-title')}})()`);
    const before = await where();
    assert.equal((await outline(t)).outcomes['rail-older'].href, '?conversation=rail-older', 'until Core says otherwise, the name opens the Conversation');
    assert.equal((await outline(t)).outcomes.w1.href, '?conversation=w1', 'another outcome\'s name opens its Conversation');
    t.intercept(null);
    for (const entry of t.held.splice(0)) await t.release(entry);
    await until(async () => (await outline(t)).outcomes['rail-older'].href === '?workspace=rail-older', 'with no conversation, the name opens the outcome\'s page');
    assert.deepEqual(await where(), before, 'the read landing moves nothing');
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

  await check('rail Tab from the logo block reaches the outline as one stop, on the topic being read: no fold triangle, the next Tab leaves it and Shift-Tab comes back', async () => {
    const p = await open('rail-tab', '/?topic=t1');
    await until(() => p.evaluate('Boolean(document.querySelector("#outline #topics a[data-topic-id=t1]")) && !document.querySelector("#new-topic").disabled'), 'the outline is ready');
    // A press on the workspace name starts Tab there, as it would for a person.
    await p.point('#instance-label');
    const order = [];
    for (let n = 0; n < 12 && !/^(topic|name):/.test(order.at(-1) ?? ''); ++n) { await p.key('Tab'); order.push(await keyedAt(p)); }
    // The Outcomes heading's pencil is a row of the outline (item 305), not a Tab stop of its own.
    assert.equal(order.at(-1), 'topic:t1', 'Tab reaches the outline on the topic being read: ' + order.join(' '));
    assert.ok(!order.includes('outline:outline-new-outcome'), 'and passes no New outcome on its way: ' + order.join(' '));
    const seen = await keyTree(p);
    assert.deepEqual([seen.role, seen.stops, seen.folds, seen.named, seen.names], ['tree', 1, true, true, true],
      'the outline is one tree with one Tab stop; each row says its level and place, each outcome whether it is open, and there is no fold triangle');
    await p.key('Tab');
    const after = await keyedAt(p);
    assert.ok(!/^(topic|name|fold):/.test(after), 'the next Tab leaves the outline: ' + after);
    await p.key('Tab', 8);
    assert.equal(await keyedAt(p), 'topic:t1', 'Shift-Tab comes back to the same row');
    assert.deepEqual(p.errors, []);
  });

  await check('rail an ask in another outcome lights its row and the waiting total live; on the outcome page an ask it cannot name lights ← Outcomes; answering clears both', async () => {
    await control({ method: 'light_outcome', outcome: 'rail-ask-o', title: 'Asking outcome', topic: { id: 'rail-ask-t', title: 'Asking topic' } });
    const p = await open('rail-light', '/?topic=t1');
    await until(async () => { const seen = await outline(p); return seen.outcomes['rail-ask-o'] && !seen.outcomes['rail-ask-o'].lit; }, 'the other outcome is listed, unlit, at first');
    const waitingBefore = parseInt((await outline(p)).waiting.text, 10);
    const before = await loaded(p);
    // An agent on its team asks the reader there, through its CLI.
    await control({ method: 'agent_message', operation_id: 'rail-ask', body: 'Which deck do we send?', topic_id: 'rail-ask-t', addressees: [facts.actor], intent: 'ask' });
    const lit = await until(async () => { const seen = await outline(p); return seen.outcomes['rail-ask-o'].lit && seen; }, 'the ask lights that outcome\'s row, live');
    assert.match(lit.outcomes['rail-ask-o'].standing, /Waiting on you/, 'its standing line says it waits on the reader');
    assert.equal(parseInt(lit.waiting.text, 10), waitingBefore + 1, 'and the waiting total counts it: ' + lit.waiting.text);
    assert.equal(lit.outcomes['rail-ask-o'].open, false, 'the outline did not open it by itself');
    assert.equal(await loaded(p), before, 'with no reload');
    await shot(p, 'rail-light-topic');
    // An ask in an outcome the reader is not on the team of cannot be listed:
    // the outcome page's ← Outcomes says it in words.
    const asked = await control({ method: 'elsewhere_ask', operation_id: 'rail-ask-elsewhere', body: 'And the cover?' });
    const o = await open('rail-light-outcome', '/?workspace=w1');
    const there = await until(async () => { const h = await home(o); return h.lit && h.words && h; }, 'the outcome page lights ← Outcomes, with its words');
    assert.match(there.words, /^\d+ other outcomes? (is|are) waiting on you$/);
    await shot(o, 'rail-light-outcome');
    // The reader answers both: the lights go, live.
    await control({ method: 'agent_message', operation_id: 'rail-answer', sender: 'person', topic_id: 'rail-ask-t', whole_topic: true, body: 'The short one.' });
    await control({ method: 'agent_message', operation_id: 'rail-answer-elsewhere', sender: 'person', topic_id: asked.topic_id, whole_topic: true, body: 'The blue one.' });
    await until(async () => (await home(o)).lit === false, 'answered, ← Outcomes goes dark on the outcome page');
    await p.send('Page.bringToFront');
    await until(async () => !(await outline(p)).outcomes['rail-ask-o'].lit, 'and the row goes dark on the topic page');
    assert.equal(await loaded(p), before, 'still with no reload');
    assert.deepEqual([...p.errors, ...o.errors], []);
  });

  await check('rail on a phone, waited on only in the outcome being read, the line under the header never says so; a wait in another outcome shows there', async () => {
    // An agent asks the reader in t1, in this outcome w1: only this outcome waits.
    await control({ method: 'agent_message', operation_id: 'rail-here-ask', body: 'Is the outline right?', topic_id: 't1', addressees: [facts.actor], intent: 'ask' });
    // Every state the line under the header is drawn in, from the page's first script on.
    const watch = `(()=>{window.lineSeen=[];const seen=()=>{const l=document.getElementById('outline-elsewhere');
      const now=l?{shown:!l.hidden,words:l.textContent}:null,last=lineSeen.at(-1);
      if(now&&JSON.stringify(now)!==JSON.stringify(last))lineSeen.push(now)};new MutationObserver(seen).observe(document,{subtree:true,childList:true,attributes:true,characterData:true})})()`;
    const p = await page('rail-here', null, true, { url: facts.origin + '/?topic=t1', beforeNavigate: async q => {
      await q.send('Emulation.setDeviceMetricsOverride', SIZES.phone);
      await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      await q.send('Page.addScriptToEvaluateOnNewDocument', { source: watch });
    } });
    await until(async () => (await outline(p)).outcomes.w1?.lit, 'the outline has read that this outcome waits');
    const loading = await p.evaluate('lineSeen.length');
    await control({ method: 'light_outcome', outcome: 'rail-here-o', title: 'Waiting elsewhere', topic: { id: 'rail-here-t', title: 'Elsewhere topic' } });
    await control({ method: 'agent_message', operation_id: 'rail-here-elsewhere', body: 'And the cover?', topic_id: 'rail-here-t', addressees: [facts.actor], intent: 'ask' });
    const line = await until(async () => { const seen = await p.evaluate('lineSeen.at(-1)'); return seen?.shown && /waiting on you/.test(seen.words) && seen; }, 'the wait elsewhere shows under the header, live');
    assert.match(line.words, /^\d+ new in \d+ other outcomes? · \d+ waiting on you›$/, 'how much is new elsewhere and what waits there: ' + line.words);
    const seen = await p.evaluate('lineSeen');
    assert.deepEqual(seen.slice(0, loading).filter(state => /waiting on you/.test(state.words)), [], 'while only this outcome waits, the line never says so: ' + JSON.stringify(seen));
    // The line opens the outline.
    await tap(p, '#outline-elsewhere');
    await until(async () => (await drawer(p)).open, 'the line opens the outline over the topic');
    // Both answered, so the checks after this one start with nothing waiting.
    await control({ method: 'agent_message', operation_id: 'rail-here-answer', sender: 'person', topic_id: 't1', whole_topic: true, body: 'Yes.' });
    await control({ method: 'agent_message', operation_id: 'rail-here-elsewhere-answer', sender: 'person', topic_id: 'rail-here-t', whole_topic: true, body: 'The blue one.' });
    await until(async () => !(await outline(p)).outcomes['rail-here-o'].lit && !(await outline(p)).outcomes.w1.lit, 'answered, the lights go');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail at 390 "☰ Outcomes" opens the outline over the topic on the open topic, whole with its lit neighbour; the dimmed page, Escape and a topic in it close it', async () => {
    // Twelve topics, newest first in the rail; the open one is the ninth, and
    // the one after it waits on the reader.
    const ids = Array.from({ length: 12 }, (_, n) => 'rail-drawer-' + String(n).padStart(2, '0'));
    for (const [n, id] of ids.entries()) {
      await control({ method: 'navigation_topics', topics: [{ id, title: 'Drawer topic ' + n }] });
      if (n === 2) await control({ method: 'topic_state', operation_id: 'rail-drawer-lit', topic_id: id, args: { state: 'waiting', waiting_on: [facts.actor] } });
    }
    for (const theme of ['light', 'dark']) {
      const p = await open('rail-drawer-' + theme, '/?topic=' + ids[3], 'phone', theme);
      // Every topic, in the outline under its outcome (shown once the outline has drawn the outcomes above it).
      await until(() => p.evaluate(`${JSON.stringify(ids)}.every(id => document.querySelector('#outline #topics > a[data-topic-id="' + id + '"]'))`), theme + ': the rail holds every topic');
      const { focus: _unused, ...folded } = await drawer(p);
      assert.deepEqual(folded, { open: false, backdrop: false, inert: false, expanded: 'false' }, theme + ': folded as the page opens');
      await tap(p, '#rail-open');
      await until(async () => (await drawer(p)).open, theme + ': "☰ Outcomes" opens it');
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
      assert.deepEqual(seen.flash, ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'], theme + ': a tap on "☰ Outcomes" or the dimmed page leaves no highlight over the drawer');
      const whole = ([top, bottom]) => top >= seen.drawer[2] - 0.5 && bottom <= seen.drawer[3] + 0.5;
      assert.ok(whole(seen.row) && whole(seen.neighbour), theme + ': the open topic and its lit neighbour show whole: ' + JSON.stringify(seen));
      assert.ok(seen.room > 0 && seen.scrolled > 0, theme + `: the drawer scrolled itself to the open topic (${seen.scrolled} of ${seen.room})`);
      assert.ok(seen.pageX === 0 && seen.pageY === 0 && seen.scroll <= seen.width, theme + `: the page itself did not scroll (${seen.pageX}, ${seen.pageY}; ${seen.scroll} of ${seen.width})`);
      await shot(p, 'rail-drawer-' + theme);
      // A tap on the dimmed page beside it closes it, and "☰ Outcomes" has the focus back.
      await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: seen.width - 12, y: seen.height / 2 }] });
      await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await until(async () => !(await drawer(p)).open, theme + ': the dimmed page closes it');
      assert.deepEqual(await drawer(p), { open: false, backdrop: false, inert: false, expanded: 'false', focus: 'control' }, theme + ': closed, the focus back on "☰ Outcomes"');
      // Escape closes it too.
      await tap(p, '#rail-open'); await until(async () => (await drawer(p)).open, theme + ': open again');
      await p.key('Escape');
      await until(async () => !(await drawer(p)).open, theme + ': Escape closes it');
      assert.equal((await drawer(p)).focus, 'control', theme + ': the focus back on "☰ Outcomes"');
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

  // The pencils of the outline as drawn (item 305): the Outcomes heading's, and each outcome's shown, with
  // what shows of it (its opacity), its box against its row's name and the rail, its name and tooltip,
  // whether its title line is open, and whether its glyph is New message's.
  const pencils = p => p.evaluate(`(()=>{const glyph=document.querySelector('#new-message svg path')?.getAttribute('d'),rail=document.getElementById('rail').getBoundingClientRect();
    const seen=(e,name)=>{if(!e)return null;const b=e.getBoundingClientRect(),n=name?.getBoundingClientRect();
      return {shown:Number(getComputedStyle(e).opacity),width:Math.round(b.width),height:Math.round(b.height),label:e.getAttribute('aria-label'),tip:e.title,
        expanded:e.getAttribute('aria-expanded'),glyph:Boolean(glyph)&&e.querySelector('svg path')?.getAttribute('d')===glyph,
        inRail:b.left>=rail.left-0.5&&b.right<=rail.right+0.5,besideName:n?b.left>=n.right-0.5&&b.top<n.bottom&&b.bottom>n.top:null}};
    return {heading:seen(document.getElementById('outline-new-outcome')),
      outcomes:Object.fromEntries([...document.querySelectorAll('#outline .ol-outcome')].filter(li=>!li.hidden).map(li=>[li.dataset.workspaceId,seen(li.querySelector('.ol-new-topic'),li.querySelector('.ol-name'))])),
      plusRows:[...document.querySelectorAll('#outline button,#outline a')].filter(e=>e.getClientRects().length&&/^\\+?\\s*New topic$/.test(e.textContent.trim())).length,
      pageButton:document.getElementById('new-topic').getClientRects().length>0}})()`);
  await check('rail at 320, 375 and 390 the pencil beside the outcome in the open drawer always shows, 44px, and one tap shows the New topic title line, focused, in the drawer, opening and folding nothing; an empty Return is refused in plain words; Escape closes the line, and Return starts the topic', async () => {
    for (const [width, theme] of [[320, 'light'], [320, 'dark'], [375, 'light'], [375, 'dark'], [390, 'light'], [390, 'dark']]) {
      const at = `${width} ${theme}`;
      const p = await page('rail-new-topic-' + width + '-' + theme, null, true, { url: facts.origin + '/?topic=t1', beforeNavigate: async q => {
        await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await q.send('Emulation.setDeviceMetricsOverride', { ...SIZES.phone, width });
        await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      } });
      await until(() => p.evaluate('Boolean(document.querySelector("#topics a[data-topic-id=t1]")) && Boolean(document.querySelector("#outline .ol-outcome[data-workspace-id=w1]"))'), at + ': the rail is ready');
      await tap(p, '#rail-open');
      await until(async () => (await drawer(p)).open, at + ': "☰ Outcomes" opens it');
      // On a phone every pencil shows, at least 44px, beside its outcome's name and inside the drawer; no + New topic row is left.
      const drawn = await pencils(p), titles = Object.fromEntries((await view('workspaces', { limit: 100 })).items.map(item => [item.id, item.title]));
      assert.ok(drawn.outcomes.w1 && drawn.heading, at + ': the outcome being read and the Outcomes heading each have a pencil: ' + JSON.stringify(drawn));
      for (const [id, pen] of [['heading', drawn.heading], ...Object.entries(drawn.outcomes)]) {
        assert.deepEqual([pen.shown, pen.width >= 44, pen.height >= 44, pen.glyph, pen.inRail], [1, true, true, true, true], `${at}: ${id}'s pencil always shows, 44px, New message's glyph, in the drawer: ${JSON.stringify(pen)}`);
        if (id !== 'heading') assert.deepEqual([pen.besideName, pen.label, pen.tip], [true, `New topic in ${titles[id]}`, 'New topic'], `${at}: ${id}'s pencil sits beside its name, named and with its tooltip: ${JSON.stringify(pen)}`);
      }
      assert.deepEqual([drawn.heading.label, drawn.heading.tip], ['New outcome', 'New outcome'], at + ': the heading\'s pencil is New outcome');
      assert.deepEqual([drawn.plusRows, drawn.pageButton], [0, false], at + ': no + New topic row is left in the outline, nor the page\'s own New topic');
      // One tap: the line shows in the open drawer, under the outcome's row, with the focus in it; the outcome stays open and the page stays.
      const line = () => p.evaluate(`(()=>{const l=document.getElementById('ol-new-topic-w1'),r=document.getElementById('rail'),b=l?.getBoundingClientRect(),d=r.getBoundingClientRect(),row=document.querySelector('.ol-outcome[data-workspace-id=w1] .ol-row');
        return {shown:Boolean(l)&&l.getClientRects().length>0&&b.top>=d.top&&b.bottom<=d.bottom&&b.left>=d.left&&b.right<=d.right,focused:document.activeElement===l,open:r.classList.contains('open'),active:document.activeElement?.id??null,
          underRow:Boolean(l)&&row.nextElementSibling===l.closest('.one-line')}})()`);
      const place = () => p.evaluate(`({search:location.search,open:document.querySelector('.ol-outcome[data-workspace-id=w1]').hasAttribute('data-open')})`);
      const tapped = () => until(() => p.evaluate('document.getElementById("ol-pencil-w1").getAttribute("aria-expanded")==="true"'), at + ': the tap reached the pencil');
      const before = await place();
      await p.evaluate('document.getElementById("ol-pencil-w1").scrollIntoView({block:"center"})');
      await tap(p, '#ol-pencil-w1'); await tapped();
      assert.deepEqual(await line(), { shown: true, focused: true, open: true, active: 'ol-new-topic-w1', underRow: true }, at + ': one tap shows the line, focused, under the outcome, in the open drawer');
      assert.deepEqual(await place(), before, at + ': the tap opened and folded nothing, and the page stayed');
      const seen = await p.evaluate('({scroll:document.documentElement.scrollWidth,width:innerWidth})');
      assert.ok(seen.scroll <= seen.width, at + `: no sideways scroll (${seen.scroll} of ${seen.width})`);
      await shot(p, `rail-new-topic-${width}-${theme}`);
      // Refused: Return with no title says so in plain words, keeps the line, and nothing scrolls sideways.
      await p.key('Enter');
      await until(() => p.evaluate(`document.querySelector('#ol-new-topic-w1 + .one-line-state')?.textContent==='Type the topic’s title, then press Return.'`), at + ': an empty Return is refused in plain words');
      const refused = await p.evaluate(`(()=>{const s=document.querySelector('#ol-new-topic-w1 + .one-line-state'),b=s.getBoundingClientRect(),d=document.getElementById('rail').getBoundingClientRect();
        return {inRail:b.left>=d.left&&b.right<=d.right,scroll:document.documentElement.scrollWidth<=innerWidth,focused:document.activeElement?.id}})()`);
      assert.deepEqual(refused, { inRail: true, scroll: true, focused: 'ol-new-topic-w1' }, at + ': the refusal shows in the drawer, the line keeps the focus, nothing scrolls sideways');
      await shot(p, `rail-new-topic-refused-${width}-${theme}`);
      // Escape closes the line and gives the pencil the focus; the drawer stays open.
      await p.key('Escape');
      await until(() => p.evaluate('!document.getElementById("ol-new-topic-w1")'), at + ': Escape closes the line');
      assert.deepEqual(await drawer(p), { open: true, backdrop: true, inert: true, expanded: 'true', focus: 'ol-pencil-w1' }, at + ': the drawer stays open, the focus on the pencil');
      if (width === 390) {
        // Again, and Return starts the topic: it opens first on the page, the drawer folded.
        await tap(p, '#ol-pencil-w1'); await tapped();
        assert.deepEqual(await line(), { shown: true, focused: true, open: true, active: 'ol-new-topic-w1', underRow: true }, at + ': the line again');
        const title = 'Started from the drawer ' + theme;
        await p.send('Input.insertText', { text: title }); await p.key('Enter');
        await until(() => p.evaluate(`document.body.dataset.ready==="true" && new URL(location.href).searchParams.has("topic") && document.querySelector("#topic-title").textContent===${JSON.stringify(title)}`).catch(() => false), at + ': the new topic opens');
        const id = await p.evaluate('new URL(location.href).searchParams.get("topic")');
        assert.equal((await view('topic', { topic_id: id })).topic.workspace_id, 'w1', at + ': the topic is in the outcome whose pencil was tapped');
        const after = await top(p);
        assert.deepEqual([(await drawer(p)).open, after.rail, after.main[0]], [false, [], 'topic-header'], at + ': with the rail folded and the new topic first');
        await shot(p, 'rail-new-topic-started-' + theme);
      }
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

  // ---- Moving in place (item 272) and the outcome's things (item 131) ----
  // The rail's scroll, its folds, the window and the outline element itself
  // are what a load would lose; each move below keeps them.
  const placeOf = p => p.evaluate(`({search:location.search,title:document.getElementById('topic-title').textContent,ready:document.body.dataset.ready==='true',
    origin:(window.documentOrigin??=performance.timeOrigin),same:window.railKept===document.getElementById('outline'),mark:window.railMark,history:history.length})`);
  const arrived = (p, search, title, what) => until(async () => { const at = await placeOf(p); return at.ready && at.search === search && (title === null || at.title === title) && at; }, what);

  await check('rail outcome to topic to Conversation and back moves in place: the outline stays the same element with its scroll, tidied to the place reached, the address follows, and back, forward and reload work', async () => {
    await control({ method: 'light_outcome', outcome: 'rail-move-o', title: 'Moving outcome', topic: { id: 'rail-move-t', title: 'Moving topic' } });
    const p = await page('rail-move', null, true, { url: facts.origin + '/?topic=t1', beforeNavigate: async q => {
      await q.send('Emulation.setDeviceMetricsOverride', { ...SIZES.laptop, height: 420 });
    } });
    await until(async () => (await outline(p)).outcomes['rail-move-o'], 'the outline lists the other outcome');
    const start = await placeOf(p);
    await p.evaluate("(window.railKept=document.getElementById('outline'),window.railMark='this window')");
    const opens = async () => Object.entries((await outline(p)).outcomes).filter(([, row]) => row.open).map(([id]) => id);
    assert.deepEqual(await opens(), ['w1'], 'only the outcome being read is open');
    assert.equal(await p.evaluate("document.querySelectorAll('#outline .ol-fold, #outline .ol-fold-all').length"), 0, 'no fold triangle, no Fold all');
    // A press on the other outcome's line that says where it stands (the whole row is one thing to press)
    // opens its Conversation and its topics, and folds the outcome before.
    await p.evaluate(`document.querySelector('.ol-outcome[data-workspace-id="rail-move-o"] .ol-name').scrollIntoView({block:'center'})`);
    await p.point('.ol-outcome[data-workspace-id="rail-move-o"] .ol-name .standing');
    const conversation = await arrived(p, '?conversation=rail-move-o', null, 'the Conversation opens');
    assert.deepEqual([conversation.origin, conversation.same, conversation.mark], [start.origin, true, 'this window'], 'in place: no load, the same outline element, the same window');
    await until(async () => (await outline(p)).outcomes['rail-move-o'].topics.some(row => row.id === 'rail-move-t'), 'its topics show under it');
    assert.deepEqual(await opens(), ['rail-move-o'], 'and every other outcome is folded');
    assert.equal((await outline(p)).outcomes['rail-move-o'].current, 'page', 'its name is marked as the page');
    const room = await p.evaluate("(()=>{document.querySelector('#outline a[data-topic-id=\"rail-move-t\"]').scrollIntoView({block:'center'});return document.getElementById('rail').scrollTop})()");
    assert.ok(room > 0, 'the rail scrolls at this height');
    await p.point('#outline a[data-topic-id="rail-move-t"]');
    const there = await arrived(p, '?topic=rail-move-t', 'Moving topic', 'the topic opens');
    assert.deepEqual([there.origin, there.same], [start.origin, true], 'in place');
    const after = await outline(p);
    assert.deepEqual([after.scroll, after.outcomes['rail-move-o'].open, after.outcomes.w1.open], [room, true, false], 'its scroll kept, its outcome open, the other still folded');
    await until(async () => (await outline(p)).outcomes['rail-move-o'].topics.find(row => row.id === 'rail-move-t')?.current === 'page', 'the open topic is marked');
    await shot(p, 'rail-move-topic');
    // Back, back, forward: each in place, each tidying the outline to the place reached.
    await p.evaluate('history.back()');
    assert.equal((await arrived(p, '?conversation=rail-move-o', null, 'back to the Conversation')).origin, start.origin);
    await p.evaluate('history.back()');
    assert.equal((await arrived(p, '?topic=t1', null, 'back to where it started')).origin, start.origin);
    await until(async () => JSON.stringify(await opens()) === JSON.stringify(['w1']), 'back where it started, only its outcome is open again');
    await p.evaluate('history.forward()');
    const forward = await arrived(p, '?conversation=rail-move-o', null, 'forward to the Conversation');
    assert.deepEqual([forward.origin, forward.same], [start.origin, true], 'in place');
    await until(async () => JSON.stringify(await opens()) === JSON.stringify(['rail-move-o']), 'forward, only that outcome is open');
    // A reload is a load like any other: the outline starts tidy, on the place reached.
    await p.send('Page.reload');
    const reloaded = await until(async () => { const at = await placeOf(p).catch(() => null); return at?.ready && at.origin !== start.origin && at; }, 'the page loads again');
    assert.equal(reloaded.search, '?conversation=rail-move-o');
    await until(async () => { const seen = await outline(p); return seen.outcomes['rail-move-o']?.topics.length && seen.outcomes.w1 && JSON.stringify(await opens()) === JSON.stringify(['rail-move-o']); }, 'after a reload only the outcome being read is open');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // The rail keeps its scroll through the move itself, wherever it is scrolled: here a few lines from its end, so a
  // part above the outline that grew shorter for a moment (the logo block drawn again without the guide's ? until
  // the next run puts it back) would pull the scroll up to the rail's new end, and the browser's scroll anchoring
  // would then carry it on past where it was. The order is held: the page's own list is under its outcome, the rails
  // are quiet, and the rail stands 12px from its end before the press.
  await check('rail the outline keeps its scroll when it moves in place to a topic, scrolled near the rail\'s end, and the guide\'s ? still opens the guide', async () => {
    // The outcome of the check before, so the outline holds no row more for the checks after this one.
    await control({ method: 'light_outcome', outcome: 'rail-move-o', title: 'Moving outcome', topic: { id: 'rail-move-t', title: 'Moving topic' } });
    const p = await page('rail-keep', null, true, { url: facts.origin + '/?conversation=rail-move-o', beforeNavigate: async q => {
      await q.send('Emulation.setDeviceMetricsOverride', { ...SIZES.laptop, height: 420 });
    } });
    const link = '#outline .ol-outcome[data-workspace-id="rail-move-o"] .ol-adopted a[data-topic-id="rail-move-t"]';
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(link)})?.getClientRects().length) && !document.documentElement.hasAttribute('data-rails-reading')`), 'the page\'s own list is under its outcome, and the rails are quiet');
    // Outcomes listed below this one (earlier checks add them) push its topic further from the rail's end: the
    // window is made tall enough to show the topic with the rail 12px from its end.
    const tall = await p.evaluate(`(()=>{const r=document.getElementById('rail'),t=document.querySelector(${JSON.stringify(link)});
      return Math.ceil(r.scrollHeight-12-(t.getBoundingClientRect().top-r.getBoundingClientRect().top+r.scrollTop)+8)})()`);
    if (tall > 420) {
      await p.send('Emulation.setDeviceMetricsOverride', { ...SIZES.laptop, height: tall });
      await until(() => p.evaluate(`innerHeight===${tall}`), 'the window is tall enough');
    }
    const room = await p.evaluate(`(()=>{const r=document.getElementById('rail'),t=document.querySelector(${JSON.stringify(link)});
      r.scrollTop=r.scrollHeight-r.clientHeight-12;
      const a=t.getBoundingClientRect(),b=r.getBoundingClientRect();return a.top>=b.top&&a.bottom<=b.bottom?r.scrollTop:-1})()`);
    assert.ok(room > 0, 'the rail scrolls at this height, with the topic in view');
    assert.equal(await p.evaluate("(r=>r.scrollHeight-r.clientHeight-r.scrollTop)(document.getElementById('rail'))"), 12, 'and stands 12px from its end');
    await p.point(link);
    await until(async () => await p.evaluate(`location.search==='?topic=rail-move-t' && document.body.dataset.ready==='true' && Boolean(document.querySelector(${JSON.stringify(link)})) && !document.querySelector(${JSON.stringify(link)}).closest('[inert]')`), 'the topic opens in place, its own list under its outcome');
    assert.equal(await p.evaluate("document.getElementById('rail').scrollTop"), room, 'the outline\'s scroll is where it was');
    // The guide's ? that stood in the logo block through the move is the new page's own: one, and a press opens the guide.
    assert.equal(await p.evaluate("document.querySelectorAll('#rail .brand .guide-open').length"), 1, 'one guide\'s ?');
    await p.evaluate("document.getElementById('rail').scrollTop=0");
    await p.point('#rail .brand .guide-open');
    await until(() => p.evaluate("Boolean(document.querySelector('dialog.interaction-guide')?.open)"), 'a press on it opens the guide');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail a new message raises a folded outcome\'s count and the new total live; open, the row counts only its Conversation; reading the topic lowers them', async () => {
    await control({ method: 'light_outcome', outcome: 'rail-count-o', title: 'Counting outcome', topic: { id: 'rail-count-t', title: 'Counting topic' } });
    const p = await open('rail-count', '/?topic=t1');
    const first = await until(async () => { const seen = await outline(p); return seen.outcomes['rail-count-o'] && seen; }, 'the outline lists the outcome');
    assert.equal(first.outcomes['rail-count-o'].open, false, 'an outcome not being read starts folded');
    const before = await loaded(p), count = first.outcomes['rail-count-o'].count, total = parseInt(first.fresh.text, 10);
    await control({ method: 'agent_message', operation_id: 'rail-count-1', sender: 'fixture-notebook-agent', topic_id: 'rail-count-t', body: 'A new line in the counting topic' });
    const raised = await until(async () => { const seen = await outline(p); return seen.outcomes['rail-count-o'].count === count + 1 && seen; }, 'the folded outcome counts the new message, live');
    assert.equal(parseInt(raised.fresh.text, 10), total + 1, 'and so does the new total');
    assert.deepEqual(Object.keys(raised.outcomes), Object.keys(first.outcomes), 'nothing moved: the outcomes keep their order');
    assert.equal(await loaded(p), before, 'with no reload');
    // Opened from the keys (⌘→), the outcome's own row counts only its Conversation; the topic row counts the topic.
    await keysTo(p, 'name:rail-count-o');
    await p.key('ArrowRight', 4);
    const opened = await until(async () => { const seen = await outline(p); const row = seen.outcomes['rail-count-o']; return row.topics.some(topic => topic.id === 'rail-count-t' && topic.unread === count + 1) && seen; }, 'open, the topic row counts its unread');
    assert.equal(opened.outcomes['rail-count-o'].count, 0, 'and the outcome row counts only its Conversation, which has nothing new');
    // Reading the topic lowers both.
    await p.point('#outline a[data-topic-id="rail-count-t"]');
    await arrived(p, '?topic=rail-count-t', 'Counting topic', 'the topic opens in place');
    const read = await until(async () => { const seen = await outline(p); const row = seen.outcomes['rail-count-o'].topics.find(topic => topic.id === 'rail-count-t'); return row && row.unread === 0 && parseInt(seen.fresh.text, 10) <= total - count && seen; }, 'read, its count goes, and the total drops by it');
    assert.equal(read.outcomes['rail-count-o'].topics.find(topic => topic.id === 'rail-count-t').current, 'page');
    assert.equal(await loaded(p), before, 'still with no reload');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail the right rail shows the topic\'s things on a topic, the whole outcome one tap away, and the outcome\'s on its Conversation; an empty section says so or hides', async () => {
    await control({ method: 'agent_message', operation_id: 'rail-things-links', sender: 'fixture-notebook-agent', topic_id: 't1',
      body: 'The fix is [Sort species by common name](https://github.com/acme/field/pull/12); try it at http://bench.example.ts.net:5192/preview/species.' });
    const p = await open('rail-things', '/?topic=t1');
    const things = () => p.evaluate(`(()=>{const t=document.getElementById('things'),shown=e=>Boolean(e)&&e.getClientRects().length>0;
      return {shown:shown(t),heading:t.querySelector('h2').textContent,chips:shown(t.querySelector('.things-scope'))?[...t.querySelectorAll('.things-scope .chip')].map(c=>c.textContent+':'+c.getAttribute('aria-pressed')):[],
        name:t.querySelector('.things-name').textContent,sections:[...t.querySelectorAll('.things-sec')].filter(shown).map(d=>d.dataset.key),
        prs:[...t.querySelectorAll('[data-key=prs] a.row')].map(a=>a.firstChild.textContent+' '+a.getAttribute('href')),
        previews:[...t.querySelectorAll('[data-key=previews] a.row')].map(a=>a.getAttribute('href')),
        tools:t.querySelector('[data-key=tools] .things-body')?.textContent??'',busy:t.querySelector('.things-sections').getAttribute('aria-busy')==='true'}})()`);
    const topic = await until(async () => { const seen = await things(); return seen.prs.length && seen; }, 'the right rail lists the pull request posted in the topic');
    assert.equal(topic.shown, true, 'beside the page at 1280');
    assert.deepEqual([topic.heading, topic.chips], ['In this topic', ['Just this topic:true', 'All of this outcome:false']], 'a topic shows its own things, the whole outcome one tap away');
    assert.deepEqual(topic.prs, ['Sort species by common name https://github.com/acme/field/pull/12'], 'the pull request by the words it was posted with');
    assert.deepEqual(topic.previews, ['http://bench.example.ts.net:5192/preview/species'], 'the preview by its address');
    assert.equal(topic.tools, 'Skills and tools are not recorded yet.', 'what Core does not record is said, not made up');
    assert.ok(!topic.sections.includes('pipeline'), 'a topic with nothing in the pipeline shows no Pipeline section');
    await shot(p, 'rail-things-topic');
    await p.point('#things .things-scope .chip:nth-child(2)');
    const whole = await until(async () => { const seen = await things(); return seen.heading === 'This outcome' && !seen.busy && seen; }, 'All of this outcome shows the outcome\'s things');
    assert.match(whole.name, /›$/, 'with the outcome\'s name, a link to its page');
    assert.ok(whole.sections.includes('pipeline'), 'the outcome says whether it has a pipeline');
    // On the Conversation the rail shows the outcome's, with no chips.
    await p.point('.ol-outcome[data-workspace-id="w1"] .ol-name');
    await arrived(p, '?conversation=w1', null, 'the Conversation opens in place');
    // Its own things, once they are read: until then the rail shows nothing of the topic it left.
    const conversation = await until(async () => { const seen = await things(); return seen.heading === 'This outcome' && seen.chips.length === 0 && !seen.busy && seen; }, 'the Conversation shows the outcome\'s things');
    assert.ok(conversation.prs.length >= 1, 'the outcome\'s pull requests, from its topics too');
    await shot(p, 'rail-things-conversation');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail a send under way keeps the page where it is, in place; unsent writing is saved as the page moves and is there on coming back', async () => {
    await control({ method: 'navigation_topics', topics: [{ id: 'rail-leave-t', title: 'Leaving topic' }] });
    const p = await open('rail-leave', '/?topic=t1');
    await until(() => p.evaluate('Boolean(document.querySelector("#outline a[data-topic-id=rail-leave-t]")) && Boolean(document.getElementById("inline-writing-body"))'), 'the outline and the writing box are ready');
    const start = await placeOf(p);
    await p.evaluate("window.railKept=document.getElementById('outline')");
    // A send held on its way: leaving now would lose track of it, so the page stays.
    p.intercept(payload => payload?.kind === 'message.send');
    const writeHere = () => p.evaluate("document.getElementById('inline-writing-body').scrollIntoView({block:'center'})");
    await writeHere(); await p.point('#inline-writing-body'); await p.send('Input.insertText', { text: 'Sent while the page tries to leave' });
    await p.evaluate("document.getElementById('inline-send').scrollIntoView({block:'center'})"); await p.point('#inline-send');
    await until(() => p.held.some(entry => entry.payload?.kind === 'message.send'), 'the send is on its way');
    await p.point('#outline a[data-topic-id="rail-leave-t"]');
    await until(() => p.evaluate("document.getElementById('topic-navigation-status').textContent.includes('Wait for the send to finish')"), 'the page says why it stays');
    const stayed = await placeOf(p);
    assert.deepEqual([stayed.search, stayed.origin, stayed.history, stayed.same], ['?topic=t1', start.origin, start.history, true], 'the address, the page and its history as they were');
    p.intercept(null);
    for (const entry of p.held.splice(0)) await p.release(entry);
    await until(() => p.evaluate("document.getElementById('messages').textContent.includes('Sent while the page tries to leave')"), 'the send lands');
    // Writing not sent yet goes with the page as it moves, and is there on coming back.
    await writeHere(); await p.point('#inline-writing-body'); await p.send('Input.insertText', { text: 'Kept for later' });
    await p.point('#outline a[data-topic-id="rail-leave-t"]');
    const moved = await arrived(p, '?topic=rail-leave-t', 'Leaving topic', 'with the send done, the page moves');
    assert.deepEqual([moved.origin, moved.same], [start.origin, true], 'in place');
    await p.evaluate('history.back()');
    await arrived(p, '?topic=t1', null, 'back');
    await until(() => p.evaluate("(document.getElementById('inline-writing-body').value ?? document.getElementById('inline-writing-body').textContent).includes('Kept for later')"), 'the unsent writing is there');
    assert.equal((await placeOf(p)).origin, start.origin, 'all in place');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail at 390 and 900 the outcome\'s things open from "Pipeline & pages": a sheet from the bottom on a phone, a panel from the right between; Escape and the dimmed page close them', async () => {
    for (const [width, height, kind] of [[390, 844, 'sheet'], [900, 800, 'panel']]) {
      const p = await page('rail-sheet-' + width, null, true, { url: facts.origin + '/?topic=t1', beforeNavigate: async q => {
        await q.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: width < 761 });
        if (width < 761) await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      } });
      const state = () => p.evaluate(`(()=>{const t=document.getElementById('things'),b=t.getBoundingClientRect(),c=document.getElementById('things-open');
        return {open:document.documentElement.hasAttribute('data-things-open'),visible:getComputedStyle(t).visibility==='visible',box:[Math.round(b.left),Math.round(b.right),Math.round(b.top),Math.round(b.bottom)],
          control:Boolean(c)&&c.getClientRects().length>0,expanded:c?.getAttribute('aria-expanded'),backdrop:!document.getElementById('things-backdrop').hidden,focus:document.activeElement?.id??null,
          scroll:document.documentElement.scrollWidth,width:innerWidth,height:innerHeight}})()`);
      await until(async () => (await state()).control, width + ': "Pipeline & pages" is in the header');
      const closed = await state();
      assert.deepEqual([closed.open, closed.visible, closed.backdrop], [false, false, false], width + ': closed at first');
      assert.ok(closed.scroll <= closed.width, width + ': no sideways scroll');
      if (width < 761) await tap(p, '#things-open'); else await p.point('#things-open');
      const shown = await until(async () => { const seen = await state(); return seen.open && seen.visible && (kind === 'sheet' ? seen.box[3] === seen.height && seen.box[2] > 0 : seen.box[1] === seen.width && seen.box[2] === 0) && seen; }, width + ': it opens as a ' + kind);
      assert.deepEqual([shown.expanded, shown.backdrop, shown.focus], ['true', true, 'things-close'], width + ': over the dimmed page, the focus on its ✕');
      await shot(p, 'rail-things-' + kind);
      await p.key('Escape');
      await until(async () => !(await state()).open, width + ': Escape closes it');
      assert.equal((await state()).focus, 'things-open', width + ': the focus back on "Pipeline & pages"');
      await until(() => p.evaluate("getComputedStyle(document.getElementById('things')).visibility==='hidden'"), width + ': it has gone out of the way');
      if (width < 761) await tap(p, '#things-open'); else await p.point('#things-open');
      await until(async () => (await state()).open, width + ': open again');
      // The dimmed page, where the things do not cover it: its top left corner.
      for (const type of ['mousePressed', 'mouseReleased']) await p.send('Input.dispatchMouseEvent', { type, x: 12, y: 12, button: 'left', clickCount: 1 });
      await until(async () => !(await state()).open, width + ': the dimmed page closes it');
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // ---- Moves that overlap: each rail is the current address's, as a fresh load draws it ----
  // What both rails show, read from the page as drawn: where the page's own
  // topic list sits in the outline (and how many there are), which topic and
  // which outcome name are marked as the page, the topics under the outcome
  // being read, and the right rail's heading, name, chips, sections and its
  // line for nothing.
  const rails = p => p.evaluate(`(()=>{const shown=e=>Boolean(e)&&e.getClientRects().length>0,o=document.getElementById('outline'),t=document.getElementById('things');
    const lists=[...document.querySelectorAll('#topic-navigation')],list=o.querySelector('#topic-navigation'),holder=list?.closest('.ol-outcome')?.dataset.workspaceId??null;
    const under=holder?[...o.querySelectorAll('.ol-outcome[data-workspace-id="'+holder+'"] .ol-topics a[data-topic-id]')].filter(shown).map(a=>a.dataset.topicId):[];
    const nothing=t.querySelector('.things-empty');
    return {search:location.search,lists:lists.length,holder,under,
      currentTopics:[...o.querySelectorAll('a[data-topic-id][aria-current=page]')].filter(shown).map(a=>a.closest('.ol-outcome').dataset.workspaceId+'/'+a.dataset.topicId),
      currentNames:[...o.querySelectorAll('.ol-name[aria-current=page]')].map(a=>a.closest('.ol-outcome').dataset.workspaceId),
      things:{heading:t.querySelector('h2').textContent,name:t.querySelector('.things-name').textContent,
        chips:shown(t.querySelector('.things-scope'))?[...t.querySelectorAll('.things-scope .chip')].map(c=>c.textContent+':'+c.getAttribute('aria-pressed')):[],
        sections:[...t.querySelectorAll('.things-sec')].filter(shown).map(d=>d.dataset.key),nothing:shown(nothing)?nothing.textContent:null}}})()`);
  // Up, with nothing more on its way: the page, both rails' reads, and the page's own list in the outline.
  const settled = (p, what) => until(() => p.evaluate(`document.body?.dataset.ready==='true' && !document.documentElement.hasAttribute('data-rails-reading')
    && document.querySelector('#things .things-sections')?.getAttribute('aria-busy')!=='true' && Boolean(document.querySelector('#outline #topic-navigation'))`).catch(() => false), what);
  // A reload, waited out on the new document.
  const reloaded = async (p, what) => {
    const before = (await placeOf(p)).origin;
    await p.send('Page.reload');
    await until(async () => (await placeOf(p).catch(() => null))?.origin > before, what + ': a new document');
    await settled(p, what);
  };
  // The same address loaded fresh in a page of its own: what both rails show there.
  const fresh = async (search, name) => {
    const q = await page(name, null, true, { url: facts.origin + '/' + search, beforeNavigate: async r => { await r.send('Emulation.setDeviceMetricsOverride', SIZES.laptop); } });
    await settled(q, 'the fresh load of ' + search + ' is up');
    const seen = await rails(q);
    assert.deepEqual(q.errors, []); await q.close();
    return seen;
  };
  const readClass = event => event.request.headers?.['X-AIM-Read-Class'] ?? event.request.headers?.['x-aim-read-class'] ?? null;
  // The outline's own reads are the foreground reads of an outcome's Conversation; the
  // right rail's first is the background read of the pipeline; the page's start waits on its topic.
  const outlineRead = (payload, event) => payload?.name === 'conversation' && readClass(event) === 'foreground';
  const thingsRead = (payload, event) => payload?.name === 'pipeline' && readClass(event) === 'background';
  const startRead = topicId => (payload, event) => payload?.name === 'topic' && payload.args?.topic_id === topicId && readClass(event) === null;
  // A press on what the selector names, brought into view in its rail first.
  const press = async (p, selector) => { await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`); await p.point(selector); };
  const releaseAll = async (p, which) => { for (const entry of p.held.filter(entry => which(entry.payload, entry.event))) { p.held.splice(p.held.indexOf(entry), 1); await p.release(entry); } };

  await check('rail back and forward across outcomes while the page before is still reading: both rails always show the address as a fresh load does', async () => {
    await control({ method: 'light_outcome', outcome: 'rail-overlap-o', title: 'Overlapping outcome', topic: { id: 'rail-overlap-t', title: 'Overlapping topic' } });
    await control({ method: 'light_outcome', outcome: 'rail-overlap-noise', title: 'Noise outcome', topic: { id: 'rail-overlap-noise-t', title: 'Noise topic' } });
    const conversationTopic = async workspace => (await view('conversation', { workspace_id: workspace })).conversation.topic_id;
    const w1Conversation = await conversationTopic('w1'), otherConversation = await conversationTopic('rail-overlap-o');
    const p = await page('rail-overlap', null, true, { url: facts.origin + '/?conversation=w1', beforeNavigate: async q => { await q.send('Emulation.setDeviceMetricsOverride', SIZES.laptop); } });
    await settled(p, 'the Conversation is up');
    const start = await placeOf(p);
    await p.evaluate(`document.querySelector('#outline a[data-topic-id="t1"]').scrollIntoView({block:'center'})`);
    await p.point('#outline a[data-topic-id="t1"]');
    await arrived(p, '?topic=t1', null, 'the topic opens in place');
    await settled(p, 'the topic is up');
    let noise = 0;
    // One move made while the page it leaves is still reading for the outline,
    // and before the page it reaches is up: the read the page left lands then.
    // Then, with the right rail's first read held, the page reached is up.
    const overlapping = async (act, search, topicId, what) => {
      await settled(p, 'before ' + what + ', the page is up');
      p.intercept(outlineRead);
      await control({ method: 'agent_message', operation_id: 'rail-overlap-noise-' + (++noise), sender: 'fixture-notebook-agent', topic_id: 'rail-overlap-noise-t', body: 'Noise ' + noise });
      await until(() => p.held.some(entry => outlineRead(entry.payload, entry.event)), what + ': the outline is reading for the page it leaves');
      p.intercept(startRead(topicId));
      await act();
      await until(() => p.held.some(entry => startRead(topicId)(entry.payload, entry.event)), what + ': the page reached has started, and waits');
      await releaseAll(p, outlineRead);
      await until(() => p.evaluate("!document.documentElement.hasAttribute('data-rails-reading')"), what + ': the reads for the page it left have settled');
      // What the page left read, or failed to read, once it is gone, is dropped: nothing says it could not be read.
      assert.equal(await p.evaluate("[...document.querySelectorAll('#outline > p.notice')].some(e=>!e.hidden)"), false, what + ': no word that the outcomes could not be read');
      p.intercept(thingsRead);
      await releaseAll(p, startRead(topicId));
      await arrived(p, search, null, what);
      await until(() => p.held.some(entry => thingsRead(entry.payload, entry.event)), what + ': the right rail is reading for the page reached');
      const meanwhile = await rails(p);
      assert.deepEqual([meanwhile.things.sections, meanwhile.things.nothing], [[], null], what + ': until its read lands, the right rail shows nothing of the place before: ' + JSON.stringify(meanwhile.things));
      p.intercept(null);
      await releaseAll(p, () => true);
      await settled(p, what + ': settled');
      const here = await rails(p);
      assert.deepEqual(here, await fresh(search, 'rail-overlap-fresh-' + noise), what + ': both rails as a fresh load of ' + search + ' draws them');
      assert.equal(here.lists, 1, what + ': one topic list');
      assert.equal((await placeOf(p)).origin, start.origin, what + ': in place, with no load');
    };
    await overlapping(() => press(p, '.ol-outcome[data-workspace-id="rail-overlap-o"] .ol-name'), '?conversation=rail-overlap-o', otherConversation, 'to the other outcome\'s Conversation');
    await overlapping(() => p.evaluate('history.back()'), '?topic=t1', 't1', 'back to the topic');
    await overlapping(() => p.evaluate('history.back()'), '?conversation=w1', w1Conversation, 'back to the first Conversation');
    await overlapping(() => p.evaluate('history.forward()'), '?topic=t1', 't1', 'forward to the topic');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail a quick second back, a back before the page is up, and a place chosen meanwhile all move in place, with no load', async () => {
    await control({ method: 'light_outcome', outcome: 'rail-quick-o', title: 'Quick outcome', topic: { id: 'rail-quick-t', title: 'Quick topic' } });
    const p = await page('rail-quick', null, true, { url: facts.origin + '/?conversation=w1', beforeNavigate: async q => { await q.send('Emulation.setDeviceMetricsOverride', SIZES.laptop); } });
    await settled(p, 'the Conversation is up');
    const start = await placeOf(p);
    const otherConversation = (await view('conversation', { workspace_id: 'rail-quick-o' })).conversation.topic_id;
    await p.evaluate(`document.querySelector('#outline a[data-topic-id="t1"]').scrollIntoView({block:'center'})`);
    await p.point('#outline a[data-topic-id="t1"]');
    await arrived(p, '?topic=t1', null, 'the topic');
    await settled(p, 'the topic is up');
    await press(p, '.ol-outcome[data-workspace-id="rail-quick-o"] .ol-name');
    await arrived(p, '?conversation=rail-quick-o', null, 'the other Conversation');
    // Two backs at once: the second comes while the first move is under way.
    await p.evaluate('(history.back(), history.back())');
    await arrived(p, '?conversation=w1', null, 'two back, to the first Conversation');
    await settled(p, 'up');
    assert.equal((await placeOf(p)).origin, start.origin, 'two quick backs load nothing');
    assert.deepEqual(await rails(p), await fresh('?conversation=w1', 'rail-quick-fresh-1'), 'both rails as a fresh load draws them');
    // Forward twice, then back once more before the page reached is up.
    await p.evaluate('history.forward()');
    await arrived(p, '?topic=t1', null, 'forward to the topic');
    await settled(p, 'up again');
    p.intercept(startRead(otherConversation));
    await p.evaluate('history.forward()');
    await until(() => p.held.some(entry => startRead(otherConversation)(entry.payload, entry.event)), 'the other Conversation has started, and waits');
    await p.evaluate('history.back()');
    p.intercept(null); await releaseAll(p, () => true);
    await arrived(p, '?topic=t1', null, 'the back made before the page was up is taken up once it is');
    await settled(p, 'up at the topic');
    assert.equal((await placeOf(p)).origin, start.origin, 'a back before the page is up loads nothing');
    assert.deepEqual(await rails(p), await fresh('?topic=t1', 'rail-quick-fresh-2'), 'both rails as a fresh load draws them');
    // An outcome chosen in the outline before the page reached is up.
    p.intercept(startRead(otherConversation));
    await press(p, '.ol-outcome[data-workspace-id="rail-quick-o"] .ol-name');
    await until(() => p.held.some(entry => startRead(otherConversation)(entry.payload, entry.event)), 'the other Conversation has started, and waits');
    await press(p, '.ol-outcome[data-workspace-id="w1"] .ol-name');
    p.intercept(null); await releaseAll(p, () => true);
    await arrived(p, '?conversation=w1', null, 'the Conversation chosen meanwhile opens once the page is up');
    await settled(p, 'up at the Conversation');
    assert.equal((await placeOf(p)).origin, start.origin, 'a place chosen before the page is up loads nothing');
    assert.deepEqual(await rails(p), await fresh('?conversation=w1', 'rail-quick-fresh-3'), 'both rails as a fresh load draws them');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail the chips show only the outcomes with something new or waiting on the reader, ⇧⌘→ and ⇧⌘← open and fold every outcome until the next place tidies them, and the pencil beside another outcome starts a topic there', async () => {
    await control({ method: 'light_outcome', outcome: 'rail-chip-ask', title: 'Asking for the chips', topic: { id: 'rail-chip-ask-t', title: 'Chip ask topic' } });
    await control({ method: 'agent_message', operation_id: 'rail-chip-ask', body: 'Which one?', topic_id: 'rail-chip-ask-t', addressees: [facts.actor], intent: 'ask' });
    const p = await page('rail-chips', null, true, { url: facts.origin + '/?topic=t1', beforeNavigate: async q => { await q.send('Emulation.setDeviceMetricsOverride', SIZES.laptop); } });
    await settled(p, 'the topic is up');
    // What Core says each outcome holds as the outline is read, and what the outline shows.
    const asking = item => item.light?.light === 'waiting' && item.light.short?.kind === 'asks' && item.light.short.count > 0;
    const holding = async which => (await view('workspaces', { limit: 100 })).items.filter(which).map(item => item.id).sort();
    const shownIds = async () => Object.keys((await outline(p)).outcomes).sort();
    const everyId = await holding(() => true);
    await until(async () => JSON.stringify(await shownIds()) === JSON.stringify(everyId), 'every outcome is listed');
    // Only those that hold it show, each open: and some do not hold it.
    const only = async (chip, key, which, what) => {
      await press(p, chip);
      const seen = await until(async () => { const now = await outline(p), ids = await holding(which);
        return now[key].pressed === 'true' && JSON.stringify(Object.keys(now.outcomes).sort()) === JSON.stringify(ids) && { now, ids }; }, what + ': pressed, only the outcomes that hold it show');
      assert.ok(seen.ids.length > 0 && seen.ids.length < everyId.length, what + ': some outcomes hold it and some do not: ' + seen.ids.join(' '));
      assert.ok(Object.values(seen.now.outcomes).every(row => row.open), what + ': each open, to show it');
      await shot(p, 'rail-chip-' + key);
      await press(p, chip);
      await until(async () => { const now = await outline(p); return now[key].pressed === 'false' && JSON.stringify(Object.keys(now.outcomes).sort()) === JSON.stringify(everyId); }, what + ': pressed again, every outcome shows');
    };
    await only('#outline-only-new', 'fresh', item => item.unread > 0, '"N new"');
    await only('#outline-only-waiting', 'waiting', asking, '"N waiting on you"');
    // ⇧⌘→ opens every outcome, and ⇧⌘← folds every one, from anywhere in the outline: here, its chip "N waiting on you".
    const opens = async () => Object.values((await outline(p)).outcomes).map(row => row.open);
    assert.deepEqual((await opens()).filter(open => open).length, 1, 'only the outcome being read is open');
    await tabToOutline(p);
    await p.key('Tab', 8);
    assert.equal(await keyedAt(p), 'outline:outline-only-waiting', 'Shift-Tab from the outline is its chip "N waiting on you"');
    await p.key('ArrowRight', 12);
    await until(async () => (await opens()).every(open => open), '⇧⌘→ opens every outcome');
    assert.equal(await keyedAt(p), 'outline:outline-only-waiting', 'the keys stay where they were');
    await p.key('ArrowLeft', 12);
    await until(async () => (await opens()).every(open => !open), '⇧⌘← folds every outcome, the one being read too');
    // From a row: open every one, then fold every one with the keys on a topic: they go to its outcome.
    await tabToOutline(p);
    await p.key('ArrowRight', 12);
    await until(async () => (await opens()).every(open => open) && (await outline(p)).outcomes['rail-chip-ask'].topics.length > 0, 'opened again from a row, each with its topics');
    await keysTo(p, 'topic:rail-chip-ask-t');
    await p.key('ArrowLeft', 12);
    await until(async () => (await opens()).every(open => !open), 'folded again from a topic');
    assert.equal(await keyedAt(p), 'name:rail-chip-ask', 'and the keys go to its outcome');
    // Nothing of it is kept: a reload starts tidy, the outcome being read open, every other folded.
    await reloaded(p, 'the page loads again');
    await until(async () => { const rows = Object.values((await outline(p)).outcomes); return rows.length === everyId.length && rows.filter(row => row.open).length === 1 && (await outline(p)).outcomes.w1.open; }, 'after a reload only the outcome being read is open');
    // The pencil beside another outcome, while reading this one: ⌘→ opens it from the keys; the topic starts there and opens in place.
    const before = await placeOf(p);
    await keysTo(p, 'name:rail-chip-ask');
    await p.key('ArrowRight', 4);
    await until(async () => (await outline(p)).outcomes['rail-chip-ask'].topics.some(row => row.id === 'rail-chip-ask-t'), 'its topics show under it');
    await press(p, '#ol-pencil-rail-chip-ask');
    await until(() => p.evaluate("document.activeElement?.id==='ol-new-topic-rail-chip-ask'"), 'its title line shows, focused');
    const title = 'Started under another outcome';
    await p.send('Input.insertText', { text: title }); await p.key('Enter');
    const opened = await until(async () => { const at = await placeOf(p); return at.ready && at.title === title && at; }, 'the new topic opens');
    assert.equal(opened.origin, before.origin, 'in place');
    const id = new URLSearchParams(opened.search).get('topic');
    assert.equal((await view('topic', { topic_id: id })).topic.workspace_id, 'rail-chip-ask', 'the topic is in the outcome whose pencil was pressed');
    await settled(p, 'up');
    const seen = await rails(p);
    assert.deepEqual([seen.holder, seen.currentTopics], ['rail-chip-ask', ['rail-chip-ask/' + id]], 'and the outline shows it under that outcome, marked as the page');
    await control({ method: 'agent_message', operation_id: 'rail-chip-answer', sender: 'person', topic_id: 'rail-chip-ask-t', whole_topic: true, body: 'This one.' });
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail a section of the right rail folded stays folded across a move in place and a reload, and opens again when unfolded', async () => {
    const p = await page('rail-section-fold', null, true, { url: facts.origin + '/?topic=t1', beforeNavigate: async q => { await q.send('Emulation.setDeviceMetricsOverride', SIZES.laptop); } });
    await settled(p, 'the topic is up');
    const tools = "document.querySelector('#things .things-sec[data-key=tools]')";
    const open = () => p.evaluate(`(()=>{const d=${tools};return d.getClientRects().length>0?d.open:null})()`);
    // A press on the section's heading, waited out until the section has said it folded or opened.
    const toggle = async () => {
      await p.evaluate(`(window.railToggled=new Promise(resolve=>${tools}.addEventListener('toggle',resolve,{once:true})),true)`);
      await press(p, '#things .things-sec[data-key=tools] summary');
      await p.evaluate('window.railToggled.then(()=>true)');
    };
    assert.equal(await open(), true, 'Skills and tools shows, open');
    await toggle();
    assert.equal(await open(), false, 'a press on its heading folds it');
    await press(p, '.ol-outcome[data-workspace-id="w1"] .ol-name');
    await arrived(p, '?conversation=w1', null, 'the Conversation opens in place');
    await settled(p, 'the Conversation is up');
    assert.equal(await open(), false, 'still folded on the Conversation');
    await reloaded(p, 'the page loads again');
    assert.equal(await open(), false, 'still folded after a reload');
    await toggle();
    assert.equal(await open(), true, 'unfolded');
    await reloaded(p, 'the page loads again');
    assert.equal(await open(), true, 'and open after a reload');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // ---- What a move leaves for the page it reaches, and the rails' own presses ----
  // An outcome whose one topic carries five pictures, for the right rail's Images.
  const PICTURES = ['one.png', 'one.jpg', 'one.gif', 'palette.png', 'sixteen.png'];
  // Made once, by the first check that asks for it.
  let pics = null;
  const pictured = () => pics ??= (async () => {
    await control({ method: 'light_outcome', outcome: 'rail-pics-o', title: 'Pictures outcome', topic: { id: 'rail-pics-t', title: 'Pictures topic' } });
    await control({ method: 'agent_message', operation_id: 'rail-pics', topic_id: 'rail-pics-t', source: 'topic', body: 'Five pictures',
      attachments: PICTURES.map((image, n) => ({ name: `picture-${n}${image.slice(image.lastIndexOf('.'))}`, image })) });
  })();
  // Each picture the right rail lists, as drawn: shown (its image drawn) or blank.
  const pictures = p => p.evaluate(`[...document.querySelectorAll('#things [data-key=images] a.thumb')].map(a=>{const i=a.querySelector('img.image-thumb');
    return i&&!i.hidden&&i.complete&&i.naturalWidth>0?'shown':'blank'})`);
  const allShown = (p, what) => until(async () => { const seen = await pictures(p); return seen.length === PICTURES.length && seen.every(state => state === 'shown') && seen; }, what);
  const readerOpen = p => p.evaluate("Boolean(document.querySelector('#reader')?.open)");

  await check('rail a move made while the right rail\'s pictures are still being read shows every picture on the page reached, and again on coming back; a picture opens its message in place', async () => {
    await pictured();
    const p = await page('rail-pictures', null, true, { url: facts.origin + '/?topic=rail-pics-t', beforeNavigate: async q => { await q.send('Emulation.setDeviceMetricsOverride', SIZES.laptop); } });
    const media = payload => typeof payload?.media_id === 'string';
    // The pictures are read one at a time; the first is held on its way, so the rest wait their turn.
    p.intercept(media);
    await until(() => p.held.some(entry => media(entry.payload)), 'a picture is being read');
    await until(async () => (await pictures(p)).length === PICTURES.length, 'the right rail lists the topic\'s pictures, still being read');
    const start = await placeOf(p);
    await press(p, '.ol-outcome[data-workspace-id="rail-pics-o"] .ol-name');
    await arrived(p, '?conversation=rail-pics-o', null, 'the Conversation opens in place, while the pictures are still being read');
    p.intercept(null); await releaseAll(p, () => true);
    await settled(p, 'the Conversation is up');
    await allShown(p, 'every picture of the outcome shows on the Conversation');
    await p.evaluate('history.back()');
    await arrived(p, '?topic=rail-pics-t', 'Pictures topic', 'back to the topic');
    await settled(p, 'the topic is up');
    await allShown(p, 'and every picture shows again on the topic');
    // A picture on the Conversation opens its message: in its topic, in place, in the Reader.
    await p.evaluate('history.forward()');
    await arrived(p, '?conversation=rail-pics-o', null, 'forward to the Conversation');
    await settled(p, 'the Conversation is up again');
    await allShown(p, 'its pictures show');
    await press(p, '#things [data-key=images] a.thumb');
    await arrived(p, '?topic=rail-pics-t', 'Pictures topic', 'the picture opens its topic');
    await until(() => readerOpen(p), 'with its message in the Reader');
    assert.equal((await placeOf(p)).origin, start.origin, 'in place, with no load');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail at 390 a picture in the outcome\'s things opens its message in place and closes the sheet; "Just this topic" shows the topic\'s own things again', async () => {
    await pictured();
    const p = await open('rail-sheet-row', '/?conversation=rail-pics-o', 'phone');
    // On a phone the right rail reads only once its sheet is open.
    const up = what => until(() => p.evaluate("document.body?.dataset.ready==='true' && Boolean(document.getElementById('things-open'))").catch(() => false), what);
    await up('the Conversation is up');
    const start = await placeOf(p);
    const sheet = () => p.evaluate("document.documentElement.hasAttribute('data-things-open')");
    const scope = () => p.evaluate(`(()=>{const t=document.getElementById('things');return {heading:t.querySelector('h2').textContent,name:t.querySelector('.things-name').textContent,
      chips:[...t.querySelectorAll('.things-scope .chip')].map(c=>c.getAttribute('aria-pressed')),busy:t.querySelector('.things-sections').getAttribute('aria-busy')==='true'}})()`);
    // A finger on what the selector names, brought into view and once it holds its place (the sheet slides in, the header fills).
    const reach = async selector => {
      await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
      let last = null;
      await until(async () => { const now = await p.box(selector), same = Boolean(last && now) && ['x', 'y', 'width', 'height'].every(key => now[key] === last[key]); last = now; return same; }, selector + ' holds its place');
      await tap(p, selector);
    };
    await reach('#things-open');
    await until(sheet, 'the sheet opens');
    await allShown(p, 'the outcome\'s pictures show in it');
    await reach('#things [data-key=images] a.thumb');
    await arrived(p, '?topic=rail-pics-t', 'Pictures topic', 'the picture opens its topic');
    await until(() => readerOpen(p), 'with its message in the Reader');
    assert.equal(await sheet(), false, 'the sheet has closed');
    assert.equal((await placeOf(p)).origin, start.origin, 'in place, with no load');
    await reach('#reader-close');
    await until(async () => !(await readerOpen(p)), 'the Reader closes');
    await up('the topic is up');
    await reach('#things-open');
    await until(sheet, 'the sheet opens on the topic');
    await until(async () => { const seen = await scope(); return seen.heading === 'In this topic' && !seen.busy; }, 'it shows the topic\'s things');
    await reach('#things .things-scope .chip:nth-child(2)');
    await until(async () => { const seen = await scope(); return seen.heading === 'This outcome' && !seen.busy && JSON.stringify(seen.chips) === '["false","true"]'; }, '"All of this outcome" shows the outcome\'s');
    await reach('#things .things-scope .chip:nth-child(1)');
    const topic = await until(async () => { const seen = await scope(); return seen.heading === 'In this topic' && !seen.busy && seen; }, '"Just this topic" shows the topic\'s own things again');
    assert.deepEqual([topic.name, topic.chips], ['Pictures topic', ['true', 'false']], 'named for the topic, with "Just this topic" pressed');
    // A picture of the topic on show opens its message in the Reader, with no move, and the sheet closes for it.
    await allShown(p, 'the topic\'s pictures show');
    await reach('#things [data-key=images] a.thumb');
    await until(() => readerOpen(p), 'the picture\'s message opens in the Reader');
    assert.deepEqual([await sheet(), (await placeOf(p)).origin], [false, start.origin], 'the sheet has closed, on the same page');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail a topic the page can no longer read leaves the right rail at once: its pictures and their bytes go before anything is read again', async () => {
    await pictured();
    // Every picture's bytes the page holds (blob: addresses made and not yet let go).
    const bytes = 'window.railBlobs=new Set();const made=URL.createObjectURL,freed=URL.revokeObjectURL;URL.createObjectURL=function(...args){const url=made.apply(this,args);railBlobs.add(url);return url};URL.revokeObjectURL=function(url){railBlobs.delete(url);return freed.call(this,url)};';
    const p = await page('rail-denied', null, true, { url: facts.origin + '/?topic=rail-pics-t', beforeNavigate: async q => {
      await q.send('Emulation.setDeviceMetricsOverride', SIZES.laptop);
      await q.send('Page.addScriptToEvaluateOnNewDocument', { source: bytes });
    } });
    await allShown(p, 'the topic\'s pictures show in the right rail');
    assert.equal(await p.evaluate('railBlobs.size'), PICTURES.length, 'each picture\'s bytes are held');
    // The right rail's next reads are held, so only what the page does at the refusal itself can hide the pictures.
    p.intercept(thingsRead);
    await control({ method: 'read_fault', name: 'changes', status: 200, body: { instance_id: facts.instance_id, error: { code: 'FORBIDDEN', message: 'Fixture FORBIDDEN', retryable: false } }, count: 1 });
    await control({ method: 'agent_message', operation_id: 'rail-denied-news', topic_id: 'rail-pics-t', source: 'topic', body: 'News the reader may no longer read' });
    await until(() => p.evaluate("document.getElementById('topic-title').textContent==='Topic unavailable'"), 'the page says the topic is unavailable');
    assert.deepEqual(await p.evaluate("({pictures:document.querySelectorAll('#things img.image-thumb').length,bytes:railBlobs.size})"), { pictures: 0, bytes: 0 },
      'the right rail shows none of its pictures and holds none of their bytes, with its reads still held');
    p.intercept(null);
    for (const entry of p.held.splice(0)) await p.release(entry);
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail a back the page refuses while the Reader is open says why in the Reader, where the person is looking', async () => {
    await control({ method: 'navigation_topics', topics: [{ id: 'rail-stay-a', title: 'Staying topic A' }, { id: 'rail-stay-b', title: 'Staying topic B' }] });
    const asked = await control({ method: 'agent_message', operation_id: 'rail-stay-ask', topic_id: 'rail-stay-b', join: true, source: 'topic', addressees: [facts.actor], body: 'A question answered while the page tries to go back.' });
    const words = `#messages .message-card[data-id="${asked.result.message_id}"] > .message-preview`;
    const p = await open('rail-stay', '/?topic=rail-stay-a');
    await until(() => p.evaluate('document.querySelector("#outline a[data-topic-id=rail-stay-b]")?.getClientRects().length>0'), 'the outline is ready');
    const start = await placeOf(p);
    await press(p, '#outline a[data-topic-id="rail-stay-b"]');
    await arrived(p, '?topic=rail-stay-b', 'Staying topic B', 'B opens in place');
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(words)})?.getClientRects().length>0`), 'its message is shown');
    await press(p, words);
    await until(() => readerOpen(p), 'the message opens in the Reader');
    // Offline, the reply cannot be confirmed saved: going back now would leave it so, and the page stays.
    const network = offline => p.send('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await p.point('#writing-body');
    await network(true);
    await p.send('Input.insertText', { text: 'Written while the page tries to go back' });
    await p.evaluate('history.back()');
    await until(() => p.evaluate("document.getElementById('topic-navigation-status').textContent.includes('not confirmed saved')"), 'the page refuses the back');
    const seen = await p.evaluate(`(()=>{const n=document.getElementById('reader-notice'),b=n.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
      return {search:location.search,reader:document.getElementById('reader').open,words:n.hidden?'':n.textContent,seen:b.width>0&&b.height>0&&n.contains(hit)}})()`);
    assert.deepEqual(seen, { search: '?topic=rail-stay-b', reader: true, words: await p.evaluate("document.getElementById('topic-navigation-status').textContent"), seen: true },
      'the address goes back to B, and the open Reader says why, where it can be read');
    assert.equal((await placeOf(p)).origin, start.origin, 'in place, with no load');
    await network(false);
    assert.deepEqual(p.errors, []); await p.close();
  });

  // The keyboard is simulated as the Reader's composer checks simulate it
  // (reader_compose_native.mjs): with the reply focused the window is made
  // 390×464, which the browser reports as a visual viewport resize.
  await check('rail at 390 after a move in place the keyboard leaves the Reader\'s reply and Send in view, as on a fresh load', async () => {
    await control({ method: 'light_outcome', outcome: 'rail-keys-o', title: 'Keyboard outcome', topic: { id: 'rail-keys-t', title: 'Keyboard topic' } });
    const asked = await control({ method: 'agent_message', operation_id: 'rail-keys-ask', topic_id: 'rail-keys-t', source: 'topic', addressees: [facts.actor], body: 'A question to answer on a phone.' });
    const card = `#messages .message-card[data-id="${asked.result.message_id}"]`, words = card + ' > .message-preview', KEYBOARD = 380;
    const ready = p => until(() => p.evaluate("document.body?.dataset.ready==='true'").catch(() => false), 'the page is up');
    for (const moved of [false, true]) {
      const at = moved ? 'after a move in place' : 'on a fresh load';
      const p = await open('rail-keys-' + (moved ? 'moved' : 'fresh'), moved ? '/?conversation=rail-keys-o' : '/?topic=rail-keys-t', 'phone');
      await ready(p);
      const start = await placeOf(p);
      if (moved) {
        // From the Conversation to its topic, through the drawer, in place.
        await tap(p, '#rail-open');
        await until(async () => (await drawer(p)).open, at + ': "☰ Outcomes" opens the drawer');
        const row = '#outline a.nav-item[data-topic-id="rail-keys-t"]';
        await until(() => p.evaluate(`document.querySelector(${JSON.stringify(row)})?.getClientRects().length>0`), at + ': the topic is in the drawer');
        await p.evaluate(`document.querySelector(${JSON.stringify(row)}).scrollIntoView({block:'center'})`);
        await tap(p, row);
        await arrived(p, '?topic=rail-keys-t', 'Keyboard topic', at + ': the topic opens');
        assert.equal((await placeOf(p)).origin, start.origin, at + ': in place, with no load');
      }
      // A phone's two taps: the first lights the card, the second opens it in the Reader.
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card)})?.getClientRects().length>0`), at + ': the message is shown');
      await p.evaluate(`document.querySelector(${JSON.stringify(card)}).scrollIntoView({block:'center'})`);
      await tap(p, words);
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card)}).classList.contains('lit')`), at + ': the first tap lights the card');
      await tap(p, words);
      await until(() => readerOpen(p), at + ': the second tap opens it in the Reader');
      await until(() => p.evaluate('document.getAnimations().filter(x=>x.effect?.getTiming().iterations!==Infinity).every(a => a.playState !== "running")'), at + ': the Reader has settled');
      await tap(p, '#writing-body');
      await until(() => p.evaluate("document.activeElement?.id==='writing-body'"), at + ': the reply has the focus');
      await p.send('Input.insertText', { text: 'An answer' });
      await p.send('Emulation.setDeviceMetricsOverride', { ...SIZES.phone, height: SIZES.phone.height - KEYBOARD });
      await until(() => p.evaluate(`Math.round(visualViewport.height)===${SIZES.phone.height - KEYBOARD}`), at + ': the keyboard is up');
      await p.evaluate('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))');
      const seen = await p.evaluate(`(()=>{const root=getComputedStyle(document.documentElement),bottom=id=>Math.round(document.getElementById(id).getBoundingClientRect().bottom);
        return {height:root.getPropertyValue('--vv-height').trim(),keyboard:root.getPropertyValue('--keyboard').trim(),field:bottom('writing-body'),send:bottom('send-reply'),reader:bottom('reader')}})()`);
      const top = SIZES.phone.height - KEYBOARD;
      assert.deepEqual([seen.height, seen.keyboard, seen.reader <= top, seen.field <= top, seen.send <= top], [`${top}px`, `${KEYBOARD}px`, true, true, true],
        at + `: the Reader ends at the keyboard's top, with the reply and Send above it: ${JSON.stringify(seen)}`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('rail after moves in place the window and the document hear what a fresh load of the same place hears, after the same acts', async () => {
    await control({ method: 'light_outcome', outcome: 'rail-heard-o', title: 'Hearing outcome', topic: { id: 'rail-heard-t', title: 'Hearing topic' } });
    const asked = await control({ method: 'agent_message', operation_id: 'rail-heard-ask', topic_id: 'rail-heard-t', source: 'topic', addressees: [facts.actor], body: 'A question to reply to.' });
    await control({ method: 'agent_message', operation_id: 'rail-heard-reply', sender: 'person', topic_id: 'rail-heard-t', reply_to: asked.result.message_id, addressees: ['fixture-notebook-agent'], body: 'My reply to it.' });
    const laptop = async q => { await q.send('Emulation.setDeviceMetricsOverride', SIZES.laptop); };
    // Every listener on the window and the document, by its type, its options and its function.
    const heard = async q => {
      const found = [];
      for (const target of ['window', 'document']) {
        const { result } = await q.send('Runtime.evaluate', { expression: target, objectGroup: 'rail-heard' });
        const { listeners } = await q.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
        for (const l of listeners) found.push([target, l.type, l.useCapture ? 'capture' : '', l.passive ? 'passive' : '', l.once ? 'once' : '', String(l.handler?.description ?? '').slice(0, 160)].join(' '));
      }
      await q.send('Runtime.releaseObjectGroup', { objectGroup: 'rail-heard' });
      return found.sort();
    };
    // The page as the acts leave it: the card replied to, and the picture in the writing box.
    const shows = (q, what) => until(() => q.evaluate("Boolean(document.querySelector('#messages .replied-mark')) && document.querySelector('#inline-attachments .image-choice span')?.textContent === 'screen.png · Ready'"), what);
    const p = await page('rail-heard', null, true, { url: facts.origin + '/?topic=rail-heard-t', beforeNavigate: laptop });
    await settled(p, 'the topic is up');
    const start = await placeOf(p);
    // A picture put in the writing box: its row's buttons guard their presses.
    await p.evaluate("document.getElementById('inline-add-image').scrollIntoView({block:'center'})");
    const n = p.events.length; await p.send('Page.setInterceptFileChooserDialog', { enabled: true }); await p.point('#inline-add-image');
    const chooser = await until(() => p.events.slice(n).find(e => e.method === 'Page.fileChooserOpened'), 'the picture chooser');
    await p.send('DOM.setFileInputFiles', { backendNodeId: chooser.params.backendNodeId, files: [fileURLToPath(new URL('fixtures/media/screen.png', import.meta.url))] });
    await shows(p, 'the replied card and the picture in the writing box');
    // Away to the Conversation and back, each in place.
    await press(p, '.ol-outcome[data-workspace-id="rail-heard-o"] .ol-name');
    await arrived(p, '?conversation=rail-heard-o', null, 'the Conversation opens in place');
    await settled(p, 'the Conversation is up');
    await p.evaluate('history.back()');
    await arrived(p, '?topic=rail-heard-t', 'Hearing topic', 'back to the topic');
    await settled(p, 'the topic is up again');
    await shows(p, 'the replied card and the kept picture, again');
    assert.equal((await placeOf(p)).origin, start.origin, 'in place, with no load');
    const moved = await heard(p);
    const q = await page('rail-heard-fresh', null, true, { url: facts.origin + '/?topic=rail-heard-t', beforeNavigate: laptop });
    await settled(q, 'the fresh load is up');
    await shows(q, 'the fresh load shows the replied card and the kept picture');
    assert.deepEqual(moved, await heard(q), 'the listeners of a fresh load, no more and no fewer');
    assert.deepEqual(q.errors, []); await q.close();
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Every read and live feed each document of the page starts, and every load
  // it asks for, in order, kept across loads (sessionStorage). The Navigation
  // API's navigate event is the moment the page asks: in Chrome and Safari's
  // engine alike it fires inside location.assign itself.
  const recordRequests = key => `(() => {
    const key = ${JSON.stringify(key)}, page = String(Math.random()).slice(2);
    const note = entry => { const kept = JSON.parse(sessionStorage.getItem(key) ?? '[]'); kept.push({ page, ...entry }); sessionStorage.setItem(key, JSON.stringify(kept)); };
    navigation.addEventListener('navigate', event => note({ navigate: new URL(event.destination.url).search }));
    const send = window.fetch;
    window.fetch = function (input, init) {
      let name = null; try { const body = JSON.parse(init?.body ?? 'null'); name = body?.name ?? body?.kind ?? null; } catch { /* not JSON */ }
      note({ request: new URL(String(input?.url ?? input), location.href).pathname, name });
      return send.apply(this, arguments);
    };
    const Socket = window.WebSocket;
    window.WebSocket = class extends Socket { constructor(...args) { note({ socket: true }); super(...args); } };
  })()`;
  const recorded = async (p, key) => JSON.parse(await p.evaluate(`sessionStorage.getItem(${JSON.stringify(key)}) ?? '[]'`));

  // The page asks for the new outcome's page right after its own write
  // commits, and the live feed names that commit a moment later. From the
  // moment it asks, it starts no read and opens no feed (api.mjs depart):
  // Safari's engine begins the load a moment after it is asked for, cancels
  // what the page started meanwhile, and could lose the load itself, leaving
  // the page up at its old address for good. A page that stays still reads
  // what a commit changed.
  await check('rail New outcome in the outline, on a topic and on a Conversation, creates the outcome and opens its page', async () => {
    for (const [search, title, n] of [['?topic=t1', 'Started beside a topic', 1], ['?conversation=w1', 'Started beside a Conversation', 2]]) {
      const key = 'rail-new-outcome-' + n;
      const p = await page('rail-new-outcome', null, true, { url: facts.origin + '/' + search, beforeNavigate: async q => {
        await q.send('Emulation.setDeviceMetricsOverride', SIZES.laptop);
        await q.send('Page.addScriptToEvaluateOnNewDocument', { source: recordRequests(key) });
      } });
      await settled(p, search + ': the page is up');
      // A commit made elsewhere: the page, which stays, reads again.
      const before = (await recorded(p, key)).length;
      await control({ method: 'light_outcome', outcome: 'rail-new-outcome-elsewhere-' + n, title: 'Made elsewhere ' + n });
      await until(async () => (await recorded(p, key)).slice(before).some(entry => entry.request === '/api/view'), search + ': a commit made elsewhere is read on the page that stays');
      await settled(p, search + ': the page has read the commit made elsewhere');
      await press(p, '#outline-new-outcome');
      await until(() => p.evaluate("document.activeElement?.id==='outline-new-outcome-title'"), search + ': its title line shows, focused');
      await p.send('Input.insertText', { text: title }); await p.key('Enter');
      const opened = await until(async () => { const at = await placeOf(p).catch(() => null); return at?.ready && at.title === title && at; }, search + ': the new outcome\'s page opens');
      const id = new URLSearchParams(opened.search).get('workspace');
      assert.ok(id, search + ': the address names the outcome: ' + opened.search);
      assert.equal((await view('workspace', { workspace_id: id })).workspace?.title, title, search + ': Core holds the outcome by the title typed');
      const record = await recorded(p, key), asked = record.findIndex(entry => entry.navigate === opened.search);
      assert.ok(asked >= 0 && record.slice(0, asked).some(entry => entry.page === record[asked].page && entry.name === 'workspace.create'),
        search + ': the page asked for the outcome\'s page after creating it: ' + JSON.stringify(record));
      assert.deepEqual(record.slice(asked + 1).filter(entry => entry.page === record[asked].page), [],
        search + ': once it asks for the outcome\'s page, the page it leaves starts no read and opens no live feed');
      assert.ok(record.slice(asked + 1).some(entry => entry.page !== record[asked].page && entry.request === '/api/bootstrap'), search + ': the outcome\'s page reads afresh');
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Each pencil's title line in every state it has (web/quick-create.mjs, OneLine; item 305): open and
  // empty, refused for an empty Return, busy while its command is on its way, and refused by the server,
  // at 320, 375 and 390 in the open drawer and on a laptop, light and dark. The command is held here
  // before the server has it (Chrome's Fetch at the request stage, WebKit's route), so the refusal
  // given in its place leaves nothing made.
  const TRY_AGAIN = ' Press Return to try once more.';
  const REFUSAL = 'Only the people on this outcome’s team can start something in it; ask its owner to add you.';
  const holdCommands = async (p, kind) => {
    if (p.intercept) {
      const from = p.held.length;
      await p.send('Fetch.enable', { patterns: [{ urlPattern: facts.origin + '/api/command', requestStage: 'Request' }, { urlPattern: facts.origin + '/api/*', requestStage: 'Response' }] });
      p.intercept((payload, event) => event.responseStatusCode === undefined && payload?.kind === kind);
      return {
        first: what => until(() => p.held.slice(from).find(entry => entry.payload?.kind === kind), what),
        answer: (entry, receipt) => p.send('Fetch.fulfillRequest', { requestId: entry.event.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(receipt)).toString('base64') }),
        stop: async () => { p.intercept(null); await p.send('Fetch.enable', { patterns: [{ urlPattern: facts.origin + '/api/*', requestStage: 'Response' }] }); },
      };
    }
    const held = [], url = facts.origin + '/api/command';
    const handler = route => { const payload = route.request().postDataJSON(); if (payload?.kind === kind) held.push({ route, payload }); else route.continue(); };
    await p.pw.route(url, handler);
    return {
      first: what => until(() => held[0], what),
      answer: (entry, receipt) => entry.route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(receipt) }),
      stop: () => p.pw.unroute(url, handler),
    };
  };
  // A title line as drawn: whether it is under its row or heading and clear of everything in it (its pencil
  // too), inside the rail with nothing over the field or its words, 44px tall, with no sideways scroll; and
  // what it says, whether it holds the cursor and whether it is busy.
  const lineState = (p, spec) => p.evaluate(`(()=>{const input=document.getElementById(${JSON.stringify(spec.input)});if(!input)return null;
    const root=input.closest('.one-line'),state=root.querySelector('.one-line-state'),anchor=document.querySelector(${JSON.stringify(spec.anchor)}),pen=document.querySelector(${JSON.stringify(spec.pencil)});
    const rs=document.getElementById('rail'),rail=rs.getBoundingClientRect(),box=e=>e.getBoundingClientRect(),i=box(input),r=box(root),s=box(state);
    const inRail=b=>b.left>=rail.left-0.5&&b.right<=rail.right+0.5&&b.top>=rail.top-0.5&&b.bottom<=rail.bottom+0.5;
    const hits=(e,b)=>[[b.left+3,b.top+3],[b.right-3,b.top+3],[b.left+3,b.bottom-3],[b.right-3,b.bottom-3],[b.left+b.width/2,b.top+b.height/2]].every(([x,y])=>e.contains(document.elementFromPoint(x,y)));
    const above=Math.max(...[anchor,...anchor.querySelectorAll('*'),pen].filter(e=>e.getClientRects().length).map(e=>box(e).bottom));
    return {under:anchor.nextElementSibling===root,clear:above<=r.top+0.5,inRail:inRail(r)&&(state.hidden||inRail(s)),uncovered:hits(input,i)&&(state.hidden||hits(state,s)),
      tall:i.height>=43.5,scroll:document.documentElement.scrollWidth<=innerWidth&&rs.scrollWidth<=rs.clientWidth,focused:document.activeElement===input,
      expanded:pen.getAttribute('aria-expanded'),busy:input.getAttribute('aria-busy'),value:input.value,
      state:state.hidden?null:{text:state.textContent,quiet:state.classList.contains('quiet')},search:location.search}})()`);
  // How many commands of a kind the page has sent: its fetch is called within the key's own keydown
  // (quick-create.mjs awaits nothing before it), so the record is whole once the key has been pressed.
  // A pencil brought into view in its rail, as a person scrolls to it: once it is wholly inside the window.
  const inView = (p, selector, what) => until(() => p.evaluate(`(e=>{e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight})(document.querySelector(${JSON.stringify(selector)}))`), what);
  const commandsSent = async (p, key, kind) => (await recorded(p, key)).filter(entry => entry.request === '/api/command' && entry.name === kind).length;
  await check('rail each pencil\'s title line, at 320, 375 and 390 in the open drawer and on a laptop, light and dark, open, refused when empty, busy while it starts and refused by the server, is under its row or heading and clear of it, in the rail with nothing over it; a second Return while busy sends nothing more, the server\'s refusal keeps the title and makes nothing, Escape closes the line, and Return again makes it', async () => {
    const specs = [
      { name: 'topic', pencil: '#ol-pencil-w1', input: 'ol-new-topic-w1', anchor: '#outline .ol-outcome[data-workspace-id="w1"] > .ol-row', kind: 'opening.save', empty: 'Type the topic’s title, then press Return.' },
      { name: 'outcome', pencil: '#outline-new-outcome', input: 'outline-new-outcome-title', anchor: '#outline .ol-heading', kind: 'workspace.create', empty: 'Type the outcome’s title, then press Return.' },
    ];
    for (const [width, theme] of [[320, 'light'], [320, 'dark'], [375, 'light'], [375, 'dark'], [390, 'light'], [390, 'dark'], [1280, 'light'], [1280, 'dark']]) {
      const phone = width < SIZES.laptop.width, at = `${width} ${theme}`, key = `rail-line-states-${width}-${theme}`;
      const p = await page(key, null, true, { url: facts.origin + '/?topic=t1', beforeNavigate: async q => {
        await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await q.send('Emulation.setDeviceMetricsOverride', phone ? { ...SIZES.phone, width } : SIZES.laptop);
        if (phone) await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
        await q.send('Page.addScriptToEvaluateOnNewDocument', { source: recordRequests(key) });
      } });
      // Up with no read of the rails waiting or out, so no row moves under a press (every outcome the earlier
      // checks made is listed). The right rail is not waited for: at a phone's width it is not drawn.
      await until(() => p.evaluate(`document.body?.dataset.ready==='true' && !document.documentElement.hasAttribute('data-rails-reading')
        && Boolean(document.querySelector('#outline #topic-navigation a[data-topic-id=t1]')) && Boolean(document.querySelector('#outline .ol-outcome[data-workspace-id=w1]'))`).catch(() => false), at + ': the page and its outline are up');
      if (phone) { await tap(p, '#rail-open'); await until(async () => (await drawer(p)).open, at + ': "☰ Outcomes" opens the drawer'); }
      const place = () => p.evaluate(`({search:location.search,open:document.querySelector('.ol-outcome[data-workspace-id=w1]').hasAttribute('data-open')})`);
      const titles = {};
      for (const spec of specs) {
        const said = `${at} ${spec.name} line`, title = titles[spec.name] = `Held ${spec.name} ${width} ${theme}`, words = JSON.stringify(spec.input);
        const looks = async (what, want) => {
          const seen = await lineState(p, spec);
          assert.ok(seen, `${said} ${what}: the line is there`);
          assert.deepEqual([seen.under, seen.clear, seen.inRail, seen.uncovered, seen.tall, seen.scroll, seen.expanded], [true, true, true, true, true, true, 'true'],
            `${said} ${what}: under its ${spec.name === 'topic' ? 'row' : 'heading'} and clear of it and its pencil, in the rail, nothing over it, 44px tall, no sideways scroll: ${JSON.stringify(seen)}`);
          assert.deepEqual({ focused: seen.focused, busy: seen.busy, state: seen.state }, want, `${said} ${what}: ${JSON.stringify(seen)}`);
          await shot(p, `rail-line-${spec.name}-${what}-${width}-${theme}`);
          return seen;
        };
        const before = await place();
        // Open: one press on the pencil, the cursor in the empty line, nothing said yet.
        await inView(p, spec.pencil, said + ': its pencil is brought into view');
        if (phone) await tap(p, spec.pencil); else await p.point(spec.pencil);
        await until(() => p.evaluate(`document.activeElement?.id===${words}`), said + ': the press opens the line, the cursor in it');
        await looks('open', { focused: true, busy: null, state: null });
        assert.deepEqual(await place(), before, said + ': the press opened and folded nothing, and the page stayed');
        // Refused: Return on the empty line says so in plain words, and sends nothing.
        await p.key('Enter');
        await until(() => p.evaluate(`document.getElementById(${words})?.nextElementSibling?.textContent===${JSON.stringify(spec.empty)}`), said + ': an empty Return is refused in plain words');
        await looks('refused', { focused: true, busy: null, state: { text: spec.empty, quiet: false } });
        assert.equal(await commandsSent(p, key, spec.kind), 0, said + ': an empty Return sends nothing');
        // Busy: the title typed, Return sends its command, held before the server has it.
        const hold = await holdCommands(p, spec.kind);
        await p.send('Input.insertText', { text: title });
        await p.key('Enter');
        const held = await hold.first(said + ': Return sends the command');
        await until(() => p.evaluate(`document.getElementById(${words})?.getAttribute('aria-busy')==='true'`), said + ': the line is busy');
        await looks('busy', { focused: true, busy: 'true', state: { text: 'Starting…', quiet: true } });
        await p.key('Enter');
        assert.equal(await commandsSent(p, key, spec.kind), 1, said + ': a second Return while busy sends nothing more');
        // Refused by the server: its words, the title kept as typed, the line no longer busy, the cursor still in it.
        await hold.answer(held, { instance_id: held.payload.instance_id, operation_id: held.payload.operation_id, kind: held.payload.kind, status: 'rejected', recorded: false,
          result: null, affected: [], error: { code: 'FORBIDDEN', message: REFUSAL, retryable: false } });
        await until(() => p.evaluate(`document.getElementById(${words})?.nextElementSibling?.textContent===${JSON.stringify(REFUSAL + TRY_AGAIN)}`), said + ': the server\'s refusal is said in its words');
        const refused = await looks('server-refused', { focused: true, busy: null, state: { text: REFUSAL + TRY_AGAIN, quiet: false } });
        assert.deepEqual([refused.value, refused.search], [title, before.search], said + ': the title stays as typed, and the page stays');
        await hold.stop();
        // Escape closes the line from there and gives its pencil the keys; a phone's drawer stays open.
        await p.key('Escape');
        await until(() => p.evaluate(`!document.getElementById(${words}) && document.activeElement===document.querySelector(${JSON.stringify(spec.pencil)})`), said + ': Escape closes the line and gives the pencil the keys');
        if (phone) assert.equal((await drawer(p)).open, true, said + ': the drawer stays open');
      }
      // Nothing the server refused was made: the one outcome asked for was answered here, and no topic was published.
      assert.deepEqual([await commandsSent(p, key, 'workspace.create'), await commandsSent(p, key, 'opening.publish')], [1, 0], at + ': one outcome asked for, and no topic published');
      assert.ok(!(await view('workspaces', { limit: 100 })).items.some(item => item.title === titles.outcome), at + ': Core holds no outcome by the refused title');
      if (width === 390 && theme === 'light') {
        // The refused title's line again, and Return sends it once more: the outcome is made, and its page opens.
        await inView(p, '#outline-new-outcome', at + ': the New outcome pencil is brought into view');
        await tap(p, '#outline-new-outcome');
        await until(() => p.evaluate(`document.activeElement?.id==='outline-new-outcome-title'`), at + ': the New outcome line again, the cursor in it');
        assert.equal(await p.evaluate(`document.getElementById('outline-new-outcome-title').value`), titles.outcome, at + ': the refused title is still there');
        await p.key('Enter');
        const opened = await until(async () => { const now = await placeOf(p).catch(() => null); return now?.ready && now.title === titles.outcome && now; }, at + ': Return again makes the outcome and opens its page');
        assert.equal((await view('workspace', { workspace_id: new URLSearchParams(opened.search).get('workspace') })).workspace?.title, titles.outcome, at + ': Core holds the outcome by the title typed');
      }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // The keys across the panes (docs/interaction.md, "Keys across the panes";
  // docs/outline-order.md). Run last: they leave the person's folds as they found them.
  const swapped = (ids, id, delta) => { const next = [...ids], at = next.indexOf(id); [next[at], next[at + delta]] = [next[at + delta], next[at]]; return next; };
  const sameOrder = (saved, shown) => JSON.stringify(saved.filter(id => shown.includes(id))) === JSON.stringify(shown);
  // What the outline shows of each outcome, but its place: its count, its light and whether it is open.
  const standing = seen => ({ fresh: seen.fresh.text, waiting: seen.waiting.text,
    outcomes: Object.fromEntries(Object.entries(seen.outcomes).map(([id, o]) => [id, { open: o.open, count: o.count, lit: o.lit, topics: o.topics.map(t => t.unread).sort() }])) });

  await check('rail ⌘↑ ⌘↓ move an outcome, and a topic within its outcome, keeping the focus and saying where it went; ⌘Z puts it back; the order is the reader\'s own, kept on reload, and moves no count or light', async () => {
    await control({ method: 'light_outcome', outcome: 'rail-kbd-a', title: 'Keyed outcome', topic: { id: 'rail-kbd-a1', title: 'Keyed first' } });
    await control({ method: 'light_outcome', outcome: 'rail-kbd-a', exists: true, topic: { id: 'rail-kbd-a2', title: 'Keyed second' } });
    await control({ method: 'light_outcome', outcome: 'rail-kbd-b', title: 'Other keyed outcome', topic: { id: 'rail-kbd-b1', title: 'Other keyed topic' } });
    const agent = 'fixture-notebook-agent', agentBefore = await control({ method: 'order_as', actor: agent });
    const p = await open('rail-kbd-order', '/?topic=rail-kbd-a1');
    try {
      await settled(p, 'the topic is up');
      await until(async () => { const o = await outline(p); return o.outcomes['rail-kbd-a']?.topics.length === 2 && o.outcomes['rail-kbd-b']; }, 'the outline lists both outcomes, the one being read with its two topics');
      await tabToOutline(p);
      assert.equal(await keyedAt(p), 'topic:rail-kbd-a1', 'the one Tab stop is the topic being read');
      await p.key('ArrowLeft');
      assert.equal(await keyedAt(p), 'name:rail-kbd-a', '← on a topic goes to its outcome');
      // An outcome: up a place, or down when it is first.
      const before = await outcomeOrder(p), lights = standing(await outline(p));
      const delta = before.indexOf('rail-kbd-a') > 0 ? -1 : 1, expected = swapped(before, 'rail-kbd-a', delta);
      await p.key(delta < 0 ? 'ArrowUp' : 'ArrowDown', 4);
      await until(async () => JSON.stringify(await outcomeOrder(p)) === JSON.stringify(expected), 'the outcome moves one place');
      assert.equal(await keyedAt(p), 'name:rail-kbd-a', 'the focus stays on the outcome moved');
      assert.equal((await keyTree(p)).said, `Keyed outcome moved to ${expected.indexOf('rail-kbd-a') + 1} of ${expected.length}`, 'a screen reader hears where it went');
      await until(async () => sameOrder((await control({ method: 'order_as' })).ids, expected), 'Core keeps the order');
      assert.deepEqual(standing(await outline(p)), lights, 'the move changes no count, light or fold');
      assert.deepEqual(await control({ method: 'order_as', actor: agent }), agentBefore, 'another reader\'s order is not touched');
      // ⌘Z puts it back, here and in Core.
      await p.key('z', 4);
      await until(async () => JSON.stringify(await outcomeOrder(p)) === JSON.stringify(before), '⌘Z puts the outcome back');
      assert.equal(await keyedAt(p), 'name:rail-kbd-a', 'the focus stays on it');
      await until(async () => sameOrder((await control({ method: 'order_as' })).ids, before), 'Core keeps it put back');
      // Moved again, and kept across a reload.
      await p.key(delta < 0 ? 'ArrowUp' : 'ArrowDown', 4);
      await until(async () => sameOrder((await control({ method: 'order_as' })).ids, expected), 'the move is saved again');
      // A topic within its outcome: the topic being read, in the page's own list (→ on the open outcome would go to the messages).
      await p.key('ArrowDown');
      const topics = (await outline(p)).outcomes['rail-kbd-a'].topics.map(t => t.id);
      for (let n = 0; n < topics.length && await keyedAt(p) !== 'topic:rail-kbd-a1'; ++n) await p.key('ArrowDown');
      assert.equal(await keyedAt(p), 'topic:rail-kbd-a1', '↓ reaches the topic being read');
      const step = topics.indexOf('rail-kbd-a1') === 0 ? 1 : -1, wanted = swapped(topics, 'rail-kbd-a1', step);
      await p.key(step < 0 ? 'ArrowUp' : 'ArrowDown', 4);
      await until(async () => JSON.stringify((await outline(p)).outcomes['rail-kbd-a'].topics.map(t => t.id)) === JSON.stringify(wanted), 'the topic moves one place in its outcome');
      assert.equal(await keyedAt(p), 'topic:rail-kbd-a1', 'the focus stays on the topic moved, though its list is drawn again');
      assert.equal((await keyTree(p)).said, `Keyed first moved to ${wanted.indexOf('rail-kbd-a1') + 1} of 2`, 'a screen reader hears where the topic went');
      await until(async () => sameOrder((await control({ method: 'order_as', workspace_id: 'rail-kbd-a' })).ids, wanted), 'Core keeps the topic order');
      await p.key(step < 0 ? 'ArrowUp' : 'ArrowDown', 4);
      assert.equal((await keyTree(p)).said, `Keyed first is already ${step < 0 ? 'first' : 'last'}`, 'at the end it says so and moves nothing');
      assert.deepEqual((await outline(p)).outcomes['rail-kbd-a'].topics.map(t => t.id), wanted, 'nothing moved');
      // The other topic opens in place, and the keys stay on it.
      const start = await placeOf(p);
      await p.key(step < 0 ? 'ArrowDown' : 'ArrowUp');
      assert.equal(await keyedAt(p), 'topic:rail-kbd-a2', '↑ ↓ reach the other topic');
      await p.key('Enter');
      await arrived(p, '?topic=rail-kbd-a2', 'Keyed second', 'Return opens the topic');
      await settled(p, 'the other topic is up');
      assert.equal((await placeOf(p)).origin, start.origin, 'in place, with no load');
      await until(async () => await keyedAt(p) === 'topic:rail-kbd-a2', 'the focus is on the topic opened, after the move in place');
      // Kept across a reload, outcomes and topics alike.
      await reloaded(p, 'reload');
      await until(async () => JSON.stringify(await outcomeOrder(p)) === JSON.stringify(expected) &&
        JSON.stringify((await outline(p)).outcomes['rail-kbd-a'].topics.map(t => t.id)) === JSON.stringify(wanted), 'a reload shows the order kept');
      // Another reader's own order changes nothing of this one's.
      const agentHas = (await control({ method: 'order_as', actor: agent })).revision;
      const placed = await control({ method: 'order_as', actor: agent, ids: ['rail-kbd-b', 'rail-kbd-a'], operation_id: 'rail-kbd-agent-order' });
      assert.deepEqual([placed.ids, placed.revision], [['rail-kbd-b', 'rail-kbd-a'], agentHas + 1], 'the other reader keeps an order of their own');
      assert.ok(sameOrder((await control({ method: 'order_as' })).ids, expected), 'this reader\'s order is untouched by it');
      await reloaded(p, 'reload after the other reader placed theirs');
      assert.deepEqual(await outcomeOrder(p), expected, 'and the page shows this reader\'s');
      // The same reader places another order on another device: it shows here with no reload, and a move here starts from it.
      const elsewhere = [...expected.filter(id => id !== 'rail-kbd-a'), 'rail-kbd-a'];
      await control({ method: 'order_as', ids: elsewhere, operation_id: 'rail-kbd-other-device' });
      await until(async () => JSON.stringify(await outcomeOrder(p)) === JSON.stringify(elsewhere), 'another device\'s order shows here, live');
      await tabToOutline(p);
      await p.key('ArrowLeft');
      assert.equal(await keyedAt(p), 'name:rail-kbd-a');
      await p.key('ArrowUp', 4);
      const after = swapped(elsewhere, 'rail-kbd-a', -1);
      await until(async () => JSON.stringify(await outcomeOrder(p)) === JSON.stringify(after), 'a move here starts from it');
      await until(async () => sameOrder((await control({ method: 'order_as' })).ids, after), 'and Core takes it, with no refusal');
      assert.deepEqual(p.errors, []);
    } finally {
      await p.close();
      await control({ method: 'order_as', ids: [], operation_id: 'rail-kbd-clear' });
      await control({ method: 'order_as', workspace_id: 'rail-kbd-a', ids: [], operation_id: 'rail-kbd-clear-topics' });
      await control({ method: 'order_as', actor: agent, ids: [], operation_id: 'rail-kbd-clear-agent' });
    }
  });

  await check('rail → and ← move between the outline, the messages and the right rail, each keeping its place; ↑ ↓ ⌘→ ⌘← work in the right rail; Return opens the Reader, whose reply the keys leave alone, and Escape gives the message back', async () => {
    await control({ method: 'navigation_topics', topics: [{ id: 'rail-kbd-p2', title: 'Panes second' }] });
    const p = await open('rail-kbd-panes', '/?topic=t1');
    await settled(p, 'the topic is up');
    await until(() => p.evaluate("document.querySelectorAll('#messages [data-id]').length > 1 && Boolean(document.querySelector('#outline a[data-topic-id=rail-kbd-p2]'))"), 'the messages and the outline are drawn');
    await tabToOutline(p);
    assert.equal(await keyedAt(p), 'topic:t1');
    // → on a topic: into the messages, on the message the light is on.
    await p.key('ArrowRight');
    const first = await keyedAt(p);
    assert.match(first, /^message:/, '→ from the outline goes to the messages');
    assert.equal(await p.evaluate("document.activeElement.closest('[data-id]').classList.contains('lit')"), true, 'the message the keys are on is lit');
    await p.key('ArrowDown');
    const lit = await keyedAt(p);
    assert.ok(lit.startsWith('message:') && lit !== first, '↓ moves to the next message');
    // Plain arrows take up to two stack steps before the next press leaves.
    // Keep proving rail entry from either a standalone card or a stack.
    const leaveFeed = async key => {
      for (let step = 0; step < 3; step++) {
        await p.key(key);
        if (!(await keyedAt(p)).startsWith('message:')) return;
      }
      assert.fail(key + ' did not leave the feed after the stack boundary');
    };
    await leaveFeed('ArrowRight');
    const things = await keyedAt(p);
    assert.match(things, /^things:[a-z]+$/, '→ from the messages goes to the right rail, on a section: ' + things);
    assert.equal(await p.evaluate("Boolean(document.querySelector('#messages .lit'))"), false, 'the rail owns the highlight; the feed remembers its place without a second light');
    const sections = await p.evaluate("[...document.querySelectorAll('#things .things-sec')].filter(d=>d.checkVisibility()).map(d=>d.dataset.key)");
    // ↓ to the next section's header, past what the first holds.
    const rows = await p.evaluate("[...document.querySelectorAll('#things [role=treeitem]')].filter(e=>e.checkVisibility()).length");
    for (let n = 0; n < rows && await keyedAt(p) !== 'things:' + sections[1]; ++n) await p.key('ArrowDown');
    assert.equal(await keyedAt(p), 'things:' + sections[1], '↓ moves through the right rail to the next section');
    const sectionOpen = () => p.evaluate(`document.querySelector('#things .things-sec[data-key=${sections[1]}]').open`);
    const was = await sectionOpen();
    await p.key(was ? 'ArrowLeft' : 'ArrowRight', 4);
    await until(async () => await sectionOpen() === !was, '⌘← ⌘→ fold or open the section');
    await p.key(was ? 'ArrowRight' : 'ArrowLeft', 4);
    await until(async () => await sectionOpen() === was, 'and the other puts it back');
    assert.equal(await keyedAt(p), 'things:' + sections[1], 'the keys stay on the section');
    // ← back: an open section folds first, then the message last lit, then the topic in the outline.
    if (await sectionOpen()) { await p.key('ArrowLeft'); await until(async () => !await sectionOpen(), '← on an open section folds it'); }
    await p.key('ArrowLeft');
    assert.equal(await keyedAt(p), lit, '← from the right rail comes back to the message last lit');
    await leaveFeed('ArrowLeft');
    assert.equal(await keyedAt(p), 'topic:t1', '← from the messages comes back to the topic in the outline');
    assert.equal(await p.evaluate("Boolean(document.querySelector('#messages .lit'))"), false, 'the outline alone owns the highlight');
    // → from a topic not being read goes to the messages being read all the same, and ← comes back to the topic they are in.
    const start = await placeOf(p), topics = (await keyTree(p)).rows;
    for (let n = 0; n < topics.length && await keyedAt(p) !== 'topic:rail-kbd-p2'; ++n) await p.key(topics.indexOf('topic:rail-kbd-p2') > topics.indexOf('topic:t1') ? 'ArrowDown' : 'ArrowUp');
    await p.key('ArrowRight');
    assert.match(await keyedAt(p), /^message:/, '→ from another topic goes to the messages');
    await leaveFeed('ArrowLeft');
    assert.equal(await keyedAt(p), 'topic:t1', '← comes back to the topic being read');
    // A move in place and back: the right rail keeps its place.
    for (let n = 0; n < topics.length && await keyedAt(p) !== 'topic:rail-kbd-p2'; ++n) await p.key(topics.indexOf('topic:rail-kbd-p2') > topics.indexOf('topic:t1') ? 'ArrowDown' : 'ArrowUp');
    await p.key('Enter');
    await arrived(p, '?topic=rail-kbd-p2', 'Panes second', 'Return opens the other topic in place');
    await settled(p, 'the other topic is up');
    await until(async () => await keyedAt(p) === 'topic:rail-kbd-p2', 'the keys stay on the topic opened');
    for (let n = 0; n < topics.length && await keyedAt(p) !== 'topic:t1'; ++n) await p.key(topics.indexOf('topic:rail-kbd-p2') > topics.indexOf('topic:t1') ? 'ArrowUp' : 'ArrowDown');
    await p.key('Enter');
    await arrived(p, '?topic=t1', null, 'and back');
    await settled(p, 'the topic is up again');
    assert.equal((await placeOf(p)).origin, start.origin, 'in place, with no load');
    await until(async () => await keyedAt(p) === 'topic:t1', 'the keys stay on the topic');
    await p.key('ArrowRight');
    assert.match(await keyedAt(p), /^message:/, '→ goes to the messages again');
    await leaveFeed('ArrowRight');
    assert.equal(await keyedAt(p), 'things:' + sections[1], 'and → to the right rail, on the section it was on');
    await p.key('ArrowLeft');
    // On a dossier shown as its row, Return edits its title (item 385): the keys go on to a message of their own.
    for (let n = 0; n < 4 && await p.evaluate("Boolean(document.activeElement?.matches?.('.stack-head-card') && document.activeElement.closest('.reply-stack')?.dataset.headOpen === 'false')"); ++n) await p.key('ArrowDown');
    const back = await keyedAt(p);
    // Return on the message opens the Reader; the keys there are the writing's.
    await p.key('Enter');
    await until(() => p.evaluate("document.getElementById('reader').open && document.activeElement?.id === 'writing-body'"), 'Return opens the Reader on the reply');
    await p.send('Input.insertText', { text: 'Keys stay here' });
    const order = await outcomeOrder(p);
    for (const [name, modifiers] of [['ArrowLeft', 0], ['ArrowRight', 0], ['ArrowLeft', 4], ['ArrowRight', 4], ['ArrowUp', 4], ['ArrowDown', 4]]) {
      await p.key(name, modifiers);
      assert.equal(await keyedAt(p), 'writing-body', `${modifiers ? '⌘' : ''}${name} stays in the reply`);
    }
    assert.equal(await p.evaluate("document.getElementById('writing-body').value"), 'Keys stay here', 'the writing is as typed');
    assert.deepEqual(await outcomeOrder(p), order, 'no outcome moved');
    // Cleared, so Escape closes the Reader with nothing kept, and the focus is on the message again.
    await p.evaluate("document.getElementById('writing-body').select()");
    await p.key('Backspace');
    await p.key('Escape');
    await until(() => p.evaluate("!document.getElementById('reader').open"), 'Escape closes the Reader');
    await until(async () => await keyedAt(p) === back, 'the focus is back on the message');
    await p.key('ArrowDown');
    assert.match(await keyedAt(p), /^message:/, '↓ moves on from it');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Below 1181px the right rail opens over the dimmed page, as a panel on an
  // iPad or a sheet on a phone: the keys never act on what it covers.
  await check('rail at 900 and 390 the keys never act through the right rail open over the page: ← on it closes it and goes to a message in view; with the keys on nothing, ← ↓ and Return touch nothing under it', async () => {
    for (const [width, height] of [[900, 800], [390, 844]]) {
      const p = await page('rail-kbd-over-' + width, null, true, { url: facts.origin + '/?topic=t1', beforeNavigate: async q => {
        await q.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: width < 761 });
      } });
      await until(() => p.evaluate("document.body?.dataset.ready === 'true' && document.querySelectorAll('#messages [data-id]').length > 1 && Boolean(document.getElementById('things-open'))").catch(() => false), width + ': the topic and its messages are up');
      const opened = async () => {
        // The header may have scrolled away with the message the keys went to.
        await p.evaluate("document.getElementById('things-open').scrollIntoView({ block: 'center' })");
        await p.point('#things-open');
        await until(() => p.evaluate("document.documentElement.hasAttribute('data-things-open') && [...document.querySelectorAll('#things .things-sec')].some(d => d.checkVisibility())"), width + ': the right rail opens over the page with a section');
        // It slides in: the keys are pressed once it stands inside the window, its slide over.
        await until(() => p.evaluate("(t=>getComputedStyle(t).transform==='none'&&t.getBoundingClientRect().right<=innerWidth+0.5)(document.getElementById('things'))"), width + ': the right rail has slid into the window');
      };
      // What the keys are on, whether the rail is open, what is lit, and whether the place the keys are on can be seen there:
      // a stack's head shown as one row has no box of its own, only its row standing above it (stack-look.css), so that row is looked at.
      const seen = () => p.evaluate(`(()=>{const at=document.activeElement,card=at?.closest('#messages [data-id]'),row=card?.querySelector(':scope > .stack-head'),
        b=(card&&card.getBoundingClientRect().height===0&&row?row:card)?.getBoundingClientRect();
        const hit=b?document.elementFromPoint(b.left+b.width/2,Math.max(0,Math.min(innerHeight-1,b.top+b.height/2))):null;
        return {open:document.documentElement.hasAttribute('data-things-open'),backdrop:!document.getElementById('things-backdrop').hidden,
          inRail:Boolean(at?.closest('#rail')),visible:card?card.contains(hit):null,lit:document.querySelector('#messages [data-id].lit')?.dataset.id??null,
          reader:Boolean(document.getElementById('reader')?.open)}})()`);
      await opened();
      await p.evaluate("[...document.querySelectorAll('#things .things-sec')].find(d => d.checkVisibility()).querySelector(':scope > summary').focus()");
      assert.match(await keyedAt(p), /^things:[a-z]+$/, width + ': the keys are on a section of the right rail');
      // ← on an open section folds it, the rail still open over the page; ← on the folded section then closes the rail.
      if (await p.evaluate("document.activeElement.parentElement.open")) {
        await p.key('ArrowLeft');
        await until(() => p.evaluate("!document.activeElement.parentElement.open && document.documentElement.hasAttribute('data-things-open')"), width + ': ← folds the open section, and the rail stays open');
      }
      await p.key('ArrowLeft');
      const left = await until(async () => { const now = await seen(); return !now.open && now; }, width + ': ← closes the right rail');
      assert.match(await keyedAt(p), /^message:/, width + ': ← goes to a message');
      assert.deepEqual([left.backdrop, left.visible], [false, true], width + ': the page is no longer dimmed, and nothing covers the message the keys are on');
      // Open again, the keys on nothing (a press on its words): nothing under it moves. An arrow lands in the rail
      // open over the page, the one part not covered, as from nothing anywhere (item 301); Return does nothing.
      await opened();
      for (const key of ['ArrowLeft', 'ArrowDown', 'ArrowUp', 'Enter']) {
        await p.evaluate('document.activeElement?.blur()');
        assert.equal(await keyedAt(p), 'body', width + ': the keys are on nothing');
        const before = await seen();
        await p.key(key);
        const now = await seen();
        assert.deepEqual([now.open, now.inRail, now.lit, now.reader], [true, false, before.lit, false], `${width}: ${key} leaves the page under the right rail as it was`);
        const at = await p.evaluate("(e=>!e||e===document.body?'body':e.closest('#things')?'things':'under it: '+(e.id||e.tagName))(document.activeElement)");
        assert.equal(at, key === 'Enter' ? 'body' : 'things', `${width}: ${key} ${key === 'Enter' ? 'takes the keys nowhere' : 'lands in the right rail open over the page, never under it'}`);
      }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('rail the arrows move through the outline as a tree: ↑ ↓ Home End, ← to the outcome, ⌘← ⌘→ and ← → fold and open it, and Return opens a topic or a Conversation in place with the keys kept on the row', async () => {
    const p = await open('rail-kbd-tree', '/?topic=t1');
    await settled(p, 'the topic is up');
    assert.deepEqual(await p.evaluate("(()=>{const k=document.getElementById('outline-keys');return [k.querySelector('summary').textContent,[...k.querySelectorAll('dl')].map(l=>[...l.querySelectorAll('dt')].map(d=>d.textContent)),k.querySelector('.ol-keys-part')?.textContent]})()"),
      ['Keys', [['↑ ↓', 'Return', '⌘→ ⌘←', '⇧⌘→ ⇧⌘←', '→ ←', '⌘Return', '⌘↑ ⌘↓', '⌘Z'], ['↑ ↓', '⌘↑ ⌘↓', '→ ←', '⇧⌘↑ ⇧⌘↓', 'x', '⌘Z']], 'In the messages'],
      'the outline lists its keys, then the messages\' keys');
    await tabToOutline(p);
    assert.equal(await keyedAt(p), 'topic:t1');
    assert.equal((await keyTree(p)).ring, 'solid', 'the row the keys are on has a ring');
    const rows = (await keyTree(p)).rows, here = rows.indexOf('topic:t1');
    await p.key('ArrowDown');
    assert.equal(await keyedAt(p), rows[here + 1], '↓ is the next row');
    await p.key('ArrowUp');
    assert.equal(await keyedAt(p), 'topic:t1', '↑ the one before');
    await p.key('End');
    assert.equal(await keyedAt(p), rows.at(-1), 'End is the last row');
    await p.key('Home');
    assert.equal(await keyedAt(p), rows[0], 'Home is the first');
    const name = 'name:w1', expanded = () => p.evaluate("document.querySelector('.ol-outcome[data-workspace-id=w1] .ol-name').getAttribute('aria-expanded')");
    for (let n = 0; n < rows.length && await keyedAt(p) !== 'topic:t1'; ++n) await p.key('ArrowDown');
    // ⌘← on a topic folds its outcome, the keys on the outcome.
    await p.key('ArrowLeft', 4);
    await until(async () => await expanded() === 'false', '⌘← on a topic folds its outcome');
    assert.equal(await keyedAt(p), name, 'and the keys go to the outcome');
    assert.equal((await outline(p)).outcomes.w1.topics.length, 0, 'its topics are folded away');
    await p.key('ArrowRight', 4);
    await until(async () => await expanded() === 'true' && (await outline(p)).outcomes.w1.topics.length > 0, '⌘→ opens it');
    assert.equal(await keyedAt(p), name, 'the keys stay on it');
    await p.key('ArrowLeft');
    await until(async () => await expanded() === 'false', '← on an open outcome folds it');
    await p.key('ArrowRight');
    await until(async () => await expanded() === 'true', '→ on a folded one opens it');
    assert.equal(await keyedAt(p), name);
    await p.key('ArrowDown');
    assert.equal(await keyedAt(p), (await keyTree(p)).rows[(await keyTree(p)).rows.indexOf(name) + 1], '↓ on an open outcome goes to its first row');
    await p.key('ArrowLeft');
    assert.equal(await keyedAt(p), name, '← on a row goes to its outcome');
    // Return on the outcome opens its Conversation in place, the keys kept on it.
    const start = await placeOf(p);
    await p.key('Enter');
    await arrived(p, '?conversation=w1', null, 'Return on the outcome opens its Conversation');
    assert.equal((await placeOf(p)).origin, start.origin, 'in place, with no load');
    await until(async () => await keyedAt(p) === name, 'the keys stay on the outcome');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Where a press on an outline row leaves the keys (item 462): on the row
  // pressed, as if the keys had gone there. What the focused element wears,
  // and how many things in the two rails wear a ring.
  const pressRing = p => p.evaluate(`(()=>{const e=document.activeElement;
    return {visible:Boolean(e&&e!==document.body&&e.matches(':focus-visible')),ring:e?getComputedStyle(e).outlineStyle:null,
      rails:document.querySelectorAll('#rail :focus-visible, #things :focus-visible').length}})()`);
  // The keys on the row pressed (as keyedAt names it), wearing their ring, and nothing else in the rails ringed.
  const pressedRow = async (p, row, what) => {
    try { await until(async () => await keyedAt(p) === row, what + ': the keys are on the row pressed'); }
    catch (error) { throw Error(`${error.message}: they are on ${await keyedAt(p)}; inert ${await p.evaluate("[...document.querySelectorAll('[inert]')].map(e=>e.id||e.className||e.tagName).join(',')")}; tree ${JSON.stringify(await keyTree(p))}; drawer ${JSON.stringify(await drawer(p))}; page errors ${JSON.stringify(p.errors)}`); }
    assert.deepEqual(await pressRing(p), { visible: true, ring: 'solid', rails: 1 }, what + ': it wears the keys\' ring, and nothing else in the rails does');
  };
  // From the row the keys are on, ↓ (↑ on the last row) goes on to another row of the outline, and the other arrow comes back.
  const stepsFrom = async (p, row, what) => {
    const rows = (await keyTree(p)).rows;
    assert.ok(rows.includes(row) && rows.length > 1, what + `: ${row} is one of the outline's rows: ${rows.join(' ')}`);
    let [away, back] = ['ArrowDown', 'ArrowUp'];
    await p.key(away);
    let next = await keyedAt(p);
    if (next === row) { [away, back] = ['ArrowUp', 'ArrowDown']; await p.key(away); next = await keyedAt(p); }
    assert.ok(next !== row && rows.includes(next), `${what}: ${away === 'ArrowDown' ? '↓' : '↑'} goes on from the row to another of the outline's: ${next}`);
    await p.key(back);
    assert.equal(await keyedAt(p), row, `${what}: and ${back === 'ArrowDown' ? '↓' : '↑'} comes back to it`);
  };

  await check('rail a press on an outline row opens its place in place with the keys kept on the row, wearing their ring: ↑ and ↓ go on from it and → into the page, for another outcome, a topic and the Conversation of the outcome being read; Return keeps the keys there too; back lands on the page\'s heading with no ring; at 390 the drawer closes and opens again on the row tapped, ringed', async () => {
    await control({ method: 'light_outcome', outcome: 'rail-ring-o', title: 'Ring outcome', topic: { id: 'rail-ring-t', title: 'Ring topic' } });
    const p = await open('rail-ring', '/?topic=t1');
    await settled(p, 'the topic is up');
    await until(async () => (await outline(p)).outcomes['rail-ring-o'], 'the outline lists the other outcome');
    const start = await placeOf(p);
    // What the person would see ringed: anything in either rail that matches
    // :focus-visible, and the heading's own outline while it holds the focus.
    const rings = () => p.evaluate(`(()=>{const h=document.getElementById('topic-title');
      return {rails:[...document.querySelectorAll('#rail :focus-visible, #things :focus-visible')].map(e=>e.dataset.topicId??e.className??e.tagName),heading:getComputedStyle(h).outlineStyle}})()`);
    const name = '.ol-outcome[data-workspace-id="rail-ring-o"] .ol-name', topicRow = '#outline a[data-topic-id="rail-ring-t"]';
    // Another outcome's row: its Conversation opens in place, its topics under it, and the keys are on its row.
    await press(p, name);
    assert.equal((await arrived(p, '?conversation=rail-ring-o', null, 'the Conversation opens')).origin, start.origin, 'in place, with no load');
    await pressedRow(p, 'name:rail-ring-o', 'another outcome');
    await until(async () => (await outline(p)).outcomes['rail-ring-o'].topics.some(row => row.id === 'rail-ring-t'), 'its topic shows under it');
    await stepsFrom(p, 'name:rail-ring-o', 'another outcome');
    // → on the open outcome lands on its pencil (item 305); the next goes on into the page reached: its Conversation's messages, or the page itself while it has none.
    await p.key('ArrowRight');
    assert.equal(await keyedAt(p), 'outline:ol-pencil-rail-ring-o', 'another outcome: → lands on its pencil');
    await p.key('ArrowRight');
    assert.match(await keyedAt(p), /^(message:|main$)/, 'another outcome: the next → goes into the Conversation');
    // A topic: it opens in place, and the keys are on its row, drawn again for the page reached.
    await press(p, topicRow);
    assert.equal((await arrived(p, '?topic=rail-ring-t', 'Ring topic', 'the topic opens')).origin, start.origin, 'in place');
    await settled(p, 'the topic\'s list is in the outline');
    await pressedRow(p, 'topic:rail-ring-t', 'a topic');
    await stepsFrom(p, 'topic:rail-ring-t', 'a topic');
    await p.key('ArrowRight');
    assert.match(await keyedAt(p), /^message:/, 'a topic: → goes into its messages');
    // The Conversation of the outcome being read, from one of its topics: it opens, its topics fold (item 320), and the keys are on its row.
    await press(p, name);
    await arrived(p, '?conversation=rail-ring-o', null, 'the Conversation opens again');
    await pressedRow(p, 'name:rail-ring-o', 'the Conversation');
    assert.equal((await outline(p)).outcomes['rail-ring-o'].open, false, 'the Conversation: its topics folded');
    await stepsFrom(p, 'name:rail-ring-o', 'the Conversation');
    // → on the folded outcome opens it, as the keys' → does; the next → lands on its pencil (item 305), and the next goes into the page.
    await p.key('ArrowRight');
    await until(async () => (await outline(p)).outcomes['rail-ring-o'].open, 'the Conversation: → opens its topics');
    assert.equal(await keyedAt(p), 'name:rail-ring-o', 'the Conversation: the keys stay on its row');
    await p.key('ArrowRight');
    assert.equal(await keyedAt(p), 'outline:ol-pencil-rail-ring-o', 'the Conversation: the next → lands on its pencil');
    await p.key('ArrowRight');
    assert.match(await keyedAt(p), /^(message:|main$)/, 'the Conversation: the next → goes into the page');
    // The keys, as before: ← into the outline on the place being read, ↓ to the topic, Return opens it with the keys kept on its row.
    await p.key('ArrowLeft');
    assert.equal(await keyedAt(p), 'name:rail-ring-o', '← goes to the outline, on the Conversation being read');
    await until(async () => (await outline(p)).outcomes['rail-ring-o'].topics.some(row => row.id === 'rail-ring-t'), 'its topic shows under it');
    const returnTo = async what => {
      await until(async () => (await keyTree(p)).rows.includes('topic:rail-ring-t'), what + ': its topic is drawn under it');
      await settled(p, what + ': the outline\'s reads have landed');
      const before = await keyTree(p);
      await p.key('ArrowDown');
      // Between an open outcome and its first topic is its pencil (item 305).
      assert.equal(await keyedAt(p), 'outline:ol-pencil-rail-ring-o', `${what}: ↓ from the outcome is its pencil; the tree before ${JSON.stringify(before)}, after ${JSON.stringify(await keyTree(p))}`);
      await p.key('ArrowDown');
      const at = await keyedAt(p);
      assert.equal(at, 'topic:rail-ring-t', `${what}: ↓ goes to the topic; the tree before ${JSON.stringify(before)}, after ${JSON.stringify(await keyTree(p))}`);
      await p.key('Enter');
      await arrived(p, '?topic=rail-ring-t', 'Ring topic', what);
      await settled(p, 'the topic is up again');
      await until(async () => await keyedAt(p) === 'topic:rail-ring-t', 'the keys stay on the topic\'s row');
      assert.equal((await keyTree(p)).ring, 'solid', 'with its ring');
    };
    await returnTo('Return on the topic opens it');
    // Return on the outcome's row: its Conversation, the keys kept on its row.
    // Between an open outcome and its first topic is its pencil (item 305).
    await p.key('ArrowUp');
    assert.equal(await keyedAt(p), 'outline:ol-pencil-rail-ring-o', '↑ from the first topic is the outcome\'s pencil');
    await p.key('ArrowUp');
    assert.equal(await keyedAt(p), 'name:rail-ring-o');
    await p.key('Enter');
    await arrived(p, '?conversation=rail-ring-o', null, 'Return on the outcome opens its Conversation');
    await settled(p, 'the Conversation is up');
    await until(async () => await keyedAt(p) === 'name:rail-ring-o', 'the keys stay on the outcome\'s row');
    await returnTo('Return on the topic opens it again');
    assert.equal((await placeOf(p)).origin, start.origin, 'every move in place');
    // Back lands as a load does: the focus leaves the rail for the heading of the page reached, which wears no ring.
    await p.evaluate('history.back()');
    await arrived(p, '?conversation=rail-ring-o', null, 'back to the Conversation');
    assert.equal(await keyedAt(p), 'topic-title', 'back puts the focus on the heading, not the row the keys were on');
    assert.deepEqual(await rings(), { rails: [], heading: 'none' }, 'and nothing wears a ring');
    // A key that moves nothing (Escape) then rings nothing.
    await p.key('Escape');
    assert.deepEqual([await keyedAt(p), await rings()], ['topic-title', { rails: [], heading: 'none' }], 'after a key, still no ring in the rails or on the heading');
    // ← from the heading takes the keys into the outline, on the place being read, with its ring.
    await p.key('ArrowLeft');
    assert.equal(await keyedAt(p), 'name:rail-ring-o', '← from the heading goes to the outline, on the Conversation\'s row');
    assert.equal((await keyTree(p)).ring, 'solid', 'which wears the keys\' ring');
    // Forward lands the same way; ↓ from the heading then lights a message, as on a fresh page, and rings nothing in the rails.
    await p.evaluate('history.forward()');
    await arrived(p, '?topic=rail-ring-t', 'Ring topic', 'forward to the topic');
    assert.equal(await keyedAt(p), 'topic-title', 'forward puts the focus on the heading');
    await settled(p, 'the topic is up once more');
    await p.key('ArrowDown');
    assert.match(await keyedAt(p), /^message:/, '↓ from the heading lights a message, as on a fresh page');
    assert.deepEqual((await rings()).rails, [], 'and rings nothing in the rails');
    assert.deepEqual(p.errors, []); await p.close();
    // At 390 a tap on a row in the drawer opens its place and the drawer closes, as before: a closed drawer shows
    // none of its rows, so the focus is on the heading, not "☰ Outcomes". Opened again, it is on the row tapped, ringed.
    const phone = await open('rail-ring-phone', '/?topic=t1', 'phone');
    // The right rail reads nothing at 390 until it is opened, so the page is up once its own list is in the outline.
    await until(() => phone.evaluate("document.body?.dataset.ready==='true' && Boolean(document.querySelector('#outline #topic-navigation'))").catch(() => false), 'the topic is up at 390');
    await until(async () => (await outline(phone)).outcomes['rail-ring-o'], 'the drawer lists the other outcome');
    await tap(phone, '#rail-open');
    await until(async () => (await drawer(phone)).open, '"☰ Outcomes" opens the drawer');
    await phone.evaluate(`document.querySelector('${name}').scrollIntoView({block:'center'})`);
    await tap(phone, name);
    await arrived(phone, '?conversation=rail-ring-o', null, 'the tapped outcome\'s Conversation opens');
    assert.equal((await drawer(phone)).open, false, 'the drawer is closed');
    assert.equal(await keyedAt(phone), 'topic-title', 'the focus is on the Conversation\'s heading');
    await tap(phone, '#rail-open');
    await until(async () => (await drawer(phone)).open, '"☰ Outcomes" opens the drawer again');
    await pressedRow(phone, 'name:rail-ring-o', 'at 390, the drawer opened again');
    await shot(phone, 'rail-pressed-row-drawer');
    assert.deepEqual(phone.errors, []); await phone.close();
  });

  // Item 462: the ring a pressed row wears, at each width the page is drawn for, light and dark.
  await check('rail the row a press selects wears the keys\' ring at 320, 375, 390 and 1280, light and dark: on a laptop the row clicked, on a phone the drawer opened again on the row tapped, whole and with no sideways scroll', async () => {
    await control({ method: 'navigation_topics', topics: [{ id: 'rail-width-t', title: 'Width topic' }] });
    const row = '#outline a[data-topic-id="rail-width-t"]';
    const fits = p => p.evaluate(`(()=>{const r=document.activeElement.getBoundingClientRect();
      return {whole:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,sideways:document.documentElement.scrollWidth>innerWidth}})()`);
    for (const size of ['w320', 'w375', 'phone', 'laptop']) for (const theme of ['light', 'dark']) {
      const what = `${SIZES[size].width} ${theme}`, p = await open(`rail-ring-${size}-${theme}`, '/?topic=t1', size, theme);
      if (size === 'laptop') {
        await settled(p, what + ': the topic is up');
        await until(() => p.evaluate(`Boolean(document.querySelector('${row}')?.getClientRects().length)`), what + ': the outline lists the other topic');
        await press(p, row);
        await arrived(p, '?topic=rail-width-t', 'Width topic', what + ': the topic clicked opens');
      } else {
        await until(() => p.evaluate("document.body?.dataset.ready==='true' && Boolean(document.querySelector('#outline #topic-navigation'))").catch(() => false), what + ': the topic is up');
        await tap(p, '#rail-open');
        await until(async () => (await drawer(p)).open, what + ': "☰ Outcomes" opens the drawer');
        await p.evaluate(`document.querySelector('${row}').scrollIntoView({block:'center'})`);
        await tap(p, row);
        await arrived(p, '?topic=rail-width-t', 'Width topic', what + ': the topic tapped opens');
        await until(async () => !(await drawer(p)).open, what + ': the drawer closes');
        await until(async () => await keyedAt(p) === 'topic-title', what + ': the focus is on the page\'s heading, not on a row the closed drawer hides');
        // The drawer opens again once the page reached is up: while the move holds the outline inert, nothing in it takes the focus.
        await until(() => p.evaluate("document.body?.dataset.ready==='true' && !document.documentElement.hasAttribute('data-rails-reading') && !document.querySelector('#outline')?.closest('[inert]')"), what + ': the page reached is up, the outline no longer inert');
        await tap(p, '#rail-open');
        await until(async () => (await drawer(p)).open, what + ': "☰ Outcomes" opens the drawer again');
      }
      await pressedRow(p, 'topic:rail-width-t', what);
      assert.deepEqual(await fits(p), { whole: true, sideways: false }, what + ': the ringed row is whole in view, with no sideways scroll');
      await shot(p, `rail-pressed-row-${SIZES[size].width}-${theme}`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('rail a press on a right-rail row that moves in place puts the focus on the page reached, with no ring, so Space rings nothing; Return on the row keeps the keys on it, with its ring', async () => {
    // A piece being built on another topic of w1: the Conversation's right rail lists it under Pipeline, Now.
    const pipeline = (operation, kind, target, args) => control({ method: 'pipeline', kind, operation_id: 'rail-things-press-' + operation, target, args });
    await control({ method: 'navigation_topics', topics: [{ id: 'rv-pipe-t', title: 'Piece topic' }] });
    await pipeline('on', 'pipeline.configure', { workspace_id: 'w1' }, { enabled: true });
    try {
      await pipeline('stages', 'pipeline.stages_set', { workspace_id: 'w1' }, { stages: [{ stage_id: 'build', name: 'Build' }] });
      const { result: { number } } = await pipeline('item', 'pipeline.item_add', { workspace_id: 'w1' }, { title: 'Piece on its topic', section: 'now', size: 'small', sources: [{ note: 'the check' }] });
      await pipeline('start', 'pipeline.piece_start', { workspace_id: 'w1' }, { numbers: [number], topic_id: 'rv-pipe-t', stage_id: 'build' });
      const row = '#things [data-key=pipeline] a.row[href="?topic=rv-pipe-t"]', name = 'things:pipeline:?topic=rv-pipe-t';
      const p = await open('rail-things-press', '/?conversation=w1');
      await settled(p, 'the Conversation is up');
      await until(() => p.evaluate(`Boolean(document.querySelector('${row}')?.checkVisibility())`), 'the right rail lists the piece under Now');
      const start = await placeOf(p);
      // What the person would see ringed: anything in either rail that matches :focus-visible, and the heading's own outline.
      const rings = () => p.evaluate(`(()=>{const h=document.getElementById('topic-title');
        return {rails:[...document.querySelectorAll('#rail :focus-visible, #things :focus-visible')].map(e=>e.getAttribute('href')??e.dataset.topicId??e.className??e.tagName),heading:getComputedStyle(h).outlineStyle}})()`);
      // The mouse: the piece's topic opens in place, the focus on its heading; Space, a key that scrolls, then rings nothing.
      await p.evaluate(`document.querySelector('${row}').scrollIntoView({block:'center'})`);
      await p.point(row);
      assert.equal((await arrived(p, '?topic=rv-pipe-t', 'Piece topic', 'the piece\'s topic opens')).origin, start.origin, 'in place, with no load');
      // Once both rails have drawn the topic, so a rail that took the focus back would have done so.
      await settled(p, 'the topic is up');
      assert.equal(await keyedAt(p), 'topic-title', 'the focus is on the topic\'s heading, not the row pressed');
      assert.deepEqual(await rings(), { rails: [], heading: 'none' }, 'nothing wears a ring');
      await p.key(' ');
      assert.equal(await keyedAt(p), 'topic-title', 'Space leaves the focus on the heading');
      assert.deepEqual(await rings(), { rails: [], heading: 'none' }, 'after Space, still no ring in the rails or on the heading');
      // Back to the Conversation; → from its heading goes to the right rail, Home and ↓ reach the row.
      await p.evaluate('history.back()');
      await arrived(p, '?conversation=w1', null, 'back to the Conversation');
      await settled(p, 'the Conversation is up again');
      await until(() => p.evaluate(`Boolean(document.querySelector('${row}')?.checkVisibility())`), 'the row is listed again');
      await p.key('ArrowRight');
      assert.match(await keyedAt(p), /^things:/, '→ from the heading goes to the right rail');
      await p.key('Home');
      const rows = await p.evaluate("[...document.querySelectorAll('#things [role=treeitem]')].filter(e=>e.checkVisibility()).length");
      for (let n = 0; n < rows && await keyedAt(p) !== name; ++n) await p.key('ArrowDown');
      assert.equal(await keyedAt(p), name, '↓ reaches the piece\'s row');
      // Return: the topic opens in place, and the keys stay on the row, with its ring.
      await p.key('Enter');
      await arrived(p, '?topic=rv-pipe-t', 'Piece topic', 'Return on the row opens the topic');
      await settled(p, 'the topic is up');
      await until(async () => await keyedAt(p) === name, 'the keys stay on the row');
      assert.deepEqual(await rings(), { rails: ['?topic=rv-pipe-t'], heading: 'none' }, 'the row wears the keys\' ring, and nothing else does');
      assert.equal((await placeOf(p)).origin, start.origin, 'every move in place');
      assert.deepEqual(p.errors, []); await p.close();
    } finally {
      await pipeline('off', 'pipeline.configure', { workspace_id: 'w1' }, { enabled: false });
    }
  });

  // A row drawn again takes the focus back wearing the ring the row that went
  // wore, and no other (key-tree.mjs): the outline's pressed row is ringed
  // (above), and a mouse press in the right rail rings nothing, before or after.
  await check('rail a mouse press in the right rail rings nothing, nor once its section draws again: Unstar on one of two starred messages leaves no ring on the Unstar drawn after it', async () => {
    await control({ method: 'navigation_topics', topics: [{ id: 'rail-unstar-t', title: 'Unstar topic' }] });
    const starred = [];
    for (const n of [1, 2]) {
      const id = (await control({ method: 'agent_message', operation_id: 'rail-unstar-' + n, topic_id: 'rail-unstar-t', whole_topic: true, sender: 'person', body: `Unstar message ${n}.` })).result.message_id;
      starred.push(id);
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: id, operation_id: 'rail-unstar-star-' + n, args: { starred: true } });
    }
    // The stars are this case's own: whatever state they are left in, both come off before it ends, so no later
    // case finds a Starred section above the right rail's others (the Home case lands on the first section).
    try {
      const p = await open('rail-unstar', '/?topic=rail-unstar-t', 'laptop', 'dark');
      await settled(p, 'the topic is up');
      const unstar = '#things .things-sec[data-key=starred] .things-unstar';
      const count = () => p.evaluate(`[...document.querySelectorAll('${unstar}')].filter(e=>e.checkVisibility()).length`);
      await until(async () => await count() === 2, 'the right rail lists both stars, each with its Unstar');
      // Where the focus is, whether it wears a ring, and how many things in the rails do.
      const seen = () => p.evaluate(`(()=>{const e=document.activeElement;
        return {unstar:Boolean(e?.matches?.('${unstar}')),visible:Boolean(e&&e!==document.body&&e.matches(':focus-visible')),rails:document.querySelectorAll('#rail :focus-visible, #things :focus-visible').length}})()`);
      await p.evaluate(`document.querySelector('${unstar}').scrollIntoView({block:'center'})`);
      await p.point(unstar);
      // The section draws again with the one star left; the tree puts back, in the same task, any focus that went with the first Unstar.
      await until(async () => await count() === 1, 'Unstar takes the first star off, and the section draws again');
      const after = await seen();
      // Chrome focuses the button pressed, and the tree hands that focus to the Unstar left; WebKit gives a pressed button no focus.
      assert.deepEqual({ visible: after.visible, rails: after.rails }, { visible: false, rails: 0 }, `after a mouse Unstar nothing in the rails wears a ring: ${JSON.stringify(after)}`);
      await shot(p, 'rail-unstar-no-ring-1280-dark');
      // The keys still ring: Tab and Shift-Tab come back to an Unstar wearing its ring, so the check above is no rail that rings nothing at all.
      if (after.unstar) {
        await p.key('Tab'); await p.key('Tab', 8);
        assert.deepEqual(await seen(), { unstar: true, visible: true, rails: 1 }, 'the keys bring the ring back to the Unstar');
      }
      assert.deepEqual(p.errors, []); await p.close();
    } finally {
      for (const [n, id] of starred.entries()) await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: id, operation_id: 'rail-unstar-unstar-' + (n + 1), args: { starred: false } });
    }
  });

  // The phone's drawer opens on the row a tap chose only while that tap is the
  // person's last choice: a move begun elsewhere (back, forward, a link in the
  // page) opens it on the place being read, with no ring, as a fresh page has it.
  await check('rail at 390 the drawer opens on the place being read, with no ring, after a move the outline did not begin: back, forward and a link in the page; a tap on a row there chooses it again, ringed', async () => {
    await control({ method: 'navigation_topics', topics: [{ id: 'rail-back-a', title: 'Back topic A' }] });
    await control({ method: 'agent_message', operation_id: 'rail-back-link', topic_id: 'rail-back-a', whole_topic: true, sender: 'person', body: `Back to ${facts.origin}/?topic=t1 from here.` });
    const p = await open('rail-back-phone', '/?topic=t1', 'phone');
    // Up at 390, the outline no longer inert: the right rail reads nothing there until it is opened.
    const up = what => until(() => p.evaluate("document.body?.dataset.ready==='true' && !document.documentElement.hasAttribute('data-rails-reading') && Boolean(document.querySelector('#outline #topic-navigation')) && !document.querySelector('#outline')?.closest('[inert]')").catch(() => false), what);
    await up('the topic is up at 390');
    const row = '#outline a[data-topic-id="rail-back-a"]';
    await until(() => p.evaluate(`Boolean(document.querySelector('${row}'))`), 'the outline lists topic A');
    const openDrawer = async what => { await tap(p, '#rail-open'); await until(async () => (await drawer(p)).open, what + ': "☰ Outcomes" opens the drawer'); };
    const closeDrawer = async what => { await p.key('Escape'); await until(async () => !(await drawer(p)).open, what + ': Escape closes the drawer'); };
    const tapRow = async (selector, search, title, what) => {
      await p.evaluate(`document.querySelector('${selector}').scrollIntoView({block:'center'})`);
      await tap(p, selector);
      await arrived(p, search, title, what);
      await until(async () => !(await drawer(p)).open, what + ': the drawer closes');
      await up(what + ': the page reached is up');
    };
    // The drawer opened on the row of the topic being read, which wears no ring, and nothing else in the rails does.
    const onReading = async (topic, what) => {
      const at = await keyedAt(p), ring = await pressRing(p), current = await p.evaluate("document.activeElement?.getAttribute('aria-current')");
      assert.deepEqual({ at, current, visible: ring.visible, rails: ring.rails }, { at: 'topic:' + topic, current: 'page', visible: false, rails: 0 }, `${what}: the drawer opens on the topic being read, with no ring`);
    };
    // A tap chooses topic A; back, and the drawer opens on t1, the page being read.
    await openDrawer('first');
    await tapRow(row, '?topic=rail-back-a', 'Back topic A', 'a tap on topic A');
    await p.evaluate('history.back()');
    await arrived(p, '?topic=t1', null, 'back to t1');
    await up('t1 is up again');
    await openDrawer('after back');
    await onReading('t1', 'after back');
    await shot(p, 'rail-drawer-after-back-390-light');
    await closeDrawer('after back');
    // Forward, to topic A again: the drawer opens on its row, the page being read, with no ring, since no tap chose it this time.
    await p.evaluate('history.forward()');
    await arrived(p, '?topic=rail-back-a', 'Back topic A', 'forward to topic A');
    await up('topic A is up again');
    await openDrawer('after forward');
    await onReading('rail-back-a', 'after forward');
    await closeDrawer('after forward');
    // A link in the page, back to t1.
    const link = '#messages a.words-link[href$="topic=t1"]';
    await until(() => p.evaluate(`Boolean(document.querySelector('${link}')?.checkVisibility())`), 'topic A\'s message links to t1');
    await tapRow(link, '?topic=t1', null, 'a tap on the link to t1');
    await openDrawer('after a link in the page');
    await onReading('t1', 'after a link in the page');
    // A tap on a row in the drawer is the person's choice again: opened again, the drawer is on it, ringed.
    await tapRow(row, '?topic=rail-back-a', 'Back topic A', 'a tap on topic A again');
    await openDrawer('after a tap again');
    await pressedRow(p, 'topic:rail-back-a', 'after a tap again');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // The Reader gives the focus back wearing the ring its opener wore as that
  // opening found it: one the keys opened, and then the mouse, from the same
  // message, after the focus had gone elsewhere, so the press rang nothing.
  await check('rail the Reader gives its opener back ringed only as this opening found it: opened by the keys, Escape rings the message; the focus gone elsewhere, opened then by the mouse from the same message and closed with the mouse, nothing is ringed', async () => {
    const p = await open('rail-reader-ring', '/?topic=t1');
    await settled(p, 'the topic is up');
    await until(() => p.evaluate("document.querySelectorAll('#messages [data-id]').length > 1"), 'the messages are drawn');
    await tabToOutline(p);
    await p.key('ArrowRight');
    // On a dossier shown as its row, Return edits its title (item 385): the keys go on to a message of their own.
    for (let n = 0; n < 4 && await p.evaluate("Boolean(document.activeElement?.matches?.('.stack-head-card') && document.activeElement.closest('.reply-stack')?.dataset.headOpen === 'false')"); ++n) await p.key('ArrowDown');
    const message = await keyedAt(p);
    assert.match(message, /^message:/, '→ from the outline goes to a message');
    const focusVisible = () => p.evaluate("Boolean(document.activeElement&&document.activeElement!==document.body&&document.activeElement.matches(':focus-visible'))");
    const readerOpen = () => p.evaluate("document.getElementById('reader').open");
    // The keys: Return opens the Reader, Escape closes it, and the message has the focus back with its ring.
    await p.key('Enter');
    await until(readerOpen, 'Return opens the Reader');
    await p.key('Escape');
    await until(async () => !await readerOpen(), 'Escape closes the Reader');
    await until(async () => await keyedAt(p) === message, 'the keys are back on the message');
    assert.equal(await focusVisible(), true, 'opened and closed by the keys, the message wears their ring');
    // The mouse: the focus goes elsewhere (a press on the page's heading), then a
    // press on the same message opens the Reader, and ✕ pressed closes it.
    const opener = await p.evaluate(`(()=>{const e=document.activeElement;e.dataset.ringProbe='opener';return e.tagName})()`);
    assert.ok(opener, 'the message the keys are on is marked to press');
    await p.point('#topic-title');
    await until(async () => await keyedAt(p) !== message, 'a press on the heading takes the focus off the message');
    await p.point('[data-ring-probe=opener]');
    await until(readerOpen, 'a press on the message opens the Reader');
    await p.point('#reader-close');
    await until(async () => !await readerOpen(), '✕ closes the Reader');
    await until(async () => await keyedAt(p) === message, 'the focus is back on the message');
    assert.equal(await focusVisible(), false, 'opened and closed by the mouse, the message wears no ring, whatever the keys\' opening wore');
    assert.deepEqual(await p.evaluate("document.querySelectorAll(':focus-visible').length"), 0, 'and nothing else does');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // ---- Keyboard polish (items 288-292) ----
  // What the person would see ringed in the rails, by keyedAt's names for the
  // rails' rows, and whether the focused element wears a ring itself.
  const railRings = p => p.evaluate(`[...document.querySelectorAll('#rail :focus-visible, #things :focus-visible')].map(e=>e.getAttribute('href')??e.dataset.topicId??e.className??e.tagName)`);
  const ringed = p => p.evaluate('getComputedStyle(document.activeElement).outlineStyle');

  await check('rail → on a folded outcome opens it, the next → lands on its pencil with a ring, and the next goes into the messages; Return on the pencil opens the New topic line; ↑ from the first outcome lands on the Outcomes pencil, where Return opens the New outcome line', async () => {
    const p = await open('rail-open-right', '/?topic=t1');
    await settled(p, 'the topic is up');
    await keysTo(p, 'name:w1');
    const expanded = () => p.evaluate("document.querySelector('.ol-outcome[data-workspace-id=w1] .ol-name').getAttribute('aria-expanded')");
    // What has the keys, with its ring and how much of it shows.
    const keyed = () => p.evaluate(`(()=>{const e=document.activeElement;return {id:e.id,ring:getComputedStyle(e).outlineStyle,shown:Number(getComputedStyle(e).opacity)}})()`);
    // The keys on an outcome's name show its pencil, and no other's.
    const shownPencils = () => p.evaluate(`[...document.querySelectorAll('#outline .ol-pencil')].filter(e=>e.getClientRects().length&&Number(getComputedStyle(e).opacity)>0).map(e=>e.id)`);
    await p.point('#topic-title', 'move');
    assert.deepEqual(await shownPencils(), ['ol-pencil-w1'], 'the keys on the outcome\'s name show its pencil, and only its');
    // ← folds it; → opens it and shows its topics, the keys kept on it.
    await p.key('ArrowLeft');
    await until(async () => await expanded() === 'false', '← folds the open outcome');
    // Folded, its pencil is no row of the tree, and says it is none, though the keys on the name still show it.
    assert.deepEqual([(await keyTree(p)).rows.includes('outline:ol-pencil-w1'), await p.evaluate("document.getElementById('ol-pencil-w1').getAttribute('role')"), await shownPencils()],
      [false, null, ['ol-pencil-w1']], 'folded, the outcome\'s pencil is no row of the tree and says it is none; the keys on its name still show it');
    await p.key('ArrowRight');
    await until(async () => await expanded() === 'true' && (await outline(p)).outcomes.w1.topics.length > 0, '→ on the folded outcome opens it and shows its topics');
    assert.equal(await keyedAt(p), 'name:w1', 'and the keys stay on it, not in the messages');
    // The next → lands on its pencil, which shows with a ring; the outcome stays open.
    await p.key('ArrowRight');
    assert.deepEqual(await keyed(), { id: 'ol-pencil-w1', ring: 'solid', shown: 1 }, 'the next → lands on its pencil, shown and ringed');
    assert.equal(await expanded(), 'true', 'and leaves the outcome open');
    // Return on the pencil opens the New topic line under the outcome, the cursor in it; Escape gives the pencil back.
    await p.key('Enter');
    await until(() => p.evaluate("document.activeElement?.id==='ol-new-topic-w1'"), 'Return on the pencil opens the New topic line, the cursor in it');
    assert.equal(await placeOf(p).then(at => at.search), '?topic=t1', 'and the page stays where it was');
    await p.key('Escape');
    await until(() => p.evaluate("!document.getElementById('ol-new-topic-w1') && document.activeElement?.id==='ol-pencil-w1'"), 'Escape closes the line and gives the pencil the keys');
    // The next → goes on into the messages; ← comes back to the topic being read.
    await p.key('ArrowRight');
    assert.match(await keyedAt(p), /^message:/, 'the next → goes into the messages');
    assert.equal(await expanded(), 'true', 'and leaves the outcome open');
    await p.key('ArrowLeft');
    assert.equal(await keyedAt(p), 'topic:t1', '← from the messages comes back to the topic being read');
    // ↑ from the first outcome lands on the Outcomes heading's pencil, shown and ringed; ↓ goes back.
    const first = (await outcomeOrder(p))[0];
    for (let n = 0; n < 40 && await keyedAt(p) !== 'name:' + first; ++n) await p.key('ArrowUp');
    assert.equal(await keyedAt(p), 'name:' + first, '↑ reaches the first outcome');
    await p.key('ArrowUp');
    assert.deepEqual(await keyed(), { id: 'outline-new-outcome', ring: 'solid', shown: 1 }, '↑ from the first outcome lands on the Outcomes pencil, shown and ringed');
    assert.deepEqual((await keyTree(p)).rows[0], 'outline:outline-new-outcome', 'the first row of the outline\'s tree');
    await p.key('ArrowDown');
    assert.equal(await keyedAt(p), 'name:' + first, '↓ goes back to the first outcome');
    await p.key('ArrowUp');
    // Return there opens the New outcome line under the heading, the cursor in it.
    await p.key('Enter');
    await until(() => p.evaluate("document.activeElement?.id==='outline-new-outcome-title'"), 'Return on the Outcomes pencil opens the New outcome line, the cursor in it');
    assert.equal(await p.evaluate("document.getElementById('outline-new-outcome').getAttribute('aria-expanded')"), 'true');
    await p.key('Escape');
    await until(() => p.evaluate("!document.getElementById('outline-new-outcome-title') && document.activeElement?.id==='outline-new-outcome'"), 'Escape closes it and gives the pencil the keys');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail on a laptop each pencil is quiet until the pointer is on its row or heading: then it shows, and a press opens the New topic line under the row, opening and folding nothing, and Return starts the topic in that outcome; no + New topic row is left, and the outcome page keeps its own New topic, light and dark', async () => {
    await control({ method: 'light_outcome', outcome: 'rail-pencil', title: 'Pencil outcome', topic: { id: 'rail-pencil-t', title: 'Pencil topic' } });
    const titles = Object.fromEntries((await view('workspaces', { limit: 100 })).items.map(item => [item.id, item.title]));
    const showing = drawn => [...(drawn.heading.shown ? ['heading'] : []), ...Object.entries(drawn.outcomes).filter(([, pen]) => pen.shown).map(([id]) => id)];
    const hover = async selector => { await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`); await p.point(selector, 'move'); };
    const opened = () => p.evaluate(`({search:location.search,open:[...document.querySelectorAll('#outline .ol-outcome')].filter(li=>li.hasAttribute('data-open')).map(li=>li.dataset.workspaceId)})`);
    const lineUnder = id => p.evaluate(`(()=>{const l=document.getElementById('ol-new-topic-${id}');return Boolean(l)&&document.activeElement===l&&document.querySelector('.ol-outcome[data-workspace-id="${id}"] .ol-row').nextElementSibling===l.closest('.one-line')})()`);
    let p;
    for (const theme of ['light', 'dark']) {
      p = await open('rail-pencil-' + theme, '/?topic=t1', 'laptop', theme);
      await settled(p, theme + ': the topic is up');
      await until(() => p.evaluate("Boolean(document.querySelector('#outline .ol-outcome[data-workspace-id=rail-pencil]'))"), theme + ': the outline lists the second outcome');
      // The pointer off the outline and the keys in none of it: no pencil shows, though each is there, 44px, named, with its tooltip.
      await p.point('#topic-title', 'move');
      let drawn = await pencils(p);
      assert.ok(drawn.heading && drawn.outcomes.w1 && drawn.outcomes['rail-pencil'], theme + ': the heading and each outcome have a pencil: ' + JSON.stringify(drawn));
      assert.deepEqual(showing(drawn), [], theme + ': with the pointer off the outline and the keys elsewhere, no pencil shows: ' + JSON.stringify(drawn));
      assert.deepEqual([drawn.plusRows, drawn.pageButton], [0, false], theme + ': no + New topic row is left in the outline, nor the page\'s own New topic');
      for (const [id, pen] of [['heading', drawn.heading], ...Object.entries(drawn.outcomes)]) {
        assert.deepEqual([pen.width >= 44, pen.height >= 44, pen.glyph, pen.inRail], [true, true, true, true], `${theme}: ${id}'s pencil is 44px, New message's glyph, in the rail: ${JSON.stringify(pen)}`);
        if (id !== 'heading') assert.deepEqual([pen.besideName, pen.label, pen.tip], [true, `New topic in ${titles[id]}`, 'New topic'], `${theme}: ${id}'s pencil sits beside its name, named and with its tooltip: ${JSON.stringify(pen)}`);
      }
      assert.deepEqual([drawn.heading.label, drawn.heading.tip], ['New outcome', 'New outcome'], theme + ': the heading\'s pencil is New outcome');
      assert.equal((await keyTree(p)).stops, 1, theme + ': the pencils, a folded outcome\'s too, leave the outline one Tab stop');
      // The pointer on a folded outcome's row shows its pencil, and only its; on the heading, the heading's.
      await hover('.ol-outcome[data-workspace-id="rail-pencil"] .ol-name');
      assert.deepEqual(showing(await pencils(p)), ['rail-pencil'], theme + ': the pointer on a folded outcome shows its pencil, and only its');
      await shot(p, 'rail-pencil-hover-' + theme);
      await hover('#outline-heading');
      assert.deepEqual(showing(await pencils(p)), ['heading'], theme + ': the pointer on the heading shows its pencil, and only its');
      await shot(p, 'rail-pencil-heading-' + theme);
      // A press on the open outcome's pencil opens its line under its row; it stays open, and a second press closes the line.
      const before = await opened();
      assert.deepEqual(before, { search: '?topic=t1', open: ['w1'] }, theme + ': only the outcome being read is open');
      await press(p, '#ol-pencil-w1');
      await until(() => lineUnder('w1'), theme + ': a press on the open outcome\'s pencil opens its New topic line under its row, focused');
      assert.deepEqual(await opened(), before, theme + ': and folds nothing');
      await press(p, '#ol-pencil-w1');
      await until(() => p.evaluate("!document.getElementById('ol-new-topic-w1')"), theme + ': a second press closes the line');
      assert.deepEqual(await opened(), before, theme + ': and still folds nothing');
      // A press on a folded outcome's pencil opens its line under its row; it stays folded and the page stays.
      await press(p, '#ol-pencil-rail-pencil');
      await until(() => lineUnder('rail-pencil'), theme + ': a press on the folded outcome\'s pencil opens its New topic line under its row, focused');
      assert.deepEqual(await opened(), before, theme + ': and opens nothing');
      // With the pointer gone, the pencil shows while its line is open.
      await p.point('#topic-title', 'move');
      drawn = await pencils(p);
      assert.deepEqual([showing(drawn), drawn.outcomes['rail-pencil'].expanded], [['rail-pencil'], 'true'], theme + ': the pencil whose line is open shows, and only it');
      await shot(p, 'rail-pencil-line-' + theme);
      // Return starts the topic in that outcome, in place.
      const title = 'Started from the pencil ' + theme;
      await p.send('Input.insertText', { text: title }); await p.key('Enter');
      const at = await until(async () => { const now = await placeOf(p).catch(() => null); return now?.ready && now.title === title && now; }, theme + ': the new topic opens');
      assert.equal((await view('topic', { topic_id: new URLSearchParams(at.search).get('topic') })).topic.workspace_id, 'rail-pencil', theme + ': in the outcome whose pencil was pressed');
      assert.deepEqual(p.errors, []); await p.close();
    }
    // The outcome's own page keeps its own New topic.
    p = await open('rail-pencil-outcome-page', '/?workspace=w1');
    await until(() => p.evaluate('document.body.dataset.ready==="true" && !document.getElementById("new-topic").disabled && document.getElementById("new-topic").getClientRects().length > 0'), 'the outcome page shows its own New topic');
    assert.equal(await p.evaluate('document.getElementById("new-topic").textContent'), 'New topic');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail ↑ from the top message reaches the buttons at the top of the feed, with a ring: ← and → move along them and on to the outline and the right rail, ↓ comes back, Return presses one', async () => {
    // A check before this one leaves t1 Ready for review, which puts ✅ Done
    // among the header's buttons; this one walks a plainly Active topic's two.
    await control({ method: 'topic_state', operation_id: 'rail-header-keys-active', topic_id: 't1', args: { state: 'active', note: '' } });
    const p = await open('rail-header-keys', '/?topic=t1');
    await settled(p, 'the topic is up');
    await until(() => p.evaluate("document.querySelectorAll('#messages [data-id]').length > 1"), 'the messages are drawn');
    // The header's buttons at 1280: Topic settings, New message, then the Team's pills and "+ Add" (item 465).
    const buttons = await p.evaluate("[...document.querySelectorAll('#main > .topic-header button')].filter(b=>b.checkVisibility()).map(b=>b.id||(b.closest('#topic-people')?'team':b.tagName))");
    const team = buttons.filter(b => b === 'team').length;
    assert.ok(team >= 1, 'the Team shows at least "+ Add": ' + JSON.stringify(buttons));
    assert.deepEqual(buttons, ['settings-open', 'new-message', ...Array(team).fill('team')], 'Topic settings and New message are the header\'s buttons at 1280, then the Team\'s');
    const onTeam = () => p.evaluate("Boolean(document.activeElement?.closest('#topic-people'))");
    const onAdd = () => p.evaluate("Boolean(document.activeElement?.matches('#participants .add-chip'))");
    const firstId = await p.evaluate("[...document.querySelectorAll('#messages [data-id]')].find(e=>e.checkVisibility()).dataset.id");
    await tabToOutline(p);
    await p.key('ArrowRight');
    assert.match(await keyedAt(p), /^message:/, '→ goes into the messages');
    // Up through the messages to the first: ↑ from the second goes to the first, not the header.
    for (let n = 0; n < 40 && await keyedAt(p) !== 'message:' + firstId; ++n) await p.key('ArrowUp');
    assert.equal(await keyedAt(p), 'message:' + firstId, '↑ reaches the message at the top');
    await p.key('ArrowDown');
    const second = await keyedAt(p);
    await p.key('ArrowUp');
    assert.equal(await keyedAt(p), 'message:' + firstId, '↑ from the second message goes to the first, not to the header');
    await p.key('ArrowUp');
    assert.equal(await keyedAt(p), 'settings-open', '↑ from the top message goes to the header\'s first button');
    assert.equal(await ringed(p), 'solid', 'which wears the keys\' ring');
    await p.key('ArrowRight');
    assert.equal(await keyedAt(p), 'new-message', '→ goes to the next button');
    assert.equal(await ringed(p), 'solid');
    for (let n = 1; n <= team; n++) { await p.key('ArrowRight'); assert.equal(await onTeam(), true, `→ goes on along the Team's buttons (${n} of ${team})`); }
    assert.equal(await onAdd(), true, '"+ Add" is the row\'s last button');
    await p.key('ArrowRight');
    assert.match(await keyedAt(p), /^things:/, '→ past the last button goes to the right rail');
    await p.key('ArrowLeft');
    if (/^things:/.test(await keyedAt(p))) await p.key('ArrowLeft');
    assert.equal(await keyedAt(p), 'message:' + firstId, '← from the right rail comes back to the message');
    await p.key('ArrowUp');
    assert.equal(await onAdd(), true, '↑ again finds the button the keys were last on, "+ Add"');
    for (let n = 1; n <= team; n++) await p.key('ArrowLeft');
    assert.equal(await keyedAt(p), 'new-message', '← goes back along the Team to New message');
    await p.key('ArrowLeft');
    assert.equal(await keyedAt(p), 'settings-open', '← goes to the button before');
    await p.key('ArrowLeft');
    assert.equal(await keyedAt(p), 'topic:t1', '← past the first button goes to the outline, on the topic being read');
    await p.key('ArrowRight');
    await p.key('ArrowUp');
    assert.equal(await keyedAt(p), 'settings-open');
    await p.key('ArrowDown');
    assert.equal(await keyedAt(p), 'message:' + firstId, '↓ from the header goes back to the message the keys left');
    assert.notEqual(second, 'message:' + firstId);
    await p.key('ArrowUp');
    await p.key('Enter');
    await until(() => p.evaluate("document.getElementById('topic-settings').open"), 'Return on the gear opens Topic settings');
    await p.key('Escape');
    await until(() => p.evaluate("!document.getElementById('topic-settings').open"), 'Escape closes it');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail in the right rail → and ← open and fold a section without ⌘: → opens a folded one and goes to its first row, ← goes from a row to its section, folds it, and from a folded section goes back to the messages', async () => {
    const pipeline = (operation, kind, target, args) => control({ method: 'pipeline', kind, operation_id: 'rail-things-arrows-' + operation, target, args });
    await control({ method: 'navigation_topics', topics: [{ id: 'rail-arrows-t', title: 'Arrows piece topic' }] });
    await pipeline('on', 'pipeline.configure', { workspace_id: 'w1' }, { enabled: true });
    try {
      await pipeline('stages', 'pipeline.stages_set', { workspace_id: 'w1' }, { stages: [{ stage_id: 'build', name: 'Build' }] });
      const { result: { number } } = await pipeline('item', 'pipeline.item_add', { workspace_id: 'w1' }, { title: 'Arrows piece', section: 'now', size: 'small', sources: [{ note: 'the check' }] });
      await pipeline('start', 'pipeline.piece_start', { workspace_id: 'w1' }, { numbers: [number], topic_id: 'rail-arrows-t', stage_id: 'build' });
      const p = await open('rail-things-arrows', '/?conversation=w1');
      await settled(p, 'the Conversation is up');
      await until(() => p.evaluate(`Boolean(document.querySelector('#things [data-key=pipeline] a.row[href="?topic=rail-arrows-t"]')?.checkVisibility())`), 'the right rail lists the piece');
      const opened = () => p.evaluate("document.querySelector('#things .things-sec[data-key=pipeline]').open");
      await p.key('ArrowRight');
      assert.match(await keyedAt(p), /^things:/, '→ from the page goes to the right rail');
      await p.key('Home');
      assert.equal(await keyedAt(p), 'things:pipeline', 'Home is the Pipeline section');
      if (!await opened()) { await p.key('ArrowRight'); await until(opened, '→ opens it'); }
      await p.key('ArrowLeft');
      await until(async () => !await opened(), '← folds the open section');
      assert.equal(await keyedAt(p), 'things:pipeline', 'the keys stay on the section');
      await p.key('ArrowRight');
      await until(opened, '→ opens the folded section');
      assert.equal(await keyedAt(p), 'things:pipeline', 'the keys stay on it');
      await p.key('ArrowRight');
      assert.match(await keyedAt(p), /^things:pipeline:/, '→ on the open section goes to its first row');
      await p.key('ArrowLeft');
      assert.equal(await keyedAt(p), 'things:pipeline', '← on a row goes to its section');
      assert.equal(await opened(), true, 'and leaves it open');
      // ⌘← and ⌘→ still fold and open it.
      await p.key('ArrowLeft', 4);
      await until(async () => !await opened(), '⌘← folds it');
      await p.key('ArrowRight', 4);
      await until(opened, '⌘→ opens it');
      // Folded, ← goes back to the messages.
      await p.key('ArrowLeft');
      await until(async () => !await opened(), '← folds it');
      await p.key('ArrowLeft');
      assert.doesNotMatch(await keyedAt(p), /^things:/, '← on the folded section leaves the right rail');
      assert.match(await keyedAt(p), /^(message:|main$)/, 'for the messages');
      assert.deepEqual(p.errors, []); await p.close();
    } finally {
      await pipeline('off', 'pipeline.configure', { workspace_id: 'w1' }, { enabled: false });
    }
  });

  await check('rail ⌘Return starts a new message in the place the keys are on: the page, an outline topic, the right rail, an outcome\'s Conversation; in writing it sends and opens no second box', async () => {
    await control({ method: 'navigation_topics', topics: [{ id: 'rail-write-t', title: 'Write second' }] });
    const p = await open('rail-write', '/?topic=t1');
    await settled(p, 'the topic is up');
    const start = await placeOf(p);
    const box = () => p.evaluate(`({open:document.getElementById('new-message-sheet').open,focus:document.activeElement?.id??null,dialogs:document.querySelectorAll('dialog[open]').length,
      to:document.getElementById('inline-destination')?.textContent??null,search:location.search})`);
    const writes = async (search, to, what) => {
      const seen = await until(async () => { const now = await box(); return now.open && now.focus === 'inline-writing-body' && now.search === search && now; }, what);
      assert.equal(seen.dialogs, 1, what + ': one box');
      if (to) assert.equal(seen.to, 'To ' + to, what + ': in that topic');
      assert.equal((await placeOf(p)).origin, start.origin, what + ': in place, with no load');
    };
    const closes = async what => { await p.key('Escape'); await until(async () => !(await box()).open, what + ': Escape puts the box away'); };
    // On the page itself: this topic.
    await p.key('Enter', 4);
    await writes('?topic=t1', null, '⌘Return on the page opens New message with the cursor in it');
    await closes('the page');
    // On the topic being read in the outline: this topic, no move.
    await keysTo(p, 'topic:t1');
    await p.key('Enter', 4);
    await writes('?topic=t1', null, '⌘Return on the topic being read opens its New message');
    await closes('the row');
    // On another topic's row: that topic, in place, its box open once it is up.
    await keysTo(p, 'topic:rail-write-t');
    await p.key('Enter', 4);
    await arrived(p, '?topic=rail-write-t', 'Write second', '⌘Return on another topic opens it');
    await writes('?topic=rail-write-t', 'Write second', '⌘Return on another topic opens its New message');
    // In writing ⌘Return is Send: the message goes, and no second box opens.
    await p.send('Input.insertText', { text: 'Written after Command Return' });
    await p.key('Enter', 4);
    await until(() => p.evaluate("[...document.querySelectorAll('#messages [data-id]')].some(e=>e.textContent.includes('Written after Command Return'))"), '⌘Return in the box sends');
    const after = await box();
    assert.ok(after.dialogs <= 1, 'no second box opens');
    assert.equal(after.search, '?topic=rail-write-t', 'and nothing moves');
    if (after.open) await closes('after sending');
    await settled(p, 'the topic is up');
    // In the right rail: this topic.
    await p.evaluate('document.activeElement?.blur()');
    await p.key('ArrowRight');
    assert.match(await keyedAt(p), /^things:/, '→ goes to the right rail');
    await p.key('Enter', 4);
    await writes('?topic=rail-write-t', 'Write second', '⌘Return in the right rail opens this topic\'s New message');
    await closes('the right rail');
    // On the outcome's row: its Conversation.
    await keysTo(p, 'name:w1');
    await p.key('Enter', 4);
    await arrived(p, '?conversation=w1', null, '⌘Return on the outcome opens its Conversation');
    await writes('?conversation=w1', null, '⌘Return on the outcome opens its Conversation\'s New message');
    await closes('the Conversation');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail a press on the row of the page being read moves nothing and keeps the keys on the row, wearing their ring: ↑ and ↓ go on from it and → into the messages; Return on it keeps the keys there; on a Conversation its own row the same', async () => {
    const p = await open('rail-stayed', '/?topic=t1');
    await settled(p, 'the topic is up');
    const start = await placeOf(p);
    await press(p, '#outline a[data-topic-id="t1"]');
    await pressedRow(p, 'topic:t1', 'the topic being read');
    assert.deepEqual([(await placeOf(p)).origin, (await placeOf(p)).search], [start.origin, '?topic=t1'], 'nothing moved');
    await stepsFrom(p, 'topic:t1', 'the topic being read');
    await p.key('ArrowRight');
    assert.match(await keyedAt(p), /^message:/, '→ goes into its messages');
    // Return on it from the keys keeps them on the row, with its ring.
    await keysTo(p, 'topic:t1');
    await p.key('Enter');
    assert.equal(await keyedAt(p), 'topic:t1', 'Return keeps the keys on the row');
    assert.equal(await ringed(p), 'solid', 'with its ring');
    assert.deepEqual(p.errors, []); await p.close();
    // On a Conversation, a press on its own outcome's row: it folds its topics (item 320) and moves nothing, the keys on the row.
    const c = await open('rail-stayed-conversation', '/?conversation=w1');
    await settled(c, 'the Conversation is up');
    const conversation = await placeOf(c);
    await press(c, '.ol-outcome[data-workspace-id="w1"] .ol-name');
    await pressedRow(c, 'name:w1', 'the Conversation being read');
    assert.deepEqual([(await placeOf(c)).origin, (await placeOf(c)).search], [conversation.origin, '?conversation=w1'], 'nothing moved');
    // Folded, its row is the outline's only one beside the Outcomes heading's pencil (item 305): → opens it again, the keys still on it, and ↑ ↓ go on from there.
    await c.key('ArrowRight');
    await until(async () => (await keyTree(c)).rows.filter(row => row !== 'outline:outline-new-outcome').length > 1, '→ opens the outcome pressed, its topics under it');
    assert.equal(await keyedAt(c), 'name:w1', 'the keys still on its row');
    await stepsFrom(c, 'name:w1', 'the Conversation being read');
    assert.deepEqual(c.errors, []); await c.close();
  });

  await check('rail a press on a row whose move the page refuses keeps the keys on the row pressed, wearing their ring: the page says why it stayed and moves nothing, ↑ and ↓ go on from the row and → into the messages', async () => {
    await control({ method: 'navigation_topics', topics: [{ id: 'rail-refused-a', title: 'Refusing topic A' }, { id: 'rail-refused-b', title: 'Refusing topic B' }] });
    const asked = await control({ method: 'agent_message', operation_id: 'rail-refused-ask', topic_id: 'rail-refused-a', join: true, source: 'topic', addressees: [facts.actor], body: 'A question answered while the page is offline.' });
    const words = `#messages .message-card[data-id="${asked.result.message_id}"] > .message-preview`, row = '#outline a[data-topic-id="rail-refused-b"]';
    const p = await open('rail-refused', '/?topic=rail-refused-a');
    await settled(p, 'the topic is up');
    const start = await placeOf(p);
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(row)})?.getClientRects().length>0`), 'the outline is ready');
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(words)})?.getClientRects().length>0`), 'its message is shown');
    await press(p, words);
    await until(() => readerOpen(p), 'the message opens in the Reader');
    // Offline, the reply cannot be confirmed saved, so the page refuses to leave it.
    const network = offline => p.send('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await p.point('#writing-body');
    await network(true);
    await p.send('Input.insertText', { text: 'Written while the page refuses to move' });
    await p.key('Escape');
    await until(async () => !await readerOpen(p), 'Escape puts the Reader away, its writing kept');
    await press(p, row);
    await until(() => p.evaluate("document.getElementById('topic-navigation-status').textContent.includes('not confirmed saved')"), 'the page refuses the move and says why');
    await pressedRow(p, 'topic:rail-refused-b', 'a refused move');
    assert.deepEqual([(await placeOf(p)).origin, (await placeOf(p)).search], [start.origin, '?topic=rail-refused-a'], 'the page stayed, in place, with no load');
    await stepsFrom(p, 'topic:rail-refused-b', 'a refused move');
    await p.key('ArrowRight');
    assert.match(await keyedAt(p), /^message:/, '→ goes into the messages of the page that stayed');
    await network(false);
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail a press in the outline on what opens there keeps its own way: an outcome\'s pencil opens its New topic line with the focus in it and Escape gives the pencil the focus back; a press on a message after a row leaves nothing in the rails ringed', async () => {
    const p = await open('rail-press-own', '/?topic=t1');
    await settled(p, 'the topic is up');
    // The outcome's pencil is the outline's New topic (item 305).
    await press(p, '#ol-pencil-w1');
    await until(() => p.evaluate(`document.activeElement?.id==='ol-new-topic-w1' && Boolean(document.activeElement.closest('#outline'))`), 'the pencil opens its New topic line in the outline, the focus in it');
    await p.key('Escape');
    await until(() => p.evaluate(`!document.querySelector('#ol-new-topic-w1') && document.activeElement?.id==='ol-pencil-w1'`), 'Escape closes the line and gives the pencil the focus');
    assert.deepEqual(p.errors, []); await p.close();
    // A row pressed, then a message: the message takes the pointer's place, and nothing in the rails wears a ring.
    // On a fresh page, so New topic, at the foot of a long outline, leaves it scrolled nowhere in particular.
    const q = await open('rail-press-own-row', '/?topic=t1');
    await settled(q, 'the topic is up again');
    await press(q, '#outline a[data-topic-id="t1"]');
    await pressedRow(q, 'topic:t1', 'the topic being read');
    const shownMessage = await q.evaluate(`[...document.querySelectorAll('#messages .message-card[data-id] > .message-preview')].find(el => el.getClientRects().length && el.getBoundingClientRect().height > 0)?.parentElement.dataset.id ?? null`);
    assert.ok(shownMessage, 'a message is shown to press');
    await press(q, `#messages .message-card[data-id="${shownMessage}"] > .message-preview`);
    await until(() => q.evaluate(`!document.activeElement?.closest('#rail, #things')`), 'the focus leaves the outline');
    assert.equal((await pressRing(q)).rails, 0, 'nothing in the rails wears a ring');
    if (await readerOpen(q)) { await q.key('Escape'); await until(async () => !await readerOpen(q), 'Escape closes the Reader'); }
    assert.deepEqual(q.errors, []); await q.close();
  });

  // Items 148 and 320 come last: their outcomes, and the questions left waiting in them,
  // would change what the checks before them count and push their rows down the outline.
  await check('rail outcome clicks toggle topics and waiting opens the exact unloaded question', async () => {
    for (const size of ['laptop', 'phone']) {
      const oid='rail-toggle-'+size, tid=oid+'-topic';
      await control({method:'light_outcome',outcome:oid,title:'Outcome toggle '+size,topic:{id:tid,title:'Question beyond the first page'}});
      const ask=await control({method:'agent_message',operation_id:oid+'-ask',body:'Which notebook should the agent use?',topic_id:tid,addressees:[facts.actor],intent:'ask'});
      for(let n=0;n<8;n++) await control({method:'agent_message',operation_id:oid+'-later-'+n,body:'Later coordination '+n,topic_id:tid});
      const p=await open(oid,'/?topic='+tid,size);
      // On a laptop the page settles its things and its scroll first; a phone keeps them behind a sheet.
      if(size==='laptop')await settled(p,'the topic is up');
      const name=`#outline .ol-outcome[data-workspace-id="${oid}"] .ol-name`;
      const waiting=`#outline .ol-outcome[data-workspace-id="${oid}"] .ol-waiting`;
      // Brought into view and held there: the outline may still be settling its own scroll as the page comes up.
      // In view and uncovered (the drawer may still be coming in over the page), naming what covers it when it stays covered.
      const cover=selector=>p.evaluate(`(e=>{e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();if(b.top<0||b.bottom>innerHeight)return 'out of view';
        const at=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return e.contains(at)?null:at?(at.id||at.className||at.tagName):'nothing'})(document.querySelector(${JSON.stringify(selector)}))`);
      const press=async selector=>{try{await until(async()=>await cover(selector)===null,selector+' is in view, uncovered');}catch(error){throw Error(`${error.message}: ${await cover(selector)}`);}
        return size==='phone'?tap(p,selector):p.point(selector);};
      // What lies on the middle of "☰ Outcomes", brought into view (the page scrolls to a question it opens), once the Reader closing has gone from over it.
      const onControl=()=>p.evaluate(`(()=>{const c=document.getElementById('rail-open');c.scrollIntoView({block:'nearest'});const b=c.getBoundingClientRect(),e=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return c.contains(e)?'control':e?(e.id||e.className||e.tagName):null})()`);
      const showRail=async()=>{if(size!=='phone'||(await drawer(p)).open)return;
        try{await until(async()=>await onControl()==='control','nothing covers "☰ Outcomes"');}catch(error){throw Error(`${error.message}: ${await onControl()} does`);}
        await tap(p,'#rail-open');};
      await showRail();
      await until(async()=>(await outline(p)).outcomes[oid]?.open,'outcome starts expanded');
      await p.evaluate(`document.querySelector(${JSON.stringify(name)}).scrollIntoView({block:'center'})`);
      await press(name);
      await until(async()=>(await outline(p)).outcomes[oid]?.current==='page'&&!(await outline(p)).outcomes[oid]?.open,'click both opens Conversation and folds topics');
      await showRail();
      await press(name);
      await until(async()=>(await outline(p)).outcomes[oid]?.open,'second click expands topics');
      await showRail();
      await press(name);
      await until(async()=>!(await outline(p)).outcomes[oid]?.open,'third click folds topics');
      // The keys are on the outcome's row, as after any press in the outline (item 462); at 390 the drawer, opened again, is on it.
      await showRail();
      await pressedRow(p,'name:'+oid,size+': the third click');
      await until(()=>p.evaluate(`Boolean(document.querySelector(${JSON.stringify(waiting)})?.getClientRects().length)`),'waiting control is visible even with topics folded');
      await press(waiting);
      await until(()=>p.evaluate('document.querySelector("#reader").open'),'the exact question opens in the Reader');
      assert.match(await p.evaluate('document.querySelector("#reader").textContent'),/Which notebook should the agent use/,'not a recent unrelated message');
      await shot(p,'waiting-question-'+size);
      // On the question's own topic, a press on Waiting on you opens it in the Reader over the page, the keys
      // on the row pressed as Return on it leaves them: closing the Reader gives them back to that row, ringed.
      await p.key('Escape');
      await until(async()=>!await readerOpen(p),size+': Escape closes the Reader');
      await showRail();
      await until(()=>p.evaluate(`Boolean(document.querySelector(${JSON.stringify(waiting)})?.getClientRects().length)`),size+': waiting control is visible on the question\'s topic');
      const waitingRow=await p.evaluate(`'outline:'+document.querySelector(${JSON.stringify(waiting)}).textContent.trim()`);
      await press(waiting);
      await until(()=>p.evaluate('document.querySelector("#reader").open'),size+': the question opens in the Reader again');
      // Closed as each size closes it: Escape on a laptop, its close button tapped on a phone, the drawer still open under it.
      if(size==='phone')await tap(p,'#reader-close');else await p.key('Escape');
      await until(async()=>!await readerOpen(p),size+': the Reader closes again');
      await pressedRow(p,waitingRow,size+': Waiting on you');
      await stepsFrom(p,waitingRow,size+': Waiting on you');
      if(size==='laptop'){await p.key('ArrowRight');assert.match(await keyedAt(p),/^message:/,'→ from Waiting on you goes into the messages');}
      assert.deepEqual(p.errors,[]);await p.close();
    }
  });

  // Item 148: Waiting on you takes the reader to the question, the oldest first
  // and each press after it the next, from the outline's outcome row, a topic
  // row, the outcome light on its page and its Conversation row.
  await check('rail Waiting on you opens the oldest question first, each press the next, from the outline, a topic row, the outcome light and the Conversation row', async () => {
    const oid = 'rail-148', a = oid + '-a', b = oid + '-b';
    await control({ method: 'light_outcome', outcome: oid, title: 'Oldest first', topic: { id: a, title: 'Topic A older ask' } });
    await control({ method: 'light_outcome', outcome: oid, exists: true, topic: { id: b, title: 'Topic B newer ask' } });
    await control({ method: 'agent_message', operation_id: oid + '-ask-a', body: 'OLDEST question in A', topic_id: a, addressees: [facts.actor], intent: 'ask' });
    await control({ method: 'agent_message', operation_id: oid + '-ask-b', body: 'NEWER question in B', topic_id: b, addressees: [facts.actor], intent: 'ask' });
    const asks = (await view('outcome_light', { workspace_id: oid })).facts.filter(fact => fact.kind === 'ask');
    assert.deepEqual(asks.map(fact => fact.topic_id), [b, a], 'the server lists the asks newest first, so the order is the page\'s to choose');
    const p = await open(oid + '-outline', '/?topic=' + a);
    await settled(p, 'the topic is up');
    const reader = () => p.evaluate(`(r=>({open:r.open,text:r.textContent,topic:new URL(location.href).searchParams.get('topic')}))(document.querySelector('#reader'))`);
    // A press, then what the Reader shows; Escape puts it away before the next press.
    const pressed = async (selector, words) => {
      await p.point(selector);
      const shown = await until(async () => { const seen = await reader(); return seen.open && /question in [AB]/.test(seen.text) && seen; }, words + ': a question opens in the Reader');
      await p.key('Escape');
      await until(async () => !(await reader()).open, words + ': Escape closes the Reader');
      return [shown.text.match(/(OLDEST|NEWER) question in [AB]/)?.[0] ?? null, shown.topic];
    };
    const waiting = `#outline .ol-outcome[data-workspace-id="${oid}"] .ol-waiting`;
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(waiting)})?.getClientRects().length)`), 'the outline shows Waiting on you');
    assert.equal(await pressed(waiting, 'first press').then(seen => seen.join(' @ ')), `OLDEST question in A @ ${a}`, 'the first press opens the oldest question, on its own page');
    assert.equal(await pressed(waiting, 'second press').then(seen => seen.join(' @ ')), `NEWER question in B @ ${b}`, 'the second press opens the next one');
    assert.equal(await pressed(waiting, 'third press').then(seen => seen.join(' @ ')), `OLDEST question in A @ ${a}`, 'after the newest, round to the oldest');
    // A topic row waiting on the reader opens its question, on the page of that topic or of another.
    for (const [topic, words] of [[a, 'OLDEST question in A'], [b, 'NEWER question in B']]) {
      assert.equal(await pressed(`#outline a[data-topic-id="${topic}"]`, topic + ' row').then(seen => seen.join(' @ ')), `${words} @ ${topic}`, 'a topic row opens its question');
    }
    await shot(p, 'waiting-oldest-first');
    assert.deepEqual(p.errors, []); await p.close();
    // The same from another outcome's page, where the outline draws this outcome's topics itself.
    const away = await open(oid + '-away', '/?topic=t1');
    await settled(away, 'the topic is up');
    const awayRow = `#outline .ol-outcome[data-workspace-id="${oid}"] a[data-topic-id="${b}"]`;
    await until(() => away.evaluate(`!document.getElementById('outline-only-waiting').disabled`), 'something waits on the reader');
    await away.point('#outline-only-waiting');
    await until(() => away.evaluate(`Boolean(document.querySelector(${JSON.stringify(awayRow)})?.getClientRects().length)`), 'the outline shows the other outcome\'s topics');
    await away.evaluate(`document.querySelector(${JSON.stringify(awayRow)}).scrollIntoView({block:'center'})`);
    await away.point(awayRow);
    const there = await until(async () => { const seen = await away.evaluate(`(r=>r.open&&new URL(location.href).searchParams.get('topic')+' '+r.textContent)(document.querySelector('#reader'))`); return seen && /question in B/.test(seen) && seen; }, 'the other outcome\'s topic row opens its question');
    assert.match(there, new RegExp('^' + b + ' [\\s\\S]*NEWER question in B'));
    assert.deepEqual(away.errors, []); await away.close();
    // The Conversation's own questions come after the topics'.
    const conversation = (await view('conversation', { workspace_id: oid })).conversation;
    await control({ method: 'agent_message', operation_id: oid + '-ask-c1', body: 'OLDEST question in C', topic_id: conversation.topic_id, addressees: [facts.actor], intent: 'ask' });
    await control({ method: 'agent_message', operation_id: oid + '-ask-c2', body: 'NEWER question in C', topic_id: conversation.topic_id, addressees: [facts.actor], intent: 'ask' });
    const o = await open(oid + '-page', '/?workspace=' + oid);
    const words = `#outcome-standing .state-line button`;
    await until(() => o.evaluate(`document.querySelector(${JSON.stringify(words)})?.textContent==='Waiting on you · 3 questions'`), 'the outcome light says three questions, and is a control');
    await shot(o, 'waiting-outcome-light');
    await o.point(words);
    const first = await until(async () => { const seen = await o.evaluate(`(r=>r.open&&r.textContent)(document.querySelector('#reader'))`); return seen && /question in A/.test(seen) && seen; }, 'the outcome light opens the oldest question');
    assert.match(first, /OLDEST question in A/);
    assert.deepEqual(o.errors, []); await o.close();
    const c = await open(oid + '-conversation-row', '/?workspace=' + oid);
    const row = '#conversation-row a';
    await until(() => c.evaluate(`Boolean(document.querySelector(${JSON.stringify(row)})?.querySelector('.topic-state'))`), 'the Conversation row says Waiting on you');
    await c.evaluate(`document.querySelector(${JSON.stringify(row)}).scrollIntoView({block:'center'})`);
    await c.point(row);
    const asked = await until(async () => { const seen = await c.evaluate(`(r=>r.open&&r.textContent)(document.querySelector('#reader'))`); return seen && /question in C/.test(seen) && seen; }, 'the Conversation row opens its question');
    assert.match(asked, /OLDEST question in C/, 'the Conversation\'s oldest question, not the outcome\'s');
    assert.equal(await c.evaluate(`new URL(location.href).searchParams.get('conversation')`), oid, 'in the Conversation');
    assert.deepEqual(c.errors, []); await c.close();
  });

  // Item 148, from the outcome's page: each press there loads the topic, and
  // Back loads the outcome's page again, so where the presses have got to is
  // kept for the tab. Press, Back (a real load), press again: the next question.
  await check('rail Waiting on you goes on to the next question across the loads the outcome page makes: press, Back, press again, from the light, the outline and the Conversation row', async () => {
    const oid = 'rail-148-back', a = oid + '-a', b = oid + '-b';
    await control({ method: 'light_outcome', outcome: oid, title: 'Press, back, press', topic: { id: a, title: 'Back topic A' } });
    await control({ method: 'light_outcome', outcome: oid, exists: true, topic: { id: b, title: 'Back topic B' } });
    await control({ method: 'agent_message', operation_id: oid + '-ask-a', body: 'OLDEST question in A', topic_id: a, addressees: [facts.actor], intent: 'ask' });
    await control({ method: 'agent_message', operation_id: oid + '-ask-b', body: 'NEWER question in B', topic_id: b, addressees: [facts.actor], intent: 'ask' });
    const conversation = (await view('conversation', { workspace_id: oid })).conversation;
    await control({ method: 'agent_message', operation_id: oid + '-ask-c1', body: 'OLDEST question in C', topic_id: conversation.topic_id, addressees: [facts.actor], intent: 'ask' });
    await control({ method: 'agent_message', operation_id: oid + '-ask-c2', body: 'NEWER question in C', topic_id: conversation.topic_id, addressees: [facts.actor], intent: 'ask' });
    const shown = p => p.evaluate(`(r=>({open:Boolean(r?.open),text:r?.textContent??'',origin:(window.documentOrigin??=performance.timeOrigin)}))(document.querySelector('#reader'))`).catch(() => null);
    // A press, the question the Reader shows (on a page loaded since the press, when it says so), then Escape.
    const asked = async (p, selector, words, { loads = true } = {}) => {
      const before = (await shown(p)).origin;
      // The page up and both rails read, then the control brought into view and held there: the page may still be settling its scroll.
      await until(() => p.evaluate(`document.body?.dataset.ready==='true' && !document.documentElement.hasAttribute('data-rails-reading')`).catch(() => false), words + ': the page is up');
      await until(() => p.evaluate(`(e=>{e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight})(document.querySelector(${JSON.stringify(selector)}))`), words + ': ' + selector + ' is in view');
      await p.point(selector);
      const seen = await until(async () => { const at = await shown(p); return at?.open && /question in [ABC]/.test(at.text) && at; }, words + ': a question opens in the Reader');
      if (loads) assert.ok(seen.origin > before, words + ': the press loaded the page of the question');
      await p.key('Escape');
      await until(async () => (await shown(p))?.open === false, words + ': Escape closes the Reader');
      return seen.text.match(/(OLDEST|NEWER) question in [ABC]/)?.[0] ?? null;
    };
    // Back to the outcome's page, a real load: a new document, up and showing its controls.
    const back = async (p, ready, words) => {
      const before = (await shown(p)).origin;
      await p.evaluate('history.back()');
      await until(async () => { const at = await shown(p); return at && at.origin > before && await p.evaluate(`new URL(location.href).searchParams.get('workspace')===${JSON.stringify(oid)}&&Boolean(document.querySelector(${JSON.stringify(ready)})?.getClientRects().length)`).catch(() => false); }, words + ': Back loads the outcome\'s page again');
    };
    const light = '#outcome-standing .state-line button.state-question';
    const o = await open(oid + '-light', '/?workspace=' + oid);
    await until(() => o.evaluate(`document.querySelector(${JSON.stringify(light)})?.textContent==='Waiting on you · 3 questions'`), 'the outcome light says three questions, and is a control');
    const lit = [await asked(o, light, 'first press')];
    for (const n of [2, 3, 4]) { await back(o, light, 'before press ' + n); lit.push(await asked(o, light, 'press ' + n)); }
    assert.deepEqual(lit.slice(0, 2), ['OLDEST question in A', 'NEWER question in B'], 'after Back the light opens the next question, not the oldest again');
    assert.match(lit[2], /question in C/, 'then the Conversation\'s');
    assert.equal(lit[3], 'OLDEST question in A', 'and round to the oldest');
    // The light's last press opened A; the outline on A's page goes on from there, to B, not A again.
    const waiting = `#outline .ol-outcome[data-workspace-id="${oid}"] .ol-waiting`;
    await until(() => o.evaluate(`Boolean(document.querySelector(${JSON.stringify(waiting)})?.getClientRects().length)`), 'the outline shows Waiting on you');
    assert.equal(await asked(o, waiting, 'the outline after the light', { loads: false }), 'NEWER question in B', 'the outline goes on from the light\'s press');
    assert.deepEqual(o.errors, []); await o.close();
    // The Conversation row: each press leaves the outcome's page for the Conversation.
    const row = '#conversation-row a';
    const c = await open(oid + '-row', '/?workspace=' + oid);
    await until(() => c.evaluate(`Boolean(document.querySelector(${JSON.stringify(row)})?.querySelector('.topic-state'))`), 'the Conversation row says Waiting on you');
    const rowed = [await asked(c, row, 'first row press')];
    for (const n of [2, 3]) { await back(c, row + ' .topic-state', 'before row press ' + n); rowed.push(await asked(c, row, 'row press ' + n)); }
    assert.deepEqual(rowed, ['OLDEST question in C', 'NEWER question in C', 'OLDEST question in C'], 'after Back the row opens the Conversation\'s next question, then round to its oldest');
    assert.deepEqual(c.errors, []); await c.close();
    // The outcome page's own topic list: a row waiting on the reader opens the topic at its question, and its link says so.
    const t = await open(oid + '-topics', '/?workspace=' + oid);
    const listed = `#topics a[data-topic-id="${b}"]`;
    await until(() => t.evaluate(`Boolean(document.querySelector(${JSON.stringify(listed)})?.getClientRects().length)`), 'the outcome\'s page lists topic B');
    assert.ok(new URL(await t.evaluate(`document.querySelector(${JSON.stringify(listed)}).href`)).searchParams.get('message'), 'the row\'s link names the question\'s message');
    assert.equal(await asked(t, listed, 'topic B in the outcome\'s list'), 'NEWER question in B', 'the row opens the topic at its question');
    assert.equal(await t.evaluate(`new URL(location.href).searchParams.get('topic')`), b);
    assert.deepEqual(t.errors, []); await t.close();
  });

  await check('rail what the keys select comes into view with a tenth of its pane beyond it: the outline\'s rows under ↓ ↑ and ← back to them, the header\'s buttons under ↑ → ←, and the message → and ↓ come back to', async () => {
    // A topic of fourteen long messages, and twenty-four more topics, so the outline is taller than the window.
    const place = 'rail-margin';
    await control({ method: 'navigation_topics', topics: [{ id: place, title: 'Margin' }, ...Array.from({ length: 24 }, (_, k) => ({ id: `${place}-${k}`, title: `Margin topic ${k + 1}` }))] });
    for (let k = 0; k < 14; k++) await control({ method: 'agent_message', operation_id: `${place}-m${k}`, topic_id: place, sender: 'person', whole_topic: true, body: `Message ${k} of a long topic. ` + 'Words to read, enough for a card of a few lines. '.repeat(3) });
    const p = await open(place, '/?topic=' + place);
    await settled(p, 'the topic is up');
    await until(() => p.evaluate("document.querySelectorAll('#messages [data-id]').length >= 14"), 'the messages are drawn');
    // What has the keys, as it shows selected (a message's entry, else the element itself): its box against the
    // area it scrolls in, the rail it is in or else the window, and how far that area is and can be scrolled.
    const AREA = `const a=document.activeElement,e=a.closest('#messages [data-id]')??a,rail=a.closest('.rail'),s=rail?rail.getBoundingClientRect():{top:0,bottom:innerHeight},
      areaTop=Math.max(s.top,0),areaBottom=Math.min(s.bottom,innerHeight),scroll=by=>rail?rail.scrollBy({top:by,behavior:'instant'}):scrollBy({top:by,behavior:'instant'});`;
    const keyed = () => p.evaluate(`(()=>{${AREA}const r=e.getBoundingClientRect();
      return {at:a.id||a.dataset.topicId||e.dataset.id||a.textContent.trim().slice(0,30),top:r.top-areaTop,bottom:r.bottom-areaTop,h:areaBottom-areaTop,
        y:rail?rail.scrollTop:scrollY,max:rail?rail.scrollHeight-rail.clientHeight:document.documentElement.scrollHeight-innerHeight}})()`);
    // The keys' rule (docs/interaction.md): whole, with a tenth of the area below and above it, unless the area is
    // scrolled as far as it goes that way. from: where it was before the key, when it was there to measure.
    const roomy = async words => {
      const a = await keyed(), room = a.h * 0.1, said = `${words}: ${JSON.stringify(a)}`;
      assert.ok(a.top >= -0.5 && a.bottom <= a.h + 0.5, `${said}: it shows whole`);
      if (a.y < a.max - 0.5) assert.ok(a.bottom <= a.h - room + 1.5, `${said}: a tenth of its area shows below it`);
      if (a.y > 0.5) assert.ok(a.top >= room - 1.5, `${said}: a tenth of its area shows above it`);
      return a;
    };
    // Before a key: the area what will have the keys scrolls in scrolled so it stands 4px inside the area's top
    // edge, or its bottom one where the top cannot be reached, whole, where scrolling only as far as it needs
    // would leave it. el: an expression for that element, run with the keys still where they are.
    const edge = async (el, words) => {
      const side = await p.evaluate(`(()=>{const t=${el};${AREA.replace('const a=document.activeElement', 'const a=t')}
        const r=()=>t.getBoundingClientRect();scroll(r().top-areaTop-4);if(Math.abs(r().top-areaTop-4)<=1)return 'top';
        scroll(r().bottom-(areaBottom-4));return Math.abs(r().bottom-(areaBottom-4))<=1?'bottom':null})()`);
      assert.ok(side, `${words}: before the key, what it goes to stands 4px inside its area's top or bottom edge`);
    };
    // ↓ or ↑ along the outline from where the keys are to its end, each row by the rule; one already a tenth
    // inside scrolls nothing.
    // Once what the key set off is still: the area's scroll and height the same three frames running.
    const calm = () => p.evaluate("new Promise(done=>{let last='',same=0;const f=()=>{const r=document.activeElement?.closest('.rail'),now=(r?r.scrollTop+','+r.scrollHeight:'')+'|'+scrollY+','+document.documentElement.scrollHeight;if(now===last){if(++same>=3)return done(true)}else{same=0;last=now}requestAnimationFrame(f)};requestAnimationFrame(f)})");
    const inTree = () => p.evaluate("Boolean(document.activeElement?.closest('#outline [role=tree]'))");
    const walk = async (key, words) => {
      const ys = [];
      await calm();
      let before = await keyed();
      for (let n = 0; n < 80; n++) {
        await p.key(key);
        await calm();
        // Past the outline's end the arrows go on in the side rail (item 301): back to its end, where the walk stops.
        if (!(await inTree())) { await p.key(key === 'ArrowDown' ? 'ArrowUp' : 'ArrowDown'); await calm(); assert.equal((await keyed()).at, before.at, `${words}: the key back from past the outline's end comes back to its end row`); break; }
        const now = await keyed();
        if (now.at === before.at) break;
        const moved = now.y - before.y, room = now.h * 0.1, was = { top: now.top + moved, bottom: now.bottom + moved };
        await roomy(`${words}, onto ${now.at}`);
        if (was.top >= room + 1.5 && was.bottom <= now.h - room - 1.5) assert.equal(moved, 0, `${words}, onto ${now.at}: a row already a tenth inside scrolls nothing: ${JSON.stringify({ was, now })}`);
        ys.push(now.y); before = now;
      }
      assert.ok(new Set(ys).size >= 3, `${words}: the outline scrolled as the keys went: ${JSON.stringify(ys)}`);
    };
    await tabToOutline(p);
    assert.equal(await keyedAt(p), 'topic:' + place, 'Tab reaches the outline on the topic being read');
    await p.key('Home');
    await walk('ArrowDown', '↓ down the outline');
    await walk('ArrowUp', '↑ up the outline');
    // → into the messages and ← back: the outline takes the keys to the topic's row, scrolled to the rule.
    await p.key('End'); await p.key('Home');
    for (let n = 0; n < 80 && await keyedAt(p) !== 'topic:' + place; ++n) await p.key('ArrowDown');
    await p.key('ArrowRight');
    assert.match(await keyedAt(p), /^message:/, '→ goes into the messages');
    const message = await keyedAt(p);
    await edge(`document.querySelector('#outline a[data-topic-id="${place}"]')`, '←');
    await p.key('ArrowLeft');
    assert.equal(await keyedAt(p), 'topic:' + place, '← comes back to the topic\'s row');
    await roomy('← back to the outline, from its rail\'s edge');
    // → back into the messages, the message the keys left standing at the window's edge.
    await edge(`document.querySelector('#messages [data-id="${message.slice(8)}"]')`, '→');
    await p.key('ArrowRight');
    assert.equal(await keyedAt(p), message, '→ comes back to the message the keys left');
    await roomy('→ back into the messages, from the window\'s edge');
    // Up to the message at the top, then ↑ onto the header's buttons, each standing at the window's top edge.
    const first = await p.evaluate("[...document.querySelectorAll('#messages [data-id]')].find(e=>e.checkVisibility()).dataset.id");
    for (let n = 0; n < 40 && await keyedAt(p) !== 'message:' + first; ++n) await p.key('ArrowUp');
    assert.equal(await keyedAt(p), 'message:' + first, '↑ reaches the message at the top');
    await edge("document.getElementById('settings-open')", '↑ onto the header');
    await p.key('ArrowUp');
    assert.equal(await keyedAt(p), 'settings-open', '↑ from the top message goes to the header\'s first button');
    await roomy('↑ onto the header\'s first button, from the window\'s top edge');
    await edge("document.getElementById('new-message')", '→ along the header');
    await p.key('ArrowRight');
    assert.equal(await keyedAt(p), 'new-message', '→ goes to the next button');
    await roomy('→ along the header\'s buttons, from the window\'s top edge');
    await edge("document.getElementById('settings-open')", '← along the header');
    await p.key('ArrowLeft');
    assert.equal(await keyedAt(p), 'settings-open', '← goes to the button before');
    await roomy('← along the header\'s buttons, from the window\'s top edge');
    // ↓ from the header back to the message at the top, standing at the window's top edge.
    await edge(`document.querySelector('#messages [data-id="${first}"]')`, '↓ from the header');
    await p.key('ArrowDown');
    assert.equal(await keyedAt(p), 'message:' + first, '↓ from the header goes to the message at the top');
    await roomy('↓ from the header\'s buttons, from the window\'s top edge');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Item 384: on the Outcomes home a press on an outcome opens its Conversation, and the home has no heading of its own.
  // Last, so the outcome it adds lengthens no outline the cases before it press in.
  await check('rail on the Outcomes home a press on an outcome opens its Conversation, and so does Return on its row; one with no Conversation opens its page, and the home has no Outcomes heading', async () => {
    await control({ method: 'older_outcome', workspace_id: 'rail-home-older', title: 'Home older outcome', topic_id: 'rail-home-older-topic', topic_title: 'Home older topic' });
    const row = id => `#workspaces a[data-workspace-id="${id}"]`;
    const press = async (p, size, selector) => {
      await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
      if (SIZES[size].mobile) await tap(p, selector); else await p.point(selector);
    };
    // The home lists twenty outcomes at a time, and the cases before this one made many: More until each is listed.
    const listed = async (p, size, ids, label) => {
      for (let page = 0; page < 20; page++) {
        const missing = await until(() => p.evaluate(`document.body?.dataset.ready==="true" && document.querySelector('#workspaces a') ? ${JSON.stringify(ids.map(row))}.filter(s=>!document.querySelector(s)).length + (document.querySelector('#more-workspaces')?.hidden === false ? ':more' : ':end') : null`).catch(() => null), label);
        if (missing.startsWith('0:')) return;
        assert.ok(missing.endsWith(':more'), `${label}: ${ids} are not all on the list, and it has no more`);
        const shown = await p.evaluate(`document.querySelectorAll('#workspaces a').length`);
        await press(p, size, '#more-workspaces');
        await until(() => p.evaluate(`document.querySelectorAll('#workspaces a').length > ${shown}`), label + ': More lists more');
      }
      assert.fail(label + ': never listed');
    };
    const landed = (p, search) => until(() => p.evaluate(`document.body?.dataset.ready==="true" && location.search===${JSON.stringify(search)}`).catch(() => false), 'the page reached is ' + search);
    for (const size of ['laptop', 'phone']) {
      let h = await open(`rail-home-press-${size}`, '/', size);
      await listed(h, size, ['w1', 'rail-home-older'], size + ': the outcomes are listed');
      const heading = await h.evaluate(`(()=>{const shown=e=>Boolean(e)&&e.getClientRects().length>0;return {header:shown(document.querySelector('#main > .topic-header')),title:shown(document.getElementById('topic-title')),
        line:shown(document.getElementById('topic-description')),list:document.getElementById('outcomes-heading').textContent}})()`);
      assert.deepEqual(heading, { header: false, title: false, line: false, list: 'Your outcomes' }, size + ': no Outcomes heading or line under it; the list is the page');
      assert.deepEqual(await h.evaluate(`[${JSON.stringify(row('w1'))},${JSON.stringify(row('rail-home-older'))}].map(s=>document.querySelector(s).getAttribute('href'))`),
        ['?conversation=w1', '?workspace=rail-home-older'], size + ': each row\'s link names where a press goes');
      await shot(h, `rail-home-press-${size}`);
      await press(h, size, row('w1'));
      await landed(h, '?conversation=w1');
      assert.equal(await h.evaluate(`document.body.classList.contains('conversation-page') && document.getElementById('topic-title').textContent`), 'Conversation', size + ': a press on an outcome opens its Conversation');
      assert.deepEqual(h.errors, []); await h.close();
      h = await open(`rail-home-older-${size}`, '/', size);
      await listed(h, size, ['rail-home-older'], size + ': the older outcome is listed');
      await press(h, size, row('rail-home-older'));
      await landed(h, '?workspace=rail-home-older');
      assert.equal(await h.evaluate(`document.getElementById('topic-title').textContent`), 'Home older outcome', size + ': an outcome with no Conversation opens its page');
      assert.deepEqual(h.errors, []); await h.close();
    }
    // The keys: Return on a focused row opens the outcome's Conversation too.
    const k = await open('rail-home-return', '/', 'laptop');
    await listed(k, 'laptop', ['w1'], 'the outcomes are listed');
    await k.evaluate(`document.querySelector(${JSON.stringify(row('w1'))}).focus()`);
    await k.key('Enter');
    await landed(k, '?conversation=w1');
    assert.deepEqual(k.errors, []); await k.close();
  });

  // Item 464: the outcome's Notebook leaves the side rail, pencil and all. The right rail lists it on a topic and a
  // Conversation (notebook_pages_native.mjs), and the outcome's own page after its topics. Two outcomes of the
  // person's: one with a page (which the side rail listed under its topics), one with none (where it kept its heading
  // and its pencil for the person, who may write it).
  const notebookOutcomes = async () => {
    for (const [outcome, topic] of [['rail-nb-o', 'rail-nb-t'], ['rail-nb-none', 'rail-nb-none-t']]) {
      await control({ method: 'light_outcome', outcome, title: outcome === 'rail-nb-o' ? 'Notebook outcome' : 'Empty Notebook outcome', topic: { id: topic, title: topic === 'rail-nb-t' ? 'Notebook topic' : 'Empty Notebook topic' } });
    }
    await control({ method: 'outcome_reference', operation_id: 'rail-nb-page', item_id: 'rail-nb-page', workspace_id: 'rail-nb-o', title: 'Rail plan', body: 'The plan the rail no longer lists.' });
  };
  // Whatever of the outcome's Notebook the side rail holds: its section, a pencil, a page's row, the heading's words
  // anywhere in it, and the page's title shown in it.
  const sideNotebook = p => p.evaluate(`(()=>{const r=document.getElementById('rail'),v=e=>e.checkVisibility();
    return {parts:r.querySelectorAll('#outcome-references, .notebook-create, .reference, .ol-notes').length,
      words:[...r.querySelectorAll('*')].filter(e=>v(e)&&[...e.childNodes].some(n=>n.nodeType===3&&/Outcome Notebook|Rail plan|More pages/.test(n.textContent))).length}})()`);
  // Every transition and animation on the page that ends has run its course (each one's finished promise); one that
  // repeats for ever (a light's pulse) never finishes and is left out.
  const settledMotion = p => p.evaluate('Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().endTime !== Infinity).map(a => a.finished.catch(() => null))).then(() => true)');
  const SIZE_464 = { laptop: SIZES.laptop, 390: SIZES.phone, 375: { width: 375, height: 760, deviceScaleFactor: 2, mobile: true }, 320: { width: 320, height: 700, deviceScaleFactor: 2, mobile: true } };
  const openAt = (name, url, size, theme) => page(name, null, true, { url: facts.origin + url, beforeNavigate: async q => {
    await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await q.send('Emulation.setDeviceMetricsOverride', SIZE_464[size]);
    if (SIZE_464[size].mobile) await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  } });

  // The header's pills in each state "☰ Outcomes" has (item 516), its count hidden or shown and its waiting light off or
  // on: nothing new and nothing waiting, a one-digit count, a one-digit count with the light, a two-digit count with the
  // light, a two-digit count without it, and the light alone (the question read and not yet answered). Every state is
  // measured at 320, 375, 390, a narrow laptop and a laptop, light and dark. On a phone the header row holds "☰ Outcomes",
  // the outcome's name and "Pipeline & pages". The name gives up its room first, down to none, and its place then costs
  // nothing beyond the one gap between the pills; so "Pipeline & pages" goes under, on the row's second line, whole and
  // inside the screen, exactly when "☰ Outcomes", one gap and "Pipeline & pages" are wider than the row (at 320, the light
  // with a count of one or two digits), and otherwise the two share the first line with the name between them, its
  // words a gap from each pill, clipped only when they are longer than the room left. At a narrow laptop (1024) the
  // outline is beside the page, so only "Pipeline & pages" shows, on the name's line; on a laptop both rails are beside
  // the page and neither pill shows. Nothing scrolls sideways: no element's box, where no box around it clips it, ends
  // past the right edge of the screen the page was opened at. (A page wider than a phone's screen widens Chromium's
  // layout viewport with it, so scrollWidth against innerWidth grows with the page and is no measure on its own.)
  await check('rail the header at 320, 375, 390, a narrow laptop and a laptop, light and dark, in each state of "☰ Outcomes" (nothing, a count, a count and the light, two digits with and without the light, the light alone): "Pipeline & pages" goes under "☰ Outcomes" only when the two pills and one gap do not fit the row, otherwise the outcome\'s name gives up its room and the two share one line, and nothing scrolls sideways', async () => {
    const news = async (from, to) => { for (let n = from; n < to; n++) await control({ method: 'agent_message', operation_id: `rail-head-${n}`, body: `News ${n} for the header`, topic_id: 'rail-head-t' }); };
    const SIZE_HEAD = { ...SIZE_464, 1024: { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false } };
    const openHead = (name, size, theme) => page(name, null, true, { url: facts.origin + '/?topic=t1', beforeNavigate: async q => {
      await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      await q.send('Emulation.setDeviceMetricsOverride', SIZE_HEAD[size]);
      if (SIZE_HEAD[size].mobile) await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    } });
    // Earlier checks leave news and questions in other outcomes, and "☰ Outcomes" totals every outcome the outline has
    // read; so the case starts by having the person read them. Each open topic with news, and then the Conversation of
    // an outcome that still has some, gets a post from the person that reads it through (and answers its asks). Then
    // each question an outcome's light still names, one at a time: an ask gets the person's reply (a Conversation's
    // next ask then waits), and a wait someone said is said otherwise. Each question is handled once; one that comes
    // back fails the case, naming it.
    const asks = item => item?.light?.light === 'waiting' && item.light.short?.kind === 'asks' ? item.light.short.count : 0;
    const busy = async () => { const listed = await view('workspaces', { limit: 100 });
      assert.equal(listed.next_cursor ?? null, null, 'every outcome is on one page of the list');
      return listed.items.filter(item => item.unread > 0 || asks(item) > 0); };
    const settle = async () => {
      const read = topic => control({ method: 'agent_message', operation_id: `rail-head-read-${topic}`, sender: 'person', topic_id: topic, whole_topic: true, read: true, body: 'Read, thanks.' });
      for (const item of await busy()) for (const topic of (await view('workspace_topics', { workspace_id: item.id, limit: 100 })).items)
        if (topic.unread > 0) await read(topic.id);
      for (const item of await busy()) if (item.unread > 0) await read((await view('conversation', { workspace_id: item.id })).conversation.topic_id);
      const handled = new Set();
      for (let [item] = await busy(); item; [item] = await busy()) {
        const question = (await view('outcome_light', { workspace_id: item.id })).facts.find(fact => fact.kind === 'ask');
        assert.ok(question, `${item.id} has nothing new and nothing waiting once read (${JSON.stringify(item)})`);
        const key = question.message_id ?? `said ${question.topic_id}`;
        assert.ok(!handled.has(key), `${item.id}: the question ${key} still waits once handled`);
        handled.add(key);
        if (question.message_id) await control({ method: 'agent_message', operation_id: `rail-head-answer-${question.message_id}`, sender: 'person', topic_id: question.topic_id, reply_to: question.message_id, read: true, body: 'Answered.' });
        else await control({ method: 'topic_state', operation_id: `rail-head-active-${question.topic_id}`, topic_id: question.topic_id, args: { state: 'active' } });
      }
    };
    // Each part of the header row as drawn, or null where it takes no room: its box (unrounded widths, so a fit is
    // judged as layout judges it), whether its content is wider than its box (clipped), and how many lines its words
    // take (text boxes whose middles are within 8px are a line). For the name, also where its words start and how wide
    // its words are when nothing clips them (measured in its own font); for the row, its top, its content width and the
    // gap between its parts.
    const header = p => p.evaluate(`(()=>{const el=id=>document.getElementById(id),c=el('rail-open'),row=document.querySelector('#main .eyebrow-row');
      const lines=e=>{const mids=[];const walk=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);for(let n=walk.nextNode();n;n=walk.nextNode()){
        if(!n.textContent.trim())continue;const r=document.createRange();r.selectNodeContents(n);for(const b of r.getClientRects())if(b.width>0)mids.push(b.top+b.height/2);}
        mids.sort((a,b)=>a-b);return mids.filter((m,i)=>i===0||m-mids[i-1]>8).length;};
      const part=e=>{if(!e||!e.getClientRects().length)return null;const b=e.getBoundingClientRect();
        return {left:b.left,right:b.right,top:Math.round(b.top),bottom:Math.round(b.bottom),mid:Math.round(b.top+b.height/2),
          width:b.width,half:b.height/2,clipped:e.scrollWidth>e.clientWidth+1,lines:lines(e)};};
      const words=e=>{const t=document.createTreeWalker(e,NodeFilter.SHOW_TEXT).nextNode();if(!t)return null;const r=document.createRange();r.selectNodeContents(t);return r.getClientRects()[0]?.left??null;};
      const natural=e=>{const s=getComputedStyle(e),g=document.createElement('canvas').getContext('2d');g.font=[s.fontStyle,s.fontWeight,s.fontSize,s.fontFamily].join(' ');return g.measureText(e.textContent).width;};
      const s=getComputedStyle(row);
      return {count:Number(c.querySelector('.unread-count:not([hidden])')?.textContent??0),light:Boolean(c.querySelector('.outcome-light:not([hidden])')),
        rows:[...document.querySelectorAll('#outline .ol-outcome')].map(li=>li.dataset.workspaceId),
        outcomes:part(c),pages:part(el('things-open')),name:part(el('workspace-name')),words:words(el('workspace-name')),natural:natural(el('workspace-name')),
        row:row.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),rowTop:Math.round(row.getBoundingClientRect().top+parseFloat(s.paddingTop)),gap:parseFloat(s.columnGap)||0,
        scroll:document.documentElement.scrollWidth,width:innerWidth};})()`);
    // The element whose box ends furthest right, each box cut at the right edge of every box around it (below the
    // body) that clips its overflow, as it is drawn.
    const rightmost = p => p.evaluate(`(()=>{const cut=e=>{let r=Infinity;for(let a=e.parentElement;a&&a!==document.body;a=a.parentElement)
        if(getComputedStyle(a).overflowX!=='visible')r=Math.min(r,a.getBoundingClientRect().right);return r;};
      let far={right:-Infinity,what:null};for(const e of document.body.querySelectorAll('*')){
        if(!e.getClientRects().length||getComputedStyle(e).visibility==='hidden')continue;const right=Math.min(e.getBoundingClientRect().right,cut(e));
        if(right>far.right)far={right,what:e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(e.classList[0]?'.'+e.classList[0]:'')};}
      return far;})()`);
    const sameLine = (a, b) => Math.abs(a.mid - b.mid) < Math.min(a.half, b.half);
    // Every measurement's first failed assertion, so one run says which states and widths fail, and the names seen
    // whole and clipped between the two pills.
    const failed = [], names = { whole: [], clipped: [] };
    // state: its words, which counts and light it is, and at 320 whether the two pills and one gap fit the row
    // ("Pipeline & pages" shares the line). Both engines give the same answer at 320 in every state; at 375 and 390
    // they fit in every state.
    // rows: the outcomes the outline must have drawn, so the total is read from them and not before they are read.
    const measure = async ({ state, is, fitsAt320, rows = ['w1', 'rail-head-o'] }) => {
      assert.equal(typeof fitsAt320, 'boolean', `${state}: the case says whether the two pills fit at 320`);
      for (const size of [320, 375, 390, 1024, 'laptop']) for (const theme of ['light', 'dark']) {
        const at = `${state}, ${size} ${theme}`, phone = SIZE_HEAD[size].mobile;
        const p = await openHead(`rail-head-${state.replace(/\W+/g, '-')}-${size}-${theme}`, size, theme);
        // The count and the light on "☰ Outcomes" are painted at every width (it only shows on a phone), and on a
        // middle or phone width "Pipeline & pages" is in the header before the row is measured.
        let last = null;
        const seen = await until(async () => { const h = last = await header(p); return is(h) && rows.every(id => h.rows.includes(id)) && (size === 'laptop' || h.pages) && h; }, `${at}: "☰ Outcomes" shows ${state}, and the header is drawn`)
          .catch(error => { throw Error(`${error.message} (last drawn: ${JSON.stringify(last)})`); });
        const far = await rightmost(p);
        const drawn = JSON.stringify({ ...seen, far }), screen = SIZE_HEAD[size].width;
        try {
          assert.ok(far.right <= screen + 0.5, `${at}: nothing scrolls sideways: ${far.what} ends at ${far.right}, past the right edge of the ${screen}px screen (scrollWidth ${seen.scroll}, innerWidth ${seen.width}) (${drawn})`);
          assert.ok(seen.scroll <= screen && seen.width <= screen, `${at}: no sideways scroll (${seen.scroll}, ${seen.width}, ${screen})`);
          if (phone) {
            const { outcomes, pages, name, row, gap } = seen;
            assert.ok(outcomes && pages, `${at}: both pills show (${drawn})`);
            for (const [pill, what] of [[outcomes, '"☰ Outcomes"'], [pages, '"Pipeline & pages"']]) {
              assert.ok(pill.left >= 0 && pill.right <= screen, `${at}: ${what} is inside the screen (${drawn})`);
              assert.ok(!pill.clipped && pill.lines === 1, `${at}: ${what} is whole, on one line of its own words (${drawn})`);
            }
            const fits = outcomes.width + gap + pages.width <= row;
            assert.equal(fits, size === 320 ? fitsAt320 : true, `${at}: the two pills and one gap ${size === 320 && !fitsAt320 ? 'do not fit' : 'fit'} the row (${drawn})`);
            // The row's lines: "☰ Outcomes" starts the first; the name stays on it; "Pipeline & pages" is on the first
            // when the two pills fit with one gap, and wholly under "☰ Outcomes", on the second, when they do not.
            const line = part => !part ? 'none' : sameLine(part, outcomes) ? 1 : part.top >= outcomes.bottom ? 2 : 'neither';
            assert.ok(Math.abs(outcomes.top - seen.rowTop) <= 1, `${at}: "☰ Outcomes" starts the header row's first line (${drawn})`);
            assert.deepEqual({ outcomes: 1, name: line(name), pages: line(pages) }, { outcomes: 1, name: 1, pages: fits ? 1 : 2 },
              `${at}: the line each is on: "☰ Outcomes" and the name the first, "Pipeline & pages" the ${fits ? 'first' : 'second'} (${drawn})`);
            assert.ok(seen.words >= outcomes.right + gap - 1, `${at}: the outcome's name starts a gap after "☰ Outcomes" (${drawn})`);
            if (fits) {
              assert.ok(name.left >= outcomes.right - 1 && name.right <= pages.left - gap + 1, `${at}: the outcome's name gives up its room, between the two pills, a gap before "Pipeline & pages" (${drawn})`);
              // Judged where its words and the room differ by more than 2px: scrollWidth is a whole number of pixels
              // and the words are measured apart from the line they are laid out on.
              const room = name.right - seen.words, longer = seen.natural > room;
              if (Math.abs(seen.natural - room) > 2) {
                assert.equal(name.clipped, longer, `${at}: the outcome's name is clipped exactly when its words (${seen.natural}px) are longer than the room left between the pills (${room}px) (${drawn})`);
                names[longer ? 'clipped' : 'whole'].push(at);
              }
            } else {
              assert.ok(name.right <= outcomes.left + row + 1, `${at}: the outcome's name ends inside the row (${drawn})`);
            }
          } else if (size === 1024) {
            assert.equal(seen.outcomes, null, `${at}: no "☰ Outcomes" with the outline beside the page (${drawn})`);
            assert.ok(seen.pages.right <= screen && !seen.pages.clipped && seen.pages.lines === 1 && sameLine(seen.pages, seen.name), `${at}: "Pipeline & pages" is whole on the name's line (${drawn})`);
            assert.equal(seen.name.clipped, false, `${at}: with room, the outcome's name is whole (${drawn})`);
          } else {
            assert.deepEqual([seen.outcomes, seen.pages], [null, null], `${at}: neither pill with both rails beside the page (${drawn})`);
            assert.equal(seen.name.clipped, false, `${at}: the outcome's name is whole (${drawn})`);
          }
          assert.ok(seen.name && seen.name.width > 0, `${at}: the outcome's name keeps a place in the header (${drawn})`);
          assert.deepEqual(p.errors, [], `${at}: no page errors`);
        } catch (error) {
          if (!(error instanceof assert.AssertionError)) throw error;
          failed.push(error.message);
        }
        await shot(p, `rail-head-${state.replace(/\W+/g, '-')}-${size}-${theme}`);
        await p.close();
      }
    };
    await settle();
    await measure({ state: 'nothing', is: h => h.count === 0 && !h.light, fitsAt320: true, rows: ['w1'] });
    await control({ method: 'light_outcome', outcome: 'rail-head-o', title: 'Header outcome', topic: { id: 'rail-head-t', title: 'Header topic' } });
    await news(0, 3);
    await measure({ state: 'a count', is: h => h.count >= 1 && h.count <= 9 && !h.light, fitsAt320: true });
    await control({ method: 'agent_message', operation_id: 'rail-head-ask', body: 'Which header do we keep?', topic_id: 'rail-head-t', addressees: [facts.actor], intent: 'ask' });
    await measure({ state: 'a count and the light', is: h => h.count >= 1 && h.count <= 9 && h.light, fitsAt320: false });
    await news(3, 10);
    await measure({ state: 'two digits and the light', is: h => h.count >= 10 && h.count <= 99 && h.light, fitsAt320: false });
    await control({ method: 'agent_message', operation_id: 'rail-head-answer', sender: 'person', topic_id: 'rail-head-t', whole_topic: true, body: 'This one.' });
    await measure({ state: 'two digits without the light', is: h => h.count >= 10 && h.count <= 99 && !h.light, fitsAt320: true });
    // A second question, which the person reads through and has not answered: the light with the count hidden.
    await control({ method: 'agent_message', operation_id: 'rail-head-ask-read', body: 'And which footer?', topic_id: 'rail-head-t', addressees: [facts.actor], intent: 'ask', read: true });
    await measure({ state: 'the light alone', is: h => h.count === 0 && h.light, fitsAt320: true });
    // It is answered, so the checks after this one start with nothing new and no light this one lit.
    await control({ method: 'agent_message', operation_id: 'rail-head-answer-read', sender: 'person', topic_id: 'rail-head-t', whole_topic: true, body: 'The short one.' });
    assert.equal(failed.length, 0, `${failed.length} of 60 measurements failed:\n${failed.join('\n')}`);
    assert.ok(names.whole.length && names.clipped.length, `the case sees the outcome's name both whole and clipped between the two pills (whole: ${names.whole.join('; ')}; clipped: ${names.clipped.join('; ')})`);
  });

  await check('rail the side rail shows no Outcome Notebook on a topic, a Conversation, a pipeline page or the outcome\'s page, with pages or none, at 320 375 390 and a laptop, light and dark', async () => {
    await notebookOutcomes();
    await control({ method: 'pipeline', kind: 'pipeline.configure', operation_id: 'rail-nb-pipeline', target: { workspace_id: 'rail-nb-o' }, workspace_id: 'rail-nb-o', args: { enabled: true } });
    const places = [['topic', '/?topic=rail-nb-t'], ['conversation', '/?conversation=rail-nb-o'], ['empty', '/?topic=rail-nb-none-t'], ['pipeline', '/?pipeline=rail-nb-o'], ['outcome', '/?workspace=rail-nb-o']];
    for (const size of ['laptop', 390, 375, 320]) for (const theme of ['light', 'dark']) for (const [kind, url] of places) {
      // The pipeline page and the outcome's page, which keep the side rail they had, at the widest and narrowest.
      if (['pipeline', 'outcome'].includes(kind) && ![ 'laptop', 320].includes(size)) continue;
      const at = `${kind} ${size} ${theme}`, phone = SIZE_464[size].mobile;
      const p = await openAt(`rail-nb-${kind}-${size}-${theme}`, url, size, theme);
      // Drawn as far as it goes: a feed page's outline holds its topics; the pipeline page's rail its topics; the
      // outcome's page lists its pages after its topics in the page itself.
      await until(() => p.evaluate(kind === 'outcome' ? `document.body?.dataset.ready==='true' && Boolean(document.querySelector('#outcome-page #outcome-references-list .reference'))`
        : kind === 'pipeline' ? `document.body?.dataset.ready==='true' && Boolean(document.querySelector('#rail #topics a[data-topic-id=rail-nb-t]'))`
        : `document.body?.dataset.ready==='true' && Boolean(document.querySelector('#topic-navigation a[data-topic-id]')) && (!matchMedia('(min-width: 1181px)').matches || document.querySelector('#things .things-sections')?.getAttribute('aria-busy')!=='true')`).catch(() => false), at + ': the page is drawn');
      if (phone && kind !== 'outcome') {
        await tap(p, '#rail-open');
        await until(async () => (await drawer(p)).open, at + ': the side rail opens over the page');
      }
      assert.deepEqual(await sideNotebook(p), { parts: 0, words: 0 }, at + ': the side rail holds nothing of the outcome\'s Notebook');
      const width = await p.evaluate('[document.documentElement.scrollWidth, innerWidth]');
      assert.ok(width[0] <= width[1], `${at}: no sideways scroll (${width})`);
      if (['topic', 'conversation'].includes(kind)) {
        // The outcome's page is on the right rail instead: on the Conversation from the start, on a topic one tap away.
        if (phone) {
          // A tap on the dimmed page beside the drawer closes it.
          const [w, h] = await p.evaluate('[innerWidth, innerHeight]');
          assert.equal(await p.evaluate(`document.elementFromPoint(${w - 12}, ${h / 2})?.id`), 'rail-backdrop', at + ': the dimmed page shows beside the drawer');
          await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: w - 12, y: h / 2 }] });
          await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await until(async () => !(await drawer(p)).open, at + ': the side rail closes');
          await settledMotion(p);
        }
        if (!await p.evaluate("matchMedia('(min-width: 1181px)').matches")) {
          await (phone ? tap(p, '#things-open') : p.point('#things-open'));
          await until(() => p.evaluate("document.documentElement.hasAttribute('data-things-open')"), at + ': the right rail opens');
          // The sheet slides up from the bottom: a finger aims once it has come to rest.
          await settledMotion(p);
        }
        if (kind === 'topic') {
          const chip = '#things .things-scope .chip:last-child';
          await until(() => p.evaluate("!document.querySelector('#things .things-scope').hidden && document.querySelector('#things .things-sections')?.getAttribute('aria-busy')!=='true'"), at + ': the right rail has read');
          await (phone ? tap(p, chip) : p.point(chip));
          await until(() => p.evaluate(`document.querySelector(${JSON.stringify(chip)}).getAttribute('aria-pressed')==='true'`), at + ': All of this outcome');
        }
        await until(() => p.evaluate(`Boolean(document.querySelector('#things .things-sec[data-key="notebook"] a.row[href$="page=rail-nb-page"]')?.checkVisibility())`), at + ': the right rail lists the page');
        await shot(p, `rail-nb-${kind}-${size}-${theme}-things`);
      } else if (kind === 'outcome') {
        assert.equal(await p.evaluate(`document.querySelector('#topic-navigation').compareDocumentPosition(document.querySelector('#outcome-references'))===Node.DOCUMENT_POSITION_FOLLOWING && !document.querySelector('#rail').contains(document.querySelector('#outcome-references'))`),
          true, at + ': the outcome\'s own page lists its pages after its topics, outside any rail');
      }
      await shot(p, `rail-nb-${kind}-${size}-${theme}`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('rail ↑ and ↓ in the outline step from the last row under an open outcome straight to the next outcome and back, with no Notebook row between, on a topic and after a move to its Conversation', async () => {
    await notebookOutcomes();
    const p = await open('rail-nb-keys', '/?topic=rail-nb-t');
    await settled(p, 'the topic is up');
    // The rows under rail-nb-o as the tree lists them, and the outcome after it.
    const span = async () => {
      const rows = (await keyTree(p)).rows, from = rows.indexOf('name:rail-nb-o');
      const next = rows.findIndex((row, n) => n > from && row.startsWith('name:'));
      assert.ok(from >= 0 && next > from, 'the outline lists the outcome and one after it: ' + rows);
      return { under: rows.slice(from, next), next: rows[next] };
    };
    // Where the keys are, and whether what holds the focus is a row on show in the outline.
    const keyed = async () => ({ at: await keyedAt(p), live: await p.evaluate("(e=>Boolean(e&&e.isConnected&&e.checkVisibility()&&e.closest('#outline')&&e.getAttribute('role')==='treeitem'))(document.activeElement)") });
    const walk = async (start, label) => {
      const { under, next } = await span();
      assert.deepEqual(under.filter(row => /^outline:(|Rail plan|More pages|.*Notebook.*)$/.test(row)), [], `${label}: no Notebook row under the outcome: ${under}`);
      // ↓ from where the keys are visits every row after it in turn, skipping none, to the next outcome.
      const seen = [];
      for (let n = 0; n <= under.length && (await keyedAt(p)) !== next; n++) { await p.key('ArrowDown'); const k = await keyed(); assert.ok(k.live, `${label}: ↓ lands on a row on show, not ${k.at}`); seen.push(k.at); }
      assert.deepEqual(seen, [...under.slice(under.indexOf(start) + 1), next], `${label}: ↓ visits each row in turn and then the next outcome`);
      // ↑ from the next outcome comes back to the last row under this one.
      await p.key('ArrowUp');
      assert.deepEqual(await keyed(), { at: under.at(-1), live: true }, `${label}: ↑ comes back to the last row under the outcome`);
      return under;
    };
    await tabToOutline(p);
    assert.equal(await keyedAt(p), 'topic:rail-nb-t', 'the keys start on the topic being read');
    await walk('topic:rail-nb-t', 'on the topic');
    // Return on the outcome's row opens its Conversation in place; the keys stay in the outline and walk the same.
    for (let n = 0; n < 12 && (await keyedAt(p)) !== 'name:rail-nb-o'; n++) await p.key('ArrowUp');
    assert.equal(await keyedAt(p), 'name:rail-nb-o');
    await p.key('Enter');
    await arrived(p, '?conversation=rail-nb-o', null, 'Return on the outcome opens its Conversation in place');
    await until(async () => (await keyedAt(p)) === 'name:rail-nb-o', 'the keys stay on the outcome');
    await settled(p, 'the Conversation is up');
    await walk('name:rail-nb-o', 'on the Conversation');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // ---- Build topics show once, in the right rail (item 297) ----
  // An outcome with a pipeline and four topics: one plain, and three a piece is
  // built in. rb-now's piece is in Now, with two new messages there, one sent
  // to the person by name; rb-review's piece is done and the topic is Ready for
  // review; rb-wait's piece is done and its agent asks the person something.
  const BUILD_AGENT = 'fixture-notebook-agent';
  const buildPipe = (operation, kind, target, args) => control({ method: 'pipeline', kind, operation_id: 'rail-build-' + operation, target, workspace_id: 'rail-build-o', args });
  let buildMade = null;
  const buildOutcome = () => (buildMade ??= (async () => {
    await control({ method: 'navigation_workspaces', workspaces: [{ id: 'rail-build-o', title: 'Build topics', team: [BUILD_AGENT] }] });
    await control({ method: 'navigation_topics', topics: [['rb-plain', 'Plain talk'], ['rb-now', 'Built now'], ['rb-review', 'Built and live'], ['rb-wait', 'Built, asking you']]
      .map(([id, title]) => ({ id, title, workspace_id: 'rail-build-o' })) });
    await buildPipe('on', 'pipeline.configure', { workspace_id: 'rail-build-o' }, { enabled: true });
    await buildPipe('stages', 'pipeline.stages_set', { workspace_id: 'rail-build-o' }, { stages: [{ stage_id: 'build', name: 'Build' }] });
    const pieces = {};
    for (const topic of ['rb-now', 'rb-review', 'rb-wait']) {
      const { result: { number } } = await buildPipe('item-' + topic, 'pipeline.item_add', { workspace_id: 'rail-build-o' }, { title: 'Item for ' + topic, section: 'now', size: 'small', sources: [{ note: 'the check' }] });
      pieces[topic] = (await buildPipe('start-' + topic, 'pipeline.piece_start', { workspace_id: 'rail-build-o' }, { numbers: [number], topic_id: topic, stage_id: 'build' })).result.piece_id;
    }
    for (const topic of ['rb-review', 'rb-wait']) await buildPipe('finish-' + topic, 'pipeline.piece_finish', { piece_id: pieces[topic] }, {});
    await control({ method: 'topic_state', operation_id: 'rail-build-review', topic_id: 'rb-review', args: { state: 'review', note: 'Live in release 5' } });
    await control({ method: 'topic_state', operation_id: 'rail-build-wait-active', topic_id: 'rb-wait', args: { state: 'active', note: '' } });
    await control({ method: 'agent_message', operation_id: 'rail-build-new-1', sender: BUILD_AGENT, topic_id: 'rb-now', whole_topic: true, body: 'Built the first part' });
    await control({ method: 'agent_message', operation_id: 'rail-build-new-2', sender: BUILD_AGENT, topic_id: 'rb-now', whole_topic: true, body: 'This one is for you', post_args: { addressees: [facts.actor], intent: 'tell' } });
    await control({ method: 'agent_message', operation_id: 'rail-build-ask', sender: BUILD_AGENT, topic_id: 'rb-wait', whole_topic: true, body: 'Which one should ship first?', post_args: { addressees: [facts.actor], intent: 'ask' } });
  })());
  // The right rail's Build topics as drawn, each with its group, its marks, the
  // line under it and its size; and the outline's topic rows of the outcome,
  // whether or not the drawer that holds them is open, with their marks.
  const buildRail = (p, outcome = 'rail-build-o') => p.evaluate(`(()=>{const shown=e=>Boolean(e)&&e.checkVisibility();
    const marks=a=>{const badge=a.querySelector('.unread-count'),state=a.querySelector('.topic-state');
      return {unread:badge?Number(badge.textContent):0,byName:Boolean(badge?.classList.contains('addressed')),state:state?state.textContent:null,mine:Boolean(state?.classList.contains('mine'))}};
    const rows=[...document.querySelectorAll('#things .things-sec[data-key=pipeline] .pipe-builds a.row')].filter(shown).map(a=>{const box=a.getBoundingClientRect();
      return {id:new URLSearchParams(a.getAttribute('href')).get('topic'),group:a.closest('ul').previousElementSibling?.textContent??null,...marks(a),
        stage:a.querySelector('.sub')?.textContent??null,current:a.getAttribute('aria-current'),height:Math.round(box.height),right:Math.round(box.right)}});
    const li=document.querySelector('#outline .ol-outcome[data-workspace-id="${outcome}"]'),outcome=li?.querySelector('.ol-adopted')??li,done=outcome?.querySelector('details.topic-group');
    const listed=[...(outcome?.querySelectorAll('.ol-topics a[data-topic-id]')??[])];
    return {rows,outline:listed.filter(a=>!a.closest('details.topic-group')).map(a=>({id:a.dataset.topicId,...marks(a)})),
      done:listed.filter(a=>a.closest('details.topic-group')===done&&shown(a)).map(a=>a.dataset.topicId),doneLabel:done&&!done.hidden?done.querySelector('summary').textContent:null,
      groups:[...document.querySelectorAll('#things .things-sec[data-key=pipeline] .pipe-label')].filter(shown).map(e=>e.textContent),
      busy:document.querySelector('#things .things-sections')?.getAttribute('aria-busy')==='true',
      things:(t=>t?[t.scrollWidth,t.clientWidth,Math.round(t.getBoundingClientRect().right)]:null)(document.getElementById('things')),scroll:[document.documentElement.scrollWidth,innerWidth],
      wide:[...document.querySelectorAll('#things *')].filter(e=>e.checkVisibility()&&e.getBoundingClientRect().right>innerWidth).slice(-4).map(e=>e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+'.'+[...e.classList].join('.')+':'+e.getBoundingClientRect().right)}})()`);
  const BUILD_ROWS = [
    { id: 'rb-now', group: 'Now', unread: 2, byName: true, state: null, mine: false },
    { id: 'rb-review', group: 'Ready for review', unread: 0, byName: false, state: 'Ready for review', mine: false },
    { id: 'rb-wait', group: 'Other Build topics', unread: 1, byName: true, state: 'Waiting on you', mine: true },
  ];
  const marksOf = rows => rows.map(({ id, group, unread, byName, state, mine }) => ({ id, group, unread, byName, state, mine }));
  // The page up with its right rail on screen: beside the page on a laptop, opened from "Pipeline & pages" on a phone.
  const buildRailShown = async (p, at, phone) => {
    await until(() => p.evaluate(`document.body?.dataset.ready==='true' && Boolean(document.querySelector('#outline #topic-navigation'))`).catch(() => false), at + ': the page is up');
    if (!await p.evaluate("matchMedia('(min-width: 1181px)').matches")) {
      await (phone ? tap(p, '#things-open') : p.point('#things-open'));
      await until(() => p.evaluate("document.documentElement.hasAttribute('data-things-open')"), at + ': "Pipeline & pages" opens the right rail');
      await settledMotion(p);
    }
  };

  await check('rail on an outcome with a pipeline a Build topic shows once, in the right rail, carrying its unread count, the sent-by-name badge, Waiting on you and its state mark, and not in the outline; at 320 375 390 and a laptop, light and dark', async () => {
    await buildOutcome();
    for (const size of ['laptop', 390, 375, 320]) for (const theme of ['light', 'dark']) {
      const at = `${size} ${theme}`, phone = SIZE_464[size].mobile;
      const p = await openAt(`rail-build-${size}-${theme}`, '/?conversation=rail-build-o', size, theme);
      await buildRailShown(p, at, phone);
      const seen = await until(async () => { const now = await buildRail(p); return !now.busy && now.rows.length === 3 && now.outline.some(row => row.id === 'rb-plain') && now; }, at + ': the right rail lists the Build topics, and the outline the rest');
      assert.deepEqual(marksOf(seen.rows), BUILD_ROWS, at + ': each Build topic once, in its group, with what its outline row would carry');
      assert.match(seen.rows[0].stage, /^Build · since /, at + ': the piece in Now says its stage');
      assert.deepEqual(seen.outline.map(row => row.id), ['rb-plain'], at + ': the outline lists the outcome\'s other topic, and no Build topic');
      assert.deepEqual(seen.groups, ['Live', 'Now', 'Ready for review', 'Other Build topics'], at + ': the pipeline\'s groups');
      if (phone) for (const row of seen.rows) assert.ok(row.height >= 44, `${at}: ${row.id} is at least 44px to touch (${row.height})`);
      // The page's own header is not this case's (at 320 a two-digit count beside ☰ Outcomes can push "Pipeline & pages" past the edge in WebKit).
      assert.deepEqual(seen.wide, [], `${at}: nothing in the right rail passes the page's edge (the page is ${seen.scroll})`);
      assert.ok(seen.things[0] <= seen.things[1] && seen.rows.every(row => row.right <= seen.things[2]), `${at}: nothing in the right rail is cut or scrolls sideways (${seen.things})`);
      await shot(p, `rail-build-${size}-${theme}`);
      assert.deepEqual(p.errors, []); await p.close();
    }
    // From another outcome's topic, opened for a look with ⌘→, its topics in the outline are the outline's own list: no Build topic there either.
    const peek = await open('rail-build-peek', '/?topic=t1');
    await settled(peek, 'another outcome\'s topic is up');
    await keysTo(peek, 'name:rail-build-o');
    await peek.key('ArrowRight', 4);
    const looked = await until(async () => { const now = await buildRail(peek); return now.outline.some(row => row.id === 'rb-plain') && now; }, '⌘→ opens the outcome\'s topics in the outline');
    assert.deepEqual(looked.outline.map(row => row.id), ['rb-plain'], 'its own list in the outline leaves the Build topics to the right rail');
    assert.deepEqual(peek.errors, []); await peek.close();
    // Off, the outcome has no pipeline to show them in: every topic is back in the outline, carrying what the rail's row did, and the rail lists them not.
    const p = await openAt('rail-build-off', '/?conversation=rail-build-o', 'laptop', 'light');
    await buildRailShown(p, 'off', false);
    await until(async () => (await buildRail(p)).rows.length === 3, 'the Build topics are in the right rail');
    await buildPipe('off', 'pipeline.configure', { workspace_id: 'rail-build-o' }, { enabled: false });
    try {
      const off = await until(async () => { const now = await buildRail(p); return now.outline.length === 4 && !now.busy && !now.groups.includes('Ready for review') && now; }, 'turned off, the outline lists every topic, live');
      for (const row of BUILD_ROWS) {
        const { id, unread, byName, state, mine } = row;
        assert.deepEqual(off.outline.find(each => each.id === id), { id, unread, byName, state, mine }, `${id}: the outline's row carries what the right rail's did`);
      }
      assert.ok(!off.groups.includes('Other Build topics'), 'and the right rail shows no Build topics');
      assert.ok(off.rows.every(row => row.unread === 0 && row.state === null), 'what the pipeline still lists in Now carries no topic\'s marks, as before');
    } finally {
      await buildPipe('on-again', 'pipeline.configure', { workspace_id: 'rail-build-o' }, { enabled: true });
    }
    await until(async () => { const now = await buildRail(p); return now.rows.length === 3 && now.outline.length === 1 && now; }, 'on again, they are the right rail\'s again, live');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail a Build topic Ready for review stays in the right rail until it is marked Done, then folds into the outline\'s Done group; reopened, it is the right rail\'s again', async () => {
    await buildOutcome();
    const p = await openAt('rail-build-done', '/?conversation=rail-build-o', 'laptop', 'light');
    await buildRailShown(p, 'done', false);
    const before = await until(async () => { const now = await buildRail(p); return !now.busy && now.rows.length === 3 && now.outline.length && now; }, 'the right rail lists the Build topics');
    assert.equal(before.rows.find(row => row.id === 'rb-review')?.group, 'Ready for review', 'Ready for review, it is in the right rail');
    assert.equal(before.doneLabel, null, 'the outcome has no Done topic yet');
    await control({ method: 'topic_state', operation_id: 'rail-build-done-1', topic_id: 'rb-review', args: { state: 'done' } });
    const done = await until(async () => { const now = await buildRail(p); return !now.rows.some(row => row.id === 'rb-review') && now.doneLabel === 'Done (1)' && now; }, 'marked Done, it leaves the right rail and the outline counts it Done, live');
    assert.deepEqual(done.outline.map(row => row.id), ['rb-plain'], 'it is not among the outline\'s open topics');
    await p.point('#outline .ol-outcome[data-workspace-id="rail-build-o"] details.topic-group > summary');
    await until(async () => (await buildRail(p)).done.includes('rb-review'), 'the outline\'s Done group lists it');
    await shot(p, 'rail-build-done');
    // Reopened, it is a Build topic not Done again.
    await control({ method: 'topic_state', operation_id: 'rail-build-done-reopen', topic_id: 'rb-review', args: { state: 'active', note: '' } });
    const back = await until(async () => { const now = await buildRail(p); return now.rows.some(row => row.id === 'rb-review') && now.doneLabel === null && now; }, 'reopened, it is in the right rail again and out of the Done group');
    assert.equal(back.rows.find(row => row.id === 'rb-review').group, 'Other Build topics');
    assert.deepEqual(back.outline.map(row => row.id), ['rb-plain'], 'and still not in the outline');
    await control({ method: 'topic_state', operation_id: 'rail-build-done-review', topic_id: 'rb-review', args: { state: 'review', note: 'Live in release 5' } });
    await until(async () => (await buildRail(p)).rows.find(row => row.id === 'rb-review')?.group === 'Ready for review', 'Ready for review again');
    // The Done line is kept open on this browser for every outcome; put it back as it was.
    await p.evaluate("(()=>{for (const key of Object.keys(localStorage)) if (key.startsWith('aim-next.topic-lists.')) localStorage.removeItem(key); return true})()");
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail the keys reach a Build topic from the right rail: ↓ to its row, Return opens it in place and the keys stay on its row, marked as the topic being read, with every Build topic still listed', async () => {
    await buildOutcome();
    const p = await openAt('rail-build-keys', '/?conversation=rail-build-o', 'laptop', 'light');
    await settled(p, 'the Conversation is up');
    await until(async () => (await buildRail(p)).rows.length === 3, 'the right rail lists the Build topics');
    const start = await placeOf(p);
    await p.key('ArrowRight');
    assert.match(await keyedAt(p), /^things:/, '→ from the page goes to the right rail');
    await p.key('Home');
    const name = 'things:pipeline:?topic=rb-review';
    const rows = await p.evaluate("[...document.querySelectorAll('#things [role=treeitem]')].filter(e=>e.checkVisibility()).length");
    for (let n = 0; n < rows && await keyedAt(p) !== name; ++n) await p.key('ArrowDown');
    assert.equal(await keyedAt(p), name, '↓ reaches the Build topic Ready for review');
    await p.key('Enter');
    assert.equal((await arrived(p, '?topic=rb-review', 'Built and live', 'Return opens it')).origin, start.origin, 'in place, with no load');
    await settled(p, 'the topic is up');
    await until(async () => await keyedAt(p) === name, 'the keys stay on its row');
    const there = await until(async () => { const now = await buildRail(p); return now.rows.length === 3 && now; }, 'on the topic, the right rail lists every Build topic still');
    assert.deepEqual(there.rows.map(row => [row.id, row.current]), [['rb-now', null], ['rb-review', 'page'], ['rb-wait', null]], 'its row is marked as the topic being read');
    assert.deepEqual(there.outline.map(row => row.id), ['rb-plain'], 'and the outline lists it not');
    // ↑ to the piece in Now and Return opens that one.
    await p.key('ArrowUp');
    assert.equal(await keyedAt(p), 'things:pipeline:?topic=rb-now', '↑ reaches the piece in Now');
    await p.key('Enter');
    await arrived(p, '?topic=rb-now', 'Built now', 'Return opens it');
    await until(async () => await keyedAt(p) === 'things:pipeline:?topic=rb-now', 'the keys stay on its row');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // What is new in a Build topic is counted where the person can reach it
  // (docs/rails.md, "Counts" and "Chips"): the outline has no row for one, so
  // an open outcome's row counts its Build topics with its Conversation, a
  // press on that row opens the Conversation beside the right rail that lists
  // them, and on a phone "Pipeline & pages" carries the count to the sheet.
  // Each count is read from Core as it stands when the case runs.
  const buildNews = async (operation, n) => {
    for (let at = 0; at < n; ++at) await control({ method: 'agent_message', operation_id: `rail-build-news-${operation}-${at}`, sender: BUILD_AGENT, topic_id: 'rb-now', whole_topic: true, body: `News ${operation} ${at}` });
  };
  // Core's counts: what is new in an outcome's open Build topics, summed from their own rows, and in its Conversation.
  const buildCounts = async id => {
    const builds = (await view('workspace_topics', { workspace_id: id, build: true, limit: 100 })).items;
    const conversation = (await view('conversation', { workspace_id: id })).conversation;
    return { build: builds.reduce((sum, item) => sum + (item.unread ?? 0), 0), conversation: conversation?.unread ?? 0 };
  };
  // A phone's page up: its right rail reads only once it is opened, so its sections are not waited on.
  const phoneUp = (p, what) => until(() => p.evaluate(`document.body?.dataset.ready==='true' && Boolean(document.querySelector('#outline #topic-navigation'))`).catch(() => false), what);
  // "Pipeline & pages" as drawn: its badge, its name for a screen reader, its size and its edge.
  const thingsButton = p => p.evaluate(`(()=>{const b=document.getElementById('things-open');if(!b)return null;const badge=b.querySelector('.unread-count'),box=b.getBoundingClientRect();
    return {shown:b.checkVisibility(),badge:badge&&badge.checkVisibility()?Number(badge.textContent):0,label:b.getAttribute('aria-label'),height:Math.round(box.height),right:Math.round(box.right),
      badgeRight:badge&&badge.checkVisibility()?Math.round(badge.getBoundingClientRect().right):0,
      width:innerWidth,scroll:document.documentElement.scrollWidth,sum:document.querySelector('#things .things-sec[data-key=pipeline] > summary .sum')?.textContent??null}})()`);

  await check('rail "N new" pressed from another outcome\'s topic counts a Build topic\'s new messages on its outcome\'s row, and a press on that row reaches them in its right rail', async () => {
    await buildOutcome();
    await buildNews('chip', 3);
    const p = await openAt('rail-build-chip', '/?topic=t1', 'laptop', 'light');
    await settled(p, 'another outcome\'s topic is up');
    await until(() => p.evaluate(`!document.getElementById('outline-only-new').disabled`), 'something is new');
    await p.point('#outline-only-new');
    const want = await buildCounts('rail-build-o');
    assert.ok(want.build >= 3, `Core counts the Build topic's new messages apart (${JSON.stringify(want)})`);
    const shown = await until(async () => { const now = await outline(p); return now.outcomes['rail-build-o']?.open && now.outcomes['rail-build-o'].count === want.build + want.conversation && now; },
      `"N new" shows the outcome open, its row counting its Conversation and its Build topics (${JSON.stringify(want)})`);
    assert.ok(!shown.outcomes['rail-build-o'].topics.some(row => row.id.startsWith('rb-') && row.id !== 'rb-plain'), 'and still no Build topic among its rows');
    // Another outcome shown open counts its Conversation alone, its Build topics having nothing new.
    for (const [id, row] of Object.entries(shown.outcomes)) {
      if (id === 'rail-build-o' || !row.open) continue;
      const other = await buildCounts(id);
      assert.equal(row.count, other.conversation + other.build, `${id}: its row counts its Conversation and its Build topics, once each (${JSON.stringify(other)})`);
    }
    const spoken = await p.evaluate(`document.querySelector('#outline .ol-outcome[data-workspace-id="rail-build-o"] .ol-name .sr-only')?.textContent ?? ''`);
    assert.match(spoken, /its Build topics$/, 'a screen reader hears where they are: ' + spoken);
    await shot(p, 'rail-build-chip');
    await p.point('#outline .ol-outcome[data-workspace-id="rail-build-o"] .ol-name');
    await arrived(p, '?conversation=rail-build-o', null, 'a press on the row opens its Conversation');
    await settled(p, 'the Conversation is up');
    const there = await until(async () => { const now = await buildRail(p); return now.rows.find(row => row.id === 'rb-now')?.unread >= 3 && now; }, 'beside it, the right rail lists the Build topic with its new messages');
    assert.equal(there.rows.reduce((sum, row) => sum + row.unread, 0), want.build, 'the right rail\'s rows hold every one the row counted');
    assert.equal((await thingsButton(p)).sum, `${there.groups.includes('Now') ? 1 : 0} in Now · ${want.build} new`, 'folded, the Pipeline section would still say what is new');
    await shot(p, 'rail-build-chip-arrived');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail on a phone, on a Build topic\'s outcome, the drawer\'s outcome row counts its Build topics\' new messages and "Pipeline & pages" carries them to their rows; at 320 375 390, light and dark', async () => {
    await buildOutcome();
    await buildNews('phone', 2);
    const want = await buildCounts('rail-build-o');
    assert.ok(want.build >= 2, JSON.stringify(want));
    for (const size of [390, 375, 320]) for (const theme of ['light', 'dark']) {
      const at = `${size} ${theme}`;
      const p = await openAt(`rail-build-phone-${size}-${theme}`, '/?conversation=rail-build-o', size, theme);
      await phoneUp(p, at + ': the Conversation is up');
      const button = await until(async () => { const now = await thingsButton(p); return now?.badge === want.build && now; }, at + ': "Pipeline & pages" carries the Build topics\' count');
      assert.equal(button.label, `Pipeline & pages, ${want.build} new in Build topics`, at + ': and says so to a screen reader');
      // Against the width the phone has: a page wider than it can widen what the page itself measures.
      const edge = SIZE_464[size].width;
      assert.ok(button.height >= 44 && button.right <= edge && button.badgeRight <= edge && button.scroll <= edge, `${at}: it is 44px to touch, its count inside the ${edge}px screen, with no sideways scroll (${JSON.stringify(button)})`);
      await shot(p, `rail-build-phone-${size}-${theme}`);
      await tap(p, '#rail-open');
      await until(async () => (await drawer(p)).open, at + ': the drawer opens');
      const row = await until(async () => { const now = (await outline(p)).outcomes['rail-build-o']; return now?.open && now.count === want.build + want.conversation && now; }, at + ': the outcome\'s row counts its Build topics with its Conversation');
      assert.ok(!row.topics.some(each => ['rb-now', 'rb-review', 'rb-wait'].includes(each.id)), at + ': and lists none of them');
      await shot(p, `rail-build-phone-drawer-${size}-${theme}`);
      await p.key('Escape');
      await until(async () => !(await drawer(p)).open, at + ': Escape closes the drawer');
      await tap(p, '#things-open');
      await until(() => p.evaluate("document.documentElement.hasAttribute('data-things-open')"), at + ': "Pipeline & pages" opens the right rail');
      await settledMotion(p);
      const rail = await until(async () => { const now = await buildRail(p); return !now.busy && now.rows.length === 3 && now; }, at + ': the sheet lists the Build topics');
      assert.equal(rail.rows.reduce((sum, each) => sum + each.unread, 0), want.build, at + ': its rows hold what the button counted');
      assert.match((await thingsButton(p)).sum, new RegExp(` · ${want.build} new$`), at + ': and the Pipeline section says it');
      assert.deepEqual(p.errors, []); await p.close();
    }
    // Where no Build topic holds anything new, "Pipeline & pages" carries no count.
    const quiet = await openAt('rail-build-phone-quiet', '/?conversation=w1', 390, 'light');
    await phoneUp(quiet, 'another outcome\'s Conversation is up');
    assert.equal((await buildCounts('w1')).build, 0);
    await until(async () => { const now = (await outline(quiet)).outcomes; return now.w1?.open && Boolean(now['rail-build-o']); }, 'the outline has read the outcomes, the Build topics\' outcome among them');
    const none = await thingsButton(quiet);
    assert.deepEqual([none.badge, none.label], [0, null], 'no count, and no words for one');
    assert.deepEqual(quiet.errors, []); await quiet.close();
  });

  // More topics (docs/rails.md, Pipeline): an outcome with more Build topics
  // than a page, each piece done, so every one is among Other Build topics.
  const MANY = 23;
  let manyMade = null;
  const manyOutcome = () => (manyMade ??= (async () => {
    const pipe = (operation, kind, target, args) => control({ method: 'pipeline', kind, operation_id: 'rail-many-' + operation, target, workspace_id: 'rail-many-o', args });
    await control({ method: 'navigation_workspaces', workspaces: [{ id: 'rail-many-o', title: 'Many Build topics', team: [BUILD_AGENT] }] });
    await control({ method: 'navigation_topics', topics: Array.from({ length: MANY }, (_, n) => ({ id: `rm-${String(n).padStart(2, '0')}`, title: `Built ${n}`, workspace_id: 'rail-many-o' })) });
    await pipe('on', 'pipeline.configure', { workspace_id: 'rail-many-o' }, { enabled: true });
    await pipe('stages', 'pipeline.stages_set', { workspace_id: 'rail-many-o' }, { stages: [{ stage_id: 'build', name: 'Build' }] });
    for (let n = 0; n < MANY; ++n) {
      const topic = `rm-${String(n).padStart(2, '0')}`;
      const { result: { number } } = await pipe('item-' + topic, 'pipeline.item_add', { workspace_id: 'rail-many-o' }, { title: 'Item for ' + topic, section: 'now', size: 'small', sources: [{ note: 'the check' }] });
      const { result: { piece_id } } = await pipe('start-' + topic, 'pipeline.piece_start', { workspace_id: 'rail-many-o' }, { numbers: [number], topic_id: topic, stage_id: 'build' });
      await pipe('finish-' + topic, 'pipeline.piece_finish', { piece_id }, {});
    }
  })());
  const moreTopics = p => p.evaluate(`(()=>{const b=[...document.querySelectorAll('#things .things-sec[data-key=pipeline] .things-more')].find(e=>e.checkVisibility());
    return b?{text:b.textContent,height:Math.round(b.getBoundingClientRect().height)}:null})()`);

  await check('rail More topics in the right rail brings 20 more Build topics, and Return on it hands the keys to the first one it brought; a tap on a phone brings them too', async () => {
    await manyOutcome();
    const order = (await view('workspace_topics', { workspace_id: 'rail-many-o', build: true, limit: MANY })).items.map(item => item.id);
    assert.equal(order.length, MANY, 'Core lists every Build topic');
    const p = await openAt('rail-many-keys', '/?conversation=rail-many-o', 'laptop', 'light');
    await settled(p, 'the Conversation is up');
    const first = await until(async () => { const now = await buildRail(p); return !now.busy && now.rows.length === 20 && now; }, 'the right rail lists the first 20 Build topics');
    assert.deepEqual(first.rows.map(row => row.id), order.slice(0, 20), 'in Core\'s order');
    assert.equal((await moreTopics(p))?.text, 'More topics', 'and offers More topics');
    await p.key('ArrowRight');
    assert.match(await keyedAt(p), /^things:/, '→ from the page goes to the right rail');
    await p.key('Home');
    const rows = await p.evaluate("[...document.querySelectorAll('#things [role=treeitem]')].filter(e=>e.checkVisibility()).length");
    for (let n = 0; n < rows && await keyedAt(p) !== 'things:pipeline:More topics'; ++n) await p.key('ArrowDown');
    assert.equal(await keyedAt(p), 'things:pipeline:More topics', '↓ reaches More topics');
    await p.key('Enter');
    const all = await until(async () => { const now = await buildRail(p); return now.rows.length === MANY && now; }, 'Return brings the rest');
    assert.deepEqual(all.rows.map(row => row.id), order, 'every Build topic, once, in Core\'s order');
    await until(async () => await keyedAt(p) === `things:pipeline:?topic=${order[20]}`, 'the keys are on the first row it brought');
    assert.equal(await moreTopics(p), null, 'and with none left, no More topics');
    await shot(p, 'rail-many-more');
    assert.deepEqual(p.errors, []); await p.close();
    // On a phone, by touch.
    const t = await openAt('rail-many-tap', '/?conversation=rail-many-o', 320, 'dark');
    await phoneUp(t, '320: the Conversation is up');
    await tap(t, '#things-open');
    await until(() => t.evaluate("document.documentElement.hasAttribute('data-things-open')"), '320: the right rail opens');
    await settledMotion(t);
    await until(async () => (await buildRail(t)).rows.length === 20, '320: the first 20');
    const more = await moreTopics(t);
    assert.ok(more && more.height >= 44, `320: More topics is 44px to touch (${JSON.stringify(more)})`);
    await t.evaluate("document.querySelector('#things .things-sec[data-key=pipeline] .things-more').scrollIntoView({block:'center'})");
    await tap(t, '#things .things-sec[data-key=pipeline] .things-more');
    await until(async () => (await buildRail(t)).rows.length === MANY, '320: a tap brings the rest');
    await shot(t, 'rail-many-more-320-dark');
    assert.deepEqual(t.errors, []); await t.close();
    // An outcome with fewer Build topics than a page offers no More topics.
    await buildOutcome();
    const few = await openAt('rail-many-few', '/?conversation=rail-build-o', 'laptop', 'light');
    await settled(few, 'the outcome with three Build topics is up');
    await until(async () => (await buildRail(few)).rows.length === 3, 'its three Build topics');
    assert.equal(await moreTopics(few), null, 'no More topics');
    assert.deepEqual(few.errors, []); await few.close();
  });

  await check('rail a Build topic waiting on the reader opens at the question from its row in the right rail, and one waiting on nobody opens at the topic', async () => {
    await buildOutcome();
    const listed = (await view('workspace_topics', { workspace_id: 'rail-build-o', build: true, limit: 10 })).items;
    const ask = listed.find(item => item.id === 'rb-wait').asks.find(each => each.actor_id === facts.actor)?.message_id;
    assert.ok(ask, 'Core says rb-wait waits on the reader\'s answer');
    const p = await openAt('rail-build-question', '/?conversation=rail-build-o', 'laptop', 'light');
    await settled(p, 'the Conversation is up');
    await until(async () => (await buildRail(p)).rows.length === 3, 'the right rail lists the Build topics');
    const hrefs = Object.fromEntries(await p.evaluate(`[...document.querySelectorAll('#things .things-sec[data-key=pipeline] .pipe-builds a.row')].map(a=>{const q=new URLSearchParams(a.getAttribute('href'));return [q.get('topic'),q.get('message')]})`));
    assert.deepEqual(hrefs, { 'rb-now': null, 'rb-review': null, 'rb-wait': ask }, 'the row waiting on the reader names the question; the others name none');
    await p.point('#things .pipe-builds a.row[href*="topic=rb-wait"]');
    const reader = await until(async () => { const seen = await p.evaluate(`(r=>({open:r.open,text:r.textContent,topic:new URL(location.href).searchParams.get('topic')}))(document.querySelector('#reader'))`); return seen.open && seen.topic === 'rb-wait' && seen; }, 'a press opens the topic with the question in the Reader');
    assert.match(reader.text, /Which one should ship first\?/, 'the question itself');
    await shot(p, 'rail-build-question');
    await p.key('Escape');
    await until(() => p.evaluate(`!document.querySelector('#reader').open`), 'Escape closes the Reader');
    // The move to the topic redrew the right rail for it: its rows are pressed once they are drawn for the topic now up.
    let drawn = null;
    await until(async () => { drawn = await buildRail(p); return !drawn.busy && drawn.rows.find(row => row.id === 'rb-wait')?.current === 'page' && drawn.rows.some(row => row.id === 'rb-review'); },
      'the right rail lists the Build topics again for the topic now up, its row marked')
      .catch(error => { throw Error(`${error.message} (${JSON.stringify({ rows: drawn?.rows.map(row => [row.id, row.current]), groups: drawn?.groups, busy: drawn?.busy })})`); });
    await p.point('#things .pipe-builds a.row[href*="topic=rb-review"]');
    await arrived(p, '?topic=rb-review', 'Built and live', 'a row waiting on nobody opens its topic');
    assert.equal(await p.evaluate(`document.querySelector('#reader').open`), false, 'with no Reader over it');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // A topic shows in one place as what makes it a Build topic changes under
  // the page reading it (item 297): the pipeline turned off or on, or a piece
  // started in it. rf-built's piece is in Now; rf-plain has none yet, and an
  // item waits in Now for one.
  const flagPipe = (operation, kind, target, args) => control({ method: 'pipeline', kind, operation_id: 'rail-flag-' + operation, target, workspace_id: 'rail-flag-o', args });
  let flagMade = null;
  const flagOutcome = () => (flagMade ??= (async () => {
    await control({ method: 'navigation_workspaces', workspaces: [{ id: 'rail-flag-o', title: 'Flagged Build topics', team: [BUILD_AGENT] }] });
    await control({ method: 'navigation_topics', topics: [{ id: 'rf-built', title: 'Built here', workspace_id: 'rail-flag-o' }, { id: 'rf-plain', title: 'Plain here', workspace_id: 'rail-flag-o' }] });
    await flagPipe('on', 'pipeline.configure', { workspace_id: 'rail-flag-o' }, { enabled: true });
    await flagPipe('stages', 'pipeline.stages_set', { workspace_id: 'rail-flag-o' }, { stages: [{ stage_id: 'build', name: 'Build' }] });
    const item = async name => (await flagPipe('item-' + name, 'pipeline.item_add', { workspace_id: 'rail-flag-o' }, { title: 'Item ' + name, section: 'now', size: 'small', sources: [{ note: 'the check' }] })).result.number;
    await flagPipe('start-built', 'pipeline.piece_start', { workspace_id: 'rail-flag-o' }, { numbers: [await item('built')], topic_id: 'rf-built', stage_id: 'build' });
    return { later: await item('later') };
  })());
  // Where a topic shows: its rows in the right rail and in the outline's open topics.
  const placesOf = (seen, id) => ({ rail: seen.rows.filter(row => row.id === id).map(row => [row.group, row.current]), outline: seen.outline.filter(row => row.id === id).length });

  await check('rail turned off while a Build topic is read, the topic moves live from the right rail to the outline, and turned on, back: it is never in neither', async () => {
    await flagOutcome();
    const p = await openAt('rail-flag-off', '/?topic=rf-built', 'laptop', 'light');
    await settled(p, 'the Build topic is up');
    let seen = null;
    const shows = (what, test) => until(async () => { seen = await buildRail(p, 'rail-flag-o'); return !seen.busy && test(placesOf(seen, 'rf-built')); }, what)
      .catch(error => { throw Error(`${error.message} (${JSON.stringify(placesOf(seen, 'rf-built'))})`); });
    await shows('the right rail lists the topic being read in Now, marked, and the outline lists it not', at => at.outline === 0 && JSON.stringify(at.rail) === '[["Now","page"]]');
    await flagPipe('off', 'pipeline.configure', { workspace_id: 'rail-flag-o' }, { enabled: false });
    try {
      await shows('turned off, the outline lists the topic being read, live', at => at.outline === 1);
      assert.ok(!seen.groups.includes('Other Build topics') && !seen.groups.includes('Ready for review'), 'and the right rail lists no Build topics');
      await shot(p, 'rail-flag-off');
    } finally {
      await flagPipe('on-again', 'pipeline.configure', { workspace_id: 'rail-flag-o' }, { enabled: true });
    }
    await shows('on again, the right rail lists it, marked, and the outline no longer, live', at => at.outline === 0 && JSON.stringify(at.rail) === '[["Now","page"]]');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail a piece started in the topic being read moves it live from the outline to the right rail\'s Now: it is never in both', async () => {
    const { later } = await flagOutcome();
    const p = await openAt('rail-flag-start', '/?topic=rf-plain', 'laptop', 'light');
    await settled(p, 'the plain topic is up');
    let seen = null;
    const shows = (what, test) => until(async () => { seen = await buildRail(p, 'rail-flag-o'); return !seen.busy && seen.rows.some(row => row.id === 'rf-built') && test(placesOf(seen, 'rf-plain')); }, what)
      .catch(error => { throw Error(`${error.message} (${JSON.stringify(placesOf(seen, 'rf-plain'))})`); });
    await shows('the outline lists the topic being read, and the right rail lists it not', at => at.outline === 1 && at.rail.length === 0);
    await flagPipe('start-plain', 'pipeline.piece_start', { workspace_id: 'rail-flag-o' }, { numbers: [later], topic_id: 'rf-plain', stage_id: 'build' });
    await shows('a piece started in it, the right rail lists it in Now, marked, and the outline no longer, live', at => at.outline === 0 && JSON.stringify(at.rail) === '[["Now","page"]]');
    await shot(p, 'rail-flag-start');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // A topic marked Done while its piece is still under way (item 297): Done
  // decides, so it folds into the outline's Done group and leaves Now.
  let doneMade = null;
  const doneOutcome = () => (doneMade ??= (async () => {
    const pipe = (operation, kind, target, args) => control({ method: 'pipeline', kind, operation_id: 'rail-done-' + operation, target, workspace_id: 'rail-done-o', args });
    await control({ method: 'navigation_workspaces', workspaces: [{ id: 'rail-done-o', title: 'Done while building', team: [BUILD_AGENT] }] });
    await control({ method: 'navigation_topics', topics: [{ id: 'rd-built', title: 'Built, then Done', workspace_id: 'rail-done-o' }, { id: 'rd-plain', title: 'Plain talk', workspace_id: 'rail-done-o' }] });
    await pipe('on', 'pipeline.configure', { workspace_id: 'rail-done-o' }, { enabled: true });
    await pipe('stages', 'pipeline.stages_set', { workspace_id: 'rail-done-o' }, { stages: [{ stage_id: 'build', name: 'Build' }] });
    const { result: { number } } = await pipe('item', 'pipeline.item_add', { workspace_id: 'rail-done-o' }, { title: 'Item for rd-built', section: 'now', size: 'small', sources: [{ note: 'the check' }] });
    await pipe('start', 'pipeline.piece_start', { workspace_id: 'rail-done-o' }, { numbers: [number], topic_id: 'rd-built', stage_id: 'build' });
  })());

  await check('rail a Build topic marked Done while its piece is still under way leaves the right rail\'s Now and folds into the outline\'s Done group; reopened, it is in Now again', async () => {
    await doneOutcome();
    const p = await openAt('rail-done-building', '/?conversation=rail-done-o', 'laptop', 'light');
    await buildRailShown(p, 'done while building', false);
    let seen = null;
    const shows = (what, test) => until(async () => { seen = await buildRail(p, 'rail-done-o'); return !seen.busy && test(seen); }, what)
      .catch(error => { throw Error(`${error.message} (${JSON.stringify({ rows: seen?.rows.map(row => [row.id, row.group]), outline: seen?.outline.map(row => row.id), done: seen?.done, doneLabel: seen?.doneLabel })})`); });
    await shows('the right rail lists the topic in Now', now => now.rows.some(row => row.id === 'rd-built' && row.group === 'Now') && now.outline.some(row => row.id === 'rd-plain'));
    await control({ method: 'topic_state', operation_id: 'rail-done-building-done', topic_id: 'rd-built', args: { state: 'done' } });
    try {
      await shows('marked Done, it leaves the right rail and the outline counts it Done, live', now => !now.rows.some(row => row.id === 'rd-built') && now.doneLabel === 'Done (1)');
      await p.point('#outline .ol-outcome[data-workspace-id="rail-done-o"] details.topic-group > summary');
      await shows('the outline\'s Done group lists it', now => now.done.includes('rd-built'));
      assert.deepEqual([seen.rows.filter(row => row.id === 'rd-built').length, seen.outline.filter(row => row.id === 'rd-built').length, seen.done.filter(id => id === 'rd-built').length], [0, 0, 1],
        'it shows once, in the Done group');
      await shot(p, 'rail-done-building');
    } finally {
      await control({ method: 'topic_state', operation_id: 'rail-done-building-reopen', topic_id: 'rd-built', args: { state: 'active', note: '' } });
      await p.evaluate("(()=>{for (const key of Object.keys(localStorage)) if (key.startsWith('aim-next.topic-lists.')) localStorage.removeItem(key); return true})()");
    }
    await shows('reopened, with its piece still under way, it is in Now again and out of the Done group', now => now.rows.some(row => row.id === 'rd-built' && row.group === 'Now') && now.doneLabel === null);
    assert.deepEqual(p.errors, []); await p.close();
  });

  // More Build topics than a page (item 297): ro-now's piece is in Now and
  // its agent asks the person something there, before 21 more Build topics,
  // each piece finished, are made, so ro-now falls past the first page.
  const OLDER = 21;
  let olderMade = null;
  const olderOutcome = () => (olderMade ??= (async () => {
    const pipe = (operation, kind, target, args) => control({ method: 'pipeline', kind, operation_id: 'rail-older-' + operation, target, workspace_id: 'rail-older-o', args });
    const item = async name => (await pipe('item-' + name, 'pipeline.item_add', { workspace_id: 'rail-older-o' }, { title: 'Item for ' + name, section: 'now', size: 'small', sources: [{ note: 'the check' }] })).result.number;
    await control({ method: 'navigation_workspaces', workspaces: [{ id: 'rail-older-o', title: 'Older Build topic', team: [BUILD_AGENT] }] });
    await control({ method: 'navigation_topics', topics: [{ id: 'ro-now', title: 'Built long ago', workspace_id: 'rail-older-o' }] });
    await pipe('on', 'pipeline.configure', { workspace_id: 'rail-older-o' }, { enabled: true });
    await pipe('stages', 'pipeline.stages_set', { workspace_id: 'rail-older-o' }, { stages: [{ stage_id: 'build', name: 'Build' }] });
    await pipe('start-ro-now', 'pipeline.piece_start', { workspace_id: 'rail-older-o' }, { numbers: [await item('ro-now')], topic_id: 'ro-now', stage_id: 'build' });
    await control({ method: 'agent_message', operation_id: 'rail-older-ask', sender: BUILD_AGENT, topic_id: 'ro-now', whole_topic: true, body: 'Which one first?', post_args: { addressees: [facts.actor], intent: 'ask' } });
    const topics = Array.from({ length: OLDER }, (_, n) => `ro-${String(n).padStart(2, '0')}`);
    await control({ method: 'navigation_topics', topics: topics.map(id => ({ id, title: 'Built ' + id, workspace_id: 'rail-older-o' })) });
    for (const topic of topics) {
      const { result: { piece_id } } = await pipe('start-' + topic, 'pipeline.piece_start', { workspace_id: 'rail-older-o' }, { numbers: [await item(topic)], topic_id: topic, stage_id: 'build' });
      await pipe('finish-' + topic, 'pipeline.piece_finish', { piece_id }, {});
    }
  })());

  await check('rail with more than 20 Build topics, the piece in Now whose topic is older than the first 20 carries its unread count, the sent-by-name badge and Waiting on you', async () => {
    await olderOutcome();
    const listed = (await view('workspace_topics', { workspace_id: 'rail-older-o', build: true, limit: 20 })).items.map(item => item.id);
    assert.ok(listed.length === 20 && !listed.includes('ro-now'), `the first 20 Build topics Core lists leave out the older one (${listed})`);
    const p = await openAt('rail-older-now', '/?conversation=rail-older-o', 'laptop', 'light');
    await buildRailShown(p, 'older', false);
    const seen = await until(async () => { const now = await buildRail(p, 'rail-older-o'); return !now.busy && now.rows.length === 21 && now; }, 'the right rail lists the piece in Now and the first 20 Build topics');
    assert.deepEqual(marksOf(seen.rows.filter(row => row.id === 'ro-now')), [{ id: 'ro-now', group: 'Now', unread: 1, byName: true, state: 'Waiting on you', mine: true }],
      'its row in Now, once, with what its outline row would carry');
    assert.deepEqual(seen.rows.filter(row => row.group !== 'Now').map(row => row.id).sort(), [...listed].sort(), 'and the first 20 under it');
    await shot(p, 'rail-older-now');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail the right rail\'s Build topics follow the reader\'s own order of the outcome\'s topics, as the outline does', async () => {
    await olderOutcome();
    const core = (await view('workspace_topics', { workspace_id: 'rail-older-o', build: true, limit: 100 })).items.map(item => item.id);
    // The reader's own order: Core's, turned round.
    await control({ method: 'order_as', operation_id: 'rail-older-order', workspace_id: 'rail-older-o', ids: [...core].reverse() });
    const p = await openAt('rail-older-order', '/?conversation=rail-older-o', 'laptop', 'light');
    await buildRailShown(p, 'order', false);
    const first = core.slice(0, 20).filter(id => id !== 'ro-now');
    let seen = null;
    await until(async () => { seen = await buildRail(p, 'rail-older-o'); return !seen.busy && seen.rows.length === 21; }, 'the right rail lists the Build topics');
    const groups = [...new Set(seen.rows.map(row => row.group))];
    for (const group of groups) {
      const shown = seen.rows.filter(row => row.group === group).map(row => row.id);
      assert.deepEqual(shown, [...shown].sort((a, b) => core.indexOf(b) - core.indexOf(a)), `${group}: in the reader's order, Core's turned round (${shown})`);
    }
    assert.deepEqual(seen.rows.filter(row => row.group !== 'Now').map(row => row.id).sort(), [...first].sort(), 'the first 20 Core lists, each once');
    assert.ok(seen.rows.filter(row => row.group !== 'Now').length > 1, 'more than one row to order');
    await shot(p, 'rail-older-order');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // The phone's header with two-digit counts (docs/rails.md, "The right
  // rail"): ☰ Outcomes carries everything new and the light of what waits on
  // the person, and "Pipeline & pages" what is new in the outcome's Build
  // topics. re-plain's ten new messages, one of them a question to the person,
  // make the first two digits and light it; re-build's make the second one
  // digit, then two.
  const edgePipe = (operation, kind, target, args) => control({ method: 'pipeline', kind, operation_id: 'rail-edge-' + operation, target, workspace_id: 'rail-edge-o', args });
  const edgeNews = async (topic, from, to) => {
    for (let at = from; at < to; ++at) await control({ method: 'agent_message', operation_id: `rail-edge-${topic}-${at}`, sender: BUILD_AGENT, topic_id: topic, whole_topic: true, body: `News ${at}` });
  };
  // The header as drawn: each count, and every part of it that runs past the phone's edge.
  const headerEdge = (p, edge) => p.evaluate(`(()=>{const shown=e=>e.checkVisibility();
    const badge=id=>{const b=document.querySelector('#'+id+' .unread-count');return b&&shown(b)?b.textContent:''};
    const box=e=>{const r=e?.getBoundingClientRect();return r?[Math.round(r.left*100)/100,Math.round(r.right*100)/100,Math.round(r.top)]:null};
    const header=document.querySelector('#main .topic-header');
    const lamp=document.querySelector('#rail-open .outcome-light');
    return {outcomes:badge('rail-open'),lit:Boolean(lamp&&shown(lamp)),things:badge('things-open'),scroll:document.documentElement.scrollWidth,
      boxes:Object.fromEntries(['rail-open','workspace-name','things-open'].map(id=>[id,box(document.getElementById(id))])),
      past:[...header.querySelectorAll('*')].filter(shown).map(e=>[(e.id?'#'+e.id:'')+(typeof e.className==='string'&&e.className?'.'+e.className.split(' ').join('.'):'')||e.tagName.toLowerCase(),
        Math.round(e.getBoundingClientRect().right*100)/100]).filter(([,right])=>right>${edge})}})()`);

  await check('rail on a phone at 320 375 390, with two-digit counts on ☰ Outcomes and on "Pipeline & pages" or one, nothing in the header runs past the page\'s edge', async () => {
    await control({ method: 'navigation_workspaces', workspaces: [{ id: 'rail-edge-o', title: 'Edge of the phone', team: [BUILD_AGENT] }] });
    await control({ method: 'navigation_topics', topics: [{ id: 're-build', title: 'Built at the edge', workspace_id: 'rail-edge-o' }, { id: 're-plain', title: 'Plain at the edge', workspace_id: 'rail-edge-o' }] });
    await edgePipe('on', 'pipeline.configure', { workspace_id: 'rail-edge-o' }, { enabled: true });
    await edgePipe('stages', 'pipeline.stages_set', { workspace_id: 'rail-edge-o' }, { stages: [{ stage_id: 'build', name: 'Build' }] });
    const { result: { number } } = await edgePipe('item', 'pipeline.item_add', { workspace_id: 'rail-edge-o' }, { title: 'Item at the edge', section: 'now', size: 'small', sources: [{ note: 'the check' }] });
    await edgePipe('start', 'pipeline.piece_start', { workspace_id: 'rail-edge-o' }, { numbers: [number], topic_id: 're-build', stage_id: 'build' });
    await edgeNews('re-plain', 0, 9);
    await control({ method: 'agent_message', operation_id: 'rail-edge-ask', sender: BUILD_AGENT, topic_id: 're-plain', whole_topic: true, body: 'Which edge?', post_args: { addressees: [facts.actor], intent: 'ask' } });
    let sent = 0;
    for (const [built, digits] of [[5, 1], [12, 2]]) {
      await edgeNews('re-build', sent, built);
      sent = built;
      const want = (await view('workspaces', { limit: 100 })).items.find(item => item.id === 'rail-edge-o').build.unread;
      assert.equal(String(want).length, digits, `Core counts ${want} new in the Build topics`);
      for (const size of [390, 375, 320]) {
        const at = `${size}, "Pipeline & pages" at ${want}`, edge = SIZE_464[size].width;
        const p = await openAt(`rail-edge-${size}-${digits}`, '/?conversation=rail-edge-o', size, 'light');
        await phoneUp(p, at + ': the Conversation is up');
        let seen = null;
        await until(async () => { seen = await headerEdge(p, edge); return seen.things === String(want) && seen.outcomes.length >= 2 && seen.lit; }, at + ': both counts and the light are drawn')
          .catch(error => { throw Error(`${error.message} (${JSON.stringify(seen)})`); });
        assert.deepEqual(seen.past, [], `${at}, ☰ Outcomes at ${seen.outcomes}: nothing in the header runs past the ${edge}px edge (${JSON.stringify(seen.boxes)})`);
        assert.ok(seen.scroll <= edge, `${at}: the page does not scroll sideways (${seen.scroll})`);
        await shot(p, `rail-edge-${size}-${digits}`);
        assert.deepEqual(p.errors, []); await p.close();
      }
    }
  });

  // The arrows everywhere (item 301; docs/interaction.md, "The arrows
  // everywhere"): from anywhere outside writing an arrow lands the focus on a
  // control, and the arrows reach what a click reaches, at 320, 375 and 390
  // wide and a laptop. Where the focus is: its pane (rail, main, things, a
  // dialog, the message bar) and the control, or 'page' when nothing holds it.
  const ARROW_SIZES = { 320: { width: 320, height: 640, deviceScaleFactor: 2, mobile: true }, 375: { width: 375, height: 760, deviceScaleFactor: 2, mobile: true },
    390: SIZES.phone, laptop: SIZES.laptop,
    // An iPad with a keyboard, upright and on its side: the same keys work there (docs/interaction.md).
    820: { width: 820, height: 1180, deviceScaleFactor: 2, mobile: true }, 1024: { width: 1024, height: 1366, deviceScaleFactor: 2, mobile: true } };
  const arrowsAt = (name, url, size, theme = 'light') => page(name, null, true, { url: facts.origin + url, beforeNavigate: async q => {
    await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await q.send('Emulation.setDeviceMetricsOverride', ARROW_SIZES[size]);
    if (ARROW_SIZES[size].mobile) await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  } });
  const focusAt = p => p.evaluate(`(()=>{const e=document.activeElement;if(!e||e===document.body||e===document.documentElement)return 'page';
    const pane=e.closest('dialog[open]')?'dialog':e.closest('.message-bar')?'bar':e.closest('#rail')?'rail':e.closest('#things')?'things':e.closest('#main')?'main':'elsewhere';
    const m=e.closest('#messages [data-id]');if(m&&pane==='main')return 'message:'+m.dataset.id;
    if(e.getAttribute('role')==='treeitem')return pane+':row:'+(e.dataset?.topicId||e.textContent.trim().replace(/\\s+/g,' ').slice(0,40));
    return pane+':'+(e.id||e.dataset?.act||e.dataset?.topicId||(e.getAttribute('aria-label')??e.textContent).trim().replace(/\\s+/g,' ').slice(0,40))})()`);
  // Whether the focused control shows in the window, whole enough to see.
  const focusInView = p => p.evaluate(`(()=>{const e=document.activeElement;if(!e||e===document.body)return false;const b=e.getBoundingClientRect();return b.bottom>0&&b.top<innerHeight&&b.right>0&&b.left<innerWidth&&b.width>0})()`);
  // The topic is up with its messages drawn, at any width (the outline's own list waits for a laptop's rail).
  const topicUp = (p, what) => until(() => p.evaluate(`document.body?.dataset.ready==='true' && document.querySelectorAll('#messages [data-id]').length > 1`).catch(() => false), what);
  // Where the page and the focus's scrolling boxes stand: an arrow that moves
  // no focus while the next control is out of sight scrolls toward it instead.
  const scrolled = p => p.evaluate(`(()=>{const at=[];for(let e=document.activeElement;e;e=e.parentElement)if(e.scrollHeight>e.clientHeight||e.scrollWidth>e.clientWidth)at.push(Math.round(e.scrollTop)+','+Math.round(e.scrollLeft));return at.join(' ')+'|'+Math.round(scrollY)+','+Math.round(scrollX)})()`);
  // Where they stand once still: a box the browser scrolls for the key (a long message in the Reader) moves
  // smoothly over the next frames, so the place is read when three frames in a row leave it as it was.
  const SIGNATURE = "(()=>{const at=[];for(let e=document.activeElement;e;e=e.parentElement)if(e.scrollHeight>e.clientHeight||e.scrollWidth>e.clientWidth)at.push(Math.round(e.scrollTop)+','+Math.round(e.scrollLeft));return at.join(' ')+'|'+Math.round(scrollY)+','+Math.round(scrollX)})()";
  const still = p => p.evaluate(`new Promise(done=>{const sign=()=>${SIGNATURE};let last=sign(),same=0;const frame=()=>{const now=sign();if(now===last){if(++same>=3)return done(now)}else{same=0;last=now}requestAnimationFrame(frame)};requestAnimationFrame(frame)})`);
  // One press: where the focus lands, and whether the press scrolled toward a
  // control out of sight instead (arrow-reach.mjs scrolls at once, in the press),
  // or scrolled the focused box on (the browser's own, over the next frames).
  const arrowPress = async (p, key) => {
    const before = await scrolled(p);
    await p.key(key);
    return { at: await focusAt(p), scrolled: await still(p) !== before };
  };
  // Presses the arrow up to n times, until the focus stays at the end of what
  // can scroll, or stop; the places the focus was.
  const walk = async (p, key, n = 30, stop = () => false) => {
    const seen = [await focusAt(p)];
    for (let step = 0; step < n; step++) {
      const { at, scrolled: on } = await arrowPress(p, key);
      if (on && at === seen.at(-1)) continue;
      if (at === seen.at(-1) || stop(at)) { if (at !== seen.at(-1)) seen.push(at); break; }
      seen.push(at);
    }
    return seen;
  };

  // Whether the arrows reach every control on show in scope: each one is
  // marked, a tree's rows standing as one ('tree', its one stop); from each
  // (but a box with words in it, whose arrows are the writing's) each arrow is
  // pressed, natively, and where the focus lands is read; from a tree, ↑ above
  // its first row and ↓ below its last. What the arrows reach from start, and
  // every press that lost the focus to the page. start: a mark ('tree'), or a
  // step whose landing is the start. skip: controls left out (a deck's cards,
  // which key their own arrows).
  // The topic's reply with nothing written: an earlier case may leave a draft in it, and an arrow goes on from a field
  // only when it is empty (or one line); emptied by the keys, so the page's draft follows.
  const emptyReply = async (p, label) => {
    const y = await p.evaluate("(f=>{const y=scrollY;f.focus({preventScroll:true});f.select();return y})(document.getElementById('inline-writing-body'))");
    await p.key('Backspace');
    await until(() => p.evaluate("document.getElementById('inline-writing-body').value===''"), label + ': the reply is empty');
    await p.evaluate(`(document.activeElement?.blur(), scrollTo(0, ${y}))`);
  };
  // A closure's start: the stop of the tree in scope (its row the keys are on, else its first shown).
  // The controls lying straight the way of key from the focused one (overlapping it across, past it along),
  // in the layer the focus is in (the open modal dialog, else the dialog, sheet or menu it is in, else the
  // page): a press that leaves the focus where it was while one lies there is a dead end. Not from where the
  // arrow is the control's own: in words (← and → in a line with words in it, any arrow in a box with words, a
  // number or a date), ↑ and ↓ in a select, which choose among its options, and in a radio group or a slider.
  // Not a control a box that takes the focus and does not hold it has clipped wholly out of sight (a link scrolled
  // up out of the Reader's message box lies above nothing in the header): it is reached from the box. One out of
  // sight only by the page, by a box the focus is in, or by a box that takes no focus (the versions in a reply's
  // review), does lie that way, and the arrows scroll toward it. The focus scrolled out of its own box is judged
  // where it went out, on the box's edge.
  const LIES = key => `(e=>{if(!e||e===document.body||e===document.documentElement)return [];const key=${JSON.stringify(key)},vertical=key==='ArrowUp'||key==='ArrowDown';
    const line=e.tagName==='INPUT'&&['text','search','email','url','tel','password'].includes(e.type),typed=e.matches('textarea,[contenteditable]:not([contenteditable=false])')||(e.tagName==='INPUT'&&!['checkbox','radio','button','submit','reset','file','color','image','range'].includes(e.type));
    const suggests=e.matches('[role=combobox],[aria-autocomplete]')||Boolean(e.list);
    if(typed&&(suggests||!((e.value===''&&(line||e.tagName==='TEXTAREA'))||(line&&vertical))))return [];
    if((e.tagName==='SELECT'&&vertical)||e.matches('input[type=radio],input[type=range],[role=slider],[role=radio]'))return [];
    const modal=[...document.querySelectorAll('dialog[open]')].filter(d=>d.matches(':modal')).at(-1),layer=modal??e.closest('dialog[open],[role=dialog]:not([hidden]),[role=menu]:not([hidden])')??document.body;
    const area=(x,holding,only)=>{let a={top:-Infinity,left:-Infinity,bottom:Infinity,right:Infinity};for(let at=x.parentElement;at&&at!==document.body&&at!==document.documentElement&&!(holding&&at.contains(holding));at=at.parentElement){const s=getComputedStyle(at);if((s.overflowX==='visible'&&s.overflowY==='visible')||(only&&!only(at)))continue;const k=at.getBoundingClientRect();a={top:Math.max(a.top,k.top),left:Math.max(a.left,k.left),bottom:Math.min(a.bottom,k.bottom),right:Math.min(a.right,k.right)}}return a};
    const focusable=at=>at.matches('a[href],button,summary,input,select,textarea,[tabindex],[contenteditable]:not([contenteditable=false])')&&at.tabIndex>=0&&!at.disabled&&at.checkVisibility({visibilityProperty:true});
    const clipped=x=>{const c=x.getBoundingClientRect(),a=area(x,e,focusable);return !(c.bottom>a.top&&c.top<a.bottom&&c.right>a.left&&c.left<a.right)};
    const r=e.getBoundingClientRect(),o=area(e,null),cl=(v,lo,hi)=>Math.min(Math.max(v,lo),hi),b={top:cl(r.top,o.top,o.bottom),bottom:cl(r.bottom,o.top,o.bottom),left:cl(r.left,o.left,o.right),right:cl(r.right,o.left,o.right)};
    const shown=x=>x.checkVisibility({visibilityProperty:true})&&!x.disabled&&!x.closest('[inert],[aria-hidden=true]')&&x.getBoundingClientRect().width>0;
    return [...layer.querySelectorAll('a[href],button,summary,input:not([type=hidden]),select,textarea,[tabindex]')].filter(x=>x!==e&&!x.contains(e)&&!e.contains(x)&&(x.tabIndex>=0||x.getAttribute('role')==='treeitem')&&shown(x)&&!clipped(x)).filter(x=>{const c=x.getBoundingClientRect();
      if(key==='ArrowDown')return c.top>=b.bottom-1&&c.left<b.right&&c.right>b.left;if(key==='ArrowUp')return c.bottom<=b.top+1&&c.left<b.right&&c.right>b.left;
      if(key==='ArrowRight')return c.left>=b.right-1&&c.top<b.bottom&&c.bottom>b.top;return c.right<=b.left+1&&c.top<b.bottom&&c.bottom>b.top})
      .slice(0,3).map(x=>(x.id||x.dataset.key||x.getAttribute('aria-label')||x.textContent.trim().replace(/\\s+/g,' ').slice(0,30)||x.tagName)+'<'+x.tagName.toLowerCase()+(x.type&&x.tagName==='INPUT'?' '+x.type:'')+'>')})(document.activeElement)`;
  // What a press may change in place of moving the focus (a section opened or folded, a stack shown, a message
  // folded to its row): a press that changed it acted, and is no dead end.
  // (A stack switched to latest and unread hides its earlier replies: the messages that show are counted. One
  // whose replies all show either way changes nothing seen, and says so in its live region: what a live region
  // is told is counted too.)
  const ACTED = "(window.__spoken??=(o=>(new MutationObserver(ms=>{for(const m of ms)if((m.target.nodeType===1?m.target:m.target.parentElement)?.closest('[aria-live]'))o.n++}).observe(document.body,{subtree:true,childList:true,characterData:true}),o))({n:0})).n+'|'+[...document.querySelectorAll('[aria-expanded],details,[data-head-open],[aria-pressed]')].map(e=>(e.getAttribute('aria-expanded')??'')+(e.open?'o':'')+(e.dataset.headOpen??'')+(e.getAttribute('aria-pressed')??'')).join('')+'|'+document.querySelectorAll('.fold-line').length+'|'+[...document.querySelectorAll('#messages [data-id]')].filter(e=>e.checkVisibility()).length+'|'+document.querySelectorAll('#messages [hidden]').length";
  const treeStart = (p, scope) => () => p.evaluate(`(rows=>(rows.find(e=>e.tabIndex===0)??rows[0])?.focus())([...document.querySelectorAll('${scope} [role=treeitem]')].filter(e=>e.checkVisibility()))`);
  // A control a redraw replaced (a message drawn again as a stack switched) is the same node as before: known by
  // its message and its place among that message's controls, or by its id; each step marks such a control again.
  const SIG = "(e=>{const m=e.closest('#messages [data-id]');if(m)return 'm:'+m.dataset.id+':'+(e===m?'self':[...m.querySelectorAll('a[href],button,summary,input,select,textarea,[tabindex]')].indexOf(e));return e.id?'id:'+e.id:null})";
  const REMARK = `(()=>{const sig=${SIG},known=window.__arrowSig??={};for(const e of document.querySelectorAll('a[href],button,summary,input,select,textarea,[tabindex]')){const k=sig(e);if(!k)continue;if(e.dataset.arrowNode&&!e.dataset.arrowNode.startsWith('tree')){known[k]??=e.dataset.arrowNode}else if(!e.dataset.arrowNode&&known[k])e.dataset.arrowNode=known[k]}})()`;
  // A tree is one node: its rows as they are drawn now, by the tree's place on the page.
  const treeRows = id => `[...(document.querySelectorAll('[role=tree]')[${Number(id.slice(4))}]?.querySelectorAll('[role=treeitem]')??[])].filter(e=>e.checkVisibility())`;
  const arrowClosure = async (p, scope, start, skip = null) => {
    const nodes = await p.evaluate(`(()=>{const root=document.querySelector(${JSON.stringify(scope)}),skip=${JSON.stringify(skip)};
      const shown=e=>e.checkVisibility({visibilityProperty:true})&&!e.disabled&&!e.closest('[inert],[aria-hidden=true]')&&e.getBoundingClientRect().width>0;
      const all=[...root.querySelectorAll('a[href],button,summary,input:not([type=hidden]),select,textarea,[tabindex]')].filter(e=>(e.tabIndex>=0||e.getAttribute('role')==='treeitem')&&shown(e)&&!(skip&&e.closest(skip)));
      const trees=[...document.querySelectorAll('[role=tree]')],tree=e=>e.getAttribute('role')==='treeitem'?'tree'+Math.max(0,trees.indexOf(e.closest('[role=tree]'))):null;
      const out=[];all.forEach((e,i)=>{const id=tree(e)??'n'+i;e.dataset.arrowNode=id;
        if(!out.some(o=>o.id===id))out.push({id,label:id.startsWith('tree')?'the tree '+(e.closest('[role=tree]')?.getAttribute('aria-label')??''):(e.id||(e.getAttribute('aria-label')??e.textContent).trim().replace(/\\s+/g,' ').slice(0,40)||e.tagName)})});return out})()`);
    await p.evaluate(REMARK);
    const label = id => nodes.find(node => node.id === id)?.label ?? id;
    // Where a press lands; a control that was not marked (the feed itself, a row drawn since, a tree whose rows
    // took their tree words since) is marked as it is found, and the arrows are pressed from it too.
    const landed = async () => { await p.evaluate(REMARK); const at = await p.evaluate(`(e=>{if(!e||e===document.body||e===document.documentElement)return 'page';const skip=${JSON.stringify(skip)};if(skip&&e.closest(skip))return 'out';if(e.getAttribute('role')==='treeitem')return 'tree'+Math.max(0,[...document.querySelectorAll('[role=tree]')].indexOf(e.closest('[role=tree]')));
      if(!e.dataset.arrowNode){window.__arrowFound=(window.__arrowFound??0)+1;e.dataset.arrowNode='found'+window.__arrowFound;const k=${SIG}(e);if(k)(window.__arrowSig??={})[k]??=e.dataset.arrowNode}return e.dataset.arrowNode})(document.activeElement)`);
      if (at !== 'page' && at !== 'out' && !explore.some(node => node.id === at)) explore.push({ id: at, label: await p.evaluate("(e=>e.id||e.tagName)(document.activeElement)"), via });
      return at; };
    const explore = [...nodes];
    // How a control found as it was landed on was reached ({ from, key }): one drawn only while the keys are by it (a
    // reply a stack shows while one of its messages is lit) is gone by the time its own presses come, and is
    // reached again the same way first.
    let via = null;
    const focusNode = id => p.evaluate(`(e=>{if(!e||!e.isConnected)return false;e.focus();return document.activeElement===e})(document.querySelector('[data-arrow-node="${id}"]'))`);
    // Each way it was reached is tried in turn, the first first.
    const reachAgain = async (node, depth = 0) => {
      if (!node?.via || depth > 4) return false;
      const ways = [node.via, ...edges.filter(edge => edge.to === node.id && !(edge.from === node.via.from && edge.key === node.via.key)).map(({ from, key }) => ({ from, key }))];
      for (const way of ways) {
        await p.evaluate(REMARK);
        if (!await focusNode(way.from) && !await reachAgain(explore.find(each => each.id === way.from), depth + 1)) continue;
        await arrowPress(p, way.key);
        const got = await p.evaluate(`(e=>{if(!e||e===document.body)return 'page';if(!e.dataset.arrowNode)e.dataset.arrowNode=${JSON.stringify(node.id)};return e.dataset.arrowNode})(document.activeElement)`);
        if (got === node.id) return true;
        // Where that press lands now is a press like any other (the reply it reached was read, and no longer shows).
        edges.push({ from: way.from, key: way.key, to: got });
        console.log('arrow closure', 'reaching', node.id, 'again by', label(way.from), way.key, 'landed on', label(got));
      }
      return false;
    };
    // A start given as a step: where that step, taken once the controls are marked, lands.
    if (typeof start === 'function') { await start(); start = await landed(); }
    const edges = [], dead = [], skipped = new Set();
    for (let i = 0; i < explore.length; i++) {
      const node = explore[i];
      if (node.id.startsWith('tree')) {
        for (const [home, key] of [['Home', 'ArrowUp'], ['End', 'ArrowDown']]) {
          via = null;
          const on = await p.evaluate(`(rows=>{const row=rows.find(e=>e.tabIndex===0)??rows[0];row?.focus();return Boolean(row)&&document.activeElement===row})(${treeRows(node.id)})`);
          assert.equal(on, true, `${label(node.id)}: the keys are put on one of its rows`);
          await p.key(home); await p.key(key);
          const to = await landed();
          edges.push({ from: node.id, key, to });
          if (to === node.id) { const lies = await p.evaluate(LIES(key)); if (lies.length) dead.push(`${label(node.id)} ${home} then ${key} stays; lies that way: ${lies.join(' | ')}`); }
        }
        // → from each open row that holds a control of its own (the Notebook row's pencil).
        const holders = await p.evaluate(`${treeRows(node.id)}.filter(e=>e.getAttribute('aria-expanded')!=='false'&&[...e.querySelectorAll('button,a[href]')].some(b=>b.checkVisibility())).length`);
        for (let n = 0; n < holders; n++) {
          await p.evaluate(`${treeRows(node.id)}.filter(e=>e.getAttribute('aria-expanded')!=='false'&&[...e.querySelectorAll('button,a[href]')].some(b=>b.checkVisibility()))[${n}]?.focus()`);
          await p.key('ArrowRight');
          edges.push({ from: node.id, key: 'ArrowRight', to: await landed() });
        }
        continue;
      }
      // ↓ last: through a box that scrolls it reads to the end, and ← and → are pressed where it stood when reached.
      // A select's ↑ and ↓ are its own, choosing among its options (and opening its menu on a Mac): only ← and →.
      for (const key of ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown']) {
        await p.evaluate(REMARK);
        via = { from: node.id, key };
        const press = () => p.evaluate(`(e=>{if(!e||!e.isConnected||(e.matches('textarea,[contenteditable]')&&(e.value??e.textContent)!=='')||(e.matches('select')&&${key === 'ArrowUp' || key === 'ArrowDown'}))return false;e.focus();return document.activeElement===e})(document.activeElement?.dataset?.arrowNode==='${node.id}'?document.activeElement:[...document.querySelectorAll('[data-arrow-node="${node.id}"]')].find(x=>x.checkVisibility())??null)`);
        let ok = await press();
        if (!ok && node.via && await reachAgain(node)) ok = await press();
        if (!ok) { skipped.add(node.id); continue; }
        // While the next control is out of sight the arrow scrolls toward it; pressed on, it lands there.
        let to = node.id;
        const before = await p.evaluate(ACTED);
        // On as long as each press scrolls: a long message in the Reader's box is read a line at a time first.
        for (let n = 0; n < 400 && to === node.id; n++) {
          const step = await arrowPress(p, key);
          to = await landed();
          if (!step.scrolled) break;
        }
        edges.push({ from: node.id, key, to });
        if (to === node.id && await p.evaluate(ACTED) === before) { const lies = await p.evaluate(LIES(key)); if (lies.length) dead.push(`${label(node.id)} ${key} stays; lies that way: ${lies.join(' | ')}`); }
      }
    }
    const reached = new Set(), queue = [start];
    while (queue.length) { const at = queue.shift(); if (reached.has(at)) continue; reached.add(at); for (const edge of edges) if (edge.from === at) queue.push(edge.to); }
    // A control that stopped showing while the arrows were pressed (More outcomes, once every outcome is drawn)
    // is none the arrows must reach; it is named in the evidence as gone.
    await p.evaluate(REMARK);
    const unreached = nodes.filter(node => !reached.has(node.id));
    const showing = await p.evaluate(`${JSON.stringify(unreached.map(node => node.id))}.map(id=>id.startsWith('tree')?${'true'}:[...document.querySelectorAll('[data-arrow-node="'+id+'"]')].some(e=>e.checkVisibility({visibilityProperty:true})&&!e.closest('[inert]')))`);
    const gone = unreached.filter((node, at) => !showing[at]).map(node => node.label);
    const missing = unreached.filter((node, at) => showing[at]).map(node => node.label);
    if (gone.length) console.log('arrow closure', scope, 'gone while pressed', JSON.stringify(gone));
    // What each arrow did, for the evidence when a control is missed.
    if (missing.length || dead.length) console.log('arrow closure', scope, JSON.stringify({ start, missing, dead, skipped: [...skipped].map(label), edges: edges.map(edge => `${label(edge.from)} ${edge.key} → ${label(edge.to)}`) }));
    return { missing, lost: edges.filter(edge => edge.to === 'page').map(edge => `${label(edge.from)} ${edge.key}`), dead, count: nodes.length };
  };

  await check('rail arrows ↑ above the outline\'s first row goes on up the side rail to New outcome, the chips and the logo block, ↓ below its last row reaches Keys, and the arrows reach every control in the side rail', async () => {
    for (const theme of ['light', 'dark']) {
      const p = await arrowsAt('rail-arrows-outline-' + theme, '/?topic=t1', 'laptop', theme);
      await settled(p, 'the topic is up');
      await tabToOutline(p);
      await p.key('Home');
      assert.match(await keyedAt(p), /^(name|topic):/, 'Home is the outline\'s first row');
      const up = await walk(p, 'ArrowUp');
      assert.ok(!up.includes('page'), 'no arrow loses the focus to the page: ' + up.join(' → '));
      assert.ok(up.length > 2 && up.slice(1).every(at => at.startsWith('rail:') && !at.startsWith('rail:row:')), '↑ goes on up the side rail, out of the outline: ' + up.join(' → '));
      assert.equal(up[1], 'rail:outline-new-outcome', '↑ above the first row is New outcome, just above it');
      assert.ok(up.some(at => /^rail:(Theseus Outcomes|health-link|How Theseus answers)/.test(at)), '↑ reaches the logo block: ' + up.join(' → '));
      await shot(p, 'rail-arrows-logo-laptop-' + theme);
      // Back down, into the outline's one stop.
      const down = await walk(p, 'ArrowDown', 30, at => at.startsWith('rail:row:'));
      assert.ok(!down.includes('page'), 'no arrow loses the focus coming down: ' + down.join(' → '));
      assert.match(await keyedAt(p), /^(name|topic):/, '↓ comes back into the outline: ' + down.join(' → '));
      // Below the last row: Keys, and ↑ from it back to the outline.
      await p.key('End');
      const last = await keyedAt(p);
      await p.key('ArrowDown');
      assert.equal(await keyedAt(p), 'outline:Keys', `↓ below the last row (${last}) reaches Keys`);
      assert.equal(await focusInView(p), true, 'Keys comes into view');
      await p.key('ArrowUp');
      assert.ok((await focusAt(p)).startsWith('rail:row:'), '↑ from Keys comes back to the outline');
      if (theme === 'light') {
        const { missing, lost, dead, count } = await arrowClosure(p, '#rail', treeStart(p, '#outline'));
        assert.ok(count > 5, 'the side rail has its controls: ' + count);
        assert.deepEqual(missing, [], 'the arrows reach every control in the side rail from the outline');
        assert.deepEqual(lost, [], 'and no arrow there loses the focus to the page');
        assert.deepEqual(dead, [], 'and none stays put where a control lies that way');
      }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('rail arrows on a phone, in the side rail\'s drawer, ↑ above the outline\'s first row goes on up to New outcome and the logo block, and the arrows reach every control in the drawer and never the page behind, at 390, 375 and 320', async () => {
    for (const size of ['390', '375', '320']) {
      const p = await arrowsAt('rail-arrows-drawer-' + size, '/?topic=t1', size, size === '390' ? 'dark' : 'light');
      await topicUp(p, size + ': the topic is up');
      await until(() => p.evaluate("(b=>{b?.focus();return Boolean(b)&&document.activeElement===b})(document.getElementById('rail-open'))"), size + ': ☰ Topics takes the focus');
      // Each focus move from Return on, for the evidence if the focus does not end in the drawer.
      await p.evaluate("(()=>{const d=e=>e?(e.id||e.tagName+':'+(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,24))+(e.isConnected?'':' (gone)'):'none';window.__focusMoves=[];for(const t of ['focusin','focusout'])document.addEventListener(t,e=>window.__focusMoves.push(t+' '+d(e.target)+' → '+d(e.relatedTarget)+' @'+Math.round(performance.now())),true);document.addEventListener('keydown',e=>{if(e.key==='Enter')window.__focusMoves.push('Return: the open topic in the rail '+JSON.stringify([...document.querySelectorAll('#rail a[aria-current=page]')].map(a=>[a.textContent.trim().slice(0,20),a.checkVisibility(),Boolean(a.closest('[inert]')),a.parentElement?.id||a.parentElement?.className])))},true)})()");
      await p.key('Enter');
      await until(() => p.evaluate("document.getElementById('rail-open').getAttribute('aria-expanded')==='true' && Boolean(document.activeElement?.closest?.('#rail'))"), size + ': Return on ☰ Topics opens the drawer, the focus in it')
        .catch(async error => { throw Error(error.message + ': ' + await p.evaluate("JSON.stringify({expanded:document.getElementById('rail-open').getAttribute('aria-expanded'),open:document.getElementById('rail').classList.contains('open'),active:(e=>e&&(e.id||e.tagName+':'+(e.textContent||'').trim().slice(0,30)))(document.activeElement),current:[...document.querySelectorAll('#rail a[aria-current=page]')].map(e=>[e.textContent.trim().slice(0,30),e.isConnected,e.checkVisibility(),Boolean(e.closest('[inert]'))]),moves:window.__focusMoves})")); });
      await until(() => p.evaluate("[...document.querySelectorAll('#outline [role=treeitem]')].some(e=>e.checkVisibility())"), size + ': the outline shows in the drawer')
        .catch(async error => { await shot(p, 'rail-arrows-drawer-missing-' + size); throw Error(error.message + ': ' + await p.evaluate("JSON.stringify({rows:[...document.querySelectorAll('#outline [role=treeitem]')].map(e=>[e.textContent.trim().slice(0,30),e.checkVisibility()]),outline:document.getElementById('outline')?.innerHTML.length,open:document.getElementById('rail').className})")); });
      await p.evaluate("(rows=>(rows.find(e=>e.tabIndex===0)??rows[0]).focus())([...document.querySelectorAll('#outline [role=treeitem]')].filter(e=>e.checkVisibility()))");
      await p.key('Home');
      const up = await walk(p, 'ArrowUp');
      assert.ok(!up.includes('page'), `${size}: no arrow loses the focus: ${up.join(' → ')}`);
      assert.equal(up[1], 'rail:outline-new-outcome', `${size}: ↑ above the first row is New outcome: ${up.join(' → ')}`);
      assert.ok(up.every(at => at.startsWith('rail:')), `${size}: the arrows stay in the drawer: ${up.join(' → ')}`);
      if (size === '390') await shot(p, 'rail-arrows-drawer-390-dark');
      const { missing, lost, dead, count } = await arrowClosure(p, '#rail', treeStart(p, '#outline'));
      assert.ok(count > 5, `${size}: the drawer has its controls (${count})`);
      assert.deepEqual(missing, [], `${size}: the arrows reach every control in the drawer`);
      assert.deepEqual(lost, [], `${size}: and none loses the focus to the page`);
      assert.deepEqual(dead, [], `${size}: and none stays put where a control lies that way`);
      assert.match(await focusAt(p), /^rail:/, `${size}: the focus is still in the drawer`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('rail arrows ↓ past the last message goes on down the page to the People row and the reply, ↑ comes back to the last message, at 1280, 390, 375 and 320', async () => {
    for (const size of ['laptop', '390', '375', '320']) {
      const p = await arrowsAt('rail-arrows-feed-' + size, '/?topic=t1', size);
      await topicUp(p, size + ': the topic is up, its messages drawn');
      await emptyReply(p, size);
      const lastId = await p.evaluate("[...document.querySelectorAll('#messages [data-id]')].filter(e=>e.checkVisibility()).at(-1).dataset.id");
      // Into the messages with the keys, as a person does: ↓ from the page lights one.
      await p.evaluate("document.activeElement?.blur()");
      await p.key('ArrowDown');
      assert.match(await focusAt(p), /^message:/, size + ': ↓ from the page lights a message');
      const down = await walk(p, 'ArrowDown', 60, at => !at.startsWith('message:'));
      const below = down.at(-1);
      assert.ok(down.includes('message:' + lastId), `${size}: ↓ goes down the feed to the last message: ${down.join(' → ')}`);
      assert.ok(below.startsWith('main:'), `${size}: ↓ past the last message goes on down the page, not ${below}: ${down.join(' → ')}`);
      assert.equal(await p.evaluate("Boolean(document.querySelector('#messages')?.compareDocumentPosition(document.activeElement) & Node.DOCUMENT_POSITION_FOLLOWING)"), true,
        `${size}: to what lies below the messages (${below})`);
      assert.equal(await focusInView(p), true, size + ': which comes into view');
      if (size === 'laptop' || size === '390') await shot(p, 'rail-arrows-below-' + size);
      // On down to the reply, never lost.
      const more = await walk(p, 'ArrowDown', 20);
      assert.ok(!more.includes('page'), `${size}: no arrow loses the focus below the messages: ${more.join(' → ')}`);
      assert.ok(more.some(at => /^main:(topic-people|participants|people|inline-|new-message-sheet)/.test(at) || /^main:.*(Remove|People|reply|message)/i.test(at)), `${size}: ↓ reaches the People row or the reply: ${more.join(' → ')}`);
      // Back up to the last message.
      const up = await walk(p, 'ArrowUp', 30, at => at.startsWith('message:'));
      assert.equal(up.at(-1), 'message:' + lastId, `${size}: ↑ comes back to the last message: ${up.join(' → ')}`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('rail arrows on a message\'s bar ← and → move along its buttons, and ↑ and ↓ go on from its message as from the message itself', async () => {
    const p = await arrowsAt('rail-arrows-bar', '/?topic=t1', 'laptop');
    await topicUp(p, 'the topic is up, its messages drawn');
    const lastId = await p.evaluate("[...document.querySelectorAll('#messages [data-id]')].filter(e=>e.checkVisibility()).at(-1).dataset.id");
    // The keys on the last message: what ↑ from it reaches, and back.
    await p.evaluate("document.activeElement?.blur()");
    await p.key('ArrowDown');
    await walk(p, 'ArrowDown', 60, at => at === 'message:' + lastId);
    assert.equal(await focusAt(p), 'message:' + lastId, 'the keys are on the last message');
    await p.key('ArrowUp');
    const above = await focusAt(p);
    await p.key('ArrowDown');
    assert.equal(await focusAt(p), 'message:' + lastId, '↓ comes back to the last message');
    const toBar = async () => { for (let n = 0; n < 4 && !(await focusAt(p)).startsWith('bar:'); n++) await p.key('Tab'); return focusAt(p); };
    const first = await toBar();
    assert.match(first, /^bar:/, 'Tab reaches the message\'s bar');
    const along = await walk(p, 'ArrowRight', 8);
    assert.ok(along.length > 1 && along.every(at => at.startsWith('bar:')), '→ moves along the bar\'s buttons: ' + along.join(' → '));
    assert.equal(along.at(-1), 'bar:more', '→ reaches ⋯, the bar\'s last');
    const back = await walk(p, 'ArrowLeft', 8);
    assert.equal(back.at(-1), first, '← comes back along them to the first: ' + back.join(' → '));
    await shot(p, 'rail-arrows-bar-laptop');
    await p.key('ArrowUp');
    assert.equal(await focusAt(p), above, '↑ from the bar goes where ↑ from its message goes');
    await p.key('ArrowDown');
    assert.equal(await focusAt(p), 'message:' + lastId, '↓ comes back to the last message');
    assert.match(await toBar(), /^bar:/, 'Tab reaches its bar again');
    await p.key('ArrowDown');
    assert.match(await focusAt(p), /^main:/, '↓ from the last message\'s bar goes on down the page, as from the message');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail arrows ↑ above the right rail\'s first section reaches "Just this topic" and "All of this outcome", → and ← move along them, ↓ comes back to the sections, and the arrows reach every control in the right rail', async () => {
    const p = await arrowsAt('rail-arrows-things', '/?topic=t1', 'laptop');
    await settled(p, 'the topic is up');
    await until(() => p.evaluate(`Boolean(document.querySelector('#things .things-sec:not([hidden]) > summary')?.checkVisibility()) && Boolean(document.querySelector('#things .things-scope:not([hidden])'))`), 'the right rail has loaded, with its chips');
    await p.evaluate("document.activeElement?.blur()");
    for (let n = 0; n < 3 && !(await focusAt(p)).startsWith('things:'); n++) await p.key('ArrowRight');
    assert.match(await keyedAt(p), /^things:/, '→ reaches the right rail');
    await p.key('Home');
    const top = await keyedAt(p);
    await p.key('ArrowUp');
    const chip = await focusAt(p);
    assert.match(chip, /^things:(Just this topic|All of this outcome)$/, `↑ above the first section (${top}) reaches the rail's chips, not ${chip}`);
    // To the other chip by the arrow pointing at it: beside it, or below it where the rail is too narrow for both in a row.
    const toward = await p.evaluate(`(()=>{const [a,b]=[...document.querySelectorAll('#things .things-scope .chip')].map(e=>e.getBoundingClientRect()),me=document.activeElement.getBoundingClientRect(),other=Math.abs(me.left-a.left)<1&&Math.abs(me.top-a.top)<1?b:a;
      return Math.abs(other.top-me.top)<2?(other.left>me.left?'ArrowRight':'ArrowLeft'):(other.top>me.top?'ArrowDown':'ArrowUp')})()`);
    await p.key(toward);
    assert.match(await focusAt(p), /^things:(Just this topic|All of this outcome)$/, `${toward} moves to the other chip`);
    assert.notEqual(await focusAt(p), chip, `${toward} moves to the other chip`);
    // From the first chip, ↓ goes on down to the sections (from the second, beside a heading's pencil, ↓ may land on the pencil first).
    await p.evaluate("document.querySelector('#things .things-scope .chip').focus()");
    const down = await walk(p, 'ArrowDown', 6, at => at.startsWith('things:row:'));
    assert.ok(!down.includes('page'), 'never lost: ' + down.join(' → '));
    assert.ok((await focusAt(p)).startsWith('things:row:'), '↓ comes back to the sections: ' + down.join(' → '));
    // From the pencil in the Notebook's heading, a control inside a row, ↓ goes on to the row below and ↑ above it.
    await p.evaluate("document.querySelector('#things .notebook-create').focus()");
    await p.key('ArrowDown');
    assert.match(await focusAt(p), /^things:row:/, '↓ from the Notebook heading\'s pencil lands on the row below');
    await p.evaluate("document.querySelector('#things .notebook-create').focus()");
    await p.key('ArrowUp');
    assert.notEqual(await focusAt(p), 'things:New Notebook page', '↑ from the pencil moves too');
    // The pencil is the Notebook row's own, as a card's speech bubble is: → from the open row gives it the focus,
    // → from it goes on to the first page under the row, and ← from it comes back to the row.
    const NOTEBOOK_ROW = "#things .things-sec[data-key=notebook] > summary";
    const onRow = () => p.evaluate(`document.activeElement===document.querySelector('${NOTEBOOK_ROW}')`);
    const onFirstPage = () => p.evaluate(`(r=>{const rows=[...r.parentElement.querySelectorAll('[role=treeitem]')].filter(e=>e!==r&&e.checkVisibility());return rows.length>0&&document.activeElement===rows[0]})(document.querySelector('${NOTEBOOK_ROW}'))`);
    await p.evaluate(`(s=>{s.parentElement.open=true;s.focus()})(document.querySelector('${NOTEBOOK_ROW}'))`);
    await until(() => p.evaluate(`document.querySelectorAll('${NOTEBOOK_ROW} ~ * [role=treeitem]').length > 0`), 'the open Notebook shows its pages as rows');
    await p.key('ArrowRight');
    assert.equal(await focusAt(p), 'things:New Notebook page', '→ on the open Notebook row gives its pencil the focus');
    await p.key('ArrowRight');
    assert.equal(await onFirstPage(), true, '→ from the pencil goes on to the first page under the row: ' + await focusAt(p));
    await p.evaluate("document.querySelector('#things .notebook-create').focus()");
    await p.key('ArrowLeft');
    assert.equal(await onRow(), true, '← from the pencil comes back to the Notebook row: ' + await focusAt(p));
    // A row with no control set in it keeps the tree's →: on a folded section it opens it, the focus staying.
    const plain = await p.evaluate(`(d=>{if(!d)return null;d.open=false;d.querySelector(':scope > summary').focus();return d.dataset.key})([...document.querySelectorAll('#things .things-sec:not([hidden])')].find(d=>d.dataset.key!=='notebook'&&!d.querySelector(':scope > summary button')))`);
    if (plain) {
      await p.key('ArrowRight');
      assert.equal(await p.evaluate(`(d=>d.open&&document.activeElement===d.querySelector(':scope > summary'))(document.querySelector('#things .things-sec[data-key=${plain}]'))`), true, `→ on the folded ${plain} section opens it and keeps the focus on its row`);
    }
    const { missing, lost, dead } = await arrowClosure(p, '#things', treeStart(p, '#things'));
    assert.deepEqual(missing, [], 'the arrows reach every control in the right rail from its sections');
    assert.deepEqual(lost, [], 'and no arrow there loses the focus to the page');
    assert.deepEqual(dead, [], 'and none stays put where a control lies that way');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail arrows on the Outcomes home, an outcome\'s page, its pipeline and its Conversation, with nothing focused ↓ lands on a control in view, and the arrows go on from it, never to the page, at 1280, 390, 375 and 320', async () => {
    await control({ method: 'pipeline', kind: 'pipeline.configure', operation_id: 'rail-arrows-pipeline', target: { workspace_id: 'w1' }, args: { enabled: true } });
    try {
      for (const size of ['laptop', '390', '375', '320']) for (const [name, url, reaches] of [
        ['home', '/', /^main:w1$|Isolated wiring|outcome\d|topic/i], ['outcome', '/?workspace=w1', /topic|t1|New topic/i], ['pipeline', '/?pipeline=w1', /./], ['conversation', '/?conversation=w1', /./]]) {
        const p = await arrowsAt(`rail-arrows-${name}-${size}`, url, size, size === '390' ? 'dark' : 'light');
        await until(() => p.evaluate('document.body?.dataset.ready==="true"').catch(() => false), `${size} ${name}: the page is up`);
        await p.evaluate("document.activeElement?.blur()");
        await p.key('ArrowDown');
        const first = await focusAt(p);
        assert.notEqual(first, 'page', `${size} ${name}: ↓ with nothing focused lands on a control`);
        assert.equal(await focusInView(p), true, `${size} ${name}: one in view (${first})`);
        const down = await walk(p, 'ArrowDown', 25);
        assert.ok(!down.includes('page'), `${size} ${name}: ↓ never loses the focus: ${down.join(' → ')}`);
        assert.ok(down.length > 1, `${size} ${name}: ↓ goes on from the first control: ${down.join(' → ')}`);
        if (!down.some(at => reaches.test(at))) assert.fail(`${size} ${name}: ↓ reaches what the page lists: ${down.join(' → ')}; it stopped on ${await p.evaluate(`(e=>{const r=e.getBoundingClientRect(),near=[...document.querySelectorAll('#main a[href],#main button')].filter(x=>x!==e&&x.checkVisibility()).map(x=>{const b=x.getBoundingClientRect();return [x.textContent.trim().slice(0,20),Math.round(b.top),Math.round(b.bottom),Math.round(b.left),Math.round(b.right),Boolean(x.closest('[inert]'))]}).filter(b=>b[2]>r.top-10);return JSON.stringify({html:e.outerHTML.slice(0,240),box:[Math.round(r.top),Math.round(r.bottom),Math.round(r.left),Math.round(r.right)],scrollY,inner:innerHeight,doc:document.documentElement.scrollHeight,below:near.slice(0,12)})})(document.activeElement)`)}`);
        if (size === 'laptop' || size === '320') {
          // From the first control ↓ lands on with nothing focused, the arrows reach every control on the page.
          const first = async () => { await p.evaluate("document.activeElement?.blur()"); await p.key('ArrowDown'); return p.evaluate("document.activeElement?.dataset?.arrowNode ?? 'none'"); };
          const { missing, lost, dead, count } = await arrowClosure(p, 'body', first);
          assert.ok(count > 2, `${size} ${name}: the page has its controls (${count})`);
          assert.deepEqual(missing, [], `${size} ${name}: the arrows reach every control on the page from the first`);
          assert.deepEqual(lost, [], `${size} ${name}: and no arrow loses the focus to the page`);
          assert.deepEqual(dead, [], `${size} ${name}: and none stays put where a control lies that way`);
        }
        const up = await walk(p, 'ArrowUp', 25);
        assert.ok(!up.includes('page'), `${size} ${name}: ↑ never loses the focus: ${up.join(' → ')}`);
        for (const key of ['ArrowRight', 'ArrowLeft']) { await p.key(key); assert.notEqual(await focusAt(p), 'page', `${size} ${name}: ${key} keeps a control focused`); }
        if (size === 'laptop' || size === '390') await shot(p, `rail-arrows-${name}-${size}`);
        if (name === 'pipeline') {
          // A one-line field the arrows land in never holds them: ← and → move its cursor, ↑ and ↓ go on.
          await p.evaluate("(()=>{const f=document.querySelector('[data-key=\"add:next\"] input');f.scrollIntoView({block:'center'});f.focus();return true})()");
          await p.send('Input.insertText', { text: 'Half a title' });
          await p.key('ArrowLeft');
          assert.deepEqual(await p.evaluate("(f=>[document.activeElement===f,f.selectionStart])(document.querySelector('[data-key=\"add:next\"] input'))"), [true, 11], `${size}: ← in the line moves its cursor, the focus staying`);
          await p.key('ArrowDown');
          const left = await focusAt(p);
          assert.ok(left !== 'page' && !(await p.evaluate("document.activeElement===document.querySelector('[data-key=\"add:next\"] input')")), `${size}: ↓ in the one-line field goes on to the control below, not ${left}`);
          assert.equal(await p.evaluate("document.querySelector('[data-key=\"add:next\"] input').value"), 'Half a title', `${size}: and the line keeps its words`);
        }
        assert.deepEqual(p.errors, []); await p.close();
      }
    } finally {
      await control({ method: 'pipeline', kind: 'pipeline.configure', operation_id: 'rail-arrows-pipeline-off', target: { workspace_id: 'w1' }, args: { enabled: false } });
    }
  });

  await check('rail arrows a control out of sight is scrolled toward a third of a window at a time, the words between read on the way, and once it shows the next press lands on it', async () => {
    const SCROLLED = "(()=>{let t=scrollY;for(let e=document.getElementById('far-button').parentElement;e&&e!==document.body;e=e.parentElement)t+=e.scrollTop;return t})()";
    for (const size of ['laptop', '390', '375', '320']) {
      const p = await arrowsAt('rail-arrows-far-' + size, '/', size);
      await until(() => p.evaluate('document.body?.dataset.ready==="true"').catch(() => false), size + ': the home page is up');
      // Words a long way below the last control, then one more control.
      await p.evaluate(`(()=>{const main=document.getElementById('main'),words=document.createElement('div'),far=document.createElement('button');
        words.id='far-words';words.style.height=(innerHeight*3)+'px';words.textContent='Words to read on the way.';far.id='far-button';far.type='button';far.textContent='Far below';
        main.append(words,far);return true})()`);
      // On the last control above the words; a list the page draws again meanwhile takes the focus with the old one, so until it holds.
      await until(() => p.evaluate("(c=>{const e=c.at(-1);if(document.activeElement!==e){e.focus();e.scrollIntoView({block:'end'})}return document.activeElement===e})([...document.querySelectorAll('#main button, #main a[href]')].filter(e=>e.id!=='far-button'&&e.checkVisibility()))"),
        size + ': the last control above the words takes the focus');
      const from = await focusAt(p), h = await p.evaluate('innerHeight');
      const steps = [];
      for (let n = 0; n < 30 && await focusAt(p) !== 'main:far-button'; n++) {
        const y = await p.evaluate(SCROLLED);
        const { at } = await arrowPress(p, 'ArrowDown');
        steps.push({ at, by: await p.evaluate(SCROLLED) - y });
      }
      const said = `${size}: ${from} → ${JSON.stringify(steps)}`;
      assert.equal(steps.at(-1)?.at, 'main:far-button', said + ': ↓ reaches the control far below');
      const scrolls = steps.slice(0, -1);
      assert.ok(scrolls.length >= 3, said + ': it is not reached in one press, the words between scrolled past first');
      assert.ok(scrolls.every(step => step.at === from && step.by > 0 && step.by <= h / 3 + 1), said + ': each press before it scrolls down a third of a window at most, the focus staying on ' + from);
      assert.equal(await focusInView(p), true, said + ': and it shows');
      // So inside a box that scrolls, from a control in that box: what the box holds out of sight lies that way of
      // the focus in it (what a box has scrolled away lies no way only of a control outside it). The words and the
      // control far below go first, so nothing but the box's own lies below the control in it.
      await p.evaluate(`(()=>{document.getElementById('far-words').remove();document.getElementById('far-button').remove();const box=document.createElement('div'),near=document.createElement('button'),words=document.createElement('div'),far=document.createElement('button');
        box.id='far-box';box.style.cssText='overflow:auto;height:'+Math.round(innerHeight/2)+'px';near.id='box-near';near.type='button';near.textContent='Near';
        words.style.height=(innerHeight*2)+'px';words.textContent='Words in the box.';far.id='box-far';far.type='button';far.textContent='Far in the box';
        box.append(near,words,far);document.getElementById('main').append(box);box.scrollIntoView({block:'center'});near.focus({preventScroll:true});return true})()`);
      const inBox = [];
      for (let n = 0; n < 30 && await focusAt(p) !== 'main:box-far'; n++) {
        const y = await p.evaluate("document.getElementById('far-box').scrollTop");
        const { at } = await arrowPress(p, 'ArrowDown');
        inBox.push({ at, by: await p.evaluate("document.getElementById('far-box').scrollTop") - y });
      }
      const boxSaid = `${size}: in the box ${JSON.stringify(inBox)}`;
      assert.equal(inBox.at(-1)?.at, 'main:box-far', boxSaid + ': ↓ from the control in the box reaches the one out of sight in it');
      assert.ok(inBox.slice(0, -1).length >= 2 && inBox.slice(0, -1).every(step => step.at === 'main:box-near' && step.by > 0), boxSaid + ': the box scrolled toward it first, the focus staying in the box');
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('rail arrows on a Notebook page\'s cards ↑ above the first card goes on to the page\'s controls, ↓ comes back to the cards, and the arrows reach every control on the page, at 1280, 390, 375 and 320 and in the composer\'s sheet', async () => {
    await control({ method: 'outcome_reference', operation_id: 'rail-arrows-deck', item_id: 'rail-arrows-deck', title: 'Arrow deck', body: '## A card\n\nWords.\n\n## Another card\n\nMore words.\n' });
    const inDeck = p => p.evaluate("Boolean(document.activeElement?.closest?.('.deck-card'))");
    // ↑ from the cards until the focus leaves them: where it went at each press.
    // (On a phone a pick moves no focus: from nothing, ↑ picks the card above until the first, then goes on.)
    const outOfDeck = async p => { const seen = []; for (let n = 0; n < 10 && (await inDeck(p) || await focusAt(p) === 'page'); n++) { await arrowPress(p, 'ArrowUp'); seen.push(await focusAt(p)); } return seen; };
    for (const [size, url] of [['laptop', '/?cards=rail-arrows-deck'], ['390', '/?cards=rail-arrows-deck'], ['375', '/?cards=rail-arrows-deck'], ['320', '/?cards=rail-arrows-deck'], ['laptop', '/?topic=t1&page=rail-arrows-deck']]) {
      const where = `${size} ${url}`;
      const p = await arrowsAt('rail-arrows-deck-' + size, url, size, size === '390' ? 'dark' : 'light');
      await until(() => p.evaluate("document.body?.dataset.ready==='true' && [...document.querySelectorAll('.deck-card')].some(e=>e.checkVisibility())").catch(() => false), where + ': the cards are up');
      // At a laptop on a card, as the page puts the keys there (or ↓ from nothing picks it); on a phone, with
      // nothing focused, the card in view is the one picked.
      if (size === 'laptop') {
        if (!await inDeck(p)) { await p.evaluate("document.activeElement?.blur()"); await p.key('ArrowDown'); }
        assert.equal(await inDeck(p), true, where + ': the keys are on a card');
      } else await p.evaluate("document.activeElement?.blur()");
      const up = await outOfDeck(p);
      const out = await p.evaluate("(e=>e&&e!==document.body&&!e.closest('.deck-card'))(document.activeElement)");
      assert.equal(out, true, `${where}: ↑ above the first card goes on out of the cards: ${up.join(' → ')}`);
      assert.ok(!up.includes('page'), `${where}: and never to the page: ${up.join(' → ')}`);
      assert.equal(await focusInView(p), true, where + ': to a control in view');
      const above = await focusAt(p);
      await p.key('ArrowDown');
      assert.equal(await inDeck(p), true, `${where}: ↓ from ${above} comes back to the cards`);
      if (size === 'laptop' || size === '390') await shot(p, `rail-arrows-deck-${size}${url.includes('page=') ? '-sheet' : ''}`);
      // Every control on the page (in the sheet, the sheet's) is reached from the one above the cards.
      const scope = url.includes('page=') ? '#new-message-sheet' : 'body';
      const first = async () => { await p.evaluate("document.querySelector('.deck-card[tabindex=\"0\"]').focus()"); await outOfDeck(p); return p.evaluate("document.activeElement?.dataset?.arrowNode ?? 'none'"); };
      const { missing, lost, dead, count } = await arrowClosure(p, scope, first, '.deck-cards');
      assert.ok(count > 2, `${where}: the page has its controls (${count})`);
      assert.deepEqual(missing, [], `${where}: the arrows reach every control from the cards`);
      assert.deepEqual(lost, [], `${where}: and none loses the focus to the page`);
      assert.deepEqual(dead, [], `${where}: and none stays put where a control lies that way`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('rail arrows in Topic settings and the Reader move between their controls and never leave the pop-up for the page behind', async () => {
    const p = await arrowsAt('rail-arrows-popups', '/?topic=t1', 'laptop');
    await settled(p, 'the topic is up');
    await p.point('#settings-open');
    await until(() => p.evaluate("document.getElementById('topic-settings')?.open"), 'Topic settings is open');
    await p.evaluate("document.querySelector('#topic-settings button:not([disabled])').focus()");
    const start = await focusAt(p);
    const seen = new Set([start]);
    for (const key of ['ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowDown', 'ArrowDown']) {
      await p.key(key);
      const at = await focusAt(p);
      assert.match(at, /^dialog:/, `${key} keeps the focus in Topic settings, not ${at}`);
      seen.add(at);
    }
    assert.ok(seen.size > 1, 'the arrows move between Topic settings\' controls: ' + [...seen].join(', '));
    await shot(p, 'rail-arrows-settings-laptop');
    const first = async () => { await p.evaluate("document.querySelector('#topic-settings [data-arrow-node]').focus()"); return p.evaluate("document.activeElement?.dataset?.arrowNode ?? 'none'"); };
    const { missing, lost, dead } = await arrowClosure(p, '#topic-settings', first);
    assert.deepEqual(missing, [], 'the arrows reach every control in Topic settings');
    assert.deepEqual(lost, [], 'and none loses the focus to the page');
    assert.deepEqual(dead, [], 'and none stays put where a control lies that way');
    assert.match(await focusAt(p), /^dialog:/, 'the focus is still in Topic settings');
    await p.key('Escape');
    await until(() => p.evaluate("!document.getElementById('topic-settings').open"), 'Escape closes it');
    // The Reader: along its header, ↑ ↓ and ⋯ and ✕, and never out of it.
    await p.evaluate("document.activeElement?.blur()");
    await p.key('ArrowDown');
    assert.match(await focusAt(p), /^message:/, '↓ lights a message');
    // On a dossier shown as its row, Return edits its title (item 385): the keys go on to a message of their own.
    for (let n = 0; n < 4 && await p.evaluate("Boolean(document.activeElement?.matches?.('.stack-head-card') && document.activeElement.closest('.reply-stack')?.dataset.headOpen === 'false')"); ++n) await p.key('ArrowDown');
    await p.key('Enter');
    await until(() => p.evaluate("document.getElementById('reader')?.open"), 'Return opens the Reader');
    await p.evaluate("document.getElementById('reader-parent').focus()");
    const along = await walk(p, 'ArrowRight', 8);
    assert.ok(along.length > 2 && along.every(at => at.startsWith('dialog:')), '→ moves along the Reader\'s header: ' + along.join(' → '));
    assert.ok(along.includes('dialog:reader-close'), '→ reaches ✕: ' + along.join(' → '));
    const down = await walk(p, 'ArrowDown', 12);
    assert.ok(down.every(at => at.startsWith('dialog:')), '↓ stays in the Reader: ' + down.join(' → '));
    assert.ok(down.length > 1, '↓ goes on from the header: ' + down.join(' → '));
    // Every control in the Reader, its reply's + and 👍 and Send among them, by the arrows from its header.
    const readerClosure = async (q, size) => {
      // A link in the message's words, as a message with one has: → from the words reaches it, ← comes back.
      await q.evaluate("(b=>{const a=document.createElement('a');a.href='#arrow-link';a.id='arrow-link';a.textContent='a link in the words';b.prepend(a,' ')})(document.getElementById('source-body'))");
      await q.evaluate("document.getElementById('source-body').focus()");
      await q.key('ArrowRight');
      assert.equal(await focusAt(q), 'dialog:arrow-link', size + ': → from the message\'s words reaches the link in them');
      await q.key('ArrowLeft');
      assert.equal(await focusAt(q), 'dialog:source-body', size + ': ← from the link comes back to the words');
      // ↓ from the top of a long message reads it a step at a time to its end, then goes on to the reply below.
      await q.evaluate("(b=>{b.scrollTop=0,b.focus()})(document.getElementById('source-body'))");
      const through = await walk(q, 'ArrowDown', 80);
      assert.ok(through.includes('dialog:who-chip'), `${size}: ↓ through the long message reaches the reply below it: ${through.join(' → ')}`);
      // Read to its end, the message's box has scrolled its link up out of sight, above the header on the page but
      // inside the box below it: ↑ from the header lands on nothing there, and leaves the message where it was read to.
      // (At a laptop's width the message fits its box: words are added below for this, and taken away after.)
      const was = await q.evaluate("(b=>{const was=b.scrollTop,more=document.createElement('div');more.id='arrow-more';more.textContent='More words.\\n'.repeat(120);b.append(more);return was})(document.getElementById('source-body'))");
      const read = await q.evaluate("(b=>{b.scrollTop=b.scrollHeight;const l=document.getElementById('arrow-link').getBoundingClientRect(),k=b.getBoundingClientRect();return {top:b.scrollTop,hidden:l.bottom<=k.top,at:[Math.round(l.top),Math.round(l.bottom),Math.round(k.top),b.scrollTop,b.scrollHeight,b.clientHeight].join(' ')}})(document.getElementById('source-body'))");
      assert.equal(read.hidden, true, `${size}: the link in the words is scrolled up out of the message's box (link top, bottom, box top, scrolled, height, shows: ${read.at})`);
      const heads = await q.evaluate("[...document.querySelectorAll('#reader .reader-header a[href],#reader .reader-header button')].filter(e=>e.checkVisibility()).length");
      assert.ok(heads > 2, `${size}: the header's controls show (${heads})`);
      for (let n = 0; n < heads; n++) {
        const from = await q.evaluate(`(e=>(e.focus(),e.id||e.textContent.trim()))([...document.querySelectorAll('#reader .reader-header a[href],#reader .reader-header button')].filter(e=>e.checkVisibility())[${n}])`);
        await q.key('ArrowUp');
        assert.notEqual(await focusAt(q), 'dialog:arrow-link', `${size}: ↑ from ${from} never lands on the link scrolled out of the message's box`);
        assert.equal(await q.evaluate("document.getElementById('source-body').scrollTop"), read.top, `${size}: ↑ from ${from} leaves the message scrolled where it was read to, not back up toward the link out of sight in its box`);
      }
      await q.evaluate(`(b=>{document.getElementById('arrow-more').remove();b.scrollTop=${was}})(document.getElementById('source-body'))`);
      const readerFirst = async () => { await q.evaluate("document.getElementById('reader-parent').focus()"); return q.evaluate("document.activeElement?.dataset?.arrowNode ?? 'none'"); };
      const { missing, lost, dead } = await arrowClosure(q, '#reader', readerFirst);
      assert.deepEqual(missing, [], size + ': the arrows reach every control in the Reader');
      assert.deepEqual(lost, [], size + ': and none loses the focus to the page');
      assert.deepEqual(dead, [], size + ': and none stays put where a control lies that way');
    };
    await readerClosure(p, 'laptop');
    assert.deepEqual(p.errors, []); await p.close();
    const phone = await arrowsAt('rail-arrows-reader-390', '/?topic=t1', '390');
    await topicUp(phone, '390: the topic is up');
    await phone.evaluate("document.activeElement?.blur()");
    await phone.key('ArrowDown');
    for (let n = 0; n < 4 && await phone.evaluate("Boolean(document.activeElement?.matches?.('.stack-head-card') && document.activeElement.closest('.reply-stack')?.dataset.headOpen === 'false')"); ++n) await phone.key('ArrowDown');
    await phone.key('Enter');
    await until(() => phone.evaluate("document.getElementById('reader')?.open"), '390: Return opens the Reader');
    await readerClosure(phone, '390');
    await shot(phone, 'rail-arrows-reader-390');
    assert.deepEqual(phone.errors, []); await phone.close();
  });

  await check('rail arrows in writing are the writing\'s: in the topic\'s composer every arrow moves the cursor and never the focus', async () => {
    for (const size of ['laptop', '320']) {
      const p = await arrowsAt('rail-arrows-writing-' + size, '/?topic=t1', size);
      await topicUp(p, size + ': the topic is up');
      await emptyReply(p, size);
      await p.evaluate("(()=>{const f=document.getElementById('inline-writing-body');f.scrollIntoView({block:'center'});f.focus();return true})()");
      await p.send('Input.insertText', { text: 'One line\nTwo line' });
      await until(() => p.evaluate("document.getElementById('inline-writing-body').value==='One line\\nTwo line'"), size + ': the two lines are written');
      for (const key of ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowUp']) {
        await p.key(key);
        assert.equal(await focusAt(p), 'main:inline-writing-body', `${size}: ${key} in the writing leaves the focus there`);
      }
      assert.equal(await p.evaluate("document.getElementById('inline-writing-body').selectionStart"), 0, size + ': ↑ moved the cursor to the start');
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // A form control the arrows leave (item 301): a checkbox is pressed, not typed in, so every arrow goes on
  // from it, as from a button; the reach box's "Mark it reached anyway" (web/targets.mjs), on an outcome to
  // reach that nothing checks yet, its box for why below it.
  await check('rail arrows from the reach box\'s checkbox, Mark it reached anyway, ↑ ↓ ← and → go on to the controls that way, and none in the target panel stays put where a control lies that way, at 1280, 390, 375 and 320, light and dark', async () => {
    await control({ method: 'light_outcome', outcome: 'rail-arrows-reach', title: 'Arrow reach', topic: { id: 'rail-arrows-reach-plan', title: 'Plan' } });
    const keyOf = p => p.evaluate("(e=>!e||e===document.body?'page':e.dataset?.key??e.id??e.tagName)(document.activeElement)");
    const ANYWAY = '[data-key="reach-anyway"]';
    for (const [size, theme] of [['laptop', 'light'], ['laptop', 'dark'], ['390', 'dark'], ['375', 'light'], ['320', 'light']]) {
      const where = `${size} ${theme}`;
      const p = await arrowsAt(`rail-arrows-reach-${size}-${theme}`, '/?workspace=rail-arrows-reach', size, theme);
      await until(() => p.evaluate('document.body?.dataset.ready==="true" && Boolean(document.querySelector(\'[data-key="kind:reach"]\'))').catch(() => false), where + ': the kind chips show');
      if (await p.evaluate(`document.querySelector('[data-key="kind:reach"]').getAttribute('aria-pressed')`) !== 'true') {
        await p.evaluate(`document.querySelector('[data-key="kind:reach"]').scrollIntoView({block:'center'})`);
        await p.point('[data-key="kind:reach"]');
      }
      await until(() => p.evaluate(`Boolean(document.querySelector('[data-key="say-reached"]'))`), where + ': an outcome to reach offers Say it is reached');
      await p.evaluate(`document.querySelector('[data-key="say-reached"]').scrollIntoView({block:'center'})`);
      await p.point('[data-key="say-reached"]');
      await until(async () => (await keyOf(p)) === 'reach-words', where + ': the reach box opens with the caret in its box for why');
      assert.equal(await p.evaluate(`Boolean(document.querySelector('${ANYWAY}'))`), true, where + ': nothing checks it, so it asks to mark it reached anyway');
      const from = await p.evaluate(`(e=>{e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return {top:b.top,bottom:b.bottom}})(document.querySelector('${ANYWAY}'))`);
      const went = {};
      for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
        await p.evaluate(`document.querySelector('${ANYWAY}').focus()`);
        const lies = await p.evaluate(LIES(key));
        await p.key(key);
        went[key] = { to: await keyOf(p), lies, box: await p.evaluate("(b=>({top:b.top,bottom:b.bottom}))(document.activeElement.getBoundingClientRect())") };
      }
      const said = `${where}: ${JSON.stringify(went)}`;
      assert.equal(went.ArrowDown.to, 'reach-words', said + ': ↓ from the checkbox goes on to the box for why below it');
      assert.notEqual(went.ArrowUp.to, 'reach-anyway', said + ': ↑ from the checkbox goes on');
      assert.ok(went.ArrowUp.box.bottom <= from.top + 1, said + ': to a control above it');
      for (const key of ['ArrowLeft', 'ArrowRight']) {
        assert.notEqual(went[key].to, 'page', `${said}: ${key} never loses the focus to the page`);
        if (went[key].lies.length) assert.notEqual(went[key].to, 'reach-anyway', `${said}: ${key} goes on to what lies that way`);
      }
      // A checkbox still ticks with Space, the arrows having taken nothing from it.
      await p.evaluate(`document.querySelector('${ANYWAY}').focus()`);
      await p.key(' ');
      assert.equal(await p.evaluate(`document.querySelector('${ANYWAY}').checked`), true, where + ': Space ticks it');
      if (theme === 'light' || size === '390') await shot(p, `rail-arrows-reach-${size}-${theme}`);
      const first = async () => { await p.evaluate(`document.querySelector('${ANYWAY}').focus()`); return p.evaluate("document.activeElement?.dataset?.arrowNode ?? 'none'"); };
      const { missing, lost, dead } = await arrowClosure(p, '#target-panel', first);
      assert.deepEqual(missing, [], where + ': the arrows reach every control in the target panel from the checkbox');
      assert.deepEqual(lost, [], where + ': and none loses the focus to the page');
      assert.deepEqual(dead, [], where + ': and none stays put where a control lies that way');
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // A select keeps ↑ and ↓, which choose among its options, and ← and → go on from it: the agent a card's ask goes
  // to (web/deck-page.mjs), which the ask form draws as a select in a topic with two agents taking part.
  await check('rail arrows in a card\'s ask form, ← and → from the agent it goes to go on along its line, → to Ask and ← back, at 1280 and 390', async () => {
    await control({ method: 'light_outcome', outcome: 'rail-arrows-ask', title: 'Arrow ask', topic: { id: 'rail-arrows-ask-plan', title: 'Plan' } });
    await control({ method: 'topic_state', operation_id: 'rail-arrows-ask-team', topic_id: 'rail-arrows-ask-plan', participants: ['fixture-planning-agent'], args: { state: 'active', note: '' } });
    const item = (await control({ method: 'seed', topic_id: 'rail-arrows-ask-plan', memory_items: 1 })).item_ids[0];
    const revised = await control({ method: 'memory_revise', operation_id: 'rail-arrows-ask-card', item_id: item, title: 'Ask deck', expected_revision: 1, body: '## A card to ask about\n\nWords.\n' });
    assert.equal(revised.status, 'committed', JSON.stringify(revised));
    for (const size of ['laptop', '390']) {
      const p = await arrowsAt('rail-arrows-ask-' + size, '/?cards=' + item, size, size === '390' ? 'dark' : 'light');
      await until(() => p.evaluate("document.body?.dataset.ready==='true' && Boolean(document.querySelector('#deck-page .deck-ask'))").catch(() => false), size + ': the card has its speech bubble, to ask an agent about it')
        .catch(async error => { throw Error(error.message + ': ' + await p.evaluate("JSON.stringify({ready:document.body?.dataset.ready,cards:[...document.querySelectorAll('#deck-page .deck-card')].map(c=>c.textContent.trim().slice(0,40)),bubbles:document.querySelectorAll('#deck-page .deck-bubble').length,status:document.querySelector('#deck-page [role=status]')?.textContent,deck:document.getElementById('deck-page')?.innerHTML.slice(0,600)})")); });
      // The bubble is the card's own: Return on it asks, as a press does.
      await p.evaluate("document.querySelector('#deck-page .deck-ask').focus()");
      await p.key('Enter');
      await until(() => p.evaluate("Boolean(document.querySelector('#deck-page .deck-ask-to')?.checkVisibility())"), size + ': the ask opens with the agent it goes to, of two, as a select');
      const at = () => p.evaluate("(e=>e.matches('.deck-ask-to')?'select':e.textContent.trim()||e.tagName)(document.activeElement)");
      await p.evaluate("document.querySelector('#deck-page .deck-ask-to').focus()");
      await p.key('ArrowRight');
      assert.equal(await at(), 'Ask', size + ': → from the agent it goes to goes on to Ask beside it');
      await p.key('ArrowLeft');
      assert.equal(await at(), 'select', size + ': ← from Ask comes back to the agent it goes to');
      const lies = await p.evaluate(LIES('ArrowLeft'));
      await p.key('ArrowLeft');
      if (lies.length) assert.notEqual(await at(), 'select', `${size}: ← from it goes on to what lies that way (${lies.join(' | ')}), never held`);
      assert.equal(await p.evaluate("document.querySelector('#deck-page .deck-ask-to').value"), await p.evaluate("document.querySelector('#deck-page .deck-ask-to option').value"), size + ': and the arrows chose no other agent');
      if (size === 'laptop' || size === '390') await shot(p, 'rail-arrows-ask-' + size);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // The panes' keys answer first on a topic and a Conversation; what they leave unused goes on to the nearest
  // control that way (item 301): ↑ from the header's top row (on a phone, the right rail's button above Topic
  // settings and New message), and ← and → with nothing focused where no pane shows that way (a phone; → below
  // 1181px, where the right rail is behind its button). Pressed last: ← on a message folds it.
  await check('rail arrows on a topic and a Conversation, ↑ from the header\'s top row goes on to what lies above it, ← and → with nothing focused land on a control, and no arrow from any control stays put where a control lies that way, at 320, 375, 390, 820, 1024 and 1280', async () => {
    // A question waits in another outcome, so on a phone the line under the header says so.
    await control({ method: 'light_outcome', outcome: 'rail-arrows-panes-o', title: 'Panes elsewhere', topic: { id: 'rail-arrows-panes-t', title: 'Panes elsewhere topic' } });
    await control({ method: 'agent_message', operation_id: 'rail-arrows-panes-elsewhere', body: 'Anything new?', topic_id: 'rail-arrows-panes-t', addressees: [facts.actor], intent: 'ask' });
    const elsewhere = [];
    for (const size of ['320', '375', '390', '820', '1024', 'laptop']) for (const [name, url] of [['topic', '/?topic=t1'], ['conversation', '/?conversation=w1']]) {
      const where = `${size} ${name}`;
      const p = await arrowsAt(`rail-arrows-panes-${name}-${size}`, url, size, size === '390' || size === '1024' ? 'dark' : 'light');
      if (name === 'topic') { await topicUp(p, where + ': the topic is up, its messages drawn'); await emptyReply(p, where); }
      else await until(() => p.evaluate('document.body?.dataset.ready==="true"').catch(() => false), where + ': the page is up');
      const nothing = {};
      for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']) {
        await p.evaluate('(document.activeElement?.blur(), scrollTo(0, 0))');
        await p.key(key);
        nothing[key] = await focusAt(p);
      }
      // Each press that went wrong, so a failure names every one.
      const wrong = Object.entries(nothing).filter(([, at]) => at === 'page').map(([key]) => `${key} with nothing focused leaves the focus on the page`);
      if (ARROW_SIZES[size].width <= 760) for (const id of ['settings-open', 'new-message']) {
        if (!(await p.evaluate(`(e=>Boolean(e)&&e.checkVisibility()&&!e.closest('[inert]'))(document.getElementById('${id}'))`))) continue;
        const top = await p.evaluate(`(e=>{scrollTo(0,0);e.focus();return e.getBoundingClientRect().top})(document.getElementById('${id}'))`);
        const lies = await p.evaluate(LIES('ArrowUp'));
        await p.key('ArrowUp');
        const at = await focusAt(p), above = await p.evaluate(`document.activeElement.getBoundingClientRect().bottom <= ${top} + 1`);
        if (!lies.length) wrong.push(`no control lies above ${id}`);
        else if (at === 'main:' + id) wrong.push(`↑ from ${id} stays, though ${lies.join(' | ')} lies above it`);
        else if (!above) wrong.push(`↑ from ${id} lands on ${at}, not above it`);
      }
      // On a phone the line under the header saying what is new elsewhere is a row of the header's keys: ↓ from the
      // header's buttons comes to it, ↓ from it goes on into the feed, and ↑ from it goes back up to the buttons.
      if (ARROW_SIZES[size].width <= 760 && name === 'topic' && await p.evaluate("(e=>Boolean(e)&&e.checkVisibility()&&!e.closest('[inert]'))(document.getElementById('outline-elsewhere'))")) {
        elsewhere.push(size);
        await p.evaluate("(scrollTo(0,0),document.getElementById('settings-open').focus())");
        await p.key('ArrowDown');
        if (await focusAt(p) !== 'main:outline-elsewhere') wrong.push(`↓ from Topic settings lands on ${await focusAt(p)}, not the line under the header`);
        await p.evaluate("document.getElementById('outline-elsewhere').focus()");
        await p.key('ArrowUp');
        if (!await p.evaluate("Boolean(document.activeElement.closest('#main > .topic-header'))")) wrong.push(`↑ from the line under the header lands on ${await focusAt(p)}, not the header's buttons`);
        await p.evaluate("document.getElementById('outline-elsewhere').focus()");
        await p.key('ArrowDown');
        if (!await p.evaluate("Boolean(document.activeElement.closest('#messages, #main > .feed-filters'))")) wrong.push(`↓ from the line under the header lands on ${await focusAt(p)}, not the feed`);
      }
      assert.deepEqual(wrong, [], `${where}: every arrow lands on a control (nothing focused: ${JSON.stringify(nothing)})`);
      if (size === '390' || size === '1024') await shot(p, `rail-arrows-panes-${name}-${size}`);
      const first = async () => { await p.evaluate('(document.activeElement?.blur(), scrollTo(0, 0))'); await p.key('ArrowDown'); return p.evaluate("document.activeElement?.dataset?.arrowNode ?? 'none'"); };
      // Links and buttons in a message's words are the message's, reached by Tab from it (message-menu.mjs), as a
      // deck's cards are the deck's: left out here.
      const { missing, lost, dead, count } = await arrowClosure(p, 'body', first, '#messages .message-preview, #messages .message-reply-to');
      assert.ok(count > 5, `${where}: the page has its controls (${count})`);
      assert.deepEqual(missing, [], `${where}: the arrows reach every control on the page from the first`);
      assert.deepEqual(lost, [], `${where}: and no arrow loses the focus to the page`);
      assert.deepEqual(dead, [], `${where}: and none stays put where a control lies that way`);
      assert.deepEqual(p.errors, []); await p.close();
    }
    assert.ok(elsewhere.length > 0, 'the line under the header shows on a phone at least once, so its keys were pressed');
  });
}
