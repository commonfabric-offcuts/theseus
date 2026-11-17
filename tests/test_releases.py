from __future__ import annotations

"""Release records (docs/releases.md): written once by the operator, never changed, read by every member."""

import io
import json
from pathlib import Path
import sqlite3
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout

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

    def test_the_record_file_is_named_by_an_absolute_path(self):
        written = Path(self.temp.name).resolve() / "release.json"
        written.write_text(json.dumps(record(release=19)))
        out, err = io.StringIO(), io.StringIO()
        relative = Path("..") / written.relative_to(written.parents[1])
        code = admin.main(["record-release", "--profile", str(self.profile), "--record", str(relative)], stdout=out, stderr=err)
        self.assertEqual((code, out.getvalue()), (2, ""))
        self.assertIn("record-release --profile /abs/profile.json --record /abs/release.json", err.getvalue())
        self.assertEqual(self.sql("SELECT count(*) FROM releases"), [(0,)])

    def test_an_item_ships_in_one_release_only(self):
        self.recorded(record(release=19))
        message = self.refused(record(commit=C, previous=A, items=[88, 2]), "ITEM_SHIPPED")
        self.assertIn("2 shipped in release 19", message)
        self.assertEqual(self.recorded(record(commit=C, previous=A, items=[88]))["release"]["release"], 20)

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
            self.recorded(record(release=number, commit=commit, items=[number]))
        first = self.releases("agent-a", limit=2)
        self.assertEqual([item["release"] for item in first["items"]], [20, 19])
        self.assertEqual(first["next_cursor"], 19)
        rest = self.releases("agent-b", limit=2, cursor=19)
        self.assertEqual(([item["release"] for item in rest["items"]], rest["next_cursor"]), ([18], None))
        item = first["items"][1]
        self.assertEqual(set(item), {"release", "commit", "previous", "deployed_at", "deployed_ms", "items", "measurements",
                                     "source", "evidence", "recorded_ms", "hosted_judgment"})
        self.assertIsNone(item["hosted_judgment"], "no judgment is attached to a release check's record")
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


ROOT = Path(__file__).resolve().parents[1]
BACKFILL = ROOT / "tools" / "pipeline" / "releases"


def trained(kind="ordinary", judgment="pending"):
    """The measurements of a release deployed from a merged train (tools/releases.py train_measurements)."""
    return {"train": {"file": "/t/train.json", "pr": 31, "kind": kind, "merge_commit": A, "merged_tree": B,
                      "release_branch": "release/live73", "items": [{"item": 481, "approved_head": C, "review": "m-r"}],
                      "hosted_run": None, "judgment": judgment}}


def tree_judged(judgment="pending", commit=A):
    """Item 588: the measurements of a release deployed on the run of another commit with its tree (tools/releases.py
    measurements with judged): that run's counts, and the commits and the tree, the deployed commit's judgment pending."""
    return dict(record()["measurements"], release_check={"commit": C, "started_at": None, "finished_at": None},
                judged_tree={"judged_commit": C, "commit": commit, "tree": B, "judgment": judgment})


def judgment(head=A, conclusion="success", audit="m-audit"):
    found = lambda kind, number: {"id": number, "name": "Checks", "head_sha": head, "status": "completed",
                                  "conclusion": conclusion, "kind": kind}
    return {"head": head, "producer_runs": [found("run", 301)], "verdict_checks": [found("check", 401)], "audit": audit}


