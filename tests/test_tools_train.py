from __future__ import annotations

"""Items 481 and 482, rule 1: a deploy takes a merged train in place of a local release check (docs/tools.md, "A merged
train"). Each fact the train names is read again from a real git repository with an origin, and from GitHub through a
typed stand-in for `gh api`; nothing here replaces the standard library."""

import io
import json
from pathlib import Path
import subprocess
import sys
import unittest
from contextlib import redirect_stdout, redirect_stderr
from unittest import mock

from tools import deploy
import test_tools_deploy as deploys

BRANCH, REPOSITORY, PR = "release/live73", "offcuts/theseus", 31


class FakeGitHub:
    """GitHub's REST answers from a table, by API path; a path it lacks is a read that failed, as gh's exit would be."""

    def __init__(self, runs=(), checks=()):
        self.answers = {}
        for found in runs:
            self.answers["repos/%s/actions/runs/%d" % (REPOSITORY, found["id"])] = found
        for found in checks:
            self.answers["repos/%s/check-runs/%d" % (REPOSITORY, found["id"])] = found
        self.asked = []

    def get(self, path):
        self.asked.append(path)
        if path not in self.answers:
            raise deploy.train_check.Unreadable("gh api %s exited 1: HTTP 404" % path)
        return self.answers[path]


def listed(number, head, conclusion="success", status="completed", name="Checks"):
    return {"id": number, "name": name, "head_sha": head, "status": status, "conclusion": conclusion, "html_url": "https://x"}


class Repositories:
    """An origin, the working copy that merges into its release branch, and the live checkout, which tracks origin."""

    def repositories(self, live):
        base = Path(self.tmp.name)
        self.origin, self.work, self.live = base / "origin.git", base / "work", Path(live)
        self.git(base, "init", "-q", "--bare", str(self.origin))
        self.git(base, "init", "-q", str(self.work))
        self.write("aim_next/releases.py", "# the live code keeps release records\n")
        self.write("tools/deploy.py", "# the deploy\n")
        self.write("README", "Theseus\n")
        self.L = self.commit("Release 74", "-a")
        self.git(self.work, "remote", "add", "origin", str(self.origin))
        self.git(self.work, "push", "-q", "origin", "HEAD:refs/heads/" + BRANCH)
        self.live.mkdir(parents=True, exist_ok=True)
        self.git(self.live, "init", "-q")
        self.git(self.live, "remote", "add", "origin", str(self.origin))
        self.git(self.live, "fetch", "-q", "origin")
        self.git(self.live, "checkout", "-q", "-b", "live", self.L)

    def git(self, where, *args):
        done = subprocess.run(["git", "-C", str(where), "-c", "user.name=t", "-c", "user.email=t@example.com",
                               "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main"] + list(args),
                              capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stderr)
        return done.stdout.strip()

    def write(self, name, text):
        path = self.work / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        self.git(self.work, "add", name)

    def commit(self, subject, *args):
        self.git(self.work, "commit", "-q", "-m", subject + "\n\nPipeline: 481\n" if "Item" in subject else subject)
        return self.git(self.work, "rev-parse", "HEAD")

    def branch(self, name, start, changes):
        """A branch from start with one commit per (path, text); its tip."""
        self.git(self.work, "checkout", "-q", "-b", name, start)
        for path, text in changes:
            self.write(path, text)
            self.commit("Item 481: %s" % path)
        return self.git(self.work, "rev-parse", "HEAD")

    def merge(self, head, onto=BRANCH, push=True):
        """The pull request's merge into onto as GitHub makes it (--no-ff), pushed to origin unless push is False;
        the live checkout fetches it. The merge commit."""
        self.git(self.work, "fetch", "-q", "origin")
        self.git(self.work, "checkout", "-q", "-B", "merging", "origin/" + onto if self.has("origin/" + onto) else self.L)
        self.git(self.work, "merge", "-q", "--no-ff", "-m", "Merge pull request #%d\n\nPipeline: 481" % PR, head)
        merged = self.git(self.work, "rev-parse", "HEAD")
        if push:
            self.git(self.work, "push", "-q", "origin", "HEAD:refs/heads/" + onto)
        self.git(self.live, "fetch", "-q", "origin")
        return merged

    def has(self, ref):
        return subprocess.run(["git", "-C", str(self.work), "rev-parse", "--verify", "-q", ref], capture_output=True).returncode == 0

    def tree(self, commit):
        return self.git(self.work, "rev-parse", commit + "^{tree}")

    def train(self, merged, heads, kind="ordinary", hosted_run=None, judgment=None, **change):
        path = Path(self.tmp.name) / "train.json"
        path.write_text(json.dumps(dict({"pr": PR, "merge_commit": merged, "merged_tree": self.tree(merged), "kind": kind,
                                         "items": [{"item": 481 + n, "approved_head": head, "review": "m-review-%d" % n}
                                                   for n, head in enumerate(heads)],
                                         "hosted_run": hosted_run, "judgment": judgment}, **change)))
        return path


