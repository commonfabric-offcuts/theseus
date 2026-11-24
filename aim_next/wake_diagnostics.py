from __future__ import annotations

"""Bounded observations, separate from whether a wake reached its recipient."""

import json

from .contract import Refusal
from .delivery import _position


PREFIX = 'wake_read.v1:'
CATEGORIES = {'reading', 'complete', 'partial', 'core_refusal', 'malformed', 'transport_failure'}
# Only fixed, owned codes enter Health. Never copy an exception/error message.
CODES = {
    'DATABASE_BUSY': 'Core was busy; the next wake can retry.',
    'FORBIDDEN': 'Core refused access.',
    'AUTHORITY_CHANGED': 'The selected authority changed; this operation stopped.',
    'INVALID_BINDING': 'Core refused the selected binding; this operation stopped.',
    'BINDING_MISMATCH': 'Core refused the selected binding; this operation stopped.',
    'INSTANCE_MISMATCH': 'Core refused the selected instance; this operation stopped.',
    'AUTHORITY_BUSY': 'The selected authority was busy.',
    'INVALID_ARGUMENT': 'Core refused the pending-page request.',
    'VIEW_TOO_LARGE': 'Core could not return the pending page within its limit.',
    'SUMMARY_ITEM_TOO_LARGE': 'Core could not return a pending item within its limit.',
}
BINDING_CODES = {'AUTHORITY_CHANGED', 'INVALID_BINDING', 'BINDING_MISMATCH', 'INSTANCE_MISMATCH'}


def observation(category, page, cursor=None, count=0, error=None):
    value = dict(v=1, category=category, page_index=page, cursor=cursor, item_count=count,
                 code=None, retryable=None)
    if type(error) is dict:
        code = error.get('code')
        value['code'] = code if type(code) is str and code in CODES else None
        value['retryable'] = error.get('retryable') if type(error.get('retryable')) is bool else None
    return validate(value)


def validate(value):
    keys = {'v', 'category', 'page_index', 'cursor', 'item_count', 'code', 'retryable'}
    if (type(value) is not dict or set(value) != keys or type(value['v']) is not int or value['v'] != 1
            or type(value['category']) is not str or value['category'] not in CATEGORIES
            or type(value['page_index']) is not int or not 0 <= value['page_index'] < 5
            or type(value['item_count']) is not int or not 0 <= value['item_count'] <= 500
            or value['code'] is not None and (type(value['code']) is not str or value['code'] not in CODES)
            or value['retryable'] is not None and type(value['retryable']) is not bool):
        raise ValueError('Invalid wake read observation')
    _position(value['cursor'])  # Canonical Core cursor, never arbitrary returned bytes.
    return dict(value)


def put(db, actor, attempt_id, at, value):
    """The caller has checked actual claim ownership inside the runner effect."""
    value = dict(validate(value), actor_id=actor, attempt_id=attempt_id, observed_ms=at)
    encoded = json.dumps(value, separators=(',', ':'))
    db.execute('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
               (PREFIX + 'attempt:' + attempt_id, encoded))
    # One exact key per recipient; no attempt-history scan. Time comes from Core.
    old = read(db, actor)
    if old is None or (at, attempt_id) >= (old['observed_ms'], old['attempt_id']):
        db.execute('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                   (PREFIX + 'actor:' + actor, encoded))
    return value


def read(db, actor):
    row = db.execute('SELECT value FROM metadata WHERE key=?', (PREFIX + 'actor:' + actor,)).fetchone()
    if row is None or len(row[0]) > 2048:
        return None
    try:
        value = json.loads(row[0])
        extra = {'actor_id', 'attempt_id', 'observed_ms'}
        validate({key: item for key, item in value.items() if key not in extra})
        if (set(value) != extra | {'v', 'category', 'page_index', 'cursor', 'item_count', 'code', 'retryable'}
                or value['actor_id'] != actor or type(value['attempt_id']) is not str
                or not value['attempt_id'].startswith('a-') or len(value['attempt_id']) > 100
                or type(value['observed_ms']) is not int or value['observed_ms'] < 0):
            return None
        return value
    except (ValueError, TypeError, AttributeError, Refusal):
        return None


def words(value):
    category = value['category']
    text = {'reading': 'the pending page read has no recorded result',
            'complete': 'the pending pages were read; this does not prove wake delivery',
            'partial': 'the pending-page budget ended; more work may remain',
            'core_refusal': CODES.get(value['code'], 'Core refused the pending page; its details were withheld.'),
            'malformed': 'the pending page was malformed; its contents were withheld',
            'transport_failure': 'the pending page could not be read; its contents were withheld'}[category]
    return 'Pending page %d: %s' % (value['page_index'] + 1, text)


def health(db, actor, now):
    value = read(db, actor)
    if value is None:
        return None
    row = db.execute('SELECT a.claim_token,a.lease_until_ms,r.outcome,r.finished_ms,h.final_status '
                     'FROM wake_attempts a LEFT JOIN wake_results r ON r.attempt_id=a.id '
                     'LEFT JOIN hosted_turns h ON h.attempt_id=a.id WHERE a.id=? AND a.recipient_id=?',
                     (value['attempt_id'], actor)).fetchone()
    state, outcome = 'unknown', None
    if row is not None:
        outcome = row['outcome']
        if outcome == 'handed':
            state = 'running' if row['final_status'] is None else 'terminal'
        elif outcome is not None:
            state = 'terminal'
        elif row['lease_until_ms'] > now:
            state = 'pending_intent'
    return dict(value, state=state, outcome=outcome, finished_ms=row['finished_ms'] if row is not None else None,
                why=words(value))