class HostedJudgment(ReleaseCase):
    """Items 481, 482: an ordinary merged train's release takes its hosted judgment once it lands, beside its record,
    which never changes; through the admin verb and through tools/releases.py attach-judgment, which reads GitHub."""

    def setUp(self):
        super().setUp()
        self.recorded(record(release=20, items=[481], measurements=trained()))
        self.before = self.only()

    def only(self):
        [item] = self.releases()["items"]
        return item

    def attach(self, value, number=20):
        self.serial += 1
        path = Path(self.temp.name).resolve() / ("judgment-%d.json" % self.serial)
        path.write_text(json.dumps(value))
        out, err = io.StringIO(), io.StringIO()
        code = admin.main(["attach-judgment", "--profile", str(self.profile), "--release", str(number), "--judgment", str(path)],
                          stdout=out, stderr=err)
        return code, json.loads(out.getvalue()) if out.getvalue() else {"stderr": err.getvalue()}

    def refused_attach(self, value, error, number=20):
        before = self.sql("SELECT * FROM release_judgments"), self.sql("SELECT value FROM metadata WHERE key='commit_seq'")
        code, answer = self.attach(value, number)
        self.assertEqual((code, answer.get("error", {}).get("code")), (2, error), answer)
        self.assertEqual((self.sql("SELECT * FROM release_judgments"), self.sql("SELECT value FROM metadata WHERE key='commit_seq'")),
                         before, "a refusal writes nothing")
        return answer["error"]["message"]

    def test_a_pending_release_takes_its_judgment_once_and_nothing_else_in_its_record_changes(self):
        self.assertIsNone(self.before["hosted_judgment"])
        code, answer = self.attach(judgment(conclusion="failure"))
        self.assertEqual((code, answer["attached"]), (0, True), answer)
        after = self.only()
        self.assertEqual(after["hosted_judgment"], judgment(conclusion="failure"), "each conclusion is kept as it is")
        self.assertEqual({k: v for k, v in after.items() if k != "hosted_judgment"},
                         {k: v for k, v in self.before.items() if k != "hosted_judgment"})
        self.assertEqual(after["measurements"]["train"]["judgment"], "pending", "the record stays as it was written")
        code, again = self.attach(judgment(conclusion="failure"))
        self.assertEqual((code, again["attached"]), (0, False), "the same judgment again is the one attached")
        self.assertIn("never changes", self.refused_attach(judgment(), "RELEASE_JUDGED"))
        for statement in ("UPDATE release_judgments SET judgment='{}'", "DELETE FROM release_judgments"):
            with self.subTest(statement), self.assertRaises(sqlite3.IntegrityError):
                self.sql(statement)

    def test_a_judgment_of_another_commit_is_refused(self):
        self.refused_attach(judgment(head=C), "JUDGMENT_OF_ANOTHER_COMMIT")
        mixed = judgment()
        mixed["verdict_checks"][0]["head_sha"] = C
        self.assertIn("names %r as its head, not the release's commit %s" % (C, A), self.refused_attach(mixed, "JUDGMENT_OF_ANOTHER_COMMIT"))
        self.assertIsNone(self.only()["hosted_judgment"])

    def test_only_a_release_whose_record_says_its_judgment_is_pending_takes_one(self):
        self.recorded(record(commit=C, previous=A, items=[482]))
        self.recorded(record(commit=B, previous=C, items=[483], measurements=trained(kind="judged-first", judgment=judgment())))
        for number in (21, 22):
            with self.subTest(number):
                self.refused_attach(judgment(), "JUDGMENT_NOT_PENDING", number)
        self.refused_attach(judgment(), "RELEASE_UNKNOWN", 23)
        for value in ({}, dict(judgment(), audit=""), dict(judgment(), producer_runs=[]), dict(judgment(), extra=1)):
            with self.subTest(value):
                self.refused_attach(value, "INVALID_ARGUMENT")


