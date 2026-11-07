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
  // While a modal dialog is open, the page behind it is inert and painted
  // under its backdrop, blurred and dimmed on purpose, or covered by the
  // dialog itself: its pills keep their shape and place, judged as ever, but
  // their colours are judged where the person can see them, with no dialog open.
  const modal = document.querySelector('dialog:modal');
  // The outcome light's peek (item 86) floats over the page while its row is
  // hovered: the pills it covers keep their shape and place, judged as ever,
  // and their colours are judged where the person sees them, with it closed.
  const peek = document.querySelector('#light-tip:not([hidden])'), peekBox = peek?.getBoundingClientRect();
  const problems = [], pills = [];
  for (const element of document.querySelectorAll('body *')) {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    // Words kept for screen readers alone are drawn one pixel square.
    if (box.width <= 2 || box.height <= 2 || style.visibility === 'hidden' || element.closest('[hidden]')) continue;
    // A pill is rounded to half the height of one line of its words, so one
    // whose words wrap onto a second line is still a pill, and a broken one.
    const line = (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) +
      parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    // A topic's state is a label whether it is drawn as a pill or, on the
    // topic's own page, as a box its words may wrap in: its colours are judged
    // either way, and its shape only as a pill.
    // A dialog is a window, not a pill, however round its corners.
    const pill = element.tagName !== 'DIALOG' && line <= 48 && parseFloat(style.borderTopLeftRadius) >= Math.min(box.height, line) / 2 - 1;
    if (!element.textContent.trim() || !(pill || element.matches('.topic-state'))) continue;
    if (element.scrollWidth > element.clientWidth + 1 && style.overflowX !== 'visible' && style.textOverflow !== 'ellipsis') problems.push({ kind: 'its words are cut off', at: where(element) });
    if (pill) {
      const range = document.createRange(); range.selectNodeContents(element);
      const words = range.getBoundingClientRect().width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) +
        parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
      // A least width keeps a short count round; beyond the pill's height it stretches it.
      if (box.width > Math.max(words, Math.min(parseFloat(style.minWidth) || 0, box.height)) + 2) problems.push({ kind: 'wider than its words', at: where(element), width: Math.round(box.width), words: Math.round(words) });
      const lines = new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.top + rect.height / 2)));
      if ([...lines].some(middle => [...lines].some(other => Math.abs(other - middle) > 4))) problems.push({ kind: 'its words wrap inside it', at: where(element) });
      // A pill that follows words sits on their last line, not on a line alone.
      const before = element.previousSibling;
      if (before?.nodeType === Node.TEXT_NODE && before.textContent.trim()) {
        const last = document.createRange(), text = before.textContent.trimEnd();
        last.setStart(before, text.length - 1); last.setEnd(before, text.length);
        const line = last.getBoundingClientRect(), middle = box.top + box.height / 2;
        if (middle < line.top || middle > line.bottom) problems.push({ kind: 'alone on its line', at: where(element) });
      }
    }
    // A box that hides what overflows it must not cut a pill it shows in part.
    // One that scrolls may hold it out of sight, which is not a fault.
    const clips = clippers(element);
    const cut = clips.find(({ style: s, box: outer }) => [s.overflowX, s.overflowY].some(o => o === 'hidden' || o === 'clip') && meets(box, outer) && !inside(box, outer));
    if (cut) problems.push({ kind: 'cut off by its box', at: where(element), by: where(cut.at) });
    if (inside(box, view) && clips.every(({ box: outer }) => inside(box, outer)) && !(modal && !modal.contains(element)) && !(peek && !peek.contains(element) && meets(box, peekBox))) {
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
    const ink = inner.reduce((most, pixel) => Math.max(most, ratio(pixel, fill)), 0);
    if (ink < 4.5) problems.push({ kind: 'faint words', at: pill.at, contrast: Number(ink.toFixed(2)) });
  }
  return problems;
}

