// Skills and tools in the web page (item 17; docs/skills-and-tools.md, section 1): the tool page, the outcome
// page's section with "+ Uses a tool", the rail's list and Topic settings' chips. The words are the server's; a
// pass is never painted without a recorded count, "0 of 0" never, and "Not evaluated yet" never reads as passing.
// The outcomes and tools here are invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDocument } from './targets-dom.mjs';
import { ToolPage, OutcomeTools, ToolsRail, TopicTools, wordParts, usedByWords, wentBackParts, matching, toolHref, FAILED } from '../web/skills.mjs';
import { parseRoute, routeHref, routeKey } from '../web/topic-navigation.mjs';

const drain = () => new Promise(resolve => setImmediate(resolve));
const PASSED = { state: 'passed', passed: 12, total: 12, at_ms: 1763270000000, words: 'Its check passed: 12 of 12' };
const NO_CHECK = { state: 'not_evaluated', passed: null, total: null, at_ms: null, words: 'Not evaluated yet: it has no check' };
const NOT_RUN = { state: 'not_run', passed: null, total: null, at_ms: null, words: 'Its check has not run on this version yet' };

const item = (id, name, more = {}) => ({ tool_id: id, kind: 'tool', name, summary: `${name} does one thing`, check: { path: `tests/test_${id}.py` },
  home: { workspace_id: 'kites', title: 'Kite club', readable: true }, word: PASSED, ...more });

function toolAnswer(more = {}) {
  return {
    instance_id: 'i',
    tool: { ...item('spool', 'Spool winder'), record_path: 'skills/spool.json', content_id: 'c1',
      files: [{ path: 'tools/spool.py', check: false }, { path: 'tests/test_spool.py', check: true }] },
    went_back: { items: [], next_cursor: null }, used_by: [], used_by_hidden: 0, topics: [], topics_hidden: 0, reader_may_link: true, ...more,
  };
}

function harness(t, answers, { refuse = null } = {}) {
  const dom = installDocument(t);
  const sent = [], reads = [], opened = [];
  const read = async (name, args) => { reads.push([name, args]); const answer = answers[name]; if (answer instanceof Error) throw answer; return typeof answer === 'function' ? answer(args) : answer; };
  const send = async (kind, target, args) => { sent.push({ kind, target, args }); return refuse ? { status: 'rejected', error: { message: refuse } } : { status: 'committed', result: {} }; };
  const open = (target, title) => opened.push([target, title]);
  return { dom, sent, reads, opened, read, send, open, doc: dom.document };
}

// Each selector inside the ones before it (the small document knows one simple selector at a time).
const all = (node, ...selectors) => selectors.reduce((found, selector) => found.flatMap(each => each.querySelectorAll(selector)), [node]);
const texts = (node, ...selectors) => all(node, ...selectors).map(each => each.textContent);
const key = (field, name) => field.dispatch('keydown', { key: name, isComposing: false, repeat: false, stopPropagation() {} });
const type = (field, words) => { field.value = words; field.dispatch('input'); };

test('a pass shows its count and time; anything that is not a counted pass is never painted as one', () => {
  assert.deepEqual(wordParts(PASSED), ['Its check passed: 12 of 12', ' · ', { ms: 1763270000000 }]);
  assert.deepEqual(wordParts(NO_CHECK), ['Not evaluated yet: it has no check'], 'no check: no time, no pass');
  assert.deepEqual(wordParts(NOT_RUN), ['Its check has not run on this version yet']);
  for (const bad of [{ ...PASSED, total: 0, passed: 0 }, { ...PASSED, total: null }, { ...PASSED, passed: 11 }, { ...PASSED, at_ms: null },
    { ...NO_CHECK, words: 'Its check passed: 0 of 0' }, { ...NO_CHECK, state: 'passing' }, { ...NO_CHECK, words: '' }, null])
    assert.throws(() => wordParts(bad), { message: FAILED }, JSON.stringify(bad));
});