class GitHost(deploys.FakeHost):
    """The deploy's ps, live CLI, backup and migration from FakeHost's table; every git call runs for real against the
    live checkout it names."""

    def __call__(self, argv, **kw):
        if argv[0] == "git":
            self.calls.append(argv)
            return subprocess.run(argv, capture_output=True, text=True)
        return super().__call__(argv, **kw)


class TrainCase(Repositories, deploys.DeployCase):
    def setUp(self):
        super().setUp()
        self.raw.update(release_branch=BRANCH, repository=REPOSITORY)
        self.config_path.write_text(json.dumps(self.raw))
        self.config = deploy.load_config(self.config_path)
        self.repositories(self.config.live)

    def host(self, **more):
        # The live instance records release 19 at the live commit.
        return GitHost(self.config, **dict({"releases": (deploys.page(deploys.release(19, self.L)), 0)}, **more))

    def trained(self, host, train, sha, github, dry=True):
        with redirect_stdout(io.StringIO()) as out:
            with mock.patch.object(deploy, "run", host), \
                    mock.patch.object(deploy, "start", side_effect=AssertionError("must not start a process")):
                deploy.deploy(self.config, sha, self.evidence, None, dry, train=train, github=github)
        return out.getvalue()

    def refused_train(self, train, sha, github, words):
        """Refused at 00-train, naming words, before any process is listed or anything is stopped."""
        host = self.host()
        try:
            self.trained(host, train, sha, github)
        except deploy.Refused as refusal:
            self.assertIn("train: ", str(refusal))
            self.assertIn(words, str(refusal))
        else:
            self.fail("the deploy took the train")
        self.assertEqual(self.records(), ["00-train"])
        self.assertIn(words, json.loads((self.evidence / "00-train.json").read_text())["refused"])
        self.assertEqual([call for call in host.calls if call[0] != "git"], [], "no process was listed, nothing read but git")
        self.assertEqual(self.kills, [])

    def evidence_of(self, name):
        return json.loads((self.evidence / (name + ".json")).read_text())


