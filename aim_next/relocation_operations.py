from __future__ import annotations

"""Read one saved operation through current published lineage; no replay (1328)."""

import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3

from .authority import AuthorityError
from .contract import Refusal, _json
from .recovery_io import RecoveryError, require
from . import recovery_io as io
from .validation import _command_envelope
from .store import SCHEMA_VERSION

HEX = re.compile('[0-9a-f]{64}')
SOURCE = {'instance_id', 'db_path', 'authority_path', 'authority_id', 'authority_epoch'}
OLD_BINDING = {'instance_id', 'actor_id', 'db_path', 'authority_id', 'authority_epoch'}
METADATA = {'schema_version', 'instance_id', 'authority_id', 'authority_path',
            'authority_epoch', 'commit_seq', 'commit_id'}
RECEIPT = {'status', 'durability_confirmed', 'journal_path', 'move_id',
           'request_digest', 'cutover_commit', 'observed_commit', 'binding'}
LINEAGE = {'move_id', 'request_digest', 'stage_digest', 'journal_identity',
           'journal_path', 'predecessor_digest', 'predecessor', 'commit'}


def _copy(value):
    # Snapshot JSON inputs without accepting custom object behavior in the read.
    require(type(value) is dict, 'LOOKUP_INVALID_REQUEST')
    data = _json(value).encode('utf-8')
    require(len(data) <= 2 * 1024 * 1024, 'LOOKUP_INVALID_REQUEST')
    return json.loads(data)


def _path(value):
    # Historical paths are strings, never resolved/stat'ed/opened.
    return (type(value) is str and 0 < len(value.encode('utf-8')) <= 4096
            and '\x00' not in value and value.startswith('/') and not value.startswith('//')
            and os.path.normpath(value) == value)


def _hex(value):
    return type(value) is str and HEX.fullmatch(value) is not None


def _commit(value):
    return (type(value) is dict and set(value) == {'seq', 'id'}
            and type(value['seq']) is str and value['seq'].isascii() and value['seq'].isdigit()
            and len(value['seq']) <= 19 and str(int(value['seq'])) == value['seq']
            and int(value['seq']) < 9223372036854775807
            and type(value['id']) is str and re.fullmatch('[0-9a-f]{32}', value['id']) is not None)


def _inputs(actor, saved, receipt):
    require(io.identifier(actor), 'LOOKUP_INVALID_REQUEST')
    saved, receipt = _copy(saved), _copy(receipt)
    require(set(saved) == {'v', 'binding', 'command'} and type(saved['v']) is int
            and saved['v'] == 1 and type(saved['binding']) is dict
            and set(saved['binding']) == OLD_BINDING and type(saved['command']) is dict
            and set(saved['command']) == {'v', 'instance_id', 'operation_id', 'kind', 'target', 'expected', 'args'}
            and type(saved['command']['v']) is int and saved['command']['v'] == 1, 'LOOKUP_INVALID_REQUEST')
    old = saved['binding']
    require(all(io.identifier(old[k]) for k in OLD_BINDING - {'db_path'})
            and _path(old['db_path']), 'LOOKUP_INVALID_REQUEST')
    require(actor == old['actor_id'], 'LOOKUP_ACTOR_MISMATCH')
    command = _command_envelope(saved['command'])
    require(command['instance_id'] == old['instance_id']
            and command['expected']['authority'] == {k: old[k] for k in ('authority_id', 'authority_epoch')},
            'LOOKUP_PREDECESSOR_MISMATCH')
    require(set(receipt) == RECEIPT and receipt['status'] == 'published'
            and receipt['durability_confirmed'] is True and type(receipt['binding']) is dict
            and set(receipt['binding']) == SOURCE and _path(receipt['journal_path'])
            and io.identifier(receipt['move_id']) and _hex(receipt['request_digest'])
            and type(receipt['cutover_commit']) is dict and set(receipt['cutover_commit']) == METADATA
            and _commit(receipt['observed_commit']), 'LOOKUP_RECEIPT_MISMATCH')
    return old, command, receipt


