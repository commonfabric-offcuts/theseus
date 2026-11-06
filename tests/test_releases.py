from __future__ import annotations

"""Release records (docs/releases.md): written once by the operator, never changed, read by every member."""

import io
import json
from pathlib import Path
import sqlite3
import unittest

from aim_next import admin, cli
from aim_next.profile import write_profile
import test_store as fixtures


A, B, C = "a" * 40, "b" * 40, "c" * 40


def record(**change):
    value = {"commit": A, "previous": B, "deployed_at": "2026-11-06T05:28:35-08:00", "items": [87, 2],
             "measurements": {"python_units": {"tests": 1106}, "node_units": {"tests": 740, "pass": 740},
                              "native": {"pass": 208, "total": 208, "steps": {}}},
             "source": "deploy", "evidence": "/evidence/r19"}
    value.update(change)
    return {key: item for key, item in value.items() if item is not ...}


class ReleaseCase(fixtures.StoreCase):
    def setUp(self):
        super().setUp()
        self.profile = Path(self.temp.name).resolve() / "owner.json"
        write_profile(self.profile, str(self.path.resolve()), "test-instance", "owner", binding=self.binding)
        self.serial = 0

    def admin(self, value):
        self.serial += 1
        path = Path(self.temp.name).resolve() / ("release-%d.json" % self.serial)
        path.write_text(value if isinstance(value, str) else json.dumps(value))
        out, err = io.StringIO(), io.StringIO()
        code = admin.main(["record-release", "--profile", str(self.profile), "--record", str(path)], stdout=out, stderr=err)
        return code, json.loads(out.getvalue()) if out.getvalue() else {"stderr": err.getvalue()}

    def recorded(self, value):
        code, answer = self.admin(value)
        self.assertEqual(code, 0, answer)
        return answer

    def refused(self, value, error):
        before = self.sql("SELECT * FROM releases ORDER BY number"), self.sql("SELECT value FROM metadata WHERE key='commit_seq'")
        code, answer = self.admin(value)
        self.assertEqual((code, answer.get("ok"), answer.get("error", {}).get("code")), (2, False, error), answer)
        self.assertEqual((self.sql("SELECT * FROM releases ORDER BY number"),
                          self.sql("SELECT value FROM metadata WHERE key='commit_seq'")), before, "a refusal writes nothing")
        return answer["error"]["message"]

    def releases(self, actor="owner", **args):
        answer = self.store.view(actor, "releases", args)
        self.assertNotIn("error", answer, answer)
        return answer

    def test_the_first_record_names_its_number_and_each_later_one_follows_the_latest(self):
        self.assertIn("names its number", self.refused(record(), "RELEASE_NUMBER_REQUIRED"))
        first = self.recorded(record(release=19))
        self.assertEqual((first["recorded"], first["release"]["release"], first["release"]["items"]), (True, 19, [87, 2]))
        self.assertEqual(first["release"]["deployed_ms"], 1793971715000)
        later = self.recorded(record(commit=C, previous=A, items=[88]))
        self.assertEqual((later["recorded"], later["release"]["release"], later["release"]["previous"]), (True, 20, A))
        # A release recorded afterwards may sit below the latest, under a number nobody holds.
        older = self.recorded(record(release=18, commit=B, previous=None, items=[1, 4], measurements=None, source="backfill"))
        self.assertEqual((older["release"]["release"], older["release"]["measurements"]), (18, None))
        self.assertEqual(self.sql("SELECT number,commit_sha FROM releases ORDER BY number"), [(18, B), (19, A), (20, C)])

    def test_the_same_record_again_is_the_one_already_written(self):
        first = self.recorded(record(release=19))
        seq = self.sql("SELECT value FROM metadata WHERE key='commit_seq'")
        again = self.recorded(record(release=19))
        self.assertEqual((again["recorded"], again["release"]), (False, first["release"]))
        # A deploy's retry without a number is the same record too, not release 20.
        self.assertEqual(self.recorded(record())["release"], first["release"])
        self.assertEqual(self.sql("SELECT count(*) FROM releases"), [(1,)])
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='commit_seq'"), seq, "nothing was committed again")

    def test_a_different_record_for_a_recorded_commit_or_number_is_refused(self):
        self.recorded(record(release=19))
        for change in ({"items": [87]}, {"deployed_at": "2026-11-06T05:28:36-08:00"}, {"previous": None},
                       {"measurements": None}, {"source": "backfill"}, {"evidence": None}, {"release": 20}):
            with self.subTest(change):
                self.assertIn("never changes", self.refused(record(**change), "RELEASE_EXISTS"))
        self.assertIn("another commit", self.refused(record(release=19, commit=C), "RELEASE_EXISTS"))

    def test_a_record_never_changes_in_the_store(self):
        self.recorded(record(release=19))
        for statement in ("UPDATE releases SET items='[1]'", "DELETE FROM releases"):
            with self.subTest(statement), self.assertRaises(sqlite3.IntegrityError):
                self.sql(statement)
        self.assertEqual(self.sql("SELECT number,items FROM releases"), [(19, "[87,2]")])

    def test_a_malformed_record_is_refused_with_what_is_wrong(self):
        cases = ({"commit": "485759b"}, {"commit": A.upper()}, {"previous": "71e504d"}, {"items": "87, 2"},
                 {"items": [87, 87]}, {"items": [0]}, {"items": [True]}, {"items": [2.0]}, {"items": list(range(1, 502))},
                 {"deployed_at": "2026-11-06T05:28:35"}, {"deployed_at": "Fri Nov 6"}, {"deployed_at": 1793971715000},
                 {"measurements": [1]}, {"measurements": {"x": "y" * 20000}}, {"source": "hand"}, {"evidence": ""},
                 {"release": 0}, {"release": "19"}, {"commit": ...}, {"items": ...}, {"extra": 1})
        for change in cases:
            with self.subTest(change):
                self.refused(record(**dict({"release": 19}, **change)), "INVALID_ARGUMENT")
        self.assertIn("No readable release record", self.refused("{not json", "INVALID_ARGUMENT"))
        self.refused("[]", "INVALID_ARGUMENT")
        self.assertEqual(self.sql("SELECT count(*) FROM releases"), [(0,)])

    def test_every_member_reads_the_records_newest_first_a_page_at_a_time(self):
        self.assertEqual(self.releases(), {"instance_id": "test-instance", "items": [], "next_cursor": None})
        for number, commit in ((18, B), (19, A), (20, C)):
            self.recorded(record(release=number, commit=commit))
        first = self.releases("agent-a", limit=2)
        self.assertEqual([item["release"] for item in first["items"]], [20, 19])
        self.assertEqual(first["next_cursor"], 19)
        rest = self.releases("agent-b", limit=2, cursor=19)
        self.assertEqual(([item["release"] for item in rest["items"]], rest["next_cursor"]), ([18], None))
        item = first["items"][1]
        self.assertEqual(set(item), {"release", "commit", "previous", "deployed_at", "deployed_ms", "items", "measurements",
                                     "source", "evidence", "recorded_ms"})
        self.assertEqual(item["measurements"]["native"], {"pass": 208, "total": 208, "steps": {}})
        for args in ({"cursor": "19"}, {"limit": 0}, {"actor": "owner"}):
            with self.subTest(args):
                self.assertEqual(self.store.view("owner", "releases", args)["error"]["code"], "INVALID_ARGUMENT")
        self.assertEqual(self.store.view("missing", "releases", {})["error"]["code"], "INVALID_ACTOR")

    def test_the_cli_prints_each_release_on_one_line(self):
        self.recorded(record(release=18, commit=B, previous=None, items=[1, 4], measurements=None, source="backfill"))
        self.recorded(record(release=19, items=[]))
        text, err = io.StringIO(), io.StringIO()
        self.assertEqual(cli.main(["--profile", str(self.profile), "releases"], stdout=text, stderr=err), 0, err.getvalue())
        self.assertEqual(text.getvalue().splitlines(), [
            "release 19  aaaaaaa  2026-11-06T05:28:35-08:00  shipped no pipeline item  (python 1106, node 740, native 208/208)",
            "release 18  bbbbbbb  2026-11-06T05:28:35-08:00  shipped 1, 4  [recorded retroactively]"])
        text = io.StringIO()
        self.assertEqual(cli.main(["--profile", str(self.profile), "--json", "releases", "--limit", "1"], stdout=text, stderr=err), 0)
        pages = [json.loads(line) for line in text.getvalue().splitlines()]
        self.assertEqual([[item["release"] for item in page["items"]] for page in pages], [[19]])


# Do not rerun the inherited StoreCase tests.
for _name in list(fixtures.StoreCase.__dict__):
    if _name.startswith("test_"):
        setattr(ReleaseCase, _name, None)


if __name__ == "__main__":
    unittest.main()
