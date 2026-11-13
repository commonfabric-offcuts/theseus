import assert from 'node:assert/strict';
import { pngPixels } from './png-bands.mjs';

// Real app surfaces, native wheel input in both engines. Narrow viewports also
// use native touch to open their drawer/Reader; WebKit's adapter cannot drag a
// finger, so these cases claim wheel scrolling at phone widths, not iOS swipes.
export async function scrollbarChecks({ check, until, control, shot, facts, observations, engine },
  { seed, open, centre, press, light, openReader, card, within }) {
  let viewportPaints = null;
  const long = 'Scrollbar reading.\n\n' + Array.from({ length: 75 }, (_, i) =>
    `Paragraph ${i + 1}. Enough words to keep reading while the scrollbar stays quiet between gestures.`).join('\n\n');
  for (const width of [320, 375, 390, 1280]) for (const area of ['rail', 'feed', 'source', 'writing', 'horizontal', 'page']) {
    await check(`reading scrollbars ${area} at ${width}: idle, native scroll, settled and no-overflow negative`, async () => {
      const name = `scrollbars-${area}-${width}`, topic = `reading-${name}`, device = width < 761 ? 'phone' : 'laptop';
      const text = area === 'horizontal' ? 'Scrollbar reading.\n\n```text\n' + 'wide_column '.repeat(80) + '\nsecond line\nthird line\n```\n\n' + long : long;
      const ids = await seed(topic, [['long', { sender: 'aim-core', join: true, addressees: [facts.actor], body: text }],
        ['short', { sender: 'aim-core', addressees: [facts.actor], body: 'Short message.' }]]);
      if (area === 'rail') await control({ method: 'navigation_topics', topics: Array.from({ length: 35 }, (_, i) => ({ id: `${topic}-${i}`, title: `Scrollbar topic ${i}` })) });
      const p = await open(name, device, topic, ids.long, '', { width, height: 900, deviceScaleFactor: 1, mobile: device === 'phone' });
      try {
        let selector, horizontal = false;
        if (area === 'rail') {
          if (device === 'phone') await press(p, device, '#rail-open');
          selector = '#rail';
        } else if (area === 'source' || area === 'writing') {
          await openReader(p, device, ids.long, 'Scrollbar reading.');
          selector = area === 'source' ? '#source-body' : '#writing-body';
          if (area === 'writing') {
            await press(p, device, selector);
            await p.send('Input.insertText', { text: long });
            await p.key('Home', 4);
          }
        } else if (area === 'page') selector = 'html';
        else {
          await light(p, device, ids.long);
          await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.long))}).classList.contains('scroll-in-place')`), name + ': whole clipped card loaded');
          selector = area === 'horizontal' ? card(ids.long) + ' .md-pre' : card(ids.long);
          horizontal = area === 'horizontal';
          await centre(p, selector);
        }
        if (area === 'page' && engine === 'webkit' && viewportPaints === null) {
          // WebKit's snapshot omits the viewport scrollbar (not nested bars).
          // Calibrate that instrument with a constant red thumb/blue track;
          // never silently count the missing pixels as product paint evidence.
          try {
            const calibration = await p.evaluate(`(()=>{const s=document.createElement('style');s.id='scrollbar-capture-calibration';s.textContent='html::-webkit-scrollbar,body::-webkit-scrollbar{width:30px!important}html::-webkit-scrollbar-thumb,body::-webkit-scrollbar-thumb{background:red!important}html::-webkit-scrollbar-track,body::-webkit-scrollbar-track{background:blue!important}';document.head.append(s);return {root:getComputedStyle(document.documentElement,'::-webkit-scrollbar-thumb').backgroundColor,body:getComputedStyle(document.body,'::-webkit-scrollbar-thumb').backgroundColor,gutter:innerWidth-document.documentElement.clientWidth}})()`);
            assert.equal(calibration.root, 'rgb(255, 0, 0)');
            assert.equal(calibration.body, 'rgb(255, 0, 0)');
            assert.equal(calibration.gutter, 30);
            const sample = pngPixels(Buffer.from((await p.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
            let colored = 0;
            for (let x = sample.width - 30; x < sample.width; x++) for (let y = 0; y < sample.height; y++) {
              const [r,g,b] = sample.pixel(x,y);
              if (g < 10 && ((r > 240 && b < 10) || (b > 240 && r < 10))) colored++;
            }
            viewportPaints = colored > 5;
            await shot(p, name + '-capture-calibration');
            observations.push({name:'WebKit viewport scrollbar capture calibration',...calibration,colored,
              limit:viewportPaints ? null : 'Snapshot omits even constant red/blue viewport bars. Page cases prove native motion, resolved thumb colours and geometry, not viewport paint; nested bars still require pixels.'});
          } finally { await p.evaluate("document.querySelector('#scrollbar-capture-calibration')?.remove()"); }
        }
        const read = () => p.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),s=getComputedStyle(e),b=e.getBoundingClientRect();
          return {color:s.getPropertyValue('--quiet-scrollbar-thumb').trim(),
            thumb:getComputedStyle(e===document.scrollingElement?document.body:e,'::-webkit-scrollbar-thumb').backgroundColor,
            top:e.scrollTop,left:e.scrollLeft,client:[e.clientWidth,e.clientHeight],size:[e.scrollWidth,e.scrollHeight],
            box:[b.width,b.height],bounds:e===document.scrollingElement?[0,0,innerWidth,innerHeight]:[b.left,b.top,b.right,b.bottom],active:e.hasAttribute('data-scrolling'), overflow:[s.overflowX,s.overflowY]}})()`);
        const quiet = state => state.color === 'rgba(0, 0, 0, 0)';
        // Reset only for setup, then wait for all setup scrolls to settle. All
        // state transitions asserted below are driven by native wheel input.
        await p.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollTop=0;e.scrollLeft=0})()`);
        await p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
        await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(selector)}).hasAttribute('data-scrolling')`), name + ': setup scroll settled');
        await p.evaluate('new Promise(done=>setTimeout(done,250))');
        const before = await read();
        assert.ok(before.size[horizontal ? 0 : 1] > before.client[horizontal ? 0 : 1] + 20, name + ': real overflow');
        assert.ok(quiet(before), name + ': idle scrollbar is transparent: ' + JSON.stringify(before));
        await shot(p, name + '-idle');
        const [x, y] = area === 'page' ? await within(p, '.topic-header') : await within(p, selector);
        await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: horizontal ? 130 : 0, deltaY: horizontal ? 0 : 130 });
        const during = await until(async () => { const s = await read(); return (horizontal ? s.left > before.left : s.top > before.top) && !quiet(s) && s; }, name + ': native scroll moves content and paints its thumb');
        assert.deepEqual(during.client, before.client, name + ': showing a thumb does not change the gutter');
        assert.deepEqual(during.box, before.box, name + ': showing a thumb does not resize content');
        assert.equal(during.thumb, during.color, name + ': the thumb resolves to the active colour');
        const captureStarted = Date.now();
        const painted = pngPixels(Buffer.from((await p.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        const captured = await read();
        const captureMs = Date.now() - captureStarted;
        // A real, non-overflowing element does not acquire a thumb when its
        // scrolling ancestor moves (including inheritance of scrollbar-color).
        const negative = await p.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(area === 'source' || area === 'writing' ? '#reader-close' : area === 'rail' ? '.wordmark' : area === 'feed' ? card(ids.long) + ' .message-preview > .md-p' : '.topic-header h1')}),s=getComputedStyle(e);
          return {active:e.hasAttribute('data-scrolling'),overflow:e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1,color:s.getPropertyValue('--quiet-scrollbar-thumb').trim()}})()`);
        assert.equal(negative.overflow, false, name + ': negative has no overflow');
        assert.equal(negative.active, false, name + ': negative never becomes scrolling');
        assert.ok(quiet(negative), name + ': negative keeps a transparent thumb');
        await shot(p, name + '-scrolling');
        await until(async () => quiet(await read()), name + ': scrolling settles');
        await p.evaluate('new Promise(done=>setTimeout(done,250))');
        const after = await read();
        assert.equal(after.thumb, 'rgba(0, 0, 0, 0)', name + ': the actual thumb style clears');
        assert.deepEqual(after.client, before.client, name + ': hiding a thumb keeps the gutter');
        assert.deepEqual([after.top, after.left], [during.top, during.left], name + ': fading never scrolls content');
        await shot(p, name + '-settled');
        const cleared = pngPixels(Buffer.from((await p.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        const [left, top, right, bottom] = during.bounds;
        const x0 = Math.max(0, Math.ceil(horizontal ? left + 8 : right - 14));
        const x1 = Math.min(painted.width, Math.floor(right - (horizontal ? 8 : 0)));
        const y0 = Math.max(0, Math.ceil(horizontal ? bottom - 14 : top + 8));
        const y1 = Math.min(painted.height, Math.floor(bottom - (horizontal ? 0 : 8)));
        let changed = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          if (painted.pixel(x, y).some((c, i) => Math.abs(c - cleared.pixel(x, y)[i]) > 12)) changed++;
        }
        const pixelProof = !(area === 'page' && engine === 'webkit' && viewportPaints === false);
        if (pixelProof) assert.ok(changed >= 5, name + ': the actual scrollbar edge paints then clears, not just its computed style: ' + JSON.stringify({changed,during,captured,after,captureMs,pixels:[painted.width,painted.height],band:[x0,x1,y0,y1]}));

        observations.push({ name, before, during, after, negative, changed, pixelProof });
        assert.deepEqual(p.errors, []);
      } finally { await p.close(); }
    });
  }
}
