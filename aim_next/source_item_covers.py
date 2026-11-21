from __future__ import annotations

"""Reader-filtered source-item rows. No stored cover text or attributed acts.

Only requested dossiers' indexed members and their actual item relations are
read. Pipeline member/entry rows are the transactionally settled record view;
there is no whole-pipeline fact replay on a card read.
"""

import json

SOURCE_KEYS_PER_READER_TOPIC = 32

from .outcome_rules import stage_name
from .pipeline import SECTION_WORDS

SOURCE_COVER_SCHEMA = [
    "CREATE INDEX source_cover_changes ON changes(scope_kind,scope_id,resource_kind,resource_id,seq)",
    "CREATE INDEX source_cover_items ON pipeline_item_sources(message_id, workspace_id, number) WHERE message_id IS NOT NULL",
    "CREATE INDEX source_cover_topics ON pipeline_item_sources(workspace_id, message_id) WHERE message_id IS NOT NULL",
    "CREATE TABLE source_cover_releases (item INTEGER NOT NULL, release INTEGER NOT NULL REFERENCES releases(number), PRIMARY KEY(item,release))",
    "INSERT INTO source_cover_releases SELECT j.value,r.number FROM releases r,json_each(r.items) j",
    "CREATE TRIGGER source_cover_release_insert AFTER INSERT ON releases BEGIN "
    "INSERT INTO source_cover_releases SELECT j.value,NEW.number FROM json_each(NEW.items) j; END",
]


def _state(db, item):
    workspace, number = item['workspace_id'], item['number']
    piece = db.execute("SELECT p.id,p.kind FROM pipeline_piece_members m JOIN pipeline_pieces p ON p.id=m.piece_id "
                       "WHERE m.workspace_id=? AND m.number=? AND m.left_ms IS NULL", (workspace, number)).fetchone()
    # _settle keeps a shipped/finished item in its piece. A record may also
    # ship an item that never had a piece, so releases must be checked first.
    release = db.execute("SELECT release FROM source_cover_releases WHERE item=? ORDER BY release DESC LIMIT 1", (number,)).fetchone() if item['ships_in_releases'] else None
    if release:
        return 'Live · release %d' % release[0], piece['id'] if piece else None
    done = item['finished_note'] or db.execute(
        "SELECT 1 FROM pipeline_piece_members m JOIN pipeline_stage_entries e ON e.piece_id=m.piece_id "
        "WHERE m.workspace_id=? AND m.number=? AND e.left_outcome='done' LIMIT 1", (workspace, number)).fetchone()
    if done:
        return 'Done', piece['id'] if piece else None
    if piece:
        entry = db.execute("SELECT e.*,s.name,s.rounds FROM pipeline_stage_entries e JOIN pipeline_stages s "
                           "ON s.workspace_id=e.workspace_id AND s.stage_id=e.stage_id "
                           "WHERE e.piece_id=? AND e.left_ms IS NULL", (piece['id'],)).fetchone()
        if entry:
            name = stage_name(entry['name'], entry['rounds'], entry['round'])
            # Release membership, not the old combined piece's Wait, owns it.
            return name, piece['id']
    words = json.loads(item['section_words']).get(item['section'], SECTION_WORDS.get(item['section'], 'Dropped'))
    if item['section'] == 'candidates' and item['candidate_group']:
        words += ' · ' + item['candidate_group']
    event = db.execute("SELECT payload FROM pipeline_events WHERE workspace_id=? AND number=? AND kind='moved' "
                       "ORDER BY seq DESC LIMIT 1", (workspace, number)).fetchone()
    moved = json.loads(event[0]) if event else {}
    last_end = db.execute("SELECT e.left_note FROM pipeline_piece_members m JOIN pipeline_stage_entries e ON e.piece_id=m.piece_id "
                          "WHERE m.workspace_id=? AND m.number=? ORDER BY e.seq DESC LIMIT 1", (workspace, number)).fetchone()
    if moved.get('set_aside') or moved.get('set_aside_stays') or (last_end and last_end[0].startswith('Set aside: ')):
        words += ' · set aside'
    return words, None


def project(db, actor, root, cover):
    # Deferred import: stacks owns the reader's actual root/member contract.
    from .stacks import MEMBERS
    relations = db.execute(MEMBERS + " SELECT s.workspace_id,s.number,s.message_id,s.position FROM members p "
                           "CROSS JOIN pipeline_item_sources s INDEXED BY source_cover_items ON s.message_id=p.id "
                           "JOIN workspaces w ON w.id=s.workspace_id "
                           "WHERE s.message_id IS NOT NULL AND (w.owner_id=:actor OR EXISTS "
                           "(SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=w.id AND wm.actor_id=:actor)) "
                           "ORDER BY s.workspace_id,s.number,s.position", {'root': root, 'actor': actor}).fetchall()
    grouped = {}
    for source in relations:
        grouped.setdefault((source['workspace_id'], source['number']), []).append(source['message_id'])
    rows = []
    for (workspace, number), sources in grouped.items():
        item = db.execute("SELECT i.workspace_id,i.number,i.title,i.section,i.candidate_group,i.finished_note,p.ships_in_releases,p.section_words FROM pipeline_items i JOIN pipelines p "
                          "ON p.workspace_id=i.workspace_id WHERE i.workspace_id=? AND i.number=?", (workspace, number)).fetchone()
        state, piece = _state(db, item)
        rows.append({'workspace_id': workspace, 'number': number, 'title': ' '.join(item['title'].split()),
                     'state': state, 'piece_id': piece, 'sources': list(dict.fromkeys(sources))})
    if not rows:
        return cover
    if cover is None:
        owner = db.execute("SELECT w.owner_id FROM messages m JOIN topics t ON t.id=m.topic_id "
                           "JOIN workspaces w ON w.id=t.workspace_id WHERE m.id=?", (root,)).fetchone()[0]
        cover = {'stands': None, 'waiting': [], 'payload': None, 'by': None, 'at_ms': None, 'owner': owner}
    return dict(cover, items=rows)