def _transition(store, record, old, receipt):
    current = dict(store.binding, instance_id=store.instance_id, db_path=str(store.path))
    require(receipt['binding'] == current, 'LOOKUP_RECEIPT_MISMATCH')
    recovery = record.get('recovery')
    require(type(recovery) is dict and recovery.get('kind') == 'relocation'
            and type(recovery.get('relocation')) is dict, 'LOOKUP_LINEAGE_MISMATCH')
    lineage = recovery['relocation']
    require(set(lineage) == LINEAGE and type(lineage['predecessor']) is dict
            and set(lineage['predecessor']) == SOURCE
            and all(_hex(lineage[k]) for k in ('request_digest', 'stage_digest', 'predecessor_digest'))
            and type(lineage['journal_identity']) is list and len(lineage['journal_identity']) == 2
            and all(type(n) is int and n >= 0 for n in lineage['journal_identity'])
            and _path(lineage['journal_path']) and _commit(lineage['commit']), 'LOOKUP_LINEAGE_MISMATCH')
    predecessor = lineage['predecessor']
    require(all(_path(predecessor[k]) for k in ('db_path', 'authority_path'))
            and all(io.identifier(predecessor[k]) for k in SOURCE - {'db_path', 'authority_path'}),
            'LOOKUP_LINEAGE_MISMATCH')
    require({k: old[k] for k in OLD_BINDING - {'actor_id'}}
            == {k: predecessor[k] for k in OLD_BINDING - {'actor_id'}}
            and old['instance_id'] == store.instance_id
            and predecessor['authority_id'] == record['authority_id']
            and predecessor['authority_epoch'] != record['epoch'], 'LOOKUP_PREDECESSOR_MISMATCH')
    historical = receipt['cutover_commit']
    require(all(type(v) is str for v in historical.values())
            and historical['schema_version'] == SCHEMA_VERSION
            and {k: historical[k] for k in ('instance_id', 'authority_id', 'authority_path', 'authority_epoch')}
            == {k: predecessor[k] for k in ('instance_id', 'authority_id', 'authority_path', 'authority_epoch')}
            and dict(seq=historical['commit_seq'], id=historical['commit_id']) == lineage['commit']
            and receipt['move_id'] == lineage['move_id']
            and receipt['request_digest'] == lineage['request_digest']
            and receipt['journal_path'] == lineage['journal_path'], 'LOOKUP_TRANSITION_MISMATCH')
    return _copy(lineage)


def _runner_pair(store, record, fd):
    named = Path(str(store._authority.path) + '.runner.lock')
    require(io.identity(io.check_info(os.fstat(fd))) == io.identity(io.checked(named))
            == [record['runner_lock_device'], record['runner_lock_inode']], 'LOOKUP_IDENTITY_CHANGED')


def _outcome(value, command):
    require(type(value) is dict and value.get('instance_id') == command['instance_id']
            and value.get('operation_id') == command['operation_id'], 'LOOKUP_UNCONFIRMED')
    if value.get('recorded') is False:
        require(set(value) == {'instance_id', 'operation_id', 'status', 'recorded'}
                and value['status'] == 'unknown', 'LOOKUP_UNCONFIRMED')
        return 'unknown_held'
    require(value.get('recorded') is True and value.get('kind') == command['kind']
            and value.get('status') in ('committed', 'rejected') and 'result' in value
            and type(value.get('affected')) is list
            and (value['status'] == 'rejected') == ('error' in value), 'LOOKUP_UNCONFIRMED')
    return 'recorded'


def lookup_relocated_operation(store, actor, saved_request, publication_receipt):
    """Read the unchanged original result through one current published hop."""
    try:
        old, command, receipt = _inputs(actor, saved_request, publication_receipt)
        fingerprint = hashlib.sha256(_json(command).encode('utf-8')).hexdigest()
        with store._authority.shared() as fence:
            before = _copy(fence.record)
            transition = _transition(store, before, old, receipt)
            with io.opened(Path(str(store._authority.path) + '.runner.lock')) as runner_fd:
                _runner_pair(store, before, runner_fd)
                value = store.view(actor, 'operation', dict(operation_id=command['operation_id'],
                                                           expected_fingerprint=fingerprint))
                if type(value) is dict and 'error' in value and value.get('recorded') is not True:
                    error = value['error']
                    require(type(error) is dict and type(error.get('code')) is str
                            and type(error.get('retryable')) is bool, 'LOOKUP_UNCONFIRMED')
                    raise RecoveryError(error['code'], retryable=error['retryable'])
                status = _outcome(value, command)
                fence.verify()
                require(fence.record == before, 'LOOKUP_LINEAGE_CHANGED')
                _runner_pair(store, before, runner_fd)
                require(_transition(store, fence.record, old, receipt) == transition, 'LOOKUP_LINEAGE_CHANGED')
                result = dict(status=status, replay_allowed=False, fingerprint=fingerprint,
                              receipt=value, transition=transition)
        return result
    except RecoveryError:
        raise
    except AuthorityError as error:
        raise RecoveryError(error.code, retryable=error.retryable) from error
    except Refusal as error:
        raise RecoveryError(error.code) from error
    except (OSError, sqlite3.Error, ValueError, KeyError, TypeError, UnicodeError, RecursionError) as error:
        raise RecoveryError('LOOKUP_UNCONFIRMED') from error
