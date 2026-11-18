from __future__ import annotations

import json
from test_dossier_covers import CoverCase


class PromiseCase(CoverCase):
    def promise(self, message, **extra):
        return dict(id="cabin", text="I will book the cabin.", message_id=message, source_revision=1,
                    due={"at_ms": 1795024800000, "time_zone": "America/Los_Angeles"}, state="promised", **extra)

    def seed(self):
        root, answer, note = self.dossier()
        source = self.post("I will book the cabin.", actor="agent-a", reply_to=root)
        self.committed(self.cover(root, {"stands": "Road clear", "payload": self.payload(answer),
            "waiting": [{"text": "Which cabin?", "default": "the lakeside one"}]}))
        return root, answer, source

    def test_explicit_time_source_history_and_duplicate_are_kept_without_changing_done(self):
        root, answer, source = self.seed()
        promise = self.promise(source)
        saved = self.committed(self.cover(root, {"promises": [promise]}, revision=1))
        held = saved["cover"]["promises"][0]
        self.assertEqual((held["text"], held["by"], held["source_revision"], held["history"]), (promise["text"], "agent-a", 1, []))
        self.assertEqual(held["due"]["label"], "2026-11-18 10:00 -08:00 · America/Los_Angeles")
        self.assertEqual(held["state"], "promised")
        self.assertIsNone(saved["cover"]["payload"]["done"])
        again = self.committed(self.cover(root, {"promises": [promise]}, revision=2))
        self.assertEqual((again["changed"], again["cover_revision"]), (False, 2))
        moved = dict(promise, due={"at_ms": 1795111200000, "time_zone": "Pacific/Auckland"}, state="missed")
        self.committed(self.cover(root, {"promises": [moved]}, revision=2))
        current = self.shown(root)
        self.assertEqual(current["promises"][0]["history"], [held])
        self.assertEqual((current["stands"], len(current["waiting"]), current["payload"]["done"]), ("Road clear", 1, None))
        kept = dict(moved, state="kept")
        self.committed(self.cover(root, {"promises": [kept]}, revision=3))
        self.assertEqual([h["state"] for h in self.shown(root)["promises"][0]["history"]], ["promised", "missed"])
        self.assertIsNone(self.shown(root)["payload"]["done"], "kept is never owner acceptance")
        self.committed(self.thumb(answer, actor="agent-b"))
        self.assertIsNone(self.shown(root)["payload"]["done"])
        self.committed(self.thumb(answer))
        self.assertEqual(self.shown(root)["payload"]["done"]["how"], "thumb")
        self.assertEqual(self.shown(root)["promises"], self.shown(root, "agent-b")["promises"])

    def test_missing_time_is_explicit_and_not_extracted_from_words_and_empty_cover_is_none(self):
        root = self.post("I will book the cabin. Friday at ten.", actor="agent-a")
        p = dict(self.promise(root), due=None)
        self.committed(self.cover(root, {"promises": [p]}))
        self.assertIsNone(self.shown(root)["promises"][0]["due"])
        self.assertIsNone(self.shown(root)["payload"])
        self.committed(self.cover(root, {"promises": []}, revision=1))
        self.assertIsNone(self.shown(root))

    def test_refused_stale_private_foreign_and_invented_sources_change_nothing(self):
        root, _, source = self.seed()
        p = self.promise(source)
        private = self.post("I will book the cabin.", actor="owner", whisper=True, addressees=["agent-a"], reply_to=root)
        foreign = self.post("I will book the cabin.", actor="agent-a")
        for bad in (dict(p, message_id=private), dict(p, message_id=foreign), dict(p, source_revision=99),
                    dict(p, text="Invented words"), dict(p, state="done"), dict(p, history=[]),
                    dict(p, due={"at_ms": True, "time_zone": "UTC"}),
                    dict(p, due={"at_ms": 1, "time_zone": "Nowhere/MadeUp"})):
            before = self.rows()
            receipt = self.cover(root, {"promises": [bad]}, revision=1)
            self.assertEqual(receipt["status"], "rejected", receipt)
            self.assertEqual(self.rows(), before)
        self.rejected(self.cover(root, {"promises": [p]}, revision=1, actor="outsider"), "FORBIDDEN")
        self.committed(self.cover(root, {"promises": [p]}, revision=1))
        self.rejected(self.cover(root, {"promises": [dict(p, due=None)]}, revision=1), "REVISION_CONFLICT")
        self.assertEqual(self.shown(root)["promises"][0]["due"]["at_ms"], p["due"]["at_ms"])

    def test_cli_writes_explicit_json_and_reads_history(self):
        root, _, source = self.seed()
        code, out, err = self.run_cli("cover", root, "--promises", json.dumps([self.promise(source)]))
        self.assertEqual((code, err), (0, ""))
        self.assertIn("I will book the cabin.", out)
        self.assertIn("America/Los_Angeles", out)


    def test_operation_retry_is_exact_durable_and_source_edit_never_rewrites_history(self):
        root, _, source = self.seed()
        promise = self.promise(source)
        args = {"promises": [promise]}
        def write(op, args=args, revision=1):
            return self.command("stack.cover", args, target={"message_id": root},
                                expected={"cover_revision": revision}, actor="agent-a", op=op)
        first = write("promise-record")
        self.committed(first)
        rows = self.rows()
        self.assertEqual(write("promise-record"), first)
        self.assertEqual(self.rows(), rows)
        self.rejected(write("promise-record", {"promises": []}), "OPERATION_PAYLOAD_MISMATCH")
        held = self.shown(root)
        self.committed(self.command("message.edit", {"body": "The cabin is booked."}, target={"message_id": source},
                                    expected={"message_revision": 1}, actor="agent-a"))
        self.assertEqual(self.shown(root), held, "source edits do not rewrite an attributed promise")
        moved = dict(promise, text="The cabin is booked.", source_revision=2, due=None, state="kept")
        self.committed(write("promise-moved", {"promises": [moved]}, 2))
        from aim_next import Store
        reopened = Store(self.path, "test-instance", expected_binding=self.binding)
        found = reopened.view("agent-b", "dossier_cover", {"message_id": source})["cover"]["promises"][0]
        self.assertEqual((found["text"], found["source_revision"], found["source_author"]), (moved["text"], 2, "agent-a"))
        self.assertEqual(found["history"], [held["promises"][0]])
        # A newer cover takes the old promise with it even if only replies are paged in.
        page = reopened.view("owner", "topic_messages", {"topic_id": "t1", "direction": "before", "limit": 1})
        self.assertEqual(page["items"][0]["stack_position"]["cover"]["promises"][0], found)

    def test_exact_spaces_dst_clock_and_bad_shapes_are_not_normalized_or_invented(self):
        source = self.post("I will  book\nthe cabin.", actor="agent-a")
        promise = dict(self.promise(source), text="I will  book\nthe cabin.", due={"at_ms": 1793521800000, "time_zone": "America/Los_Angeles"})
        self.committed(self.cover(source, {"promises": [promise]}))
        old = self.shown(source)["promises"][0]
        self.assertEqual(old["text"], promise["text"])
        # The fall-back hour has two absolute instants; preserve their different offsets.
        later = dict(promise, due={"at_ms": promise["due"]["at_ms"] + 3600000, "time_zone": "America/Los_Angeles"})
        self.committed(self.cover(source, {"promises": [later]}, revision=1))
        now = self.shown(source)["promises"][0]
        self.assertNotEqual(now["due"]["offset_seconds"], old["due"]["offset_seconds"])
        self.assertEqual(now["history"], [old])
        for bad in ([promise, promise], [dict(promise, id=str(i)) for i in range(9)],
                    [dict(promise, text="I will book the cabin.")], [dict(promise, source_revision=True)],
                    [dict(promise, due={"at_ms": 10**40, "time_zone": "UTC"})], [dict(promise, state=None)]):
            rows = self.rows()
            self.rejected(self.cover(source, {"promises": bad}, revision=2), "INVALID_ARGUMENT")
            self.assertEqual(self.rows(), rows)

    def test_private_dossier_history_never_reaches_another_actor_and_closed_outcome_refuses_edits(self):
        root = self.post("I will book the cabin.", whisper=True, addressees=["agent-a"])
        p = self.promise(root)
        self.committed(self.cover(root, {"promises": [p]}))
        self.committed(self.cover(root, {"promises": [dict(p, due=None)]}, revision=1))
        self.assertEqual(self.shown(root, "agent-b"), "absent")
        self.rejected(self.cover(root, {"promises": [p]}, revision=2, actor="agent-b"), "FORBIDDEN")
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("outcome.end_set", {"state": "archived"}, target={"workspace_id": "w1"},
                                    expected={"workspace_revision": version}))
        rows = self.rows()
        self.rejected(self.cover(root, {"promises": [p]}, revision=2), "OUTCOME_ARCHIVED")
        self.assertEqual(self.rows(), rows)