def has_sources(db, actor, root):
    """One indexed existence gate; unsourced dossiers need no projection walks."""
    from .stacks import MEMBERS
    return bool(db.execute(MEMBERS + " SELECT EXISTS(SELECT 1 FROM members p JOIN pipeline_item_sources s "
                           "INDEXED BY source_cover_items ON s.message_id=p.id WHERE s.message_id IS NOT NULL)",
                           {'root': root, 'actor': actor}).fetchone()[0])


def _bulk_key(actor, topic):
    return 'source_cover_bulk:' + json.dumps([actor, topic], separators=(',', ':'))


def bulk_sequence(db, actor, topic):
    row = db.execute('SELECT value FROM metadata WHERE key=?', (_bulk_key(actor, topic),)).fetchone()
    return int(row[0]) if row else 0


def read_sequence(db, actor, root):
    """Newest admitted item/access change on this dossier's visible members."""
    from .stacks import MEMBERS
    return db.execute(MEMBERS + " SELECT coalesce(max((SELECT max(seq) FROM changes INDEXED BY source_cover_changes "
                      "WHERE scope_kind='actor' AND scope_id=:actor AND resource_kind='source_cover_read' AND resource_id=p.id)),0) "
                      "FROM members p", {"actor": actor, "root": root}).fetchone()[0]


def notify(store, db, workspace, record, access_reader=None, source_messages=None):
    """Opaque source-topic invalidation, in the record's own transaction.

    Item/piece changes seek their sources; configuration seeks that outcome's
    sources. Never write a message act pretending an agent posted the state.
    """
    values = [workspace]
    clause = ''
    if isinstance(record, int):
        clause = ' AND s.number=?'
        values.append(record)
    elif isinstance(record, str) and record.startswith('p-'):
        clause = ' AND s.number IN (SELECT number FROM pipeline_piece_members WHERE piece_id=?)'
        values.append(record)
    if source_messages is not None:
        messages = list(dict.fromkeys(source_messages))
        if not messages:
            return
    bulk = record in ('configured', 'stages', 'access') or access_reader is not None
    columns = 'min(m.id) AS id,m.topic_id,m.author_id,m.private_to' if bulk else 'DISTINCT m.id,m.topic_id,m.author_id,m.private_to'
    if source_messages is not None:
        # Drive from the bounded incoming IDs. EXISTS stops at the first link,
        # even when historical duplicate source relations are numerous.
        query = ("SELECT " + columns + " FROM messages m WHERE m.id IN (" + ','.join('?' for _ in messages) + ") "
                 "AND EXISTS(SELECT 1 FROM pipeline_item_sources s INDEXED BY source_cover_items "
                 "WHERE s.message_id=m.id AND s.workspace_id=? AND s.message_id IS NOT NULL" + clause + ")")
        values = messages + values
    else:
        query = ("SELECT " + columns + " FROM pipeline_item_sources s JOIN messages m ON m.id=s.message_id "
                 "WHERE s.workspace_id=? AND s.message_id IS NOT NULL" + clause)
    if bulk:
        query += " GROUP BY m.topic_id,m.author_id,m.private_to"
    rows = db.execute(query, values).fetchall()
    # The source alone never grants destination access. Membership changes
    # explicitly refresh the affected reader once, including on revocation.
    admitted = {row[0] for row in db.execute("SELECT owner_id FROM workspaces WHERE id=? UNION "
                                           "SELECT actor_id FROM workspace_members WHERE workspace_id=?", (workspace, workspace))}
    groups = {}
    for message in rows:
        for reader in store._message_readers(db, message, message['author_id']):
            if reader != access_reader and (access_reader is not None or reader not in admitted):
                continue
            key = (reader, message['topic_id'])
            groups.setdefault(key, set()).add(message['id'])
    heard = set(groups)
    for (reader, topic), messages in groups.items():
        grouped = bulk or (source_messages is not None and len(messages) > SOURCE_KEYS_PER_READER_TOPIC)
        if not grouped:
            for message in sorted(messages):
                store._change(db, 'actor', reader, 'source_cover_read', message, 1)
        # The same existing opaque topic clock covers a large added group;
        # no destination title, ID or state reaches a source-only reader.
        store._change(db, 'actor', reader, 'source_cover', topic, 1)
        if grouped:
            sequence = db.execute('SELECT last_insert_rowid()').fetchone()[0]
            db.execute("INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                       (_bulk_key(reader, topic), str(sequence)))
    if bulk:
        # Public source messages can have different addressed-only readers.
        # Keep all of those recipients while sharing the topic/member lookup.
        addressed = db.execute("SELECT DISTINCT d.recipient_id,m.topic_id FROM pipeline_item_sources s "
                               "JOIN messages m ON m.id=s.message_id JOIN deliveries d ON d.message_id=m.id "
                               "JOIN delivery_reasons r ON r.delivery_id=d.id AND r.reason='addressed' "
                               "WHERE s.workspace_id=? AND m.private_to IS NULL", (workspace,)).fetchall()
        for reader, topic in addressed:
            if (reader, topic) in heard or (reader != access_reader and (access_reader is not None or reader not in admitted)):
                continue
            heard.add((reader, topic))
            store._change(db, 'actor', reader, 'source_cover', topic, 1)
            sequence = db.execute('SELECT last_insert_rowid()').fetchone()[0]
            db.execute("INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                       (_bulk_key(reader, topic), str(sequence)))
