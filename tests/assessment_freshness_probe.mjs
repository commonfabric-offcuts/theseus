import { readFileSync } from 'node:fs';
import { Freshness } from '../web/freshness.mjs';
const { bootstrap, baseline, page } = JSON.parse(readFileSync(0, 'utf8'));
bootstrap.transport = { read_admission: { version: 1, header: 'X-AIM-Read-Class', foreground: { slots: 1, max_waiters: 8, queue_timeout_ms: 5000 }, background: { slots: 1, max_waiters: 2, queue_timeout_ms: 500 } } };
const painted = [], states = [];
const fresh = new Freshness({ api: { view: async () => page }, bootstrap, topicId: 't1', checkpoint: baseline,
  timers: { setTimeout() { return 1; }, clearTimeout() {} }, read: action => action({ readClass: 'background' }),
  keys: item => [{ key: item.resource_kind + ':' + item.resource_id, version: item.version }],
  refresh: async key => { painted.push(key); return true; }, status: state => states.push(state) });
await fresh.request();
console.log(JSON.stringify({ stopped: fresh.stopped, painted, states }));
fresh.dispose();
