// The rows under the Done and Archived lines look like the topic list's own:
// every rule that styles the list or its rows (#topics), at any width, styles
// the folded lists (.topic-list) in the same rule, so a rule added for the
// list reaches them too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Each style rule's selector list, with the @media it sits in.
function rules(text) {
  const found = []; let depth = 0, start = 0; const media = [];
  for (let at = 0; at < text.length; at++) {
    if (text[at] === '{') {
      const head = text.slice(start, at).trim();
      if (head.startsWith('@')) media.push(head); else found.push({ media: media.at(-1) ?? '', selectors: head.split(',').map(s => s.trim()) });
      depth++; start = at + 1;
    } else if (text[at] === '}') {
      if (media.length && depth === media.length) media.pop();
      depth--; start = at + 1;
    }
  }
  return found;
}

test('every rule for the topic list or its rows also styles the folded Done and Archived lists, at every width', () => {
  const all = rules(css), missing = [];
  let checked = 0;
  for (const { media, selectors } of all) for (const selector of selectors) {
    if (!/#topics(?![\w-])/.test(selector)) continue;
    checked++;
    const twin = selector.replace(/#topics(?![\w-])/g, '.topic-list');
    if (!selectors.includes(twin)) missing.push(`${media} ${selector} (no ${twin})`);
  }
  assert.ok(checked >= 6, 'the list has its rules, phone width among them: ' + checked);
  assert.deepEqual(missing, []);
  assert.ok(all.some(({ media, selectors }) => media.includes('max-width:760px') && selectors.includes('.topic-list a.nav-item')), 'the folded rows have the phone-width row rule');
});

test('the rule reader sees a rule that styles the list alone', () => {
  const lone = rules('@media(max-width:760px){#topics a.nav-item{flex:0 0 auto}}#x{color:red}');
  assert.deepEqual(lone, [{ media: '@media(max-width:760px)', selectors: ['#topics a.nav-item'] }, { media: '', selectors: ['#x'] }]);
});