test('Used by names the outcomes the reader can open and counts the rest; with none it says so', () => {
  assert.deepEqual(usedByWords([{ title: 'Kite club' }], 2), { names: ['Kite club'], more: 'and 2 outcomes you cannot open', none: null });
  assert.deepEqual(usedByWords([], 1), { names: [], more: '1 outcome you cannot open', none: null });
  assert.deepEqual(usedByWords([], 0), { names: [], more: null, none: 'No outcome says it uses this yet.' });
  assert.throws(() => usedByWords([], -1), { message: FAILED });
});

test('a version that went back reads as one sentence after its time', () => {
  assert.deepEqual(wentBackParts({ recorded_ms: 5, words: 'A new version failed its check (3 of 42 failed: test_a) and went back to its live version' }),
    [{ ms: 5 }, ': ', 'a new version failed its check (3 of 42 failed: test_a) and went back to its live version', '.']);
  assert.throws(() => wentBackParts({ recorded_ms: null, words: 'x' }), { message: FAILED });
});

test('a finder line keeps the choices whose names hold every typed word, and drops the others', () => {
  const tools = [{ name: 'Spool winder' }, { name: 'Kite guide' }, { name: 'Wind meter' }];
  assert.deepEqual(matching(tools, 'win').map(tool => tool.name), ['Spool winder', 'Wind meter']);
  assert.deepEqual(matching(tools, 'spool WIN').map(tool => tool.name), ['Spool winder']);
  assert.deepEqual(matching(tools, 'tail'), []);
  assert.equal(matching(tools, '  ').length, 3);
});

test('a tool page has its own address in its home outcome, and the address reads back to it', () => {
  const parsed = href => { try { return parseRoute(new URL(href)); } catch (error) { return error.message; } };
  const route = parsed('https://x/?workspace=kites&tool=spool');
  assert.deepEqual(route, { kind: 'tool', id: 'kites', tool: 'spool' });
  assert.equal(routeHref(route), '?workspace=kites&tool=spool');
  assert.equal(toolHref('kites', 'spool'), '?workspace=kites&tool=spool');
  assert.notEqual(routeKey(route), routeKey({ kind: 'tool', id: 'kites', tool: 'reel' }), 'two tools are two places');
  assert.deepEqual(parseRoute(new URL('https://x/?workspace=kites')), { kind: 'workspace', id: 'kites' }, 'the outcome alone is still its page');
  assert.throws(() => parseRoute(new URL('https://x/?workspace=kites&tool=spool&topic=t1')), 'a third key is not a place');
});

test('the tool page: kind, name and summary at the top, then Home, Its check, Used by, Topics about it and the files, folded', async t => {
  const h = harness(t, { tool: toolAnswer({ used_by: [{ workspace_id: 'wind', title: 'Wind watch' }], used_by_hidden: 1,
    topics: [{ topic_id: 't1', title: 'Faster spools', workspace_id: 'kites', state: 'waiting', reader_may_unlink: true }], topics_hidden: 2 }) });
  const header = { eyebrow: h.dom.host(), title: h.dom.host(), description: h.dom.host() };
  const host = h.dom.host();
  const page = new ToolPage({ host, header, toolId: 'spool', instanceId: 'i', read: h.read, send: h.send, open: h.open, doc: h.doc });
  assert.equal(await page.load(), true);
  assert.deepEqual([header.eyebrow.textContent, header.title.textContent, header.description.textContent], ['Tool', 'Spool winder', 'Spool winder does one thing']);
  const lines = texts(host, '.tool-line');
  assert.equal(lines[0], 'Home: Kite club');
  assert.match(lines[1], /^Its check passed: 12 of 12 · .+/, 'the pass with its count and its time');
  assert.equal(lines[2], 'Used by: Wind watch and 1 outcome you cannot open');
  assert.deepEqual(h.reads[0], ['tool', { tool_id: 'spool', limit: 5 }], 'five went-back versions at a time');
  assert.equal(host.querySelector('.tool-went-back'), null, 'Went back shows only when a version went back');
  assert.deepEqual(texts(host, '.tool-topic'), ['Faster spools · Waiting×'], 'each topic with its state and, for a reader who may unlink it, a ×');
  const unlink = host.querySelector('.glyph-button');
  assert.deepEqual([unlink.getAttribute('aria-label'), unlink.title], ['Take Faster spools off this tool', 'Take Faster spools off this tool'], 'the × has a name and a tooltip');
  assert.ok(texts(host, 'p').includes('and 2 topics you cannot open'), 'topics the reader cannot read are counted, never named');
  const files = host.querySelector('.tool-files');
  assert.equal(files.open, false, 'the files are folded');
  assert.deepEqual(texts(files, 'li'), ['skills/spool.json · its record', 'tools/spool.py', 'tests/test_spool.py · its check']);
  all(host, '.tool-line', 'a')[0].click();
  assert.deepEqual(h.opened.pop(), [{ kind: 'workspace', id: 'kites' }, 'Kite club'], 'Home opens the home outcome through the page');
});