class HostedJudgmentOfAJudgedTree(HostedJudgment):
    """Item 588: a release deployed on the run of another commit with its tree takes the hosted judgment of its own
    commit, the push run, once it lands, as an ordinary train's release does; every case of HostedJudgment holds."""

    def setUp(self):
        ReleaseCase.setUp(self)
        self.recorded(record(release=20, items=[481], measurements=tree_judged()))
        self.before = self.only()

    def test_a_pending_release_takes_its_judgment_once_and_nothing_else_in_its_record_changes(self):
        code, answer = self.attach(judgment())
        self.assertEqual((code, answer["attached"]), (0, True), answer)
        after = self.only()
        self.assertEqual(after["hosted_judgment"], judgment())
        self.assertEqual({k: v for k, v in after.items() if k != "hosted_judgment"},
                         {k: v for k, v in self.before.items() if k != "hosted_judgment"})
        self.assertEqual(after["measurements"]["judged_tree"]["judgment"], "pending", "the record stays as it was written")
        self.assertIn("never changes", self.refused_attach(judgment(conclusion="failure"), "RELEASE_JUDGED"))

    def test_a_judgment_of_the_judged_commit_is_not_the_releases(self):
        self.assertIn("not release 20's commit", self.refused_attach(judgment(head=C), "JUDGMENT_OF_ANOTHER_COMMIT"))

    def test_only_a_judged_tree_that_says_its_judgment_is_pending_takes_one(self):
        self.recorded(record(commit=C, previous=A, items=[482], measurements=tree_judged(judgment="judged", commit=C)))
        self.recorded(record(commit=B, previous=C, items=[483], measurements=dict(tree_judged(commit=B), judged_tree="pending")))
        for number in (21, 22):
            with self.subTest(number):
                self.refused_attach(judgment(head=C if number == 21 else B), "JUDGMENT_NOT_PENDING", number)


class HealthOfATrainRelease(ReleaseCase):
    """Items 481, 482: the Health view's latest release, for a release deployed from a merged train, says no release
    check measured it and says its hosted judgment: pending, then the one attached; for a train judged before its
    merge, that judgment. A release check's record still gives its counts."""

    def latest(self):
        answer = self.store.view("owner", "health", {})
        self.assertNotIn("error", answer, answer)
        return answer["release"]

    def test_a_train_release_has_no_release_check_and_says_its_judgment_as_it_stands(self):
        self.recorded(record(release=20, items=[481], measurements=trained()))
        latest = self.latest()
        self.assertIsNone(latest["check"], "no release check ran for a merged train")
        self.assertEqual(latest["train"], {"kind": "ordinary", "judgment": "pending", "succeeded": None, "total": None})
        attached = judgment()
        attached["verdict_checks"][0]["conclusion"] = "failure"
        self.store.attach_judgment(20, attached)
        self.assertEqual(self.latest()["train"], {"kind": "ordinary", "judgment": "judged", "succeeded": 1, "total": 2})
        self.recorded(record(commit=B, previous=A, items=[482], measurements=trained(kind="judged-first", judgment=judgment(head=C))))
        latest = self.latest()
        self.assertEqual((latest["release"], latest["check"]), (21, None))
        self.assertEqual(latest["train"], {"kind": "judged-first", "judgment": "judged", "succeeded": 2, "total": 2})

    def test_a_release_check_record_keeps_its_counts_and_is_no_train(self):
        # The negative: a release check's record, and one with no measurements, are not trains.
        self.recorded(record(release=19))
        latest = self.latest()
        self.assertIsNone(latest["train"])
        self.assertEqual((latest["check"]["python"], latest["check"]["node"], latest["check"]["native"]), (1106, 740, {"pass": 208, "total": 208}))
        self.recorded(record(commit=C, previous=A, items=[88], measurements=None))
        latest = self.latest()
        self.assertEqual((latest["release"], latest["check"], latest["train"]), (20, None, None))


def scoped(full_judgment="pending"):
    """The measurements of a release deployed on a scoped run (item 608, tools/releases.py measurements): its release
    check's counts, of the units and the one browser step it ran, and the steps it did not run."""
    return {"release_check": {"commit": A, "started_at": "2026-11-16T09:00:00-08:00", "finished_at": "2026-11-16T09:40:00-08:00"},
            "python_units": {"tests": 1106}, "node_units": {"tests": 740, "pass": 740},
            "native": {"pass": 12, "total": 12, "steps": {"health": {"pass": 12, "total": 12}}},
            "scoped": {"live": B, "changed": ["web/aim.css", "docs/health.md"], "steps": ["native-health"],
                       "not_run": ["native-journal", "native-colors", "native-rail"], "full_judgment": full_judgment}}


