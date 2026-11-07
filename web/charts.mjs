// Small charts of a check's readings by release (item 104, D37; docs/targets.md):
// inline SVG with one axis, a numbers table under every chart naming what
// produced each reading, a <title> and keyboard focus on every mark, colour
// from the --chart-* tokens and never colour alone. A candidate's reading (not
// shipped) is drawn hollow, and the legend says so; a reading with words and
// no number stands as its words.
import { number } from './targets-words.mjs';

const NS = 'http://www.w3.org/2000/svg';
const W = 320, H = 170, LEFT = 34, RIGHT = 8, TOP = 14, BOTTOM = 34;
export const CHART_RELEASES = 4;

function svg(tag, attrs, ...kids) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs ?? {})) if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  for (const kid of kids) if (kid) node.append(kid);
  return node;
}
function html(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) if (value !== undefined && value !== null) key === 'text' ? node.textContent = value : node.setAttribute(key, value);
  for (const kid of kids) if (kid !== null && kid !== undefined) node.append(kid);
  return node;
}

function niceMax(value) {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= value) return step * power;
  return 10 * power;
}

// The readings a chart shows, oldest first: the last CHART_RELEASES releases, readings
// of no release (live traffic, by hand), and the newest candidate.
export function chartColumns(readings) {
  const seen = new Set(), settled = [];
  for (const reading of readings) {
    if (reading.candidate) continue;
    const key = reading.release === null || reading.release === undefined ? 'run:' + reading.run_id : 'release:' + reading.release;
    if (seen.has(key)) continue;
    seen.add(key);
    settled.push(reading);
  }
  const shown = settled.slice(0, CHART_RELEASES + 2).reverse();
  const candidate = readings.find(reading => reading.candidate);
  return candidate ? [...shown, candidate] : shown;
}

