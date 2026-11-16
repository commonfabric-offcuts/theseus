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
    const items=[...t.querySelectorAll('[role=treeitem]')].filter(shown),focus=document.activeElement;
    const said=e=>e.dataset.topicId?'topic:'+e.dataset.topicId:e.classList.contains('ol-name')?'name:'+e.closest('.ol-outcome').dataset.workspaceId:'outline:'+(e.id||e.textContent.trim());
    return {role:t.getAttribute('role'),stops:[...t.querySelectorAll('a[href],button,summary,input,textarea,[tabindex]')].filter(e=>shown(e)&&e.tabIndex>=0).length,
      folds:t.querySelectorAll('.ol-fold').length===0,
      named:items.length>0&&items.every(e=>['aria-level','aria-setsize','aria-posinset'].every(a=>e.hasAttribute(a))),
      names:[...t.querySelectorAll('.ol-name')].filter(shown).every(e=>['true','false'].includes(e.getAttribute('aria-expanded'))),
      ring:focus&&t.contains(focus)?getComputedStyle(focus).outlineStyle:null,rows:items.map(said),
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
    assert.deepEqual(order.slice(-2), ['outline:outline-new-outcome', 'topic:t1'], 'Tab reaches New outcome, then the outline on the topic being read: ' + order.join(' '));
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

  await check('rail at 390 New topic in the open drawer shows its title line at once, focused, in the drawer; Escape closes the line, and Return starts the topic', async () => {
    for (const theme of ['light', 'dark']) {
      const p = await open('rail-new-topic-' + theme, '/?topic=t1', 'phone', theme);
      await until(() => p.evaluate('Boolean(document.querySelector("#topics a[data-topic-id=t1]")) && !document.querySelector("#new-topic").disabled'), theme + ': the rail is ready');
      await tap(p, '#rail-open');
      await until(async () => (await drawer(p)).open, theme + ': "☰ Outcomes" opens it');
      // The page's topic list, New topic at its end, shows once it has moved into the outline (docs/rails.md).
      await until(() => p.evaluate('document.getElementById("new-topic").getClientRects().length > 0'), theme + ': New topic is in the open drawer');
      // One tap: the line shows in the open drawer, under the Topics heading, with the focus in it.
      const line = () => p.evaluate(`(()=>{const l=document.getElementById('new-topic-title'),r=document.getElementById('rail'),b=l?.getBoundingClientRect(),d=r.getBoundingClientRect();
        return {shown:Boolean(l)&&l.getClientRects().length>0&&b.top>=d.top&&b.bottom<=d.bottom&&b.left>=d.left&&b.right<=d.right,focused:document.activeElement===l,open:r.classList.contains('open'),active:document.activeElement?.id??null}})()`);
      const tapped = () => until(() => p.evaluate('document.getElementById("new-topic").getAttribute("aria-expanded")==="true"'), theme + ': the tap reached New topic');
      // New topic ends the outcome's list in the outline, below its topics.
      await p.evaluate('document.getElementById("new-topic").scrollIntoView({block:"center"})');
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
      // New topic ends the outcome's list in the outline, below its topics.
      await p.evaluate('document.getElementById("new-topic").scrollIntoView({block:"center"})');
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

  await check('rail the chips show only the outcomes with something new or waiting on the reader, ⇧⌘→ and ⇧⌘← open and fold every outcome until the next place tidies them, and + New topic under another outcome starts a topic there', async () => {
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
    // ⇧⌘→ opens every outcome, and ⇧⌘← folds every one, from anywhere in the outline: here, New outcome.
    const opens = async () => Object.values((await outline(p)).outcomes).map(row => row.open);
    assert.deepEqual((await opens()).filter(open => open).length, 1, 'only the outcome being read is open');
    await tabToOutline(p);
    await p.key('Tab', 8);
    assert.equal(await keyedAt(p), 'outline:outline-new-outcome', 'Shift-Tab from the outline is its New outcome');
    await p.key('ArrowRight', 12);
    await until(async () => (await opens()).every(open => open), '⇧⌘→ opens every outcome');
    assert.equal(await keyedAt(p), 'outline:outline-new-outcome', 'the keys stay where they were');
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
    // + New topic under another outcome, while reading this one: ⌘→ opens it from the keys; the topic starts there and opens in place.
    const before = await placeOf(p);
    await keysTo(p, 'name:rail-chip-ask');
    await p.key('ArrowRight', 4);
    await until(async () => (await outline(p)).outcomes['rail-chip-ask'].topics.some(row => row.id === 'rail-chip-ask-t'), 'its topics show under it');
    await press(p, '.ol-outcome[data-workspace-id="rail-chip-ask"] .ol-new-topic');
    await until(() => p.evaluate("document.activeElement?.id==='ol-new-topic-rail-chip-ask'"), 'its title line shows, focused');
    const title = 'Started under another outcome';
    await p.send('Input.insertText', { text: title }); await p.key('Enter');
    const opened = await until(async () => { const at = await placeOf(p); return at.ready && at.title === title && at; }, 'the new topic opens');
    assert.equal(opened.origin, before.origin, 'in place');
    const id = new URLSearchParams(opened.search).get('topic');
    assert.equal((await view('topic', { topic_id: id })).topic.workspace_id, 'rail-chip-ask', 'the topic is in the outcome whose + New topic was pressed');
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
      // Open again, the keys on nothing (a press on its words): nothing under it moves.
      await opened();
      await p.evaluate('document.activeElement.blur()');
      assert.equal(await keyedAt(p), 'body', width + ': the keys are on nothing');
      const before = await seen();
      for (const key of ['ArrowLeft', 'ArrowDown', 'ArrowUp', 'Enter']) {
        await p.key(key);
        const now = await seen();
        assert.deepEqual([now.open, now.inRail, now.lit, now.reader], [true, false, before.lit, false], `${width}: ${key} leaves the page under the right rail as it was`);
        assert.equal(await keyedAt(p), 'body', `${width}: ${key} takes the keys nowhere under it`);
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
    // → on the open outcome goes on into the page reached: its Conversation's messages, or the page itself while it has none.
    await p.key('ArrowRight');
    assert.match(await keyedAt(p), /^(message:|main$)/, 'another outcome: → goes into the Conversation');
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
    // → on the folded outcome opens it, as the keys' → does; the next → goes into the page.
    await p.key('ArrowRight');
    await until(async () => (await outline(p)).outcomes['rail-ring-o'].open, 'the Conversation: → opens its topics');
    assert.equal(await keyedAt(p), 'name:rail-ring-o', 'the Conversation: the keys stay on its row');
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

  await check('rail → on an open outcome goes into the messages, as on a topic; on a folded one it opens it, and ↓ reaches its topics', async () => {
    const p = await open('rail-open-right', '/?topic=t1');
    await settled(p, 'the topic is up');
    await keysTo(p, 'name:w1');
    const expanded = () => p.evaluate("document.querySelector('.ol-outcome[data-workspace-id=w1] .ol-name').getAttribute('aria-expanded')");
    assert.equal(await expanded(), 'true', 'the outcome being read is open');
    await p.key('ArrowRight');
    assert.match(await keyedAt(p), /^message:/, '→ on the open outcome goes into the messages');
    assert.equal(await expanded(), 'true', 'and leaves it open');
    // Back: ← lands on the topic being read; ↑ to the outcome, ← folds it, → opens it and keeps the keys on it.
    await p.key('ArrowLeft');
    assert.equal(await keyedAt(p), 'topic:t1', '← from the messages comes back to the topic being read');
    await p.key('ArrowUp');
    for (let n = 0; n < 12 && await keyedAt(p) !== 'name:w1'; ++n) await p.key('ArrowUp');
    assert.equal(await keyedAt(p), 'name:w1');
    await p.key('ArrowLeft');
    await until(async () => await expanded() === 'false', '← folds the open outcome');
    await p.key('ArrowRight');
    await until(async () => await expanded() === 'true', '→ on the folded outcome opens it');
    assert.equal(await keyedAt(p), 'name:w1', 'and the keys stay on it, not in the messages');
    await p.key('ArrowDown');
    const rows = (await keyTree(p)).rows;
    assert.equal(await keyedAt(p), rows[rows.indexOf('name:w1') + 1], '↓ reaches its first topic');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail ↑ from the top message reaches the buttons at the top of the feed, with a ring: ← and → move along them and on to the outline and the right rail, ↓ comes back, Return presses one', async () => {
    // A check before this one leaves t1 Ready for review, which puts ✅ Done
    // among the header's buttons; this one walks a plainly Active topic's two.
    await control({ method: 'topic_state', operation_id: 'rail-header-keys-active', topic_id: 't1', args: { state: 'active', note: '' } });
    const p = await open('rail-header-keys', '/?topic=t1');
    await settled(p, 'the topic is up');
    await until(() => p.evaluate("document.querySelectorAll('#messages [data-id]').length > 1"), 'the messages are drawn');
    const buttons = await p.evaluate("[...document.querySelectorAll('#main > .topic-header button')].filter(b=>b.checkVisibility()).map(b=>b.id)");
    assert.deepEqual(buttons, ['settings-open', 'new-message'], 'Topic settings and New message are the header\'s buttons at 1280');
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
    await p.key('ArrowRight');
    assert.match(await keyedAt(p), /^things:/, '→ past the last button goes to the right rail');
    await p.key('ArrowLeft');
    if (/^things:/.test(await keyedAt(p))) await p.key('ArrowLeft');
    assert.equal(await keyedAt(p), 'message:' + firstId, '← from the right rail comes back to the message');
    await p.key('ArrowUp');
    assert.equal(await keyedAt(p), 'new-message', '↑ again finds the button the keys were last on');
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
    // Folded, its row is the outline's only one: → opens it again, the keys still on it, and ↑ ↓ go on from there.
    await c.key('ArrowRight');
    await until(async () => (await keyTree(c)).rows.length > 1, '→ opens the outcome pressed, its topics under it');
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

  await check('rail a press in the outline on what opens there keeps its own way: New topic opens its title line with the focus in it and Escape gives New topic the focus back; a press on a message after a row leaves nothing in the rails ringed', async () => {
    const p = await open('rail-press-own', '/?topic=t1');
    await settled(p, 'the topic is up');
    await press(p, '#outline #new-topic');
    await until(() => p.evaluate(`document.activeElement?.id==='new-topic-title' && Boolean(document.activeElement.closest('#outline'))`), 'New topic opens its title line in the outline, the focus in it');
    await p.key('Escape');
    await until(() => p.evaluate(`!document.querySelector('#new-topic-title') && document.activeElement?.id==='new-topic'`), 'Escape closes the line and gives New topic the focus');
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
    const walk = async (key, words) => {
      const ys = [];
      let before = await keyed();
      for (let n = 0; n < 80; n++) {
        await p.key(key);
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

  // Item 547: requests the check picks, held at the network to drop, let through or answer: in Chrome with the
  // harness's interception, in Safari's engine with Playwright's routing. before: held before Core sees them.
  // always(test, status, body): each request test picks is answered so at once, until always(null).
  // after(): from now on what is held is held once Core has answered it.
  const network547 = async (p, before = false) => {
    const take = (list, entry) => list.splice(list.indexOf(entry), 1);
    let test = null, auto = null;
    if (!p.pw) {
      if (before) await p.send('Fetch.enable', { patterns: [{ urlPattern: facts.origin + '/api/command', requestStage: 'Request' }, { urlPattern: facts.origin + '/api/view', requestStage: 'Response' }] });
      p.intercept(async (payload, event) => {
        if (!auto?.test(payload)) return Boolean(test?.(payload));
        event.answered = true;
        await p.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: auto.status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(auto.body)).toString('base64') });
        return true;
      });
      for (const entry of p.held.filter(each => each.event.answered)) take(p.held, entry);
      return { hold: given => { test = given; }, always: (given, status, body) => { auto = given && { test: given, status, body }; },
        after: () => p.send('Fetch.enable', { patterns: [{ urlPattern: facts.origin + '/api/*', requestStage: 'Response' }] }),
        held: () => { for (const entry of p.held.filter(each => each.event.answered)) take(p.held, entry); return p.held; },
        drop: entry => { take(p.held, entry); return p.fail(entry); },
        pass: entry => { take(p.held, entry); return entry.event.responseStatusCode === undefined ? p.send('Fetch.continueRequest', { requestId: entry.event.requestId }) : p.release(entry); },
        answer: (entry, status, body) => { take(p.held, entry); return p.send('Fetch.fulfillRequest', { requestId: entry.event.requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }); } };
    }
    const held = [];
    await p.pw.route(facts.origin + '/api/*', async route => {
      let payload = null; try { payload = route.request().postDataJSON(); } catch { /* not JSON */ }
      if (auto?.test(payload)) return route.fulfill({ status: auto.status, contentType: 'application/json', body: JSON.stringify(auto.body) });
      if (!test?.(payload)) return route.continue();
      held.push({ payload, route, response: before ? null : await route.fetch() });
    });
    return { hold: given => { test = given; }, always: (given, status, body) => { auto = given && { test: given, status, body }; }, held: () => held,
      after: () => { before = false; },
      drop: entry => { take(held, entry); return entry.route.abort('connectionreset'); },
      pass: entry => { take(held, entry); return entry.response ? entry.route.fulfill({ response: entry.response }) : entry.route.continue(); },
      answer: (entry, status, body) => { take(held, entry); return entry.route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }); } };
  };
  // The rail's notices as drawn: each one shown, its box, and whether it is what shows at its own middle.
  const notices547 = p => p.evaluate(`(()=>{const r=document.getElementById('rail'),rb=r.getBoundingClientRect();
    return {scroll:r.scrollTop,room:r.scrollHeight-r.clientHeight,overflow:document.documentElement.scrollWidth>innerWidth,
      shown:['app-status','wakes-status','updates-status','topic-navigation-status'].map(id=>document.getElementById(id)).filter(n=>!n.hidden&&n.getClientRects().length).map(n=>{
        const b=n.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+Math.min(b.height/2,12);
        return {id:n.id,box:[b.left,b.top,b.right,b.bottom].map(Math.round),inRail:b.top>=rb.top-1&&b.bottom<=rb.bottom+1,ownMiddle:n.contains(document.elementFromPoint(x,y))}})}})()`);
  // The phone's drawer, opened by a tap on "☰ Outcomes" at the top of the page, the writing put down first
  // and the control at rest, so the tap lands on it.
  const openDrawer547 = async (p, at) => {
    await p.evaluate('(document.activeElement?.blur(),scrollTo(0,0))');
    await until(() => p.evaluate(`new Promise(done=>{const box=()=>JSON.stringify(document.getElementById('rail-open').getBoundingClientRect());const first=box();
      requestAnimationFrame(()=>requestAnimationFrame(()=>done(first===box()&&scrollY===0)))})`), at + ': "☰ Outcomes" is at rest at the top');
    await tap(p, '#rail-open');
    await until(async () => (await drawer(p)).open, at + ': the drawer opens');
  };
  const apart547 = (seen, at) => {
    const boxes = seen.shown.map(item => item.box);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      assert.ok(a[3] <= b[1] || b[3] <= a[1] || a[2] <= b[0] || b[2] <= a[0], `${at}: ${seen.shown[i].id} and ${seen.shown[j].id} never draw over each other: ${JSON.stringify(seen)}`);
    }
    // What is in sight shows itself: nothing draws over it. (In the phone's drawer scrolled down they are out of sight, above.)
    for (const item of seen.shown.filter(each => each.inRail)) assert.ok(item.ownMiddle, `${at}: nothing draws over ${item.id}: ${JSON.stringify(seen)}`);
  };

  await check('rail the page\'s notices stack and never draw over each other: an act not settled and why a move stayed, in the rail scrolled at a laptop\'s width and in the drawer at 320 375 and 390, light and dark', async () => {
    const topic = 'rail-notices-t';
    await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Notices topic' }, ...Array.from({ length: 24 }, (_, k) => ({ id: `${topic}-${k}`, title: `Notices neighbour ${k + 1}` }))] });
    const faults = [];
    for (const [size, theme] of [['laptop', 'light'], ['laptop', 'dark'], ['phone', 'light'], ['phone', 'dark'], ['w375', 'dark'], ['w320', 'light']]) {
      const at = `${size} ${theme}`, laptop = size === 'laptop';
      // A card of its own each time, not starred yet.
      const message = (await control({ method: 'agent_message', operation_id: `${topic}-${size}-${theme}`, topic_id: topic, join: true, addressees: [facts.actor], body: `A card whose star is not settled (${at}).` })).result.message_id;
      const p = await page('rail-notices-' + size + theme, null, true, { url: facts.origin + '/?topic=' + topic, beforeNavigate: async q => {
        await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await q.send('Emulation.setDeviceMetricsOverride', laptop ? { ...SIZES.laptop, height: 560 } : SIZES[size]);
        if (SIZES[size].mobile) await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      } });
      const card = `#messages .message-card[data-id="${message}"]`;
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card)})) && Boolean(document.getElementById('inline-writing-body'))`), at + ': the card and the writing box are up');
      const net = await network547(p, true), stars = payload => payload?.kind === 'message.star', sends = payload => payload?.kind === 'message.send';
      net.hold(payload => stars(payload) || sends(payload));
      // A star Theseus is too busy to take, as in item 547 (its command lane full while the reader's own reply
      // goes), its next try held: the status line says so.
      await p.evaluate(`document.querySelector(${JSON.stringify(card)}).scrollIntoView({block:'center'})`);
      const words = card + ' > .message-preview', star = card + ' > .message-author > .card-star';
      if (laptop) await p.point(words, 'move'); else await tap(p, words);
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(star)})?.getClientRects().length > 0`), at + ': the card is lit, with its star');
      if (laptop) await p.point(star); else await tap(p, star);
      await net.answer(await until(() => net.held().find(entry => stars(entry.payload)), at + ': the star is on its way'), 503,
        { error: { code: 'SERVER_BUSY', message: 'This request lane is busy; retain its operation.' } });
      await until(() => p.evaluate("(n=>!n.hidden&&n.textContent.length>0)(document.getElementById('app-status'))"), at + ': the status line says what became of the star');
      // A send held on its way: a move now waits, and the rail says why.
      await p.evaluate("document.getElementById('inline-writing-body').scrollIntoView({block:'center'})");
      if (laptop) await p.point('#inline-writing-body'); else await tap(p, '#inline-writing-body');
      await p.send('Input.insertText', { text: 'Sent while the page is asked to move' });
      await p.evaluate("document.getElementById('inline-send').scrollIntoView({block:'center'})");
      if (laptop) await p.point('#inline-send'); else await tap(p, '#inline-send');
      await until(() => net.held().find(entry => sends(entry.payload)), at + ': the send is on its way');
      const row = `#outline a[data-topic-id="${topic}-23"]`;
      if (!laptop) await openDrawer547(p, at);
      await p.evaluate(`document.querySelector(${JSON.stringify(row)}).scrollIntoView({block:'center'})`);
      if (laptop) await p.point(row); else await tap(p, row);
      await until(() => p.evaluate("document.getElementById('topic-navigation-status').textContent.includes('Wait for the send to finish')"), at + ': the rail says why the page stays');
      // The phone's drawer closes as a row is tapped; the notices are read in it, opened again.
      if (!laptop && !(await drawer(p)).open) await openDrawer547(p, at + ' again');
      const both = await until(async () => { const seen = await notices547(p); return seen.shown.length === 2 ? seen : null; }, at + ': both notices show').catch(async error => {
        throw Error(`${error.message}: ${JSON.stringify(await notices547(p))} ${await p.evaluate("JSON.stringify({status:document.getElementById('app-status').outerHTML.slice(0,300),drawer:document.getElementById('rail').className})")}`); });
      assert.ok(both);
      // The rail scrolled a little, so the second notice would pass under the first where only the first was
      // pinned (Tony's screenshot); scrolled to its end (where a laptop pins its notices); and at its top.
      // (Where the first is pinned at the rail's top, the second's top would then be at its middle.)
      const partly = await p.evaluate(`(()=>{const r=document.getElementById('rail');r.scrollTop=0;
        const a=document.getElementById('app-status').getBoundingClientRect(),t=document.getElementById('topic-navigation-status').getBoundingClientRect();
        return Math.max(1,Math.round(t.top-r.getBoundingClientRect().top-a.height/2))})()`);
      // Each look is pictured first, and what it finds wrong is kept, so every size and theme is seen and pictured.
      const fault = check => { try { check(); } catch (error) { faults.push(error.message); } };
      for (const where of ['partly', 'scrolled', 'top']) {
        await p.evaluate(`(()=>{const r=document.getElementById('rail');r.scrollTop=${where === 'top' ? 0 : where === 'partly' ? partly : 'r.scrollHeight'}})()`);
        await p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
        await shot(p, `rail-notices-${size}-${theme}-${where}`);
        const seen = await notices547(p);
        fault(() => {
          if (where !== 'top') assert.ok(seen.room > 0 && seen.scroll > 0, `${at}: the rail is scrolled: ${JSON.stringify(seen)}`);
          assert.deepEqual(seen.shown.map(item => item.id), ['app-status', 'topic-navigation-status'], `${at} ${where}: the status line, then why the move stayed`);
          if (laptop || where === 'top') for (const item of seen.shown) assert.ok(item.inRail, `${at} ${where}: ${item.id} is in sight in the rail: ${JSON.stringify(seen)}`);
          apart547(seen, `${at} ${where}`);
          // In sight, they share the rail's edges.
          const inSight = seen.shown.filter(item => item.inRail);
          assert.ok(inSight.every(item => item.box[0] === inSight[0].box[0] && item.box[2] === inSight[0].box[2]), `${at} ${where}: the notices line up: ${JSON.stringify(seen)}`);
          assert.equal(seen.overflow, false, `${at}: nothing scrolls sideways`);
        });
      }
      const said = await p.evaluate("document.getElementById('app-status').textContent");
      fault(() => assert.match(said, /^Starring “A card whose star is not settled[^”]*” is not saved yet: Theseus was busy\. The page sends it again\.$/, `${at}: the line names the act and its card, and says busy, never a lost connection: ${said}`));
      net.hold(null);
      for (const entry of [...net.held()]) await net.pass(entry);
      await until(() => p.evaluate("document.getElementById('app-status').hidden"), at + ': once Core takes the star, the status line goes').catch(error => faults.push(error.message));
      assert.deepEqual(p.errors, []); await p.close();
    }
    assert.deepEqual(faults, [], 'every size and theme');
  });

  await check('rail a reply whose send is not confirmed holds no move: it is kept through a reload, the page moves at the first press with nothing said, and its Review button is there on coming back; one Core took, its answer lost, is settled on coming back by its own send, never by its words', async () => {
    const [topic, other] = ['rail-doubt-t', 'rail-doubt-u'];
    await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Doubt topic' }, { id: other, title: 'Elsewhere topic' }] });
    const p = await open('rail-doubt', '/?topic=' + topic);
    await until(() => p.evaluate(`Boolean(document.querySelector('#outline a[data-topic-id="${other}"]')) && Boolean(document.getElementById('inline-writing-body'))`), 'the outline and the writing box are ready');
    const net = await network547(p, true), sends = payload => payload?.kind === 'message.send';
    net.hold(sends);
    await p.evaluate("document.getElementById('inline-writing-body').scrollIntoView({block:'center'})"); await p.point('#inline-writing-body');
    await p.send('Input.insertText', { text: 'A reply whose send is lost' });
    await p.evaluate("document.getElementById('inline-send').scrollIntoView({block:'center'})"); await p.point('#inline-send');
    // The send never reaches Core: nobody can say it went.
    await net.drop(await until(() => net.held().find(entry => sends(entry.payload)), 'the send is on its way'));
    const review = () => p.evaluate("[...document.querySelectorAll('#inline-pending button, #topic-pending button')].map(b=>b.textContent)");
    await until(async () => (await review()).includes('Review 1 reply'), 'the reply is in doubt: its Review button shows');
    net.hold(null);
    await reloaded(p, 'the page loads again');
    await until(async () => (await review()).includes('Review 1 reply'), 'after a reload the reply is still in doubt, and its Review button shows');
    const row = `#outline a[data-topic-id="${other}"]`;
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(row)}))`), 'the outline is up again');
    await p.evaluate(`document.querySelector(${JSON.stringify(row)}).scrollIntoView({block:'center'})`);
    await p.point(row);
    await arrived(p, '?topic=' + other, 'Elsewhere topic', 'the first press moves the page');
    assert.equal(await p.evaluate("document.getElementById('topic-navigation-status').hidden"), true, 'nothing is said about leaving');
    await p.evaluate('history.back()');
    await arrived(p, '?topic=' + topic, 'Doubt topic', 'back');
    await until(async () => (await review()).includes('Review 1 reply'), 'the reply is kept: its Review button is there on coming back');
    const said = async () => (await view('topic_messages', { topic_id: topic, direction: 'before', limit: 20 })).items.filter(item => item.body === 'A reply whose send is lost').length;
    assert.equal(await said(), 0, 'and it was not sent');
    // The same words again, sent: Core takes this one, and its answer is lost.
    await net.after(); net.hold(sends);
    await p.evaluate("document.getElementById('inline-writing-body').scrollIntoView({block:'center'})"); await p.point('#inline-writing-body');
    await p.send('Input.insertText', { text: 'A reply whose send is lost' });
    await p.evaluate("document.getElementById('inline-send').scrollIntoView({block:'center'})"); await p.point('#inline-send');
    const lost = await until(() => net.held().find(entry => sends(entry.payload)), 'Core took the second send; its answer is held');
    assert.equal(await said(), 1, 'Core holds it');
    await net.drop(lost); net.hold(null);
    await until(async () => (await review()).includes('Review 2 replies'), 'both are in doubt now');
    await p.evaluate(`document.querySelector(${JSON.stringify(row)}).scrollIntoView({block:'center'})`);
    await p.point(row);
    await arrived(p, '?topic=' + other, 'Elsewhere topic', 'the first press moves the page again');
    await p.evaluate('history.back()');
    await arrived(p, '?topic=' + topic, 'Doubt topic', 'back again');
    // Read again, the one Core took is settled by its own send; the one with the same words that never went is not.
    await until(async () => { const now = await review(); return now.includes('Review 1 reply') && !now.includes('Review 2 replies'); }, 'the one Core took is settled; the other, word for word the same, stays in doubt')
      .catch(async error => { throw Error(`${error.message}: ${JSON.stringify(await review())}`); });
    assert.equal(await said(), 1, 'sent once, never again');
    assert.equal(p.calls.filter(call => sends(call.payload) && call.payload.operation_id === lost.payload.operation_id).length, 1, 'its send went once');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('rail a star Theseus was too busy to take and a reply whose send is lost, together as on live: the line says the star with its card, no notice draws over another, nothing holds the move, the star is made once after the page has gone, and on coming back the card shows it and the reply its Review button', async () => {
    for (const [size, theme] of [['laptop', 'light'], ['phone', 'dark']]) {
      const at = `${size} ${theme}`, laptop = size === 'laptop', topic = `rail-together-${size}`, other = `rail-together-${size}-away`;
      await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Together ' + size }, { id: other, title: 'Away ' + size }] });
      const message = (await control({ method: 'agent_message', operation_id: topic + '-m', topic_id: topic, join: true, addressees: [facts.actor], body: 'The card starred while Theseus is busy.' })).result.message_id;
      const p = await open('rail-together-' + size, '/?topic=' + topic, size, theme);
      const card = `#messages .message-card[data-id="${message}"]`, row = `#outline a[data-topic-id="${other}"]`;
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card)})) && Boolean(document.getElementById('inline-writing-body')) && Boolean(document.querySelector(${JSON.stringify(row)}))`), at + ': the card, the writing box and the outline are up');
      const net = await network547(p, true), stars = payload => payload?.kind === 'message.star', sends = payload => payload?.kind === 'message.send';
      // The star: Theseus too busy to take it, each time it goes, until the page has moved on.
      const lane = { error: { code: 'SERVER_BUSY', message: 'This request lane is busy; retain its operation.' } };
      net.hold(sends); net.always(stars, 503, lane);
      await p.evaluate(`document.querySelector(${JSON.stringify(card)}).scrollIntoView({block:'center'})`);
      const words = card + ' > .message-preview', star = card + ' > .message-author > .card-star';
      if (laptop) await p.point(words, 'move'); else await tap(p, words);
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(star)})?.getClientRects().length > 0`), at + ': the card is lit, with its star');
      if (laptop) await p.point(star); else await tap(p, star);
      const busy = 'Starring “The card starred while Theseus is busy.” is not saved yet: Theseus was busy. The page sends it again.';
      await until(() => p.evaluate(`document.getElementById('app-status').textContent===${JSON.stringify(busy)}`), at + ': the line says the star, its card, and busy')
        .catch(async error => { throw Error(`${error.message}: ${await p.evaluate("document.getElementById('app-status').textContent")}`); });
      const starTries = () => p.calls.filter(call => stars(call.payload)).length;
      await until(() => starTries() >= 2, at + ': the star goes again as Theseus answers');
      // The reply: its send lost before Core saw it, so it is in doubt.
      await p.evaluate("document.getElementById('inline-writing-body').scrollIntoView({block:'center'})");
      if (laptop) await p.point('#inline-writing-body'); else await tap(p, '#inline-writing-body');
      await p.send('Input.insertText', { text: 'A reply sent while Theseus is busy' });
      await p.evaluate("document.getElementById('inline-send').scrollIntoView({block:'center'})");
      if (laptop) await p.point('#inline-send'); else await tap(p, '#inline-send');
      await net.drop(await until(() => net.held().find(entry => sends(entry.payload)), at + ': the send is on its way'));
      const review = () => p.evaluate("[...document.querySelectorAll('#inline-pending button, #topic-pending button')].map(b=>b.textContent)");
      await until(async () => (await review()).includes('Review 1 reply'), at + ': the reply is in doubt: its Review button shows');
      if (!laptop) await openDrawer547(p, at);
      const seen = await notices547(p);
      assert.deepEqual(seen.shown.map(item => item.id), ['app-status'], `${at}: the status line alone: ${JSON.stringify(seen)}`);
      apart547(seen, at);
      await shot(p, `rail-together-${size}-${theme}`);
      // The first press on another topic moves the page, with nothing said.
      await p.evaluate(`document.querySelector(${JSON.stringify(row)}).scrollIntoView({block:'center'})`);
      if (laptop) await p.point(row); else await tap(p, row);
      await arrived(p, '?topic=' + other, 'Away ' + size, at + ': the first press moves the page')
        .catch(async error => { throw Error(`${error.message}: ${await p.evaluate("document.getElementById('topic-navigation-status').textContent")}`); });
      assert.equal(await p.evaluate("document.getElementById('topic-navigation-status').hidden"), true, `${at}: nothing is said about leaving`);
      // Theseus takes the star now, at its next try from the page that has gone: it is made once.
      const tries = starTries();
      net.hold(null); net.always(null);
      await control({ method: 'agent_message', operation_id: topic + '-later', topic_id: other, join: true, addressees: [facts.actor], body: 'Something new, so Theseus answers.' });
      await until(() => starTries() > tries, at + ': the page that has gone sends the star again as Theseus answers');
      await until(async () => (await view('message_acts', { topic_id: topic })).items.find(item => item.message_id === message)?.acts?.starred === true, at + ': Core holds the star');
      assert.equal((await view('message_acts', { topic_id: topic })).items.find(item => item.message_id === message).acts.star_revision, 1, `${at}: made once`);
      assert.equal(await p.evaluate("document.getElementById('app-status').hidden"), true, `${at}: the page reached says nothing of it`);
      await p.evaluate('history.back()');
      await arrived(p, '?topic=' + topic, 'Together ' + size, at + ': back');
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(star)})?.textContent === '★'`), at + ': the card shows its star');
      await until(async () => (await review()).includes('Review 1 reply'), at + ': and the reply its Review button');
      assert.equal(await p.evaluate("document.getElementById('app-status').hidden"), true, `${at}: nothing is said of the star`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });
}