test('a tool with no check reads "Not evaluated yet" on its page, never a pass, and a reader outside its home sees no Link a topic', async t => {
  const answer = toolAnswer({ reader_may_link: false });
  answer.tool = { ...answer.tool, word: NO_CHECK, check: null, home: { workspace_id: 'kites', title: 'kites', readable: false } };
  const h = harness(t, { tool: answer });
  const host = h.dom.host();
  const page = new ToolPage({ host, header: { eyebrow: h.dom.host(), title: h.dom.host(), description: h.dom.host() }, toolId: 'spool', instanceId: 'i', read: h.read, send: h.send, open: h.open, doc: h.doc });
  await page.load();
  const lines = texts(host, '.tool-line');
  assert.deepEqual(lines.slice(0, 3), ['Home: an outcome you are not on', 'Not evaluated yet: it has no check', 'Used by: No outcome says it uses this yet.']);
  assert.ok(!/passed|0 of 0|not run/.test(lines[1]));
  assert.equal(host.querySelector('.finder-open'), null, 'no Link a topic');
  assert.ok(texts(host, 'p').includes('No topics about it yet.'));
});

test('Went back lists the versions newest first with their topics, and More asks for five more', async t => {
  const back = n => ({ recorded_ms: 1000 + n, words: `A new version failed its check (1 of 9 failed: test_${n}) and went back to its live version`, topic: { topic_id: `b${n}`, title: 'Spool winder went back to its live version' } });
  let limit = 0;
  const h = harness(t, { tool: args => { limit = args.limit; return toolAnswer({ went_back: { items: [back(2), back(1)].slice(0, args.limit), next_cursor: args.limit < 10 ? 7 : null } }); } });
  const host = h.dom.host();
  const page = new ToolPage({ host, header: { eyebrow: h.dom.host(), title: h.dom.host(), description: h.dom.host() }, toolId: 'spool', instanceId: 'i', read: h.read, send: h.send, open: h.open, doc: h.doc });
  await page.load();
  const lines = texts(host, '.tool-went-back', 'li');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^.+: a new version failed its check \(1 of 9 failed: test_2\) and went back to its live version\. Topic: Spool winder went back to its live version\.$/);
  const more = host.querySelectorAll('button').find(button => button.textContent === 'More');
  assert.ok(more, 'More while there are more');
  await more.onclick();
  assert.equal(limit, 10, 'five more');
  assert.equal(host.querySelectorAll('button').find(button => button.textContent === 'More'), undefined, 'no More once there are no more');
});

