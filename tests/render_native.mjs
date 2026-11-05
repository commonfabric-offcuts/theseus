import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// How the page is painted, not only what it holds. In each colour scheme and
// at laptop and phone width, at rest and with the pointer over a row, every
// pill on the page (an element rounded to half its height that carries words,
// such as an unread count or a state) must be as wide as its words, stand out
// from what is behind it, carry readable words, and sit beside the words it
// follows; and the page must not
// scroll sideways. Each state's screenshot is kept beside the run's evidence.
export const audit = `(() => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const pen = canvas.getContext('2d', { willReadFrequently: true });
  const rgba = color => {
    pen.clearRect(0, 0, 1, 1); pen.fillStyle = 'rgba(0,0,0,0)'; pen.fillStyle = color; pen.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = pen.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255];
  };
  const over = (top, under) => [0, 1, 2].map(i => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  const behind = element => {
    const chain = [];
    for (let at = element.parentElement; at; at = at.parentElement) chain.unshift(rgba(getComputedStyle(at).backgroundColor));
    return chain.reduce((under, top) => over(top, under), [255, 255, 255, 1]);
  };
  const luminance = color => color.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const where = element => {
    const path = [];
    for (let at = element; at && at !== document.body; at = at.parentElement) {
      path.unshift(at.id ? '#' + at.id : at.tagName.toLowerCase() + (at.className && typeof at.className === 'string' ? '.' + at.className.trim().split(/\\s+/).join('.') : '') +
        (at.dataset?.topicId ? '[topic=' + at.dataset.topicId + ']' : at.dataset?.workspaceId ? '[outcome=' + at.dataset.workspaceId + ']' : ''));
      if (at.id) break;
    }
    return path.join(' > ') + ' "' + element.textContent.trim().slice(0, 30) + '"';
  };
  const problems = [];
  let pills = 0;
  for (const element of document.querySelectorAll('body *')) {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    // Text kept for screen readers alone is drawn one pixel square.
    if (box.width <= 2 || box.height <= 2 || style.visibility === 'hidden' || element.closest('[hidden]')) continue;
    if (!element.textContent.trim() || box.height > 48 || parseFloat(style.borderTopLeftRadius) < box.height / 2 - 1) continue;
    pills++;
    const range = document.createRange(); range.selectNodeContents(element);
    const words = range.getBoundingClientRect().width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) +
      parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    if (box.width > Math.max(words, parseFloat(style.minWidth) || 0) + 2) problems.push({ kind: 'wider than its words', at: where(element), width: Math.round(box.width), words: Math.round(words) });
    const under = behind(element), fill = over(rgba(style.backgroundColor), under);
    const edge = parseFloat(style.borderTopWidth) > 0 ? over(rgba(style.borderTopColor), under) : fill;
    const stands = Math.max(ratio(fill, under), ratio(edge, under));
    // A quiet outline, as a chip's, stands out about 1.2 times; a pill the
    // colour of its row, not at all.
    if (stands < 1.15) problems.push({ kind: 'blends into what is behind it', at: where(element), contrast: Number(stands.toFixed(2)) });
    // A pill that follows words sits on their last line, not on a line alone.
    const before = element.previousSibling;
    if (before?.nodeType === Node.TEXT_NODE && before.textContent.trim()) {
      const last = document.createRange(), text = before.textContent.trimEnd();
      last.setStart(before, text.length - 1); last.setEnd(before, text.length);
      const line = last.getBoundingClientRect(), middle = box.top + box.height / 2;
      if (middle < line.top || middle > line.bottom) problems.push({ kind: 'alone on its line', at: where(element) });
    }
    const ink = ratio(over(rgba(style.color), fill), fill);
    if (ink < 4.5) problems.push({ kind: 'faint words', at: where(element), contrast: Number(ink.toFixed(2)) });
  }
  const scroller = document.scrollingElement;
  if (scroller.scrollWidth > scroller.clientWidth + 1) problems.push({ kind: 'the page scrolls sideways', width: scroller.scrollWidth, view: scroller.clientWidth });
  return { pills, problems };
})()`;

export async function renderChecks({ check, page, until, control, origin, evidencePath }) {
  await check('live rendering: every pill is as wide as its words and stands out from its row, in both schemes, laptop and phone, at rest and hovered', async () => {
    // Unread in the topic being read (more than its first screen holds), in
    // the outcome around it, and sent by name, so every count shape is drawn.
    await control({ method: 'navigation_topics', topics: [{ id: 'render-other', title: 'A neighbouring topic with a title long enough to wrap in the rail' }] });
    await control({ method: 'seed', messages: 40 });
    await control({ method: 'agent_message', operation_id: 'render-named', body: 'For you by name', topic_id: 'render-other', addressees: ['fixture-person'], join: true });
    await control({ method: 'agent_message', operation_id: 'render-plain', body: 'For anyone', topic_id: 'render-other', addressees: [] });
    const shots = join(evidencePath, 'rendering'); mkdirSync(shots, { recursive: true });
    const found = [];
    for (const [route, url, rows] of [['topic', origin + '/?topic=t1', ['#topics [aria-current=page]', '#workspaces [aria-current=page]', '#topics [data-topic-id="render-other"]']],
      ['outcomes', origin + '/', ['#workspaces [data-workspace-id="w1"]']]]) {
      for (const scheme of ['light', 'dark']) {
        for (const [layout, metrics] of [['laptop', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }], ['phone', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }]]) {
          const p = await page(`render-${route}-${scheme}-${layout}`, null, true, {
            url, beforeNavigate: async q => {
              await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
              await q.send('Emulation.setDeviceMetricsOverride', metrics);
            } });
          await until(() => p.evaluate(`[...document.querySelectorAll('.unread-count')].some(badge => badge.getBoundingClientRect().width > 0)`), 'unread counts are drawn');
          for (const row of [null, ...rows]) {
            if (row !== null) {
              const box = await p.evaluate(`(() => { const row = document.querySelector(${JSON.stringify(row)}); if (!row) return null; row.scrollIntoView({ block: 'center', inline: 'center' }); const b = row.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
              assert.ok(box, `${row} is drawn on the ${route} page`);
              await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
            }
            const state = `${route}-${scheme}-${layout}-${row === null ? 'rest' : 'hover-' + row.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`;
            const { pills, problems } = await p.evaluate(audit);
            assert.ok(pills > 0, `${state}: the sweep found the page's pills`);
            const image = await p.send('Page.captureScreenshot', { format: 'png' });
            writeFileSync(join(shots, state + '.png'), Buffer.from(image.data, 'base64'));
            for (const problem of problems) found.push({ state, ...problem });
          }
          await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
          assert.deepEqual(p.errors, []);
          await p.close();
        }
      }
    }
    assert.deepEqual(found, [], `rendering problems (screenshots in ${shots}):\n${found.map(problem => JSON.stringify(problem)).join('\n')}`);
  });
}