class DeployRefusesTrain(TrainCase):
    """An ordinary merged train: judged on GitHub after its merge, so its record says the judgment is pending."""

    def setUp(self):
        super().setUp()
        self.head = self.branch("item-481", self.L, [("aim_next/work.py", "# item 481\n")])
        self.merged = self.merge(self.head)

    def test_an_ordinary_merged_train_is_planned_with_its_judgment_pending_and_no_local_check(self):
        out = self.trained(self.host(), self.train(self.merged, [self.head]), self.merged, FakeGitHub())
        self.assertIn("train: PR #31 (ordinary), merge commit %s on origin's %s; the hosted judgment is pending (PR #31)"
                      % (self.merged[:12], BRANCH), out)
        self.assertEqual(self.records(), ["00-plan", "00-train", "01-live", "02-checkout", "02-release"])
        record = self.evidence_of("02-release")["record"]
        self.assertEqual((record["commit"], record["previous"], record["items"]), (self.merged, self.L, [481]))
        train = record["measurements"]["train"]
        self.assertEqual((train["pr"], train["kind"], train["merge_commit"], train["judgment"], train["hosted_run"]),
                         (PR, "ordinary", self.merged, "pending", None))
        self.assertEqual(train["items"], [{"item": 481, "approved_head": self.head, "review": "m-review-0"}])
        self.assertEqual(set(record["measurements"]), {"train"}, "no count claims a local release check ran")

    def test_the_hosted_run_is_named_once_github_lists_it_and_must_be_of_the_merge_commit(self):
        github = FakeGitHub(runs=[listed(77, self.merged, conclusion=None, status="in_progress"), listed(78, self.head)])
        self.trained(self.host(), self.train(self.merged, [self.head], hosted_run=77), self.merged, github)
        hosted = self.evidence_of("02-release")["record"]["measurements"]["train"]["hosted_run"]
        self.assertEqual((hosted["id"], hosted["head_sha"], hosted["status"]), (77, self.merged, "in_progress"),
                         "the deploy never waits for it")
        self.again()
        self.refused_train(self.train(self.merged, [self.head], hosted_run=78), self.merged, github,
                           "the hosted run 78 names %s as its head, not the merge commit %s" % (self.head, self.merged))

    def again(self):
        """A fresh evidence folder for the next case."""
        for path in self.evidence.glob("*.json"):
            path.unlink()

    def test_a_deploy_of_anything_but_the_merge_commit_is_refused(self):
        self.refused_train(self.train(self.merged, [self.head]), self.head, FakeGitHub(),
                           "the deploy was asked for %s, but the train's merge commit is %s" % (self.head, self.merged))

    def test_a_merge_commit_that_is_not_on_the_release_branch_is_refused(self):
        other = self.branch("item-482", self.L, [("aim_next/other.py", "# item 482\n")])
        aside = self.merge(other, onto="release/another")
        self.refused_train(self.train(aside, [other]), aside, FakeGitHub(),
                           "the merge commit %s is not on origin's %s" % (aside, BRANCH))
        # Merged but never pushed: the live checkout's origin does not have it on the branch either.
        self.again()
        unpushed = self.merge(self.branch("item-483", self.merged, [("aim_next/three.py", "# 483\n")]), push=False)
        self.refused_train(self.train(unpushed, [self.head]), unpushed, FakeGitHub(), "could not be read")

    def test_an_approved_head_the_merge_commit_does_not_contain_is_refused(self):
        stray = self.branch("item-484", self.L, [("aim_next/stray.py", "# never merged\n")])
        self.git(self.live, "fetch", "-q", str(self.work), "item-484")
        self.refused_train(self.train(self.merged, [self.head, stray]), self.merged, FakeGitHub(),
                           "item 482's approved head %s is not in the merge commit %s" % (stray, self.merged))

    def test_a_merged_tree_that_is_not_the_merge_commits_is_refused(self):
        self.refused_train(self.train(self.merged, [self.head], merged_tree=self.tree(self.L)), self.merged, FakeGitHub(),
                           "the merge commit's tree is %s, not the merged_tree %s" % (self.tree(self.merged), self.tree(self.L)))

    def test_a_read_that_fails_refuses(self):
        for config, github, words in (({"release_branch": "release/nowhere"}, FakeGitHub(), "origin's release/nowhere could not be read (git rev-parse"),
                                      ({"release_branch": BRANCH}, FakeGitHub(), "the run 79 could not be read: gh api repos/%s/actions/runs/79 exited 1" % REPOSITORY)):
            with self.subTest(words):
                self.again()
                self.raw.update(config)
                self.config_path.write_text(json.dumps(self.raw))
                self.config = deploy.load_config(self.config_path)
                self.refused_train(self.train(self.merged, [self.head], hosted_run=79), self.merged, github, words)
        self.again()
        # A merge commit git does not have is a failed read, not an answer.
        missing = "e" * 40
        self.refused_train(self.train(self.merged, [self.head], merge_commit=missing, merged_tree=missing), missing, FakeGitHub(),
                           "could not be read")

    def judged(self, git=None):
        """train.judge of the merged train against the live checkout's HEAD, with git run in the live checkout, or git."""
        live = self.git(self.live, "rev-parse", "HEAD")
        return deploy.train_check.judge(self.train(self.merged, [self.head]), self.merged, live, BRANCH, REPOSITORY,
                                        git or self.live_git, FakeGitHub())

    def live_git(self, *args):
        return subprocess.run(["git", "-C", str(self.live)] + list(args), capture_output=True, text=True)

    def test_an_ordinary_train_without_a_judgment_says_its_judgment_is_pending(self):
        self.assertEqual(self.judged()["judgment"], "pending")

    def test_paths_changed_from_the_live_commit_that_cannot_be_read_refuse_rather_than_reading_as_none(self):
        # Only the diff fails: every other read is the live checkout's real answer.
        def git(*args):
            if args[0] == "diff":
                return subprocess.CompletedProcess(args, 128, "", "fatal: bad object")
            return self.live_git(*args)
        with self.assertRaises(deploy.train_check.Refused) as refused:
            self.judged(git)
        self.assertIn("the paths changed from the live commit %s could not be read (git diff" % self.L[:12], str(refused.exception))

    def test_an_ordinary_train_that_changes_the_deploy_the_controller_or_a_migration_is_refused(self):
        for number, path in enumerate(("tools/deploy.py", ".github/workflows/checks.yml", "aim_next/migrations.py",
                                       "tools/known_reds.py", "tools/train.py")):
            with self.subTest(path):
                self.again()
                # The live checkout is at the branch's tip, so the train changes that one path from it.
                tip = self.git(self.live, "rev-parse", "origin/" + BRANCH)
                self.git(self.live, "merge", "-q", "--ff-only", tip)
                head = self.branch("guarded-%d" % number, tip, [(path, "# changed by %s\n" % path)])
                merged = self.merge(head)
                self.refused_train(self.train(merged, [head]), merged, FakeGitHub(),
                                   "an ordinary train cannot change %s: " % path)

    def test_an_ordinary_train_that_changes_only_other_paths_is_not_refused_for_them(self):
        # The negative: aim_next/releases.py, a test of the deploy and docs/tools.md are not the deploy tool's own code.
        tip = self.git(self.live, "rev-parse", "origin/" + BRANCH)
        self.git(self.live, "merge", "-q", "--ff-only", tip)
        head = self.branch("ordinary", tip, [("aim_next/releases.py", "# changed\n"), ("tests/test_tools_deploy.py", "# t\n"),
                                              ("docs/tools.md", "# d\n"), ("tools/native.py", "# n\n")])
        merged = self.merge(head)
        self.trained(self.host(releases=(deploys.page(deploys.release(19, tip)), 0)), self.train(merged, [head]), merged, FakeGitHub())
        self.assertEqual(self.evidence_of("00-train")["guarded_changes"], [])

    def test_a_train_needs_the_release_branch_and_repository_and_no_local_known_reds(self):
        del self.raw["release_branch"]
        self.config_path.write_text(json.dumps(self.raw))
        self.config = deploy.load_config(self.config_path)
        self.refused_train(self.train(self.merged, [self.head]), self.merged, FakeGitHub(), "names no release_branch and repository")

    def test_main_takes_a_train_in_place_of_a_release_check(self):
        with redirect_stderr(io.StringIO()) as err:
            with self.assertRaises(SystemExit):
                deploy.main(["--config", str(self.config_path), "--train", "/t.json", "--release-check", "/s.json", self.merged,
                             str(self.evidence)])
        self.assertIn("not allowed with argument", err.getvalue())
        with redirect_stderr(io.StringIO()) as err, redirect_stdout(io.StringIO()):
            code = deploy.main(["--config", str(self.config_path), "--train", "relative.json", self.merged, str(self.evidence)])
        self.assertEqual(code, 1)
        self.assertIn("refused: train: --train is an absolute path, not relative.json", err.getvalue())


