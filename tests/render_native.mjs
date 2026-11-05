import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pngPixels } from './png-bands.mjs';

// How the page is painted, not only what it holds. In each colour scheme and
// at laptop and phone width, at rest and with the pointer over a row, every
// pill on the page (an element rounded to half its height that carries words,
// such as an unread count or a topic's state) must be as wide as its words,
// sit beside the words it follows, show whole inside any box that clips it,
// and, judged from the screenshot's pixels, stand out from what is painted
// around it and carry readable words. No element may stick out of a box that
// scrolls it upright, and the page must not scroll sideways. Each state's
// screenshot is kept beside the run's evidence.

// The page's half: geometry, and each whole pill's box for the pixels.
export const audit = `(() => {
  const where = element => {
    const path = [];
    for (let at = element; at && at !== document.body; at = at.parentElement) {
      path.unshift(at.id ? '#' + at.id : at.tagName.toLowerCase() + (at.className && typeof at.className === 'string' ? '.' + at.className.trim().split(/\\s+/).join('.') : '') +
        (at.dataset?.topicId ? '[topic=' + at.dataset.topicId + ']' : at.dataset?.workspaceId ? '[outcome=' + at.dataset.workspaceId + ']' : ''));
      if (at.id) break;
    }
    return path.join(' > ') + ' "' + element.textContent.trim().slice(0, 30) + '"';
  };
  // The boxes that clip an element: from its containing block outward when it
  // is placed absolutely, and none when it is fixed.
  const clippers = element => {
    const place = getComputedStyle(element).position, boxes = [];
    if (place === 'fixed') return boxes;
    for (let at = place === 'absolute' ? element.offsetParent : element.parentElement; at && at !== document.body && at !== document.documentElement; at = at.parentElement) {
      const style = getComputedStyle(at);
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') boxes.push({ at, style, box: at.getBoundingClientRect() });
    }
    return boxes;
  };
  const inside = (box, outer) => box.left >= outer.left - 1 && box.right <= outer.right + 1 && box.top >= outer.top - 1 && box.bottom <= outer.bottom + 1;
  const meets = (box, outer) => box.right > outer.left && box.left < outer.right && box.bottom > outer.top && box.top < outer.bottom;
  const view = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  const problems = [], pills = [];
  for (const element of document.querySelectorAll('body *')) {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    // Words kept for screen readers alone are drawn one pixel square.
    if (box.width <= 2 || box.height <= 2 || style.visibility === 'hidden' || element.closest('[hidden]')) continue;
    // A pill is rounded to half the height of one line of its words, so one
    // whose words wrap onto a second line is still a pill, and a broken one.
    const line = (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) +
      parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    if (!element.textContent.trim() || line > 48 || parseFloat(style.borderTopLeftRadius) < Math.min(box.height, line) / 2 - 1) continue;
    const range = document.createRange(); range.selectNodeContents(element);
    const words = range.getBoundingClientRect().width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) +
      parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    // A least width keeps a short count round; beyond the pill's height it stretches it.
    if (box.width > Math.max(words, Math.min(parseFloat(style.minWidth) || 0, box.height)) + 2) problems.push({ kind: 'wider than its words', at: where(element), width: Math.round(box.width), words: Math.round(words) });
    const lines = new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.top + rect.height / 2)));
    if ([...lines].some(middle => [...lines].some(other => Math.abs(other - middle) > 4))) problems.push({ kind: 'its words wrap inside it', at: where(element) });
    if (element.scrollWidth > element.clientWidth + 1 && style.overflowX !== 'visible' && style.textOverflow !== 'ellipsis') problems.push({ kind: 'its words are cut off', at: where(element) });
    // A pill that follows words sits on their last line, not on a line alone.
    const before = element.previousSibling;
    if (before?.nodeType === Node.TEXT_NODE && before.textContent.trim()) {
      const last = document.createRange(), text = before.textContent.trimEnd();
      last.setStart(before, text.length - 1); last.setEnd(before, text.length);
      const line = last.getBoundingClientRect(), middle = box.top + box.height / 2;
      if (middle < line.top || middle > line.bottom) problems.push({ kind: 'alone on its line', at: where(element) });
    }
    // A box that hides what overflows it must not cut a pill it shows in part.
    // One that scrolls may hold it out of sight, which is not a fault.
    const clips = clippers(element);
    const cut = clips.find(({ style: s, box: outer }) => [s.overflowX, s.overflowY].some(o => o === 'hidden' || o === 'clip') && meets(box, outer) && !inside(box, outer));
    if (cut) problems.push({ kind: 'cut off by its box', at: where(element), by: where(cut.at) });
    if (inside(box, view) && clips.every(({ box: outer }) => inside(box, outer))) {
      pills.push({ at: where(element), left: box.left, top: box.top, width: box.width, height: box.height, border: parseFloat(style.borderTopWidth) });
    }
  }
  // A box that scrolls upright, as the wide rail does, holds its rows inside
  // its width; a strip laid out in one row, as the phone rail is, scrolls
  // sideways on purpose.
  for (const element of document.querySelectorAll('body *')) {
    if (element.closest('[hidden]') || !element.getBoundingClientRect().width) continue;
    const scroller = clippers(element).find(({ style }) => ['auto', 'scroll'].includes(style.overflowX))?.at;
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth + 1) continue;
    const layout = getComputedStyle(scroller);
    if (layout.display.includes('flex') && layout.flexDirection.startsWith('row') && layout.flexWrap === 'nowrap') continue;
    const right = scroller.getBoundingClientRect().left + scroller.clientLeft + scroller.clientWidth;
    if (element.getBoundingClientRect().right > right + 1 && !(element.parentElement !== scroller && element.parentElement.getBoundingClientRect().right > right + 1)) {
      problems.push({ kind: 'sticks out of the box that scrolls it', at: where(element), by: where(scroller) });
    }
  }
  const page = document.scrollingElement;
  if (page.scrollWidth > page.clientWidth + 1) {
    // Name the outermost elements reaching past the right edge that no box holds.
    const past = element => element.getBoundingClientRect().right > page.clientWidth + 1;
    const held = element => clippers(element).length > 0;
    const wide = [...document.querySelectorAll('body *')].filter(element => past(element) && !held(element) && !(element.parentElement && past(element.parentElement) && !held(element.parentElement)));
    problems.push({ kind: 'the page scrolls sideways', width: page.scrollWidth, view: page.clientWidth, by: wide.slice(0, 3).map(where) });
  }
  return { pills, problems, width: innerWidth };
})()`;

