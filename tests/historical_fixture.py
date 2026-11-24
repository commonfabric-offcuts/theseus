from __future__ import annotations

"""Test-only reconstruction from independently frozen historical DDL."""
from pathlib import Path
import re
import sqlite3


_OBJECT = re.compile(r'^CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX|TRIGGER|VIEW)\s+("[^"]+"|`[^`]+`|\[[^]]+\]|\w+)', re.I)


def _quoted(name):
    return '"' + name.replace('"', '""') + '"'


def _objects(db):
    return {name: (kind, table, sql) for kind, name, table, sql in db.execute(
        "SELECT type,name,tbl_name,sql FROM main.sqlite_master WHERE sql IS NOT NULL")}


def _layout(version):
    if not isinstance(version, str) or not re.fullmatch(r'(?:[89]|[1-3][0-9]|4[0-8]|12-early)', version):
        raise ValueError('No frozen historical layout for %r' % (version,))
    # The settling step changed records, not DDL. HealthStepCase already uses
    # SCHEMA_BEFORE_SETTLE for its version31 predecessor; no schema31 file exists.
    filename = '30' if version == '31' else version.replace('-', '_')
    statements = (Path(__file__).parent / 'fixtures' / ('schema_%s.sql' % filename)).read_text().splitlines()
    result = {}
    for statement in statements:
        sql = statement.rstrip(';')
        match = _OBJECT.match(sql)
        if match is None:
            raise ValueError('Frozen layout %s contains an unrecognized DDL statement' % version)
        name = match[2].strip('"`[]')
        if name in result:
            raise ValueError('Frozen layout %s repeats object %s' % (version, name))
        result[name] = (match[1].lower(), sql)
    return result


def _historical_rows(db, version):
    """Keep the existing fixture's record adaptations, separate from its DDL."""
    number = int(version.split('-')[0])
    if number < 32:
        db.execute("DELETE FROM metadata WHERE key IN ('health_announced','health_due')")
        db.execute("DELETE FROM actors WHERE id='theseus'")
    if number < 28:
        # Today's workspace starts a conversation. A pre-conversation outcome
        # must not feed that new topic/its related rows into the old upgrade.
        conversations = [row[0] for row in db.execute("SELECT id FROM topics WHERE kind='conversation'")]
        tables = [row[0] for row in db.execute(
            "SELECT m.name FROM sqlite_master m JOIN pragma_table_info(m.name) c "
            "WHERE m.type='table' AND c.name='topic_id'")]
        for table in tables:
            db.executemany('DELETE FROM ' + _quoted(table) + ' WHERE topic_id=?', [(topic,) for topic in conversations])
        db.executemany("DELETE FROM changes WHERE resource_id=? OR scope_id=?", [(topic, topic) for topic in conversations])
        db.executemany("DELETE FROM topics WHERE id=?", [(topic,) for topic in conversations])


def _rebuild_table(db, name, sql, version):
    scratch = '__historical_fixture_copy'
    match = _OBJECT.match(sql)
    # A TEMP table obtains the target's actual columns/defaults/constraints.
    # Re-create the main table with the original SQL rather than ALTER RENAME,
    # which would rewrite its stored CREATE and defeat exact frozen equality.
    created = False
    try:
        db.execute('CREATE TEMP TABLE ' + _quoted(scratch) + sql[match.end():])
        created = True
        old = {row[1] for row in db.execute('PRAGMA main.table_info(' + _quoted(name) + ')')}
        target = [row[1] for row in db.execute('PRAGMA temp.table_info(' + _quoted(scratch) + ')')]
        shared = [column for column in target if column in old]
        if not shared:
            raise ValueError('Frozen layout %s cannot copy table %s without shared columns' % (version, name))
        columns = ','.join(_quoted(column) for column in shared)
        db.execute('INSERT INTO temp.' + _quoted(scratch) + '(' + columns + ') SELECT ' + columns +
                   ' FROM main.' + _quoted(name) + ' ORDER BY rowid')
        db.execute('DROP TABLE main.' + _quoted(name))
        db.execute(sql)
        columns = ','.join(_quoted(column) for column in target)
        db.execute('INSERT INTO main.' + _quoted(name) + '(' + columns + ') SELECT ' + columns +
                   ' FROM temp.' + _quoted(scratch) + ' ORDER BY rowid')
    except sqlite3.Error as error:
        raise ValueError('Frozen layout %s cannot preserve table %s: %s' % (version, name, error)) from error
    finally:
        if created:
            db.execute('DROP TABLE temp.' + _quoted(scratch))


