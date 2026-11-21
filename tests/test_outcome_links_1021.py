from __future__ import annotations

import unittest
from unittest.mock import patch

from aim_next import Store
from aim_next.contract import LIMITS, _json
from aim_next.migrations import MigrationError, STEPS, migrate
from aim_next.store import StoreOpenError
from aim_next.workspace_links import LINK_SCHEMA
import test_store as fixtures


class OutcomeLinksCase(unittest.TestCase):
    setUp = fixtures.StoreCase.setUp
    command = fixtures.StoreCase.command
    sql = fixtures.StoreCase.sql
    workspace = fixtures.StoreCase.workspace

    def saved(self, url="https://example.test/work", title="Working page", removed=False,
              revision=0, actor="owner", workspace="w1", op=None):
        return self.command("workspace.link_set", {"url": url, "title": title, "removed": removed},
                            {"workspace_id": workspace}, {"link_revision": revision}, actor=actor, op=op)

    def read(self, actor="owner", workspace="w1", **args):
        return self.store.view(actor, "workspace_links", dict(args, workspace_id=workspace))

    def test_scope_is_outcome_team_and_never_topic_only_or_coordinator_only(self):
        self.workspace()
        self.assertEqual(self.saved(actor="agent-b")["status"], "committed")
        # Isolated access fixtures retain a topic grant but remove outcome access.
        self.sql("INSERT INTO topics(id,workspace_id,title,creator_id,version) VALUES ('topic-only','w1','Only topic','agent-b',1)")
        self.sql("INSERT INTO topic_participants(topic_id,actor_id,active,epoch) VALUES ('topic-only','agent-b',1,1)")
        self.sql("DELETE FROM workspace_members WHERE workspace_id='w1' AND actor_id IN ('agent-a','agent-b')")
        self.assertEqual(self.read("agent-a")["error"]["code"], "FORBIDDEN", "coordinator alone does not grant reading")
        self.assertEqual(self.read("agent-b")["error"]["code"], "FORBIDDEN", "topic participation is narrower")
        for actor in ("agent-a", "agent-b"):
            self.assertEqual(self.saved(revision=1, actor=actor)["error"]["code"], "FORBIDDEN")
        self.assertEqual(self.sql("SELECT revision FROM workspace_links"), [(1,)])

    def test_current_row_revision_prevents_overwrite_and_replay_preserves_old_receipt(self):
        self.workspace()
        first = self.saved(op="first")
        second = self.saved(title="New title", revision=1)
        self.assertEqual(second["result"]["link"]["revision"], 2)
        self.assertEqual(self.saved(op="first"), first)
        refused = self.saved(title="Stale title", revision=1)
        self.assertEqual(refused["error"]["code"], "REVISION_CONFLICT")
        self.assertEqual(self.read()["items"][0]["title"], "New title")
        self.assertFalse(self.saved(title="New title", revision=2)["result"]["changed"])
        self.assertEqual(self.read()["items"][0]["revision"], 2)

    def test_removed_preview_override_is_shared_retained_and_can_be_restored(self):
        self.workspace()
        self.assertEqual(self.saved(removed=True)["status"], "committed")
        self.assertTrue(self.read("agent-a")["items"][0]["removed"])
        self.assertEqual(self.saved(revision=1)["status"], "committed")
        self.assertFalse(self.read("agent-b")["items"][0]["removed"])

    def test_authority_missing_revision_and_closed_outcome_keep_records(self):
        self.workspace()
        self.saved()
        args = {"url": "https://example.test/work", "title": "Late", "removed": True}
        missing = self.command("workspace.link_set", args, {"workspace_id": "w1"})
        self.assertEqual(missing["error"]["code"], "INVALID_ARGUMENT")
        envelope = {"v": 1, "instance_id": "test-instance", "operation_id": "old-authority",
                    "kind": "workspace.link_set", "target": {"workspace_id": "w1"}, "args": args,
                    "expected": {"link_revision": 1, "authority": dict(self.pin, authority_epoch="retired")}}
        self.assertEqual(self.store.command("owner", envelope)["error"]["code"], "AUTHORITY_CHANGED")
        current = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        ended = self.command("outcome.end_set", {"state": "archived"}, {"workspace_id": "w1"}, {"workspace_revision": current})
        self.assertEqual(ended["status"], "committed", ended)
        self.assertFalse(self.read()["reader_may_write"])
        self.assertEqual(self.saved(title="Late", revision=1)["status"], "rejected")
        self.assertEqual(self.read()["items"][0]["title"], "Working page")

    def test_canonical_url_validation_bounds_and_no_partial_rows(self):
        self.workspace()
        first = self.saved(url="HTTPS://Example.TEST:443", title="  Home  ")
        self.assertEqual(first["result"]["link"]["url"], "https://example.test/")
        self.assertEqual(first["result"]["link"]["title"], "Home")
        invalid = ["javascript:alert(1)", "file:///tmp/x", "https://user:secret@example.test/", "https://",
                   "https://example.test/x\ny", "https://example.test/x y", "https://example.test/\\x", "http://example.test:bad"]
        for url in invalid:
            with self.subTest(url=url):
                self.assertEqual(self.saved(url=url)["error"]["code"], "INVALID_ARGUMENT")
        self.assertEqual(self.saved(title="界" * 500)["error"]["code"], "INVALID_ARGUMENT")
        self.assertEqual(len(self.read()["items"]), 1)
        self.assertEqual(self.store.view("owner", "capabilities", {})["limits"]["workspace_links"], LIMITS["workspace_links"])

    def test_scoped_pages_byte_budget_and_limit_include_tombstones(self):
        self.workspace()
        for n in range(6):
            self.assertEqual(self.saved(url="https://example.test/%d" % n, title="界" * 200, removed=n == 0)["status"], "committed")
        seen, cursor = [], None
        with patch.dict(LIMITS, summary_utf8_bytes=1900):
            for _ in range(8):
                page = self.read(limit=3, **({"cursor": cursor} if cursor is not None else {}))
                self.assertLessEqual(len(_json(page).encode("utf-8")), 1900)
                seen.extend(row["url"] for row in page["items"])
                cursor = page["next_cursor"]
                if cursor is None:
                    break
        self.assertEqual(len(set(seen)), 6)
        with patch.dict(LIMITS, workspace_links=6):
            self.assertEqual(self.saved(url="https://example.test/seventh")["error"]["code"], "TOO_MANY_LINKS")
        for args in ({"actor": "agent-b"}, {"limit": 0}, {"cursor": True}):
            self.assertEqual(self.store.view("owner", "workspace_links", dict(args, workspace_id="w1"))["error"]["code"], "INVALID_ARGUMENT")

    def test_migration_roundtrip_is_explicit_and_occupied_downgrade_keeps_rows(self):
        self.workspace()
        step = next(step for step in STEPS if step[2] is LINK_SCHEMA)
        self.assertEqual(step[:2], ("65", "66"))
        self.assertTrue(migrate(self.path, "test-instance", self.binding, target="65")["migrated"])
        with self.assertRaises(StoreOpenError):
            Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='schema_version'"), [("65",)])
        self.assertTrue(migrate(self.path, "test-instance", self.binding, target="66")["migrated"])
        self.assertEqual(self.saved(removed=True)["status"], "committed")
        before = self.sql("SELECT * FROM workspace_links"), self.sql("SELECT * FROM metadata ORDER BY key")
        with self.assertRaises(MigrationError) as refused:
            migrate(self.path, "test-instance", self.binding, target="65")
        self.assertEqual(refused.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual((self.sql("SELECT * FROM workspace_links"), self.sql("SELECT * FROM metadata ORDER BY key")), before)

    def test_an_added_link_is_core_kept_shared_and_replayed_once(self):
        self.workspace()
        first = self.command("workspace.link_set", {
            "url": "https://example.test/work", "title": "Working page", "removed": False,
        }, {"workspace_id": "w1"}, {"link_revision": 0}, op="one-shared-link")
        self.assertEqual(first["status"], "committed", first)
        reopened = Store(self.path, "test-instance", expected_binding=self.binding)
        answer = reopened.view("agent-b", "workspace_links", {"workspace_id": "w1", "limit": 20})
        self.assertNotIn("error", answer, answer)
        self.assertEqual([(row["url"], row["title"], row["revision"], row["removed"])
                          for row in answer["items"]],
                         [("https://example.test/work", "Working page", 1, False)])
        self.assertTrue(answer["reader_may_write"])
        self.assertEqual(self.command("workspace.link_set", {
            "url": "https://example.test/work", "title": "Working page", "removed": False,
        }, {"workspace_id": "w1"}, {"link_revision": 0}, op="one-shared-link"), first)
        self.assertEqual(self.sql("SELECT count(*) FROM workspace_links WHERE workspace_id='w1'"), [(1,)])


if __name__ == "__main__":
    unittest.main()
