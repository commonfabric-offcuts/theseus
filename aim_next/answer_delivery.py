from __future__ import annotations

"""Answer receipts for agent askers (625, docs/answer-delivery-625.md)."""

import json
import uuid

from .contract import Refusal
from .message_edit import DELIVERY_COLUMNS, _rebuilt_deliveries
from .refresh_delivery import REQUEST_DELIVERIES, REQUEST_GUARD
from .stacks import StackRoots


RECEIPTS = [
    "CREATE TABLE answer_receipts (id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id), "
    "actor_id TEXT NOT NULL REFERENCES actors(id), kind TEXT NOT NULL CHECK(kind IN ('thumb','answer')), "
    "value TEXT NOT NULL CHECK(value IN ('yes','no')), revision INTEGER NOT NULL CHECK(revision>0), "
    "at_ms INTEGER NOT NULL, reply_id TEXT UNIQUE REFERENCES messages(id), UNIQUE(message_id,actor_id,kind,revision), "
    "CHECK((kind='thumb' AND value='yes' AND reply_id IS NULL) OR (kind='answer' AND reply_id IS NOT NULL)))",
    "CREATE INDEX answer_receipt_message ON answer_receipts(message_id)",
    "CREATE TRIGGER answer_receipts_kept_u BEFORE UPDATE ON answer_receipts BEGIN SELECT RAISE(ABORT,'immutable answer receipt'); END",
    "CREATE TRIGGER answer_receipts_kept_d BEFORE DELETE ON answer_receipts BEGIN SELECT RAISE(ABORT,'immutable answer receipt'); END",
]
ANSWER_DELIVERIES = (
    "CREATE TABLE deliveries (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, "
    "message_id TEXT REFERENCES messages(id), recipient_id TEXT NOT NULL REFERENCES actors(id), "
    "group_id INTEGER NOT NULL REFERENCES delivery_groups(id), state TEXT NOT NULL DEFAULT 'pending', topic_id TEXT, "
    "revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), request_id TEXT REFERENCES refresh_requests(id), "
    "answer_id TEXT UNIQUE REFERENCES answer_receipts(id), UNIQUE(request_id), "
    "CHECK((message_id IS NOT NULL)+(request_id IS NOT NULL)=1), CHECK(request_id IS NULL OR revision=1), "
    "CHECK(answer_id IS NULL OR (message_id IS NOT NULL AND request_id IS NULL AND revision=1)))")
ANSWER_INDEX = "CREATE UNIQUE INDEX ordinary_message_delivery ON deliveries(message_id,recipient_id,revision) WHERE answer_id IS NULL"
ANSWER_GUARD = (
    "CREATE TRIGGER answer_delivery_recipient BEFORE INSERT ON deliveries WHEN NEW.answer_id IS NOT NULL AND NOT EXISTS "
    "(SELECT 1 FROM answer_receipts r JOIN messages m ON m.id=r.message_id JOIN actors a ON a.id=m.author_id "
    "JOIN delivery_groups g ON g.id=NEW.group_id WHERE r.id=NEW.answer_id AND r.kind='thumb' AND r.reply_id IS NULL "
    "AND m.id=NEW.message_id AND m.topic_id=NEW.topic_id AND m.author_id=NEW.recipient_id AND a.kind='agent' "
    "AND g.recipient_id=NEW.recipient_id AND g.kind='answer') "
    "BEGIN SELECT RAISE(ABORT,'an answer delivery belongs to its agent asker'); END")
KEPT_COLUMNS = DELIVERY_COLUMNS + ",revision,request_id"
ANSWER_UP = RECEIPTS + _rebuilt_deliveries(ANSWER_DELIVERIES, KEPT_COLUMNS) + REQUEST_GUARD + [ANSWER_INDEX, ANSWER_GUARD]
ANSWER_DOWN = _rebuilt_deliveries(REQUEST_DELIVERIES, KEPT_COLUMNS) + REQUEST_GUARD + ["DROP TABLE answer_receipts"]
ANSWER_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM answer_receipts)"