const luminance = color => color.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
  .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// The colour most of a set of pixels has.
const most = pixels => {
  const counts = new Map();
  for (const pixel of pixels) { const key = pixel.join(','); counts.set(key, (counts.get(key) ?? 0) + 1); }
  return [...counts].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
};

// The screenshot's half. A pill's fill is the colour most of its inside has;
// its edge, that of its top and bottom rows; what is behind it, that of a
// ring three to five pixels outside. Its words are the inside pixel furthest
// from its fill. Shadows, gradients, layers and fading all count, as the
// person sees them.
export function judgePixels(png, { pills, width }) {
  const image = pngPixels(png), scale = image.width / width, problems = [];
  const at = (x, y) => image.pixel(Math.min(image.width - 1, Math.max(0, Math.round(x))), Math.min(image.height - 1, Math.max(0, Math.round(y))));
  for (const pill of pills) {
    const left = pill.left * scale, top = pill.top * scale, right = (pill.left + pill.width) * scale, bottom = (pill.top + pill.height) * scale;
    // The browser snaps a border to whole pixels, so it may sit a pixel from
    // where the box measures: the edge is the row of each band, top and
    // bottom, that stands out most, and the inside and the ring keep clear of it.
    const border = Math.max(1, Math.ceil(pill.border * scale)), middle = [left + (right - left) / 4, right - (right - left) / 4];
    const inner = [], ring = [], rows = [];
    for (let y = top + border + 2; y < bottom - border - 2; y++) for (let x = left + border + 2; x < right - border - 2; x++) inner.push(at(x, y));
    for (let x = middle[0]; x < middle[1]; x++) for (let d = 3; d <= 5; d++) ring.push(at(x, top - d), at(x, bottom - 1 + d));
    for (let y = top + (bottom - top) / 3; y < bottom - (bottom - top) / 3; y++) for (let d = 3; d <= 5; d++) ring.push(at(left - d, y), at(right - 1 + d, y));
    if (!inner.length || !ring.length) continue;
    const fill = most(inner), around = most(ring);
    for (const y of [...Array(border + 2).keys()].flatMap(d => [Math.floor(top) - 1 + d, Math.ceil(bottom) - border - 1 + d])) {
      const row = [];
      for (let x = middle[0]; x < middle[1]; x++) row.push(at(x, y));
      rows.push(most(row));
    }
    const stands = Math.max(ratio(fill, around), ...rows.map(row => ratio(row, around)));
    if (stands < 1.15) problems.push({ kind: 'blends into what is around it', at: pill.at, contrast: Number(stands.toFixed(2)) });
    const ink = Math.max(...inner.map(pixel => ratio(pixel, fill)));
    if (ink < 4.5) problems.push({ kind: 'faint words', at: pill.at, contrast: Number(ink.toFixed(2)) });
  }
  return problems;
}

