from __future__ import annotations

"""Items 481 and 482, rule 1: a deploy takes a merged train in place of a local release check (docs/tools.md, "A merged
train"). Each fact the train names is read again from a real git repository with an origin, and from GitHub through a
typed stand-in for `gh api`; nothing here replaces the standard library."""

import ast
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import unittest
from contextlib import redirect_stdout, redirect_stderr
from unittest import mock

from tools import deploy, release_check
import test_tools_deploy as deploys

BRANCH, REPOSITORY, PR = "release/live73", "offcuts/theseus", 31


class FakeGitHub:
    """GitHub's REST answers from a table, by API path; a path it lacks is a read that failed, as gh's exit would be.
    With origin (a bare repository standing for GitHub's copy), compare/BASE...BRANCH answers as GitHub's compare API
    does, read from origin's own branch as it is now, whatever any clone last fetched."""

    def __init__(self, runs=(), checks=(), pulls=(), origin=None):
        self.answers, self.origin = {}, origin
        for found in pulls:
            self.answers["repos/%s/pulls/%d" % (REPOSITORY, found["number"])] = found
        for found in runs:
            self.answers["repos/%s/actions/runs/%d" % (REPOSITORY, found["id"])] = found
        for found in checks:
            self.answers["repos/%s/check-runs/%d" % (REPOSITORY, found["id"])] = found
        self.asked = []

    def get(self, path):
        self.asked.append(path)
        compared = re.fullmatch(r"repos/%s/compare/([0-9a-f]{40})\.\.\.(.+)" % re.escape(REPOSITORY), path)
        if compared and self.origin is not None:
            return self.compare(path, *compared.groups())
        if path not in self.answers:
            raise deploy.train_check.Unreadable("gh api %s exited 1: HTTP 404" % path)
        return self.answers[path]

    def compare(self, path, base, branch):
        """GitHub's compare of base with branch's tip: how far each is ahead of the other and their merge base; a 404
        when either is not in GitHub's copy."""
        def git(*args):
            return subprocess.run(["git", "-C", str(self.origin)] + list(args), capture_output=True, text=True)
        tip = git("rev-parse", "--verify", "-q", "refs/heads/%s^{commit}" % branch)
        if tip.returncode != 0 or git("cat-file", "-e", base + "^{commit}").returncode != 0:
            raise deploy.train_check.Unreadable("gh api %s exited 1: HTTP 404" % path)
        tip = tip.stdout.strip()
        ahead, behind = (int(git("rev-list", "--count", "%s..%s" % pair).stdout) for pair in ((base, tip), (tip, base)))
        status = ("identical" if not ahead and not behind else "ahead" if not behind else "behind" if not ahead
                  else "diverged")
        return {"status": status, "ahead_by": ahead, "behind_by": behind, "base_commit": {"sha": base},
                "merge_base_commit": {"sha": git("merge-base", base, tip).stdout.strip()}, "html_url": "https://x"}


def listed(number, head, conclusion="success", status="completed", name="Checks"):
    return {"id": number, "name": name, "head_sha": head, "status": status, "conclusion": conclusion, "html_url": "https://x"}


