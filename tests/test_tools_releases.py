from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
from types import SimpleNamespace
from unittest import mock
import tempfile
import unittest

from tools import releases, deploy, train
from aim_next import releases as core, health, check_reading, cli, pipeline


class PipelineTrailers(unittest.TestCase):
    """A change names its items in a `Pipeline:` trailer, read by git's own trailer rules, from a real repository."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = self.tmp.name
        self.git("init", "-q", ".")
        self.git("commit", "-q", "--allow-empty", "-m", "Base")
        self.base = self.git("rev-parse", "HEAD").strip()

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args):
        done = subprocess.run(["git", "-C", self.repo, "-c", "user.name=t", "-c", "user.email=t@example.com",
                               "-c", "commit.gpgsign=false"] + list(args), capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stderr)
        return done.stdout

    def commit(self, message):
        self.git("commit", "-q", "--allow-empty", "-m", message)

    def shipped(self):
        head = self.git("rev-parse", "HEAD").strip()
        log = subprocess.run(releases.log_argv(self.repo, self.base, head), capture_output=True, text=True)
        self.assertEqual(log.returncode, 0, log.stderr)
        return releases.shipped(log.stdout)

    def test_only_the_trailer_paragraph_names_items(self):
        self.commit("Docs: how a change names its items\n\nWrite a line such as\n\nPipeline: 87, 2\n\n"
                    "in the last paragraph.\n\nCo-Authored-By: x <x@example.com>\n")
        self.commit("Prose that ends a message\n\nThe last paragraph is prose.\nPipeline: 9\n")
        self.commit("Close keeps the writing\n\nPipeline: 88, 3\nCo-Authored-By: x <x@example.com>\n")
        self.commit("Lower case\n\npipeline: 4\npipeline: 5,\n  6\n")
        try:
            items, commits = self.shipped()
        except releases.Malformed as error:
            self.fail("a line outside the trailers was read: %s" % error)
        self.assertEqual(items, [88, 3, 4, 5, 6])
        self.assertEqual([commit["items"] for commit in commits], [[], [], [88, 3], [4, 5, 6]])
        self.assertEqual(commits[2]["subject"], "Close keeps the writing")

    def test_a_malformed_value_outside_the_trailers_is_not_read_inside_them_it_refuses(self):
        self.commit("Prose\n\nPipeline: none, as an example.\n\nNo trailer here.\n")
        self.assertEqual(self.shipped()[0], [])
        for value in ("none", "88.", "#88", "87 and 2", "087", "2,"):
            with self.subTest(value):
                self.commit("Something\n\nPipeline: %s\nCo-Authored-By: x <x@example.com>\n" % value)
                with self.assertRaises(releases.Malformed) as caught:
                    self.shipped()
                self.assertIn("Something", str(caught.exception))
                self.git("reset", "-q", "--hard", "HEAD~1")

    def test_a_revert_trailer_takes_back_an_earlier_claim_and_a_later_claim_ships_it_again(self):
        self.commit("Dossiers\n\nPipeline: 412\nCo-Authored-By: x <x@example.com>\n")
        self.commit("Composer\n\nPipeline: 464\n")
        self.commit("Docs: a revert says\n\nTrain-Item: Revert 464\n\nin its last paragraph.\n")
        self.commit("Train-Item says what a train carried\n\nTrain-Item: 464 the composer\n")
        self.commit("Train 8: revert 412\n\nTrain-Item: Revert 412\nCo-Authored-By: x <x@example.com>\n")
        items, commits = self.shipped()
        self.assertEqual(items, [464])
        self.assertEqual([commit["reverts"] for commit in commits], [[], [], [], [], [412]])
        self.assertEqual(releases.reverted(commits, [398]), [{"item": 412, "commit": commits[4]["commit"], "by": "trailer"},
                                                            {"item": 398, "commit": None, "by": "flag"}])
        self.commit("Dossiers again\n\nPipeline: 412\n")
        self.assertEqual(self.shipped()[0], [464, 412])
        self.commit("Both back out\n\ntrain-item: revert 412, 464\n")
        self.assertEqual(self.shipped()[0], [])

    def test_a_revert_trailer_that_names_no_items_refuses(self):
        for value in ("Revert next", "Revert 412 and 413", "Revert #412", "Revert", "revert  "):
            with self.subTest(value):
                self.commit("Take it back\n\nTrain-Item: %s\n" % value)
                with self.assertRaises(releases.Malformed) as caught:
                    self.shipped()
                self.assertIn("Take it back", str(caught.exception))
                self.git("reset", "-q", "--hard", "HEAD~1")


class CompactRecords(unittest.TestCase):
    """Synthetic records exercise storage; none claim an actual deployment or invoke one."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.output = Path(self.tmp.name).resolve()
        head = "a" * 40
        receipt = {"count": 1, "artifacts_sha256": "b" * 64,
                   "obligations": [{"case": "kept exactly α", "phase": None}] * 600,
                   "pool": [{"run": 29, "attempt": 1, "raw": {"passed": True, "counts": {"pass": 600}},
                             "artifact": {"archive": {"path": "/synthetic/archive.zip", "sha256": "f" * 64}}}]}
        self.full = {"train": {"file": "/synthetic/train.json", "pr": 9, "kind": "judged-first",
                     "merge_commit": head, "merged_tree": "b" * 40, "release_branch": "release/example",
                     "items": [{"item": 12, "approved_head": "c" * 40,
                                "review": "qualified: still not reachable with arrow keys"}],
                     "hosted_run": None, "judgment": {"head": "c" * 40, "audit": "synthetic audit",
                     "producer_runs": [{"kind": "run", "id": 4, "name": "source", "head_sha": "c" * 40,
                                        "status": "completed", "conclusion": "failure"}],
                     "verdict_checks": [{"kind": "check", "id": 5, "name": "verdict", "head_sha": "c" * 40,
                                         "status": "completed", "conclusion": "failure"}]},
                     "base_move": {"source_observed": {"passed": False, "red_count": 27,
                                    "controller": {"output": {"title": "refused"}, "refusals": "producer changed"}},
                                   "receipts": receipt}},
                     "steps_beyond_policy_unread": "the live policy could not be read"}
        self.record = {"release": 107, "commit": head, "previous": "d" * 40, "items": [12],
                       "source": "deploy", "measurements": self.full}
        self.at = "2026-11-17T01:02:03.456-08:00"

    def prepared(self):
        return dict(releases.prepare_record(self.record, self.output), deployed_at=self.at, evidence=str(self.output))

    def test_complete_bytes_and_receipt_digests(self):
        original = copy.deepcopy(self.full)
        row = self.prepared()
        ref = row["measurements"]["full_measurements"]
        raw = Path(ref["path"]).read_bytes()
        self.assertEqual(raw, core._json(original).encode("utf-8"))
        self.assertEqual(ref["sha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(ref["bytes"], len(raw))
        self.assertEqual(releases.verify_record(row, self.output), original)
        self.assertEqual(self.full, original)
        receipts = row["measurements"]["train"]["base_move"]["receipts"]
        full_receipts = original["train"]["base_move"]["receipts"]
        self.assertEqual(receipts["obligations"], {"count": 600, "sha256": releases.digest(full_receipts["obligations"])})
        self.assertEqual(receipts["sha256"], releases.digest(full_receipts))
        self.assertEqual(receipts["pool"], full_receipts["pool"])
        self.assertEqual(row["measurements"]["train"]["judge_receipts_sha256"],
                         {key: releases.digest(original["train"]["judgment"][key])
                          for key in ("producer_runs", "verdict_checks")})
        self.assertLessEqual(len(core.release_row(row)["measurements"].encode()), 16384)

    def test_full_reference_hash_covers_every_canonical_byte(self):
        projection = releases.compact_measurements(self.full, self.output / "release-107-measurements.json")
        expected = core._json(self.full).encode("utf-8")
        ref = projection["full_measurements"]
        self.assertEqual(ref["sha256"], hashlib.sha256(expected).hexdigest())
        self.assertEqual(ref["bytes"], len(expected))

    def test_equal_retry_and_existing_mismatch(self):
        row = self.prepared()
        self.assertEqual(self.prepared(), row)
        path = Path(row["measurements"]["full_measurements"]["path"])
        path.write_bytes(b"existing partial result")
        with self.assertRaisesRegex(train.Refused, "read-back"):
            self.prepared()
        self.assertEqual(path.read_bytes(), b"existing partial result")

    def test_missing_corrupt_wrong_hash_size_and_path_refuse(self):
        row = self.prepared()
        path = Path(row["measurements"]["full_measurements"]["path"])
        raw = path.read_bytes()
        for key, value in (("path", str(self.output / "other.json")), ("sha256", "0" * 64),
                           ("bytes", len(raw) - 1), ("version", 2)):
            bad = copy.deepcopy(row)
            bad["measurements"]["full_measurements"][key] = value
            with self.subTest(key=key), self.assertRaises(train.Refused):
                releases.verify_record(bad, self.output)
        path.write_bytes(raw[:-1] + b"!")
        with self.assertRaisesRegex(train.Refused, "hash"):
            releases.verify_record(row, self.output)
        path.unlink()
        with self.assertRaises(FileNotFoundError):
            releases.verify_record(row, self.output)

    def test_wrong_head_items_qualifications_and_judge_receipts_refuse(self):
        row = self.prepared()
        for label in ("head", "item", "qualification", "judge", "obligation", "pool", "directory", "release"):
            bad = copy.deepcopy(row)
            t = bad["measurements"]["train"]
            if label == "head": bad["commit"] = "f" * 40
            if label == "item": bad["items"] = [99]
            if label == "qualification": t["items"][0]["review"] = "unqualified"
            if label == "judge": t["judgment"]["verdict_checks"][0]["conclusion"] = "success"
            if label == "obligation": t["base_move"]["receipts"]["obligations"]["count"] = 599
            if label == "pool": t["base_move"]["receipts"]["pool"][0]["run"] = 30
            if label == "directory": bad["evidence"] = str(self.output / "elsewhere")
            if label == "release": bad["release"] = 108
            with self.subTest(label=label), self.assertRaises(train.Refused):
                releases.verify_record(bad, self.output)

    def test_symlink_foreign_directory_and_path_bound(self):
        path = self.output / "release-107-measurements.json"
        target = self.output / "target"
        target.write_bytes(releases.canonical(self.full))
        path.symlink_to(target)
        with self.assertRaises(OSError): self.prepared()
        self.assertTrue(path.is_symlink())
        path.unlink()
        self.output.chmod(0o777)
        with self.assertRaisesRegex(train.Refused, "owned"): self.prepared()
        self.output.chmod(0o700)
        # Length is enforced independently of filesystem component limits.
        with self.assertRaisesRegex(train.Refused, "path exceeds"):
            releases.publish_once(self.output / ("x" * 1100), b"{}")

    def test_full_and_future_compact_bounds_without_truncation(self):
        self.full["future_metadata"] = "x" * 17000
        original = copy.deepcopy(self.full)
        with self.assertRaisesRegex(core.Refusal, "16384"): self.prepared()
        self.assertEqual(self.full, original)
        self.assertFalse((self.output / "release-107-measurements.json").exists())
        with mock.patch.object(releases, "MAX_FULL_BYTES", 8):
            with self.assertRaisesRegex(train.Refused, "byte bound"): self.prepared()

    def test_io_failures_do_not_publish_partial_bytes(self):
        path = self.output / "release-107-measurements.json"
        for call in ("link", "fsync"):
            with self.subTest(call=call), mock.patch.object(releases.os, call, side_effect=OSError("injected " + call)):
                with self.assertRaises(OSError): self.prepared()
            self.assertFalse(path.exists())
        self.assertEqual(list(self.output.iterdir()), [])
        temporary = releases.tempfile.NamedTemporaryFile
        class PartialWrite:
            def __init__(self, *args, **kwargs):
                self.stream = temporary(*args, **kwargs)
                self.name = self.stream.name
            def __enter__(self):
                return self
            def __exit__(self, *args):
                self.stream.close()
            def write(self, raw):
                self.stream.write(raw[:8])  # An actual partial temp-file write, then injected disk failure.
                raise OSError("injected partial write failure")
        with mock.patch.object(releases.tempfile, "NamedTemporaryFile", PartialWrite):
            with self.assertRaisesRegex(OSError, "partial write failure"):
                self.prepared()
        self.assertFalse(path.exists())
        self.assertEqual(list(self.output.iterdir()), [])

    def test_bounded_read_and_foreign_file_owner_refuse(self):
        path = self.output / "raw.json"
        path.write_bytes(b"123456789")
        with self.assertRaisesRegex(train.Refused, "byte bound"):
            releases._read(path, 8)
        real_stat = releases.os.fstat
        def foreign(fd):
            info = real_stat(fd)
            return SimpleNamespace(st_mode=info.st_mode, st_uid=os.getuid() + 1, st_size=info.st_size)
        with mock.patch.object(releases.os, "fstat", side_effect=foreign):
            with self.assertRaisesRegex(train.Refused, "owned"):
                releases._read(path, 9)

    def test_nonregular_evidence_refuses_without_waiting_for_a_writer(self):
        path = self.output / "release-107-measurements.json"
        os.mkfifo(str(path))
        with self.assertRaisesRegex(train.Refused, "regular"):
            self.prepared()

    def test_postpublication_failure_retry_reads_complete_file(self):
        # A directory sync or read-back failure can leave a complete published name, never a compact success.
        sync = releases.os.fsync
        calls = []
        def fail_directory(fd):
            calls.append(fd)
            if len(calls) == 2: raise OSError("directory sync failed")
            return sync(fd)
        with mock.patch.object(releases.os, "fsync", side_effect=fail_directory):
            with self.assertRaises(OSError): self.prepared()
        path = self.output / "release-107-measurements.json"
        self.assertEqual(path.read_bytes(), releases.canonical(self.full))
        self.assertEqual(releases.verify_record(self.prepared(), self.output), self.full)

    def readers(self, record):
        """Actual named board and count methods, fed only in-memory answers, with no store opened."""
        lines = []
        fake = SimpleNamespace(options=SimpleNamespace(limit=None), pages=lambda *args: [record],
                               out=SimpleNamespace(plain=lines.append))
        cli.Agent.do_releases(fake)
        deployed_ms = core.release_row(dict(record, measurements=None))["deployed_ms"]
        db = SimpleNamespace(execute=lambda sql: [(record["release"], deployed_ms, n) for n in record["items"]])
        board = pipeline.Pipeline._shipped_numbers(None, db)
        measured = record["measurements"]
        return (lines, board, health._release_check(measured), health._release_train(measured, None),
                health._release_scoped(measured, None), core.judgment_pending(measured),
                check_reading.steps_of_measurements(measured or {}))

    def test_board_count_semantic_equivalence_and_qualifications(self):
        before = dict(self.record, deployed_at=self.at)
        after = self.prepared()
        self.assertEqual(self.readers(before), self.readers(after))
        self.assertEqual(health._release_train(after["measurements"], None),
                         {"kind": "judged-first", "judgment": "judged", "total": 2, "succeeded": 0})
        for field in ("release", "commit", "previous", "items", "source", "deployed_at"):
            self.assertEqual(after[field], before[field])
        for field in ("items", "judgment", "hosted_run"):
            self.assertEqual(after["measurements"]["train"][field], self.full["train"][field])
        self.assertEqual(after["measurements"]["train"]["base_move"]["source_observed"],
                         self.full["train"]["base_move"]["source_observed"])

    def test_ordinary_pending_attached_and_no_train_scoped_legacy(self):
        ordinary = copy.deepcopy(self.full)
        ordinary["train"].pop("base_move")
        ordinary["train"].update(kind="ordinary", judgment="pending")
        cases = [ordinary, {"release_check": {"commit": self.record["commit"]}, "python_units": {"tests": 9},
                 "node_units": {"tests": 3, "pass": 2}, "native": {"pass": 1, "total": 2, "steps": {"rail": {"pass": 1, "total": 2}}},
                 "known_reds": [{"case": "still red"}], "skipped": {"why": "synthetic"},
                 "scoped": {"steps": ["native-rail"], "not_run": ["native-reading"], "full_judgment": "pending"}},
                 {"release_check": {"commit": "e" * 40}, "judged_tree": {"commit": self.record["commit"], "judgment": "pending"}}]
        attached = {"producer_runs": [{"conclusion": "failure"}], "verdict_checks": [{"conclusion": "success"}]}
        for index, full in enumerate(cases):
            record = dict(self.record, release=200 + index, measurements=full, deployed_at=self.at)
            after = dict(releases.prepare_record(record, self.output), evidence=str(self.output))
            self.assertEqual(self.readers(record), self.readers(after))
            self.assertEqual(health._release_train(full, attached), health._release_train(after["measurements"], attached))
            self.assertEqual(health._release_scoped(full, attached), health._release_scoped(after["measurements"], attached))
        legacy = dict(self.record, deployed_at=self.at, measurements=None, source="backfill")
        self.assertIsNone(core.release_row(legacy)["measurements"])
        self.assertIsNone(health._release_train(None, None))
        self.assertIn("recorded retroactively", self.readers(legacy)[0][0])

    def test_pointer_cannot_be_saved_or_judged_as_full_input(self):
        row = self.prepared()
        with self.assertRaisesRegex(train.Refused, "not a pointer"):
            releases.prepare_record(row, self.output)
        path = self.output / "pointer-train.json"
        path.write_text(json.dumps(row["measurements"]))
        with self.assertRaisesRegex(train.Refused, "exactly"):
            train.load(path)

    def test_record_command_readback_core_refusal_and_real_time_preserved(self):
        row = self.prepared()
        config = SimpleNamespace(python="/synthetic/python", live=Path("/synthetic/live"),
                                 server_profile=Path("/synthetic/profile-not-read"))
        with mock.patch.object(deploy, "now", side_effect=AssertionError("record time is not deploy time")), \
             mock.patch.object(deploy, "run", side_effect=AssertionError("no command may execute")):
            commands = deploy.record_commands(config, self.output, [row])
        self.assertEqual(len(commands), 1)
        stored = json.loads((self.output / "release-107.json").read_bytes())
        self.assertEqual(stored["deployed_at"], self.at)
        self.assertEqual(stored, row)
        # Both an invalid actual Core row and a damaged full file must refuse before returning commands.
        bad = dict(row, deployed_at="invalid")
        with self.assertRaisesRegex(deploy.Refused, "no record command was run"):
            deploy.record_commands(config, self.output, [bad])
        Path(row["measurements"]["full_measurements"]["path"]).write_bytes(b"corrupt")
        with self.assertRaisesRegex(deploy.Refused, "no record command was run"):
            deploy.record_commands(config, self.output, [row])
        self.assertEqual(json.loads((self.output / "release-107.json").read_bytes()), stored)

    def test_record_file_mismatch_is_not_overwritten(self):
        row = self.prepared()
        path = self.output / "release-107.json"
        path.write_bytes(b"previous record")
        config = SimpleNamespace(python="synthetic", live=Path("/synthetic"), server_profile=Path("/synthetic/not-read"))
        with self.assertRaises(deploy.Refused): deploy.record_commands(config, self.output, [row])
        self.assertEqual(path.read_bytes(), b"previous record")

    def test_plan_publishes_full_before_stop_and_reports_write_failure(self):
        # Invoke only the planner; all live-query names are replaced, and deploy itself is never called.
        head = self.record["previous"]
        old = dict(self.record, release=106, commit=head, items=[], measurements=None, deployed_at=self.at)
        with mock.patch.object(deploy, "shipped_between", return_value=([12], [])), \
             mock.patch.object(deploy, "live_records", return_value=[old]), \
             mock.patch.object(deploy, "kept_lacked", return_value=[]), \
             mock.patch.object(deploy, "went_live", return_value=[]):
            planned, _, _, _ = deploy.release_plan(None, head, self.record["commit"], self.full,
                                                   None, False, evidence=self.output)
            self.assertNotIn("deployed_at", planned)
            self.assertEqual(releases.verify_record(dict(planned, evidence=str(self.output)), self.output), self.full)
            with mock.patch.object(releases, "publish_once", side_effect=OSError("injected write failure")):
                with self.assertRaisesRegex(deploy.Refused, "nothing was stopped"):
                    deploy.release_plan(None, head, self.record["commit"], self.full, None, False, evidence=self.output)


if __name__ == "__main__":
    unittest.main()
