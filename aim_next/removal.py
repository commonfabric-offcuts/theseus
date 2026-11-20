from __future__ import annotations

"""Permanent human message removal and first content exposure (item 151)."""

import json

from .contract import Refusal
from .message_edit import DELIVERY_COLUMNS, _rebuilt_deliveries
from .refresh_delivery import REQUEST_DELIVERIES, REQUEST_GUARD


REMOVAL_TABLES = [
    "CREATE TABLE message_removals (message_id TEXT PRIMARY KEY REFERENCES messages(id), kind TEXT NOT NULL CHECK(kind IN ('unsent','retracted')), by TEXT NOT NULL REFERENCES actors(id), at_ms INTEGER NOT NULL, operation_id TEXT NOT NULL, UNIQUE(by,operation_id))",
    "CREATE TABLE message_first_exposures (message_id TEXT PRIMARY KEY REFERENCES messages(id), by TEXT NOT NULL REFERENCES actors(id), at_ms INTEGER NOT NULL)",
    "CREATE TABLE message_removal_horizon (seq INTEGER NOT NULL)",
    "CREATE TABLE message_quote_sources (source_id TEXT NOT NULL REFERENCES messages(id), message_id TEXT NOT NULL REFERENCES messages(id), PRIMARY KEY(source_id,message_id))",
    "CREATE TRIGGER published_message_quotes AFTER INSERT ON messages BEGIN INSERT OR IGNORE INTO message_quote_sources(source_id,message_id) SELECT json_extract(value,'$.source.id'),NEW.id FROM json_each(NEW.quotes) WHERE json_extract(value,'$.source.kind')='message' AND json_extract(value,'$.source.id')<>NEW.id; END",
    "INSERT INTO message_removal_horizon SELECT coalesce(max(seq),0) FROM messages",
]
for _table in ('message_removals', 'message_first_exposures', 'message_removal_horizon', 'message_quote_sources'):
    for _event in ('UPDATE', 'DELETE'):
        REMOVAL_TABLES.append("CREATE TRIGGER %s_keep_%s BEFORE %s ON %s BEGIN SELECT RAISE(ABORT,'immutable message removal fact'); END" % (_table, _event.lower(), _event, _table))
REMOVAL_TABLES += [
    "CREATE INDEX removal_agent_exposures ON message_exposures(message_id,actor_id)",
    "CREATE INDEX topic_reopen_message ON topics(state_message_id) WHERE state_message_id IS NOT NULL",
    "CREATE TRIGGER first_exposure_other BEFORE INSERT ON message_first_exposures WHEN EXISTS (SELECT 1 FROM messages WHERE id=NEW.message_id AND author_id=NEW.by) BEGIN SELECT RAISE(ABORT,'only another reader exposes a message'); END",
]
REMOVAL_DELIVERIES = REQUEST_DELIVERIES.replace(
    "request_id TEXT REFERENCES refresh_requests(id),", "request_id TEXT REFERENCES refresh_requests(id), retraction_id TEXT REFERENCES message_removals(message_id),").replace(
    "UNIQUE(request_id),", "UNIQUE(request_id), UNIQUE(retraction_id,recipient_id),").replace(
    "(request_id IS NOT NULL)=1)", "(request_id IS NOT NULL)+(retraction_id IS NOT NULL)=1)").replace(
    "CHECK(request_id IS NULL OR revision=1))", "CHECK(request_id IS NULL OR revision=1), CHECK(retraction_id IS NULL OR revision=1))")
REMOVAL_GUARD = [
    "CREATE TRIGGER retraction_delivery_recipient BEFORE INSERT ON deliveries WHEN NEW.retraction_id IS NOT NULL AND NOT EXISTS "
    "(SELECT 1 FROM message_removals r JOIN messages m ON m.id=r.message_id JOIN actors a ON a.id=NEW.recipient_id JOIN delivery_groups g ON g.id=NEW.group_id "
    "WHERE r.message_id=NEW.retraction_id AND r.kind='retracted' AND m.topic_id=NEW.topic_id AND a.kind='agent' AND g.recipient_id=NEW.recipient_id AND g.kind='retraction') "
    "BEGIN SELECT RAISE(ABORT,'a retraction notice belongs to its agent'); END",
]
REMOVAL_UP = REMOVAL_TABLES + _rebuilt_deliveries(REMOVAL_DELIVERIES, DELIVERY_COLUMNS + ',revision,request_id') + REQUEST_GUARD + REMOVAL_GUARD
REMOVAL_DOWN = _rebuilt_deliveries(REQUEST_DELIVERIES, DELIVERY_COLUMNS + ',revision,request_id') + REQUEST_GUARD + [
    'DROP TRIGGER published_message_quotes', 'DROP TABLE message_quote_sources',
    'DROP INDEX topic_reopen_message', 'DROP INDEX removal_agent_exposures', 'DROP TABLE message_first_exposures', 'DROP TABLE message_removal_horizon', 'DROP TABLE message_removals']
