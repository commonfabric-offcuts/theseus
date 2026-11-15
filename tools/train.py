from __future__ import annotations

"""Items 481 and 482: how the deploy knows a merged train was checked, in place of a local release check.

tools/deploy.py --train FILE takes the record of a train that merged into the release branch. Everything it says
is read again from git, and from GitHub through `gh api` (read-only), before anything is stopped; the first fact
that does not hold, or cannot be read, refuses. docs/tools.md ("A merged train") is the contract.

FILE: {"pr": N, "merge_commit": SHA, "merged_tree": TREE, "kind": "ordinary" | "judged-first",
       "items": [{"item": N, "approved_head": SHA, "review": "message or round"}],
       "hosted_run": RUN_ID | null,
       "judgment": {"producer_runs": [RUN_ID], "verdict_checks": [CHECK_RUN_ID], "audit": "message id"} | null}

An ordinary train is judged on GitHub after its merge: its record says the hosted judgment is pending, and
tools/releases.py attach-judgment attaches it once it lands. A train that changes the deploy tool, the controller
or the service's data migrations is judged first: its judged run, of a parent of the merge commit with the same
tree, comes with the train, and each conclusion is recorded as it is, beside the audit that read it.
"""

import json
from pathlib import Path
import re
import subprocess
from typing import Protocol

KEYS = ("pr", "merge_commit", "items", "merged_tree", "kind", "hosted_run", "judgment")
ITEM_FIELDS = ("item", "approved_head", "review")
JUDGMENT_FIELDS = ("producer_runs", "verdict_checks", "audit")
KINDS = ("ordinary", "judged-first")
SHA = re.compile(r"[0-9a-f]{40}")
# What an ordinary train may not change, so that no train judges the code that judges it after the merge: the deploy
# tool (and the known-reds matcher it reads), the controller (.github/: the workflows and the policy they read) and
# the service's data migrations, every schema step of which is a row of aim_next/migrations.py's STEPS.
DEPLOY_TOOL = ("tools/deploy.py", "tools/release_check.py", "tools/known_reds.py", "tools/releases.py", "tools/train.py",
               "tools/ci_known_reds.py")
CONTROLLER = ".github/"
MIGRATIONS = ("aim_next/migrations.py",)
# GitHub's REST API paths for one workflow run and one check run.
RUN_PATH, CHECK_PATH = "repos/%s/actions/runs/%d", "repos/%s/check-runs/%d"
# What the record keeps of each run and check GitHub lists.
LISTED = ("id", "name", "head_sha", "status", "conclusion")


class Refused(Exception):
    """The train does not let the deploy go on; the message names the first fact that does not hold."""


class Unreadable(Exception):
    """GitHub could not be read: not the same as an answer."""


class GitHub(Protocol):
    def get(self, path: str) -> object:
        """The JSON GitHub's REST API answers for path, or Unreadable."""


class GhCli:
    """GitHub read through the gh CLI, GET only."""

    def __init__(self, gh="gh"):
        self.gh = gh

    def get(self, path):
        try:
            answer = subprocess.run([self.gh, "api", "-X", "GET", path], capture_output=True, text=True)
        except OSError as error:
            raise Unreadable("gh could not be run: %s" % error)
        if answer.returncode != 0:
            raise Unreadable("gh api %s exited %d: %s" % (path, answer.returncode, answer.stderr.strip()[:300]))
        try:
            return json.loads(answer.stdout)
        except ValueError as error:
            raise Unreadable("gh api %s answered something other than JSON: %s" % (path, error))


def _sha(value):
    return isinstance(value, str) and SHA.fullmatch(value) is not None


def _number(value):
    return type(value) is int and value > 0


def _words(value):
    return isinstance(value, str) and bool(value.strip())