class ScopedFullRun(ReleaseCase):
    """Item 608: a release deployed on a scoped run says its full run is pending, and takes that run's judgment beside
    its record once it lands, once, never changed; a scoped record that does not say pending takes none."""

    def setUp(self):
        super().setUp()
        self.recorded(record(release=20, items=[608], measurements=scoped()))
        [self.before] = self.releases()["items"]

    def attach(self, value, number=20):
        return HostedJudgment.attach(self, value, number)

    def refused_attach(self, value, error, number=20):
        return HostedJudgment.refused_attach(self, value, error, number)

    def test_a_scoped_release_takes_its_full_runs_judgment_once_and_nothing_else_in_its_record_changes(self):
        self.assertIsNone(self.before["hosted_judgment"])
        code, answer = self.attach(judgment(conclusion="failure"))
        self.assertEqual((code, answer.get("attached")), (0, True), answer)
        [after] = self.releases()["items"]
        self.assertEqual(after["hosted_judgment"], judgment(conclusion="failure"))
        self.assertEqual({k: v for k, v in after.items() if k != "hosted_judgment"},
                         {k: v for k, v in self.before.items() if k != "hosted_judgment"})
        self.assertEqual(after["measurements"]["scoped"]["full_judgment"], "pending", "the record stays as it was written")
        self.assertEqual(self.attach(judgment(conclusion="failure"))[1].get("attached"), False, "the same judgment again is the one attached")
        self.assertIn("never changes", self.refused_attach(judgment(), "RELEASE_JUDGED"))
        self.refused_attach(judgment(head=C), "JUDGMENT_OF_ANOTHER_COMMIT")

    def test_a_scoped_record_that_does_not_say_its_full_run_is_pending_takes_none(self):
        self.recorded(record(commit=C, previous=A, items=[609], measurements=scoped(full_judgment="judged")))
        self.refused_attach(judgment(head=C), "JUDGMENT_NOT_PENDING", 21)

    def test_one_attach_serves_a_record_both_scoped_and_on_a_judged_tree_and_a_second_is_refused(self):
        # Items 588 and 608 together (tests/test_tools_deploy.py, DeployScopedJudgedTree): the push run of the deployed
        # commit is both the scoped run's full run and that commit's own judgment, so it is attached once.
        both = dict(scoped(), judged_tree={"judged_commit": B, "commit": C, "tree": A, "judgment": "pending"})
        self.recorded(record(commit=C, previous=A, items=[609], measurements=both))
        before = [item for item in self.releases()["items"] if item["release"] == 21][0]
        code, answer = self.attach(judgment(head=C), 21)
        self.assertEqual((code, answer.get("attached")), (0, True), answer)
        after = [item for item in self.releases()["items"] if item["release"] == 21][0]
        self.assertEqual(after["hosted_judgment"], judgment(head=C))
        self.assertEqual({k: v for k, v in after.items() if k != "hosted_judgment"}, {k: v for k, v in before.items() if k != "hosted_judgment"})
        self.assertEqual((after["measurements"]["scoped"]["full_judgment"], after["measurements"]["judged_tree"]["judgment"]),
                         ("pending", "pending"), "the record stays as it was written")
        self.assertIn("never changes", self.refused_attach(judgment(head=C, conclusion="failure"), "RELEASE_JUDGED", 21))
        self.refused_attach(judgment(head=B), "JUDGMENT_OF_ANOTHER_COMMIT", 21)
        health = self.store.view("owner", "health", {})["release"]
        self.assertEqual((health["release"], health["scoped"]["judgment"]), (21, "judged"))


