import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matches } from './fixtures/mini_dom.mjs';
import { notebookFixture } from './fixtures/notebook_sheet_dom.mjs';

const css = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../web/stack-look.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');

// Bounded source cascade, not a browser CSS/layout engine. Relevant frame
// rules are compound selectors inside width/scheme media queries. An unknown
// matching selector or media condition refuses rather than being ignored.
function rules(text) {
  const result = [], stack = []; let start = 0;
  text = text.replace(/\/\*[\s\S]*?\*\//g, '');
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      const head = text.slice(start, i).trim();
      stack.push({ head, start: i + 1 }); start = i + 1;
    } else if (text[i] === '}') {
      const current = stack.pop();
      if (!current.head.startsWith('@')) result.push({ selectors: current.head.split(',').map(s => s.trim()),
        media: stack.map(parent => parent.head), declarations: Object.fromEntries(text.slice(current.start, i).split(';')
          .filter(part => part.includes(':')).map(part => { const colon = part.indexOf(':'); return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()]; })) });
      start = i + 1;
    }
  }
  return result;
}
function mediaMatches(queries, width, scheme) {
  return queries.every(query => {
    const condition = /^@media\s*\((min-width|max-width|prefers-color-scheme)\s*:\s*([\w.]+)\)$/.exec(query);
    assert.ok(condition, `unhandled frame media ${query}`);
    const [, kind, value] = condition;
    return kind === 'min-width' ? width >= parseFloat(value) : kind === 'max-width' ? width <= parseFloat(value) : scheme === value;
  });
}
function frameStyle(node, width, scheme, source = css) {
  const winners = {};
  for (const rule of rules(source)) for (const selector of rule.selectors) {
    if (!('box-shadow' in rule.declarations || 'border-radius' in rule.declarations)) continue;
    const last = selector.split(/\s+|>|\+|~/).at(-1);
    if (!/^(?:dialog(?:[.#[:]|$)|#notebook-sheet-dialog(?:[.#[:]|$)|\.notebook-sheet-dialog(?:[.#[:]|$))/.test(last) || last.includes('::')) continue;
    if (!matches(node, last)) continue;
    assert.equal(last, selector, `unhandled ancestor selector ${selector}`);
    if (!mediaMatches(rule.media, width, scheme)) continue;
    const weight = (selector.match(/#[\w-]+/g)?.length ?? 0) * 100 +
      (selector.match(/\.[\w-]+|\[[^\]]+\]/g)?.length ?? 0) * 10 + Number(selector.startsWith('dialog'));
    for (const property of ['box-shadow', 'border-radius']) if (property in rule.declarations && weight >= (winners[property]?.weight ?? -1))
      winners[property] = { value: rule.declarations[property], weight, selector, media: rule.media };
  }
  return winners;
}

test('881 common whole-frame rule reads both dossier tokens and both schemes supply them', () => {
  const frame = rules(css).filter(rule => rule.selectors.includes('dialog.notebook-sheet-dialog[open]'));
  assert.equal(frame.length, 1);
  assert.equal(frame[0].declarations['box-shadow'], 'var(--stack-cover-inset)');
  assert.equal(frame[0].declarations['border-radius'], 'var(--stack-r-sheet)');
  for (const scheme of ['light', 'dark']) {
    const values = Object.assign({}, ...rules(tokens).filter(rule => rule.selectors.includes(':root') &&
      ('--stack-cover-inset' in rule.declarations || '--stack-r-sheet' in rule.declarations) && mediaMatches(rule.media, 1280, scheme)).map(rule => rule.declarations));
    assert.match(values['--stack-cover-inset'], /^inset /);
    assert.ok(values['--stack-r-sheet']);
    console.log('FRAME881_TOKEN', JSON.stringify({ scheme, inset: values['--stack-cover-inset'], radius: values['--stack-r-sheet'] }));
  }
  assert.equal(rules(tokens).filter(rule => '--stack-cover-inset' in rule.declarations).length, 2);
  assert.equal(rules(tokens).filter(rule => '--stack-r-sheet' in rule.declarations).length, 1, 'the radius is shared across schemes');
  assert.ok(html.includes('href="/aim.css"') && html.includes('href="/stack-look.css"'));
});

test('881 actual docked, full-screen and phone frame states win the source cascade without styling child cards', async t => {
  const f = notebookFixture(t); await f.sheet.open('p');
  const observations = [];
  for (const [layout, width] of [['docked', 1280], ['full-screen', 1280], ['phone', 390]]) {
    if (layout === 'full-screen') f.sheet.dockButton.onclick();
    if (layout === 'phone') { f.media.matches = false; f.media.changed(); }
    assert.equal(f.sheet.docked, layout === 'docked');
    assert.equal(f.sheet.dialog.open, true);
    for (const scheme of ['light', 'dark']) {
      const style = frameStyle(f.sheet.dialog, width, scheme);
      assert.equal(style['box-shadow']?.value, 'var(--stack-cover-inset)', `${layout}/${scheme} whole frame inset`);
      assert.equal(style['border-radius']?.value, 'var(--stack-r-sheet)', `${layout}/${scheme} whole frame radius`);
      observations.push({ layout, width, scheme, classes: f.sheet.dialog.className, style });
    }
  }
  assert.equal(matches(f.page.host, 'dialog.notebook-sheet-dialog[open]'), false);
  console.log('FRAME881_CASCADE', JSON.stringify(observations));
});

test('881 cascade instrument honors phone media, specificity and a later overriding frame rule', async t => {
  const f = notebookFixture(t); await f.sheet.open('p');
  const synthetic = 'dialog{border-radius:1rem}@media(max-width:760px){dialog{border-radius:0}}dialog.notebook-sheet-dialog[open]{box-shadow:var(--stack-cover-inset)}';
  assert.equal(frameStyle(f.sheet.dialog, 1280, 'light', synthetic)['border-radius'].value, '1rem');
  assert.equal(frameStyle(f.sheet.dialog, 390, 'dark', synthetic)['border-radius'].value, '0');
  assert.equal(frameStyle(f.sheet.dialog, 390, 'dark', synthetic + 'dialog{box-shadow:none}')['box-shadow'].value, 'var(--stack-cover-inset)');
  assert.equal(frameStyle(f.sheet.dialog, 1280, 'light', synthetic + 'dialog.notebook-sheet-dialog.notebook-docked[open]{box-shadow:none}')['box-shadow'].value, 'none');
});