REMOVAL_OCCUPIED = 'SELECT EXISTS (SELECT 1 FROM message_removals)'
VISIBLE = "NOT EXISTS (SELECT 1 FROM message_removals removal WHERE removal.message_id=m.id AND removal.kind='unsent')"
ACTIVE = "NOT EXISTS (SELECT 1 FROM message_removals removal WHERE removal.message_id=m.id)"


def value(db, message_id):
    row = db.execute('SELECT kind,by,at_ms FROM message_removals WHERE message_id=?', (message_id,)).fetchone()
    return dict(row) if row else None


def unsent(db, message_id):
    return db.execute("SELECT 1 FROM message_removals WHERE message_id=? AND kind='unsent'", (message_id,)).fetchone() is not None


def content_ids(answer, pairs, args=None):
    """Final projected words plus content-bearing identities, including empty image cards.

    This is a projection walk, never a database history scan. Text markers name
    snippets/quotes precisely. Structural identities cover attachments that have
    no text to mark. Pure counts, changed ids and other metadata do not expose.
    """
    ids = {message_id for message_id, _ in pairs}
    def walk(item):
        if isinstance(item, dict):
            # Editor state returns the reader's private writing, never the
            # referenced source's words. Prepared/aside submission snapshots
            # and drafts likewise retain their own writing and quote choices.
            if ('source_available' in item and 'destination_available' in item and 'draft' in item and 'note' in item
                    or 'draft_generation' in item and 'send_operation_id' in item
                    or 'generation' in item and 'source_ref' in item and 'body' in item):
                return
            if not item.get('withheld') and any(item.get(key) for key in ('body', 'excerpt', 'attachments', 'attachment', 'media_id')):
                ref = item.get('source_ref') or item.get('source')
                if isinstance(ref, dict) and ref.get('kind') == 'message':
                    ids.add(ref.get('id'))
                if 'author_id' in item and ('body' in item or 'attachments' in item):
                    ids.add(item.get('id') or item.get('message_id'))
                if 'message_id' in item and ('excerpt' in item or 'media_id' in item):
                    ids.add(item['message_id'])
                # A Starred dossier's compact title source. Private opening
                # ids also accompany body/attachments, but are not messages.
                if 'id' in item and 'name' in item and 'body' in item and 'attachments' in item:
                    ids.add(item['id'])
            if isinstance(item.get('first'), dict) and not item['first'].get('withheld') and (item['first'].get('body') or item['first'].get('attachments')):
                ids.add(item.get('root_id'))
            for child in item.values():
                walk(child)
        elif isinstance(item, (list, tuple)):
            for child in item:
                walk(child)
    walk(answer)
    if isinstance(answer, dict) and 'media_id' in answer and isinstance(args, dict):
        ref = args.get('source_ref')
        if isinstance(ref, dict) and ref.get('kind') == 'message':
            ids.add(ref.get('id'))
    return sorted(identity for identity in ids if isinstance(identity, str))


def refuse_unsent_projection(db, ids):
    """Fail closed if a content producer ever bypasses its normal admission.

    Producers omit removed entries before paging/counting; this final bounded
    identity check is the safety boundary shared by every view and raw media.
    It never turns an erased source into empty words or a placeholder.
    """
    if ids and db.execute("SELECT 1 FROM message_removals WHERE kind='unsent' AND message_id IN (SELECT value FROM json_each(?)) LIMIT 1", (json.dumps(ids),)).fetchone():
        raise Refusal('FORBIDDEN', 'No readable source')


def first_exposures(db, actor, ids):
    if not ids:
        return []
    return [row[0] for row in db.execute(
        "SELECT m.id FROM messages m JOIN actors author ON author.id=m.author_id WHERE author.kind='human' "
        "AND m.id IN (SELECT value FROM json_each(?)) AND m.author_id<>? "
        "AND m.seq>max((SELECT seq FROM message_removal_horizon),(SELECT seq FROM message_edit_horizon)) AND " + VISIBLE +
        " AND NOT EXISTS (SELECT 1 FROM message_first_exposures e WHERE e.message_id=m.id)", (json.dumps(ids), actor))]