class HealthOfAScopedRelease(ReleaseCase):
    """Item 608: the Health view's latest release, for a release deployed on a scoped run, says how many browser steps
    ran of the steps there are and that its full run is pending, then what the attached run found; it keeps its
    release check's counts. Any other release is not scoped."""

    def latest(self):
        answer = self.store.view("owner", "health", {})
        self.assertNotIn("error", answer, answer)
        return answer["release"]

    def test_a_scoped_release_says_its_steps_and_its_full_run_as_it_stands(self):
        self.recorded(record(release=20, items=[608], measurements=scoped()))
        latest = self.latest()
        self.assertEqual(latest.get("scoped"), {"ran": 1, "steps": 4, "judgment": "pending", "succeeded": None, "total": None})
        self.assertEqual((latest["check"]["python"], latest["check"]["native"], latest["train"]), (1106, {"pass": 12, "total": 12}, None))
        attached = judgment()
        attached["verdict_checks"][0]["conclusion"] = "failure"
        self.store.attach_judgment(20, attached)
        self.assertEqual(self.latest().get("scoped"), {"ran": 1, "steps": 4, "judgment": "judged", "succeeded": 1, "total": 2})

    def test_a_whole_runs_record_and_a_trains_are_not_scoped(self):
        self.recorded(record(release=19))
        self.assertIsNone(self.latest().get("scoped", "missing"))
        self.recorded(record(commit=C, previous=A, items=[481], measurements=trained()))
        self.assertIsNone(self.latest().get("scoped", "missing"))