const shortLabel = reading => reading.candidate ? `Release ${reading.release} candidate` : reading.release !== null && reading.release !== undefined && /^Release/.test(reading.label) ? `Release ${reading.release}` : reading.label;
const dayOf = ms => (typeof ms === 'number' ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');

function seriesOf(columns) {
  const parts = columns.find(reading => reading.detail?.parts)?.detail.parts;
  // In the order the reading's own words give them ("1,106 server and 740 browser-side").
  const words = columns.find(reading => reading.detail?.parts)?.words ?? '';
  return parts ? Object.keys(parts).sort((a, b) => (words.indexOf(a) + 1 || 1e9) - (words.indexOf(b) + 1 || 1e9)) : null;
}

function legend(names, hollow) {
  const host = html('p', { class: 'chart-legend' });
  names.forEach((name, index) => host.append(html('span', { class: `chart-key s${index + 1}`, text: name })));
  if (hollow) host.append(html('span', { class: 'chart-key hollow', text: 'Hollow: a candidate, not shipped' }));
  return host;
}

function table(columns, names, check) {
  const body = html('tbody');
  for (const reading of [...columns].reverse()) {
    const values = names ? names.map(name => number(reading.detail?.parts?.[name] ?? '')) : [reading.value === null || reading.value === undefined ? '' : number(reading.value) + (check.unit && check.unit.length < 4 ? ' ' + check.unit : '')];
    const source = reading.source === 'found-problems' ? 'Counted from problems filed' : reading.source === 'reported' ? `Reported${reading.note ? ': ' + reading.note : ''}` : reading.note || 'The release check';
    body.append(html('tr', null, html('th', { scope: 'row', text: `${shortLabel(reading)}${reading.at_ms ? ', ' + dayOf(reading.at_ms) : ''}` }),
      ...values.map(value => html('td', { text: value })), html('td', { text: reading.words }), html('td', { class: 'muted', text: source })));
  }
  const head = html('tr', null, html('th', { scope: 'col', text: 'Reading' }), ...(names ?? ['Value']).map(name => html('th', { scope: 'col', text: name })),
    html('th', { scope: 'col', text: 'In words' }), html('th', { scope: 'col', text: 'What produced it' }));
  const details = html('details', { class: 'chart-numbers' }, html('summary', { text: 'Numbers, and what produced each' }),
    html('div', { class: 'table-scroll' }, html('table', null, html('thead', null, head), body)));
  return details;
}

// Columns by reading: grouped when a reading has parts (units: server and browser-side), one otherwise.
function columnChart(check, columns) {
  const names = seriesOf(columns);
  const valueOf = (reading, name) => (name ? reading.detail?.parts?.[name] : reading.value);
  const all = columns.flatMap(reading => (names ?? [null]).map(name => valueOf(reading, name))).filter(value => typeof value === 'number');
  const max = niceMax(Math.max(...all, 0));
  const plotW = W - LEFT - RIGHT, plotH = H - TOP - BOTTOM, slot = plotW / Math.max(columns.length, 1);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': `${check.name}, by release` });
  for (const tick of [0, 0.5, 1]) {
    const y = TOP + plotH * (1 - tick);
    root.append(svg('line', { x1: LEFT, x2: W - RIGHT, y1: y, y2: y, class: tick ? 'chart-grid' : 'chart-axis' }),
      svg('text', { x: LEFT - 4, y: y + 3, 'text-anchor': 'end', class: 'chart-tick' }, document.createTextNode(number(max * tick))));
  }
  const series = names ?? [null];
  columns.forEach((reading, index) => {
    const x0 = LEFT + slot * index, label = shortLabel(reading).replace('Release ', 'R. ').replace(' candidate', ' cand.');
    root.append(svg('text', { x: x0 + slot / 2, y: H - BOTTOM + 13, 'text-anchor': 'middle', class: 'chart-label' }, document.createTextNode(label)),
      svg('text', { x: x0 + slot / 2, y: H - BOTTOM + 25, 'text-anchor': 'middle', class: 'chart-label muted' }, document.createTextNode(dayOf(reading.at_ms))));
    const values = series.map(name => valueOf(reading, name));
    if (values.every(value => typeof value !== 'number')) {
      const words = svg('text', { x: x0 + slot / 2, y: TOP + plotH / 2, 'text-anchor': 'middle', class: 'chart-words', tabindex: 0 },
        document.createTextNode(reading.words.length > 18 ? reading.words.slice(0, 17) + '…' : reading.words));
      words.append(svg('title', null, document.createTextNode(`${shortLabel(reading)}: ${reading.words}`)));
      root.append(words);
      return;
    }
    const barW = Math.min(22, (slot - 10) / series.length);
    const start = x0 + (slot - barW * series.length) / 2;
    values.forEach((value, s) => {
      if (typeof value !== 'number') return;
      const height = plotH * value / max, y = TOP + plotH - height;
      const bar = svg('rect', { x: start + s * barW, y, width: barW - 2, height: Math.max(height, 1), class: `chart-mark s${s + 1}${reading.candidate ? ' hollow' : ''}`, tabindex: 0 });
      bar.append(svg('title', null, document.createTextNode(`${shortLabel(reading)}${series[s] ? ', ' + series[s] : ''}: ${number(value)}${check.unit && check.unit.length < 4 ? ' ' + check.unit : ''}`)));
      root.append(bar);
      if (series.length === 1 || s === 0) root.append(svg('text', { x: start + s * barW + (barW - 2) / 2, y: y - 3, 'text-anchor': 'middle', class: 'chart-value' }, document.createTextNode(number(value))));
    });
  });
  return { root, names: names ?? null };
}

// A measure with members (the wake time): one row of bars per member, one bar per reading.
function memberChart(check, columns) {
  const withSeries = columns.filter(reading => reading.detail?.series);
  const members = [...new Set(withSeries.flatMap(reading => Object.keys(reading.detail.series)))];
  const median = runs => { const sorted = [...runs].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };
  const valueOf = (reading, member) => { const runs = reading.detail.series[member]?.runs; return Array.isArray(runs) && runs.length ? median(runs) : null; };
  const all = withSeries.flatMap(reading => members.map(member => valueOf(reading, member))).filter(value => typeof value === 'number');
  const max = niceMax(Math.max(...all, 0));
  const rowH = 12 * withSeries.length + 10, height = TOP + rowH * members.length + 22;
  const root = svg('svg', { viewBox: `0 0 ${W} ${height}`, class: 'chart', role: 'img', 'aria-label': `${check.name}, by member` });
  const plotW = W - 70 - RIGHT;
  members.forEach((member, m) => {
    const y0 = TOP + m * rowH;
    root.append(svg('text', { x: 64, y: y0 + 9, 'text-anchor': 'end', class: 'chart-label' }, document.createTextNode(member)));
    withSeries.forEach((reading, r) => {
      const value = valueOf(reading, member);
      if (typeof value !== 'number') return;
      const width = Math.max(plotW * value / max, 1), y = y0 + r * 12;
      const bar = svg('rect', { x: 70, y, width, height: 9, class: `chart-mark s${r + 1}${reading.candidate ? ' hollow' : ''}`, tabindex: 0 });
      bar.append(svg('title', null, document.createTextNode(`${member}, ${shortLabel(reading)}: half within ${number(value)} ${check.unit}`)));
      root.append(bar, svg('text', { x: 74 + width, y: y + 8, class: 'chart-value' }, document.createTextNode(`${number(value)} ${check.unit}`)));
    });
  });
  const axisY = TOP + rowH * members.length + 4;
  root.append(svg('line', { x1: 70, x2: W - RIGHT, y1: axisY, y2: axisY, class: 'chart-axis' }));
  for (const tick of [0, 0.5, 1]) root.append(svg('text', { x: 70 + plotW * tick, y: axisY + 12, 'text-anchor': 'middle', class: 'chart-tick' }, document.createTextNode(`${number(max * tick)} ${check.unit}`)));
  return { root, names: withSeries.map(shortLabel), byMember: true };
}

// Stacked columns by kind for problems found before a check, from the view's problems facts.
export function problemsChart(problems) {
  const releases = [...(problems?.releases ?? [])].reverse();
  const values = releases.map(r => (r.counts ? r.counts.design_miss + r.counts.defect : 0));
  const max = niceMax(Math.max(...values, 3));
  const plotW = W - LEFT - RIGHT, plotH = H - TOP - BOTTOM, slot = plotW / Math.max(releases.length, 1);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Problems found before a check, by release' });
  for (const tick of [0, 0.5, 1]) {
    const y = TOP + plotH * (1 - tick);
    root.append(svg('line', { x1: LEFT, x2: W - RIGHT, y1: y, y2: y, class: tick ? 'chart-grid' : 'chart-axis' }),
      svg('text', { x: LEFT - 4, y: y + 3, 'text-anchor': 'end', class: 'chart-tick' }, document.createTextNode(number(max * tick))));
  }
  releases.forEach((release, index) => {
    const x0 = LEFT + slot * index, barW = Math.min(26, slot - 14), x = x0 + (slot - barW) / 2;
    root.append(svg('text', { x: x0 + slot / 2, y: H - BOTTOM + 13, 'text-anchor': 'middle', class: 'chart-label' }, document.createTextNode(`Release ${release.release}`)));
    if (!release.counts) {
      const words = release.state === 'candidate' ? 'counted once it ships' : 'not counted: the count began later';
      root.append(svg('text', { x: x0 + slot / 2, y: TOP + plotH / 2, 'text-anchor': 'middle', class: 'chart-words' }, document.createTextNode(words.length > 22 ? words.slice(0, 21) + '…' : words)));
      return;
    }
    let y = TOP + plotH;
    [['design_miss', 1, 'design miss', 'design misses'], ['defect', 2, 'defect', 'defects']].forEach(([key, s, one, many]) => {
      const count = release.counts[key];
      if (!count) return;
      const height = plotH * count / max;
      y -= height;
      const bar = svg('rect', { x, y, width: barW, height, class: `chart-mark s${s}`, tabindex: 0 });
      bar.append(svg('title', null, document.createTextNode(`Release ${release.release}: ${count} ${count === 1 ? one : many}`)));
      root.append(bar);
    });
    root.append(svg('text', { x: x + barW / 2, y: y - 3, 'text-anchor': 'middle', class: 'chart-value' }, document.createTextNode(String(values[index]))));
  });
  const body = html('tbody');
  for (const release of [...releases].reverse()) {
    body.append(html('tr', null, html('th', { scope: 'row', text: `Release ${release.release}` }),
      html('td', { text: release.counts ? String(release.counts.design_miss) : '' }), html('td', { text: release.counts ? String(release.counts.defect) : '' }),
      html('td', { text: release.counts ? `${release.counts.design_miss + release.counts.defect} found, ${release.closed} closed` : release.state === 'candidate' ? 'Counted once it ships' : 'Not counted: the count began later' })));
  }
  const numbers = html('details', { class: 'chart-numbers' }, html('summary', { text: 'Numbers, and what produced each' }),
    html('div', { class: 'table-scroll' }, html('table', null, html('thead', null, html('tr', null, ...['Release', 'Design misses', 'Defects', 'Note'].map(text => html('th', { scope: 'col', text })))), body)));
  return html('figure', { class: 'chart-card' }, html('figcaption', null, html('strong', { text: 'Problems found before a check' }),
    html('span', { class: 'muted', text: 'Found in the live app before any check caught them. Fewer per release is the aim.' })),
  root, legend(['Design miss', 'Defect'], false), numbers);
}

// One check's chart card: its name, the chart, the legend and the numbers.
export function checkChart(check) {
  const columns = chartColumns(check.readings ?? []);
  const members = columns.some(reading => reading.detail?.series);
  const drawn = members ? memberChart(check, columns) : columnChart(check, columns);
  const hollow = columns.some(reading => reading.candidate);
  const names = drawn.byMember ? drawn.names : drawn.names;
  return html('figure', { class: 'chart-card' }, html('figcaption', null, html('strong', { text: check.name }), check.explain ? html('span', { class: 'muted', text: check.explain }) : null),
    drawn.root, names && names.length > 1 ? legend(names, hollow) : hollow ? legend([], true) : null, table(columns, drawn.byMember ? null : drawn.names, check));
}
