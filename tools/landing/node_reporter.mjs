// A node --test reporter writing one JSON line per finished case: its file (relative to the run's folder), its name
// path, and how it ended (pass, fail, skip, todo or cancelled). node_suite_check.sh runs it beside the TAP reporter,
// because TAP names a passing case without its file, and execution_compare.py compares what ran on the carry with
// what ran on live.
import path from 'node:path';

export default async function* reporter(source) {
  const stacks = new Map();
  const seen = new Map();
  for await (const event of source) {
    const data = event.data || {};
    const file = data.file ? path.relative(process.cwd(), data.file) : '(no file)';
    if (!stacks.has(file)) stacks.set(file, []);
    const stack = stacks.get(file);
    if (event.type === 'test:start') {
      stack.length = data.nesting;
      stack.push(data.name);
    } else if (event.type === 'test:pass' || event.type === 'test:fail') {
      const names = stack.slice(0, data.nesting).concat([data.name]).join(' > ');
      const key = file + '\u0000' + names;
      const occurrence = (seen.get(key) || 0) + 1;
      seen.set(key, occurrence);
      const error = (data.details || {}).error || {};
      const status = data.skip !== undefined && data.skip !== false ? 'skip'
        : data.todo !== undefined && data.todo !== false ? 'todo'
        : event.type === 'test:pass' ? 'pass'
        : error.failureType === 'cancelledByParent' ? 'cancelled' : 'fail';
      yield JSON.stringify({ file, names, occurrence, status }) + '\n';
    }
  }
}
