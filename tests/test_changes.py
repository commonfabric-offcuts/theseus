from __future__ import annotations

import json
import sqlite3
from unittest import mock

from aim_next import store as store_module
from aim_next.contract import LIMITS
from reader_fixture import ReaderCase
import test_agent_cli as cli_fixture


TOPIC = {"kind": "topic", "id": "t1"}


class ChangesCase(ReaderCase):
    def read(self, scope=None, cursor=None, actor="owner", **args):
        args["scope"] = TOPIC if scope is None else scope
        if cursor is not None:
            args["cursor"] = cursor
        result = self.store.view(actor, "changes", args)
        self.assertNotIn("error", result, result)
        return result

    def test_baseline_before_initial_views_catches_commit_and_is_read_only(self):
        before = self.records()
        baseline = self.read()
        self.assertEqual(self.records(), before)
        self.assertTrue(baseline["baseline"])
        self.assertEqual(baseline["items"], [])
        self.assertFalse(baseline["has_more"])
        self.assertIsNone(baseline["continuation"])
        sent = self.send("After baseline before initial views")
        initial = self.store.view("owner", "topic_messages", {"topic_id": "t1"})
        before = self.records()
        page = self.read(cursor=baseline["checkpoint"])
        self.assertEqual(self.records(), before)
        self.assertEqual(page["items"], [{"seq": self.sql("SELECT max(seq) FROM changes WHERE scope_kind='topic'")[0][0],
            "resource_kind": "topic", "resource_id": "t1", "version": sent["receipt"]["result"]["topic"]["version"]}])
        self.assertEqual(page["covered_versions"]["topic"], initial["relevant_versions"]["topic"])
        self.assertFalse(page["baseline"])

    def test_fixed_window_continuation_never_skips_a_concurrent_commit(self):
        baseline = self.read()["checkpoint"]
        for index in range(3):
            self.committed(self.memory(item="item-%s" % index))
        first = self.read(cursor=baseline, limit=1)
        self.assertTrue(first["has_more"])
        self.assertIsNone(first["checkpoint"])
        continuation = first["continuation"]
        upper = continuation["through_seq"]
        self.committed(self.memory(item="later"))
        seen = list(first["items"])
        page = self.read(cursor=continuation, limit=1)
        self.assertEqual(page, self.read(cursor=continuation, limit=1))
        while True:
            seen.extend(page["items"])
            if page["continuation"] is None:
                break
            self.assertIsNone(page["checkpoint"])
            page = self.read(cursor=page["continuation"], limit=1)
        self.assertEqual([r["resource_id"] for r in seen], ["item-0", "item-1", "item-2"])
        self.assertEqual(page["checkpoint"]["after_seq"], upper)
        self.assertEqual(page["covered_versions"]["notebook"], 3)
        final = self.read(cursor=page["checkpoint"])
        self.assertEqual([r["resource_id"] for r in final["items"]], ["later"])
        self.assertEqual(final["covered_versions"]["notebook"], 4)
        empty = self.read(cursor=final["checkpoint"])
        self.assertEqual(empty["items"], [])
        self.assertFalse(empty["has_more"])
        self.assertIsNotNone(empty["checkpoint"])

    def test_empty_scope_uses_global_head_and_unrelated_commit_is_not_expiry(self):
        scope = {"kind": "actor", "id": "outsider"}
        baseline = self.read(scope, actor="outsider")["checkpoint"]
        self.assertEqual(baseline["after_seq"], self.sql("SELECT max(seq) FROM changes")[0][0])
        self.assertGreater(baseline["after_seq"], 0)
        self.committed(self.memory())
        page = self.read(scope, baseline, actor="outsider")
        self.assertEqual(page["items"], [])
        self.assertGreater(page["checkpoint"]["after_seq"], baseline["after_seq"])
        self.assertEqual(page["covered_versions"], {})

    def test_private_writers_never_leak_keys_to_topic_or_workspace(self):
        workspace = {"kind": "workspace", "id": "w1"}
        topic = self.read(actor="agent-b")["checkpoint"]
        ws = self.read(workspace, actor="agent-b")["checkpoint"]
        own = self.read({"kind": "actor", "id": "owner"})["checkpoint"]
        self.committed(self.save_draft("secret-draft", self.opening, "t1", "Private body"))
        self.committed(self.command("note.save", {"source_ref": self.opening, "body": "Private note"},
            target={"note_id": "secret-note"}, expected={"note_revision": 0}))
        self.committed(self.prepare("secret-draft", "t1", submission="secret-submission", send_op="private-send"))
        self.assertEqual(self.read(cursor=topic, actor="agent-b")["items"], [])
        self.assertEqual(self.read(workspace, ws, actor="agent-b")["items"], [])
        private = self.read({"kind": "actor", "id": "owner"}, own)
        # Writing about a message also says so keyed by that message (item 127, docs/topic-reading.md), in the same
        # private scope only.
        self.assertEqual({r["resource_id"] for r in private["items"]}, {"secret-draft", "secret-note", "secret-submission", self.opening["id"]})
        self.assertEqual({r["resource_kind"] for r in private["items"] if r["resource_id"] == self.opening["id"]}, {"yours"})
        for row in private["items"]:
            self.assertEqual(set(row), {"seq", "resource_kind", "resource_id", "version"})
        denied = self.store.view("agent-b", "changes", {"scope": {"kind": "actor", "id": "owner"}})
        self.rejected(denied, "FORBIDDEN")

    def test_continuation_reauthorizes_after_loss_of_sole_access(self):
        self.participation("outsider", True)
        baseline = self.read(actor="outsider")["checkpoint"]
        self.committed(self.memory(item="a"))
        self.committed(self.memory(item="b"))
        first = self.read(cursor=baseline, actor="outsider", limit=1)
        self.assertIsNotNone(first["continuation"])
        self.participation("outsider", False)
        before = self.records()
        self.rejected(self.store.view("outsider", "changes", {"scope": TOPIC,
            "cursor": first["continuation"]}), "FORBIDDEN")
        self.assertEqual(self.records(), before)
        # Leaving the topic does not remove independent workspace permission.
        member = self.read(actor="agent-a")["checkpoint"]
        self.participation("agent-a", False)
        self.assertTrue(self.read(cursor=member, actor="agent-a")["items"])

    def test_cursor_binding_mismatch_refuses_and_lower_position_only_replays(self):
        cursor = self.read()["checkpoint"]
        for key, value in (("instance_id", "other"), ("authority_id", "other"),
                           ("authority_epoch", "new-epoch"), ("actor_id", "agent-a"),
                           ("scope", {"kind": "workspace", "id": "w1"}),
                           ("after_seq", cursor["after_seq"] + 100)):
            with self.subTest(field=key):
                forged = dict(cursor, **{key: value})
                self.rejected(self.store.view("owner", "changes", {"scope": TOPIC, "cursor": forged}), "RESYNC_REQUIRED")
        lower = dict(cursor, after_seq=0)
        page = self.read(cursor=lower)
        self.assertTrue(page["items"])
        # The topic's own keys and its outcome's record keys.
        expected = self.sql("SELECT seq,resource_kind,resource_id,version FROM changes WHERE scope_kind='topic' AND scope_id='t1' "
                            "OR scope_kind='outcome' AND scope_id='w1' ORDER BY seq")
        self.assertIn(("workspace", "w1"), [(row[1], row[2]) for row in expected])
        self.assertEqual([(r["seq"], r["resource_kind"], r["resource_id"], r["version"]) for r in page["items"]], expected)
        self.rejected(self.store.view("outsider", "changes", {"scope": TOPIC, "cursor": dict(lower, actor_id="outsider")}), "FORBIDDEN")

    def test_validation_and_all_scope_versions(self):
        cursor = self.read()["checkpoint"]
        for extra in ({"limit": 0}, {"limit": True}, {"limit": 101}, {"actor_id": "agent-a"},
                      {"cursor": None}, {"cursor": {}}, {"cursor": dict(cursor, after_seq=True)},
                      {"cursor": dict(cursor, v=2)}, {"cursor": dict(cursor, unknown=1)},
                      {"scope": {"kind": "global", "id": "all"}}):
            with self.subTest(args=extra):
                self.rejected(self.store.view("owner", "changes", dict({"scope": TOPIC}, **extra)), "INVALID_ARGUMENT")
        for scope in (TOPIC, {"kind": "workspace", "id": "w1"}):
            page = self.read(scope)
            self.assertEqual(set(page["covered_versions"]), {scope["kind"], "notebook"})
        self.rejected(self.store.view("owner", "changes", {"scope": {"kind": "topic", "id": "missing"}}), "FORBIDDEN")

    def test_empty_continuation_completes_and_malformed_window_refuses(self):
        baseline = self.read()["checkpoint"]
        self.committed(self.memory(item="first"))
        self.committed(self.memory(item="second"))
        cursor = self.read(cursor=baseline, limit=1)["continuation"]
        completed = self.read(cursor=dict(cursor, after_seq=cursor["through_seq"]))
        self.assertEqual(completed["items"], [])
        self.assertFalse(completed["has_more"])
        self.assertEqual(completed["checkpoint"]["after_seq"], cursor["through_seq"])
        for changed in (dict(cursor, through_seq=True), dict(cursor, through_seq=cursor["after_seq"] - 1),
                        dict(cursor, covered_versions={}), dict(cursor, covered_versions={"topic": -1, "notebook": 0})):
            with self.subTest(cursor=changed):
                self.rejected(self.store.view("owner", "changes", {"scope": TOPIC, "cursor": changed}), "INVALID_ARGUMENT")

    def measured(self, args):
        original, count, rows, statements = store_module._connect, [0], [0], []
        class Cursor:
            def __init__(self, cursor): self.cursor = cursor
            def fetchall(self):
                result = self.cursor.fetchall(); rows[0] += len(result); return result
            def fetchone(self):
                result = self.cursor.fetchone(); rows[0] += int(result is not None); return result
        class Connection:
            def __init__(self, db): self.db = db
            def __getattr__(self, name): return getattr(self.db, name)
            def execute(self, sql, values=()):
                cursor = self.db.execute(sql, values)
                if "FROM changes" in sql:
                    statements.append((sql, values))
                    return Cursor(cursor)
                return cursor
        def connect(path):
            db, facts = original(path)
            def tick(): count[0] += 1; return 0
            db.set_progress_handler(tick, 1)
            return Connection(db), facts
        with mock.patch.object(store_module, "_connect", connect):
            result = self.store.view("owner", "changes", args)
        self.assertNotIn("error", result, result)
        self.assertGreater(count[0], 0)
        plans = [self.sql("EXPLAIN QUERY PLAN " + sql, values) for sql, values in statements]
        return result, count[0], rows[0], plans

    def test_scope_range_materialization_and_VM_work_stay_bounded_at_10x_history(self):
        baseline = self.read()["checkpoint"]
        with sqlite3.connect(str(self.path)) as db:
            db.executemany("INSERT INTO changes(scope_kind,scope_id,resource_kind,resource_id,version) VALUES ('topic','t1','topic','t1',?)", [(i,) for i in range(1, 201)])
            db.executemany("INSERT INTO changes(scope_kind,scope_id,resource_kind,resource_id,version) VALUES ('actor','unrelated','draft',?,1)", [("unrelated-%s" % i,) for i in range(1000)])
        args = {"scope": TOPIC, "cursor": baseline, "limit": 2}
        small, small_vm, small_rows, plans = self.measured(args)
        with sqlite3.connect(str(self.path)) as db:
            db.executemany("INSERT INTO changes(scope_kind,scope_id,resource_kind,resource_id,version) VALUES ('actor','unrelated','draft',?,1)", [("extra-%s" % i,) for i in range(9000)])
        large, large_vm, large_rows, _ = self.measured(args)
        self.assertEqual(small["items"], large["items"])
        self.assertEqual(len(large["items"]), 2)
        self.assertLessEqual(small_rows, 4)  # global head plus limit+1 scoped rows
        self.assertLessEqual(large_rows, 4)
        self.assertLessEqual(large_vm, small_vm + 40)
        self.assertIn("scoped_changes", str(plans))
        print(json.dumps({"phase": "changes_work", "small_vm": small_vm, "large_vm": large_vm,
                          "small_rows": small_rows, "large_rows": large_rows, "plans": plans}))

    def test_byte_bound_continues_without_holes_and_never_advances_partial_checkpoint(self):
        baseline = self.read()["checkpoint"]
        wanted = ["key-%03d-" % i + "🪴" * 190 for i in range(120)]
        with sqlite3.connect(str(self.path)) as db:
            db.executemany("INSERT INTO changes(scope_kind,scope_id,resource_kind,resource_id,version) VALUES ('topic','t1','memory',?,1)", [(key,) for key in wanted])
        seen, cursor = [], baseline
        with mock.patch.dict(LIMITS, {"summary_utf8_bytes": 4096}):
            for _ in range(121):
                page = self.read(cursor=cursor, limit=100)
                self.assertLessEqual(self.json_size(page), 4096)
                self.assertTrue(page["items"])
                self.assertLess(len(page["items"]), 100)
                seen.extend(row["resource_id"] for row in page["items"])
                if not page["has_more"]:
                    self.assertIsNotNone(page["checkpoint"])
                    break
                self.assertIsNone(page["checkpoint"])
                cursor = page["continuation"]
            else:
                self.fail("Continuation failed to finish")
        self.assertEqual(seen, wanted)


class ChangesCLICase(cli_fixture.AgentCLIBase):
    def test_cli_query_then_command_then_query_without_HTTP(self):
        code, baseline, _ = self.view_cli("changes", {"scope": TOPIC})
        self.assertEqual(code, 0, baseline)
        self.assertNotIn("error", baseline, baseline)
        command = self.memory_command()
        command["target"]["owner_scope"] = TOPIC
        code, receipt, _ = self.invoke("command", command)
        self.assertEqual(code, 0, receipt)
        self.committed(receipt)
        code, page, _ = self.view_cli("changes", {"scope": TOPIC, "cursor": baseline["checkpoint"]})
        self.assertEqual(code, 0, page)
        self.assertEqual([(r["resource_kind"], r["resource_id"], r["version"]) for r in page["items"]], [("memory", "cli-item", 1)])