test('Link a topic: one line; typing finds an open topic of the home, Return links it, Escape leaves everything as it was', async t => {
  const topics = [{ id: 't1', title: 'Faster spools', kind: 'topic' }, { id: 't2', title: 'Tangled lines', kind: 'topic' }, { id: 't3', title: 'Spool colours', kind: 'topic' }];
  let linked = [];
  const h = harness(t, {
    tool: () => toolAnswer({ topics: linked.map(id => ({ topic_id: id, title: topics.find(topic => topic.id === id).title, workspace_id: 'kites', state: 'active', reader_may_unlink: true })) }),
    workspace_topics: args => ({ items: args.cursor ? [topics[2]] : topics.slice(0, 2), next_cursor: args.cursor ? null : 'c2' }),
  });
  const host = h.dom.host();
  const page = new ToolPage({ host, header: { eyebrow: h.dom.host(), title: h.dom.host(), description: h.dom.host() }, toolId: 'spool', instanceId: 'i', read: h.read, send: h.send, open: h.open, doc: h.doc });
  await page.load();
  const button = host.querySelector('.finder-open');
  assert.equal(button.textContent, 'Link a topic');
  const line = host.querySelector('.finder');
  assert.equal(line.hidden, true, 'closed until pressed');
  // Escape: the line closes, nothing is sent, the focus is back on the button.
  await button.onclick(); await drain();
  const input = host.querySelector('.finder-input');
  assert.equal(h.doc.activeElement, input, 'the line takes the focus');
  type(input, 'spool');
  key(input, 'Escape');
  assert.deepEqual([line.hidden, h.sent.length, h.doc.activeElement], [true, 0, button]);
  // Return links the first match, across both pages of the outcome's topics.
  await button.onclick(); await drain();
  assert.deepEqual(h.reads.filter(([name]) => name === 'workspace_topics').map(([, args]) => args), [{ workspace_id: 'kites', cursor: '' }, { workspace_id: 'kites', cursor: 'c2' }, { workspace_id: 'kites', cursor: '' }, { workspace_id: 'kites', cursor: 'c2' }]);
  type(input, 'colours');
  assert.deepEqual(texts(host, '.finder-option'), ['Spool colours'], 'only what matches');
  linked = ['t3'];
  key(input, 'Enter'); await drain(); await drain();
  assert.deepEqual(h.sent, [{ kind: 'tool.link', target: { topic_id: 't3' }, args: { tool_id: 'spool', linked: true } }]);
  assert.deepEqual(texts(host, '.tool-topic', 'a'), ['Spool colours'], 'the topic is listed');
  assert.equal(host.querySelector('.finder').hidden, true, 'and the line has closed');
  // A linked topic is not offered again.
  await host.querySelector('.finder-open').onclick(); await drain();
  assert.ok(!texts(host, '.finder-option').includes('Spool colours'));
});

test('a refused link says why in the server\'s words and keeps the line open with what was typed', async t => {
  const h = harness(t, { tool: toolAnswer(), workspace_topics: { items: [{ id: 't1', title: 'Faster spools', kind: 'topic' }], next_cursor: null } },
    { refuse: 'Kite club was reached on Sun 15 Nov; its topics are kept to read.' });
  const host = h.dom.host();
  const page = new ToolPage({ host, header: { eyebrow: h.dom.host(), title: h.dom.host(), description: h.dom.host() }, toolId: 'spool', instanceId: 'i', read: h.read, send: h.send, open: h.open, doc: h.doc });
  await page.load();
  await host.querySelector('.finder-open').onclick(); await drain();
  const input = host.querySelector('.finder-input');
  type(input, 'faster');
  key(input, 'Enter'); await drain();
  assert.equal(host.querySelector('.finder').hidden, false);
  assert.equal(input.value, 'faster');
  assert.ok(texts(host, '.finder', 'p').includes('Kite club was reached on Sun 15 Nov; its topics are kept to read.'));
});

test('× takes a topic off, and the focus goes to Link a topic', async t => {
  let linked = true;
  const h = harness(t, { tool: () => toolAnswer({ topics: linked ? [{ topic_id: 't1', title: 'Faster spools', workspace_id: 'kites', state: 'active', reader_may_unlink: true }] : [] }) });
  const host = h.dom.host();
  const page = new ToolPage({ host, header: { eyebrow: h.dom.host(), title: h.dom.host(), description: h.dom.host() }, toolId: 'spool', instanceId: 'i', read: h.read, send: h.send, open: h.open, doc: h.doc });
  await page.load();
  const unlink = host.querySelector('.glyph-button');
  unlink.focus();
  linked = false;
  await page.unlink(page.answer.topics[0]);
  assert.deepEqual(h.sent, [{ kind: 'tool.link', target: { topic_id: 't1' }, args: { tool_id: 'spool', linked: false } }]);
  assert.equal(host.querySelector('.tool-topic'), null);
  assert.equal(h.doc.activeElement, host.querySelector('.finder-open'));
});

const toolsAnswer = (more = {}) => ({ instance_id: 'i', workspace_id: 'kites', own: [], used: [], reader_may_use: true, offer: [], ...more });