class DeployRefusesJudgedFirst(TrainCase):
    """A train that changes the deploy tool: judged before the merge, on a parent with the merge commit's tree."""

    def setUp(self):
        super().setUp()
        self.head = self.branch("deploy-change", self.L, [("tools/deploy.py", "# the deploy, changed\n")])
        self.merged = self.merge(self.head)
        self.judgment = {"producer_runs": [101], "verdict_checks": [201, 202], "audit": "m-audit"}
        self.github = FakeGitHub(runs=[listed(101, self.head)],
                                 checks=[listed(201, self.head, conclusion="failure", name="App"), listed(202, self.head, name="Verdict")])

    def test_a_judged_first_train_with_its_completed_judgment_is_planned_with_each_conclusion_as_it_is(self):
        out = self.trained(self.host(), self.train(self.merged, [self.head], kind="judged-first", judgment=self.judgment),
                           self.merged, self.github)
        judgment = self.evidence_of("02-release")["record"]["measurements"]["train"]["judgment"]
        self.assertEqual(judgment["head"], self.head)
        self.assertEqual([(found["kind"], found["id"], found["conclusion"]) for found in judgment["producer_runs"] + judgment["verdict_checks"]],
                         [("run", 101, "success"), ("check", 201, "failure"), ("check", 202, "success")])
        self.assertEqual(judgment["audit"], "m-audit")
        self.assertIn("judged at %s: run 101 success, check 201 failure, check 202 success (audit m-audit)" % self.head[:12], out)

    def test_a_judged_first_train_without_its_judgment_is_refused(self):
        self.refused_train(self.train(self.merged, [self.head], kind="judged-first"), self.merged, self.github,
                           "a judged-first train comes with its judgment")

    def test_a_judgment_of_a_parent_whose_tree_differs_is_refused(self):
        # The release branch moved on after the pull request was judged: the merge commit's tree is no longer its head's.
        later = self.branch("later", self.L, [("README", "Theseus, later\n")])
        self.git(self.work, "push", "-q", "origin", "%s:refs/heads/%s" % (later, BRANCH), "--force")
        merged = self.merge(self.head)
        self.refused_train(self.train(merged, [self.head], kind="judged-first", judgment=self.judgment), merged, self.github,
                           "the judged parent %s has the tree %s, not the merge commit's %s" % (self.head, self.tree(self.head), self.tree(merged)))

    def test_a_run_or_check_naming_another_head_is_refused(self):
        # The merge commit itself is no judgment before the merge.
        github = FakeGitHub(runs=[listed(101, self.merged)], checks=[listed(201, self.merged), listed(202, self.merged)])
        self.refused_train(self.train(self.merged, [self.head], kind="judged-first", judgment=self.judgment), self.merged, github,
                           "which is not a parent of the merge commit %s" % self.merged)
        self.again()
        github = FakeGitHub(runs=[listed(101, self.head)], checks=[listed(201, self.head), listed(202, self.merged)])
        self.refused_train(self.train(self.merged, [self.head], kind="judged-first", judgment=self.judgment), self.merged, github,
                           "not one commit")

    def test_a_judgment_still_running_is_refused(self):
        github = FakeGitHub(runs=[listed(101, self.head, conclusion=None, status="in_progress")],
                            checks=[listed(201, self.head), listed(202, self.head)])
        self.refused_train(self.train(self.merged, [self.head], kind="judged-first", judgment=self.judgment), self.merged, github,
                           "the run 101 (Checks) is in_progress, not completed")

    def again(self):
        for path in self.evidence.glob("*.json"):
            path.unlink()


