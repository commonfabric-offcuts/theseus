// Tells Core which messages a person has seen in each topic
// (`topic.read_through` with `from_seq` and `seq`). The page decides what is
// seen; this keeps the reports. A range already confirmed is never sent again,
// each topic has at most one request in flight, and ranges seen meanwhile that
// overlap or touch coalesce into one. Only a recorded receipt confirms a range.
// A failed report is forgotten, so the next time the person is seen reading
// those messages (a paint, focus, a scroll, the tab shown again) it is sent
// again; no timer retries it.
const covers = (range, from, through) => range[0] <= from && through <= range[1];
function merge(ranges, [from, through]) {
  const result = [];
  for (const range of ranges) {
    if (range[1] + 1 < from || through + 1 < range[0]) result.push(range);
    else { from = Math.min(from, range[0]); through = Math.max(through, range[1]); }
  }
  result.push([from, through]);
  return result.sort((a, b) => a[0] - b[0]);
}
export class ReadThrough {
  constructor({ send }) {
    this.send = send;
    this.topics = new Map();
  }
  seen(topicId, from, through) {
    if (typeof topicId !== 'string' || !Number.isSafeInteger(from) || !Number.isSafeInteger(through) || from < 1 || from > through) return;
    let state = this.topics.get(topicId);
    if (!state) { state = { confirmed: [], wanted: [], flight: null }; this.topics.set(topicId, state); }
    if (state.confirmed.some(range => covers(range, from, through)) || (state.flight && covers(state.flight, from, through))) return;
    state.wanted = merge(state.wanted, [from, through]);
    this.flush(topicId, state);
  }
  flush(topicId, state) {
    if (state.flight || !state.wanted.length) return;
    const range = state.flight = state.wanted.shift();
    Promise.resolve().then(() => this.send(topicId, range[0], range[1]))
      .then(receipt => receipt?.recorded === true, () => false)
      .then(confirmed => {
        if (confirmed) state.confirmed = merge(state.confirmed, range);
        state.flight = null; this.flush(topicId, state);
      });
  }
}
