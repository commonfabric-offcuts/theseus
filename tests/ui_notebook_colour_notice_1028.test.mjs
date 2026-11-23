import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Exercise the actual app's notice/load wiring. Core's Star act and rendered
// visibility remain native checks; this adapter supplies only those boundaries.
test('1028 app keeps the Star action notice when its references reload', async () => {
  const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
  const start = app.indexOf('function outcomePages('), end = app.indexOf('\n}\n', start) + 3;
  assert.ok(start >= 0 && end > start);
  const lookup = app.match(/function loadedNotebook\(id\)\s*\{[^}]*\}/)?.[0] ?? '';
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', hidden: true });
    return nodes.get(id);
  };
  let menu;
  const env = {
    $: node, pagesInPlace() {}, notebookCreator() {}, pageMax: () => 20,
    NotebookThumbnailMenu: class { constructor(options) { menu = options; } },
    OutcomeReferences: class { constructor(options) { this.options = options; } async load() { this.options.message.hidden = true; } },
    api: {}, bootstrap: {}, pipelineView() {}, openNotebook() {}, notebookSheet: null,
    notebookViewsOf: () => ({}), retired: false, outcomeReferences: null, here: { workspaceId: 'outcome' },
    readFailure: () => ({}), outcomePageLayout: null,
    showLine: (line, words) => { line.textContent = words; line.hidden = !words; },
  };
  const build = new Function(...Object.keys(env), lookup + '\n' + app.slice(start, end) + ';return outcomePages;')(...Object.values(env));
  build('outcome', () => {});
  menu.notice('Saved.'); await menu.changed();
  assert.ok([...nodes.values()].some(line => line.textContent === 'Saved.' && !line.hidden), 'the reload must leave the action receipt visible');
});
