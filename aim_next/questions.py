from __future__ import annotations

"""Question closure, separate from answers and withdrawal (docs/question-resolution-932.md)."""

import json

from .cover_values import stored_value
from .contract import Refusal
from .delivery import _now_ms
from .outcome_asks import record_ask
from .stacks import MEMBERS, StackRoots
from .standing_conversation import is_conversation

QUESTION_SCHEMA = [
    "CREATE TABLE question_closures (message_id TEXT PRIMARY KEY REFERENCES messages(id), "
    "kind TEXT NOT NULL CHECK(kind IN ('resolved','superseded')), by TEXT NOT NULL REFERENCES actors(id), "
    "at_ms INTEGER NOT NULL, superseded_by TEXT REFERENCES messages(id), "
    "CHECK((kind='resolved' AND superseded_by IS NULL) OR (kind='superseded' AND superseded_by IS NOT NULL)))",
    "CREATE TRIGGER question_closures_stay_u BEFORE UPDATE ON question_closures BEGIN SELECT RAISE(ABORT, 'immutable question closure'); END",
    "CREATE TRIGGER question_closures_stay_d BEFORE DELETE ON question_closures BEGIN SELECT RAISE(ABORT, 'immutable question closure'); END",
]
QUESTION_DOWN = ("DROP TABLE question_closures",)
QUESTION_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM question_closures)"


