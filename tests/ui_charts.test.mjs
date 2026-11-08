// A check's chart by release (item 104, D37; docs/targets.md): every mark is in the numbers table with what produced
// it and has an accessible name; a candidate is hollow and the legend says so; words with no number stand as words;
// colour comes from the chart tokens, never as a literal, and nothing waits on a timer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDocument } from './targets-dom.mjs';
import { CHART_RELEASES, chartColumns, checkChart, problemsChart } from '../web/charts.mjs';

const release = (number, value, more = {}) => ({ run_id: 'r' + number, release: number, candidate: false, label: `Release ${number}`, at_ms: Date.UTC(2026, 10, number - 10),
  value, words: `${value} minutes`, detail: {}, source: 'release-check', note: '', ...more });
const marks = root => root.querySelectorAll('rect');
const titleOf = mark => mark.querySelector('title').textContent;
const rows = card => card.querySelector('tbody').children.map(row => row.children.map(cell => cell.textContent));

test('the chart shows the last releases oldest first, one per release, and the newest candidate last', () => {
  const readings = [release(25, 9, { candidate: true, label: 'Release 25 candidate' }), release(24, 8), release(24, 8.5, { run_id: 'again' }),
    ...[23, 22, 21, 20, 19, 18, 17].map(number => release(number, number - 15)), { ...release(16, 1), release: null, run_id: 'by-hand', label: 'Measured by hand' }];
  const columns = chartColumns(readings);
  assert.deepEqual(columns.map(reading => reading.label), ['Release 19', 'Release 20', 'Release 21', 'Release 22', 'Release 23', 'Release 24', 'Release 25 candidate']);
  assert.equal(columns.filter(reading => !reading.candidate).length, CHART_RELEASES + 2);
  assert.equal(columns.find(reading => reading.release === 24).run_id, 'r24', 'the newest reading of a release, once');
});

test('every mark is in the numbers table, names its release and value, and a candidate is hollow and said so', t => {
  installDocument(t);
  const card = checkChart({ name: 'Release check time', unit: 'min', readings: [release(21, 22, { candidate: true, label: 'Release 21 candidate' }), release(20, 18), release(19, 17)] });
  const drawn = marks(card.querySelector('svg'));
  assert.deepEqual(drawn.map(titleOf), ['Release 19: 17 min', 'Release 20: 18 min', 'Release 21 candidate: 22 min']);
  assert.deepEqual(drawn.map(mark => mark.getAttribute('tabindex')), ['0', '0', '0'], 'each mark takes the keyboard');
  assert.deepEqual(drawn.map(mark => mark.getAttribute('class')), ['chart-mark s1', 'chart-mark s1', 'chart-mark s1 hollow']);
  assert.deepEqual(card.querySelectorAll('.chart-key').map(key => key.textContent), ['Hollow: a candidate, not shipped']);
  assert.deepEqual(rows(card).map(row => [row[0].split(',')[0], row[1], row[3]]),
    [['Release 21 candidate', '22 min', 'The release check'], ['Release 20', '18 min', 'The release check'], ['Release 19', '17 min', 'The release check']]);
  assert.equal(card.querySelector('svg').getAttribute('role'), 'img');
  assert.equal(card.querySelector('svg').getAttribute('aria-label'), 'Release check time, by release');
});

