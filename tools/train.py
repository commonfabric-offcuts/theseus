from __future__ import annotations

"""Items 481 and 482: how the deploy knows a merged train was checked, in place of a local release check.

tools/deploy.py --train FILE takes the record of a train that merged into the release branch. Everything it says
is read again from git, and from GitHub through `gh api` (read-only), before anything is stopped; the first fact
that does not hold, or cannot be read, refuses. Whether the release branch holds the merge is GitHub's to say
(on_branch): a remote-tracking ref in the live checkout is only what its last fetch saw. merge_commit must be pull request pr's own merge commit, as git's
parents and GitHub's pulls/N say (pull_merge). docs/tools.md ("A merged train") is the contract.

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

from tools import base_move

KEYS = ("pr", "merge_commit", "items", "merged_tree", "kind", "hosted_run", "judgment")
ITEM_FIELDS = ("item", "approved_head", "review")
JUDGMENT_FIELDS = ("producer_runs", "verdict_checks", "audit")
KINDS = ("ordinary", "judged-first")
SHA = re.compile(r"[0-9a-f]{40}")
# What an ordinary train may not change, so that no train judges the code that judges it after the merge: the deploy
# tool with every tools/ module it loads (the known-reds matcher, GitHub's classifier it reuses and that classifier's
# input-read audit, the outcome checks), the files GitHub's classifier requires to equal the event base ("validator
# differs from event base"), the controller (.github/: the workflows and the policy they read) and the service's data
# migrations, every schema step of which is a row of aim_next/migrations.py's STEPS. tests/test_tools_train.py derives
# the first two from the code itself, so a module either starts loading is guarded here or that test fails.
DEPLOY_TOOL = ("tools/deploy.py", "tools/release_check.py", "tools/known_reds.py", "tools/releases.py", "tools/train.py",
               "tools/checks.py", "tools/ci_known_reds.py", "tools/ci_input_reads.py", "tools/ci-input-reads.json",
               "tools/quarantine.py", "tools/steps_for.py", "tools/base_move.py")
CONTROLLER = ".github/"
MIGRATIONS = ("aim_next/migrations.py",)
# GitHub's REST API paths for one workflow run, one check run and one pull request, and its compare of a commit with a
# branch's tip (repos/R/compare/BASE...HEAD).
RUN_PATH, CHECK_PATH, PULL_PATH = "repos/%s/actions/runs/%d", "repos/%s/check-runs/%d", "repos/%s/pulls/%d"
COMPARE_PATH = "repos/%s/compare/%s...%s"
# GitHub's compare statuses that say the branch's tip is the commit or follows it.
CONTAINED = ("identical", "ahead")
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
        train = base_move.loads(Path(path).read_text())
    except (OSError, ValueError, RecursionError, base_move.Refused) as error:
        raise Refused("no readable train at %s: %s" % (path, error))
    if not isinstance(train, dict) or set(train) not in (set(KEYS), set(KEYS) | {"base_move"}):
        raise Refused("the train is a JSON object with exactly %s, optionally base_move" % ", ".join(KEYS))
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
    if "base_move" in train:
        if train["kind"] != "judged-first":
            raise Refused("base_move is only for a judged-first train")
        try:
            base_move.fields(train["base_move"], "path sha256")
        except base_move.Refused as error:
            raise Refused(str(error))
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


def on_branch(github, repository, merge, release_branch):
    """Refused unless GitHub's release_branch, as GitHub holds it now, contains merge: its compare of merge with the
    branch's tip says the tip is merge or follows it, with merge as their merge base. A ref a clone last fetched is not
    read: a branch force-pushed since then would still seem to hold what it dropped."""
    path = COMPARE_PATH % (repository, merge, release_branch)
    try:
        compared = github.get(path)
    except Unreadable as error:
        raise Refused("whether %s is on %s could not be read from GitHub: %s" % (merge, release_branch, error))
    if not isinstance(compared, dict):
        raise Refused("GitHub's answer for %s is not a comparison" % path)
    status, base = compared.get("status"), (compared.get("merge_base_commit") or {}).get("sha")
    if status not in CONTAINED or compared.get("behind_by") != 0 or base != merge:
        raise Refused("the merge commit %s is not on %s at GitHub (compared as %r, %r behind, merge base %r)"
                      % (merge, release_branch, status, compared.get("behind_by"), base))


def parents_of(git, commit):
    return _ask(git, "the parents of %s" % commit[:12], "rev-list", "--parents", "-n", "1", commit).split()[1:]


def pull_merge(git, github, repository, number, merge, release_branch):
    """Refused unless merge is pull request number's own merge commit: a merge (two parents) whose second parent is
    the pull request's head, which GitHub's pulls/N names as merged into release_branch with merge as its
    merge_commit_sha. A commit that only says so in its message, or the branch's tip copied in, is not.
    Return the verified PR answer for the explicit base-move provenance chain."""
    parents = parents_of(git, merge)
    if len(parents) != 2:
        raise Refused("%s has %d parent%s, so it is not PR #%d's merge commit, which merges the pull request's head into "
                      "%s" % (merge, len(parents), "" if len(parents) == 1 else "s", number, release_branch))
    path = PULL_PATH % (repository, number)
    try:
        pull = github.get(path)
    except Unreadable as error:
        raise Refused("PR #%d could not be read: %s" % (number, error))
    if not isinstance(pull, dict) or pull.get("number") != number:
        raise Refused("GitHub's answer for %s is not PR #%d" % (path, number))
    if pull.get("merged") is not True or pull.get("merge_commit_sha") != merge:
        raise Refused("GitHub names %r as PR #%d's merge commit (merged %r), not %s"
                      % (pull.get("merge_commit_sha"), number, pull.get("merged"), merge))
    base, head = (pull.get("base") or {}).get("ref"), (pull.get("head") or {}).get("sha")
    if base != release_branch:
        raise Refused("PR #%d was merged into %r, not %s" % (number, base, release_branch))
    if head != parents[1]:
        raise Refused("PR #%d's head is %r, not %s, the merge commit's second parent" % (number, head, parents[1]))
    return pull


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
    on_branch(github, repository, merge, release_branch)
    for item in train["items"]:
        if not _contains(git, item["approved_head"], merge, "item %d's approved head is in %s" % (item["item"], merge[:12])):
            raise Refused("item %d's approved head %s is not in the merge commit %s" % (item["item"], item["approved_head"], merge))
    tree = tree_of(git, merge)
    if tree != train["merged_tree"]:
        raise Refused("the merge commit's tree is %s, not the merged_tree %s" % (tree, train["merged_tree"]))
    merged_pull = pull_merge(git, github, repository, train["pr"], merge, release_branch)
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
        if "base_move" in train:
            # The exception has a concrete evidence contract; the original guard
            # below remains the only path when no explicit record exists.
            runs, checks = judged(github, repository, train["judgment"])
            heads = {found["head_sha"] for found in runs + checks}
            if len(heads) != 1:
                raise Refused("the judgment's runs and checks do not name one commit")
            judgment = {"head": next(iter(heads)), "producer_runs": runs, "verdict_checks": checks,
                        "audit": train["judgment"]["audit"]}
            try:
                moved = base_move.validate(train["base_move"], judgment, git, github, repository, live, merge, train["items"],
                                           merged_pull, train["pr"], release_branch)
            except (base_move.Refused, Unreadable) as error:
                raise Refused(str(error))
        else:
            judgment = before_merge(git, github, repository, train["judgment"], merge, tree)
    result = {"file": str(path), "pr": train["pr"], "kind": train["kind"], "merge_commit": merge, "merged_tree": tree,
            "release_branch": release_branch, "live": live, "items": train["items"], "hosted_run": hosted,
            "guarded_changes": kept, "judgment": judgment}
    if "base_move" in train:
        result["base_move"] = moved
    return result


def before_merge(git, github, repository, judgment, merge, tree):
    """A judged-first train's judgment: every run and check names one head, a parent of the merge commit whose tree
    is the merge commit's, and each conclusion is kept as it is."""
    runs, checks = judged(github, repository, judgment)
    heads = sorted({found["head_sha"] for found in runs + checks})
    if len(heads) != 1:
        raise Refused("the judgment's runs and checks name %s as their heads, not one commit" % ", ".join(heads))
    head = heads[0]
    parents = parents_of(git, merge)
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
    if "base_move" in train:
        words += "; reviewed base move to %s (review %s)" % (train["base_move"]["assembly_head"][:12], train["base_move"]["review"]["sha256"])
    return "train: PR #%d (%s), merge commit %s on %s at GitHub; %s" % (
        train["pr"], train["kind"], train["merge_commit"][:12], train["release_branch"], words)
