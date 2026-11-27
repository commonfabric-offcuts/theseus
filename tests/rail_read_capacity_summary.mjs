import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const folders = process.argv.slice(2);
assert.ok(folders.length, 'usage: node summary.mjs RUN_DIRECTORY [...]');

function distribution(values) {
  if (!values.length) return {};
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return {n: sorted.length, p50: percentile(0.5), p90: percentile(0.9), p95: percentile(0.95), max: sorted.at(-1)};
}

function addCount(to, counts) {
  for (const [key, n] of Object.entries(counts)) to[key] = (to[key] ?? 0) + n;
}

const result = [];
for (const folder of folders) {
  const metadata = JSON.parse(await readFile(resolve(folder, 'run.json'), 'utf8'));
  const lines = (await readFile(resolve(folder, 'observations.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const groups = new Map();
  for (const sample of lines) {
    const id = [sample.variant, sample.size, sample.count, sample.stimulus].filter(value => value !== undefined).join('/');
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(sample);
  }
  const cells = {};
  for (const [id, samples] of groups) {
    const n = samples.length * samples[0].count;
    const reasons = {}, admissionByView = {}, views = {}, railViews = {}, serverBusyByView = {}, paint = {feed: [], links: []};
    const sectionPaint = new Map(), lastSection = [];
    let notices = 0, paintMisses = 0, maxForeground = 0, maxBackground = 0, allRequests = 0, transportErrors = 0, refusedConnections = 0;
    let completeRailMisses = 0;
    const trialLoads = [];
    for (const sample of samples) {
      addCount(reasons, sample.refusalReasons);
      addCount(admissionByView, sample.admissionByView);
      refusedConnections += sample.refusedConnections ?? 0;
      if (sample.beforeCommitLoad) trialLoads.push(sample.beforeCommitLoad[0]);
      maxForeground = Math.max(maxForeground, sample.maximumWaiting.foreground);
      maxBackground = Math.max(maxBackground, sample.maximumWaiting.background);
      for (const browser of sample.receipts) {
        if (browser.notice || browser.notices.some(row => !row.hidden)) notices++;
        if (browser.primaryPaintedInWindow === false) paintMisses++;
        if (browser.railPaintedInWindow === false) completeRailMisses++;
        if (Number.isFinite(browser.lastSectionMs)) lastSection.push(browser.lastSectionMs);
        for (const key of browser.expectedSections ?? []) {
          if (!sectionPaint.has(key)) sectionPaint.set(key, {times: [], missed: 0, changed: 0, inViewport: 0});
          const stats = sectionPaint.get(key), part = browser.sections[key];
          if (!part) { stats.missed++; continue; }
          stats.times.push(part.ms);
          if (part.changed) stats.changed++;
          if (part.inViewport) stats.inViewport++;
        }
        addCount(views, browser.refusals);
        for (const row of browser.requests) {
          allRequests++;
          if (row.transportError) transportErrors++;
          if (row.rail && row.status === 503) addCount(railViews, {[row.name]: 1});
          if (row.error === 'SERVER_BUSY') addCount(serverBusyByView, {[row.name]: 1});
        }
        for (const surface of Object.keys(paint)) {
          if (Number.isFinite(browser.commitToPaint[surface])) paint[surface].push(browser.commitToPaint[surface]);
        }
      }
    }
    const sections = Object.fromEntries([...sectionPaint].map(([key, {times, ...stats}]) => [key, {...distribution(times), ...stats}]));
    cells[id] = {trials: samples.length, n, allRequests, transportErrors, refusedConnections, maxForeground, maxBackground, notices, paintMisses,
      byReason: reasons, admissionByView, byView: views, visibleRailByView: railViews, serverBusyByView,
      feedPaintMs: distribution(paint.feed), linksPaintMs: distribution(paint.links),
      sections, lastSectionMs: distribution(lastSection), completeRailMisses, trialLoad: distribution(trialLoads)};
  }
  result.push({folder, metadata, cells});
}
console.log(JSON.stringify(result, null, 2));
