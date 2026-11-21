from __future__ import annotations

"""Post-publication membership advice; never a routing or membership write (1020)."""

import json
import re

from .contract import Refusal, _identifier, _page_size, _prefix, organises

# The picker starts after whitespace or opening punctuation. A complete token
# must end there too: emails, possessives and embedded @words are not mentions.
MENTION = re.compile(r'(?:^|[\s([{,:;!?])@([A-Za-z0-9_.-]+)(?=$|[\s,;:!?)}\]])')


def resolve(db, token):
    key = token.rstrip('.')
    if not key or len(key) > 200:
        return None
    columns = 'id,kind,enabled,substr(CAST(name AS BLOB),1,1025) AS name_prefix'
    # Canonical IDs (the picker inserts them) take the actor primary key path.
    row = db.execute('SELECT ' + columns + ' FROM actors WHERE id=?', (key,)).fetchone()
    if row is not None:
        return row if row['enabled'] else None
    rows = db.execute('SELECT ' + columns + ' FROM actors WHERE id=? COLLATE NOCASE LIMIT 2', (key,)).fetchall()
    if rows:
        return rows[0] if len(rows) == 1 and rows[0]['enabled'] else None
    rows = db.execute('SELECT ' + columns + ' FROM actors WHERE enabled=1 AND name=? COLLATE NOCASE LIMIT 2', (key,)).fetchall()
    return rows[0] if len(rows) == 1 else None


class MentionReach:
    def _view_submission_mention_reach(self, db, actor, args):
        row, snapshot = self._submission(db, actor, args.get('submission_id'))
        receipt = db.execute('SELECT outcome FROM operations WHERE actor_id=? AND id=?',
                             (actor, row['send_operation_id'])).fetchone()
        receipt = json.loads(receipt[0]) if receipt else None
        if not receipt or receipt.get('status') != 'committed':
            raise Refusal('FORBIDDEN', 'No confirmed publication for this submission')
        message_id = _identifier(receipt.get('result', {}).get('message_id'), 'message_id')
        identity = self._message_access(db, actor, message_id)
        topic = self._topic(db, actor, identity['topic_id'])
        outcome = topic['kind'] == 'conversation'
        workspace = db.execute('SELECT * FROM workspaces WHERE id=?', (topic['workspace_id'],)).fetchone()
        scope = dict(kind='outcome' if outcome else 'topic', id=workspace['id'] if outcome else topic['id'],
                     title=workspace['title'] if outcome else topic['title'],
                     revision=workspace['version'] if outcome else topic['version'],
                     may_add=organises(workspace, actor) if outcome else True,
                     add_kind='workspace.member_set' if outcome else 'participation.set',
                     target={'workspace_id': workspace['id']} if outcome else {'topic_id': topic['id']},
                     revision_field='workspace_revision' if outcome else 'topic_revision')
        body = snapshot.get('body') or ''
        at, limit = args.get('cursor', 0), _page_size(args)
        if type(at) is not int or not 0 <= at <= len(body):
            raise Refusal('INVALID_ARGUMENT', 'Invalid mention cursor')
        items, next_cursor = [], None
        if identity['private_to'] is None:
            members = {p[0] for p in db.execute('SELECT actor_id FROM topic_participants WHERE topic_id=? AND active=1', (topic['id'],))}
            members.add(actor)
            seen, examined = set(), 0
            for match in MENTION.finditer(body, at):
                if examined == limit:
                    # Keep the preceding separator for the next page's regex.
                    next_cursor = match.start()
                    break
                examined += 1
                person = resolve(db, match.group(1))
                if person is None or person['id'] in members or person['id'] in seen:
                    continue
                seen.add(person['id'])
                # Explicit addressing can reach someone who is no longer a
                # participant. Pending delivery counts; cancelled delivery does not.
                if db.execute("SELECT 1 FROM deliveries WHERE message_id=? AND recipient_id=? AND state<>'cancelled'",
                              (message_id, person['id'])).fetchone():
                    continue
                name, truncated = _prefix(person['name_prefix'])
                already_team = outcome and db.execute('SELECT 1 FROM workspace_members WHERE workspace_id=? AND actor_id=?',
                                                       (workspace['id'], person['id'])).fetchone()
                items.append(dict(actor_id=person['id'], kind=person['kind'], name=name, name_truncated=truncated,
                                  may_add=scope['may_add'] and not bool(already_team)))
        return dict(instance_id=self.instance_id, message_id=message_id, scope=scope, items=items, next_cursor=next_cursor)
