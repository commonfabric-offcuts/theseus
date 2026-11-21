from __future__ import annotations

import unittest
import io
import json
import sqlite3
import subprocess
import sys
import tarfile
from pathlib import Path
from unittest import mock
import test_store as fixtures
from aim_next.colors import AGENT_COLORS
from aim_next.migrations import migrate, MigrationError
from aim_next.store import Store, StoreOpenError


class OutcomeColorsCase(fixtures.StoreCase):
    def setUp(self):
        super().setUp()
        self.workspace()

    def choose(self, color, revision=0, actor="owner", workspace="w1", op=None):
        return self.command("outcome.color_set", {"color": color}, {"workspace_id": workspace},
                            {"color_revision": revision}, actor=actor, op=op)

    def committed(self, receipt):
        self.assertEqual(receipt.get("status"), "committed", receipt)
        return receipt["result"]

    def projected(self, color, revision, actor="owner", workspace="w1"):
        detail = self.store.view(actor, "workspace", {"workspace_id": workspace})
        listing = self.store.view(actor, "workspaces", {"limit": 1, "cursor": "" if workspace == "w1" else "w1"})
        counts = self.store.view(actor, "workspace_counts", {"workspace_ids": [workspace]})
        for row in (detail["workspace"], listing["items"][0], counts["items"][0]):
            self.assertEqual((row.get("color", "missing"), row.get("color_revision")), (color, revision))
        self.assertEqual(detail["color_palette"], list(AGENT_COLORS))
        self.assertEqual(listing["color_palette"], list(AGENT_COLORS))

    def test_choice_is_personal_in_each_authorized_projection(self):
        self.projected(None, 0)
        before = self.sql("SELECT * FROM workspaces")
        self.committed(self.command("workspace.create", {"id": "w2", "title": "Second", "team": ["agent-b"]}))
        wakes = {table: self.sql("SELECT * FROM " + table) for table in ("wake_attempts", "recipient_schedule")}
        self.assertEqual(self.committed(self.choose("indigo")),
                         {"workspace_id": "w1", "color": "indigo", "color_revision": 1, "changed": True})
        self.committed(self.choose("rose", actor="agent-b"))
        self.projected("indigo", 1)
        self.projected("rose", 1, "agent-b")
        self.projected(None, 0, "agent-a")
        self.projected(None, 0, workspace="w2")
        self.assertEqual(self.sql("SELECT * FROM workspaces WHERE id='w1'"), before)
        self.assertEqual(self.sql("SELECT scope_kind,scope_id,resource_id,version FROM changes WHERE resource_kind='outcome_color' ORDER BY seq"),
                         [("actor", "owner", "w1", 1), ("actor", "agent-b", "w1", 1)])
        self.assertEqual(self.sql("SELECT count(*) FROM messages"), [(0,)])
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries"), [(0,)])
        self.assertEqual({table: self.sql("SELECT * FROM " + table) for table in wakes}, wakes)

    def test_reset_noop_stale_write_and_exact_retry(self):
        original = self.choose("blue", op="original")
        self.committed(original)
        self.assertEqual(self.committed(self.choose("blue", 1))["changed"], False)
        self.assertEqual(self.committed(self.choose(None, 1))["color_revision"], 2)
        self.assertEqual(self.choose("blue", op="original"), original)
        stale = self.choose("cyan", 0)
        self.assertEqual(stale['status'], 'rejected', stale)
        self.assertEqual(stale["error"]["code"], "REVISION_CONFLICT")
        self.assertEqual(self.choose("cyan", 1)["error"]["current_versions"], {"color_revision": 2})
        self.projected(None, 2)
        self.assertEqual(self.sql("SELECT actor_id,workspace_id,color,revision FROM outcome_color_choices"), [("owner", "w1", None, 2)])
        self.assertEqual(self.committed(self.choose("olive", 2))["color_revision"], 3)

    def test_access_and_command_shape(self):
        self.committed(self.command("workspace.create", {"id": "private", "title": "Private"}))
        self.assertEqual(self.choose("blue", actor="agent-b", workspace="private")["error"]["code"], "FORBIDDEN")
        for color in ("orchid", "#00ff00", "", 3, True, [], {}):
            self.assertEqual(self.choose(color)["error"]["code"], "INVALID_ARGUMENT", color)
        for target, args, expected in (({"workspace_id": "w1", "actor_id": "agent-b"}, {"color": "blue"}, {"color_revision": 0}),
                                       ({"workspace_id": "w1"}, {}, {"color_revision": 0}),
                                       ({"workspace_id": "w1"}, {"color": "blue", "extra": 1}, {"color_revision": 0}),
                                       ({"workspace_id": "w1"}, {"color": "blue"}, {})):
            self.assertEqual(self.command("outcome.color_set", args, target, expected)["error"]["code"], "INVALID_ARGUMENT")
        self.projected(None, 0)

    def test_page_and_named_refresh_only_read_returned_personal_choices(self):
        self.committed(self.command("workspace.create", {"id": "w2", "title": "Second"}))
        self.committed(self.choose("green"))
        with mock.patch.object(self.store, "_outcome_color", wraps=self.store._outcome_color) as choices:
            first = self.store.view("owner", "workspaces", {"limit": 1})
            self.assertEqual(first["next_cursor"], "w1")
            self.assertEqual([call.args[2] for call in choices.call_args_list], ["w1"])
        with mock.patch.object(self.store, "_outcome_color", wraps=self.store._outcome_color) as choices:
            second = self.store.view("owner", "workspaces", {"limit": 1, "cursor": first["next_cursor"]})
            self.assertEqual(second["next_cursor"], None)
            self.assertEqual([call.args[2] for call in choices.call_args_list], ["w2"])
        with mock.patch.object(self.store, "_view_workspaces", side_effect=AssertionError("global list read")), \
                mock.patch.object(self.store, "_outcome_color", wraps=self.store._outcome_color) as choices:
            self.store.view("owner", "workspace_counts", {"workspace_ids": ["w1"]})
            self.assertEqual([call.args[2] for call in choices.call_args_list], ["w1"])

    def test_personal_choice_survives_archive_and_cannot_change_after_access_removed(self):
        self.committed(self.choose("green", actor="agent-b"))
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("workspace.member_set", {"actor_id": "agent-b", "present": False},
                                    {"workspace_id": "w1"}, {"workspace_revision": version}))
        self.assertEqual(self.choose("rose", 1, actor="agent-b")["error"]["code"], "FORBIDDEN")
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("outcome.end_set", {"state": "archived"}, {"workspace_id": "w1"}, {"workspace_revision": version}))
        self.committed(self.choose("blue"))
        self.assertEqual(self.store.view("owner", "workspaces", {"ended": True})["items"][0]["color"], "blue")

    def test_migration_round_trip_preserves_shared_records_and_reset_rows_prevent_downgrade(self):
        before = self.sql("SELECT * FROM workspaces")
        fresh = self.sql("SELECT name,sql FROM sqlite_master WHERE name='outcome_color_choices'")
        self.assertEqual(migrate(self.path, "test-instance", self.binding, "59")["schema_version"], "59")
        self.assertEqual(self.sql("SELECT name FROM sqlite_master WHERE name='outcome_color_choices'"), [])
        self.assertEqual(migrate(self.path, "test-instance", self.binding, "60")["schema_version"], "60")
        self.assertEqual(self.sql("SELECT * FROM workspaces"), before)
        self.assertEqual(self.sql("SELECT name,sql FROM sqlite_master WHERE name='outcome_color_choices'"), fresh)
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        for color, revision in (("blue", 0), (None, 1)):
            self.committed(self.choose(color, revision))
            rows = self.sql("SELECT * FROM outcome_color_choices")
            with self.assertRaises(MigrationError) as caught:
                migrate(self.path, "test-instance", self.binding, "59")
            self.assertEqual(caught.exception.code, "RECORDS_WOULD_BE_LOST")
            self.assertEqual(self.sql("SELECT * FROM outcome_color_choices"), rows)
            self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='schema_version'"), [("60",)])

    def test_actual_release242_records_upgrade_without_any_read_migration(self):
        # Seed with the archived release's own code, not a downgrade of our
        # current initializer: this independently exercises the real 59 layout.
        base = '47d47bd44a84b6109786fa30159ddfccc5a8a238'
        root = Path(self.temp.name) / 'release242'; root.mkdir()
        archive = subprocess.check_output(['git', 'archive', base, 'aim_next'], cwd=Path(__file__).resolve().parents[1])
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            self.assertTrue(all(not Path(p.name).is_absolute() and '..' not in Path(p.name).parts and (p.isfile() or p.isdir()) for p in tar))
            tar.extractall(root)
        program = '''
import json, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from aim_next import initialize, Store
from aim_next.store import SCHEMA_VERSION
root = Path(sys.argv[2]).resolve()
r = initialize(root / 'old.sqlite3', 'old957', [{'id':'owner','kind':'human'}], authority_path=root / 'control' / 'authority.json')
b = r['binding']; s = Store(root / 'old.sqlite3', 'old957', expected_binding=b)
e = {'v':1, 'instance_id':'old957', 'operation_id':'create957', 'kind':'workspace.create', 'target':{}, 'expected':{'authority':{k:b[k] for k in ['authority_id','authority_epoch']}}, 'args':{'id':'old','title':'Existing outcome'}}
assert s.command('owner', e)['status'] == 'committed'
print(json.dumps({'binding':b,'schema':SCHEMA_VERSION}))
'''
        result = subprocess.check_output([sys.executable, '-I', '-B', '-c', program, str(root), str(root)], text=True)
        facts = json.loads(result); self.assertEqual(facts['schema'], '59')
        path, binding = root / 'old.sqlite3', facts['binding']
        def records():
            with sqlite3.connect(str(path)) as db:
                tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('metadata','outcome_color_choices')")]
                return {name: db.execute('SELECT * FROM "' + name + '" ORDER BY rowid').fetchall() for name in tables}
        before, unchanged = records(), path.read_bytes()
        with self.assertRaises(StoreOpenError) as caught: Store(path, 'old957', expected_binding=binding)
        self.assertEqual(caught.exception.code, 'SCHEMA_MISMATCH'); self.assertEqual(path.read_bytes(), unchanged)
        self.assertEqual(migrate(path, 'old957', binding)['schema_version'], '60')
        self.assertEqual(records(), before)
        store = Store(path, 'old957', expected_binding=binding)
        projection = store.view('owner', 'workspace', {'workspace_id':'old'})['workspace']
        self.assertEqual((projection['color'], projection['color_revision']), (None, 0))


for _name in fixtures.StoreCase.__dict__:
    if _name.startswith("test_"):
        setattr(OutcomeColorsCase, _name, None)

if __name__ == "__main__":
    unittest.main()
