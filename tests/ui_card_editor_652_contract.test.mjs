// Named, browser-free source/instrument contracts; native acceptance stays in Pool.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as instrument from './card_editor_652.mjs';

const css = await readFile(new URL('../web/aim.css', import.meta.url), 'utf8');

test('item 652 phone target source covers narrow viewports independently of pointer media', () => {
  // Inspect the actual source rule, without claiming this is a rendered hit box.
  const rule = [...css.matchAll(/@media([^{}]+)\{\.deck-fold\{([^}]+)\}/g)];
  const narrow = rule.find(([, query]) => query.split(',').some(q => /^\(max-width:\s*760px\)$/.test(q.trim())));
  assert.ok(narrow, 'phone chevron sizing must not depend only on pointer:coarse');
  for (const property of ['width', 'height', 'min-height']) assert.match(narrow[2], new RegExp(`(?:^|;)${property}:2\\.75rem(?:;|$)`), `${property} keeps the 44px source target`);
  assert.match(css, /\.deck-fold\{display:inline-flex;[^}]*width:1\.4rem;height:1\.4rem;/, 'laptop default retains its approved size');
  assert.match(css, /\.deck-parent>\.deck-editor\{text-indent:2\.75rem\}/, 'the phone title clearance follows its enlarged target');
});

test('item 652 waits preserve the actual engine rejection and focus predicate', async () => {
  assert.equal(typeof instrument.wait652, 'function', '652 has a cause-preserving wait');
  const error = Object.assign(new Error('Execution context was destroyed'), { name: 'TargetClosedError' });
  const expression = f => document.activeElement === document.querySelector(f);
  let observed;
  const p = { waitForFunction: (...args) => { observed = args; return Promise.reject(error); } };
  await assert.rejects(instrument.wait652(p, expression, 'the native press focuses card writing', '.deck-editor', 8000), actual => actual === error);
  assert.deepEqual(observed, [expression, '.deck-editor', { polling: 'raf', timeout: 8000 }]);
  assert.equal(p.item652Stage, 'the native press focuses card writing');
});

test('item 652 non-B1 normal mutant and restored evidence never overwrite', () => {
  const suffixes = ['', '-mutant-small-chevron', '-restored-small-chevron'];
  const all = suffixes.flatMap(suffix => {
    const { stem, prefix } = instrument.scenarioFiles652('/evidence', 'chromium', 'phone-320', 'light', 'full', 'normal', suffix);
    assert.equal(stem, 'item-652-full-normal' + suffix);
    return ['.png', '-geometry.json', '-diagnostics.json', '-failure.png', '-failure.json'].map(ext => prefix + ext);
  });
  assert.equal(new Set(all).size, 15, 'each phase retains its own picture, measurements and failure diagnostics');
});

test('item 652 failure capture retains cause and both capture failures without hiding the original', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'item652-contract-'));
  try {
    const original = new Error('native focus predicate failed', { cause: new Error('engine reason') });
    let screenshotOptions;
    const p = { item652Stage: 'the native press focuses card writing',
      evaluate: () => Promise.reject(new Error('snapshot context closed')),
      screenshot: options => { screenshotOptions = options; return Promise.reject(new Error('screenshot context closed')); } };
    const prefix = path.join(directory, 'restored');
    await instrument.failure652(p, prefix, { host: '.deck-page', field: '.deck-editor' }, original, [{ event: 'requestfinished' }]);
    const record = JSON.parse(await readFile(prefix + '-failure.json', 'utf8'));
    assert.deepEqual(screenshotOptions, { path: prefix + '-failure.png' }, 'failure screenshot is immediate, with no animation wait or edits');
    assert.equal(record.error.stack, original.stack);
    assert.equal(record.error.cause.message, 'engine reason');
    assert.deepEqual(record.captureErrors.map(e => e.capture), ['snapshot', 'screenshot']);
    assert.match(record.captureErrors[0].error, /snapshot context closed/);
    assert.match(record.captureErrors[1].error, /screenshot context closed/);
    assert.equal(record.stage, p.item652Stage);
    assert.deepEqual(record.requests, [{ event: 'requestfinished' }]);
  } finally { await rm(directory, { recursive: true }); }
});
