from __future__ import annotations

"""Moving the hand-written Release pipeline page into Theseus (item 84;
docs/pipeline.md, "The import"): the seed built from the page, and the
operator's import of it, which writes it whole or not at all."""

import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest

from aim_next import admin
from aim_next.contract import Refusal
from reader_fixture import ReaderCase
from tools.pipeline import export_seed

PAGE = """Release pipeline

NOW: release 23
🔨 3. Third thing  (large; asked by you)
  Words about the third.
  Progress: built, in review.
⏭ 1. First thing  (small; found in review)

NEXT: the release after
❓ 2. Second thing  (medium; asked by Fable)

NEXT (later):
💤 4. Fourth thing  (small; asked by you)

CANDIDATES: Reader
💤 5. Fifth thing  (small; asked by you)

SHIPPED
Release 19, 6 Nov
✅ 6. Shipped six
- A smaller change
30 October 2026
✅ 7. Shipped seven
"""


class SeedCase(unittest.TestCase):
    def test_the_page_gives_every_item_its_section_group_words_and_what_shipped(self):
        items, notes = export_seed.parse(PAGE)
        self.assertEqual([(item["number"], item["section"], item["candidate_group"]) for item in items],
                         [(3, "now", ""), (1, "now", ""), (2, "next", ""), (4, "later", ""), (5, "candidates", "Reader"), (6, "now", ""), (7, "now", "")])
        third = items[0]
        self.assertEqual((third["title"], third["size"], third["raised_by"], third["description"], third["progress"]),
                         ("Third thing", "large", "tony", "Words about the third.", ["built, in review."]))
        self.assertEqual((items[1]["raised_by"], items[1]["raised_note"]), (None, "found in review"))
        self.assertEqual(items[2]["raised_by"], "fable")
        self.assertTrue(items[2]["ask_on_page"], "a question on the page is reported, not carried")
        self.assertEqual((items[5].get("shipped_in"), items[6].get("finished_note")), (19, "30 October 2026, before releases were numbered"))
        self.assertEqual(notes, {"19": ["A smaller change"]})

    def build(self, temp, body, listed):
        page, items, out = Path(temp) / "page.json", Path(temp) / "items.json", Path(temp) / "seed.json"
        page.write_text(json.dumps({"body": body, "source_ref": {"id": "page", "revision": 3}}))
        items.write_text(json.dumps({"items": listed}))
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr), contextlib.redirect_stdout(io.StringIO()):
            code = export_seed.main(["--page", str(page), "--items", str(items), "--out", str(out)])
        return code, stderr.getvalue(), json.loads(out.read_text()) if code == 0 else None

    def test_a_gap_in_the_numbers_or_an_item_with_no_source_is_refused(self):
        sourced = [{"title": "t%d" % n, "sources": ["Topic #%d" % n]} for n in range(1, 8)]
        with tempfile.TemporaryDirectory() as temp:
            code, _, seed = self.build(temp, PAGE, sourced)
            self.assertEqual(code, 0)
            self.assertEqual(seed["items"][0]["sources"], [{"topic": "Topic", "seq": 3}])
            self.assertEqual((seed["built_from"], seed["release_notes"]), ({"memory_item_id": "page", "revision": 3}, {"19": ["A smaller change"]}))
            code, words, _ = self.build(temp, PAGE.replace("💤 5. Fifth thing  (small; asked by you)\n", ""), sourced)
            self.assertEqual((code, words), (2, "numbers missing from the page: 5\n"))
            code, words, _ = self.build(temp, PAGE, [{"title": "t%d" % n} for n in range(1, 8)])
            self.assertEqual(code, 2)
            self.assertIn("no known source for: 3, 1, 2, 4, 5, 6, 7 (add them, or pass --allow-unsourced)", words)


