// Tells Core which messages a person has seen in each topic
// (`topic.read_through` with `from_seq` and `seq`). The page decides what is
// seen; this keeps the reports. A range already confirmed is never sent again,
// each topic has at most one request in flight, and ranges seen meanwhile that
// overlap or touch coalesce into one. Only a recorded receipt confirms a range.
// A failed report is forgotten, so the next time the person is seen reading
// those messages (a paint, focus, a scroll, the tab shown again) it is sent
// again; no timer retries it. seen() answers with the receipt of the report
// that carries the range; with null only when this call reports nothing new
// (every message in it is confirmed, in flight or already waiting); and with
// UNKNOWN when the report failed or answered nothing, since a lost answer is
// no proof that Core did not record the report.
const covers = (range, from, through) => range[0] <= from && through <= range[1];
export const UNKNOWN = Object.freeze({ recorded: false, status: 'unknown' });
// Merges a range into sorted ranges; a wanted range's third element holds
// the callers waiting on its receipt, which a merge joins.
function merge(ranges, [from, through, waiting = []]) {
  const result = [];
  for (const range of ranges) {
    if (range[1] + 1 < from || through + 1 < range[0]) result.push(range);
    else { from = Math.min(from, range[0]); through = Math.max(through, range[1]); waiting = [...waiting, ...range[2] ?? []]; }
  }
  result.push([from, through, waiting]);
  return result.sort((a, b) => a[0] - b[0]);
}
export class ReadThrough {
  constructor({ send }) {
    this.send = send;
    this.topics = new Map();
  }
  seen(topicId, from, through) {
    if (typeof topicId !== 'string' || !Number.isSafeInteger(from) || !Number.isSafeInteger(through) || from < 1 || from > through) return Promise.resolve(null);
    let state = this.topics.get(topicId);
    if (!state) { state = { confirmed: [], wanted: [], flight: null }; this.topics.set(topicId, state); }
    const known = [...state.confirmed, ...state.wanted, state.flight].reduce((all, range) => range ? merge(all, range.slice(0, 2)) : all, []);
    if (known.some(range => covers(range, from, through))) return Promise.resolve(null);
    const receipt = new Promise(resolve => { state.wanted = merge(state.wanted, [from, through, [resolve]]); });
    this.flush(topicId, state);
    return receipt;
  }
  flush(topicId, state) {
    if (state.flight || !state.wanted.length) return;
    const range = state.flight = state.wanted.shift();
    Promise.resolve().then(() => this.send(topicId, range[0], range[1]))
      .then(receipt => receipt ?? UNKNOWN, () => UNKNOWN)
      .then(receipt => {
        if (receipt?.recorded === true) state.confirmed = merge(state.confirmed, range.slice(0, 2));
        state.flight = null; this.flush(topicId, state);
        for (const resolve of range[2]) resolve(receipt);
      });
  }
}