test('the outcome page: its own tools, then Used here with ×, and + Uses a tool for a reader who can write in it', async t => {
  let used = [];
  const offer = [{ tool_id: 'meter', kind: 'tool', name: 'Wind meter' }, { tool_id: 'guide', kind: 'skill', name: 'Knot guide' }];
  const h = harness(t, { tools: () => toolsAnswer({ own: [item('spool', 'Spool winder', { word: NO_CHECK, kind: 'skill' })],
    used: used.map(id => item(id, offer.find(tool => tool.tool_id === id).name, { home: { workspace_id: 'wind', title: 'Wind watch', readable: true }, word: NOT_RUN })),
    offer: offer.filter(tool => !used.includes(tool.tool_id)) }) });
  const host = h.dom.host();
  const tools = new OutcomeTools({ host, workspace: 'kites', instanceId: 'i', read: h.read, send: h.send, open: h.open, doc: h.doc });
  assert.equal(await tools.load(), true);
  assert.equal(host.hidden, false);
  assert.deepEqual(texts(host, '.tool-row'), ['Spool winder · SkillNot evaluated yet: it has no check']);
  assert.equal(host.querySelector('h3'), null, 'no Used here before one is said');
  await host.querySelector('.finder-open').onclick(); await drain();
  const input = host.querySelector('.finder-input');
  assert.deepEqual(texts(host, '.finder-option'), ['Wind meter', 'Knot guide'], 'the tools homed elsewhere and not used here');
  type(input, 'meter');
  used = ['meter'];
  key(input, 'Enter'); await drain(); await drain();
  assert.deepEqual(h.sent.pop(), { kind: 'tool.use', target: { workspace_id: 'kites' }, args: { tool_id: 'meter', used: true } });
  assert.deepEqual(texts(host, 'h3'), ['Used here']);
  assert.deepEqual(texts(host, '.tool-row', 'a'), ['Spool winder', 'Wind meter']);
  const off = host.querySelectorAll('.glyph-button');
  assert.equal(off.length, 1, 'only a Used here row has a ×');
  assert.equal(off[0].getAttribute('aria-label'), 'This outcome no longer uses Wind meter');
  used = [];
  await off[0].onclick(); await drain();
  assert.deepEqual(h.sent.pop(), { kind: 'tool.use', target: { workspace_id: 'kites' }, args: { tool_id: 'meter', used: false } });
  assert.equal(host.querySelector('h3'), null);
  all(host, '.tool-row', 'a')[0].click();
  assert.deepEqual(h.opened.pop(), [{ kind: 'tool', id: 'kites', tool: 'spool' }, 'Spool winder'], 'a row opens the tool page');
});

test('the outcome page section is hidden with nothing in it for a reader who cannot add; a reader who cannot write sees no × or + line', async t => {
  const h = harness(t, { tools: toolsAnswer({ reader_may_use: false }) });
  const host = h.dom.host();
  const tools = new OutcomeTools({ host, workspace: 'kites', instanceId: 'i', read: h.read, send: h.send, open: h.open, doc: h.doc });
  await tools.load();
  assert.equal(host.hidden, true);
  const g = harness(t, { tools: toolsAnswer({ reader_may_use: false, used: [item('meter', 'Wind meter', { home: { workspace_id: 'wind', title: 'Wind watch', readable: true } })] }) });
  const other = g.dom.host();
  await new OutcomeTools({ host: other, workspace: 'kites', instanceId: 'i', read: g.read, send: g.send, open: g.open, doc: g.doc }).load();
  assert.equal(other.hidden, false);
  assert.equal(other.querySelector('.glyph-button'), null);
  assert.equal(other.querySelector('.finder-open'), null);
});

test('an outcome that homes and uses nothing shows a writer only its heading and + Uses a tool, and no stray words', async t => {
  const h = harness(t, { tools: toolsAnswer({ own: [], used: [], reader_may_use: true }) });
  const host = h.dom.host();
  await new OutcomeTools({ host, workspace: 'kites', instanceId: 'i', read: h.read, send: h.send, open: h.open, doc: h.doc }).load();
  assert.equal(host.hidden, false);
  assert.equal(host.textContent, 'Skills and tools+ Uses a tool', 'its heading and the quiet line, nothing else');
});