class TrainDeployed(Repositories, deploys.Restarting):
    """The whole deploy of an ordinary merged train: the live stand-ins stopped by their PIDs, the checkout fast-forwarded
    to the merge commit for real, stand-ins restarted and verified, and the release recorded with its judgment pending."""

    def setUp(self):
        super().setUp()
        self.raw.update(release_branch=BRANCH, repository=REPOSITORY)
        self.config_path.write_text(json.dumps(self.raw))
        self.config = deploy.load_config(self.config_path)
        self.repositories(self.config.live)
        self.head = self.branch("item-481", self.L, [("aim_next/work.py", "# item 481\n")])
        self.merged = self.merge(self.head)
        # The live server and runner are processes this test starts, named in their run records by their real PIDs,
        # so the deploy stops them as it stops live ones.
        self.live_server, self.live_runner = (subprocess.Popen([sys.executable, "-c", "import signal; signal.pause()"])
                                              for _ in range(2))
        self.addCleanup(self.reap, self.live_server)
        self.addCleanup(self.reap, self.live_runner)
        for name, proc in (("run-server-03", self.live_server), ("run-runner-02", self.live_runner)):
            (self.instance / name / "pid.json").write_text(json.dumps({"pid": proc.pid}))

    @staticmethod
    def reap(proc):
        if proc.poll() is None:
            proc.terminate()
        proc.wait()

    def test_an_ordinary_merged_train_deploys_and_its_record_says_the_judgment_is_pending(self):
        host = GitHost(self.config, servers=(self.live_server.pid,), runners=(self.live_runner.pid,),
                       releases=(deploys.page(deploys.release(19, self.L)), 0))
        real_start = deploy.start

        def start(*args):
            proc = real_start(*args)
            self.started.append(proc)
            return proc
        train = self.train(self.merged, [self.head])
        with mock.patch.object(deploy, "run", host), mock.patch.object(deploy, "start", start), redirect_stdout(io.StringIO()):
            try:
                deploy.deploy(self.config, self.merged, self.evidence, None, False, train=train, github=FakeGitHub())
            except deploy.Refused as refusal:
                self.fail("the deploy refused: %s" % refusal)
        self.assertEqual(self.git(self.live, "rev-parse", "HEAD"), self.merged, "the live checkout is at the merge commit")
        self.assertEqual((self.live_server.wait(), self.live_runner.wait()), (-15, -15), "each was stopped by its PID")
        [written] = host.written
        self.assertEqual((written["release"], written["commit"], written["items"]), (20, self.merged, [481]))
        self.assertEqual(written["measurements"]["train"]["judgment"], "pending")
        self.assertEqual(written["measurements"]["train"]["pr"], PR)
        self.assertNotIn("release_check", written["measurements"])
        self.assertEqual(self.records(), ["00-plan", "00-train", "01-live", "02-checkout", "02-release", "03-stopped",
                                          "04-backup", "05-fast-forward", "06-migrate", "07-server", "09-runner",
                                          "10-verify", "11-release", "release-20"], "the live-instance steps still run")


if __name__ == "__main__":
    unittest.main()