class Removal:
    def _removal_fields(self, db, actor, items):
        for item in items:
            identity = item.get('id') or item.get('source_ref', {}).get('id')
            item['removal'] = value(db, identity)
            item['removal_action'] = self._removal_action(db, actor, identity) if item['removal'] is None else None
            if item['removal'] is not None:
                item.update(go_ahead=False, blocks=None, no_answer=False)

    def _removal_action(self, db, actor, message_id):
        row = db.execute('SELECT m.author_id,m.seq,a.kind FROM messages m JOIN actors a ON a.id=m.author_id WHERE m.id=?', (message_id,)).fetchone()
        if not row or row['author_id'] != actor or row['kind'] != 'human' or value(db, message_id):
            return None
        seen = (row['seq'] <= db.execute('SELECT max((SELECT seq FROM message_removal_horizon),(SELECT seq FROM message_edit_horizon))').fetchone()[0]
                or db.execute('SELECT 1 FROM message_first_exposures WHERE message_id=?', (message_id,)).fetchone()
                or db.execute('SELECT 1 FROM message_exposures WHERE message_id=? AND actor_id<>? LIMIT 1', (message_id, actor)).fetchone()
                or db.execute('SELECT 1 FROM message_edit_sessions WHERE message_id=?', (message_id,)).fetchone()
                or db.execute('SELECT 1 FROM message_quote_sources WHERE source_id=? LIMIT 1', (message_id,)).fetchone()
                or db.execute('SELECT 1 FROM messages INDEXED BY message_reply_links WHERE reply_to=? LIMIT 1', (message_id,)).fetchone())
        return 'retract' if seen else 'unsend'

    def _command_message_unsend(self, db, actor, envelope):
        return self._remove_message(db, actor, envelope, 'unsent')

    def _command_message_retract(self, db, actor, envelope):
        return self._remove_message(db, actor, envelope, 'retracted')

    def _remove_message(self, db, actor, envelope, kind):
        if set(envelope['target']) != {'message_id'} or envelope['args']:
            raise Refusal('INVALID_ARGUMENT', 'Name one message, without changing its words')
        message = self._editable(db, actor, envelope['target']['message_id'], removed=True)
        existing = value(db, message['id'])
        if existing:
            if existing['kind'] != kind:
                raise Refusal('MESSAGE_SEEN', 'This message was already retracted; it cannot be unsent.', recorded=False)
            return {'message_id': message['id'], 'topic_id': message['topic_id'], 'removal': existing, 'changed': False}, []
        if kind == 'unsent' and self._removal_action(db, actor, message['id']) != 'unsend':
            raise Refusal('MESSAGE_SEEN', 'This message has been seen, replied to, quoted elsewhere or opened in Edit. You can retract it instead.', recorded=False)
        from .delivery import _now_ms
        now = _now_ms()
        readers = self._message_readers(db, message, actor)
        db.execute('INSERT INTO message_removals VALUES (?,?,?,?,?)', (message['id'], kind, actor, now, envelope['operation_id']))
        # Stop all versions and held rows; releasing an edit cannot revive them.
        for row in db.execute("SELECT d.*,g.active FROM deliveries d JOIN delivery_groups g ON g.id=d.group_id WHERE d.message_id=? AND d.state IN ('pending','held')", (message['id'],)).fetchall():
            if row['state'] == 'pending' and row['active']:
                self._acknowledge(db, row['recipient_id'], row)
            db.execute("UPDATE deliveries SET state='cancelled' WHERE id=?", (row['id'],))
        session = db.execute("SELECT * FROM message_edit_sessions WHERE message_id=? AND state='open'", (message['id'],)).fetchone()
        if session:
            self._end_session(db, message, session, 'closed')
            db.execute('UPDATE message_edit_sessions SET released_ms=? WHERE message_id=?', (now, message['id']))
        db.execute('UPDATE message_marks SET revision=revision+1 WHERE message_id=? AND revision%2=1', (message['id'],))
        notices = 0
        if kind == 'retracted':
            historic = db.execute('SELECT seq<=(SELECT seq FROM message_removal_horizon) FROM messages WHERE id=?', (message['id'],)).fetchone()[0]
            for reader in readers:
                if reader == actor or self._actor_kind(db, reader) != 'agent':
                    continue
                if historic or db.execute('SELECT 1 FROM message_exposures WHERE message_id=? AND actor_id=?', (message['id'], reader)).fetchone():
                    identity = self._queue_delivery(db, None, reader, message['topic_id'], {'retraction': None}, retraction_id=message['id'])
                    self._change(db, 'actor', reader, 'delivery', identity, 1)
                    notices += 1
        topic = db.execute('SELECT * FROM topics WHERE id=?', (message['topic_id'],)).fetchone()
        affected = self._remove_decision(db, actor, message['id'], now)
        affected += self._removed_waits(db, actor, topic, message['id'])
        db.execute('UPDATE conversation_items SET settled=1 WHERE message_id=?', (message['id'],))
        self._removed_conversation_answer(db, message['id'])
        if kind == 'unsent':
            affected += self._clear_unsent_reopening(db, message['id'], topic['id'])
            if message['private_to'] is None:
                db.execute("UPDATE topic_summaries SET message_count=message_count-1,latest_message_id=(SELECT m.id FROM messages m WHERE m.topic_id=? AND m.private_to IS NULL AND " + VISIBLE + " ORDER BY m.seq DESC LIMIT 1) WHERE topic_id=?", (topic['id'], topic['id']))
                db.execute("UPDATE topic_summaries SET other_message_id=(SELECT m.id FROM messages m WHERE m.topic_id=? AND m.private_to IS NULL AND " + VISIBLE + " AND m.author_id<>(SELECT author_id FROM messages WHERE id=topic_summaries.latest_message_id) ORDER BY m.seq DESC LIMIT 1) WHERE topic_id=?", (topic['id'], topic['id']))
            for row in db.execute("SELECT d.*,g.active FROM refresh_requests r JOIN deliveries d ON d.request_id=r.id JOIN delivery_groups g ON g.id=d.group_id WHERE (r.message_id=? OR r.root_id=?) AND d.state='pending'", (message['id'], message['id'])).fetchall():
                if row['active']:
                    self._acknowledge(db, row['recipient_id'], row)
                db.execute("UPDATE deliveries SET state='cancelled' WHERE id=?", (row['id'],))
        version = self._touch_topic(db, topic)
        for reader in readers:
            self._change(db, 'actor', reader, 'removal', message['id'], 1)
        return {'message_id': message['id'], 'topic_id': topic['id'], 'removal': {'kind': kind, 'by': actor, 'at_ms': now}, 'changed': True, 'notices': notices}, affected + [{'kind': 'topic', 'id': topic['id'], 'version': version}]

    def _clear_unsent_reopening(self, db, message_id, current_topic):
        # 12367: retain the active state and raised times, but no attribution
        # to gone words. A dossier move may have left this pointer in its old
        # topic, so use the indexed pointer, not the message's present topic.
        from .topic_state import REOPENED_NOTE
        affected = []
        for topic in db.execute('SELECT * FROM topics WHERE state_message_id=?', (message_id,)).fetchall():
            db.execute("UPDATE topics SET state_message_id=NULL,state_by=NULL,"
                       "state_note=CASE WHEN state_note=? THEN '' ELSE state_note END WHERE id=? AND state_message_id=?",
                       (REOPENED_NOTE, topic['id'], message_id))
            if topic['id'] != current_topic:
                version = self._touch_topic(db, topic)
                affected.append({'kind': 'topic', 'id': topic['id'], 'version': version})
        return affected

    def _remove_decision(self, db, actor, message_id, now):
        # The exact send operation identifies a generated decision reply. Only
        # its still-current answer is retired; removing an older reply cannot
        # undo a newer decision. The original reply and receipt remain immutable.
        row = db.execute("SELECT o.outcome FROM messages m JOIN operations o ON o.actor_id=m.author_id AND o.id=m.operation_id WHERE m.id=? AND o.kind='message.answer'", (message_id,)).fetchone()
        if row is None:
            return []
        result = json.loads(row['outcome']).get('result') or {}
        if result.get('reply_id') != message_id:
            return []
        parent = result.get('message_id')
        changed = db.execute("UPDATE message_reactions SET value=NULL,revision=revision+1,at_ms=? WHERE actor_id=? AND message_id=? AND kind='answer' AND revision=?",
                             (now, actor, parent, result.get('answer_revision'))).rowcount
        if not changed:
            return []
        version = db.execute('SELECT sum(revision) FROM message_reactions WHERE message_id=?', (parent,)).fetchone()[0]
        message = db.execute('SELECT id,topic_id,author_id,private_to FROM messages WHERE id=?', (parent,)).fetchone()
        for reader in self._message_readers(db, message, actor):
            self._change(db, 'actor', reader, 'reaction', parent, version)
        return [{'kind': 'reaction', 'id': parent, 'version': version}]

    def _removed_waits(self, db, actor, topic, message_id):
        from .outcome_asks import record_ask
        from .reactions import answered_yes
        from .standing_conversation import is_conversation
        message = db.execute('SELECT id,author_id,intent,addressees,reply_to,seq,private_to FROM messages WHERE id=?', (message_id,)).fetchone()
        affected = []
        touched = []
        if message['intent'] == 'ask':
            for member in json.loads(message['addressees']):
                affected.extend(self._set_linked_wait(db, member, message_id, False, by=actor))
                self._topic_ask_answered(db, topic, member, message)
                self._sync_linked_attention(db, topic, member)
                touched.append(member)
            db.execute('DELETE FROM conversation_waits WHERE ask_id=?', (message_id,))
        # An answer is a surviving act, not merely an immutable row. Walk this
        # writer's older addressed asks, not unrelated topic history. Linked and
        # conversation asks require the exact reply; legacy topic asks use the
        # existing broad-writing rule. A record-held ask is settled by its record.
        asks = db.execute('SELECT m.id,m.topic_id,m.author_id,m.private_to,m.seq,m.sent_ms,m.intent,m.addressees FROM message_addressees a JOIN messages m ON m.seq=a.seq '
                          "WHERE a.topic_id=? AND a.actor_id=? AND a.seq<? AND m.intent='ask' AND " + ACTIVE +
                          ' AND NOT EXISTS (SELECT 1 FROM message_withdrawals w WHERE w.message_id=m.id) ORDER BY a.seq',
                          (topic['id'], actor, message['seq'])).fetchall()
        for ask in asks:
            linked = db.execute('SELECT 1 FROM ask_cover_links WHERE ask_id=? AND actor_id=?', (ask['id'], actor)).fetchone()
            if ((linked or is_conversation(topic) or message['private_to'] is not None) and message['reply_to'] != ask['id']
                    or message['private_to'] is not None and message['private_to'] != ask['author_id']
                    or record_ask(db, ask['id'], topic['workspace_id'], topic['id'])
                    or self._answered_since(db, topic, actor, ask)
                    or answered_yes(self._reaction_row(db, actor, ask['id'], 'thumb'))):
                continue
            affected.extend(self._set_linked_wait(db, actor, ask['id'], True, by=actor))
            if is_conversation(topic):
                db.execute('INSERT OR IGNORE INTO conversation_waits(ask_id,actor_id) VALUES (?,?)', (ask['id'], actor))
            else:
                self._topic_ask_unthumbed(db, topic, actor, ask)
            touched.append(actor)
        if is_conversation(topic):
            self._sync_waits(db, topic, touched)
        for member in dict.fromkeys(touched):
            self._sync_linked_attention(db, topic, member)
            self._change(db, 'actor', member, 'waiting', topic['id'], topic['version'] + 1)
        return affected

    def _retraction_readable(self, db, actor, row):
        if row['recipient_id'] != actor or self._actor_kind(db, actor) != 'agent':
            return False
        try:
            self._message_access(db, actor, row['retraction_id'])
        except Refusal:
            return False
        return True

    def _retraction_delivery_item(self, db, row):
        if not self._retraction_readable(db, row['recipient_id'], row):
            raise Refusal('FORBIDDEN', 'No readable delivery')
        record = value(db, row['retraction_id'])
        title = db.execute('SELECT title FROM topics WHERE id=?', (row['topic_id'],)).fetchone()[0]
        return {'seq': row['seq'], 'id': row['id'], 'message_id': None, 'recipient_id': row['recipient_id'], 'state': row['state'],
                'reasons': ['retraction'], 'retraction': dict(record, message_id=row['retraction_id']),
                'source_ref': {'kind': 'message', 'id': row['retraction_id']},
                'topic': {'id': row['topic_id'], 'title': title[:256], 'title_truncated': len(title) > 256}}