class AnswerDelivery:
    def _answer_stands(self, db, receipt):
        row = self._reaction_row(db, receipt['actor_id'], receipt['message_id'], receipt['kind'])
        return row is not None and row['revision'] == receipt['revision'] and row['value'] == receipt['value']

    def _record_answer_receipt(self, db, actor, message, kind, revision, value, reply_id=None):
        if self._actor_kind(db, message['author_id']) != 'agent':
            return None
        reaction = db.execute("SELECT at_ms FROM message_reactions WHERE actor_id=? AND message_id=? AND kind=?",
                              (actor, message['id'], kind)).fetchone()
        identity = 'a-' + uuid.uuid4().hex
        db.execute("INSERT INTO answer_receipts VALUES (?,?,?,?,?,?,?,?)",
                   (identity, message['id'], actor, kind, value, revision, reaction['at_ms'], reply_id))
        if reply_id is not None:
            return None  # The existing decision reply already has its delivery.
        queued = self._queue_delivery(db, message['id'], message['author_id'], message['topic_id'],
                                      {'answer': None}, answer_id=identity)
        self._change(db, 'actor', message['author_id'], 'delivery', queued, 1)
        return queued

    def _answer_receipt_value(self, db, identity):
        receipt = dict(db.execute("SELECT * FROM answer_receipts WHERE id=?", (identity,)).fetchone())
        receipt['stands'] = self._answer_stands(db, receipt)
        return receipt

    def _check_unread_answers(self, db, actor, topic, snapshot, intent):
        if intent != 'ask' or self._actor_kind(db, actor) != 'agent' or not snapshot.get('reply_to'):
            return
        roots = StackRoots(db, actor)
        root = roots.root(snapshot['reply_to'])
        # Only this actor's pending work in this topic, never global history.
        rows = db.execute("SELECT d.* FROM delivery_groups g INDEXED BY eligible_groups "
            "CROSS JOIN deliveries d INDEXED BY pending_group_topic_deliveries ON d.group_id=g.id AND d.state='pending' "
            "WHERE g.recipient_id=? AND g.active=1 AND g.pending_count>0 AND d.topic_id=? ORDER BY d.seq",
            (actor, topic['id']))
        for delivery in rows:
            if delivery['request_id'] is not None or delivery['revision'] != 1:
                continue
            if delivery['answer_id'] is not None:
                answer = self._answer_receipt_value(db, delivery['answer_id'])
                if not answer['stands']:
                    continue
                question_id = answer['message_id']
            else:
                # Explicit decisions retain their existing reply delivery; an
                # old decision reply is no longer standing after replacement.
                receipt = db.execute("SELECT * FROM answer_receipts WHERE reply_id=?", (delivery['message_id'],)).fetchone()
                if receipt is not None:
                    if not self._answer_stands(db, receipt):
                        continue
                    answer, question_id = dict(receipt), receipt['message_id']
                else:
                    reply = db.execute("SELECT r.id,r.author_id,r.private_to,r.reply_to,q.author_id AS asker,q.intent,q.addressees "
                        "FROM messages r JOIN messages q ON q.id=r.reply_to WHERE r.id=?", (delivery['message_id'],)).fetchone()
                    if (reply is None or reply['asker'] != actor or reply['intent'] != 'ask'
                            or reply['author_id'] not in json.loads(reply['addressees'])
                            or reply['private_to'] not in (None, actor)):
                        continue
                    question_id = reply['reply_to']
                    answer = {'message_id': question_id, 'actor_id': reply['author_id'], 'kind': 'reply', 'reply_id': reply['id']}
            if roots.root(question_id) != root:
                continue
            description = (answer['kind'] + ' ' + answer['value']) if 'value' in answer else 'reply ' + answer['reply_id']
            raise Refusal('ANSWER_UNREAD',
                '%s already answered question %s with %s; read the answer and acknowledge delivery %s before asking again in this dossier' %
                (answer['actor_id'], question_id, description, delivery['id']),
                {'message_id': question_id, 'delivery_id': delivery['id'], 'answer': answer}, recorded=False)