// A state cut short still shows the reader that it waits on them, and the
// topic's own page shows its state whole.
const legible = `(() => {
  const problems = [];
  for (const mark of document.querySelectorAll('.topic-state.mine')) {
    const text = mark.firstChild, box = mark.getBoundingClientRect();
    if (!box.width || mark.closest('[hidden]') || text?.nodeType !== Node.TEXT_NODE) continue;
    const at = text.data.indexOf('you'), range = document.createRange();
    if (at < 0) { problems.push({ kind: 'a state waiting on the reader does not say so', at: text.data }); continue; }
    range.setStart(text, at); range.setEnd(text, at + 3);
    const you = range.getBoundingClientRect();
    if (you.right > box.left + mark.clientLeft + mark.clientWidth + 1) problems.push({ kind: 'you is cut from a state', at: text.data.slice(0, 40) });
  }
  for (const mark of document.querySelectorAll('#topic-state .topic-state')) {
    if (mark.scrollWidth > mark.clientWidth + 1) problems.push({ kind: 'the topic page cuts its own state short', at: mark.textContent.slice(0, 40) });
  }
  return problems;
})()`;

export async function renderChecks({ check, page, until, control, origin, evidencePath }) {
  await check('live rendering: every pill is as wide as its words and stands out from its row, in both schemes, laptop and phone, at rest and hovered', async () => {
    // Unread in the topic being read (more than its first screen holds), in
    // the outcome around it, and sent by name, so every count shape is drawn.
    await control({ method: 'navigation_topics', topics: [{ id: 'render-other', title: 'A neighbouring topic with a title long enough to wrap in the rail' }] });
    await control({ method: 'seed', messages: 40 });
    await control({ method: 'agent_message', operation_id: 'render-named', body: 'For you by name', topic_id: 'render-other', addressees: ['fixture-person'], join: true });
    await control({ method: 'agent_message', operation_id: 'render-plain', body: 'For anyone', topic_id: 'render-other', addressees: [] });
    // Titles that end without a place to break, a rail with more counted rows
    // than a phone shows, and each state a row can carry.
    const crowd = [{ id: 'render-url', title: 'Plan at https://example.com/a-very-long-path-without-any-spaces-at-all-in-it' },
      { id: 'render-cjk', title: '共有された目標と評価についての長い題名がここに続きます' },
      ...Array.from({ length: 4 }, (_, n) => ({ id: `render-crowd-${n}`, title: `Crowded rail topic ${n}` }))];
    await control({ method: 'navigation_topics', topics: crowd });
    for (const { id } of crowd) await control({ method: 'agent_message', operation_id: `render-${id}`, body: 'Unread here', topic_id: id, addressees: [], join: true });
    await control({ method: 'topic_state', operation_id: 'render-state-mine', topic_id: 'render-other', args: { state: 'waiting', waiting_on: ['fixture-person'] } });
    await control({ method: 'topic_state', operation_id: 'render-state-review', topic_id: 'render-crowd-0', args: { state: 'review' } });
    await control({ method: 'topic_state', operation_id: 'render-state-waiting', topic_id: 'render-crowd-1', args: { state: 'waiting', waiting_on: ['fixture-notebook-agent'] } });
    await control({ method: 'topic_state', operation_id: 'render-state-done', topic_id: 'render-crowd-2', args: { state: 'done' } });
    // The topic being read waits on a list long enough to be cut short in the
    // rail and to wrap on its own page, the reader among them.
    const waiters = ['fixture-planning-agent', 'fixture-reviewing-agent', 'fixture-writing-agent'];
    await control({ method: 'topic_state', operation_id: 'render-state-long', topic_id: 't1', participants: waiters,
      args: { state: 'waiting', waiting_on: ['fixture-notebook-agent', ...waiters, 'fixture-person'] } });
    const counted = ['t1', 'render-other', ...crowd.map(topic => topic.id)];
    const shots = join(evidencePath, 'rendering'); mkdirSync(shots, { recursive: true });
    const found = [];
    const topicRows = ['#topics [aria-current=page]', '#workspaces [aria-current=page]', '#topics [data-topic-id="render-other"]', '#topics [data-topic-id="render-crowd-0"]', '#topics [data-topic-id="render-crowd-1"]', '#topics [data-topic-id="render-crowd-2"]', '#topics [data-topic-id="render-url"]'];
    for (const [route, url, rows, ready] of [['topic', origin + '/?topic=t1', topicRows, `${JSON.stringify(counted)}.every(id => document.querySelector('#topics [data-topic-id="' + id + '"] .unread-count')) && Boolean(document.querySelector('#workspaces [data-workspace-id="w1"] .unread-count')) && Boolean(document.querySelector('#topics [data-topic-id="render-crowd-0"] .topic-state')) && Boolean(document.querySelector('#topic-state .topic-state.mine'))`],
      // A plain state on the row shaded as the current topic.
      ['done', origin + '/?topic=render-crowd-2', ['#topics [aria-current=page]'], `Boolean(document.querySelector('#topics [aria-current=page] .topic-state[data-state=done]'))`],
      ['outcomes', origin + '/', ['#workspaces [data-workspace-id="w1"]'], `Boolean(document.querySelector('#workspaces [data-workspace-id="w1"] .unread-count'))`]]) {
      for (const scheme of ['light', 'dark']) {
        for (const [layout, metrics] of [['laptop', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false }], ['phone', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }]]) {
          const p = await page(`render-${route}-${scheme}-${layout}`, null, true, {
            url, beforeNavigate: async q => {
              await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
              await q.send('Emulation.setDeviceMetricsOverride', metrics);
            } });
          // Every row named here carries its count, and its state where it has one.
          await until(() => p.evaluate(ready), 'every counted row is drawn with its count');
          for (const row of [null, ...rows]) {
            let box = null;
            const placed = `(() => { const row = document.querySelector(${JSON.stringify(row)}); if (!row) return null; const b = row.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, hovered: row.matches(':hover') }; })()`;
            if (row !== null) assert.ok(await p.evaluate(`(() => { const row = document.querySelector(${JSON.stringify(row)}); row?.scrollIntoView({ block: 'center', inline: 'center' }); return Boolean(row); })()`), `${row} is drawn on the ${route} page`);
            const state = `${route}-${scheme}-${layout}-${row === null ? 'rest' : 'hover-' + row.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`;
            // The page may still be settling, as a count changes while it reads
            // and its row is drawn anew, or as messages load: the pointer follows
            // the row, and the measures and screenshot count only once the row
            // stayed put under it, and every pill where it was, from before the
            // measures until after the screenshot.
            const { answer, image } = await until(async () => {
              if (row !== null) {
                const now = await p.evaluate(placed);
                assert.ok(now, `${row} is still drawn on the ${route} page`);
                if (!now.hovered || JSON.stringify(now) !== JSON.stringify(box)) {
                  box = now;
                  if (!now.hovered) await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: (now.left + now.right) / 2, y: (now.top + now.bottom) / 2 });
                  return false;
                }
              }
              const answer = await p.evaluate(audit);
              const image = Buffer.from((await p.send('Page.captureScreenshot', { format: 'png' })).data, 'base64');
              if (row !== null && JSON.stringify(await p.evaluate(placed)) !== JSON.stringify(box)) return false;
              // The page as measured is the page in the screenshot: every pill
              // stands where it stood, so a page still laying out is taken again.
              if (JSON.stringify((await p.evaluate(audit)).pills) !== JSON.stringify(answer.pills)) return false;
              return { answer, image };
            }, `${state}: ${row} stays under the pointer through its screenshot`, 30000);
            // The row under the pointer is in view, so the sweep judges its pills.
            if (box) assert.ok(answer.pills.some(pill => pill.left >= box.left - 1 && pill.top >= box.top - 1 && pill.left + pill.width <= box.right + 1 && pill.top + pill.height <= box.bottom + 1), `${state}: the sweep judged the hovered row's pills`);
            writeFileSync(join(shots, state + '.png'), image);
            writeFileSync(join(shots, state + '.json'), JSON.stringify(answer, null, 1));
            for (const problem of [...answer.problems, ...judgePixels(image, answer), ...await p.evaluate(legible)]) found.push({ state, ...problem });
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