def restore_frozen_layout(path, version, *, connect=sqlite3.connect):
    """Atomically project shared occupied columns into the exact frozen DDL.

    No production migration or writable-schema shortcut is used. Incompatible
    records raise with their version/table, rolling the reconstruction back.
    """
    wanted = _layout(version)
    db = connect(str(path))
    try:
        # Like the former hand-built fixture, reconstruction uses its own
        # connection without FK enforcement while related tables are replaced.
        db.execute('PRAGMA foreign_keys=OFF')
        with db:
            db.execute('BEGIN IMMEDIATE')
            current = _objects(db)
            rebuild = {name for name, (kind, sql) in wanted.items()
                       if kind == 'table' and name in current and current[name][2] != sql}
            removed = {name for name, (kind, _, _) in current.items() if kind == 'table' and name not in wanted}
            sequences = dict(db.execute('SELECT name,seq FROM main.sqlite_sequence'))
            # Unchanged objects on retained tables stay. Rebuilt tables lose
            # their owned objects and receive the frozen versions below.
            for name, (kind, table, sql) in current.items():
                if kind != 'table' and (wanted.get(name) != (kind, sql) or table in rebuild | removed):
                    db.execute('DROP ' + kind.upper() + ' ' + _quoted(name))
            _historical_rows(db, version)
            for name in removed:
                db.execute('DROP TABLE ' + _quoted(name))
            for name, (kind, sql) in wanted.items():
                if kind != 'table' or name == 'sqlite_sequence':
                    continue
                if name not in current:
                    db.execute(sql)
                elif name in rebuild:
                    _rebuild_table(db, name, sql, version)
            present = _objects(db)
            for kind in ('index', 'view', 'trigger'):
                for name, (expected_kind, sql) in wanted.items():
                    if expected_kind == kind and name not in present:
                        db.execute(sql)
            for name, sequence in sequences.items():
                if name in wanted and wanted[name][0] == 'table' and 'AUTOINCREMENT' in wanted[name][1].upper():
                    # A TEMP AUTOINCREMENT copy leaves temp.sqlite_sequence
                    # behind even after the copy is dropped. Always address
                    # main's allocation history explicitly.
                    changed = db.execute('UPDATE main.sqlite_sequence SET seq=? WHERE name=?', (sequence, name)).rowcount
                    if not changed:
                        db.execute('INSERT INTO main.sqlite_sequence(name,seq) VALUES (?,?)', (name, sequence))
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version.split('-')[0],))
            if sorted(row[2] for row in _objects(db).values()) != sorted(sql for _, sql in wanted.values()):
                raise ValueError('Frozen layout %s did not reproduce its exact SQL' % version)
    finally:
        db.close()


def reply_fields(args, *, case, actor):
    """A positive fixture reply explicitly explains its lack of a passage."""
    result = dict(args)
    if (result.get('reply_to') and 'reply_passage' not in result and 'reply_without_quote' not in result
            and case.sql('SELECT kind FROM actors WHERE id=?', (actor,))[0][0] == 'agent'):
        result['reply_without_quote'] = 'This fixture reply concerns the complete synthetic discussion'
    return result


def post_fields(case, actor, args):
    """Current fields for explicitly positive fixture writers, never all commands."""
    result = reply_fields(args, case=case, actor=actor)
    if result.get('intent') == 'ask' and not result.get('whisper') and 'ask_wait' not in result:
        people = [who for who in result.get('addressees', []) if who != actor and
                  case.sql('SELECT kind FROM actors WHERE id=?', (who,))[0][0] == 'human']
        if people and case.sql('SELECT kind FROM actors WHERE id=?', (actor,))[0][0] == 'agent':
            parent = result.get('reply_to')
            cover = case.store.view(actor, 'dossier_cover', {'message_id': parent}) if parent else None
            result['ask_wait'] = {
                'root_id': cover['root_id'] if cover else None,
                'cover_revision': cover['cover_revision'] if cover else 0,
                'questions': [{'actor_id': who, 'text': result['body'][:300], 'options': [], 'default': None,
                               'reason': 'The historical fixture supplies no choices or default'} for who in people]}
    return result
