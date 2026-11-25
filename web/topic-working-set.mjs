import { dossiersOf } from './stack-order.mjs';

export const TOPIC_RECORD_BUDGET = 300;
export const TOPIC_RUN_BUDGET = 8;
export const TOPIC_HINT_BUDGET = 256;

// Runs describe complete loaded topic intervals, not adjacent sequence numbers:
// private messages and other topics leave legitimate holes in global seq.
export function retainedRuns(messages, runs, keep) {
  const groups = new Map();
  for (const item of messages.values()) {
    const key = runs.get(item.id) ?? item.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const result = [];
  for (const items of groups.values()) {
    items.sort((a, b) => a.seq - b.seq);
    let next = null;
    for (const item of items) {
      if (!keep.has(item.id)) { next = null; continue; }
      if (!next) { next = []; result.push(next); }
      next.push(item.id);
    }
  }
  return result;
}

// This planner retains identities only. The caller releases the actual maps,
// DOM and other owners as one fenced application. Roots reserve a record even
// when their asynchronous named read has not yet returned.
export function planTopicWindow(messages, runs, { pins = [], anchor = null, prefer = [], budget = TOPIC_RECORD_BUDGET,
  maxRuns = TOPIC_RUN_BUDGET, roots = dossiersOf([...messages.values()]), newest = 30 } = {}) {
  const ordered = [...messages.values()].sort((a, b) => b.seq - a.seq);
  const keep = new Set(), full = new Set(), missing = new Set();
  const groups = new Map(), neighbors = new Map();
  for (const item of ordered) {
    const run = runs.get(item.id) ?? item.id;
    if (!groups.has(run)) groups.set(run, []);
    groups.get(run).push(item.id);
  }
  for (const ids of groups.values()) for (let at = 0; at < ids.length; at++) neighbors.set(ids[at], [ids[at - 1], ids[at + 1]]);
  let count = 0;
  const adding = id => {
    if (!messages.has(id)) return null;
    const root = roots.get(id) ?? id;
    const ids = new Set([id, root]);
    return { ids, loaded: [...ids].filter(each => messages.has(each)) };
  };
  const admit = (id, required = false) => {
    const next = adding(id); if (!next) return true;
    const total = new Set([...full, ...next.ids]);
    const loaded = new Set([...keep, ...next.loaded]);
    const staged = new Set(keep); let nextCount = count;
    for (const each of next.loaded) if (!staged.has(each)) {
      const [before, after] = neighbors.get(each);
      nextCount += 1 - Number(staged.has(before)) - Number(staged.has(after)); staged.add(each);
    }
    if (total.size > budget || nextCount > maxRuns) {
      if (required) missing.add(id);
      return false;
    }
    for (const each of total) full.add(each);
    for (const each of loaded) keep.add(each);
    count = nextCount;
    return true;
  };
  for (const id of pins) admit(id, true);
  // An explicit older/linked read gets a foothold before passive arrivals.
  for (const id of prefer) admit(id);
  for (const item of ordered.slice(0, newest)) admit(item.id);
  let center = ordered.findIndex(item => item.id === anchor);
  if (center < 0) center = 0;
  for (let distance = 0; distance < ordered.length; distance++) {
    for (const at of distance ? [center + distance, center - distance] : [center]) {
      if (ordered[at]) admit(ordered[at].id);
    }
  }
  return { keep, full, roots: new Set([...full].filter(id => !keep.has(id))),
    runs: retainedRuns(messages, runs, keep), rejectedPins: missing, blocked: missing.size > 0,
    evict: [...messages.keys()].filter(id => !keep.has(id)), budget };
}

export function boundMap(map, limit = TOPIC_HINT_BUDGET) {
  while (map.size > limit) map.delete(map.keys().next().value);
  return map;
}

// Acts use the existing sequence-cursor view. Seek each complete retained
// interval, and each supplemental/Reader original separately; never walk the
// unloaded history between an old held source and today's cards.
export function topicActRanges(messages, runs, alone = null) {
  const groups = new Map();
  const add = (item, key) => {
    const range = groups.get(key) ?? { oldest: item.seq, newest: item.seq, count: 0 };
    range.oldest = Math.min(range.oldest, item.seq); range.newest = Math.max(range.newest, item.seq); ++range.count;
    groups.set(key, range);
  };
  for (const item of messages.values()) add(item, runs.get(item.id) ?? 'source:' + item.id);
  if (alone && !messages.has(alone.id)) add(alone, 'source:' + alone.id);
  const ranges = [];
  for (const range of [...groups.values()].sort((a, b) => b.newest - a.newest)) {
    const last = ranges.at(-1);
    if (last && range.newest >= last.oldest - 1) { last.oldest = Math.min(last.oldest, range.oldest); last.count += range.count; }
    else ranges.push({ ...range });
  }
  return ranges;
}