// A state cut short still shows the reader that it waits on them, and the
// topic's own page shows its state whole.
const legible = `(() => {
  const problems = [], pen = document.createElement('canvas').getContext('2d');
  for (const mark of document.querySelectorAll('.topic-state.mine')) {
    const box = mark.getBoundingClientRect(), style = getComputedStyle(mark), text = mark.firstChild;
    // A mark not drawn, such as one in Topic settings while it is shut, shows no words to cut.
    if (mark.closest('[hidden]') || style.display === 'none' || !mark.getClientRects().length) continue;
    if (text?.nodeType !== Node.TEXT_NODE || !text.data.startsWith('Waiting on you')) { problems.push({ kind: 'a state waiting on the reader does not lead with you', at: mark.textContent.slice(0, 40) }); continue; }
    const range = document.createRange(), at = 'Waiting on '.length;
    range.setStart(text, at); range.setEnd(text, at + 3);
    // Letters stop where the content ends, less the ellipsis drawn when cut.
    pen.font = style.font;
    const end = box.left + mark.clientLeft + mark.clientWidth - parseFloat(style.paddingRight) -
      (mark.scrollWidth > mark.clientWidth + 1 ? pen.measureText('\u2026').width : 0);
    if (range.getBoundingClientRect().right > end + 0.5) problems.push({ kind: 'you is cut from a state', at: text.data.slice(0, 40) });
  }
  for (const mark of document.querySelectorAll('#topic-description .topic-state')) {
    if (mark.scrollWidth > mark.clientWidth + 1) problems.push({ kind: 'the topic page cuts its own state short', at: mark.textContent.slice(0, 40) });
  }
  return problems;
})()`;

