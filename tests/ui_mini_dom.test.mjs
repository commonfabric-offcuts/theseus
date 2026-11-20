import test from 'node:test';
import assert from 'node:assert/strict';
import { miniDocument, matches } from './fixtures/mini_dom.mjs';

test('865 attribute equality selects the named control, never merely an attribute that exists', () => {
  const doc = miniDocument(), tools = doc.createElement('div');
  for (const name of ['reply', 'aside', 'menu']) {
    const button = doc.createElement('button'); button.className = 'tool'; button.dataset.tool = name;
    tools.append(button);
  }
  const menu = tools.children[2];
  for (const selector of ['[data-tool=menu]', '[data-tool="menu"]', "button.tool[data-tool='menu']"]) {
    assert.equal(tools.querySelectorAll(selector).length, 1, 'equality finds exactly the named control');
    assert.deepEqual(tools.querySelectorAll(selector), [menu]);
  }
  assert.deepEqual(tools.querySelectorAll('[data-tool=missing]'), []);
  assert.deepEqual(tools.querySelectorAll('[data-tool]'), tools.children, 'presence remains a separate selector');
  menu.setAttribute('aria-label', 'More for this dossier');
  assert.equal(matches(menu, '[aria-label="More for this dossier"]'), true);
  assert.equal(matches(menu, '[aria-label="Different dossier"]'), false);
  menu.dataset.empty = '';
  assert.equal(matches(menu, '[data-empty=""]'), true);
  assert.equal(matches(tools.children[0], '[data-empty=""]'), false, 'an absent attribute is not an empty one');
});
