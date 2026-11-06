// Each agent's own color, as painted: a tint across the whole card and a
// deeper one behind the name, the same agent the same color on every card, in
// light and dark, at laptop and phone width. Your own messages keep their
// black, whether drawn first, arriving live or loaded with More. Run by
// reader_persistence_native.mjs with --colors; screenshots are kept as
// agent-colors-<theme>-<width>[-n].png and own-style-*.png for review.
import assert from 'node:assert/strict';
import { pngPixels, paintedBand } from './png-bands.mjs';

const AGENTS = ['aim-lead', 'aim-ux', 'fable', 'aim-core', 'aim-spec', 'warp', 'fixture-guest-agent'];
const WIDTHS = { laptop: { width: 1280, height: 1000, mobile: false }, phone: { width: 390, height: 844, mobile: true } };

const rgb = s => s.match(/[\d.]+/g).slice(0, 3).map(Number);
const hex = h => [1, 3, 5].map(i => parseInt(h.trim().slice(i, i + 2), 16));
const same = (a, b) => a.length === 3 && a.every((v, i) => v === b[i]);
const luminance = c => c.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hue = ([r, g, b]) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return null;
  const h = max === r ? (g - b) / d % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

export async function agentColorsCheck({ check, page, until, facts, control, shot, observations }) {
  await check('colors each agent has its own color on its name and across its cards, and your own stay black', async () => {
    const ids = {};
    for (const [n, agent] of AGENTS.entries())
      ids[agent] = (await control({ method: 'agent_message', operation_id: 'agent-colors-' + n, sender: agent, join: true, body: `A message from ${agent}, in its own color.` })).result.message_id;
    // A second card from one agent, so the same agent is seen twice.
    const again = (await control({ method: 'agent_message', operation_id: 'agent-colors-again', sender: 'fable', body: 'fable again: the same color as before.' })).result.message_id;
    const own = facts.sources[1].id;
    const failures = [];
    const expect = (ok, why) => { if (!ok) failures.push(why); };
    for (const theme of ['light', 'dark']) for (const [width, metrics] of Object.entries(WIDTHS)) {
      const label = `${theme} ${width}`;
      const p = await page(`agent-colors-${theme}-${width}`, null, true, { beforeNavigate: async p => {
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await p.send('Emulation.setDeviceMetricsOverride', { ...metrics, deviceScaleFactor: 1 });
        if (metrics.mobile) await p.send('Emulation.setTouchEmulationEnabled', { enabled: true });
      } });
      await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
      const card = id => `#messages [data-id="${id}"]`;
      await until(() => p.evaluate(`${JSON.stringify([...Object.values(ids), again, own].map(card))}.every(s => document.querySelector(s))`), label + ': every card drawn');
      // What the page paints for one card: its computed colors, its custom
      // properties, and pixels from a screenshot taken with it in view.
      const measure = async id => {
        const painted = await p.evaluate(`(()=>{
          const card=document.querySelector(${JSON.stringify(card(id))});card.scrollIntoView({block:'center'});
          const c=getComputedStyle(card),name=card.querySelector('.author-name'),n=getComputedStyle(name),time=card.querySelector('.message-time'),words=card.querySelector('.message-preview');
          const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
          const before=getComputedStyle(card,'::before'),after=getComputedStyle(card,'::after');
          return {className:card.className,background:c.backgroundColor,agentCard:c.getPropertyValue('--agent-card'),agentTag:c.getPropertyValue('--agent-tag'),
            nameBackground:n.backgroundColor,nameColor:n.color,timeColor:time?getComputedStyle(time).color:null,wordsColor:getComputedStyle(words).color,
            edges:{left:[c.borderLeftWidth,c.borderLeftColor],right:[c.borderRightWidth,c.borderRightColor],top:[c.borderTopWidth,c.borderTopColor],shadow:c.boxShadow,before:before.content,after:after.content},
            card:box(card),name:box(name),paper:getComputedStyle(document.documentElement).backgroundColor,soft:getComputedStyle(document.documentElement).getPropertyValue('--soft')}})()`);
        await until(() => p.evaluate("document.getAnimations().every(a=>a.playState!=='running')"), 'settled');
        const image = pngPixels(Buffer.from((await p.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        return { ...painted, image };
      };
      const seen = {};
      let shots = 0;
      for (const [agent, id] of [...Object.entries(ids), ['fable', again]]) {
        const m = await measure(id), why = `${label} ${agent}`;
        const fill = rgb(m.background), tag = rgb(m.nameBackground);
        expect(/\bagent-card\b/.test(m.className), why + ': card is an agent card');
        expect(m.agentCard && same(fill, hex(m.agentCard)), why + ': card painted with its agent color');
        expect(m.agentTag && same(tag, hex(m.agentTag)), why + ': name painted with its agent color');
        expect(!same(fill, rgb(m.paper)), why + ': card tint differs from the page');
        // Fable keeps the green the live app already gave its cards: the page's --soft.
        if (agent === 'fable') expect(same(fill, hex(m.soft)), why + `: Fable's card is the live green (${fill} vs ${m.soft})`);
        expect(contrast(tag, fill) >= 1.15, why + ': name tint shows on its card');
        const [h1, h2] = [hue(fill), hue(tag)];
        expect(h1 !== null && h2 !== null && hueGap(h1, h2) <= 12, why + `: name and card share a hue (${h1?.toFixed(0)} vs ${h2?.toFixed(0)})`);
        for (const [what, color] of [['name', m.nameColor], ['time', m.timeColor], ['words', m.wordsColor]])
          if (color) expect(contrast(rgb(color), what === 'name' ? tag : fill) >= 4.5, why + `: ${what} readable (${contrast(rgb(color), what === 'name' ? tag : fill).toFixed(2)})`);
        // No edge or bar: the same border all round, nothing drawn beside it.
        expect(JSON.stringify(m.edges.left) === JSON.stringify(m.edges.right) && JSON.stringify(m.edges.left) === JSON.stringify(m.edges.top), why + ': the same border on every side');
        expect(m.edges.shadow === 'none' && m.edges.before === 'none' && m.edges.after === 'none', why + ': no shadow or drawn edge');
        // Pixels. The card's tint fills its left and right padding alike, from
        // just inside the border, over the same rows.
        const { card: r, name: n, image } = m;
        const midY = Math.round(r.y + r.height / 2), inner = 3, pad = 14;
        const row = (from, to) => Array.from({ length: to - from }, (_, k) => image.pixel(from + k, midY));
        const leftPad = row(Math.ceil(r.x) + inner, Math.ceil(r.x) + pad), rightPad = row(Math.floor(r.x + r.width) - pad, Math.floor(r.x + r.width) - inner);
        expect(leftPad.every(px => same(px, fill)), why + ': left padding is the card tint, with no bar');
        expect(rightPad.every(px => same(px, fill)), why + ': right padding is the card tint');
        const [top, bottom] = [r.y + 14, r.y + r.height - 14];
        const left = paintedBand(image, Math.ceil(r.x) + 6, top, bottom, fill), right = paintedBand(image, Math.floor(r.x + r.width) - 6, top, bottom, fill);
        expect(left && right && Math.abs(left.top - right.top) <= 1 && Math.abs(left.bottom - right.bottom) <= 1, why + ': tint bands agree on both sides');
        assert.equal(paintedBand(image, Math.ceil(r.x) + 6, top, bottom, [255, 0, 255]), null, 'wrong-color control finds no band');
        const outside = image.pixel(Math.max(0, Math.floor(r.x) - 4), midY);
        expect(!same(outside, fill), why + ': the tint stops at the card');
        // The name's tag, sampled in its padding, before the first letter.
        const tagPixel = image.pixel(Math.ceil(n.x) + 2, Math.round(n.y + n.height / 2));
        expect(same(tagPixel, tag), why + `: name tag painted (${tagPixel} vs ${tag})`);
        (seen[agent] ??= []).push(m.background);
        observations.push({ name: 'agent colors', theme, width, agent, background: m.background, nameBackground: m.nameBackground, leftPad: leftPad[0], tagPixel, edges: m.edges, contrast: { name: contrast(rgb(m.nameColor), tag), words: contrast(rgb(m.wordsColor), fill), time: m.timeColor && contrast(rgb(m.timeColor), fill) } });
        if (width === 'phone' || shots === 0) await shot(p, `agent-colors-${theme}-${width}-${shots++}`);
      }
      expect(new Set(seen.fable).size === 1, `${label}: both of fable's cards share one color`);
      expect(new Set(AGENTS.map(agent => seen[agent][0])).size === AGENTS.length, `${label}: every agent has its own color`);
      // Your own message keeps its black, and no name tag.
      const mine = await measure(own);
      expect(/\bown-message\b/.test(mine.className) && !/agent-card/.test(mine.className), `${label}: own card keeps its own class`);
      expect(mine.background === 'rgb(0, 0, 0)', `${label}: own card stays black`);
      expect(mine.nameBackground === 'rgba(0, 0, 0, 0)', `${label}: own name has no tag`);
      // A message that arrives while the page is open is colored as it lands.
      const live = (await control({ method: 'agent_message', operation_id: `agent-colors-live-${theme}-${width}`, sender: 'aim-core', body: 'aim-core, arriving live.' })).result.message_id;
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(live))}))`), label + ': live arrival drawn');
      const arrived = await measure(live);
      expect(arrived.background === seen['aim-core'][0], `${label}: a live arrival takes its agent's color`);
      assert.equal(await p.evaluate('document.documentElement.scrollWidth<=innerWidth'), true, label + ': no horizontal overflow');
      await p.evaluate(`document.querySelector(${JSON.stringify(card(live))}).scrollIntoView({block:'start'})`);
      await shot(p, `agent-colors-${theme}-${width}`);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
    assert.deepEqual(failures, [], 'agent colors');
  });

  await check('colors your own message keeps its own style when it arrives live and when More loads it', async () => {
    const style = (p, id) => p.evaluate(`(()=>{const card=document.querySelector('#messages [data-id="${id}"]');if(!card)return null;const c=getComputedStyle(card),n=getComputedStyle(card.querySelector('.author-name'));return {className:card.className,background:c.backgroundColor,color:c.color,name:n.backgroundColor}})()`);
    const ownStyle = (painted, why) => {
      assert.ok(painted, why + ': card drawn');
      assert.equal(painted.className, 'message-card own-message', why + ': own class, no agent color');
      assert.equal(painted.background, 'rgb(0, 0, 0)', why + ': black');
      assert.equal(painted.name, 'rgba(0, 0, 0, 0)', why + ': no name tag');
    };
    // An own message written while a page is open arrives over the live stream.
    const p = await page('own-style-live', null, true, { beforeNavigate: p => p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }) });
    const live = (await control({ method: 'agent_message', operation_id: 'own-style-live', sender: 'person', body: 'My own message, arriving live.' })).result.message_id;
    await until(() => style(p, live), 'own live arrival drawn');
    ownStyle(await style(p, live), 'live');
    await p.evaluate(`document.querySelector('#messages [data-id="${live}"]').scrollIntoView({block:'center'})`);
    await shot(p, 'own-style-live');
    assert.deepEqual(p.errors, []);
    await p.close();
    // One more page of agent messages after it puts an own message behind More.
    const older = (await control({ method: 'agent_message', operation_id: 'own-style-older', sender: 'person', body: 'My own message, older than a page.' })).result.message_id;
    for (let n = 0; n < 31; n++) await control({ method: 'agent_message', operation_id: 'own-style-after-' + n, body: `Agent message ${n} after mine.` });
    for (const theme of ['light', 'dark']) {
      const q = await page('own-style-more-' + theme, null, true, { beforeNavigate: q => q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }) });
      assert.equal(await style(q, older), null, theme + ': the older own message is not on the first page');
      for (let n = 0; n < 5 && !await style(q, older); n++) {
        await q.evaluate("document.querySelector('#more-messages').scrollIntoView({block:'center'})");
        const cards = await q.evaluate("document.querySelectorAll('#messages .message-card').length");
        await q.point('#more-messages');
        await until(() => q.evaluate(`document.querySelectorAll('#messages .message-card').length > ${cards}`), theme + ': More loaded older messages');
      }
      ownStyle(await style(q, older), theme + ' More');
      ownStyle(await style(q, live), theme + ' first page');
      await q.evaluate(`document.querySelector('#messages [data-id="${older}"]').scrollIntoView({block:'center'})`);
      await q.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
      await shot(q, 'own-style-more-' + theme);
      observations.push({ name: 'own style live and More', theme, live: await style(q, live), older: await style(q, older) });
      assert.deepEqual(q.errors, []);
      await q.close();
    }
  });
}

