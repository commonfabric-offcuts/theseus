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
        self.committed(self.thumb(answer, actor="agent-a"))
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
