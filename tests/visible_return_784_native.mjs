// Item 784, Tony9689/9698/9705; source9707 SPEC N1–N7. No forced focus,
// synthetic clicks, or event-handler invocation. Shared by both reading engines.
import assert from 'node:assert/strict';

export const TOLERANCES = Object.freeze({ POSITION_EPS: 2, EDGE_EPS: 1, RING_WIDTH_EPS: .25, TARGET_EPS: .5, STABLE_EPS: .5 });
export const SIZES784 = Object.freeze({ laptop: { width: 1280, height: 900, mobile: false },
  w320: { width: 320, height: 844, mobile: true }, w375: { width: 375, height: 844, mobile: true }, w390: { width: 390, height: 844, mobile: true } });
export const SCENARIOS784 = Object.freeze([
  ['N1', 'arrows outline the exact card and compact dossier head'],
  ['N2', 'physical hover replies to current card dossier and exact passage'],
  ['N3', 'unringed rails open current page pencil including inert overlays'],
  ['N4', 'no outline and offscreen retained outline open pencil in place'],
  ['N5', 'native visible focus rings retain link button and message activation'],
  ['N6', 'writing title dialog menu and modified keys keep ownership'],
  ['N7', 'first touch outlines card and dossier keyboard replies and writing keeps'],
]);
export const cases784 = () => Object.keys(SIZES784).flatMap(size => ['light', 'dark'].flatMap(theme =>
  SCENARIOS784.filter(([id]) => size === 'laptop' ? id !== 'N7' : !['N1', 'N2', 'N5'].includes(id))
    .map(([id, words]) => ({ id, size, theme, name: `reading item 784 ${id} ${size} ${theme}: ${words}; POSITION_EPS=2 EDGE_EPS=1 RING_WIDTH_EPS=0.25 TARGET_EPS=0.5 STABLE_EPS=0.5` }))));

// This same expression is evaluated in each real page and in focused controls.
// A compact head has a zero-height card; the visible ring belongs to its folder.
export function readReturnPaint(selector, doc = document) {
  const el = doc.querySelector(selector), win = doc.defaultView;
  if (!el) return null;
  const rect = e => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
  const box = rect(el), css = win.getComputedStyle(el);
  let clip = { left: Math.max(0, box.left), right: Math.min(win.innerWidth, box.right), top: Math.max(0, box.top), bottom: Math.min(win.innerHeight, box.bottom) };
  let visible = el.isConnected && !el.closest('[hidden], [inert]') && el.getClientRects().length > 0;
  const ancestors = [];
  for (let at = el; at; at = at.parentElement) {
    const style = win.getComputedStyle(at), b = rect(at);
    if (style.display === 'none' || /hidden|collapse/.test(style.visibility) || Number(style.opacity) === 0) visible = false;
    if (at !== el) {
      if (/^(hidden|clip|auto|scroll|overlay)$/.test(style.overflowX)) { clip.left = Math.max(clip.left, b.left); clip.right = Math.min(clip.right, b.right); }
      if (/^(hidden|clip|auto|scroll|overlay)$/.test(style.overflowY)) { clip.top = Math.max(clip.top, b.top); clip.bottom = Math.min(clip.bottom, b.bottom); }
    }
    if (ancestors.length < 8) ancestors.push({ tag: at.tagName, id: at.id, box: b, overflowX: style.overflowX, overflowY: style.overflowY, opacity: style.opacity });
  }
  visible = Boolean(visible && clip.right > clip.left && clip.bottom > clip.top);
  const focus = doc.activeElement;
  return { selector, box, clip, visible, ancestors, viewport: { width: win.innerWidth, height: win.innerHeight },
    outline: { style: css.outlineStyle, width: parseFloat(css.outlineWidth), color: css.outlineColor, offset: css.outlineOffset },
    shadow: css.boxShadow, tabShadow: css.getPropertyValue('--stack-tab-shadow'),
    focusVisible: el.matches(':focus-visible'), lit: el.classList.contains('lit'),
    focus: { tag: focus?.tagName, id: focus?.id, className: focus?.className, message: focus?.closest('[data-id]')?.dataset.id },
    hit: el.contains(doc.elementFromPoint((clip.left + clip.right) / 2, (clip.top + clip.bottom) / 2)) };
}