test('the rail lists the same tools by name, each opening its page, the open one marked; hidden when there are none', async t => {
  const h = harness(t, { tools: toolsAnswer({ own: [item('spool', 'Spool winder')], used: [item('meter', 'Wind meter', { home: { workspace_id: 'wind', title: 'Wind watch', readable: true } })] }) });
  const section = h.dom.host(), host = h.dom.host();
  section.hidden = true;
  await new ToolsRail({ section, host, workspace: 'kites', current: 'meter', instanceId: 'i', read: h.read, open: h.open, doc: h.doc }).load();
  assert.equal(section.hidden, false);
  assert.deepEqual(host.children.map(link => [link.textContent, link.href, link.getAttribute('aria-current')]),
    [['Spool winder', '?workspace=kites&tool=spool', null], ['Wind meter', '?workspace=wind&tool=meter', 'page']]);
  const e = harness(t, { tools: toolsAnswer() });
  const empty = e.dom.host();
  await new ToolsRail({ section: empty, host: e.dom.host(), workspace: 'kites', instanceId: 'i', read: e.read, open: e.open, doc: e.doc }).load();
  assert.equal(empty.hidden, true);
});

const topicTools = (more = {}) => ({ instance_id: 'i', topic_id: 't1', linked: [], offered: [], reader_may_link: true, ...more });

test('Topic settings: the home\'s tools as chips; a tap links, a second tap unlinks, each saved at once', async t => {
  let linked = [];
  const offered = [{ tool_id: 'guide', kind: 'skill', name: 'Knot guide' }, { tool_id: 'spool', kind: 'tool', name: 'Spool winder' }];
  const h = harness(t, { topic_tools: () => topicTools({ linked: offered.filter(tool => linked.includes(tool.tool_id)).map(tool => ({ ...tool, home_workspace_id: 'kites', live: true })), offered }) });
  const host = h.dom.host();
  const chips = new TopicTools({ host, topicId: 't1', instanceId: 'i', read: h.read, send: h.send, doc: h.doc });
  await chips.load();
  assert.equal(host.hidden, false);
  assert.deepEqual(texts(host, 'h3'), ['Tools this topic improves']);
  const pressed = () => host.querySelectorAll('.tool-chip').map(chip => [chip.textContent, chip.getAttribute('aria-pressed')]);
  assert.deepEqual(pressed(), [['Knot guide', 'false'], ['Spool winder', 'false']]);
  host.querySelectorAll('.tool-chip')[1].focus();
  linked = ['spool'];
  host.querySelectorAll('.tool-chip')[1].click();
  assert.deepEqual(pressed()[1], ['Spool winder', 'true'], 'shown at once');
  assert.equal(host.querySelectorAll('.tool-chip')[1].getAttribute('aria-disabled'), 'true', 'while it saves');
  assert.equal(h.doc.activeElement, host.querySelectorAll('.tool-chip')[1], 'the chip keeps the focus');
  await drain(); await drain();
  assert.deepEqual(h.sent.pop(), { kind: 'tool.link', target: { topic_id: 't1' }, args: { tool_id: 'spool', linked: true } });
  assert.deepEqual(pressed(), [['Knot guide', 'false'], ['Spool winder', 'true']]);
  assert.equal(host.querySelectorAll('.tool-chip')[1].getAttribute('aria-disabled'), 'false');
  linked = [];
  host.querySelectorAll('.tool-chip')[1].click(); await drain(); await drain();
  assert.deepEqual(h.sent.pop(), { kind: 'tool.link', target: { topic_id: 't1' }, args: { tool_id: 'spool', linked: false } });
  assert.deepEqual(pressed(), [['Knot guide', 'false'], ['Spool winder', 'false']]);
});

