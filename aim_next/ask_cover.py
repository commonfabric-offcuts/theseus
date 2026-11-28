from __future__ import annotations

"""Question-bound cover waits. All effects run inside the caller's Core transaction."""

import json

from .contract import Refusal, _json
from .cover_values import stored_value
from .stacks import StackRoots

ASK_COVER_SCHEMA = [
    "CREATE TABLE ask_cover_links (ask_id TEXT NOT NULL REFERENCES messages(id), actor_id TEXT NOT NULL REFERENCES actors(id), "
    "root_id TEXT NOT NULL REFERENCES messages(id), topic_id TEXT NOT NULL REFERENCES topics(id), "
    "ask_seq INTEGER NOT NULL REFERENCES messages(seq), value TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)), PRIMARY KEY(ask_id,actor_id))",
    "CREATE INDEX public_actor_writing ON messages(topic_id,author_id,seq) WHERE private_to IS NULL",
    "CREATE INDEX linked_topic_waits ON ask_cover_links(topic_id,actor_id,active,ask_seq)",
]
ASK_COVER_DOWN = ("DROP INDEX public_actor_writing", "DROP TABLE ask_cover_links")
ASK_COVER_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM ask_cover_links)"
CORRECTION = ('Supply ask_wait with root_id, cover_revision and questions: each asked person needs actor_id, text, '
              'options, default and reason. Use [] and null for no choices/no default, with a reason; nothing was sent')


def literal(value, limit, name):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise Refusal('ASK_WAIT_REQUIRED', '%s needs nonempty words, at most %d characters. %s' % (name, limit, CORRECTION), recorded=False)
    return value