class AttachJudgmentTool(ReleaseCase):
    """tools/releases.py attach-judgment: reads the record through the live CLI and each run and check from GitHub, and
    attaches the judgment through the live admin verb. Both are this checkout's own, run as processes."""

    def setUp(self):
        super().setUp()
        import test_tools_train as trains
        from tools import deploy
        self.trains, self.deploy = trains, deploy
        self.recorded(record(release=20, items=[481], measurements=trained()))
        raw = {"live": str(ROOT), "instance": str(Path(self.temp.name).resolve()), "server_profile": str(self.profile),
               "port": 5999, "runner_profile": "r.json", "runner_id": "r", "routes": "routes.json", "python": sys.executable,
               "release_branch": "release/live73", "repository": trains.REPOSITORY}
        self.config_path = Path(self.temp.name).resolve() / "deploy.json"
        self.config_path.write_text(json.dumps(raw))

    def tool(self, github, runs="301", checks="401,402"):
        from tools import releases
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = releases.main(["attach-judgment", "20", "--config", str(self.config_path), "--runs", runs, "--checks", checks,
                                  "--audit", "m-audit"], github=github)
        return code, out.getvalue(), err.getvalue()

    def test_the_tool_attaches_the_judgment_of_the_releases_commit(self):
        listed = self.trains.listed
        github = self.trains.FakeGitHub(runs=[listed(301, A)], checks=[listed(401, A, "failure", name="App"), listed(402, A)])
        code, out, err = self.tool(github)
        self.assertEqual(code, 0, err)
        self.assertTrue(json.loads(out)["attached"])
        [item] = self.store.view("owner", "releases", {})["items"]
        self.assertEqual([(found["id"], found["conclusion"]) for found in item["hosted_judgment"]["verdict_checks"]],
                         [(401, "failure"), (402, "success")])
        self.assertEqual(item["hosted_judgment"]["audit"], "m-audit")
        self.assertEqual(github.asked, ["repos/%s/actions/runs/301" % self.trains.REPOSITORY,
                                        "repos/%s/check-runs/401" % self.trains.REPOSITORY,
                                        "repos/%s/check-runs/402" % self.trains.REPOSITORY])

    def test_the_tool_attaches_the_push_run_to_a_release_deployed_on_a_judged_tree(self):
        # Item 588: release 21 deployed on the pull request's run of C, whose tree is its commit B's; the push run on B lands.
        self.recorded(record(commit=B, previous=A, items=[588], measurements=tree_judged(commit=B)))
        listed = self.trains.listed
        from tools import releases
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = releases.main(["attach-judgment", "21", "--config", str(self.config_path), "--runs", "301", "--checks", "401",
                                  "--audit", "m-audit"], github=self.trains.FakeGitHub(runs=[listed(301, B)], checks=[listed(401, B)]))
        self.assertEqual(code, 0, err.getvalue())
        judged = {item["release"]: item["hosted_judgment"] for item in self.store.view("owner", "releases", {})["items"]}
        self.assertEqual((judged[21]["head"], judged[20]), (B, None))
        # The run of the judged commit is not the release's own judgment: it names C, not B.
        with redirect_stdout(io.StringIO()), redirect_stderr(err):
            code = releases.main(["attach-judgment", "21", "--config", str(self.config_path), "--runs", "302", "--checks", "402",
                                  "--audit", "m-audit"], github=self.trains.FakeGitHub(runs=[listed(302, C)], checks=[listed(402, C)]))
        self.assertEqual(code, 1)
        self.assertIn("names %s as its head, not %s, release 21's commit" % (C, B), err.getvalue())

    def test_the_tool_finds_a_release_on_an_older_page_of_the_records(self):
        # B10: fifty later releases put release 20 on the second page the live CLI prints; the tool reads every page.
        previous = A
        for number in range(21, 71):
            commit = "%040x" % number
            self.recorded(record(release=number, commit=commit, previous=previous, items=[], measurements=None))
            previous = commit
        first = self.releases()
        self.assertNotIn(20, [item["release"] for item in first["items"]])
        self.assertIsNotNone(first["next_cursor"], "release 20 is on a later page")
        listed = self.trains.listed
        code, out, err = self.tool(self.trains.FakeGitHub(runs=[listed(301, A)], checks=[listed(401, A), listed(402, A)]))
        self.assertEqual(code, 0, err)
        self.assertTrue(json.loads(out)["attached"])
        judged = {item["release"]: item["hosted_judgment"] for item in self.store.view("owner", "releases", {"limit": 100})["items"]}
        self.assertEqual(judged[20]["head"], A)
        self.assertEqual([number for number, value in judged.items() if value is not None], [20], "no other release is judged")

    def test_the_tool_refuses_a_run_naming_another_commit_and_attaches_nothing(self):
        listed = self.trains.listed
        for runs, words in (([listed(301, C)], "the run 301 (Checks) names %s as its head, not %s, release 20's commit" % (C, A)),
                            ([listed(301, A, None, "in_progress")], "is in_progress, not completed"),
                            ([], "the run 301 could not be read")):
            with self.subTest(words):
                code, out, err = self.tool(self.trains.FakeGitHub(runs=runs, checks=[listed(401, A), listed(402, A)]))
                self.assertEqual((code, out), (1, ""))
                self.assertIn(words, err)
                self.assertEqual(self.sql("SELECT count(*) FROM release_judgments"), [(0,)])