def pulled(merged, base, head, number=PR, merged_flag=True):
    """GitHub's pulls/N answer, the fields the deploy reads among others it ignores."""
    return {"number": number, "state": "closed", "merged": merged_flag, "merge_commit_sha": merged, "base": {"ref": base, "sha": "f" * 40},
            "head": {"ref": "item-481", "sha": head}, "html_url": "https://x"}


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
        # GitHub's pulls/N for the pull request this merge closed, as it answers once the merge lands.
        self.pull = pulled(merged, onto, head)
        return merged

    def hub(self, runs=(), checks=(), pull=None):
        """GitHub answering for runs, checks and the pull request the last merge closed (or pull)."""
        return FakeGitHub(runs, checks, pulls=[pull or self.pull], origin=self.origin)

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

    def deployed(self, host, train, sha, github, dry=True, known_reds=None):
        with redirect_stdout(io.StringIO()) as out:
            with mock.patch.object(deploy, "run", host), \
                    mock.patch.object(deploy, "start", side_effect=AssertionError("must not start a process")):
                deploy.deploy(self.config, sha, self.evidence, None, dry, train=train, github=github, known_reds=known_reds)
        return out.getvalue()

    def trained(self, host, train, sha, github, dry=True, known_reds=None):
        """The deploy takes the train: its output; a refusal fails the test."""
        try:
            return self.deployed(host, train, sha, github, dry, known_reds)
        except deploy.Refused as refusal:
            self.fail("the deploy refused the train: %s" % refusal)

    def refused_train(self, train, sha, github, words, known_reds=None):
        """Refused at 00-train, naming words, before any process is listed or anything is stopped."""
        host = self.host()
        try:
            self.deployed(host, train, sha, github, known_reds=known_reds)
        except deploy.Refused as refusal:
            self.assertIn("train: ", str(refusal))
            self.assertIn(words, str(refusal))
        except Exception as error:
            self.fail("the deploy did not refuse the train, it raised %r" % error)
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
        out = self.trained(self.host(), self.train(self.merged, [self.head]), self.merged, self.hub())
        self.assertIn("train: PR #31 (ordinary), merge commit %s on %s at GitHub; the hosted judgment is pending (PR #31)"
                      % (self.merged[:12], BRANCH), out)
        self.assertEqual(self.records(), ["00-plan", "00-train", "01-live", "02-checkout", "02-release", "release-20-measurements"])
        record = self.evidence_of("02-release")["record"]
        self.assertEqual((record["commit"], record["previous"], record["items"]), (self.merged, self.L, [481]))
        train = record["measurements"]["train"]
        self.assertEqual((train["pr"], train["kind"], train["merge_commit"], train["judgment"], train["hosted_run"]),
                         (PR, "ordinary", self.merged, "pending", None))
        self.assertEqual(train["items"], [{"item": 481, "approved_head": self.head, "review": "m-review-0"}])
        self.assertEqual(set(record["measurements"]), {"train", "full_measurements"}, "no count claims a local release check ran")
        self.assertEqual(set(self.complete_measurements(record)), {'train'})
        self.assertEqual(self.complete_measurements(record)['train']['judgment'], 'pending')

    def test_the_hosted_run_is_named_once_github_lists_it_and_must_be_of_the_merge_commit(self):
        github = self.hub(runs=[listed(77, self.merged, conclusion=None, status="in_progress"), listed(78, self.head)])
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
        self.refused_train(self.train(self.merged, [self.head]), self.head, self.hub(),
                           "the deploy was asked for %s, but the train's merge commit is %s" % (self.head, self.merged))

    def test_a_merge_commit_that_is_not_on_the_release_branch_is_refused(self):
        other = self.branch("item-482", self.L, [("aim_next/other.py", "# item 482\n")])
        aside = self.merge(other, onto="release/another")
        self.refused_train(self.train(aside, [other]), aside, self.hub(),
                           "the merge commit %s is not on %s at GitHub" % (aside, BRANCH))
        # Merged but never pushed: GitHub does not have it at all.
        self.again()
        unpushed = self.merge(self.branch("item-483", self.merged, [("aim_next/three.py", "# 483\n")]), push=False)
        self.refused_train(self.train(unpushed, [self.head]), unpushed, self.hub(), "could not be read")

    def test_a_release_branch_force_pushed_without_the_merge_is_refused_though_the_live_checkout_never_fetched_it(self):
        # The live checkout fetched the branch with the merge on it; then the branch was force-pushed back without it.
        # The live checkout's origin ref still says the merge is there; GitHub's branch does not.
        self.git(self.work, "push", "-q", "-f", "origin", "%s:refs/heads/%s" % (self.L, BRANCH))
        stale = self.git(self.live, "rev-parse", "refs/remotes/origin/" + BRANCH)
        self.assertEqual(stale, self.merged, "the live checkout has not fetched since the force-push")
        github = self.hub()
        self.refused_train(self.train(self.merged, [self.head]), self.merged, github,
                           "the merge commit %s is not on %s at GitHub (compared as 'behind'" % (self.merged, BRANCH))
        self.assertIn("repos/%s/compare/%s...%s" % (REPOSITORY, self.merged, BRANCH), github.asked)
        self.assertEqual(self.git(self.live, "rev-parse", "refs/remotes/origin/" + BRANCH), stale,
                         "the deploy reads GitHub; it does not fetch into the live checkout")

    def test_a_merge_commit_on_the_release_branch_at_github_is_taken_whatever_the_live_checkout_last_fetched(self):
        # The negative: the branch moved on past the merge on GitHub after the live checkout's last fetch; the merge is
        # still on it, so the deploy goes on.
        later = self.branch("item-485", self.merged, [("aim_next/later.py", "# 485\n")])
        self.git(self.work, "push", "-q", "origin", "%s:refs/heads/%s" % (later, BRANCH))
        self.assertEqual(self.git(self.live, "rev-parse", "refs/remotes/origin/" + BRANCH), self.merged)
        github = self.hub()
        self.trained(self.host(), self.train(self.merged, [self.head]), self.merged, github)
        self.assertIn("repos/%s/compare/%s...%s" % (REPOSITORY, self.merged, BRANCH), github.asked)

    def test_an_approved_head_the_merge_commit_does_not_contain_is_refused(self):
        stray = self.branch("item-484", self.L, [("aim_next/stray.py", "# never merged\n")])
        self.git(self.live, "fetch", "-q", str(self.work), "item-484")
        self.refused_train(self.train(self.merged, [self.head, stray]), self.merged, self.hub(),
                           "item 482's approved head %s is not in the merge commit %s" % (stray, self.merged))

    def test_a_merged_tree_that_is_not_the_merge_commits_is_refused(self):
        self.refused_train(self.train(self.merged, [self.head], merged_tree=self.tree(self.L)), self.merged, self.hub(),
                           "the merge commit's tree is %s, not the merged_tree %s" % (self.tree(self.merged), self.tree(self.L)))

    def test_a_read_that_fails_refuses(self):
        for config, github, words in (({"release_branch": "release/nowhere"}, self.hub(), "whether %s is on release/nowhere could not be read from GitHub: gh api repos/%s/compare/" % (self.merged, REPOSITORY)),
                                      ({"release_branch": BRANCH}, self.hub(), "the run 79 could not be read: gh api repos/%s/actions/runs/79 exited 1" % REPOSITORY)):
            with self.subTest(words):
                self.again()
                self.raw.update(config)
                self.config_path.write_text(json.dumps(self.raw))
                self.config = deploy.load_config(self.config_path)
                self.refused_train(self.train(self.merged, [self.head], hosted_run=79), self.merged, github, words)
        self.again()
        # A merge commit git does not have is a failed read, not an answer.
        missing = "e" * 40
        self.refused_train(self.train(self.merged, [self.head], merge_commit=missing, merged_tree=missing), missing, self.hub(),
                           "could not be read")

    def judged(self, git=None):
        """train.judge of the merged train against the live checkout's HEAD, with git run in the live checkout, or git."""
        live = self.git(self.live, "rev-parse", "HEAD")
        return deploy.train_check.judge(self.train(self.merged, [self.head]), self.merged, live, BRANCH, REPOSITORY,
                                        git or self.live_git, self.hub())

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
                                       "tools/known_reds.py", "tools/train.py", "tools/ci_input_reads.py",
                                       "tools/ci-input-reads.json", "tools/checks.py")):
            with self.subTest(path):
                self.again()
                # The live checkout is at the branch's tip, so the train changes that one path from it.
                tip = self.git(self.live, "rev-parse", "origin/" + BRANCH)
                self.git(self.live, "merge", "-q", "--ff-only", tip)
                head = self.branch("guarded-%d" % number, tip, [(path, "# changed by %s\n" % path)])
                merged = self.merge(head)
                self.refused_train(self.train(merged, [head]), merged, self.hub(),
                                   "an ordinary train cannot change %s: " % path)

    def test_an_ordinary_train_that_changes_only_other_paths_is_not_refused_for_them(self):
        # The negative: aim_next/releases.py, a test of the deploy and docs/tools.md are not the deploy tool's own code.
        tip = self.git(self.live, "rev-parse", "origin/" + BRANCH)
        self.git(self.live, "merge", "-q", "--ff-only", tip)
        head = self.branch("ordinary", tip, [("aim_next/releases.py", "# changed\n"), ("tests/test_tools_deploy.py", "# t\n"),
                                              ("docs/tools.md", "# d\n"), ("tools/native.py", "# n\n")])
        merged = self.merge(head)
        self.trained(self.host(releases=(deploys.page(deploys.release(19, tip)), 0)), self.train(merged, [head]), merged, self.hub())
        self.assertEqual(self.evidence_of("00-train")["guarded_changes"], [])

    def test_a_train_needs_the_release_branch_and_repository_and_no_local_known_reds(self):
        # A train has no local release check, so neither an outcome's measurement nor --known-reds, each of which reads
        # one, goes with it.
        self.refused_train(self.train(self.merged, [self.head]), self.merged, self.hub(),
                           "--known-reds stands for cases of a local release check's summary, not a merged train",
                           known_reds=Path(self.tmp.name) / "known-reds.json")
        self.again()
        self.raw.update(outcome="w1", reporter_profile="agent.profile.json")
        self.config_path.write_text(json.dumps(self.raw))
        self.config = deploy.load_config(self.config_path)
        self.refused_train(self.train(self.merged, [self.head]), self.merged, self.hub(),
                           "measuring w1 reads a release check's summary, which a merged train does not have")
        self.again()
        for key in ("outcome", "reporter_profile", "release_branch"):
            del self.raw[key]
        self.config_path.write_text(json.dumps(self.raw))
        self.config = deploy.load_config(self.config_path)
        self.refused_train(self.train(self.merged, [self.head]), self.merged, self.hub(), "names no release_branch and repository")

    def test_a_commit_that_is_not_the_pull_requests_own_merge_commit_is_refused(self):
        # A one-parent commit on top of the merge with the merge's message, adding a file nobody reviewed, on origin's
        # branch: what the train's record says of it holds in git, but it is not PR #31's merge.
        self.git(self.work, "checkout", "-q", "merging")
        self.write("aim_next/unreviewed.py", "# nobody reviewed this\n")
        self.git(self.work, "commit", "-q", "-m", "Merge pull request #%d\n\nPipeline: 481" % PR)
        lookalike = self.git(self.work, "rev-parse", "HEAD")
        self.git(self.work, "push", "-q", "origin", "HEAD:refs/heads/" + BRANCH)
        self.git(self.live, "fetch", "-q", "origin")
        real = pulled(self.merged, BRANCH, self.head)
        self.refused_train(self.train(lookalike, [self.head]), lookalike, self.hub(pull=real),
                           "%s has 1 parent, so it is not PR #%d's merge commit" % (lookalike, PR))
        # The branch's tip copied in after another pull request merged: a real merge, but not this pull request's.
        self.again()
        later_head = self.branch("item-482", lookalike, [("aim_next/later.py", "# 482\n")])
        later = self.merge(later_head)
        self.refused_train(self.train(later, [self.head]), later, self.hub(pull=real),
                           "GitHub names %r as PR #%d's merge commit (merged True), not %s" % (self.merged, PR, later))
        # The merge commit GitHub names, but a pull request it says is not merged, merged elsewhere, or of another head.
        for pull, words in ((pulled(later, BRANCH, later_head, merged_flag=False), "(merged False), not %s" % later),
                            (pulled(later, "release/another", later_head), "PR #%d was merged into 'release/another', not %s" % (PR, BRANCH)),
                            (pulled(later, BRANCH, self.head), "PR #%d's head is %r, not %s, the merge commit's second parent" % (PR, self.head, later_head))):
            with self.subTest(words):
                self.again()
                self.refused_train(self.train(later, [self.head]), later, self.hub(pull=pull), words)
        # An answer at pulls/31 that is another pull request's.
        self.again()
        github = self.hub(pull=pulled(later, BRANCH, later_head))
        github.answers["repos/%s/pulls/%d" % (REPOSITORY, PR)] = pulled(later, BRANCH, later_head, number=PR + 1)
        self.refused_train(self.train(later, [self.head]), later, github, "is not PR #%d" % PR)
        # GitHub could not be read for the pull request (its compare of the branch answers): not an answer.
        self.again()
        self.refused_train(self.train(later, [self.head]), later, FakeGitHub(origin=self.origin), "PR #%d could not be read: gh api repos/%s/pulls/%d exited 1"
                           % (PR, REPOSITORY, PR))

    def test_an_ordinary_train_over_an_undeployed_train_that_changed_the_deploy_is_refused(self):
        # A judged-first train changed tools/deploy.py and merged, but was never deployed; an ordinary train merges after
        # it. Deploying the ordinary train's merge ships the deploy change too, so its paths are read from the live commit.
        deploying = self.branch("deploy-change", self.merged, [("tools/deploy.py", "# the deploy, changed\n")])
        self.merge(deploying)
        after = self.branch("after", "origin/" + BRANCH, [("aim_next/after.py", "# after\n")])
        merged = self.merge(after)
        self.refused_train(self.train(merged, [after]), merged, self.hub(), "an ordinary train cannot change tools/deploy.py: ")
        self.assertEqual(self.git(self.work, "diff", "--name-only", merged + "^1", merged), "aim_next/after.py",
                         "the train's own merge changes only its own path")

    def test_an_ordinary_train_with_a_judgment_of_its_merge_commit_records_it_and_one_of_another_commit_is_refused(self):
        judgment = {"producer_runs": [101], "verdict_checks": [201], "audit": "m-audit"}
        github = self.hub(runs=[listed(101, self.merged)], checks=[listed(201, self.merged, conclusion="failure", name="Verdict")])
        out = self.trained(self.host(), self.train(self.merged, [self.head], judgment=judgment), self.merged, github)
        recorded = self.evidence_of("02-release")["record"]["measurements"]["train"]["judgment"]
        self.assertIsInstance(recorded, dict, "the train's judgment is recorded, not left %r" % recorded)
        self.assertEqual((recorded["head"], recorded["audit"]), (self.merged, "m-audit"))
        self.assertEqual([(found["kind"], found["id"], found["head_sha"], found["conclusion"])
                          for found in recorded["producer_runs"] + recorded["verdict_checks"]],
                         [("run", 101, self.merged, "success"), ("check", 201, self.merged, "failure")])
        self.assertIn("judged at %s: run 101 success, check 201 failure (audit m-audit)" % self.merged[:12], out)
        # The negative: a judgment of the live commit, or of the pull request's head, is not the merge commit's.
        for other in (self.L, self.head):
            with self.subTest(other=other):
                self.again()
                github = self.hub(runs=[listed(101, other)], checks=[listed(201, other)])
                self.refused_train(self.train(self.merged, [self.head], judgment=judgment), self.merged, github,
                                   "the run 101 (Checks) names %s as its head, not %s, the merge commit" % (other, self.merged))

    def test_a_live_checkout_that_moves_after_the_train_was_read_stops_the_deploy_before_anything_stops(self):
        # The live HEAD moves on to the pull request's head while the live processes are listed: still a fast-forward
        # to the merge commit, but not the commit the train's changes were read from.
        moved = self.head
        live = self.live

        class Moving(GitHost):
            def __call__(self, argv, **kw):
                if argv[:2] == ["ps", "-axo"]:
                    subprocess.run(["git", "-C", str(live), "checkout", "-q", "--detach", moved], check=True, capture_output=True)
                return GitHost.__call__(self, argv, **kw)
        host = Moving(self.config, releases=(deploys.page(deploys.release(19, self.L)), 0))
        try:
            self.deployed(host, self.train(self.merged, [self.head]), self.merged, self.hub())
        except deploy.Refused as refusal:
            self.assertIn("the live checkout is at %s now, not %s, which the train's changes were read from; nothing was stopped"
                          % (moved, self.L), str(refusal))
        else:
            self.fail("the deploy went on from a live checkout that moved")
        self.assertEqual((self.kills, self.records()), ([], ["00-plan", "00-train", "01-live", "02-checkout"]))

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
        self.github = self.hub(runs=[listed(101, self.head)],
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
        github = self.hub(runs=[listed(101, self.head)], checks=[listed(201, self.head, conclusion="failure", name="App"),
                                                                  listed(202, self.head, name="Verdict")])
        self.refused_train(self.train(merged, [self.head], kind="judged-first", judgment=self.judgment), merged, github,
                           "the judged parent %s has the tree %s, not the merge commit's %s" % (self.head, self.tree(self.head), self.tree(merged)))

    def test_a_run_or_check_naming_another_head_is_refused(self):
        # The merge commit itself is no judgment before the merge.
        github = self.hub(runs=[listed(101, self.merged)], checks=[listed(201, self.merged), listed(202, self.merged)])
        self.refused_train(self.train(self.merged, [self.head], kind="judged-first", judgment=self.judgment), self.merged, github,
                           "which is not a parent of the merge commit %s" % self.merged)
        self.again()
        github = self.hub(runs=[listed(101, self.head)], checks=[listed(201, self.head), listed(202, self.merged)])
        self.refused_train(self.train(self.merged, [self.head], kind="judged-first", judgment=self.judgment), self.merged, github,
                           "not one commit")

    def test_a_judgment_still_running_is_refused(self):
        github = self.hub(runs=[listed(101, self.head, conclusion=None, status="in_progress")],
                            checks=[listed(201, self.head), listed(202, self.head)])
        self.refused_train(self.train(self.merged, [self.head], kind="judged-first", judgment=self.judgment), self.merged, github,
                           "the run 101 (Checks) is in_progress, not completed")

    def again(self):
        for path in self.evidence.glob("*.json"):
            path.unlink()


class TrainRecordsStepsBeyondPolicy(TrainCase):
    """Item 553: a merged train never reaches the known reds' judge (it refuses --known-reds), and still its record names
    the required steps this release check runs that the live commit's policy does not review, for the next policy."""

    ADDED = "native-card-marks"

    def setUp(self):
        super().setUp()
        self.write(deploys.POLICY, json.dumps({"version": 1, "required": [name for name in release_check.REQUIRED
                                                                          if name != self.ADDED]}))
        self.L = self.commit("The live commit keeps a policy of one step fewer")
        self.git(self.work, "push", "-q", "origin", "HEAD:refs/heads/" + BRANCH)
        self.git(self.live, "fetch", "-q", "origin")
        self.git(self.live, "checkout", "-q", "-B", "live", self.L)
        self.head = self.branch("item-481", self.L, [("aim_next/work.py", "# item 481\n")])
        self.merged = self.merge(self.head)

    def test_a_merged_trains_record_names_the_steps_beyond_the_live_policy(self):
        out = self.trained(self.host(), self.train(self.merged, [self.head]), self.merged, self.hub())
        measured = self.evidence_of("02-release")["record"]["measurements"]
        self.assertEqual(measured.get("steps_beyond_policy"), [self.ADDED])
        self.assertEqual(set(measured), {"train", "steps_beyond_policy", "full_measurements"}, "still no count claims a local release check ran")
        full = self.complete_measurements(self.evidence_of('02-release')['record'])
        self.assertEqual(set(full), {'train', 'steps_beyond_policy'})
        self.assertEqual(full['steps_beyond_policy'], [self.ADDED])
        self.assertIn("the release check runs %s, which %s at %s did not review; the next policy covers it"
                      % (self.ADDED, deploys.POLICY, self.L[:12]), out)


class GuardedPaths(unittest.TestCase):
    """What an ordinary train may not change holds every tools/ module the deploy loads, however deeply (GitHub's
    classifier, which the known-reds matcher reuses, among them), and every file that classifier requires to equal the
    event base. Both are read from the code itself, so a module the deploy starts loading is guarded or this fails."""

    ROOT = Path(__file__).resolve().parents[1]

    def imports(self, path):
        """The tools/ modules path imports, at its top or inside a function."""
        found = set()
        for node in ast.walk(ast.parse((self.ROOT / path).read_text())):
            if isinstance(node, ast.ImportFrom) and node.module == "tools":
                found |= {"tools/%s.py" % alias.name for alias in node.names}
            elif isinstance(node, ast.ImportFrom) and (node.module or "").startswith("tools."):
                found.add(node.module.replace(".", "/") + ".py")
            elif isinstance(node, ast.ImportFrom) and node.module == "aim_next.judgment":
                found.add("aim_next/judgment.py")
            elif isinstance(node, ast.Import):
                found |= {alias.name.replace(".", "/") + ".py" for alias in node.names if alias.name.startswith("tools.")}
        return found

    def loaded(self, start):
        seen, todo = set(), [start]
        while todo:
            path = todo.pop()
            if path not in seen:
                seen.add(path)
                todo.extend(self.imports(path))
        return seen

    def pinned(self):
        """The files tools/ci_known_reds.py compares with the event base: the loop that says "validator differs"."""
        for node in ast.walk(ast.parse((self.ROOT / "tools/ci_known_reds.py").read_text())):
            if (isinstance(node, ast.For) and isinstance(node.iter, ast.Tuple)
                    and "validator differs from event base" in ast.dump(node)):
                return {element.value for element in node.iter.elts}
        self.fail("tools/ci_known_reds.py compares no files with the event base")

    def test_every_module_the_deploy_loads_and_every_file_github_pins_is_guarded(self):
        loaded, pinned = self.loaded("tools/deploy.py"), self.pinned()
        # What the reading itself must find, so an empty read cannot pass: the matcher the deploy loads through
        # known_reds, and the data file GitHub's classifier pins without importing it.
        self.assertTrue({"tools/ci_known_reds.py", "tools/ci_input_reads.py", "tools/checks.py", "tools/gauntlet_admission.py", "aim_next/judgment.py"} <= loaded, loaded)
        self.assertIn("tools/ci-input-reads.json", pinned)
        self.assertEqual(sorted(path for path in loaded | pinned if not deploy.train_check.guarded([path])), [])

    def test_the_service_its_tests_and_docs_are_not_guarded(self):
        # The negative: an ordinary train changes these.
        self.assertEqual(deploy.train_check.guarded(["aim_next/releases.py", "aim_next/admin.py", "tools/native.py",
                                                     "tests/test_tools_deploy.py", "docs/tools.md", "web/health.mjs"]), [])


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
                deploy.deploy(self.config, self.merged, self.evidence, None, False, train=train, github=self.hub())
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
                                          "10-verify", "11-release", "12-release-branch", "release-20", "release-20-measurements"], "the live-instance steps still run")
        self.assertEqual(self.complete_measurements(written)['train']['judgment'], 'pending')


if __name__ == "__main__":
    unittest.main()
