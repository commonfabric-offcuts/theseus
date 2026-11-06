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
            card:box(card),name:box(name),paper:getComputedStyle(document.documentElement).backgroundColor}})()`);
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
