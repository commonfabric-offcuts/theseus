from __future__ import annotations

"""Personal dossier positions (731). Reads never create records. See docs/dossier-order.md."""

from .whispers import VISIBLE

ORDER_SCHEMA = [
    "CREATE TABLE dossier_order (actor_id TEXT NOT NULL REFERENCES actors(id), topic_id TEXT NOT NULL REFERENCES topics(id), "
    "root_id TEXT NOT NULL REFERENCES messages(id), key REAL NOT NULL, entry_key REAL NOT NULL, tie INTEGER NOT NULL, "
    "PRIMARY KEY(actor_id,topic_id,root_id))",
    "CREATE INDEX dossier_order_keys ON dossier_order(actor_id,topic_id,key)",
]
ORDER_DOWN = ("DROP TABLE dossier_order",)
ORDER_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM dossier_order)"


def rank(db, actor, topic, root):
    row = db.execute("SELECT key,entry_key,tie FROM dossier_order WHERE actor_id=? AND topic_id=? AND root_id=?", (actor, topic, root)).fetchone()
    if row is not None:
        return row
    # A reader newly admitted to old history has no old ordering to preserve.
    seq = db.execute("SELECT seq FROM messages WHERE id=?", (root,)).fetchone()[0]
    return {"key": seq, "entry_key": seq, "tie": seq}


def put(db, actor, topic, root, key, tie, entry=False):
    old = rank(db, actor, topic, root)
    db.execute("INSERT INTO dossier_order VALUES (?,?,?,?,?,?) ON CONFLICT(actor_id,topic_id,root_id) "
               "DO UPDATE SET key=excluded.key,entry_key=excluded.entry_key,tie=excluded.tie",
               (actor, topic, root, key, key if entry else old['entry_key'], tie))


def edge(db, actor, topic, top):
    # Includes dormant source roots: they can only widen the range, never move a live dossier.
    row = db.execute("SELECT key FROM dossier_order WHERE actor_id=? AND topic_id=? ORDER BY key " +
                     ("DESC" if top else "ASC") + " LIMIT 1", (actor, topic)).fetchone()
    if top:
        seq = db.execute("SELECT coalesce(max(seq),0) FROM messages WHERE topic_id=?", (topic,)).fetchone()[0]
        return max(row[0] if row else 0, seq) + 1
    return min(row[0] if row else 0, 0) - 1



def returning(db, actor, topic, root, key=None):
    old = rank(db, actor, topic, root)
    put(db, actor, topic, root, edge(db, actor, topic, False) if key is None else key, old['tie'], entry=True)


def published(db, readers, message):
    """Only this publication's roots/readers are touched, inside its publication transaction."""
    from .stacks import StackRoots, current_acts, EMPTY, MEMBERS
    topic, seq = message['topic_id'], message['seq']
    for actor in readers:
        root = StackRoots(db, actor).root(message['id'])
        if root == message['id']:
            put(db, actor, topic, root, edge(db, actor, topic, True), seq, entry=True)
            continue
        acts = current_acts(db, actor, [root]).get(root, EMPTY)
        through = acts['aside']
        if through is None or message['author_id'] == actor or seq <= through:
            continue
        # The first other-visible reply after the boundary brings it back once.
        previous = db.execute(MEMBERS + " SELECT max(m.seq) FROM members p JOIN messages m ON m.id=p.id "
                              "WHERE m.author_id<>:actor AND m.seq<:seq", {'root': root, 'actor': actor, 'seq': seq}).fetchone()[0]
        if previous is None or previous <= through:
            returning(db, actor, topic, root)


def placed(db, actor, message, value):
    from .stacks import StackRoots, current_acts, EMPTY, _reader_places
    topic = message['topic_id']
    roots = StackRoots(db, actor)
    root = roots.root(message['id'])
    acts = current_acts(db, actor, [root]).get(root, EMPTY)
    key = acts['placed']
    if key is None:
        key = next((row['placed'] for row in _reader_places(db, actor, topic) if roots.root(row['message_id']) == root), None)
    old = rank(db, actor, topic, root)
    put(db, actor, topic, root, old['entry_key'] if key is None else key, old['tie'])


def freeze(db):
    """Explicit migration only: preserve each existing reader's effective old order, including legacy places.

    The operator migration visits topics individually. Foreground reads/publications never reconstruct history.
    """
    from .stacks import StackRoots, current_acts, EMPTY, _reader_places
    for (topic,) in db.execute("SELECT id FROM topics").fetchall():
        readers = db.execute("SELECT owner_id FROM workspaces WHERE id=(SELECT workspace_id FROM topics WHERE id=?1) "
                             "UNION SELECT creator_id FROM topics WHERE id=?1 "
                             "UNION SELECT actor_id FROM workspace_members WHERE workspace_id=(SELECT workspace_id FROM topics WHERE id=?1) "
                             "UNION SELECT actor_id FROM topic_participants WHERE topic_id=?1 "
                             "UNION SELECT author_id FROM messages WHERE topic_id=?1 "
                             "UNION SELECT d.recipient_id FROM messages m JOIN deliveries d ON d.message_id=m.id WHERE m.topic_id=?1", (topic,)).fetchall()
        for (actor,) in readers:
            roots, groups = StackRoots(db, actor), {}
            for item in db.execute("SELECT m.id,m.seq,m.author_id FROM messages m WHERE m.topic_id=:topic AND " + VISIBLE,
                                   {'topic': topic, 'actor': actor}):
                root = roots.root(item['id'])
                if item['id'] == root or item['author_id'] != actor or current_acts(db, actor, [item['id']]).get(item['id'], EMPTY)['joined'] is not None:
                    groups[root] = max(groups.get(root, 0), item['seq'])
                else:
                    groups.setdefault(root, db.execute("SELECT seq FROM messages WHERE id=?", (root,)).fetchone()[0])
            legacy = {}
            for row in _reader_places(db, actor, topic):
                legacy.setdefault(roots.root(row['message_id']), row['placed'])
            for root, lifted in groups.items():
                acts = current_acts(db, actor, [root]).get(root, EMPTY)
                key = acts['placed'] if acts['placed'] is not None else legacy.get(root, lifted)
                put(db, actor, topic, root, key, lifted, entry=True)