test('Topic settings: a refused tap goes back as it was and says why; a tool linked from elsewhere shows so it can be taken off; nothing to show hides the line', async t => {
  const h = harness(t, { topic_tools: topicTools({ offered: [{ tool_id: 'spool', kind: 'tool', name: 'Spool winder' }],
    linked: [{ tool_id: 'meter', kind: 'tool', name: 'Wind meter', home_workspace_id: 'wind', live: true }] }) }, { refuse: 'A topic can be linked to a tool only in the tool\'s home.' });
  const host = h.dom.host();
  // The read after the refusal fails too (offline): the chip still goes back as it was.
  let reads = 0;
  const read = (...args) => (++reads > 1 ? Promise.reject(new Error('offline')) : h.read(...args));
  const chips = new TopicTools({ host, topicId: 't1', instanceId: 'i', read, send: h.send, doc: h.doc });
  await chips.load();
  const pressed = () => host.querySelectorAll('.tool-chip').map(chip => [chip.textContent, chip.getAttribute('aria-pressed')]);
  assert.deepEqual(pressed(), [['Spool winder', 'false'], ['Wind meter', 'true']]);
  host.querySelectorAll('.tool-chip')[0].click(); await drain(); await drain();
  assert.deepEqual(pressed(), [['Spool winder', 'false'], ['Wind meter', 'true']], 'as it was');
  assert.ok(texts(host, '.notice').includes('A topic can be linked to a tool only in the tool\'s home.'));
  const e = harness(t, { topic_tools: topicTools() });
  const empty = e.dom.host();
  await new TopicTools({ host: empty, topicId: 't1', instanceId: 'i', read: e.read, send: e.send, doc: e.doc }).load();
  assert.equal(empty.hidden, true);
  const c = harness(t, { topic_tools: topicTools({ reader_may_link: false, offered: [] }) });
  const conversation = c.dom.host();
  await new TopicTools({ host: conversation, topicId: 't1', instanceId: 'i', read: c.read, send: c.send, doc: c.doc }).load();
  assert.equal(conversation.hidden, true, 'the Conversation has no line');
});

test('an answer for another instance or another tool is not painted', async t => {
  const h = harness(t, { tool: { ...toolAnswer(), instance_id: 'other' } });
  const host = h.dom.host();
  const page = new ToolPage({ host, header: { eyebrow: h.dom.host(), title: h.dom.host(), description: h.dom.host() }, toolId: 'spool', instanceId: 'i', read: h.read, send: h.send, open: h.open, doc: h.doc });
  assert.equal(await page.load(), false);
  assert.deepEqual(texts(host, '.tool-status'), [FAILED]);
  const g = harness(t, { tool: toolAnswer({ tool: { ...toolAnswer().tool, word: { ...PASSED, total: 0, passed: 0, words: 'Its check passed: 0 of 0' } } }) });
  const other = g.dom.host();
  const zero = new ToolPage({ host: other, header: { eyebrow: g.dom.host(), title: g.dom.host(), description: g.dom.host() }, toolId: 'spool', instanceId: 'i', read: g.read, send: g.send, open: g.open, doc: g.doc });
  assert.equal(await zero.load(), false, 'a pass of nothing is refused, not painted');
  assert.ok(!other.textContent.includes('0 of 0'));
});

test('a refused × keeps the topic, says why, and gives the focus back to its ×', async t => {
  const h = harness(t, { tool: toolAnswer({ topics: [{ topic_id: 't1', title: 'Faster spools', workspace_id: 'kites', state: 'active', reader_may_unlink: true }] }) },
    { refuse: 'Kite club was reached on Sun 15 Nov; its topics are kept to read.' });
  const host = h.dom.host();
  const page = new ToolPage({ host, header: { eyebrow: h.dom.host(), title: h.dom.host(), description: h.dom.host() }, toolId: 'spool', instanceId: 'i', read: h.read, send: h.send, open: h.open, doc: h.doc });
  await page.load();
  host.querySelector('.glyph-button').focus();
  await page.unlink(page.answer.topics[0]);
  assert.deepEqual(texts(host, '.tool-topic', 'a'), ['Faster spools']);
  assert.deepEqual(texts(host, '.tool-status'), ['Kite club was reached on Sun 15 Nov; its topics are kept to read.']);
  assert.equal(h.doc.activeElement, host.querySelector('.glyph-button'));
  assert.equal(host.querySelector('.glyph-button').disabled, false);
});