test('a reading with two parts draws two series with a legend; one series has none; words without a number stand as words', t => {
  installDocument(t);
  const units = n => release(n, 1846, { words: '1,106 server and 740 browser-side', detail: { parts: { server: 1106, 'browser-side': 740 } } });
  const parted = checkChart({ name: 'Unit checks', unit: 'cases', readings: [units(20), units(19)] });
  assert.deepEqual(parted.querySelectorAll('.chart-key').map(key => key.textContent), ['server', 'browser-side']);
  assert.equal(marks(parted.querySelector('svg')).length, 4);
  assert.deepEqual(rows(parted)[0].slice(1, 3), ['1,106', '740']);
  const single = checkChart({ name: 'Release check time', unit: 'min', readings: [release(20, 18), release(19, 17)] });
  assert.equal(single.querySelector('.chart-legend'), null);
  const wake = runs => release(20, 2, { words: 'slowest agent 2 s', detail: { series: { fable: { runs }, 'aim-ux': { runs: [1, 1.2] } } } });
  const oneRun = checkChart({ name: 'Wake replay', unit: 's', readings: [wake([2, 2.4])] });
  assert.deepEqual(marks(oneRun.querySelector('svg')).map(titleOf), ['fable, Release 20: half within 2.2 s', 'aim-ux, Release 20: half within 1.1 s']);
  assert.equal(oneRun.querySelector('.chart-legend'), null, 'one reading of each member needs no legend');
  const twoRuns = checkChart({ name: 'Wake replay', unit: 's', readings: [wake([2, 2.4]), { ...wake([3, 3]), release: 19, run_id: 'r19', label: 'Release 19' }] });
  assert.deepEqual(twoRuns.querySelectorAll('.chart-key').map(key => key.textContent), ['Release 19', 'Release 20'], 'oldest first, as the bars');
  const worded = checkChart({ name: 'Deck read-through', unit: '', readings: [release(20, null, { words: 'Read aloud, no stumbles', source: 'reported', note: 'by tony' })] });
  assert.equal(marks(worded.querySelector('svg')).length, 0);
  assert.equal(titleOf(worded.querySelector('.chart-words')), 'Release 20: Read aloud, no stumbles');
  assert.equal(rows(worded)[0][3], 'Reported: by tony');
});

test('problems found before a check stack by kind per release, and a release before the count began says so', t => {
  installDocument(t);
  const card = problemsChart({ releases: [{ release: 21, counts: { defect: 2, design_miss: 1 }, closed: 1 }, { release: 20, counts: null, state: 'live' }] });
  assert.deepEqual(marks(card.querySelector('svg')).map(titleOf), ['Release 21: 1 design miss', 'Release 21: 2 defects']);
  assert.deepEqual(rows(card), [['Release 21', '1', '2', '3 found, 1 closed'], ['Release 20', '', '', 'Not counted: the count began later']]);
});

test('the mark under the pointer, or holding the focus, is said in words under its chart, and the line empties when neither is on a mark', t => {
  installDocument(t);
  for (const card of [checkChart({ name: 'Release check time', unit: 'min', readings: [release(20, 18), release(19, 17)] }),
    problemsChart({ releases: [{ release: 21, counts: { defect: 2, design_miss: 1 }, closed: 1 }] })]) {
    const root = card.querySelector('svg'), line = card.querySelector('.chart-readout'), [first, second] = marks(root);
    assert.ok(line, 'every chart has its line');
    assert.equal(line.textContent, '', 'empty until a mark is pointed at or focused');
    root.dispatch('pointerover', { target: first });
    assert.equal(line.textContent, titleOf(first), 'the pointer on a mark says it');
    root.dispatch('pointerover', { target: root });
    assert.equal(line.textContent, '', 'off the marks, nothing is said');
    root.dispatch('focusin', { target: second });
    assert.equal(line.textContent, titleOf(second), 'a mark taking the focus says it');
    root.dispatch('pointerover', { target: first });
    assert.equal(line.textContent, titleOf(first), 'the pointer wins while it is on a mark');
    root.dispatch('pointerleave', { target: root });
    assert.equal(line.textContent, titleOf(second), 'and the focused mark is said again once the pointer leaves');
    root.dispatch('focusout', { target: second, relatedTarget: first });
    assert.equal(line.textContent, titleOf(first), 'focus moving to the next mark says that one');
    root.dispatch('focusout', { target: first, relatedTarget: null });
    assert.equal(line.textContent, '', 'focus leaving the chart empties the line');
  }
});

test('the charts draw colour only from the chart tokens and wait on no timer', () => {
  const source = readFileSync(new URL('../web/charts.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/, 'no colour literal');
  assert.doesNotMatch(source, /setTimeout|setInterval/);
  const css = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8');
  const rules = css.match(/\.chart-mark[^{]*\{[^}]*\}/g) ?? [];
  assert.ok(rules.length > 0, 'the marks are styled');
  for (const rule of rules) for (const colour of rule.match(/(?:fill|stroke):[^;}]+/g) ?? []) assert.match(colour, /^(?:fill|stroke):(?:var\(--[\w-]+\)|none|transparent)$/, rule);
  assert.ok(rules.some(rule => /fill:var\(--chart-/.test(rule)), 'a mark is filled from a chart token');
});
