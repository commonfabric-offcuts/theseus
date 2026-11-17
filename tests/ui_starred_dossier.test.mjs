import test from 'node:test';
import assert from 'node:assert/strict';
import { ThingsRail } from '../web/things-rail.mjs';
import { routeKey } from '../web/topic-navigation.mjs';
import { TopicViews } from '../web/topic-views.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

test('item 655 Starred emits a valid cross-topic message route', () => {
  const targets = [];
  const rail = { doc: miniDocument(), handles: { workspaceId: 'w' }, placeLink: target => { targets.push(target); return 'link'; } };
  const section = ThingsRail.prototype.starredSection.call(rail,
    [{ topic_id: 'second-topic', workspace_id: 'w', message_id: 'reply', excerpt: 'Reply', author_id: 'agent' }], { byTopic: true, topicId: 'first-topic' }, 'reader');
  section.node();
  assert.equal(targets.length, 1);
  assert.doesNotThrow(() => routeKey(targets[0]));
  assert.deepEqual(targets[0], { kind: 'topic', id: 'second-topic', message: 'reply' });
});

test('item 655 returning to an old dossier preserves the paging gap and merges each message once when it loads', () => {
  const views = new TopicViews({ instanceId: 'i', topicId: 't' });
  const item = seq => ({ id: 'm' + seq, seq, topic_id: 't', body: 'Message ' + seq, author_id: 'agent' });
  const page = (seqs, next) => ({ instance_id: 'i', items: seqs.map(item), next_cursor: next, relevant_versions: { topic: 1 } });
  views.messagesPage(page([30, 31], 30), { initial: true });
  assert.equal(views.messagesPage(page([3, 4], 3), { anchored: true, cursor: 5 }), true);
  assert.deepEqual([views.olderCursor, views.newest], [30, 31], 'a return never skips the unloaded messages between the dossier and the newest page');
  assert.notEqual(views.runOf('m3'), views.runOf('m30'), 'the gap stays a gap');
  views.messagesPage(page(Array.from({ length: 27 }, (_, n) => n + 3), 3), { cursor: 30 });
  assert.equal(views.messages.size, 29);
  assert.equal(views.runOf('m3'), views.runOf('m30'), 'the overlapping earlier page joins the two runs');
});