class ImportCase(ReaderCase):
    """w1 takes the seed; its first message is in topic "Topic"."""

    def seed(self, **changes):
        seq = self.sql("SELECT seq FROM messages WHERE topic_id='t1' ORDER BY seq LIMIT 1")[0][0]
        items = [
            {"number": 1, "title": "One", "section": "now", "size": "small", "raised_by": "owner", "sources": [{"topic": "Topic", "seq": seq}]},
            {"number": 2, "title": "Two", "section": "next", "size": "large", "raised_by": "fable", "sources": [{"note": "a note"}],
             "progress": ["built"]},
            {"number": 3, "title": "Three", "section": "candidates", "candidate_group": "Reader", "sources": [{"note": "n"}], "ask_on_page": True},
            {"number": 4, "title": "Four", "section": "next", "sources": [{"note": "n"}]},
            {"number": 5, "title": "Shipped", "section": "now", "shipped_in": 19, "sources": [{"note": "n"}]},
        ]
        seed = {"workspace_id": "w1", "built_from": {"memory_item_id": "page", "revision": 3},
                "pipeline": {"title": "Release pipeline", "sized": True, "ships_in_releases": True},
                "stages": [{"stage_id": "build", "name": "Build", "rounds": "split"}], "items": items,
                "release_notes": {"19": ["A smaller change"]}, "unsourced": []}
        seed.update(changes)
        return seed

    def setUp(self):
        super().setUp()
        self.store.record_release({"release": 19, "commit": "4" * 40, "deployed_at": "2026-11-06T05:28:35-08:00", "items": [5], "source": "backfill"})

    def test_the_seed_lands_whole_in_order_and_a_second_run_changes_nothing(self):
        report = self.store.import_pipeline(self.seed(), "agent-a")
        self.assertEqual((report["imported"], report["items"], report["ask_again"]), (True, 5, [3]))
        self.assertEqual(report["by_section"], {"now": 1, "next": 2, "candidates": 1, "shipped": 1})
        view = lambda section: [item["number"] for item in self.store.view("owner", "pipeline", {"workspace_id": "w1", "section": section})["items"]]
        self.assertEqual((view("now"), view("next"), view("candidates")), ([1], [2, 4], [3]))
        item = self.store.view("owner", "pipeline_item", {"workspace_id": "w1", "number": 2})["item"]
        self.assertEqual((item["raised_by"], item["raised_note"]), (None, "raised by fable"), "an actor this instance lacks is kept as words")
        self.assertEqual([event["payload"].get("progress") for event in item["events"] if event["kind"] == "added"], [["built"]])
        first = self.store.view("owner", "pipeline_item", {"workspace_id": "w1", "number": 1})["item"]
        self.assertEqual(first["sources"]["shown"][0]["topic_title"], "Topic")
        self.assertEqual(self.store.view("owner", "pipeline_item", {"workspace_id": "w1", "number": 3})["item"]["glyph"], "idle",
                         "a question on the page is not carried as one")
        shipped = self.store.view("owner", "pipeline", {"workspace_id": "w1", "section": "shipped"})["groups"]
        self.assertEqual([(group["label"], [i["number"] for i in group["items"]], group["notes"]) for group in shipped],
                         [("Release 19", [5], ["A smaller change"])])
        before = self.sql("SELECT count(*) FROM pipeline_events")
        self.assertEqual(self.store.import_pipeline(self.seed(), "agent-a")["imported"], False)
        self.assertEqual(self.sql("SELECT count(*) FROM pipeline_events"), before)
        # New items follow the highest number.
        added = self.committed(self.command("pipeline.item_add", {"title": "Six", "sources": [{"note": "n"}]}, {"workspace_id": "w1"}))
        self.assertEqual(added["number"], 6)

    def refused(self, seed, code):
        with self.assertRaises(Refusal) as raised:
            self.store.import_pipeline(seed, "agent-a")
        self.assertEqual(raised.exception.code, code)
        self.assertEqual(self.sql("SELECT count(*) FROM pipelines"), [(0,)], "nothing written")
        self.assertEqual(self.sql("SELECT count(*) FROM pipeline_items"), [(0,)])

    def test_a_seed_the_page_or_the_records_contradict_is_refused_whole(self):
        seed = self.seed()
        seed["items"][0]["sources"] = [{"topic": "Another title", "seq": seed["items"][0]["sources"][0]["seq"]}]
        self.refused(seed, "SEED_SOURCE")
        seed = self.seed()
        seed["items"][4]["shipped_in"] = 18
        self.refused(seed, "SEED_DISAGREES")
        self.committed(self.command("memory.create", {"title": "Release pipeline", "body": "Words", "attachments": [], "references": []},
                                    target={"item_id": "page", "owner_scope": {"kind": "workspace", "id": "w1"}}, expected={"item_revision": 0}, actor="agent-a"))
        for revision in range(2, 5):
            self.committed(self.command("memory.revise", {"title": "Release pipeline", "body": "Words %d" % revision, "attachments": [], "references": []},
                                        target={"item_id": "page"}, expected={"item_revision": revision - 1}, actor="agent-a"))
        self.refused(self.seed(), "SEED_STALE")

    def test_an_agents_whisper_is_never_where_an_imported_item_came_from_and_a_persons_is_for_its_two_people(self):
        # The whole outcome reads the pipeline, so the import refuses an agent's whisper by its number as item_add does.
        whisper = self.committed(self.command("message.post", {"body": "Between us", "addressees": ["agent-a"], "whisper": True},
                                              {"topic_id": "t1"}))["message_id"]
        answer = self.committed(self.command("message.post", {"body": "Agreed", "addressees": ["owner"], "whisper": True, "reply_to": whisper},
                                             {"topic_id": "t1"}, actor="agent-a"))["message_id"]
        seq = lambda message: self.sql("SELECT seq FROM messages WHERE id=?", (message,))[0][0]
        seed = self.seed()
        seed["items"][0]["sources"] = [{"topic": "Topic", "seq": seq(answer)}]
        self.refused(seed, "WHISPER_STAYS_PRIVATE")
        seed = self.seed()
        seed["items"][0]["sources"] = [{"topic": "Topic", "seq": seq(whisper)}]
        self.assertEqual(self.store.import_pipeline(seed, "agent-a")["items"], 5)
    def test_the_operator_imports_through_the_admin_command(self):
        seed_path = Path(self.temp.name).resolve() / "seed.json"
        seed_path.write_text(json.dumps(self.seed()))
        profile = Path(self.temp.name).resolve() / "operator.json"
        from aim_next.profile import write_profile
        write_profile(profile, str(self.path.resolve()), "test-instance", "owner", binding=self.binding)
        out, err = io.StringIO(), io.StringIO()
        code = admin.main(["pipeline-import", "--profile", str(profile), "--seed", str(seed_path), "--as", "agent-a"], stdout=out, stderr=err)
        self.assertEqual((code, err.getvalue()), (0, ""))
        self.assertEqual(json.loads(out.getvalue())["items"], 5)
        out, err = io.StringIO(), io.StringIO()
        self.assertEqual(admin.main(["pipeline-import", "--profile", str(profile), "--seed", "seed.json", "--as", "agent-a"], stdout=out, stderr=err), 2)
        self.assertIn("pipeline-import --profile /abs/profile.json --seed /abs/seed.json --as ACTOR", err.getvalue())


if __name__ == "__main__":
    unittest.main()
