from __future__ import annotations

"""Actual scoped Core views, with isolated records and fixed JSON byte comparisons."""
import copy
import json
import unittest
from unittest import mock

from aim_next.contract import LIMITS, _json
from test_dossier_covers import CoverCase
import test_http as http_fixture

FORMAT = "root-table-v1"


def expanded(answer):
    result = copy.deepcopy(answer)
    positions = result.pop("positions")
    assert result.pop("position_format") == FORMAT
    for row in result["items"]:
        root = row.pop("stack_position_ref")
        row["stack_position"] = copy.deepcopy(positions[root])
        acts = row.get("acts", {})
        if "cover_ref" in acts:
            assert acts.pop("cover_ref") == root == row["id"]
            acts["cover"] = copy.deepcopy(positions[root]["cover"])
    return result


class PositionFormatCase(CoverCase):
    def read(self, name, args, actor="owner"):
        answer = self.store.view(actor, name, args)
        self.assertNotIn("error", answer, answer)
        return answer

    def paired(self, name, args, actor="owner"):
        # The first agent read can record exposure and advance commit_seq.
        # Stabilize that real effect before comparing the complete envelopes.
        self.read(name, args, actor)
        legacy = self.read(name, args, actor)
        compact = self.read(name, dict(args, position_format=FORMAT), actor)
        self.assertEqual(expanded(compact), legacy)
        self.assertNotIn("positions", legacy)
        self.assertTrue(all("stack_position" in row and "stack_position_ref" not in row for row in legacy["items"]))
        return legacy, compact

    def write_cover(self, root, stands):
        before = self.read("stack_positions", {"topic_id": "t1", "message_ids": [root]})["items"][0]["stack_position"]
        return self.committed(self.cover(root, {"stands": stands}, revision=before["cover_revision"]))

    def test_capability_is_exact_and_legacy_remains_default(self):
        cap = self.read("capabilities", {})
        self.assertEqual(cap["read_formats"]["dossier_positions"], [FORMAT])
        root = self.post("A scoped root")
        for name, args in [("topic_messages", {"topic_id": "t1", "message_ids": [root]}),
                           ("stack_positions", {"topic_id": "t1", "message_ids": [root]})]:
            self.paired(name, args)

    def test_repeated_root_sends_one_full_cover_and_measures_actual_view_bytes(self):
        root = self.post("A fixed root")
        replies = [self.post("Reply %d" % n, reply_to=root) for n in range(6)]
        stands = "Fixed UTF8 cover: " + "é" * 3000
        self.write_cover(root, stands)
        for name in ("topic_messages", "stack_positions"):
            legacy, compact = self.paired(name, {"topic_id": "t1", "message_ids": [root] + replies})
            old, new = _json(legacy).encode("utf-8"), _json(compact).encode("utf-8")
            self.assertEqual(set(compact["positions"]), {root})
            self.assertEqual(len(compact["items"]), 7)
            self.assertEqual(new.count(stands.encode("utf-8")), 1)
            self.assertGreater(old.count(stands.encode("utf-8")), 1)
            self.assertLess(len(new), len(old) // 2)
            print("METRIC1271 " + json.dumps({"view": name, "messages": 7, "roots": 1, "legacy_utf8": len(old), "compact_utf8": len(new)}))

    def test_reply_only_read_has_its_authoritative_root_and_cover(self):
        root = self.post("Root not selected")
        reply = self.post("The only selected row", reply_to=root)
        self.write_cover(root, "Current cover outside the message window")
        for name in ("topic_messages", "stack_positions"):
            legacy, compact = self.paired(name, {"topic_id": "t1", "message_ids": [reply]})
            print("METRIC1271 " + json.dumps({"view": name, "scenario": "root-not-loaded", "messages": 1, "roots": 1, "legacy_utf8": len(_json(legacy).encode("utf-8")), "compact_utf8": len(_json(compact).encode("utf-8"))}))
            self.assertEqual(list(compact["positions"]), [root])
            self.assertEqual(compact["items"][0]["stack_position_ref"], root)

    def test_items_only_cover_keeps_real_current_linked_rows_in_both_views_and_reply_only_reads(self):
        root = self.post("A report with linked work and no manual cover")
        reply = self.post("A reply whose root can be outside the read", reply_to=root)
        self.committed(self.command("pipeline.configure", {"enabled": True},
                                   target={"workspace_id": "w1"}, expected={"pipeline_revision": 0}))
        numbers = []
        for title, source in (("First linked improvement", root),
                              ("Second linked improvement", reply),
                              ("Third linked improvement", root)):
            result = self.committed(self.command("pipeline.item_add", {
                "title": title, "section": "now", "sources": [{"message_id": source}]},
                target={"workspace_id": "w1"}))
            numbers.append(result["number"])
        self.assertEqual(self.sql("SELECT count(*) FROM message_acts WHERE kind='cover'"), [(0,)])
        self.assertEqual(self.sql("SELECT number,message_id FROM pipeline_item_sources ORDER BY number"),
                         list(zip(numbers, (root, reply, root))))
        for phase in ("filed", "edited"):
            if phase == "edited":
                self.committed(self.command("pipeline.item_edit", {"title": "Current first improvement"},
                                           target={"workspace_id": "w1", "number": numbers[0]},
                                           expected={"item_revision": 1}))
            actual = self.read("dossier_cover", {"message_id": reply})["cover"]
            self.assertIsNone(actual["stands"])
            self.assertIsNone(actual["payload"])
            self.assertIsNone(actual["by"])
            self.assertEqual([row["number"] for row in actual["items"]], numbers)
            self.assertEqual([row["sources"] for row in actual["items"]], [[root], [reply], [root]])
            self.assertEqual(actual["items"][0]["title"],
                             "Current first improvement" if phase == "edited" else "First linked improvement")
            for name in ("topic_messages", "stack_positions"):
                for selected in ([root, reply], [reply]):
                    with self.subTest(phase=phase, view=name, reply_only=selected == [reply]):
                        legacy, compact = self.paired(name, {"topic_id": "t1", "message_ids": selected})
                        self.assertEqual(set(compact["positions"]), {root})
                        self.assertEqual(compact["positions"][root]["cover"], actual)
                        self.assertEqual(len(compact["items"]), len(selected))
                        self.assertTrue(all(row["stack_position_ref"] == root for row in compact["items"]))
                        self.assertTrue(all(row["stack_position"]["cover"] == actual for row in legacy["items"]))
                        print("ITEMS1271 " + json.dumps({"phase": phase, "view": name,
                              "reply_only": selected == [reply], "legacy": legacy, "compact": compact}))

    def test_mixed_root_views_measure_lossless_utf8_bytes(self):
        roots = [self.post("Root %d" % n) for n in range(3)]
        replies = [self.post("Reply", reply_to=root) for root in roots]
        for root in roots:
            self.write_cover(root, "Mixed UTF8 cover " + "界" * 500)
        for name in ("topic_messages", "stack_positions"):
            legacy, compact = self.paired(name, {"topic_id": "t1", "message_ids": roots + replies})
            self.assertEqual(set(compact["positions"]), set(roots))
            old, new = len(_json(legacy).encode("utf-8")), len(_json(compact).encode("utf-8"))
            self.assertLess(new, old)
            print("METRIC1271 " + json.dumps({"view": name, "scenario": "mixed-root", "messages": 6, "roots": 3, "legacy_utf8": old, "compact_utf8": new}))

    def test_distinct_roots_and_joined_historical_acts_are_lossless(self):
        first, second = self.post("First"), self.post("Second")
        self.write_cover(first, "First cover")
        self.write_cover(second, "Second cover retained as this message's own act")
        self.committed(self.command("stack.join", {"into": first}, target={"message_id": second}, expected={"join_revision": 0}))
        _, compact = self.paired("topic_messages", {"topic_id": "t1", "message_ids": [first, second]})
        rows = {row["id"]: row for row in compact["items"]}
        self.assertEqual(rows[first]["acts"]["cover_ref"], first)
        self.assertEqual(rows[second]["acts"]["cover"]["root_id"], second)
        self.assertNotIn("cover_ref", rows[second]["acts"])
        self.assertEqual(set(compact["positions"]), {first})

    def test_join_split_and_cover_revisions_use_each_new_read(self):
        first, second = self.post("First"), self.post("Second")
        reply = self.post("Reply", reply_to=second)
        self.write_cover(first, "First cover")
        self.write_cover(second, "Second cover")
        args = {"topic_id": "t1", "message_ids": [reply]}
        _, before = self.paired("stack_positions", args)
        self.assertEqual(before["items"][0]["stack_position_ref"], second)
        self.committed(self.command("stack.join", {"into": first}, target={"message_id": second}, expected={"join_revision": 0}))
        _, joined = self.paired("stack_positions", args)
        self.assertEqual(joined["items"][0]["stack_position_ref"], first)
        self.committed(self.command("stack.join", {"into": None}, target={"message_id": second}, expected={"join_revision": 1}))
        self.write_cover(second, "A later cover revision")
        _, split = self.paired("stack_positions", args)
        self.assertEqual(split["items"][0]["stack_position_ref"], second)
        self.assertEqual(split["positions"][second]["cover"]["stands"], "A later cover revision")
        self.assertEqual(before["positions"][second]["cover"]["stands"], "Second cover")

    def test_personal_and_shared_revision_fences_are_preserved(self):
        root = self.post("Root")
        self.committed(self.command("message.star", {"starred": True}, target={"message_id": root}, expected={"star_revision": 0}))
        self.committed(self.command("stack.name", {"name": "Current dossier"}, target={"message_id": root}, expected={"name_revision": 0}))
        for actor in ("owner", "agent-a"):
            self.paired("topic_messages", {"topic_id": "t1", "message_ids": [root]}, actor)
            _, wire = self.paired("stack_positions", {"topic_id": "t1", "message_ids": [root]}, actor)
            self.assertEqual(wire["positions"][root]["name"]["text"], "Current dossier")
            self.assertEqual(bool(wire["positions"][root]["starred"]), actor == "owner")

    def test_cleared_cover_and_empty_page_are_complete_projections(self):
        root = self.post("Root")
        self.write_cover(root, "Old words")
        self.write_cover(root, None)
        for name in ("topic_messages", "stack_positions"):
            self.paired(name, {"topic_id": "t1", "message_ids": [root]})
        _, empty = self.paired("topic_messages", {"topic_id": "t1", "cursor": 9223372036854775807})
        self.assertEqual(empty["items"], [])
        self.assertEqual(empty["positions"], {})

    def test_private_roots_and_refusals_do_not_leak_through_table_keys(self):
        public = self.post("Public root")
        secret = self.post("Private root", whisper=True, addressees=["agent-a"])
        self.write_cover(secret, "Secret cover words")
        _, wire = self.paired("topic_messages", {"topic_id": "t1"}, "agent-b")
        self.assertNotIn(secret, _json(wire))
        self.assertNotIn("Secret cover words", _json(wire))
        self.assertIn(public, wire["positions"])
        args = {"topic_id": "t1", "message_ids": [secret]}
        for name in ("topic_messages", "stack_positions"):
            old = self.store.view("agent-b", name, args)
            new = self.store.view("agent-b", name, dict(args, position_format=FORMAT))
            self.assertIn("error", old)
            self.assertEqual(new, old)

    def test_compact_read_keeps_actual_agent_exposure_identities(self):
        # Use two real readers and both first-reader orders. Exposure records
        # are deliberately immutable; the fixture never deletes or rewrites them.
        for first_actor, first_format in (("agent-a", None), ("agent-b", FORMAT)):
            root = self.post("Human words which the agent receives")
            reply = self.post("More human words", reply_to=root)
            args = {"topic_id": "t1", "message_ids": [root, reply]}
            first = args if first_format is None else dict(args, position_format=FORMAT)
            self.read("topic_messages", first, first_actor)
            other = "agent-b" if first_actor == "agent-a" else "agent-a"
            second = dict(args, position_format=FORMAT) if first_format is None else args
            self.read("topic_messages", second, other)
            records = self.sql("SELECT actor_id,message_id,revision FROM message_exposures WHERE message_id IN (?,?) ORDER BY actor_id,message_id", (root, reply))
            by_actor = {actor: [(message, revision) for who, message, revision in records if who == actor] for actor in ("agent-a", "agent-b")}
            self.assertEqual(by_actor["agent-a"], by_actor["agent-b"])
            self.assertEqual({message for message, _ in by_actor["agent-a"]}, {root, reply})
            self.assertEqual(self.sql("SELECT message_id,by FROM message_first_exposures WHERE message_id IN (?,?) ORDER BY message_id", (root, reply)), [(message, first_actor) for message in sorted((root, reply))])

    def test_compact_overhead_falls_back_without_changing_the_bounded_window(self):
        root = self.post("A short single row")
        args = {"topic_id": "t1", "message_ids": [root]}
        legacy = self.read("topic_messages", args)
        bound = len(_json(legacy).encode("utf-8"))
        with mock.patch.dict(LIMITS, {"summary_utf8_bytes": bound}):
            unchanged = self.read("topic_messages", args)
            wire = self.read("topic_messages", dict(args, position_format=FORMAT))
        self.assertEqual(wire, unchanged)
        self.assertNotIn("position_format", wire)
        self.assertLessEqual(len(_json(wire).encode("utf-8")), bound)

    def test_only_the_explicit_supported_format_is_admitted(self):
        root = self.post("Root")
        for name in ("topic_messages", "stack_positions"):
            for value in (None, True, 1, [], {}, "root-table-v2"):
                answer = self.store.view("owner", name, {"topic_id": "t1", "message_ids": [root], "position_format": value})
                self.assertEqual(answer["error"]["code"], "INVALID_ARGUMENT")
        self.assertEqual(self.store.view("owner", "topic", {"topic_id": "t1", "position_format": FORMAT})["error"]["code"], "INVALID_ARGUMENT")


class HTTPPositionFormatCase(unittest.TestCase):
    setUp = http_fixture.HTTPContractTests.setUp
    tearDown = http_fixture.HTTPContractTests.tearDown
    request = http_fixture.HTTPContractTests.request

    def test_bootstrap_forwards_backend_formats_and_old_backend_omits_them(self):
        original = self.store.view
        def view(actor, name, args):
            answer = original(actor, name, args)
            if name == "capabilities":
                answer["read_formats"] = {"dossier_positions": [FORMAT]}
            return answer
        self.store.view = view
        status, _, raw = self.request("/api/bootstrap", method="GET")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)["read_formats"], {"dossier_positions": [FORMAT]})
        self.store.view = original
        status, _, raw = self.request("/api/bootstrap", method="GET")
        self.assertEqual(status, 200)
        self.assertNotIn("read_formats", json.loads(raw))