class AttachScopedFullRunTool(ReleaseCase):
    """Item 608: tools/releases.py attach-judgment attaches a scoped release's full run as it does a train's hosted
    judgment, read from GitHub, and refuses a release whose record says neither is pending."""

    def setUp(self):
        super().setUp()
        import test_tools_train as trains
        self.trains = trains
        self.recorded(record(release=20, items=[481], measurements=trained()))
        raw = {"live": str(ROOT), "instance": str(Path(self.temp.name).resolve()), "server_profile": str(self.profile),
               "port": 5999, "runner_profile": "r.json", "runner_id": "r", "routes": "routes.json", "python": sys.executable,
               "release_branch": "release/live73", "repository": trains.REPOSITORY}
        self.config_path = Path(self.temp.name).resolve() / "deploy.json"
        self.config_path.write_text(json.dumps(raw))
        self.recorded(record(commit=C, previous=A, items=[608], measurements=scoped()))
        self.recorded(record(commit=B, previous=C, items=[609]))

    def tool(self, github, number, runs="301", checks="401"):
        from tools import releases
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = releases.main(["attach-judgment", str(number), "--config", str(self.config_path), "--runs", runs, "--checks", checks,
                                  "--audit", "m-audit"], github=github)
        return code, out.getvalue(), err.getvalue()

    def test_the_tool_attaches_a_scoped_releases_full_run_and_refuses_a_release_with_none_pending(self):
        listed = self.trains.listed
        code, out, err = self.tool(self.trains.FakeGitHub(runs=[listed(301, C)], checks=[listed(401, C, "failure")]), 21)
        self.assertEqual(code, 0, err)
        self.assertTrue(json.loads(out)["attached"])
        judged = {item["release"]: item["hosted_judgment"] for item in self.releases()["items"]}
        self.assertEqual((judged[21]["head"], [found["conclusion"] for found in judged[21]["verdict_checks"]]), (C, ["failure"]))
        code, out, err = self.tool(self.trains.FakeGitHub(runs=[listed(301, B)], checks=[listed(401, B)]), 22)
        self.assertEqual((code, out), (1, ""))
        self.assertIn("release 22's record does not say its hosted judgment or its full run is pending", err)
        self.assertIsNone({item["release"]: item["hosted_judgment"] for item in self.releases()["items"]}[22])


class Backfill(ReleaseCase):
    """Releases 18 and 19 shipped before deploys wrote records; docs/releases.md has the one-off command that records them."""

    def test_the_documented_command_records_releases_18_and_19_once(self):
        files = sorted(BACKFILL.glob("release-*.json"))
        self.assertEqual([path.name for path in files], ["release-18.json", "release-19.json"])
        doc = (ROOT / "docs" / "releases.md").read_text()
        for path in files:
            self.assertIn('--record "$LIVE/tools/pipeline/releases/%s"' % path.name, doc)
        for _ in range(2):
            answers = [self.recorded(json.loads(path.read_text())) for path in files]
        self.assertEqual([answer["recorded"] for answer in answers], [False, False], "the second run adds nothing")
        listed = {item["release"]: item for item in self.releases()["items"]}
        self.assertEqual(sorted(listed), [18, 19])
        self.assertEqual((listed[19]["commit"], listed[19]["previous"], listed[19]["deployed_at"], listed[19]["items"]),
                         ("485759bc81874b210ec58ab8a949464508f7d11f", "71e504df1a1bd2042a9886bfee23273f5691d4d1",
                          "2026-11-06T05:28:35-08:00", [87, 90, 2, 3, 83, 10, 30, 51, 29, 59, 58, 71, 73]))
        self.assertEqual((listed[18]["commit"], listed[18]["previous"], listed[18]["deployed_at"], listed[18]["items"]),
                         ("71e504df1a1bd2042a9886bfee23273f5691d4d1", "85fefab1d0c71409930417d5319d83a976c3e76f",
                          "2026-11-05T22:57:59-08:00", [1, 4]))
        self.assertEqual({item["source"] for item in listed.values()}, {"backfill"})
        # Release 19's counts are its release check's; release 18 ran before that check existed.
        measured = listed[19]["measurements"]
        self.assertEqual((measured["python_units"], measured["node_units"]["tests"], measured["native"]["pass"],
                          measured["native"]["total"]), ({"tests": 1106}, 740, 188, 188))
        self.assertIsNone(listed[18]["measurements"])


# Do not rerun the inherited StoreCase tests.
for _name in list(fixtures.StoreCase.__dict__):
    if _name.startswith("test_"):
        setattr(ReleaseCase, _name, None)
for _name in list(ReleaseCase.__dict__):
    if _name.startswith("test_"):
        for _case in (Backfill, HostedJudgment, AttachJudgmentTool, ScopedFullRun, HealthOfAScopedRelease, AttachScopedFullRunTool):
            setattr(_case, _name, None)
# Unbound, or the loader collects the last case twice: once by its name and once as _case.
del _case, _name


if __name__ == "__main__":
    unittest.main()