export function ringWidths(state) {
  if (!state) return [];
  const widths = state.outline.style !== 'none' && !/rgba\([^)]*,\s*0\)$|transparent/.test(state.outline.color) ? [state.outline.width] : [];
  // Computed shadows: ignore the blurred lift; outer zero-blur spreads paint rings.
  for (const part of state.shadow.split(/,(?![^()]*\))/)) {
    const numbers = [...part.replace(/rgba?\([^)]*\)/g, '').matchAll(/(-?[\d.]+)px/g)].map(m => Number(m[1]));
    if (!part.includes('inset') && numbers.length >= 4 && numbers[2] === 0 && numbers[3] > 0 && !/rgba\([^)]*,\s*0\)/.test(part)) widths.push(numbers[3]);
  }
  return widths;
}
export function assertPaint(state, kind = 'message') {
  const { EDGE_EPS, RING_WIDTH_EPS } = TOLERANCES;
  assert.ok(state?.visible, `${kind}: actually visible through viewport/ancestor clipping (EDGE_EPS=1): ${JSON.stringify(state)}`);
  assert.ok(state.clip.right - state.clip.left > EDGE_EPS && state.clip.bottom - state.clip.top > EDGE_EPS, `${kind}: more than EDGE_EPS=1 visible CSS px`);
  const expected = kind === 'dossier' ? [4] : [2];
  if (kind === 'control') assert.equal(state.focusVisible, true, 'control actually owns native focus-visible');
  assert.ok(ringWidths(state).some(width => expected.some(want => Math.abs(width - want) <= RING_WIDTH_EPS)),
    `${kind}: actual CSS ring within RING_WIDTH_EPS=0.25 of ${expected}px: ${JSON.stringify(state)}`);
}
export function assertStable(before, after) {
  for (const key of ['left', 'top', 'width', 'height']) assert.ok(Math.abs(before[key] - after[key]) <= TOLERANCES.STABLE_EPS, `${key}: STABLE_EPS=0.5 CSS px`);
}
export function assertInPlace(before, after) {
  assert.deepEqual(after, before, 'address, history length, topic and document identity stay exact');
}

const HEARD784 = `(()=>{window.item784={document:crypto.randomUUID(),sources:[],commands:[],clicks:[],keys:[]};const raw=window.fetch;
window.fetch=function(input,init){let body;try{body=JSON.parse(init?.body??'null')}catch{}const answer=raw.call(this,input,init);
if(body?.kind)window.item784.commands.push({kind:body.kind});
if(body?.name==='source')answer.then(r=>r.clone().json()).then(r=>window.item784.sources.push({requested:body.args,source:r.source_ref}),()=>{});
return answer};addEventListener('click',e=>window.item784.clicks.push({id:e.target.closest('button,a')?.id,act:e.target.closest('[data-act],[data-tool]')?.dataset.act??e.target.closest('[data-tool]')?.dataset.tool}),true);
addEventListener('keydown',e=>window.item784.keys.push({key:e.key,composing:e.isComposing,target:e.target.id}),true)})()`;
const card784 = id => `#messages .message-card[data-id="${id}"]`;
const stack784 = id => `#messages .reply-stack[data-stack="${id}"]`;
const q = JSON.stringify;

