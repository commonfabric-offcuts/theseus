import test from 'node:test';
import assert from 'node:assert/strict';
import { copyOfCover, coverKey, coverSheet, coverSummary } from '../web/dossier-cover.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

const context = { viewer: 'owner', nameOf: id => id === 'builder' ? 'Builder' : 'Tony', topicId: 't', rootId: 'm' };
const base = { owner: 'owner', writer: 'builder', waiting: [], stands: 'How do we ship?', birth: { nature: 'question', done_when: 'The release is online.' } };
const fields = [{ key: 'log', text: 'First update' }, { key: 'why', text: 'For readers' }, { key: 'who', text: '  ' }, { key: 'what', text: '| Item | State |\n| --- | --- |\n| Cover | Ready |' }];
const proposal = { kind: 'release', text: 'Cover release', link: 'https://example.test/release', message_id: 'm-delivery', seq: 8 };
const find = (sheet, cls) => [...sheet.descendants()].filter(node => node.classList.contains(cls));
const sheet = cover => coverSheet(miniDocument(), cover, context);

test('the shared cover puts payload first, folds ordered authored fields, and keeps the words and the delivery link', () => {
  const cover = { ...base, owner_name: 'Tony', sections: fields, payload: proposal };
  const view = sheet(cover);
  assert.match(view.children[1].className, /cover-payload/);
  assert.match(view.children[2].className, /cover-heading/);
  assert.equal(find(view, 'pill-words')[0].text, "Waiting on Tony's ok");
  assert.equal(find(view, 'cover-src')[0].text, '#8');
  assert.equal(coverSummary(cover), 'Cover release');
  assert.deepEqual(find(view, 'cover-section-label').map(node => node.text), ['Why', 'What', 'Log']);
  assert.equal(find(view, 'cover-section-peek')[0].text, 'For readers');
  assert.ok(find(view, 'cover-structured-section').every(node => node.open === false));
  assert.equal(find(view, 'md-table').length, 1);
  assert.match(copyOfCover(view)(), /^Payload: Cover release.*\n\nHow do we ship\?/);
  assert.match(copyOfCover(view)(), /\n\nLog\nFirst update$/);
  assert.notEqual(coverKey(cover, context), coverKey({ ...cover, owner_name: 'Tonia' }, context));
  assert.notEqual(coverKey(cover, context), coverKey({ ...cover, sections: [] }, context));
});

test('phase follows persisted evidence, and tracking reads its checkpoint without phase bars', () => {
  const working = { ...base, sections: fields };
  const delivered = { ...working, owner_name: 'Tony', payload: proposal };
  const accepted = { ...delivered, accepted_by_name: 'Ana', payload: { ...proposal, done: { by: 'ana', how: 'word', at_ms: 1, message_id: 'm-word', seq: 9 } } };
  assert.deepEqual([base, working, delivered, accepted].map(cover => find(sheet(cover), 'cover-phase')[0].text), ['Open', 'Working', 'Delivered', 'Accepted']);
  assert.equal(find(sheet(accepted), 'pill-words')[0].text, 'Ana accepted');
  assert.deepEqual(find(sheet(accepted), 'cover-src').map(node => node.text), ['#8', '#9']);
  const tracking = sheet({ ...working, birth: { nature: 'tracking' }, sections: [{ key: 'when', text: '4:00 PM\nToday' }] });
  assert.equal(find(tracking, 'cover-phase').length, 0);
  assert.equal(find(tracking, 'cover-next')[0].text, 'next 4:00 PM');
  assert.equal(find(sheet({ ...working, birth: { nature: 'none' } }), 'cover-phase').length, 0);
});