class Questions:
    def _question_closed(self, db, message_id):
        return db.execute("SELECT kind,by,at_ms,superseded_by FROM question_closures WHERE message_id=?", (message_id,)).fetchone()

    def _question_value(self, db, actor, message_id):
        # Callers have already established message visibility. Never read words.
        message = db.execute("SELECT id,topic_id,seq,author_id,private_to,intent,addressees,sent_ms FROM messages WHERE id=?", (message_id,)).fetchone()
        if message is None or message['intent'] != 'ask' or message['private_to'] is not None:
            return None
        topic = db.execute("SELECT * FROM topics WHERE id=?", (message['topic_id'],)).fetchone()
        value = dict(state='answered', waiting_on=[], may_resolve=False, by=None, at_ms=None, superseded_by=None,
                     archived=bool(topic['archived']))
        closed = self._question_closed(db, message_id)
        if closed:
            return dict(value, state=closed['kind'], by=closed['by'], at_ms=closed['at_ms'], superseded_by=closed['superseded_by'])
        withdrawn = self._withdrawal_value(db, message_id)
        if withdrawn:
            return dict(value, state='withdrawn', **withdrawn)
        if self._closed(db, topic['workspace_id']) is not None:
            return value
        waiting = [who for who in json.loads(message['addressees']) if self._ask_waits(db, topic, message, who)]
        coordinator = db.execute("SELECT coordinator_id FROM workspaces WHERE id=?", (topic['workspace_id'],)).fetchone()[0]
        allowed = actor in (message['author_id'], coordinator) and not record_ask(db, message_id, topic['workspace_id'], topic['id'])
        return dict(value, state='waiting' if waiting else 'answered', waiting_on=waiting, may_resolve=bool(waiting) and allowed)

    def _question_fields(self, db, actor, items):
        # The caller's bounded page, not unrelated messages.
        for item in items:
            item['question'] = self._question_value(db, actor, item['id']) if item.get('intent') == 'ask' else None

    def _close_question(self, db, actor, topic, message, kind, successor=None):
        db.execute("INSERT INTO question_closures VALUES (?,?,?,?,?)", (message['id'], kind, actor, _now_ms(), successor))
        members = [who for who in json.loads(message['addressees']) if who != message['author_id']]
        affected = []
        for member in members:
            affected.extend(self._set_linked_wait(db, member, message['id'], False, by=actor))
        # Older hand-written covers may name the public question as message_id.
        # Examine current cover candidates in this topic, never cover history or other topics.
        covers = db.execute("SELECT c.message_id,a.value FROM cover_waiting c INDEXED BY topic_cover_waiting "
            "JOIN message_acts a ON a.message_id=c.message_id AND a.kind='cover' AND a.owner='' "
            "AND a.revision=(SELECT max(b.revision) FROM message_acts b WHERE b.message_id=c.message_id AND b.kind='cover' AND b.owner='') "
            "WHERE c.topic_id=? AND EXISTS (SELECT 1 FROM json_each(a.value,'$.waiting') q "
            "WHERE json_extract(q.value,'$.message_id')=? OR json_extract(q.value,'$.ask_id')=?)",
            (topic['id'], message['id'], message['id'])).fetchall()
        for cover in covers:
            value = stored_value(cover['value'])
            value['waiting'] = [wait for wait in value['waiting'] if (wait.get('ask_id') or wait.get('message_id')) != message['id']]
            root = db.execute("SELECT id,topic_id,seq,author_id,private_to FROM messages WHERE id=?", (cover['message_id'],)).fetchone()
            affected += self._write_linked_cover(db, actor, root, value)
        if is_conversation(topic):
            db.execute("DELETE FROM conversation_waits WHERE ask_id=?", (message['id'],))
            self._sync_waits(db, topic, members)
        else:
            for member in members:
                self._topic_ask_answered(db, topic, member, message)
                self._sync_linked_attention(db, topic, member)
        # The command touches once, after all closure/publication effects.
        return affected

    def _question_changed(self, db, actor, message, version):
        for reader in self._message_readers(db, message, actor):
            self._change(db, 'actor', reader, 'question', message['id'], version)

    def _command_message_resolve(self, db, actor, envelope):
        message = self._reacted_message(db, actor, envelope['target'])
        if envelope['args']:
            raise Refusal('INVALID_ARGUMENT', 'Resolve one question without changing its words')
        topic = self._topic(db, actor, message['topic_id'])
        coordinator = db.execute("SELECT coordinator_id FROM workspaces WHERE id=?", (topic['workspace_id'],)).fetchone()[0]
        if actor not in (message['author_id'], coordinator):
            raise Refusal('FORBIDDEN', 'Only the asker or the outcome coordinator can resolve this question')
        closed_outcome = self._closed(db, topic['workspace_id'])
        if closed_outcome is not None:
            raise self._closed_refusal(db, actor, topic['workspace_id'], closed_outcome)
        if message['intent'] != 'ask' or message['private_to'] is not None:
            raise Refusal('NOT_A_QUESTION', 'Only a public question can be resolved')
        if record_ask(db, message['id'], topic['workspace_id'], topic['id']):
            raise Refusal('RECORD_OWNS_QUESTION', 'This question is settled by its target or stage record')
        value = self._question_value(db, actor, message['id'])
        result = dict(message_id=message['id'], topic_id=topic['id'], question=value, changed=False)
        closed = self._question_closed(db, message['id'])
        if closed and closed['kind'] == 'resolved':
            return result, []
        if closed or self._withdrawal_value(db, message['id']):
            raise Refusal('QUESTION_CLOSED', 'This question was already closed', recorded=False)
        affected = self._close_question(db, actor, topic, message, 'resolved')
        version = self._touch_topic(db, topic)
        self._question_changed(db, actor, message, version)
        for member in set(json.loads(message['addressees'])) - {message['author_id']}:
            self._change(db, 'actor', member, 'waiting', topic['id'], version)
        return dict(result, question=self._question_value(db, actor, message['id']), changed=True), affected + [
            {'kind': 'topic', 'id': topic['id'], 'version': version}]

    def _supersede_questions(self, db, actor, topic, message_id):
        message = db.execute("SELECT id,author_id,addressees,intent,private_to FROM messages WHERE id=?", (message_id,)).fetchone()
        if message['intent'] != 'ask' or message['private_to'] is not None:
            return [], []
        root = StackRoots(db, actor).root(message_id)
        if root == message_id:
            return [], []
        recipients = set(json.loads(message['addressees'])) - {actor}
        candidates = db.execute(MEMBERS + " SELECT m.id,m.seq,m.topic_id,m.author_id,m.addressees,m.private_to,m.intent,m.sent_ms "
            "FROM members p JOIN messages m ON m.id=p.id WHERE m.id<>:new AND m.author_id=:actor AND m.intent='ask' AND m.private_to IS NULL",
            {'root': root, 'actor': actor, 'new': message_id}).fetchall()
        affected, closed = [], []
        for older in candidates:
            if set(json.loads(older['addressees'])) - {actor} != recipients:
                continue
            if record_ask(db, older['id'], topic['workspace_id'], topic['id']):
                continue
            if not self._question_closed(db, older['id']) and not self._withdrawal_value(db, older['id']):
                affected += self._close_question(db, actor, topic, older, 'superseded', message_id)
                closed.append(older)
        return affected, closed