export async function visibleReturn784Checks({ check, page, until, control, shot, facts, observations, engine = 'chrome' }, { seed }) {
  const read = (p, selector) => p.evaluate(`(${readReturnPaint.toString()})(${q(selector)})`);
  const state = p => p.evaluate(`({href:location.href,history:history.length,title:document.querySelector('#topic-title')?.textContent,document:window.item784.document})`);
  const snapshot = p => p.evaluate(`({url:location.href,history:history.length,active:{id:document.activeElement?.id,tag:document.activeElement?.tagName,className:document.activeElement?.className},lit:[...document.querySelectorAll('#messages .lit[data-id]')].map(e=>e.dataset.id),sheet:document.querySelector('#new-message-sheet')?.open,reader:document.querySelector('#reader')?.open,rename:Boolean(document.querySelector('.stack-rename-input')),inert:document.querySelector('#main')?.inert,drawer:document.querySelector('#rail')?.classList.contains('open'),panel:document.documentElement.hasAttribute('data-things-open'),instrument:window.item784})`);
  // All aiming uses measured tolerances, native pointer/touch input, and hit tests.
  const aim = async (p, selector, kind = 'click') => {
    await p.evaluate(`document.querySelector(${q(selector)})?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`);
    let previous;
    const stableBox = await until(async () => {
      const current = await p.evaluate(`(()=>{const e=document.querySelector(${q(selector)});if(!e)return null;const b=e.getBoundingClientRect();return {left:b.left,top:b.top,width:b.width,height:b.height}})()`);
      if (!current) return false;
      const before = previous;
      const stable = before && ['left', 'top', 'width', 'height'].every(k => Math.abs(current[k] - before[k]) <= TOLERANCES.STABLE_EPS);
      previous = current; return stable && { before, after: current };
    }, `${selector}: STABLE_EPS=0.5 before native input`);
    assertStable(stableBox.before, stableBox.after);
    const box = stableBox.after;
    const x = box.left + Math.min(12, box.width / 2), y = box.top + Math.min(12, box.height / 2);
    const hit = await p.evaluate(`(()=>{const e=document.querySelector(${q(selector)});return {hit:e.contains(document.elementFromPoint(${x},${y})),width:innerWidth,height:innerHeight}})()`);
    assert.ok(x >= -TOLERANCES.EDGE_EPS && x <= hit.width + TOLERANCES.EDGE_EPS && y >= -TOLERANCES.EDGE_EPS && y <= hit.height + TOLERANCES.EDGE_EPS, 'native input within viewport EDGE_EPS=1');
    assert.ok(hit.hit, `${selector}: native input hits the intended visible element`);
    if (kind === 'tap') {
      await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      if (kind === 'click') {
        await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      }
    }
  };
  const keysTo = async (p, id) => {
    for (let n = 0; n < 45; n++) {
      const direction = await p.evaluate(`(()=>{const e=document.activeElement,to=document.querySelector(${q(card784(id))}),from=e?.matches('.stack-toggle')?e.parentElement:e?.closest('#messages [data-id]');
        if(from?.dataset.id===${q(id)}||e?.matches('.stack-toggle')&&e.parentElement.dataset.stack===${q(id)})return 'there';
        if(!from)return 'ArrowDown';return from.compareDocumentPosition(to)&Node.DOCUMENT_POSITION_FOLLOWING?'ArrowDown':'ArrowUp'})()`);
      if (direction === 'there') return;
      await p.key(direction);
    }
    assert.fail(`native arrows never reached ${id}`);
  };
  const tabTo = async (p, selector) => {
    for (let n = 0; n < 100; n++) {
      if (await p.evaluate(`document.activeElement?.matches(${q(selector)})`)) return;
      await p.key('Tab');
    }
    assert.fail(`native Tab never reached ${selector}`);
  };
  for (const spec of cases784()) await check(spec.name, async () => {
    const { size, theme, id: scenario } = spec, metrics = SIZES784[size], phone = metrics.mobile;
    const slug = `reading-784-${scenario}-${size}-${theme}`, topic = slug + '-a', otherTopic = slug + '-b';
    const bodies = { head: `Dossier head ${slug}.`, a: `Exact source A ${slug}.`, b: `Exact source B ${slug}.`, reply: `Dossier reply ${slug}.` };
    const ids = await seed(topic, [
      ['head', { sender: 'aim-core', join: true, addressees: [facts.actor], body: bodies.head, read: true }],
      ['reply', { sender: 'aim-ux', join: true, reply_to: 'head', addressees: [facts.actor], body: bodies.reply, read: true }],
      ['a', { sender: 'aim-core', addressees: [facts.actor], body: bodies.a, read: true }],
      ['b', { sender: 'aim-ux', addressees: [facts.actor], body: bodies.b, read: true }],
      ...(scenario === 'N4' ? Array.from({length:12},(_,n)=>['filler'+n,{sender:'aim-core',addressees:[facts.actor],body:'Offscreen fixture card '+n,read:true}]) : []),
    ]);
    await control({ method: 'navigation_topics', topics: [{ id: otherTopic, title: `Other ${slug}` }] });
    const p = await page(slug, null, true, { url: facts.origin + '/?topic=' + topic, beforeNavigate: async pg => {
      await pg.send('Page.addScriptToEvaluateOnNewDocument', { source: HEARD784 });
      await pg.send('Emulation.setDeviceMetricsOverride', { ...metrics, deviceScaleFactor: 1 });
      if (phone) await pg.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    } });
    let primary, captureSequence = 0;
    const record = async label => {
      observations.push({ name: 'item 784 native state', case: spec.name, label, engine, tolerances: TOLERANCES, state: await snapshot(p) });
      await shot(p, `${slug}-${++captureSequence}-${label}`);
    };
    const paint = async (selector, kind, label) => {
      const painted = await read(p, selector);
      observations.push({ name: 'item 784 computed paint', case: spec.name, label, engine, tolerances: TOLERANCES, painted });
      assertPaint(painted, kind);
      await record(label);
    };
    const press = selector => aim(p, selector, phone ? 'tap' : 'click');
    const closeReader = async () => { await press('#reader-close'); await until(() => p.evaluate(`!document.querySelector('#reader').open`), 'Reader closed by native control'); };
    const closeSheet = async () => { await press('#new-message-close'); await until(() => p.evaluate(`!document.querySelector('#new-message-sheet').open`), 'sheet closed by native control'); };
    const sheet = async before => {
      await until(() => p.evaluate(`document.querySelector('#new-message-sheet').open && document.activeElement?.id==='inline-writing-body'`), 'pencil sheet open with usable writing focus');
      assertInPlace(before, await state(p));
      assert.equal(await p.evaluate(`document.querySelector('#reader').open`), false, 'no reply Reader');
      assert.equal(await p.evaluate(`document.querySelector('#main').inert`), false, 'writing page no longer inert');
      await record('sheet');
    };
    const reply = async name => {
      await until(() => p.evaluate(`document.querySelector('#reader').open && document.activeElement?.id==='writing-body'`), 'exact source Reader reply has writing focus');
      await until(() => p.evaluate(`window.item784.sources.some(r=>r.source?.id===${q(ids[name])})`), 'observed source response identity');
      const actual = await p.evaluate(`({source:window.item784.sources.at(-1),body:document.querySelector('#source-body').textContent,rename:Boolean(document.querySelector('.stack-rename-input')),sheet:document.querySelector('#new-message-sheet').open})`);
      assert.equal(actual.source.requested.id, ids[name], 'native Return requests exact intended source');
      assert.equal(actual.source.source.id, ids[name], 'Core response is exact intended source');
      assert.equal(actual.body.trim(), bodies[name], 'Reader paints exact source body');
      assert.equal(actual.rename, false, 'Return edits no dossier title');
      assert.equal(actual.sheet, false, 'outlined Return opens reply, not New message');
      await record('reply-' + name);
    };
    const newMessage = async () => { await press('#topic-title'); const before = await state(p); await p.key('Enter'); await sheet(before); };
    try {
      await until(() => p.evaluate(`document.body.dataset.ready==='true' && Boolean(document.querySelector(${q(card784(ids.b))}))`), 'own fixture page ready');
      const baseline = await state(p);
      if (scenario === 'N1') {
        await press('#topic-title');
        for (const name of ['a', 'head']) {
          await keysTo(p, ids[name]);
          await paint(name === 'head' ? stack784(ids.head) : card784(ids[name]), name === 'head' ? 'dossier' : 'message', 'selected-' + name);
          await p.key('Enter'); await reply(name); await closeReader();
        }
        // Native title-bar Reply is the same dossier head target.
        await aim(p, stack784(ids.head) + ' [data-tool="reply"]'); await reply('head');
      } else if (scenario === 'N2') {
        for (const hovered of ['a', 'b', 'head', 'chevron']) {
          const name = hovered === 'chevron' ? 'head' : hovered;
          const target = hovered === 'chevron' ? stack784(ids.head) + ' > .stack-toggle' : card784(ids[name]) + (name === 'head' ? ' > .stack-head .stack-who' : ' > .message-author');
          await aim(p, target, 'move');
          await until(() => p.evaluate(`document.querySelector(${q(card784(ids[name]))}).classList.contains('lit')`), 'actual pointer outlines current target');
          await paint(name === 'head' ? stack784(ids.head) : card784(ids[name]), name === 'head' ? 'dossier' : 'message', 'hover-' + hovered);
          await p.key('Enter'); await reply(name); await closeReader();
        }
        await aim(p, card784(ids.a) + ' > .message-preview', 'move');
        await until(() => p.evaluate(`Boolean(CSS.highlights.get('lit-passage')?.size)`), 'native hover lights exact passage');
        const passage = await p.evaluate(`[...CSS.highlights.get('lit-passage')][0].toString()`);
        await paint(card784(ids.a), 'message', 'passage');
        await p.key('Enter'); await reply('a');
        assert.equal(await p.evaluate(`document.querySelector('#writing-body').value`), `> ${passage}\n\n`, 'exact visibly lit passage quoted');
      } else if (scenario === 'N3') {
        if (phone) {
          // Drawer opening moves focus through the product's native handler.
          await press('#rail-open');
          assert.equal(await p.evaluate(`document.querySelector('#main').inert`), true, 'left drawer makes feed inert');
        }
        const link = `#rail a[data-topic-id="${otherTopic}"]`;
        await aim(p, link, 'move');
        const railFocus = await p.evaluate(`(()=>{const e=document.activeElement,s=getComputedStyle(e);return {visible:e.matches(':focus-visible'),style:s.outlineStyle,width:s.outlineWidth}})()`);
        observations.push({ name: 'item 784 unringed rail focus', case: spec.name, railFocus });
        assert.ok(!railFocus.visible || railFocus.style === 'none' || parseFloat(railFocus.width) <= TOLERANCES.RING_WIDTH_EPS, 'hovered/stale rail focus has no visible control ring RING_WIDTH_EPS=0.25');
        await record('rail-before'); await p.key('Enter'); await sheet(baseline); await closeSheet();
        if (phone) {
          await press('#things-open');
          assert.equal(await p.evaluate(`document.querySelector('#main').inert`), true, 'right panel makes feed inert');
          // Native pointer press on panel blank heading removes its ringed Close
          // ownership without invoking another action or manufacturing focus.
          await press('#things h2');
          await record('right-panel-before'); await p.key('Enter'); await sheet(baseline);
          assert.equal(await p.evaluate(`document.documentElement.hasAttribute('data-things-open')`), false, 'New message leaves covering right panel');
        } else {
          await press('#things-heading');
          await aim(p, '#things .things-name', 'move');
          await record('right-rail-before'); await p.key('Enter'); await sheet(baseline); await closeSheet();
          // A native arrow onto a card suppresses retained rail/header rings.
          await press('#topic-title'); await keysTo(p, ids.b);
          await paint(card784(ids.b), 'message', 'suppressed-rail');
          await p.key('Enter'); await reply('b');
        }
      } else if (scenario === 'N4') {
        await newMessage(); await closeSheet();
        await press('#topic-title'); await keysTo(p, ids.head);
        // Geometry preparation only: retain actual native selection, scroll it
        // out of viewport without another pointer movement or forced focus.
        await p.evaluate(`scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'})`);
        const stale = await read(p, stack784(ids.head));
        observations.push({ name: 'item 784 clipped retained selection', case: spec.name, stale });
        assert.equal(stale.visible, false, 'old outline wholly clipped/offscreen before Return');
        await record('offscreen-before'); await p.key('Enter'); await sheet(baseline);
      } else if (scenario === 'N5') {
        await press('#topic-title'); await tabTo(p, '#new-message');
        await paint('#new-message', 'control', 'ringed-header');
        const clicks = await p.evaluate(`window.item784.clicks.filter(e=>e.id==='new-message').length`);
        await p.key('Enter'); await sheet(baseline);
        assert.equal(await p.evaluate(`window.item784.clicks.filter(e=>e.id==='new-message').length`), clicks + 1, 'ringed header button activates natively exactly once');
        await closeSheet(); await press('#topic-title'); await keysTo(p, ids.b);
        await tabTo(p, '.message-bar button[data-act="more"]');
        await paint('.message-bar button[data-act="more"]', 'control', 'ringed-message-control');
        const more = await p.evaluate(`window.item784.clicks.filter(e=>e.act==='more').length`);
        await p.key('Enter');
        await until(() => p.evaluate(`Boolean(document.querySelector('[role="menu"]'))`), 'ringed message control opens its native menu');
        assert.equal(await p.evaluate(`window.item784.clicks.filter(e=>e.act==='more').length`), more + 1, 'ringed message control activates once');
        assert.equal(await p.evaluate(`document.querySelector('#reader').open`), false, 'control ring prevents reply takeover');
        await record('menu-owned'); await p.key('Escape'); await press('#topic-title');
        const link = `#rail a[data-topic-id="${otherTopic}"]`;
        await tabTo(p, link); await paint(link, 'control', 'ringed-link');
        await p.key('Enter');
        await until(() => p.evaluate(`new URL(location.href).searchParams.get('topic')===${q(otherTopic)}`), 'ringed link activates normally');
        await record('link-activated');
      } else if (scenario === 'N6') {
        await newMessage();
        if (engine === 'chrome') {
          // CDP's renderer IME input, followed by the driver's native Return.
          // No JS composition event or handler invocation stands in for it.
          await p.send('Input.imeSetComposition', { text: '候補', selectionStart: 2, selectionEnd: 2 });
          await p.key('Enter');
          assert.equal(await p.evaluate(`window.item784.keys.some(e=>e.key==='Enter'&&e.composing)`), true, 'native IME instrument delivered composing Return');
          assert.equal(await p.evaluate(`document.activeElement?.id`), 'inline-writing-body', 'composing Return stays in writing');
          assert.equal(await p.evaluate(`document.querySelector('#reader').open`), false, 'composing Return opens no reply');
          await record('native-ime');
          await p.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
          await p.key('a', 4); await p.key('Backspace');
        }
        await p.send('Input.insertText', { text: 'Alpha' }); await p.key('Enter');
        const writing = await p.evaluate(`({text:document.activeElement.value,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd,id:document.activeElement.id})`);
        assert.deepEqual(writing, { text: 'Alpha\n', start: 6, end: 6, id: 'inline-writing-body' }, 'native textarea newline and caret stay owned');
        await press('#inline-who-chip'); await record('dialog-before');
        await p.key('Enter');
        assert.equal(await p.evaluate(`document.querySelector('#reader').open`), false, 'dialog Return opens no reply');
        await press('#inline-who-done'); await closeSheet();
        await press('#topic-title'); await keysTo(p, ids.b); await p.key('Enter'); await reply('b');
        await p.send('Input.insertText', { text: 'Alpha' }); await p.key('Enter');
        assert.equal(await p.evaluate(`document.querySelector('#writing-body').value`), 'Alpha\n', 'Reader writing Return inserts newline');
        await closeReader();
        await press('#topic-title'); await keysTo(p, ids.a);
        await tabTo(p, '.message-bar button[data-act="more"]'); await p.key('Enter');
        await until(() => p.evaluate(`Boolean(document.querySelector('[role="menu"]'))`), 'message menu owns native focus');
        await p.key('ArrowDown'); await record('menu-before');
        assert.equal(await p.evaluate(`Boolean(document.activeElement?.closest('[role="menu"]'))`), true, 'menu arrow keeps ownership');
        for (let n = 0; n < 20 && !await p.evaluate(`document.activeElement?.textContent.startsWith('Mark unread')`); n++) await p.key('ArrowDown');
        assert.equal(await p.evaluate(`document.activeElement?.textContent.startsWith('Mark unread')`), true, 'native menu keys reach Mark unread');
        await p.key('Enter');
        await until(() => p.evaluate(`!document.querySelector('[role="menu"]')`), 'menu Return activates its own item');
        assert.equal(await p.evaluate(`document.querySelector('#reader').open || document.querySelector('#new-message-sheet').open`), false, 'menu Return opens no reply or sheet');
        const pen = stack784(ids.head) + (phone ? ' .stack-name' : ' .stack-pen');
        await press(pen);
        await until(() => p.evaluate(`document.activeElement?.matches('.stack-rename-input')`), 'click pen still renames');
        await p.key('a', 4); await p.send('Input.insertText', { text: '784 renamed' }); await p.key('Enter');
        await until(() => p.evaluate(`!document.querySelector('.stack-rename-input')`), 'title field Return saves');
        await press(pen); await p.send('Input.insertText', { text: 'discard me' }); await p.key('Escape');
        assert.equal(await p.evaluate(`document.querySelector(${q(stack784(ids.head) + ' .stack-name')}).textContent`), '784 renamed', 'title Escape preserves saved name');
        await press('#topic-title'); await keysTo(p, ids.a);
        for (const modifiers of [1, 2, 8]) { await p.key('Enter', modifiers); assert.equal(await p.evaluate(`document.querySelector('#reader').open || document.querySelector('#new-message-sheet').open`), false, 'modified Return does not take plain route'); }
        await p.key('Enter', 4); await sheet(baseline);
        if (engine === 'webkit') observations.push({ name: 'item 784 native IME', case: spec.name, state: 'UNRUN: WebKit driver has no native composition API; focused real returnIntent isComposing control is separate' });
      } else if (scenario === 'N7') {
        for (const name of ['a', 'head']) {
          await press('#topic-title');
          const target = card784(ids[name]) + (name === 'head' ? ' > .stack-head .stack-who' : ' > .message-preview');
          await aim(p, target, 'tap');
          await paint(name === 'head' ? stack784(ids.head) : card784(ids[name]), name === 'head' ? 'dossier' : 'message', 'touch-' + name);
          assert.equal(await p.evaluate(`document.querySelector('#reader').open`), false, 'first touch outlines without opening Reader');
          await p.key('Enter'); await reply(name); await closeReader();
        }
        await newMessage(); await p.send('Input.insertText', { text: 'Kept 784' }); await closeSheet();
        await newMessage();
        assert.equal(await p.evaluate(`document.querySelector('#inline-writing-body').value`), 'Kept 784', 'normal close/reopen retains exact writing');
        const button = await read(p, '#new-message-close');
        assert.ok(button.box.width >= 44 - TOLERANCES.TARGET_EPS && button.box.height >= 44 - TOLERANCES.TARGET_EPS, 'native close target at least 44px TARGET_EPS=0.5');
      }
      assert.equal(await p.evaluate(`window.item784.commands.filter(e=>e.kind==='message.send').length`), 0, 'native cases send no messages');
      await record('after');
    } catch (error) {
      primary = error;
      try { await record('FAILURE-before-close'); } catch (capture) { observations.push({ name: 'item 784 capture failure', case: spec.name, primary: error.stack, capture: capture.stack }); }
    } finally {
      const cleanup = [];
      try {
        const health = await control({ method: 'admission_events' });
        observations.push({ name: 'item 784 fixture health', case: spec.name, fatal: health.fatal, next: health.next });
        assert.deepEqual(health.fatal, [], 'fixture has no fatal instrument events');
      } catch (error) { cleanup.push(error.stack); }
      try { assert.deepEqual(p.errors, [], 'own page errors before close'); } catch (error) { cleanup.push(error.stack); }
      try { await p.close(); } catch (error) { cleanup.push(error.stack); }
      observations.push({ name: 'item 784 page cleanup', case: spec.name, primary: primary?.stack ?? null, cleanup });
      if (cleanup.length && !primary) primary = Error(cleanup.join('\n'));
    }
    if (primary) throw primary;
  });
}