def load(path):
    """The train file, or Refused naming what is wrong with it."""
    if not Path(path).is_absolute():
        raise Refused("--train is an absolute path, not %s" % path)
    try:
        train = json.loads(Path(path).read_text())
    except (OSError, ValueError) as error:
        raise Refused("no readable train at %s: %s" % (path, error))
    if not isinstance(train, dict) or set(train) != set(KEYS):
        raise Refused("the train is a JSON object with exactly %s" % ", ".join(KEYS))
    if not _number(train["pr"]):
        raise Refused("pr is the pull request's number, not %r" % (train["pr"],))
    for key in ("merge_commit", "merged_tree"):
        if not _sha(train[key]):
            raise Refused("%s is a full 40-character object name, not %r" % (key, train[key]))
    if train["kind"] not in KINDS:
        raise Refused("kind is %s, not %r" % (" or ".join(KINDS), train["kind"]))
    items = train["items"]
    if not isinstance(items, list) or not items:
        raise Refused("items lists at least one item")
    for item in items:
        if (not isinstance(item, dict) or set(item) != set(ITEM_FIELDS) or not _number(item["item"])
                or not _sha(item["approved_head"]) or not _words(item["review"])):
            raise Refused("each item is {item, approved_head, review}: a number, a full commit and the review that "
                          "approved it, not %r" % (item,))
    if train["hosted_run"] is not None and not _number(train["hosted_run"]):
        raise Refused("hosted_run is the merged head's run id, or null until GitHub lists it, not %r" % (train["hosted_run"],))
    judgment = train["judgment"]
    if judgment is not None:
        if not isinstance(judgment, dict) or set(judgment) != set(JUDGMENT_FIELDS):
            raise Refused("the judgment is null or a JSON object with exactly %s" % ", ".join(JUDGMENT_FIELDS))
        ids(judgment["producer_runs"], "producer_runs")
        ids(judgment["verdict_checks"], "verdict_checks")
        if not _words(judgment["audit"]):
            raise Refused("the judgment names its audit, the message that read it")
    return train


def ids(values, what):
    """values as a list of distinct GitHub ids, at least one, or Refused."""
    if not isinstance(values, list) or not values or not all(_number(value) for value in values) or len(set(values)) != len(values):
        raise Refused("%s lists at least one GitHub id, each once, not %r" % (what, values))
    return values


def _ask(git, what, *args):
    """git's answer, or Refused when it could not be read."""
    answer = git(*args)
    if answer.returncode != 0:
        raise Refused("%s could not be read (git %s exited %d): %s" % (what, " ".join(args), answer.returncode,
                                                                       answer.stderr.strip()[:300]))
    return answer.stdout


def _contains(git, older, newer, what):
    """Whether older is newer or one of its ancestors; Refused when git cannot say."""
    answer = git("merge-base", "--is-ancestor", older, newer)
    if answer.returncode not in (0, 1):
        raise Refused("whether %s could not be read (exit %d): %s" % (what, answer.returncode, answer.stderr.strip()[:300]))
    return answer.returncode == 0


def tree_of(git, commit):
    return _ask(git, "the tree of %s" % commit[:12], "rev-parse", "--verify", commit + "^{tree}").strip()


def guarded(paths):
    """The paths an ordinary train may not change (DEPLOY_TOOL, CONTROLLER, MIGRATIONS)."""
    return [path for path in paths if path in DEPLOY_TOOL or path in MIGRATIONS or path.startswith(CONTROLLER)]


def listed(github, repository, kind, number):
    """What GitHub lists for one workflow run ("run") or check run ("check"), or Refused when it cannot be read."""
    path = (RUN_PATH if kind == "run" else CHECK_PATH) % (repository, number)
    try:
        found = github.get(path)
    except Unreadable as error:
        raise Refused("the %s %d could not be read: %s" % ("run" if kind == "run" else "check", number, error))
    if not isinstance(found, dict) or found.get("id") != number or not _sha(found.get("head_sha")):
        raise Refused("GitHub's answer for %s names no head commit" % path)
    return dict({key: found.get(key) for key in LISTED}, kind=kind)


def judged(github, repository, judgment):
    """Each run and check of a judgment as GitHub lists it, every one completed, its conclusion as it is."""
    runs = [listed(github, repository, "run", number) for number in judgment["producer_runs"]]
    checks = [listed(github, repository, "check", number) for number in judgment["verdict_checks"]]
    for found in runs + checks:
        if found["status"] != "completed":
            raise Refused("the %s %d (%s) is %s, not completed; a judgment is attached once it has landed"
                          % (found["kind"], found["id"], found["name"], found["status"]))
    return runs, checks


def on_commit(github, repository, judgment, commit, whose):
    """The judgment of one commit: each run and check completed and naming that commit as its head, or Refused."""
    ids(judgment.get("producer_runs"), "producer_runs")
    ids(judgment.get("verdict_checks"), "verdict_checks")
    if not _words(judgment.get("audit")):
        raise Refused("the judgment names its audit, the message that read it")
    runs, checks = judged(github, repository, judgment)
    for found in runs + checks:
        if found["head_sha"] != commit:
            raise Refused("the %s %d (%s) names %s as its head, not %s, %s" % (
                found["kind"], found["id"], found["name"], found["head_sha"], commit, whose))
    return {"head": commit, "producer_runs": runs, "verdict_checks": checks, "audit": judgment["audit"]}