export async function renderChecks({ check, page, until, control, origin, evidencePath }) {
  await check('live rendering: every pill is as wide as its words and stands out from its row, in both schemes, laptop and phone, at rest and hovered', async () => {
    // Unread in the topic being read (more than its first screen holds), in
    // the outcome around it, and sent by name, so every count shape is drawn.
    await control({ method: 'navigation_topics', topics: [{ id: 'render-other', title: 'A neighbouring topic with a title long enough to wrap in the rail' }] });
    const { message_ids: seeded } = await control({ method: 'seed', messages: 40 });
    // A third message, unmarked, opens the Reader with its Mark unread
    // button, pressed and not; two marked unread follow, below.
    const unmarked = seeded.at(-2);
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
    // Two messages the person marked unread: an agent's card, and a message
    // between two agents (a mark on the person's own counts nowhere), so the
    // Unread pill is drawn on a card and on a folded line.
    const between = await control({ method: 'agent_message', operation_id: 'render-between', body: 'Between agents, marked to come back to', topic_id: 't1', source: 'topic', addressees: [waiters[0]] });
    const markedIds = [seeded.at(-1), between.result.message_id];
    await control({ method: 'mark', operation_id: 'render-marks', message_ids: markedIds, marked: true });
    const counted = ['t1', 'render-other', ...crowd.map(topic => topic.id)];
    const shots = join(evidencePath, 'rendering'); mkdirSync(shots, { recursive: true });
    const found = [];
    const keep = (state, answer, image, legibility) => {
      writeFileSync(join(shots, state + '.png'), image);
      writeFileSync(join(shots, state + '.json'), JSON.stringify(answer, null, 1));
      for (const problem of [...answer.problems, ...judgePixels(image, answer), ...legibility]) found.push({ state, ...problem });
    };
    const topicRows = [...markedIds.map(id => `#messages [data-id="${id}"]`), '#topics [aria-current=page]', '#topics [data-topic-id="render-other"]', '#topics [data-topic-id="render-crowd-0"]', '#topics [data-topic-id="render-crowd-1"]', '#done-topic-list [data-topic-id="render-crowd-2"]', '#topics [data-topic-id="render-url"]'];
    // A done topic is listed under the Done line, which the person opens. Inside
    // an outcome the rail lists no outcomes; "← Outcomes" heads it instead.
    const listed = "(id => document.querySelector(':is(#topics, #done-topic-list) [data-topic-id=\"' + id + '\"] .unread-count'))";
    for (const [route, url, rows, ready] of [['topic', origin + '/?topic=t1', topicRows, `${JSON.stringify(counted)}.every(${listed}) && Boolean(document.querySelector('#topics [data-topic-id="render-crowd-0"] .topic-state')) && Boolean(document.querySelector('#topic-description .topic-state.mine')) && ${JSON.stringify(markedIds)}.every(id => document.querySelector('#messages [data-id="' + id + '"] .unread-mark'))`],
      // A plain state on the row shaded as the current topic.
      ['done', origin + '/?topic=render-crowd-2', ['#done-topic-list [aria-current=page]'], `${JSON.stringify(counted.filter(id => id !== 'render-crowd-2'))}.every(${listed}) && Boolean(document.querySelector('#done-topic-list [aria-current=page] .topic-state[data-state=done]'))`],
      ['outcomes', origin + '/', ['#workspaces [data-workspace-id="w1"]'], `Boolean(document.querySelector('#workspaces [data-workspace-id="w1"] .unread-count'))`]]) {
      for (const scheme of ['light', 'dark']) {
        for (const [layout, metrics] of [['laptop', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false }], ['phone', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }]]) {
          const p = await page(`render-${route}-${scheme}-${layout}`, null, true, {
            url, beforeNavigate: async q => {
              await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
              await q.send('Emulation.setDeviceMetricsOverride', metrics);
              // A phone has touch, and so no hover (hover: none), as on every phone check:
              // without it the page offers what only a mouse gets, such as the outcome light's peek.
              if (metrics.mobile) await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
            } });
          // Every row named here carries its count, and its state where it has
          // one. Topics left by earlier checks may sort before these, past the
          // rail's first page: the person asks for more until every row is drawn,
          // and opens the Done line, where the done topic is listed. Bringing
          // More into view scrolls the page, so where the page stood on arrival
          // is kept for the captures at rest.
          const arrived = await p.evaluate('[scrollX, scrollY]');
          await until(async () => {
            if (await p.evaluate(ready)) return true;
            if (await p.evaluate(`(line => Boolean(line && !line.hidden && !line.open) && (line.scrollIntoView({ block: 'center' }), true))(document.querySelector('#done-topics'))`)) await p.point('#done-topics-label');
            if (await p.evaluate(`(more => Boolean(more && !more.hidden && more.getAttribute('aria-disabled') !== 'true') && (more.scrollIntoView({ block: 'center', inline: 'center' }), true))(document.querySelector('#more-topics'))`)) await p.point('#more-topics');
            return false;
          }, 'every counted row is drawn with its count');
          for (const row of [null, ...rows]) {
            let box = null;
            const placed = `(() => { const row = document.querySelector(${JSON.stringify(row)}); if (!row) return null; const b = row.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, hovered: row.matches(':hover') }; })()`;
            // At rest the page stands where it opened, and the pointer is off
            // its content. On a phone a rail with this many rows (the key, the
            // Done line and the outcome's Notebook pages among them) fills the
            // first screen, and the person scrolls on to the topic's header.
            if (row === null) await p.evaluate(`scrollTo(${arrived[0]}, ${arrived[1]})`);
            if (row === null && route === 'topic') await p.evaluate(`(state => state.getBoundingClientRect().bottom > innerHeight && state.scrollIntoView({ block: 'center' }))(document.querySelector('#topic-description'))`);
            if (row === null) await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
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
            }, `${state}: ${row === null ? 'the page' : row + ' under the pointer'} and every pill stay put through a screenshot`, 30000);
            // The row under the pointer is in view, so the sweep judges its pills.
            if (box) assert.ok(answer.pills.some(pill => pill.left >= box.left - 1 && pill.top >= box.top - 1 && pill.left + pill.width <= box.right + 1 && pill.top + pill.height <= box.bottom + 1), `${state}: the sweep judged the hovered row's pills`);
            // The topic's own state is judged at rest, never skipped as out of view.
            if (route === 'topic' && row === null) assert.ok(answer.pills.some(pill => pill.at.startsWith('#topic-description ')), `${state}: the sweep judged the topic's own state`);
            keep(state, answer, image, await p.evaluate(legible));
          }
          // The Reader's Mark unread button, not pressed and then pressed, on a
          // message the person had not marked; pressed again, it is as it was.
          if (route === 'topic') {
            const card = `#messages [data-id="${unmarked}"]`, button = "document.querySelector('#mark-unread')";
            await p.evaluate(`document.querySelector(${JSON.stringify(card)}).scrollIntoView({ block: 'center' })`);
            await p.point(card);
            await until(() => p.evaluate(`document.querySelector('#reader').open && !${button}.hidden && ${button}.getAttribute('aria-pressed') === 'false' && document.getAnimations().every(a => a.playState !== 'running')`), 'the Reader offers Mark unread');
            await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
            keep(`${route}-${scheme}-${layout}-reader`, await p.evaluate(audit), Buffer.from((await p.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'), await p.evaluate(legible));
            await p.point('#mark-unread');
            await until(() => p.evaluate(`${button}.getAttribute('aria-pressed') === 'true' && ${button}.textContent === 'Marked unread'`), 'the button is pressed');
            await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
            keep(`${route}-${scheme}-${layout}-reader-marked`, await p.evaluate(audit), Buffer.from((await p.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'), await p.evaluate(legible));
            await p.point('#mark-unread');
            await until(() => p.evaluate(`${button}.getAttribute('aria-pressed') === 'false'`), 'pressed again, it is not marked');
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
