from __future__ import annotations

import io
import json
import os
import subprocess
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

from tools import deploy
from test_tools_deploy import DeployCase, FakeHost, summary


class ReleaseBranch(DeployCase):
    """Item 667: the deploy's runtime is fake; every git operation uses a temporary bare remote."""

    def git(self, *args, bare=False):
        prefix = ["git", "--git-dir", str(self.remote)] if bare else ["git", "-C", str(self.config.live)]
        answer = subprocess.run(prefix + list(args), capture_output=True, text=True,
                                env=self.git_env, check=True)
        return answer.stdout.strip()

    def setUp(self):
        super().setUp()
        # No git call in these cases can use the network, including the deploy's fetch/push/read-back.
        self.git_env = dict(os.environ, GIT_ALLOW_PROTOCOL="file", GIT_TERMINAL_PROMPT="0")
        self.raw.update(release_branch="release/live73", repository="commonfabric-offcuts/theseus")
        self.config_path.write_text(json.dumps(self.raw))
        self.config = deploy.load_config(self.config_path)
        self.config.live.mkdir()
        self.git("init", "-q")
        self.git("config", "user.name", "Deploy fixture")
        self.git("config", "user.email", "deploy@example.invalid")
        self.git("commit", "-q", "--allow-empty", "-m", "Earlier release")
        self.earlier = self.git("rev-parse", "HEAD")
        self.git("commit", "-q", "--allow-empty", "-m", "Old release")
        self.old = self.git("rev-parse", "HEAD")
        self.git("commit", "-q", "--allow-empty", "-m", "Intermediate change")
        self.middle = self.git("rev-parse", "HEAD")
        self.git("commit", "-q", "--allow-empty", "-m", "New release\n\nPipeline: 667")
        self.new = self.git("rev-parse", "HEAD")
        self.remote = self.config.live.parent / "remote.git"
        self.git("clone", "--bare", "-q", str(self.config.live), str(self.remote))
        self.git("update-ref", "refs/heads/release/live73", self.old, bare=True)
        self.git("remote", "add", "origin", str(self.remote))
        self.git("checkout", "-q", "--detach", self.old)
        self.calls = []
        self.output = io.StringIO()

    def remote_head(self):
        return self.git("rev-parse", "refs/heads/release/live73", bare=True)

    def branch_evidence(self):
        path = self.evidence / "12-release-branch.json"
        self.assertTrue(path.exists(), "the deploy must record the release branch result")
        return json.loads(path.read_text())

    def run_release(self, dry=False, restart=False, failed=(), recorded=0, cli=0, intercept=None):
        sha = self.old if restart else self.new
        self.summary.write_text(json.dumps(summary(commit=sha, failed=failed)))
        self.host = FakeHost(self.config, recorded=recorded, cli=cli)

        def run(argv, **kw):
            self.calls.append(argv)
            if argv[0] == "git":
                if intercept:
                    answer = intercept(argv)
                    if answer is not None:
                        return answer
                return subprocess.run(argv, capture_output=True, text=True, env=self.git_env, **kw)
            return self.host(argv, **kw)

        def start(config, revision, argv, run_dir, previous):
            run_dir.mkdir()
            return mock.Mock(pid=401 if "aim-next-server" in argv[2] else 402, poll=lambda: None)

        with mock.patch.object(deploy, "run", run), \
                mock.patch.object(deploy.os, "kill", lambda pid, sig: self.kills.append((pid, sig))), \
                mock.patch.object(deploy, "wait_exit", return_value="exited"), \
                mock.patch.object(deploy, "start", start), \
                mock.patch.object(deploy, "wait_line", side_effect=['{"status":"ready"}', '{"event":"acquired"}']), \
                mock.patch.object(deploy.urllib.request, "urlopen", return_value=mock.Mock(status=200, read=lambda: b'{}')), \
                redirect_stdout(self.output), redirect_stderr(self.output):
            return deploy.main(["--config", str(self.config_path), "--release-check", str(self.summary),
                                sha, str(self.evidence)] + (["--release", "20"] if not restart else [])
                               + (["--dry-run"] if dry else []))

    def test_new_release_moves_remote_to_recorded_head_and_reads_it_back(self):
        self.assertEqual(self.run_release(), 0, self.output.getvalue())
        [recorded] = self.host.written
        self.assertEqual(recorded["commit"], self.new)
        self.assertEqual(self.remote_head(), recorded["commit"],
                         "the release record names the shipped head but the remote branch stayed behind")
        evidence = self.branch_evidence()
        self.assertEqual({key: evidence[key] for key in ("branch", "old_head", "new_head", "read_back", "success")},
                         {"branch": "release/live73", "old_head": self.old, "new_head": self.new,
                          "read_back": self.new, "success": True})
        push = next(i for i, argv in enumerate(self.calls) if "push" in argv)
        written = next(i for i, argv in enumerate(self.calls) if "record-release" in argv)
        self.assertGreater(push, written, "publish only after the verified release is recorded")
        self.assertTrue(any("ls-remote" in argv for argv in self.calls[push + 1:]), "read back from the remote")
        self.assert_no_unconditional_force(self.calls[push])

    def assert_no_unconditional_force(self, argv):
        # The explicit old-head lease and the ancestry check together permit only a fast-forward.
        self.assertNotIn("--force", argv)
        self.assertNotIn("-f", argv)
        self.assertFalse(any(arg.startswith("+") for arg in argv))

    def test_without_release_branch_evidence_says_not_moved_and_no_branch_is_guessed(self):
        self.raw.pop("release_branch")
        self.config_path.write_text(json.dumps(self.raw))
        self.assertEqual(self.run_release(), 0, self.output.getvalue())
        self.assertEqual(self.remote_head(), self.old)
        evidence = self.branch_evidence()
        self.assertIsNone(evidence["branch"])
        self.assertFalse(evidence["moved"])
        self.assertIn("no release_branch", evidence["why"])
        self.assertEqual([argv for argv in self.calls if any(op in argv for op in ("fetch", "push", "ls-remote"))], [])

    def test_dry_run_does_not_move_or_contact_remote(self):
        self.assertEqual(self.run_release(dry=True), 0, self.output.getvalue())
        self.assert_untouched()
        self.assertEqual(self.host.written, [])
        self.assertEqual(self.kills, [])

    def test_unpassed_release_check_does_not_move_or_contact_remote(self):
        self.assertEqual(self.run_release(failed=("python-units",)), 1)
        self.assertIn("release check has not passed", self.output.getvalue())
        self.assert_untouched()
        self.assertEqual(self.host.written, [])
        self.assertEqual(self.kills, [])

    def test_restart_does_not_move_or_contact_remote(self):
        self.assertEqual(self.run_release(restart=True), 0, self.output.getvalue())
        self.assert_untouched()
        self.assertEqual(self.host.written, [])

    def assert_untouched(self):
        self.assertEqual(self.remote_head(), self.old)
        self.assertEqual([argv for argv in self.calls if any(op in argv for op in ("fetch", "push", "ls-remote"))], [])

    def diverge(self):
        tree = self.git("rev-parse", self.old + "^{tree}")
        other = self.git("-c", "user.name=Other fixture", "-c", "user.email=other@example.invalid",
                         "commit-tree", tree, "-p", self.old, "-m", "Someone pushed elsewhere", bare=True)
        self.git("update-ref", "refs/heads/release/live73", other, bare=True)
        return other

    def test_diverged_remote_is_refused_without_force_and_record_is_kept(self):
        other = self.diverge()
        self.assertEqual(self.run_release(), 1, "a remote branch outside the shipped history must refuse")
        self.assertEqual(self.remote_head(), other)
        self.assertEqual([record["commit"] for record in self.host.written], [self.new])
        evidence = self.branch_evidence()
        self.assertFalse(evidence["success"])
        self.assertEqual((evidence["old_head"], evidence["new_head"]), (other, self.new))
        self.assertIn("not an ancestor", evidence["refused"])
        self.assertEqual([argv for argv in self.calls if "push" in argv], [])

    def test_read_back_mismatch_is_not_success_even_after_push(self):
        self.git("update-ref", "refs/remotes/origin/release/live73", self.new)
        def change_after_push(argv):
            if "ls-remote" in argv and self.remote_head() == self.new:
                self.diverge()
        self.assertEqual(self.run_release(intercept=change_after_push), 1,
                         "a successful push alone is not proof of the remote branch's head")
        evidence = self.branch_evidence()
        self.assertFalse(evidence["success"])
        self.assertNotEqual(evidence["read_back"], self.new)
        self.assertIn("read-back", evidence["refused"])
        self.assertEqual(self.host.written[0]["commit"], self.new)

    def test_unreadable_remote_after_push_is_not_success(self):
        def unreadable(argv):
            if "ls-remote" in argv:
                return subprocess.CompletedProcess(argv, 128, "", "remote unavailable")
        self.assertEqual(self.run_release(intercept=unreadable), 1,
                         "a remote read failure cannot attest a successful branch move")
        evidence = self.branch_evidence()
        self.assertFalse(evidence["success"])
        self.assertIsNone(evidence["read_back"])
        self.assertIn("read-back", evidence["refused"])
        self.assertEqual(self.remote_head(), self.new)
        self.assertEqual(self.host.written[0]["commit"], self.new)

    def test_push_race_is_refused_never_forced_and_record_is_kept(self):
        def race(argv):
            if "push" in argv:
                self.diverge()
        self.assertEqual(self.run_release(intercept=race), 1, "a concurrent remote change must reject a normal push")
        self.assertNotEqual(self.remote_head(), self.new)
        evidence = self.branch_evidence()
        self.assertFalse(evidence["success"])
        self.assertIn("push", evidence["refused"])
        self.assertEqual(self.host.written[0]["commit"], self.new)
        for argv in self.calls:
            self.assert_no_unconditional_force(argv)

    def test_missing_remote_branch_is_refused_and_not_created(self):
        self.git("update-ref", "-d", "refs/heads/release/live73", bare=True)
        self.assertEqual(self.run_release(), 1, "a missing branch is not permission to create one")
        self.assertFalse(self.branch_evidence()["success"])
        self.assertEqual(self.git("for-each-ref", "refs/heads/release/live73", bare=True), "")

    def assert_changed_branch_is_kept(self, target):
        """Change the real bare ref after fetch, before push's own remote advertisement."""
        raced = []
        def change_before_push(argv):
            if "push" in argv:
                self.assertEqual(self.remote_head(), self.old)
                args = ("-d", "refs/heads/release/live73") if target is None else ("refs/heads/release/live73", target)
                self.git("update-ref", *args, bare=True)
                # Assert the mutation applied before letting the real git push run.
                self.assertEqual(self.git("for-each-ref", "--format=%(objectname)", "refs/heads/release/live73", bare=True),
                                 target or "")
                raced.append(target)

        self.assertEqual(self.run_release(intercept=change_before_push), 1,
                         "publication must refuse a branch deleted or changed since fetch")
        self.assertEqual(raced, [target], "the race must occur at the real publication boundary")
        self.assertEqual(self.git("for-each-ref", "--format=%(objectname)", "refs/heads/release/live73", bare=True),
                         target or "", "publication must neither recreate nor overwrite the changed branch")
        evidence = self.branch_evidence()
        self.assertEqual((evidence["old_head"], evidence["new_head"]), (self.old, self.new))
        self.assertFalse(evidence["success"])
        self.assertFalse(evidence["moved"])
        self.assertIsNone(evidence["read_back"])
        self.assertNotEqual(evidence["push"]["exit"], 0)
        self.assertIn("push", evidence["refused"])
        self.assertIn("release record is kept", self.output.getvalue())
        self.assertEqual(self.git("rev-parse", "HEAD"), self.new, "the verified release stays live")
        self.assertEqual([record["commit"] for record in self.host.written], [self.new])

    def test_branch_deleted_between_fetch_and_push_is_not_recreated_and_record_is_kept(self):
        self.assert_changed_branch_is_kept(None)

    def test_branch_rewound_between_fetch_and_push_is_not_overwritten_and_record_is_kept(self):
        self.assert_changed_branch_is_kept(self.earlier)

    def test_branch_advanced_between_fetch_and_push_is_not_overwritten_and_record_is_kept(self):
        self.assert_changed_branch_is_kept(self.middle)

    def test_failed_verify_leaves_branch_untouched(self):
        self.assertEqual(self.run_release(cli=2), 1)
        self.assert_untouched()
        self.assertEqual(self.host.written, [])

    def test_failed_record_leaves_branch_untouched(self):
        self.assertEqual(self.run_release(recorded=2), 1)
        self.assert_untouched()

    def test_branch_already_at_shipped_head_is_read_back_without_rewind(self):
        self.git("update-ref", "refs/heads/release/live73", self.new, bare=True)
        self.assertEqual(self.run_release(), 0, self.output.getvalue())
        evidence = self.branch_evidence()
        self.assertEqual((evidence["old_head"], evidence["read_back"]), (self.new, self.new))
        self.assertTrue(evidence["success"])