class AskCover:
    def _check_ask_wait(self, db, actor, topic, snapshot, intent, private):
        # Notices use the existing internal publication boundary with a disabled
        # author. Only a public Ask needs the author/recipient kind lookup.
        # Validate recipients through their own contract before resolving kinds.
        recipients = self._recipients(db, snapshot['addressees']) if intent == 'ask' and private is None else []
        people = [p for p in recipients if p != actor and self._actor(db, p)['kind'] == 'human']
        required = bool(people) and self._actor(db, actor)['kind'] == 'agent'
        if not required:
            if 'ask_wait' in snapshot:
                raise Refusal('INVALID_ARGUMENT', 'ask_wait belongs to an agent Ask to people; nothing was sent')
            return None
        data = snapshot.get('ask_wait')
        if not isinstance(data, dict) or set(data) != {'root_id', 'cover_revision', 'questions'}:
            raise Refusal('ASK_WAIT_REQUIRED', CORRECTION, recorded=False)
        questions = data['questions']
        if not isinstance(questions, list) or not 1 <= len(questions) <= 4:
            raise Refusal('ASK_WAIT_REQUIRED', CORRECTION, recorded=False)
        checked = []
        for question in questions:
            if not isinstance(question, dict) or set(question) != {'actor_id', 'text', 'options', 'default', 'reason'}:
                raise Refusal('ASK_WAIT_REQUIRED', CORRECTION, recorded=False)
            options, default, reason = question['options'], question['default'], question['reason']
            if not isinstance(options, list) or len(options) > 4:
                raise Refusal('ASK_WAIT_REQUIRED', CORRECTION, recorded=False)
            for option in options:
                literal(option, 200, 'Each option')
            if default is not None:
                literal(default, 200, 'The default')
            if not options or default is None or reason is not None:
                literal(reason, 300, 'The reason')
            literal(question['text'], 300, 'The question')
            if not isinstance(question['actor_id'], str):
                raise Refusal('ASK_WAIT_REQUIRED', CORRECTION, recorded=False)
            checked.append(dict(question))
        if sorted(q['actor_id'] for q in checked) != sorted(people):
            raise Refusal('ASK_WAIT_REQUIRED', 'Name each asked person exactly once. ' + CORRECTION, recorded=False)
        parent = snapshot.get('reply_to')
        root_id = StackRoots(db, actor).root(parent) if parent else None
        if data['root_id'] != root_id:
            raise Refusal('STACK_CHANGED', 'The dossier changed; read its cover and supply its current root and revision; nothing was sent')
        revision = self._act_revision(db, root_id, 'cover', '') if root_id else 0
        if type(data['cover_revision']) is not int or data['cover_revision'] < 0:
            raise Refusal('ASK_WAIT_REQUIRED', CORRECTION, recorded=False)
        if data['cover_revision'] != revision:
            raise Refusal('REVISION_CONFLICT', 'This cover changed; read it and supply its current revision; nothing was sent', {'cover_revision': revision})
        return root_id, checked

    def _link_ask_cover(self, db, actor, topic, message_id, checked):
        if checked is None:
            return []
        root_id, questions = checked
        root_id = root_id or message_id
        root = db.execute('SELECT id,topic_id,seq,private_to,author_id FROM messages WHERE id=?', (root_id,)).fetchone()
        # Private asks are forbidden; a public question must never be attached to a private cover.
        if root['private_to'] is not None:
            raise Refusal('WHISPER_STAYS_PRIVATE', 'A public ask needs a public dossier; nothing was sent')
        value = stored_value(self._act_value(db, root_id, 'cover', ''))
        sequence = db.execute('SELECT seq FROM messages WHERE id=?', (message_id,)).fetchone()[0]
        for question in questions:
            wait = dict(question, ask_id=message_id, revision=1)
            db.execute('INSERT INTO ask_cover_links VALUES (?,?,?,?,?,?,1)',
                       (message_id, question['actor_id'], root_id, topic['id'],
                        sequence, _json(wait)))
            value['waiting'].append(wait)
        return self._write_linked_cover(db, actor, root, value)

    def _write_linked_cover(self, db, actor, root, value):
        current = self._act_revision(db, root['id'], 'cover', '')
        version = self._record_act(db, 'cover', root, '', actor, value, current + 1)
        return [{'kind': 'acts', 'id': root['topic_id'], 'version': version}]

    def _set_linked_wait(self, db, actor, ask_id, active, *, by=None):
        # actor identifies the person asked. Withdrawal is the asker's act,
        # while the ordinary answer/recovery path belongs to that person.
        row = db.execute('SELECT * FROM ask_cover_links WHERE ask_id=? AND actor_id=?', (ask_id, actor)).fetchone()
        if active and (self._question_closed(db, ask_id) is not None or self._withdrawal_value(db, ask_id) is not None):
            return []
        if row is None or bool(row['active']) == active:
            return []
        db.execute('UPDATE ask_cover_links SET active=? WHERE ask_id=? AND actor_id=?', (int(active), ask_id, actor))
        root = db.execute('SELECT id,topic_id,seq,private_to,author_id FROM messages WHERE id=?', (row['root_id'],)).fetchone()
        value = stored_value(self._act_value(db, root['id'], 'cover', ''))
        value['waiting'] = [w for w in value['waiting'] if not (w.get('ask_id') == ask_id and w.get('actor_id') == actor)]
        if active:
            value['waiting'].append(json.loads(row['value']))
        # Only the public question and the person appear here, never a private answer's identity or words.
        return self._write_linked_cover(db, actor if by is None else by, root, value)

    def _sync_linked_attention(self, db, topic, actor):
        """Keep the topic projection on its earliest open linked question."""
        oldest = db.execute('SELECT m.id,m.seq,m.sent_ms,m.author_id FROM ask_cover_links q JOIN messages m ON m.id=q.ask_id '
                            'WHERE q.topic_id=? AND q.actor_id=? AND q.active=1 ORDER BY q.ask_seq LIMIT 1', (topic['id'], actor)).fetchone()
        if oldest is None:
            return
        current = db.execute('SELECT m.seq FROM topic_waiting q LEFT JOIN messages m ON m.id=q.ask_message_id '
                             'WHERE q.topic_id=? AND q.actor_id=?', (topic['id'], actor)).fetchone()
        if current is None or current['seq'] is None:
            self._ask(db, topic, oldest['author_id'], oldest['id'], oldest['sent_ms'], [actor])
        elif oldest['seq'] < current['seq']:
            self._wait_from(db, topic, actor, oldest)