// Changing an agent's color for yourself, as a person does it: a click on the
// agent's name opens the picker and not the message; the picker is reached by
// keyboard and closes on Escape or a press outside; a choice recolors the
// agent's cards at once, stays after a reload and shows on another page; the
// participants' name does the same by keyboard, and Default brings the agent's
// own color back. Screenshots: agent-color-picker-*.png.
export async function agentColorChoiceCheck({ check, page, until, control, shot, observations }) {
  await check('colors clicking an agent\'s name changes its color for you, kept across reloads and pages', async () => {
    // Older agent messages below aim-ux's, for a picker opened lower down.
    for (let n = 0; n < 5; n++) await control({ method: 'agent_message', operation_id: 'agent-color-choice-older-' + n, body: `An older agent message ${n}.` });
    const id = (await control({ method: 'agent_message', operation_id: 'agent-color-choice', sender: 'aim-ux', join: true, body: 'aim-ux, about to be recolored.' })).result.message_id;
    const card = `#messages [data-id="${id}"]`;
    const fill = (p, selector) => p.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundColor`);
    const tokens = (p, name) => p.evaluate(`(()=>{const e=document.createElement('div');e.className='agent-${name}';document.body.append(e);const c=getComputedStyle(e);const v=[c.getPropertyValue('--agent-card').trim(),c.getPropertyValue('--agent-tag').trim()];e.remove();return v})()`);
    const rgbOf = hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
    const picker = p => p.evaluate(`(()=>{const r=document.querySelector('.color-picker');if(!r)return null;const b=r.getBoundingClientRect();
      return {role:r.getAttribute('role'),label:r.getAttribute('aria-label'),focused:document.activeElement?.getAttribute('aria-label')??document.activeElement?.textContent,
        inView:b.left>=0&&b.top>=0&&b.right<=innerWidth&&b.bottom<=innerHeight,pressed:[...r.querySelectorAll('[aria-pressed=true]')].map(e=>e.getAttribute('aria-label')??e.textContent)}})()`);
    // The phone first: it chooses nothing, so both widths start from aim-ux's own violet.
    for (const [width, metrics] of Object.entries({ phone: { width: 390, height: 844, mobile: true }, laptop: { width: 1280, height: 900, mobile: false } })) {
      const p = await page('agent-color-picker-' + width, null, true, { beforeNavigate: async p => {
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
        await p.send('Emulation.setDeviceMetricsOverride', { ...metrics, deviceScaleFactor: 1 });
        if (metrics.mobile) await p.send('Emulation.setTouchEmulationEnabled', { enabled: true });
      } });
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card)}))`), width + ': card drawn');
      await p.evaluate(`document.querySelector(${JSON.stringify(card)}).scrollIntoView({block:'center'})`);
      const [violet] = await tokens(p, 'violet');
      assert.equal(await fill(p, card), rgbOf(violet), width + ': aim-ux starts in its own violet');
      // The name: the picker opens under it, and the message does not open.
      await p.point(`${card} .author-name`);
      await until(() => picker(p), width + ': the picker opened');
      const opened = await picker(p);
      assert.deepEqual([opened.role, opened.label, opened.inView, opened.pressed], ['dialog', 'Color for aim-ux', true, ['Default (violet)']], width + ': a labelled popover in view, the agent\'s own pressed');
      assert.equal(opened.focused, 'Default (violet)', width + ': the current choice has the focus');
      assert.equal(await p.evaluate("document.querySelector('#reader').open"), false, width + ': the message did not open');
      // Each swatch: its name tag's color, on the picker's own background,
      // big enough to see, with its name in words inside the swatch.
      const swatches = await p.evaluate(`[...document.querySelectorAll('.color-picker .swatch')].map(s=>{const t=s.querySelector('.swatch-tag'),n=s.querySelector('.swatch-name'),r=s.getBoundingClientRect(),w=n?.getBoundingClientRect();
        return {name:s.getAttribute('aria-label'),tag:t&&getComputedStyle(t).backgroundColor,fill:getComputedStyle(s).backgroundColor,words:n?.textContent,
          shown:Boolean(w&&w.width>0&&w.height>0&&w.left>=r.left&&w.right<=r.right&&w.bottom<=r.bottom),tall:t?Math.round(t.getBoundingClientRect().height):0}})`);
      const panel = await p.evaluate("getComputedStyle(document.querySelector('.color-picker')).backgroundColor");
      assert.equal(swatches.length, 8, width + ': a swatch per palette color');
      for (const swatch of swatches) {
        const [, tag] = await tokens(p, swatch.name);
        assert.deepEqual([swatch.tag, swatch.fill, swatch.words, swatch.shown], [rgbOf(tag), panel, swatch.name, true], `${width}: ${swatch.name} shows its name tag color on the picker, named`);
        assert.ok(swatch.tall >= 24, `${width}: ${swatch.name}'s color is ${swatch.tall}px tall`);
      }
      // No tap highlight over the picker, the card or the participant's name.
      const taps = await p.evaluate(`[${JSON.stringify(card)},'.color-picker .swatch','.color-picker .swatch-default','#participants .chip-name'].map(s=>getComputedStyle(document.querySelector(s)).getPropertyValue('-webkit-tap-highlight-color'))`);
      assert.deepEqual(taps, Array(4).fill('rgba(0, 0, 0, 0)'), width + ': no tap highlight');
      await shot(p, 'agent-color-picker-' + width);
      // Keyboard: the arrows move round the swatches; Escape closes and the card has the focus.
      await p.key('ArrowRight'); assert.equal((await picker(p)).focused, 'green', width + ': ArrowRight goes round to the first swatch');
      await p.key('Escape');
      assert.equal(await picker(p), null, width + ': Escape closes it');
      assert.equal(await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(card)})`), true, width + ': the card has the focus');
      // A press outside closes it: on the topic's title, with the title and
      // the card both in view, so the press itself scrolls nothing.
      await p.evaluate("document.querySelector('#topic-title').scrollIntoView({block:'start'})");
      assert.equal(await p.evaluate(`(r=>r.top>=0&&r.bottom<=innerHeight)(document.querySelector(${JSON.stringify(card + ' .author-name')}).getBoundingClientRect())`), true, width + ': the name is in view below the title');
      await p.point(`${card} .author-name`); await until(() => picker(p), width + ': opened again');
      await p.point('#topic-title');
      assert.equal(await picker(p), null, width + ': a press outside closes it');
      if (width === 'phone') { assert.equal(await p.evaluate('document.documentElement.scrollWidth<=innerWidth'), true, 'phone: no horizontal overflow'); await p.close(); continue; }
      // A message arriving above while the person reads lower down, with the
      // picker open on an older agent card's name and the newest out of view: the page holds its place, so
      // the name stays put and the picker stays open. Scrolling the name away
      // closes it, and the focus goes back to that card.
      const lower = `#messages [data-id="${await p.evaluate("[...document.querySelectorAll('#messages .message-card.agent-card')][4].dataset.id")}"]`;
      await p.evaluate(`scrollTo(0, document.querySelector(${JSON.stringify(lower)}).getBoundingClientRect().top + scrollY - 200)`);
      await p.point(`${lower} .author-name`); await until(() => picker(p), width + ': opened lower down');
      const nameAt = () => p.evaluate(`Math.round(document.querySelector(${JSON.stringify(lower + ' .author-name')}).getBoundingClientRect().top)`);
      const heldAt = await nameAt();
      const above = (await control({ method: 'agent_message', operation_id: 'agent-color-picker-arrival-' + width, body: 'Arriving above the open picker.' })).result.message_id;
      await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${above}"]'))`), width + ': the arrival is drawn above');
      assert.equal(await nameAt(), heldAt, width + ': the page held the name in place');
      assert.notEqual(await picker(p), null, width + ': the picker stays open when its name does not move');
      await p.evaluate('scrollBy(0, 120)');
      await until(async () => !(await picker(p)), width + ': scrolling the name away closes the picker');
      assert.equal(await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(lower)})`), true, width + ': the focus went back to the card');
      await p.evaluate(`document.querySelector(${JSON.stringify(card)}).scrollIntoView({block:'center'})`);
      // Choosing rose recolors the card at once.
      await p.point(`${card} .author-name`); await until(() => picker(p), 'opened to choose');
      await p.point('.color-picker [aria-label="rose"]');
      await until(async () => !(await picker(p)), 'closed once chosen');
      const [rose] = await tokens(p, 'rose');
      await until(async () => await fill(p, card) === rgbOf(rose), 'the card wears rose');
      await shot(p, 'agent-color-picker-chosen');
      await p.close();
    }
    // Kept by Core: a new page, as on another device, shows rose.
    const q = await page('agent-color-picker-again', null, true, { beforeNavigate: p => p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }) });
    await until(() => q.evaluate(`Boolean(document.querySelector(${JSON.stringify(card)}))`), 'card drawn again');
    const [roseDark] = await tokens(q, 'rose');
    assert.equal(await fill(q, card), rgbOf(roseDark), 'another page shows the choice, in dark too');
    // The participants' name, by keyboard: Tab-reachable, Return opens, End and Return choose Default.
    const chip = '#participants .chip-name[title="Change aim-ux\'s color"]';
    await until(() => q.evaluate(`Boolean(document.querySelector(${JSON.stringify(chip)}))`), 'aim-ux in the participants');
    const [, roseTag] = await tokens(q, 'rose');
    assert.equal(await fill(q, chip), rgbOf(roseTag), 'the participant name wears the chosen color');
    await q.evaluate(`document.querySelector(${JSON.stringify(chip)}).focus()`);
    await q.key('Enter'); await until(() => picker(q), 'Return opens the picker from the participants');
    assert.deepEqual((await picker(q)).pressed, ['rose']);
    await q.key('End'); await q.key('Enter');
    await until(async () => !(await picker(q)), 'closed once Default is chosen');
    const [violetDark] = await tokens(q, 'violet');
    await until(async () => await fill(q, card) === rgbOf(violetDark), 'Default brings aim-ux\'s own violet back');
    assert.equal(await q.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(chip)})`), true, 'the focus is back on the name');
    observations.push({ name: 'agent color choice', card: await fill(q, card) });
    await shot(q, 'agent-color-picker-participants');
    assert.deepEqual(q.errors, []);
    await q.close();
  });
}
