import assert from 'node:assert/strict';
import { pngPixels } from './png-bands.mjs';

// Real app surfaces, native wheel input. A platform draws its scroll bars one
// of two ways, and each run of the harness has one of them:
// - overlay ('reading scrollbars …', native-reading and native-webkit-reading):
//   the bar is drawn over the content and shows only while scrolling (macOS
//   with a trackpad, every phone). The page leaves it to the platform, so each
//   area keeps exactly the room it had before 398/399: no gutter, idle, while
//   scrolling or after.
// - always shown ('scrollbars …', native-scrollbars: Chrome started with
//   -AppleShowScrollBars Always, as with a mouse or "Always" in System
//   Settings): the bar takes the platform's own width, which the page keeps,
//   and its thumb is quiet between scrolls, shows while its area scrolls and
//   fades after. Chrome's mobile emulation draws overlay bars, so the narrow
//   widths here are narrow laptop windows with a pointer.
export async function scrollbarChecks({ check, until, control, shot, facts, observations, engine },
  { seed, open, centre, press, light, openReader, card, within }, platform = 'overlay') {
  const classic = platform === 'classic';
  const long = 'Scrollbar reading.\n\n' + Array.from({ length: 75 }, (_, i) =>
    `Paragraph ${i + 1}. Enough words to keep reading while the scrollbar stays quiet between gestures.`).join('\n\n');
  for (const width of [320, 375, 390, 1280]) for (const area of ['rail', 'feed', 'source', 'writing', 'horizontal', 'page']) {
    const caseName = classic
      ? `scrollbars ${area} at ${width}: always-shown bars keep the platform's width, quiet idle, show while scrolling, settle; no-overflow negative`
      : `reading scrollbars ${area} at ${width}: overlay bars keep live's layout idle, while scrolling and settled`;
    await check(caseName, async () => {
      const name = `scrollbars-${platform}-${area}-${width}`, topic = `reading-${name}`, narrow = width < 761;
      // Overlay runs as the device would: a phone with touch below 761px. Always-shown bars come with a pointer.
      const device = narrow && !classic ? 'phone' : 'laptop';
      const text = area === 'horizontal' ? 'Scrollbar reading.\n\n```text\n' + 'wide_column '.repeat(80) + '\nsecond line\nthird line\n```\n\n' + long : long;
      const ids = await seed(topic, [['long', { sender: 'aim-core', join: true, addressees: [facts.actor], body: text }],
        ['short', { sender: 'aim-core', addressees: [facts.actor], body: 'Short message.' }]]);
      if (area === 'rail') await control({ method: 'navigation_topics', topics: Array.from({ length: 35 }, (_, i) => ({ id: `${topic}-${i}`, title: `Scrollbar topic ${i}` })) });
      const p = await open(name, device, topic, ids.long, '', { width, height: 900, deviceScaleFactor: 1, mobile: device === 'phone' });
      try {
        let selector, horizontal = false;
        if (area === 'rail') {
          if (narrow) await press(p, device, '#rail-open');
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
        // The width the platform's own bars take, read in a blank frame that
        // holds none of the page's styles: 0 for overlay bars.
        const native = await p.evaluate(`(()=>{const f=document.createElement('iframe');f.style.cssText='position:fixed;left:-500px;top:0;width:300px;height:300px;border:0';
          document.body.append(f);const d=f.contentDocument,e=d.createElement('div');e.style.cssText='overflow:scroll;width:100px;height:100px';d.body.append(e);
          const w=e.offsetWidth-e.clientWidth;f.remove();return w})()`);
        if (classic) assert.ok(native > 0, name + ': this run has always-shown bars that take room: ' + native);
        else assert.equal(native, 0, name + ': this run has overlay bars');
        // The room the area's bar takes, across the axis it scrolls on.
        const read = () => p.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),s=getComputedStyle(e),b=e.getBoundingClientRect(),page=e===document.scrollingElement;
          const across=${horizontal}?(page?innerHeight-e.clientHeight:e.offsetHeight-e.clientHeight-parseFloat(s.borderTopWidth)-parseFloat(s.borderBottomWidth))
            :(page?innerWidth-e.clientWidth:e.offsetWidth-e.clientWidth-parseFloat(s.borderLeftWidth)-parseFloat(s.borderRightWidth));
          return {color:s.getPropertyValue('--quiet-scrollbar-thumb').trim(),
            thumb:getComputedStyle(page?document.body:e,'::-webkit-scrollbar-thumb').backgroundColor,
            bar:[...new Set((page?[document.documentElement,document.body]:[e]).map(x=>getComputedStyle(x,'::-webkit-scrollbar').width))].join(),
            gutter:Math.round(across),top:e.scrollTop,left:e.scrollLeft,client:[e.clientWidth,e.clientHeight],size:[e.scrollWidth,e.scrollHeight],
            box:[b.width,b.height],bounds:page?[0,0,innerWidth,innerHeight]:[b.left,b.top,b.right,b.bottom],active:e.hasAttribute('data-scrolling')}})()`);
        // The same area with the piece's styles switched off, as live draws it.
        const live = () => p.evaluate(`(()=>{const r=document.documentElement,on=r.hasAttribute('data-quiet-scrollbars'),e=document.querySelector(${JSON.stringify(selector)});
          r.removeAttribute('data-quiet-scrollbars');const client=[e.clientWidth,e.clientHeight];if(on)r.setAttribute('data-quiet-scrollbars','');return client})()`);
        const quiet = state => !classic || state.color === 'rgba(0, 0, 0, 0)';
        // Reset only for setup, then wait for all setup scrolls to settle. All
        // state transitions asserted below are driven by native wheel input.
        await p.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollTop=0;e.scrollLeft=0})()`);
        await p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
        await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(selector)}).hasAttribute('data-scrolling')`), name + ': setup scroll settled');
        await p.evaluate('new Promise(done=>setTimeout(done,250))');
        const before = await read();
        assert.ok(before.size[horizontal ? 0 : 1] > before.client[horizontal ? 0 : 1] + 20, name + ': real overflow');
        assert.equal(before.gutter, native, name + ': idle, the bar takes the room the platform gives it and no more: ' + JSON.stringify(before));
        assert.deepEqual(await live(), before.client, name + ': idle, the area is as wide and tall as live draws it');
        // 'auto': no bar of the page's own replaces the platform's.
        assert.equal(before.bar, classic ? native + 'px' : 'auto', name + (classic ? ': the page draws its bar at the platform\'s width' : ': the platform draws its own overlay bar'));
        assert.ok(quiet(before), name + ': idle scrollbar is transparent: ' + JSON.stringify(before));
        await shot(p, name + '-idle');
        const [x, y] = area === 'page' ? await within(p, '.topic-header') : await within(p, selector);
        await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: horizontal ? 130 : 0, deltaY: horizontal ? 0 : 130 });
        const during = await until(async () => { const s = await read(); return (horizontal ? s.left > before.left : s.top > before.top) && (!classic || !quiet(s)) && s; }, name + ': native scroll moves content' + (classic ? ' and paints its thumb' : ''));
        assert.equal(during.gutter, native, name + ': while scrolling, the bar takes no more room');
        assert.deepEqual(during.client, before.client, name + ': showing a thumb does not change the gutter');
        assert.deepEqual(during.box, before.box, name + ': showing a thumb does not resize content');
        const painted = classic && pngPixels(Buffer.from((await p.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        if (classic) {
          assert.equal(during.thumb, during.color, name + ': the thumb resolves to the active colour');
          // A real, non-overflowing element does not acquire a thumb when its
          // scrolling ancestor moves (including inheritance of scrollbar-color).
          const negative = await p.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(area === 'source' || area === 'writing' ? '#reader-close' : area === 'rail' ? '.wordmark' : area === 'feed' ? card(ids.long) + ' .message-preview > .md-p' : '.topic-header h1')}),s=getComputedStyle(e);
            return {active:e.hasAttribute('data-scrolling'),overflow:e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1,color:s.getPropertyValue('--quiet-scrollbar-thumb').trim()}})()`);
          assert.equal(negative.overflow, false, name + ': negative has no overflow');
          assert.equal(negative.active, false, name + ': negative never becomes scrolling');
          assert.ok(quiet(negative), name + ': negative keeps a transparent thumb');
          observations.push({ name: name + ' negative', negative });
        }
        await shot(p, name + '-scrolling');
        await until(async () => { const s = await read(); return quiet(s) && !s.active; }, name + ': scrolling settles');
        await p.evaluate('new Promise(done=>setTimeout(done,250))');
        const after = await read();
        if (classic) assert.equal(after.thumb, 'rgba(0, 0, 0, 0)', name + ': the actual thumb style clears');
        assert.equal(after.gutter, native, name + ': settled, the bar takes the room the platform gives it');
        assert.deepEqual(after.client, before.client, name + ': hiding a thumb keeps the gutter');
        assert.deepEqual(await live(), after.client, name + ': settled, the area is as wide and tall as live draws it');
        assert.deepEqual([after.top, after.left], [during.top, during.left], name + ': fading never scrolls content');
        await shot(p, name + '-settled');
        let changed = null;
        if (classic) {
          const cleared = pngPixels(Buffer.from((await p.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
          const [left, top, right, bottom] = during.bounds;
          const x0 = Math.max(0, Math.ceil(horizontal ? left + 8 : right - native));
          const x1 = Math.min(painted.width, Math.floor(right - (horizontal ? 8 : 0)));
          const y0 = Math.max(0, Math.ceil(horizontal ? bottom - native : top + 8));
          const y1 = Math.min(painted.height, Math.floor(bottom - (horizontal ? 0 : 8)));
          changed = 0;
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            if (painted.pixel(x, y).some((c, i) => Math.abs(c - cleared.pixel(x, y)[i]) > 12)) changed++;
          }
          assert.ok(changed >= 5, name + ': the actual scrollbar edge paints then clears, not just its computed style: ' + JSON.stringify({changed,during,after,pixels:[painted.width,painted.height],band:[x0,x1,y0,y1]}));
        }
        observations.push({ name, engine, platform, native, before, during, after, changed });
        assert.deepEqual(p.errors, []);
      } finally { await p.close(); }
    });
  }
}
