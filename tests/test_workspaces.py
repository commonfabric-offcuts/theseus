from __future__ import annotations

import io
import json
import sqlite3
import unittest

from aim_next import cli
from aim_next.contract import LIMITS, _json
from aim_next.profile import write_profile
import test_store as fixtures


class WorkspacesCase(fixtures.StoreCase):
    def create_workspace(self, ident, actor="owner", team=(), title="Same title"):
        receipt = self.command("workspace.create", {"id": ident, "title": title,
                               "team": list(team)}, actor=actor)
        self.assertEqual(receipt["status"], "committed", receipt)

    def listing(self, actor="owner", **args):
        answer = self.store.view(actor, "workspaces", args)
        self.assertNotIn("error", answer, answer)
        self.assertEqual(set(answer), {"instance_id", "items", "next_cursor"})
        self.assertEqual(answer["instance_id"], "test-instance")
        return answer

    def records(self):
        with sqlite3.connect(str(self.path)) as db:
            return tuple(db.iterdump())

    def test_membership_scopes_titles_and_reads_are_read_only(self):
        self.create_workspace("w-b", team=("agent-a",))
        self.create_workspace("w-d", actor="agent-a", team=("owner",))
        self.create_workspace("w-a", actor="agent-b", title="Private workspace")
        # Topic participation is deliberately narrower than workspace access.
        source = {"kind": "new_topic", "id": "opening", "workspace_id": "w-a"}
        for kind, args, target, expected, op in [
            ("draft.save", {"source_ref": source, "topic_id": "t-private", "generation": "g1",
                            "body": "An isolated opening", "opening": {"workspace_id": "w-a",
                            "title": "One topic only", "participants": ["owner"]}},
             {"draft_id": "d1"}, {"draft_revision": 0}, "save"),
            ("submission.prepare", {"draft_id": "d1", "submission_id": "s1", "send_operation_id": "send"},
             {"topic_id": "t-private"}, {"draft_revision": 1}, "prepare"),
            ("topic.create_and_send", {"submission_id": "s1"}, {"topic_id": "t-private"}, {}, "send"),
        ]:
            self.assertEqual(self.command(kind, args, target, expected, actor="agent-b", op=op)["status"], "committed")
        self.assertIn("topic", self.store.view("owner", "topic", {"topic_id": "t-private"}))
        before = self.records()
        expected = [
            {"id": "w-b", "owner_id": "owner", "title": "Same title", "title_truncated": False, "version": 1, "unread": 0, "addressed": 0},
            {"id": "w-d", "owner_id": "agent-a", "title": "Same title", "title_truncated": False, "version": 1, "unread": 0, "addressed": 0},
        ]
        self.assertEqual(self.listing()["items"], expected)
        self.assertEqual(self.listing("agent-a")["items"], expected)
        private = self.listing("agent-b")
        self.assertEqual([item["id"] for item in private["items"]], ["w-a"])
        self.assertIsNone(private["next_cursor"])
        self.assertEqual(self.listing()["items"], expected)
        self.assertEqual(self.records(), before)

    def test_exclusive_paging_current_membership_and_empty_results(self):
        self.assertEqual(self.listing()["items"], [])
        self.assertIsNone(self.listing()["next_cursor"])
        for ident in ("w-a", "w-c", "w-e"):
            self.create_workspace(ident, actor="agent-a", team=("owner",))
        self.create_workspace("w-b", actor="agent-b")
        first = self.listing(limit=1)
        self.assertEqual([item["id"] for item in first["items"]], ["w-a"])
        self.assertEqual(first["next_cursor"], "w-a")
        second = self.listing(cursor=first["next_cursor"], limit=1)
        self.assertEqual([item["id"] for item in second["items"]], ["w-c"])
        self.assertEqual(second["next_cursor"], "w-c")
        last = self.listing(cursor=second["next_cursor"], limit=1)
        self.assertEqual([item["id"] for item in last["items"]], ["w-e"])
        self.assertIsNone(last["next_cursor"])
        self.assertEqual(self.listing(cursor="w-z")["items"], [])
        self.assertEqual([item["id"] for item in self.listing(cursor="w-b")["items"]], ["w-c", "w-e"])
        self.sql("DELETE FROM workspace_members WHERE workspace_id=? AND actor_id=?", ("w-c", "owner"))
        changed = self.listing(cursor=first["next_cursor"], limit=1)
        self.assertEqual([item["id"] for item in changed["items"]], ["w-e"])
        self.assertIsNone(changed["next_cursor"])

    def test_invalid_arguments_and_disabled_actor(self):
        self.create_workspace("w1")
        invalid = [{"actor": "agent-a"}, {"owner": "agent-a"}, {"workspace_id": "w1"}]
        invalid += [{"cursor": value} for value in (None, 0, True, [], "bad\n", "x" * 201)]
        invalid += [{"limit": value} for value in (None, 0, True, -1, 1.0, "1", LIMITS["page_max"] + 1)]
        before = self.records()
        for args in invalid:
            with self.subTest(args=args):
                answer = self.store.view("owner", "workspaces", args)
                self.assertEqual(answer.get("error", {}).get("code"), "INVALID_ARGUMENT", answer)
        self.assertEqual(self.records(), before)
        self.sql("UPDATE actors SET enabled=0 WHERE id='agent-a'")
        for actor in ("agent-a", "missing"):
            answer = self.store.view(actor, "workspaces", {})
            self.assertEqual(answer.get("error", {}).get("code"), "INVALID_ACTOR", answer)

    def test_default_maximum_page_and_existing_topic_cursor(self):
        for number in range(LIMITS["page_default"] + 1):
            self.create_workspace("w-%03d" % number)
        first = self.listing()
        self.assertEqual(len(first["items"]), LIMITS["page_default"])
        self.assertEqual(first["next_cursor"], first["items"][-1]["id"])
        self.assertEqual(len(self.listing(limit=LIMITS["page_max"], cursor="")["items"]), LIMITS["page_default"] + 1)
        current = self.store.view("owner", "workspace_topics", {"workspace_id": "w-000", "cursor": "", "limit": 1})
        self.assertEqual(current["items"], [])
        self.assertIsNone(current["next_cursor"])

    def test_title_previews_and_byte_limited_pages_preserve_every_id(self):
        long_title = "a" * 1023 + "🙂" + "界" * 340000
        self.create_workspace("w-000", title=long_title)
        self.create_workspace("w-001", title="界" * 341 + "a")  # Exactly 1024 UTF-8 bytes.
        self.create_workspace("w-002", title="small\x00title")
        for number in range(3, 31):
            self.create_workspace("w-%03d" % number, title="\x00" * 1024 + "suffix")
        expected_ids = ["w-%03d" % number for number in range(31)]
        cursor, seen, pages = "", [], []
        for _ in range(32):
            page = self.listing(cursor=cursor, limit=100)
            self.assertLessEqual(len(_json(page).encode("utf-8")), LIMITS["summary_utf8_bytes"])
            self.assertTrue(page["items"], "No empty continuation pages")
            pages.append(page)
            for item in page["items"]:
                self.assertLessEqual(len(item["title"].encode("utf-8")), 1024)
                self.assertNotIn(item["id"], seen)
                seen.append(item["id"])
            if page["next_cursor"] is None:
                break
            self.assertEqual(page["next_cursor"], page["items"][-1]["id"])
            cursor = page["next_cursor"]
        self.assertEqual(seen, expected_ids)
        self.assertGreater(len(pages), 1, "Actual response-byte budget must shorten a page")
        by_id = {item["id"]: item for page in pages for item in page["items"]}
        self.assertEqual(by_id["w-000"]["title"], "a" * 1023)
        self.assertTrue(by_id["w-000"]["title_truncated"])
        self.assertEqual(by_id["w-001"]["title"], "界" * 341 + "a")
        self.assertFalse(by_id["w-001"]["title_truncated"])
        self.assertEqual(by_id["w-002"]["title"], "small\x00title")
        self.assertFalse(by_id["w-002"]["title_truncated"])
        self.assertEqual(by_id["w-003"]["title"], "\x00" * 1024)
        self.assertTrue(by_id["w-003"]["title_truncated"])
        self.assertEqual(self.store.view("owner", "workspace", {"workspace_id": "w-000"})["workspace"]["title"], long_title)

    def test_cli_uses_its_bound_actor_for_workspaces(self):
        self.create_workspace("w-public", team=("agent-a",))
        self.create_workspace("w-private", actor="agent-b")
        profile = self.path.parent / "agent-a.json"
        write_profile(profile, self.path, "test-instance", "agent-a", binding=self.binding)
        binding = dict(self.pin, instance_id="test-instance", actor_id="agent-a", db_path=str(self.path.resolve()))
        request = {"v": 1, "binding": binding, "view": {"name": "workspaces", "args": {}}}
        stdout, stderr = io.StringIO(), io.StringIO()
        before = self.records()
        code = cli.main(["--profile", str(profile), "view", "-"],
                        stdin=io.BytesIO(_json(request).encode("utf-8")), stdout=stdout, stderr=stderr)
        answer = json.loads(stdout.getvalue())
        self.assertEqual(code, 0, answer)
        self.assertEqual([item["id"] for item in answer["items"]], ["w-public"])
        self.assertEqual(stderr.getvalue(), "")
        self.assertEqual(self.records(), before)


# Do not rerun the inherited StoreCase tests during module discovery.
for _name in list(fixtures.StoreCase.__dict__):
    if _name.startswith("test_") and _name not in WorkspacesCase.__dict__:
        setattr(WorkspacesCase, _name, None)


if __name__ == "__main__":
    unittest.main()
