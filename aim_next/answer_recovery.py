from __future__ import annotations

"""Exact source-revision answer hints; missing keys explicitly mean unknown."""

import json

from . import reply_passages
from .contract import Refusal
from .message_edit import withheld


PREFIX = 'source_answer.v1:'


def key(actor, source, revision):
    return PREFIX + json.dumps([actor, source, revision], separators=(',', ':'))


def record(db, actor, message_id, basis):
    if basis is None:
        return
    source = basis['source']
    db.execute('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
               (key(actor, source['id'], source['revision']), json.dumps({'message_id': message_id}, separators=(',', ':'))))


def lookup(store, db, actor, source, revision):
    row = db.execute('SELECT value FROM metadata WHERE key=?', (key(actor, source, revision),)).fetchone()
    unknown = {'state': 'unknown', 'coverage': 'exact_key_only'}
    if row is None or len(row[0]) > 512:
        return unknown
    try:
        value = json.loads(row[0])
        if type(value) is not dict or set(value) != {'message_id'} or type(value['message_id']) is not str:
            return unknown
        answer_id = value['message_id']
        answer = store._message_access(db, actor, answer_id)
        store._message_access(db, actor, source)
        if answer['author_id'] != actor or withheld(answer_id) or withheld(source):
            return unknown
        basis = reply_passages.read(db, answer_id)
        if basis is None or basis['source'] != {'kind': 'message', 'id': source, 'revision': revision}:
            return unknown
        seq = db.execute('SELECT seq FROM messages WHERE id=?', (answer_id,)).fetchone()[0]
        return {'state': 'answered', 'source_revision': revision, 'message_id': answer_id, 'seq': seq}
    except (ValueError, TypeError, KeyError, Refusal):
        return unknown