def judge(path, sha, live, release_branch, repository, git, github):
    """What the deploy records of a merged train, or Refused naming the first fact that does not hold.

    sha: the commit the deploy was asked for; live: the live checkout's HEAD; git(*args): git in the live checkout;
    github: a GitHub. Returns the train as the release record keeps it (docs/releases.md, `train`)."""
    train = load(path)
    merge = train["merge_commit"]
    if sha != merge:
        raise Refused("the deploy was asked for %s, but the train's merge commit is %s; the deploy ships the merge commit"
                      % (sha, merge))
    branch = "refs/remotes/origin/" + release_branch
    tip = _ask(git, "origin's %s" % release_branch, "rev-parse", "--verify", branch + "^{commit}").strip()
    if not _contains(git, merge, tip, "%s is on origin's %s" % (merge[:12], release_branch)):
        raise Refused("the merge commit %s is not on origin's %s (at %s)" % (merge, release_branch, tip))
    for item in train["items"]:
        if not _contains(git, item["approved_head"], merge, "item %d's approved head is in %s" % (item["item"], merge[:12])):
            raise Refused("item %d's approved head %s is not in the merge commit %s" % (item["item"], item["approved_head"], merge))
    tree = tree_of(git, merge)
    if tree != train["merged_tree"]:
        raise Refused("the merge commit's tree is %s, not the merged_tree %s" % (tree, train["merged_tree"]))
    hosted = None
    if train["hosted_run"] is not None:
        hosted = listed(github, repository, "run", train["hosted_run"])
        if hosted["head_sha"] != merge:
            raise Refused("the hosted run %d names %s as its head, not the merge commit %s"
                          % (hosted["id"], hosted["head_sha"], merge))
    changed = [name for name in _ask(git, "the paths changed from the live commit %s" % live[:12], "diff", "--name-only",
                                     "-z", live, merge).split("\0") if name]
    kept = guarded(changed)
    if train["kind"] == "ordinary":
        if kept:
            raise Refused("an ordinary train cannot change %s: the deploy tool, the controller and the data migrations keep "
                          "their judged run before the merge; make the train judged-first" % ", ".join(kept[:5]))
        judgment = "pending" if train["judgment"] is None else on_commit(
            github, repository, train["judgment"], merge, "the merge commit")
    else:
        if train["judgment"] is None:
            raise Refused("a judged-first train comes with its judgment: the runs and checks of its judged run, and the audit")
        judgment = before_merge(git, github, repository, train["judgment"], merge, tree)
    return {"file": str(path), "pr": train["pr"], "kind": train["kind"], "merge_commit": merge, "merged_tree": tree,
            "release_branch": release_branch, "live": live, "items": train["items"], "hosted_run": hosted,
            "guarded_changes": kept, "judgment": judgment}


def before_merge(git, github, repository, judgment, merge, tree):
    """A judged-first train's judgment: every run and check names one head, a parent of the merge commit whose tree
    is the merge commit's, and each conclusion is kept as it is."""
    runs, checks = judged(github, repository, judgment)
    heads = sorted({found["head_sha"] for found in runs + checks})
    if len(heads) != 1:
        raise Refused("the judgment's runs and checks name %s as their heads, not one commit" % ", ".join(heads))
    head = heads[0]
    parents = _ask(git, "the parents of %s" % merge[:12], "rev-list", "--parents", "-n", "1", merge).split()[1:]
    if head not in parents:
        raise Refused("the judgment's runs and checks name %s as their head, which is not a parent of the merge commit %s"
                      % (head, merge))
    judged_tree = tree_of(git, head)
    if judged_tree != tree:
        raise Refused("the judged parent %s has the tree %s, not the merge commit's %s" % (head, judged_tree, tree))
    return {"head": head, "producer_runs": runs, "verdict_checks": checks, "audit": judgment["audit"]}


def said(train):
    """One line for the deploy's output."""
    judgment = train["judgment"]
    if judgment == "pending":
        words = "the hosted judgment is pending (PR #%d); attach it with tools/releases.py attach-judgment" % train["pr"]
    else:
        conclusions = ", ".join("%s %d %s" % (found["kind"], found["id"], found["conclusion"])
                                for found in judgment["producer_runs"] + judgment["verdict_checks"])
        words = "judged at %s: %s (audit %s)" % (judgment["head"][:12], conclusions, judgment["audit"])
    return "train: PR #%d (%s), merge commit %s on origin's %s; %s" % (
        train["pr"], train["kind"], train["merge_commit"][:12], train["release_branch"], words)
