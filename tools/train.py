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
import hashlib
import io
import tempfile
import zipfile
from collections import Counter
from pathlib import Path, PurePosixPath
import re
import subprocess
from typing import Protocol

from tools import base_move, ci_known_reds as ci, release_check, ci_input_reads

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
               "tools/quarantine.py", "tools/steps_for.py", "tools/base_move.py", "tools/own_case_receipt.py", "tools/continuation_envelope.py")
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
    if not isinstance(train, dict) or set(train) not in (set(KEYS), set(KEYS) | {"base_move"}, set(KEYS) | {"scoped"},
                                                       set(KEYS) | {"source_carry"}):
        if isinstance(train, dict) and 'source_carry' in train:
            raise Refused('source_carry is mutually exclusive with base_move and scoped')
        raise Refused("the train is a JSON object with exactly %s, optionally base_move or scoped (mutually exclusive)" % ", ".join(KEYS))
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
    if 'scoped' in train:
        if train['kind'] != 'judged-first' or judgment is None:
            raise Refused('scoped evidence requires a judged-first judgment')
        try:
            fields(train['scoped'], 'path sha256')
        except ScopedRefused as error:
            raise Refused(str(error))
    if 'source_carry' in train:
        if train['kind'] != 'judged-first' or judgment is None:
            raise Refused('source_carry evidence requires a judged-first judgment')
        try:
            base_move.fields(train['source_carry'], 'path sha256')
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
        if 'source_carry' in train:
            runs, checks = judged(github, repository, train['judgment'])
            judgment = {'head': CARRY_752_HEAD, 'producer_runs': runs, 'verdict_checks': checks,
                        'audit': train['judgment']['audit']}
            judgment['source_carry'] = validate_source_carry(
                train['source_carry'], judgment, git, github, repository, live, merge, train['items'],
                merged_pull, train['pr'], release_branch)
            carry_require(judgment['source_carry']['context'] == 'merged', 'test-merge proof is not deploy admission')
        elif "base_move" in train:
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
            if 'scoped' in train:
                try:
                    scoped = validate_scoped(train['scoped'], judgment, git, github, repository,
                                             live, merge, train['items'], train['pr'])
                except (ScopedRefused, Unreadable) as error:
                    raise Refused(str(error))
    result = {"file": str(path), "pr": train["pr"], "kind": train["kind"], "merge_commit": merge, "merged_tree": tree,
            "release_branch": release_branch, "live": live, "items": train["items"], "hosted_run": hosted,
            "guarded_changes": kept, "judgment": judgment}
    if "base_move" in train:
        result["base_move"] = moved
    if "scoped" in train:
        result["scoped"] = scoped
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


class ScopedRefused(Exception):
    pass


def require(ok, why):
    if not ok:
        raise ScopedRefused('scoped: ' + why)


def pairs(rows):
    result = {}
    for key, value in rows:
        require(key not in result, 'duplicate field ' + key)
        result[key] = value
    return result


def loads(data):
    return json.loads(data, object_pairs_hook=pairs,
                      parse_constant=lambda value: require(False, 'invalid JSON constant ' + value))


def fields(value, names):
    require(isinstance(value, dict) and set(value) == set(names.split()), 'invalid fields: expected ' + names)
    return value


def sha(value, size=40):
    require(isinstance(value, str) and re.fullmatch('[0-9a-f]{%d}' % size, value), 'invalid object digest')
    return value


def words(value):
    require(isinstance(value, str) and bool(value.strip()), 'missing review attribution')


def number(value):
    require(type(value) is int and value > 0, 'invalid positive number')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def artifact(ref):
    fields(ref, 'path sha256')
    sha(ref['sha256'], 64)
    require(isinstance(ref['path'], str) and Path(ref['path']).is_absolute(), 'artifact path must be absolute')
    try:
        data = Path(ref['path']).read_bytes()
    except OSError as error:
        raise ScopedRefused('scoped: unreadable artifact: %s' % error)
    require(digest(data) == ref['sha256'], 'artifact digest differs: ' + ref['path'])
    return data


def document(ref):
    return loads(artifact(ref))


def ask(git, *args):
    result = git(*args)
    require(result.returncode == 0, 'git facts unreadable: ' + ' '.join(args))
    return result.stdout


def ancestor(git, older, newer):
    require(git('merge-base', '--is-ancestor', older, newer).returncode == 0, 'unrelated heads or bases')


def entries(git, head):
    rows = ask(git, 'ls-tree', '-r', '-z', '--full-tree', head).split('\0')
    return {row.split('\t', 1)[1]: row.split('\t', 1)[0] for row in rows if row}


def tree(git, head):
    return ask(git, 'rev-parse', '--verify', head + '^{tree}').strip()


def parents(git, head):
    return ask(git, 'rev-list', '--parents', '-n', '1', head).split()[1:]

def safe_path(path):
    require(isinstance(path, str) and bool(path) and not PurePosixPath(path).is_absolute()
            and all(part not in ('', '.', '..', '.git') for part in path.split('/')),
            'unsafe source artifact path')


# The existing App identity, read independently from GitHub; never supplied by
# an untrusted manifest as an override.
VERDICT_APP = {'id': 5763648, 'slug': 'theseus-verdict'}


def base_fact(value):
    fields(value, 'ref sha'); sha(value['sha'])
    ref = value['ref']
    # Short branch syntax, matching git check-ref-format --branch restrictions.
    require(isinstance(ref, str) and bool(ref) and not ref.startswith(('-', 'refs/'))
            and ref != '@' and not any(c in ref for c in ('..', '@{', '//'))
            and not re.search(r'[\x00-\x20\x7f~^:?*\[\\]', ref)
            and not ref.endswith('.') and all(part and not part.startswith('.')
                and not part.endswith('.lock') for part in ref.split('/')), 'invalid base ref')
    return value

def controller_archive(ref, github, repository, controller, name):
    fields(ref, 'id archive'); number(ref['id'])
    raw = artifact(ref['archive'])
    meta = github.get('repos/%s/actions/artifacts/%d' % (repository, ref['id']))
    require(meta.get('id') == ref['id'] and meta.get('name') == name
            and meta.get('digest') == 'sha256:' + digest(raw)
            and meta.get('workflow_run', {}).get('id') == controller['id']
            and meta['workflow_run'].get('head_sha') == controller['head_sha'], 'controller artifact provenance differs')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)), 'duplicate controller artifact member')
        return {name: archive.read(name) for name in names}


def controller_binding(source, judgment, github, repository, head):
    data = fields(source['controller'], 'run attempt current_base verdict_artifact published_artifact')
    current = base_fact(data['current_base'])
    original = base_fact(source.get('base_at_run'))
    require(source['tested_merge']['first_parent'] == original['sha']
            and source['tested_merge']['second_parent'] == head, 'controller original merge binding differs')
    number(data['run']); number(data['attempt'])
    require(data['run'] != source['run'], 'controller is not a separate run')
    run = github.get('repos/%s/actions/runs/%d' % (repository, data['run']))
    require(run.get('id') == data['run'] and run.get('run_attempt') == data['attempt']
            and run.get('name') == 'Verdict' and run.get('path') == '.github/workflows/verdict.yml'
            and run.get('event') == 'workflow_run' and run.get('status') == 'completed'
            and run.get('conclusion') in ('success', 'failure'), 'controller run identity differs')
    sha(run['head_sha'])
    suffix = '%d-%d-c%d' % (source['run'], source['attempt'], data['attempt'])
    verdict = controller_archive(data['verdict_artifact'], github, repository, run, 'verdict-' + suffix)
    published = controller_archive(data['published_artifact'], github, repository, run, 'published-' + suffix)
    binding = loads(verdict['producer.json']); check = loads(verdict['check-run.json'])
    pub = loads(published['published.json'])
    producer, controller = binding['producer'], binding['controller']
    ci.same_run({'id': producer.get('run_id'), 'attempt': producer.get('run_attempt')},
                {'id': source['run'], 'attempt': source['attempt']})
    require(producer.get('head_sha') == head and producer.get('head_repository') == repository
            and producer.get('event') == 'pull_request' and producer.get('workflow_name') == 'Checks'
            and producer.get('workflow_path') == '.github/workflows/checks.yml'
            and producer.get('conclusion') == judgment['producer_runs'][0]['conclusion'], 'controller producer binding differs')
    pr = producer['pull_request']
    require(pr.get('head_sha') == head and pr.get('base_sha') == current['sha']
            and pr.get('base_ref') == current['ref'], 'controller current PR binding differs')
    number(pr['number'])
    url = 'https://github.com/%s/actions/runs/%d' % (repository, data['run'])
    ci.same_run({'id': controller.get('run_id'), 'attempt': controller.get('run_attempt')},
                {'id': data['run'], 'attempt': data['attempt']})
    require(controller.get('repository') == repository and controller.get('url') == url
            and controller.get('sha') == controller.get('workflow_sha') == run['head_sha']
            and controller.get('ref') == 'refs/heads/' + run['head_branch']
            and controller.get('workflow_ref') == repository + '/.github/workflows/verdict.yml@' + controller['ref'],
            'protected controller identity differs')
    require(len(judgment['verdict_checks']) == 1, 'need exact published Verdict check')
    listed = judgment['verdict_checks'][0]
    raw = github.get('repos/%s/check-runs/%d' % (repository, listed['id']))
    prs = raw.get('pull_requests')
    require(isinstance(prs, list) and len(prs) == 1 and prs[0].get('number') == pr['number']
            and prs[0].get('head', {}).get('sha') == head
            and prs[0].get('base', {}).get('ref') == current['ref']
            and prs[0].get('base', {}).get('sha') == current['sha'], 'archived check current PR binding differs')
    external = '%d-%d' % (source['run'], source['attempt'])
    # The early, unretargeted receipt publishes an empty base, not a guessed
    # original ref. Both PR records above still bind its complete base facts.
    retargeted = current != original
    name = 'Verdict for ' + current['ref'] if retargeted else 'Verdict'
    published_base = current['ref'] if retargeted else ''
    require(pub.get('check_run_id') == listed['id'] == raw.get('id')
            and pub.get('head_sha') == head and pub.get('name') == name and pub.get('base') == published_base
            and pub.get('external_id') == external, 'published Verdict binding differs')
    for key, expected in (('controller_run', data['run']), ('controller_attempt', data['attempt']),
                          ('producer_run', source['run']), ('producer_attempt', source['attempt'])):
        require(str(pub.get(key)) == str(expected), 'published attempt binding differs')
    require(raw.get('app', {}).get('id') == VERDICT_APP['id']
            and raw.get('app', {}).get('slug') == VERDICT_APP['slug'], 'untrusted Verdict App')
    expected = {'name': name, 'head_sha': head, 'status': 'completed',
                'conclusion': listed['conclusion'], 'details_url': url, 'external_id': external}
    require(listed['conclusion'] in ('success', 'failure') and all(
        raw.get(k) == check.get(k) == v for k, v in expected.items()), 'source check binding differs')
    output = check['output']; api_output = raw.get('output') or {}
    summary = output['summary']
    appended = '\nPublished by controller run %d attempt %d.' % (data['run'], data['attempt'])
    require(api_output.get('title') == output.get('title')
            and api_output.get('summary') in (summary, summary + appended), 'Verdict output differs')
    refusal = verdict['refusals'].decode()
    if refusal.strip():
        require(output.get('title') == 'refused' and check['conclusion'] == 'failure'
                and summary.startswith('Refused:\n' + ''.join('- ' + line + '\n' for line in refusal.splitlines())),
                'Verdict refusal ground differs')
    return {'run': data['run'], 'attempt': data['attempt'], 'head': run['head_sha'],
            'check': listed['id'], 'current_base': current, 'output': output, 'refusals': refusal,
            'producer': {'head_ref': producer['head_branch'], 'pr': pr['number']}}



def archive_members(row, run, github, repository):
    fields(row, 'id name archive'); number(row['id'])
    raw = artifact(row['archive'])
    meta = github.get('repos/%s/actions/artifacts/%d' % (repository, row['id']))
    require(meta.get('id') == row['id'] and meta.get('name') == row['name']
            and meta.get('digest') == 'sha256:' + digest(raw)
            and meta.get('workflow_run', {}).get('id') == run['id']
            and meta['workflow_run'].get('head_sha') == run['head_sha'], 'artifact API provenance differs')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        result = {}
        for name in archive.namelist():
            if name.endswith('/'):
                continue
            safe_path(name)
            require(name not in result, 'duplicate artifact member')
            result[name] = archive.read(name)
        return result


def raw_run(data, judgment, git, github, repository, head, scope):
    source = fields(data, 'run attempt tested_merge base_at_run workflow_head archives inventory audit controller')
    number(source['run']); number(source['attempt']); sha(source['workflow_head'])
    require(source['attempt'] == 1, 'producer retries require a fresh run')
    merge = fields(source['tested_merge'], 'sha tree first_parent second_parent')
    for value in merge.values():
        sha(value)
    base_fact(source['base_at_run'])
    require(source['base_at_run']['sha'] == scope['live'] and merge['first_parent'] == scope['live']
            and merge['second_parent'] == head and parents(git, merge['sha']) == [scope['live'], head]
            and tree(git, merge['sha']) == scope['tree'], 'tested merge/source/base differs')
    require([r['id'] for r in judgment['producer_runs']] == [source['run']], 'producer run differs')
    run = github.get('repos/%s/actions/runs/%d' % (repository, source['run']))
    require(run.get('id') == source['run'] and run.get('run_attempt') == source['attempt']
            and run.get('head_sha') == head and run.get('event') == 'pull_request'
            and run.get('name') == 'Checks' and run.get('path') == '.github/workflows/checks.yml'
            and run.get('status') == 'completed' and run.get('conclusion') == 'success'
            and judgment['producer_runs'][0]['conclusion'] == 'success', 'producer API identity or green differs')
    number(run.get('workflow_id'))
    registered = github.get('repos/%s/actions/workflows/%d' % (repository, run['workflow_id']))
    require(registered.get('id') == run['workflow_id'] and registered.get('path') == '.github/workflows/checks.yml',
            'unregistered producer workflow')
    require(source['workflow_head'] in (head, merge['sha']), 'unbound PR workflow head')
    controller = controller_binding(source, judgment, github, repository, head)
    require(controller['current_base'] == source['base_at_run'] and not controller['refusals'].strip()
            and judgment['verdict_checks'][0]['conclusion'] == 'success', 'controller refusal or stale base')
    prs = run.get('pull_requests')
    require(isinstance(prs, list) and len([p for p in prs if p.get('number') == controller['producer']['pr']
            and p.get('head', {}).get('sha') == head and p.get('base', {}).get('sha') == source['base_at_run']['sha']
            and p.get('base', {}).get('ref') == source['base_at_run']['ref']]) == 1, 'producer API PR/base/head differs')
    inventory = document(source['inventory'])
    require(set(inventory) == set(scope['selected']), 'raw step inventory differs from computed coverage')
    for name, rows in inventory.items():
        if name == 'wake-replay':
            continue
        require(isinstance(rows, list) and bool(rows), 'empty raw case inventory')
        for row in rows:
            fields(row, 'name phase engine expectedFailure')
            require(type(row['expectedFailure']) is bool and isinstance(row['name'], str) and bool(row['name']), 'invalid raw case identity')
        require(len({ci.key(row) for row in rows}) == len(rows), 'duplicate raw case inventory')
    audit = fields(document(source['audit']), 'version reviewer record source_head scope_sha256 source_sha256 inventory')
    require(audit['version'] == 2 and audit['record'] == judgment['audit'] and audit['source_head'] == head
            and audit['scope_sha256'] == digest(canonical(scope)) and audit['inventory'] == source['inventory']
            and audit['source_sha256'] == digest(canonical({k: v for k, v in source.items() if k != 'audit'})),
            'independent audit/source binding differs')
    words(audit['reviewer']); words(audit['record'])
    archives = source['archives']
    require(isinstance(archives, list) and bool(archives) and len({r['id'] for r in archives}) == len(archives),
            'missing or duplicate archives')
    members = {}
    for row in archives:
        require(row['name'] not in members, 'duplicate archive name')
        members[row['name']] = archive_members(row, run, github, repository)
    require('release-check' in members, 'missing aggregate archive')
    combined = loads(members['release-check']['summary.json'])
    provenance = loads(members['release-check']['provenance.json'])
    expected_run = {'id': source['run'], 'attempt': source['attempt'], 'repository': repository,
                    'workflow': 'Checks', 'event': 'pull_request', 'workflow_sha': source['workflow_head'],
                    'workflow_ref': repository + '/.github/workflows/checks.yml@refs/pull/%d/merge' % controller['producer']['pr']}
    ci.same_run(provenance['run'], expected_run)
    require(provenance.get('merge') == merge and provenance.get('base') == source['base_at_run']
            and provenance.get('base_at_run') == source['base_at_run']
            and provenance.get('head') == {'ref': controller['producer']['head_ref'], 'sha': head}
            and provenance.get('checked') == {'commit': merge['sha'], 'tree_unchanged': True}, 'aggregate provenance differs')
    require(combined.get('tool') == release_check.TOOL and combined.get('commit') == merge['sha']
            and combined.get('tree_unchanged') is True and combined.get('tree_after') == {'head': merge['sha'], 'changes': ''}
            and not combined.get('only') and not combined.get('skipped') and combined.get('passed') is True
            and not combined.get('failed') and not combined.get('missing') and not combined.get('missing_jobs')
            and not combined.get('cancelled_shards'), 'dirty, partial or red aggregate')
    # Planning used the tested merge; compare its exact tree with the source,
    # retaining its separate commit identity in the record.
    expected_scope = dict(scope, source=merge['sha'])
    require(combined.get('scoped') == expected_scope, 'aggregate coverage differs')
    require(Counter(combined.get('required', [])) == Counter(scope['required'])
            and Counter(provenance.get('required', [])) == Counter(scope['required']), 'aggregate required inventory differs')
    selected = scope['selected']; plan = ci.plan_steps(provenance['plan'])
    # Python partitions are permitted only with the existing complete partition
    # combiner; the raw inventory below still requires every case exactly once.
    require(set(s for job in plan for s in job) == set(selected), 'shard plan coverage differs')
    by_name = {s['name']: s for s in combined['steps']}
    require(Counter(s['name'] for s in combined['steps']) == Counter(selected), 'aggregate step coverage differs')
    entries = provenance['shards']
    names = [s['artifact'] for s in entries]
    require(Counter(names) == Counter('check-%d' % i for i in range(len(plan)))
            and set(members) == set(names) | {'release-check'}
            and Counter(combined.get('combined_from', [])) == Counter(n + '/summary.json' for n in names),
            'archive/shard inventory differs')
    ran, unit_rows, raw_steps = [], {s: [] for s in ci.UNITS}, []
    docs, receipts = [], []
    source_bytes = ci_input_reads.source_files(ask(git, 'rev-parse', '--show-toplevel').strip(), merge['sha'])
    with tempfile.TemporaryDirectory(prefix='scoped-raw-') as temporary:
        for entry in entries:
            name = entry['artifact']; content = members[name]; out = Path(temporary) / name
            for path, raw in content.items():
                target = out / path; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(raw)
                if path.endswith('.json'):
                    loads(raw)
            receipt, raw = loads(content['run.json']), loads(content['summary.json'])
            docs.append(raw); receipts.append(receipt)
            ci.same_run(receipt.get('run'), expected_run)
            require(entry.get('receipt') == receipt and not entry.get('refused')
                    and receipt.get('merge') == merge and receipt.get('base') == source['base_at_run']
                    and receipt.get('base_at_run') == source['base_at_run'] and receipt.get('head') == provenance['head']
                    and receipt.get('summary_sha256') == digest(content['summary.json']), 'shard identity/digest differs')
            names_here = [s['name'] for s in raw['steps']]
            assigned = receipt['shard']['steps']; assigned = assigned.split(',') if isinstance(assigned, str) else assigned
            require(names_here == assigned == plan[int(name.split('-')[1])]
                    and raw.get('only') == names_here and not raw.get('skipped') and not raw.get('scoped')
                    and raw.get('tool') == release_check.TOOL and raw.get('commit') == merge['sha']
                    and raw.get('tree_unchanged') is True and raw.get('tree_after') == combined['tree_after']
                    and Counter(raw.get('required', [])) == Counter(combined['required']) and raw.get('passed') is True
                    and entry.get('commit') == merge['sha'] and entry.get('tree_unchanged') is True
                    and entry.get('steps') == names_here and entry.get('tools') == raw.get('tools'), 'dirty or partial shard')
            tools = raw['tools']
            require(tools.get('release_check') == ask(git, 'rev-parse', merge['sha'] + ':tools/release_check.py').strip(), 'tool source differs')
            for path in release_check.harnesses():
                require(tools.get('harnesses', {}).get(path) == ask(git, 'rev-parse', merge['sha'] + ':' + path).strip(), 'harness source differs')
            for step in raw['steps']:
                step_name = step['name']; ran.append(step_name)
                require(step.get('passed') is True and type(step.get('exit')) is int and step['exit'] == 0
                        and not step.get('quarantine'), 'raw red or waived step')
                if step_name in ci.NATIVE:
                    require(release_check.ran_whole(step), 'partial native step')
                    rows = ci.cases(step, out, inventory[step_name])
                    report = loads(content['native/' + ci.NATIVE[step_name].name + '/' + ci.NATIVE[step_name].results])
                    require(not report.get('teardown') and not report.get('fixtureErrors')
                            and not report.get('instrumentError') and all(not r.get('instrumentError') for r in rows), 'native teardown/infrastructure failure')
                    require(not report.get('left') and not report.get('pageErrors')
                            and all(m.get('caught') is True for m in report.get('mutations', [])), 'native cleanup or mutation failure')
                    for hashes in (report.get('hashes', {}), report.get('sourceHashes', {})):
                        require(isinstance(hashes, dict), 'invalid native input hashes')
                        for path, value in hashes.items():
                            safe_path(path)
                            require(path in source_bytes and value == digest(source_bytes[path]), 'native input hash differs')
                    require(step == by_name[step_name], 'aggregate native step differs')
                elif step_name in ci.UNITS:
                    text = (out / (step_name + '.log')).read_text()
                    rows = ci.unit_records(text, node=step_name == 'node-units')
                    scoped_unit_evidence(step, out, [r for r, _ in rows],
                                         provenance['plan'][int(name.split('-')[1])], raw, receipt)
                    unit_rows[step_name].extend(r for r, _ in rows)
                elif step_name == 'wake-replay':
                    traffic = loads(ask(git, 'show', merge['sha'] + ':' + release_check.REPLAY_FILE))
                    require(ci.unique(inventory[step_name].get('routed'), 'reviewed replay actors') ==
                            ci.unique(traffic.get('routed'), 'source replay actors'), 'replay inventory differs')
                    ci.replay_evidence(step, out, traffic)
                    require(step == by_name[step_name], 'aggregate replay differs')
                raw_steps.append({'name': step_name, 'archive': name, 'summary_sha256': digest(content['summary.json']),
                                  'passed': step['passed'], 'exit': step['exit'], 'counts': step.get('counts')})
        folded, _, _, missing_jobs, _ = combine_scoped_units(docs, provenance['plan'], receipts)
        require(not missing_jobs and {s['name']: s for s in folded} == by_name, 'raw/combined results or partitions differ')
        partitions = [job for job in provenance['plan'] if job.get('python_shard')]
        if partitions:
            actual_files = ci_input_reads.python_files(ci_input_reads.source_files(
                root=ask(git, 'rev-parse', '--show-toplevel').strip(), head=merge['sha']))
            planned_files = [p for job in partitions for p in job['files']]
            require(Counter(planned_files) == Counter(actual_files), 'Python partition source inventory differs')
        require(set(ran) == set(selected) and all(ran.count(s) == 1 for s in selected if s != 'python-units'), 'actual coverage differs')
        for name, rows in unit_rows.items():
            require(Counter(ci.key(r) for r in rows) == Counter(ci.key(r) for r in inventory[name])
                    and len({ci.key(r) for r in rows}) == len(rows), 'unit case inventory differs')
    return {'controller': controller, 'producer': {k: run[k] for k in ('id', 'head_sha', 'run_attempt', 'conclusion')},
            'workflow_head': source['workflow_head'], 'tested_merge': merge, 'steps': raw_steps,
            'inventory': source['inventory'], 'audit': source['audit']}


def validate_scoped(ref, judgment, git, github, repository, live, merge, items, pr):
    try:
        data = fields(document(ref), 'version live_base source_head scope source')
        require(data['version'] == 2 and data['live_base'] == live, 'stale live base or unknown scope version')
        head = data['source_head']; sha(head)
        require(judgment['head'] == head and parents(git, merge) == [live, head]
                and tree(git, merge) == tree(git, head), 'release source/tree/parents differs')
        root = ask(git, 'rev-parse', '--show-toplevel').strip()
        scope = ci_input_reads.pr_record(root, live, head)
        require(scope == data['scope'] and set(scope['required']) == set(release_check.REQUIRED), 'computed input coverage differs')
        for item in items:
            ancestor(git, item['approved_head'], head)
        result = raw_run(data['source'], judgment, git, github, repository, head, scope)
        require(result['controller']['producer']['pr'] == pr, 'authenticated PR differs from train')
        return {'version': 2, 'evidence': ref, 'scope': scope, 'source': result}
    except (ci.Refused, release_check.Refused, ci_input_reads.Refused, OSError, ValueError, KeyError, IndexError, TypeError,
            AttributeError, RecursionError, SyntaxError, zipfile.BadZipFile) as error:
        raise ScopedRefused('scoped evidence invalid or incomplete: %s' % error)


def combine_scoped_units(docs, plan, receipts):
    """Fold Python partitions into one required step; name absent planned jobs.

    The plan is an obligation even when a cancelled job wrote no summary. File
    coverage is checked before adding counts, so half a suite is never Python.
    """
    required = sorted(set(name for job in plan for name in job['steps'].split(',')) |
                      {name for doc in docs for name in doc.get('required', [])})
    steps = [step for doc in docs for step in doc.get('steps', [])]
    partitions = [job for job in plan if job.get('python_shard')]
    jobs, missing_jobs, parts = [], [], []
    for job in plan:
        name = job.get('name', job['steps'])
        matches = [(doc, receipt) for doc, receipt in zip(docs, receipts)
                   if (receipt.get('shard') or {}).get('name') == name]
        # Older receipts/tests name only the single step, without a job name.
        if not matches and 'name' not in job:
            matches = [(doc, receipt) for doc, receipt in zip(docs, receipts)
                       if [step['name'] for step in doc.get('steps', [])] == job['steps'].split(',')]
        present = len(matches) == 1
        if present:
            doc, _ = matches[0]
            present = sorted(s['name'] for s in doc.get('steps', [])) == sorted(job['steps'].split(','))
            if job.get('python_shard'):
                index, total = map(int, job['python_shard'].split('/'))
                actual = doc.get('python_shard') or {}
                present = (present and actual.get('index') == index and actual.get('total') == total
                           and sorted(actual.get('files', [])) == sorted(job['files']))
                if present:
                    parts.append(dict(doc['steps'][0], partition=actual))
        jobs.append({'name': name, 'steps': job['steps'].split(','), 'missing': not present,
                     **({'python_shard': job['python_shard']} if job.get('python_shard') else {})})
        if not present:
            missing_jobs.append(name)
    if partitions:
        python_results = sum(step['name'] == 'python-units' for step in steps)
        steps = [step for step in steps if step['name'] != 'python-units']
        expected = [job['python_shard'] for job in partitions]
        files = [path for job in partitions for path in job['files']]
        total = len(partitions)
        coverage = (set(expected) == {'%d/%d' % (i, total) for i in range(1, total + 1)}
                    and len(files) == len(set(files))
                    and len(parts) == python_results)
        if len(parts) == total and coverage:
            counts = {'tests': sum(p['counts']['tests'] for p in parts),
                      'status': 'OK' if all(p['counts'].get('status') == 'OK' for p in parts) else 'FAILED'}
            for key in ('skipped', 'failures', 'errors', 'expected failures', 'unexpected successes'):
                if any(key in p['counts'] for p in parts):
                    counts[key] = sum(p['counts'].get(key, 0) for p in parts)
            steps.append({'name': 'python-units', 'tool': 'unittest', 'counts': counts,
                          'exit': max(p.get('exit', 1) for p in parts),
                          'passed': counts['tests'] > 0 and all(
                              p.get('passed') is True and p['counts'].get('tests', -1) >= 0 for p in parts),
                          'shards': parts})
    names = [step['name'] for step in steps]
    if len(names) != len(set(names)):
        raise ScopedRefused('a step ran in two shards: %s' % sorted(n for n in set(names) if names.count(n) > 1))
    missing = sorted(set(required) - set(names))
    return steps, required, jobs, missing_jobs, missing


def scoped_unit_evidence(step, out, expected, job, raw, receipt):
    """Scoped-only original partition compatibility; shared readers stay exact."""
    partitioned = 'python_shard' in job
    if not partitioned:
        require('python_shard' not in raw and 'python_shard' not in step,
                'unplanned Python partition')
        return ci.unit_evidence(step, out, expected)
    require(job['steps'] == 'python-units' and len(raw['steps']) == 1,
            'Python partition must be a Python-only job')
    part = fields(step.get('python_shard'), 'index total files')
    require(type(part['index']) is int and type(part['total']) is int
            and 1 <= part['index'] <= part['total']
            and job['python_shard'] == '%d/%d' % (part['index'], part['total'])
            and raw.get('python_shard') == part and job.get('files') == part['files'],
            'Python partition source metadata differs')
    require(receipt.get('shard') == {'name': job.get('name'), 'steps': ['python-units']}
            and isinstance(job.get('name'), str) and bool(job['name']), 'Python partition receipt differs')
    checkout = raw.get('checkout')
    require(isinstance(checkout, str) and Path(checkout).is_absolute()
            and step.get('tool') == 'unittest' and isinstance(step.get('argv'), list)
            and len(step['argv']) == 6 and isinstance(step['argv'][0], str) and bool(step['argv'][0])
            and step['argv'][1:] == [checkout + '/tools/unit_shards.py', '--root', checkout,
                                    '--shard', job['python_shard']], 'Python partition command differs')
    text = (out / 'python-units.log').read_text()
    metadata = [loads(line) for line in text.splitlines() if line.startswith('{"unit_shards":')]
    require(len(metadata) == 1 and type(metadata[0].get('unit_shards')) is int
            and metadata[0]['unit_shards'] == 1 and metadata[0].get('python_shard') == part
            and type(metadata[0].get('tests')) is int and metadata[0]['tests'] == step.get('counts', {}).get('tests')
            and metadata[0].get('timing') == step.get('timing'), 'Python partition log metadata differs')
    require(len(re.findall(r'^Ran (\d+) tests? in ', text, re.M)) == 1
            and len(re.findall(r'^(OK|FAILED)(?: \((.*)\))?$', text, re.M)) == 1, 'Python partition log result differs')
    paths = part['files']
    require(isinstance(paths, list) and all(isinstance(path, str) for path in paths)
            and len(paths) == len(set(paths)), 'Python partition files differ')
    for path in paths:
        safe_path(path)
    if metadata[0]['tests'] == 0:
        require(re.findall(r'^Ran (\d+) tests? in ', text, re.M) == ['0']
                and re.findall(r'^(OK|FAILED)(?: \((.*)\))?$', text, re.M) == [('OK', '')]
                and step.get('counts') == {'tests': 0, 'status': 'OK'}
                and type(step.get('exit')) is int and step['exit'] == 0 and step.get('passed') is True
                and not expected, 'empty Python partition differs')
        return
    return ci.unit_evidence(step, out, expected)


# Item 752 is an explicit exact-record route owned here, alongside scoped
# evidence. No candidate-selected input list can replace this independent body.
CARRY_752_FILE = '66ebfa73840d6b29fa006fefb1eddc219939c34b4c919d4514cfb9118db11bd8'
CARRY_752_BODY = '5189efe95a3fb471d5e5590c4970d189cbaf1380bebf201951c108ea6061bf4a'
CARRY_752_OLD = '6e08d31e1c52caa670b09185ec01ffe052942397'
CARRY_752_HEAD = 'd0978e76ba115ece3f03754a220aee2d6ceba87b'
CARRY_752_TREE = '490fa783d2131680ab9754ac27b95f2a92e29c35'
CARRY_752_BASE = '3187c1bc851bdb256c272928a00dce974e2c8e48'
CARRY_752_MERGE = '5896b1312642199a8717cd3398dda97accf2f4f3'
CARRY_752_RUNS = {
    44284000276: (CARRY_752_OLD, CARRY_752_OLD),
    44297550079: ('f24636938a018d1c22c62887058d67a86a6279c9', CARRY_752_OLD),
    44305214536: ('918a612e77f4a62d12a9dda21034e6e23bd88037', CARRY_752_HEAD),
    44306987525: ('35c66074e5c677b5cdbb405ed362bff64db40aa0', CARRY_752_HEAD),
}
CARRY_752_HISTORY = {
    '134778432497.log': '7a826bc6b50447f4ca83c45782ccf8d8be5b820e0694f4a94fa82dd77e22a253',
    '134804897024.log': '0954f7d29e9b677a1ec109a71a6d837c0c33aab4d2d065b1fc5c5c3299307d20',
    '134804897592.log': 'b9257946f6dc9246a326aef7305f2bf2e01bdaac01b966fa7cd9f9968f0a61b4',
}
CARRY_752_UNION = 'c26ca3ce38cb0e15f2b0c4f8e8b0f96eda6a7149005fc5eba141aa74cb09daac'
CARRY_752_RETURNED = {
    'node-units': (14433099037, '863d6d3c4bf9b9af8fd9e32d2a3574c8a64b84fd91eb2d1a07e0919f7468b31b'),
    'python-1': (14435960075, '73720b1a356cb1d24b539207b8a0dc8b8f499c29c21aa58444496f42f5730f7b'),
    'native-compose': (14433354869, '76ba64406cb00d75c0c5813605c4e8b622b143c78a608cf1e5ce89b335c34854'),
    'python-2': (14428831875, 'aca022ad9df5c207574ed89d7709263e31ba589fa164ea3fd2fbf265353d7f22'),
    'python-3': (14428254693, '65cd421328adbc41c51533dda4d4f019d36f87115d105d5f6ba7c98be7e91412'),
    'python-4': (14428620240, 'df2bc1cec8f2805ba84aeff5d9a858be40529c686fba78404d7d29757e1b5f64'),
    'deploy-refusals': (14427878182, 'eb047254d9563e8490f0b478002d74981953ffcb0f90959fbcb9296ae5294992'),
}


def carry_require(ok, why):
    if not ok:
        raise Refused('source carry 752: ' + why)


def carry_canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')


def carry_record(ref):
    raw = base_move.artifact(ref)
    carry_require(digest(raw) == CARRY_752_FILE, 'absent, stale or altered independent carry body')
    data = base_move.loads(raw)
    carry_require(digest(carry_canonical(data)) == CARRY_752_BODY, 'canonical carry binding differs')
    carry_require(data['coverage']['carry_exact_recorded_scope'] == 48
                  and data['coverage']['refused_whole_step_carry'] == 2
                  and Counter(s['decision'] for s in data['steps']) == {
                      'carry-exact-recorded-scope': 48, 'refuse-whole-step-unchanged-input-carry': 2},
                  '48 carries and two refusals required')
    # Consume the complete prior reviews, not only their names or summaries.
    prior = {key: base_move.document(value) for key, value in data['prior_independent_records'].items()}
    return data, prior


def carry_sources(data, prior, git):
    """Verify all recorded source claims, including qualified non-manifests.

    Batch Git archives retain exact bytes; never import a candidate reader.
    Refused scopes retain their differing hashes rather than being made equal.
    """
    import tarfile
    commits = (data['original_head'], data['original_tested_merge'], data['target_head'])
    carry_require(commits == (CARRY_752_OLD, CARRY_752_MERGE, CARRY_752_HEAD)
                  and data['original_base'] == CARRY_752_BASE and data['target_tree'] == CARRY_752_TREE,
                  'source family differs')
    carry_require(parents_of(git, CARRY_752_MERGE) == [CARRY_752_BASE, CARRY_752_OLD]
                  and tree_of(git, CARRY_752_MERGE) == tree_of(git, CARRY_752_OLD)
                  and tree_of(git, CARRY_752_HEAD) == CARRY_752_TREE, 'original parent/tree differs')
    changed = _ask(git, 'source diff', 'diff', '--name-only', CARRY_752_OLD, CARRY_752_HEAD).splitlines()
    carry_require(changed == data['changed_files'], 'correction changed-path inventory differs')
    claims = []
    def visit(value):
        if isinstance(value, dict):
            if {'path', 'original_head_sha256', 'original_merge_sha256', 'target_sha256', 'unchanged'} <= set(value):
                claims.append(value)
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    visit(data)
    reader = prior['four-reader']
    for row in reader['conservative_verified_inputs']:
        claims.append(dict(path=row['path'], original_head_sha256=row['sha256'],
                           original_merge_sha256=row['sha256'], target_sha256=row['sha256'], unchanged=True))
    paths = sorted({row['path'] for row in claims})
    for path in paths:
        base_move.safe_path(path)
    actual = {}
    with tempfile.TemporaryDirectory(prefix='carry-752-git-') as temp:
        for commit, column in zip(commits, ('original_head_sha256', 'original_merge_sha256', 'target_sha256')):
            target = Path(temp) / (column + '.tar')
            _ask(git, 'reviewed inputs', 'archive', '--format=tar', '--output=' + str(target), commit, '--', *paths)
            with tarfile.open(str(target)) as archive:
                for path in paths:
                    member = archive.getmember(path)
                    carry_require(member.isfile(), 'non-file carried input ' + path)
                    with archive.extractfile(member) as handle:
                        actual[(path, column)] = digest(handle.read())
    for row in claims:
        values = [actual[(row['path'], key)] for key in ('original_head_sha256', 'original_merge_sha256', 'target_sha256')]
        carry_require(values == [row[key] for key in ('original_head_sha256', 'original_merge_sha256', 'target_sha256')]
                      and row['unchanged'] is (len(set(values)) == 1), 'changed or undeclared carried input ' + row['path'])
    for commit, expected in reader['web_subtrees'].items():
        carry_require(_ask(git, 'Reader subtree', 'rev-parse', '--verify', commit + ':web').strip() == expected,
                      'qualified Reader web subtree differs')
    for step in data['steps']:
        if step['decision'] == 'carry-exact-recorded-scope':
            carry_require(not step['changed_input_intersection'], 'intersecting step cannot carry')
    return {'paths': len(paths), 'claims': len(claims), 'carry': 48, 'refused': 2}


def carry_run(binding, github, repository, git):
    from tools import continuation_envelope as continuation
    base_move.fields(binding, 'run attempt workflow_head source_head')
    base_move.number(binding['run']); base_move.number(binding['attempt'])
    base_move.sha(binding['workflow_head']); base_move.sha(binding['source_head'])
    carry_require(binding['attempt'] == 1, 'wrong run attempt')
    expected = CARRY_752_RUNS.get(binding['run'])
    if binding['run'] == 44319235676:
        expected = ('390bcd42d934ea0b8b0e54ef314440dd0d33a7fe', CARRY_752_HEAD)
    if expected is not None:
        carry_require((binding['workflow_head'], binding['source_head']) == expected, 'wrong source/workflow')
    else:
        carry_require(binding['source_head'] == CARRY_752_HEAD, 'replacement source differs')
    event = 'pull_request' if binding['run'] == 44284000276 else 'workflow_dispatch'
    run, jobs = continuation.run_fact(binding, github, repository, binding['workflow_head'], event)
    if event == 'pull_request':
        prs = run.get('pull_requests')
        carry_require(isinstance(prs, list) and len(prs) == 1 and prs[0].get('number') == 86
                      # GitHub updates this association as PR86 moves. It is
                      # not the immutable run.head_sha or tested source. Both
                      # exact historical/current PR heads are independently
                      # bound below; no arbitrary association head qualifies.
                      and prs[0].get('head', {}).get('sha') in (CARRY_752_OLD, CARRY_752_HEAD)
                      and {k: prs[0].get('base', {}).get(k) for k in ('ref', 'sha')} ==
                          {'ref': 'release/live73', 'sha': CARRY_752_BASE}, 'original API PR/head/base differs')
    else:
        carry_require(parents_of(git, binding['workflow_head']) == [binding['source_head']], 'workflow parent differs')
        changed = _ask(git, 'workflow delta', 'diff', '--name-only', binding['source_head'], binding['workflow_head']).splitlines()
        carry_require(changed == ['.github/workflows/checks.yml'], 'workflow changes unrelated source')
        workflow = continuation.git_bytes(git, binding['workflow_head'], '.github/workflows/checks.yml')
        trigger = re.search(r'^on:\n((?:[ \t].*\n|\n)+)', workflow.decode(), re.M)
        carry_require(trigger is not None and re.findall(r'^  ([A-Za-z_]+):', trigger[1], re.M) == ['workflow_dispatch'],
                      'replacement workflow is not manual-only')
    return run, jobs


def carry_archive(row, run, jobs, github, repository):
    """Authenticate original ZIP; index every member, read only named data."""
    from tools import continuation_envelope as continuation
    base_move.fields(row, 'key run id name job archive')
    base_move.safe_path(row['key']); base_move.number(row['id'])
    carry_require(row['run'] == run['id'], 'archive run differs')
    raw = base_move.artifact(row['archive'])
    meta = github.get('repos/%s/actions/artifacts/%d' % (repository, row['id']))
    wr = meta.get('workflow_run') or {}
    carry_require(type(meta.get('id')) is int and meta['id'] == row['id'] and meta.get('name') == row['name']
                  and meta.get('expired') is False and meta.get('size_in_bytes') == len(raw)
                  and meta.get('digest') == 'sha256:' + digest(raw)
                  and wr.get('id') == run['id'] and wr.get('head_sha') == run['head_sha']
                  and wr.get('head_branch') == run['head_branch']
                  and wr.get('repository_id') == run['repository']['id']
                  and wr.get('head_repository_id') == run['head_repository']['id'], 'ZIP API identity/digest differs')
    carry_require(row['job'] in jobs, 'archive attempt job missing')
    job = jobs[row['job']]
    upload_name = "Keep the whole run's summary" if row['name'] == 'release-check' else 'Keep the evidence'
    upload = [s for s in job.get('steps', []) if s.get('name') == upload_name
              and s.get('status') == 'completed' and s.get('conclusion') == 'success']
    carry_require(len(upload) == 1, 'archive upload missing')
    times = [continuation.stamp(s) for s in (upload[0]['started_at'], meta['created_at'], job['completed_at'])]
    carry_require(all(t.utcoffset() is not None for t in times) and times[0] <= times[1] <= times[2],
                  'archive attempt/upload differs')
    members, index = {}, {}
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names = archive.namelist()
        carry_require(len(names) == len(set(names)), 'duplicate ZIP member')
        for name in names:
            base_move.safe_path(name[:-1] if name.endswith('/') else name)
            if name.endswith('/'):
                continue
            value = archive.read(name)
            index[name] = digest(value)
            # Opaque caches/images remain in the complete digest index. Never
            # extract or execute code, including source archives in evidence.
            if name.endswith(('.json', '.log')) and not name.startswith('pyc/') and '/pyc/' not in name:
                members[name] = value
    return members, index


def carry_controller_inventory(controller):
    """Bind every controller/publication ZIP member as well as source archives."""
    result = {}
    for key in ('verdict_artifact', 'published_artifact'):
        raw = base_move.artifact(controller[key]['archive'])
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            names = archive.namelist()
            carry_require(len(names) == len(set(names)), 'duplicate controller ZIP member')
            result[key] = {}
            for name in names:
                base_move.safe_path(name[:-1] if name.endswith('/') else name)
                if not name.endswith('/'):
                    result[key][name] = digest(archive.read(name))
    return result


def carry_dispatch(contents, binding, run, git, repository):
    from tools import continuation_envelope as continuation
    dispatch = base_move.loads(contents['dispatch-source.json'])
    source = binding['source_head']; workflow = binding['workflow_head']
    expected = {'version': 1, 'requested_source': source, 'checked_source': source,
                'checked_tree': tree_of(git, source), 'parents': parents_of(git, source),
                'original_source': CARRY_752_OLD, 'original_run': 44284000276, 'original_attempt': 1,
                'release_base': CARRY_752_BASE, 'workflow_api_head': workflow, 'workflow_sha': workflow,
                'workflow_ref': repository + '/' + continuation.WORKFLOW + '@refs/heads/' + run['head_branch'],
                'run': str(run['id']), 'attempt': '1', 'event': 'workflow_dispatch',
                'source_changes': _ask(git, 'dispatch changes', 'diff', '--name-only', CARRY_752_OLD, source).rstrip('\n')}
    # New-source wrappers preserve a separately recorded authority list. It is
    # included in the final independently bound archive/body, never a bypass.
    if 'authority' in dispatch:
        carry_require(isinstance(dispatch['authority'], list) and bool(dispatch['authority'])
                      and all(type(n) is int for n in dispatch['authority']), 'invalid dispatch authority')
        expected['authority'] = dispatch['authority']
    carry_require(carry_canonical(dispatch) == carry_canonical(expected), 'dispatch source/workflow/base/parents differ')
    return dispatch


def carry_review(data, judgment):
    carry_require(data['review'] is not None, 'independent final source/body review pending')
    review = base_move.fields(base_move.document(data['review']),
        'version reviewer record judgment_audit body_sha256 inventory_sha256 workflow_sha256 obligations')
    carry_require(type(review['version']) is int and review['version'] == 1 and review['reviewer'] == 'auditor'
                  and _words(review['record']) and review['record'] != judgment['audit']
                  and review['judgment_audit'] == judgment['audit'], 'independent final review absent or mismatched')
    body = {k: v for k, v in data.items() if k != 'review'}
    carry_require(review['body_sha256'] == digest(carry_canonical(body))
                  and review['inventory_sha256'] == data['inventory']['sha256'], 'final review/body/inventory binding differs')
    return review


def carry_scopes(data, carried):
    scopes = [s['step'] for s in carried['steps'] if s['decision'] == 'carry-exact-recorded-scope']
    expected = scopes + ['python-1', 'python-2', 'python-3', 'python-4', 'node-units', 'deploy-refusals', 'native-compose']
    executions = data['executions']
    carry_require(isinstance(executions, list), 'missing execution inventory')
    for row in executions:
        base_move.fields(row, 'scope archive step')
    actual = [r['scope'] for r in executions]
    missing = sorted(set(expected) - set(actual))
    carry_require(Counter(actual) == Counter(expected),
                  'pending/missing or duplicate/extra scopes: ' + ', '.join(missing or actual))
    return {r['scope']: r for r in executions}


def carry_cases(rows, expected, what):
    carry_require(isinstance(expected, list) and bool(expected), what + ': missing reviewed cases')
    actual = [ci.key(r) for r in rows]; planned = [ci.key(r) for r in expected]
    carry_require(len(set(actual)) == len(actual) and len(set(planned)) == len(planned)
                  and Counter(actual) == Counter(planned), what + ': duplicate/missing/extra case inventory')


def carry_complete_union(ref):
    """Warp9074 accepts only the independently fixed auditor9067 bytes."""
    raw = base_move.artifact(ref)
    carry_require(digest(raw) == CARRY_752_UNION, 'independent complete union differs')
    union = base_move.loads(raw)
    carry_require(union['reviewer'] == 'auditor' and union['target_head'] == CARRY_752_HEAD
                  and union['target_tree'] == CARRY_752_TREE
                  and Counter(union['required_steps']) == Counter(release_check.REQUIRED)
                  and Counter(r['step'] for r in union['steps']) == Counter(release_check.REQUIRED),
                  'independent union seat/source/step inventory differs')
    records = {key: base_move.document(value) for key, value in union['references'].items()}
    for step in union['steps']:
        refs = step.get('records', [step['record']] if 'record' in step else [])
        for reference in refs:
            carry_require(reference in union['references'].values(), 'unbound union step reference')
        if step['kind'] == 'carry-exact-recorded-scope':
            original = records['old_scopes']['steps'][int(step['pointer'].split('/')[-1])]
            carry_require(original['step'] == step['step']
                          and original['decision'] == 'carry-exact-recorded-scope', 'union carry pointer differs')
    verification = records['live97_comparison']; measure = records['live97_raw_measurement']
    carry_require(verification['source'] == measure['source'] == CARRY_752_BASE
                  and verification['tree'] == '28acdaa0460ab1ec990e0cea136049cf37715757'
                  and verification['measure_sha256'] == union['references']['live97_raw_measurement']['sha256']
                  and verification['disposition_authority'] == measure['authority'] == 9061
                  and verification['exact_match'] is True
                  and verification['base_cue_right'] == verification['candidate_cue_right'] == 322.921875
                  and measure['measurement']['cue']['right'] == 322.921875
                  and measure['measurement']['overflow'] == 3, 'independent placement base/geometry differs')
    return union, records


def carry_compose_authority(rows, placing=None):
    # Old reds and generic final review cannot place any new compose red.
    reds = [r['name'] for r in rows if r.get('passed') is not True
            and not (r.get('expectedFailure') is True and r.get('mutationCaught') is True)]
    if placing is None:
        carry_require(not reds, 'new-head compose raw reds need separate independent placement: ' + '; '.join(reds))
        return None
    union, records = carry_complete_union(placing)
    compose = records['compose']
    placement = next(s for s in union['steps'] if s['step'] == 'native-compose')
    carry_require(carry_canonical(rows) == carry_canonical(compose['results'])
                  and carry_canonical([r for r in rows if r.get('passed') is not True]) == carry_canonical(compose['failed'])
                  and len(reds) == 2, 'exact independently placed compose cases/failure bodies differ')
    carry_require(compose['source'] == CARRY_752_HEAD and compose['tree'] == CARRY_752_TREE
                  and compose['run'] == 44306987525 and compose['attempt'] == 1
                  and (compose['artifact']['id'], compose['artifact']['sha256']) == CARRY_752_RETURNED['native-compose']
                  and placement['placement_authority'] == 9061 and placement['finding_owner_item'] == 750
                  and placement['release_line_item'] == 648, 'independent compose source/run/placement differs')
    return {'record': placing, 'raw_reds': compose['failed'], 'finding_owner_item': 750,
            'unexecuted_branches': reds, 'release_line_item': 648,
            'qualification': placement['release_line_qualification']}


def carry_compose_own(receipt, executions, archives, expected):
    """Own cases from the authenticated whole new-head return, without fake snapshots.

    The whole report has already passed source/API/ZIP/log/cleanup/placement
    checks. Only exact true raw rows may fulfill independently chosen obligations.
    Engine prefixes are the literal compose harness's raw identity convention.
    """
    base_move.fields(receipt, 'compose_union')
    row = base_move.fields(receipt['compose_union'], 'archive report_sha256 raw_case')
    key = executions['native-compose']['archive']
    carry_require(row['archive'] == key, 'own compose archive differs')
    raw = archives[key]['native/compose/native.json']
    report = base_move.loads(raw); case = row['raw_case']
    carry_require(row['report_sha256'] == digest(raw)
                  and any(carry_canonical(case) == carry_canonical(r) for r in report['results'])
                  and case.get('passed') is True and not case.get('expectedFailure')
                  and not case.get('mutationCaught'), 'own compose raw case differs or did not pass')
    match = re.fullmatch(r'(chromium|webkit) (.+)', case['name'])
    carry_require(match is not None, 'own compose engine absent')
    identity = ('native-compose', match[2], case.get('phase'), match[1])
    carry_require(identity in expected, 'wrong own compose obligation')
    return [identity]


def carry_unit(step, out, expected, scope):
    """Only Python2's exact independently bound 12 skips remain qualified."""
    text = (out / (step['name'] + '.log')).read_text()
    node = step['name'] == 'node-units'
    counts, good = release_check.node_counts(text) if node else release_check.python_counts(text)
    carry_require(counts == step.get('counts') and good is True and step.get('passed') is True
                  and type(step.get('exit')) is int and step['exit'] == 0, scope + ': raw counts/exit/partial differs')
    listing = text if node else carry_unit_listing(text)
    rows = ci.unit_records(listing, node=node)
    carry_cases([r for r, _ in rows], expected, scope)
    skips = [(r, status) for r, status in rows if status.startswith('skipped ')]
    if scope == 'python-2':
        carry_require(counts.get('tests') == 1220 and counts.get('skipped') == 12 and len(skips) == 12
                      and all('FrozenReaders' in r['name'] for r, _ in skips), 'Python2 unexecuted qualification differs')
    else:
        carry_require(not skips and not counts.get('skipped'), scope + ': skipped control')
    carry_require(all(status == 'ok' or (scope == 'python-2' and status.startswith('skipped ')) for _, status in rows)
                  and not any(counts.get(k, 0) for k in ('todo', 'cancelled', 'expected failures', 'unexpected successes')),
                  scope + ': incomplete control')
    # Node's parser counts top-level tests while identities also include nested
    # TAP checks. Their complete identity union is required by carry_cases.
    if not node:
        carry_require(len(rows) == counts['tests'], scope + ': partial unittest listing')
    return rows


def carry_unit_listing(text):
    # OK (skipped=12) itself matches the legacy parser's test-name shape.
    # Bound the listing at the actual single unittest terminal, retaining the
    # original bytes/counts and exact skipped identities separately above.
    terminals = list(re.finditer(r'^Ran ([0-9]+) tests? in [^\n]+\n', text, re.M))
    carry_require(len(terminals) == 1, 'missing or repeated unittest terminal')
    return text[:terminals[0].start()].split('\n======================================================================\n', 1)[0]


def carry_replacement(content, binding, run, git, repository, scope, step):
    """Actual summary, checked commit, command and manual quarantine facts."""
    from tools import continuation_envelope as continuation
    carry_dispatch(content, binding, run, git, repository)
    receipt = base_move.loads(content['run.json']); raw = base_move.loads(content['summary.json'])
    carry_require(receipt.get('summary_sha256') == digest(content['summary.json']), 'replacement summary digest differs')
    selected = [s['name'] for s in raw['steps']]
    continuation.clean_summary(raw, receipt, selected, CARRY_752_HEAD, git)
    ci.same_run(receipt['run'], {'id': binding['run'], 'attempt': 1, 'repository': repository,
        'workflow': 'Checks', 'event': 'workflow_dispatch', 'workflow_sha': binding['workflow_head'],
        'workflow_ref': repository + '/' + continuation.WORKFLOW + '@refs/heads/' + run['head_branch']})
    parents = parents_of(git, CARRY_752_HEAD)
    carry_require(receipt.get('merge') == {'sha': CARRY_752_HEAD, 'tree': CARRY_752_TREE,
                  'first_parent': parents[0], 'second_parent': None}
                  and receipt.get('base') == {'ref': None, 'sha': None} and receipt.get('base_at_run') is None
                  and receipt.get('head') == {'ref': 'refs/heads/' + run['head_branch'], 'sha': binding['workflow_head']},
                  'replacement receipt source/head/base differs')
    carry_require(step in raw['steps'] and selected.count(step['name']) == 1
                  and receipt['shard']['steps'] == selected and len(set(selected)) == len(selected),
                  'replacement raw step/assignment differs')
    carry_require(raw.get('quarantine') == {'at': None,
        'refused': 'a workflow_dispatch run has no event base, so nothing is quarantined', 'held': [], 'green': False},
        'manual-event quarantine truth differs')
    required_run = {'python-2': 44305214536, 'python-3': 44305214536,
                    'native-compose': 44306987525, 'deploy-refusals': 44306987525}.get(scope)
    carry_require(binding['run'] == required_run if required_run else binding['run'] not in CARRY_752_RUNS,
                  'replacement scope/run differs')
    return receipt, raw


def carry_python4(contents, old_contents, prior, expected, inventory):
    audit = prior['python4-explicit-case-union']
    receipt = base_move.loads(contents['run.json'])
    result = base_move.loads(contents['python4-result.json'])
    selection = base_move.loads(contents['python4-inventory.json'])
    carry_require(receipt == audit['receipt'] and result == audit['result'] and selection == audit['inventory'],
                  'Python4 separately bound receipt/result/selection differs')
    for key, name in [('subset_inventory_sha256', 'python4-inventory.json'),
                      ('subset_result_sha256', 'python4-result.json'), ('subset_log_sha256', 'python-units.log')]:
        carry_require(receipt[key] == digest(contents[name]), 'Python4 subset raw digest differs')
    full, selected = selection['original_inventory'], selection['selected_ids']
    selected_set = set(selected); carried = set(full) - selected_set
    carry_require(len(full) == len(set(full)) == 1331 and len(selected) == len(selected_set) == 135
                  and len(carried) == 1196 and inventory == {'carried': sorted(carried), 'selected': selected},
                  'Python4 exact1196+135 union differs')
    carry_require(digest(old_contents['python-units.log']) == selection['original_log_sha256'], 'Python4 original log differs')
    def dotted(name):
        match = re.fullmatch(r'(\S+) \(([^)]+)\)', name)
        carry_require(match is not None, 'Python4 invalid raw identity')
        return match[2] + '.' + match[1]
    old_text = old_contents['python-units.log'].decode()
    # This exact digest-bound original is cut while one named test is open.
    # It is NOT a completed shard. Only its 1196 completed OK identities carry;
    # the open identity must belong to the explicit new-head selection.
    tail = re.search(r'(^|\n)(\S+ \([^)]+\)) \.\.\. $', old_text)
    carry_require(tail is not None and dotted(tail[2]) in selected_set, 'Python4 cut identity differs')
    old = ci.unit_records(old_text[:tail.start()].split('\n======================================================================\n', 1)[0])
    old_ok = {dotted(r['name']) for r, status in old if status == 'ok'}
    carry_require(len(old_ok) == 1196 and carried == old_ok and not carried.intersection(selected_set),
                  'Python4 overlap or carried nonpass')
    rows = ci.unit_records(contents['python-units.log'].decode())
    carry_require(len(rows) == 135 and all(status == 'ok' for _, status in rows)
                  and {dotted(r['name']) for r, _ in rows} == selected_set
                  and result['started_ids'] == result['passed_ids'] == selected
                  and result['tree_unchanged'] is True and result['was_successful'] is True,
                  'Python4 subset partial or skipped')
    carry_cases([{'name': name} for name in full], expected, 'python-4')


def validate_source_carry(ref, judgment, git, github, repository, live, merge, items, merged_pull, pr, release_branch):
    """Opted-in PR86 judgment. No partial evidence can authorize a deploy."""
    from tools import continuation_envelope as continuation
    try:
        data = base_move.fields(base_move.document(ref),
            'version carry complete_union runs archives executions inventory history controller receipts review')
        carry_require(type(data['version']) is int and data['version'] == 1, 'unknown version')
        carried, prior = carry_record(data['carry'])
        carry_require(repository == 'commonfabric-offcuts/theseus' and pr == 86 and live == CARRY_752_BASE
                      and release_branch == 'release/live73', 'wrong repository/PR/live base/release branch')
        # judge reaches here only after pull_merge/on_branch. A separate
        # read-only caller may prove the full source union BEFORE merging,
        # using GitHub's actual open PR test-merge (never a fabricated merge).
        fresh_pull = github.get(PULL_PATH % (repository, pr))
        carry_require(fresh_pull == merged_pull, 'fresh PR context differs')
        merged = merged_pull.get('merged') is True
        premerge = merged_pull.get('merged') is False and merged_pull.get('state') == 'open'
        carry_require((merged or premerge) and merged_pull.get('number') == pr
                      and merged_pull.get('merge_commit_sha') == merge
                      and merged_pull.get('head', {}).get('sha') == CARRY_752_HEAD
                      and merged_pull.get('base', {}).get('ref') == release_branch
                      and merged_pull.get('base', {}).get('sha') == live
                      and parents_of(git, merge) == [live, CARRY_752_HEAD]
                      and tree_of(git, merge) == CARRY_752_TREE, 'actual PR/source/base/parent/tree differs')
        for item in items:
            carry_require(_contains(git, item['approved_head'], CARRY_752_HEAD, 'approved source ancestry'),
                          'approved head ancestry differs')
        carry_complete_union(data['complete_union'])
        source_facts = carry_sources(carried, prior, git)
        executions = carry_scopes(data, carried)
        carry_require(isinstance(data['runs'], list) and len({r['run'] for r in data['runs']}) == len(data['runs'])
                      and set(CARRY_752_RUNS) <= {r['run'] for r in data['runs']}, 'missing or duplicate source runs')
        bindings = {r['run']: r for r in data['runs']}
        runs = {n: carry_run(r, github, repository, git) for n, r in bindings.items()}
        carry_require(Counter(r['id'] for r in judgment['producer_runs']) == Counter(bindings.keys())
                      and [r['id'] for r in judgment['verdict_checks']] == [134773516808], 'judgment run/check inventory differs')
        carry_require(isinstance(data['history'], dict) and set(CARRY_752_HISTORY) <= set(data['history']),
                      'missing historical cut/startup logs')
        for name, reference in data['history'].items():
            base_move.safe_path(name)
            raw_history = base_move.artifact(reference)
            if name in CARRY_752_HISTORY:
                carry_require(digest(raw_history) == CARRY_752_HISTORY[name], 'historical failure body differs')
        workflows = {r['workflow_head']: digest(continuation.git_bytes(git, r['workflow_head'], continuation.WORKFLOW))
                     for r in bindings.values() if r['run'] != 44284000276}
        inventory = base_move.fields(base_move.document(data['inventory']), 'archives cases python4 controller')
        carry_require(inventory['controller'] == carry_controller_inventory(data['controller']),
                      'complete controller ZIP member index differs')
        carry_require(set(inventory['cases']) == set(executions), 'complete reviewed scope inventory differs')
        carry_require(isinstance(data['archives'], list) and bool(data['archives']), 'missing archives')
        archives, archive_rows = {}, {}
        ids_seen = set()
        for row in data['archives']:
            carry_require(row['key'] not in archives and row['id'] not in ids_seen and row['run'] in runs,
                          'duplicate archive or unknown run')
            ids_seen.add(row['id']); archive_rows[row['key']] = row
            run, jobs = runs[row['run']]
            content, index = carry_archive(row, run, jobs, github, repository)
            carry_require(inventory['archives'].get(row['key']) == index, 'independent complete ZIP member index differs')
            archives[row['key']] = content
        mandatory = {'original/check-%d' % i for i in range(11)} | {
            'original/release-check', 'continuation/check-0', 'continuation/check-1'}
        carry_require(mandatory <= set(archives) and set(inventory['archives']) == set(archives),
                      'missing original cut/red/startup archives or extra inventory')
        for key, row in carried['archives'].items():
            actual = archive_rows[key]
            content = archives[key]
            carry_require(actual['id'] == row['artifact_id'] and actual['archive']['sha256'] == row['archive_sha256']
                          and digest(content['run.json']) == row['run_receipt_sha256']
                          and base_move.loads(content['run.json']) == row['run'], 'pinned original archive/receipt differs')
            if row.get('summary') is not None:
                carry_require(base_move.loads(content['summary.json']) == row['summary']
                              and digest(content['summary.json']) == row['run']['summary_sha256'], 'original summary differs')
            else:
                carry_require('summary.json' not in content, 'invented partial cleanup summary')
        # All historical JSON/log members remain digest bound in the inventory;
        # original source/controller facts are never replaced by correction runs.
        original_summary = base_move.loads(archives['original/release-check']['summary.json'])
        carry_require(original_summary.get('commit') == CARRY_752_MERGE and original_summary.get('passed') is False,
                      'original partial/red aggregate relabelled')
        context = {'pull': merged_pull, 'number': pr, 'release_branch': release_branch, 'merge': merge,
                   'assembly': CARRY_752_HEAD, 'live': live, 'original_base': live, 'source_head': CARRY_752_OLD,
                   'mode': 'merged' if merged else 'premerge-source-proof'}
        controller_source = {'run': 44284000276, 'attempt': 1, 'controller': data['controller'],
            'base_at_run': {'ref': release_branch, 'sha': live},
            'tested_merge': {'sha': CARRY_752_MERGE, 'tree': tree_of(git, CARRY_752_MERGE),
                             'first_parent': live, 'second_parent': CARRY_752_OLD}}
        controller_judgment = dict(judgment, producer_runs=[next(r for r in judgment['producer_runs'] if r['id'] == 44284000276)])
        controller = carry_controller(controller_source, controller_judgment, github, repository, CARRY_752_OLD, context)
        carried_by_scope = {r['step']: r for r in carried['steps'] if r['decision'] == 'carry-exact-recorded-scope'}
        provenance = base_move.loads(archives['original/release-check']['provenance.json'])
        old_merge = controller_source['tested_merge']
        carry_require(provenance.get('merge') == old_merge
                      and provenance.get('base_at_run') == controller_source['base_at_run']
                      and Counter(provenance.get('required', [])) == Counter(release_check.REQUIRED)
                      and Counter(original_summary.get('required', [])) == Counter(release_check.REQUIRED),
                      'original source/required provenance differs')
        original_plan = provenance['plan']
        python_plan = {int(r['python_shard'].split('/')[0]): r for r in original_plan if 'python_shard' in r}
        carry_require(set(python_plan) == {1, 2, 3, 4}, 'original Python plan incomplete')
        planned_files = [p for row in python_plan.values() for p in row['files']]
        source_paths = _ask(git, 'Python source inventory', 'ls-tree', '-r', '--name-only', CARRY_752_HEAD, '--', 'tests').splitlines()
        carry_require(len(planned_files) == len(set(planned_files))
                      and sorted(planned_files) == ci_input_reads.python_files(source_paths), 'complete Python source inventory differs')
        for i, job in enumerate(original_plan):
            original_receipt = base_move.loads(archives['original/check-%d' % i]['run.json'])
            carry_require(archive_rows['original/check-%d' % i]['run'] == 44284000276, 'original archive run differs')
            ci.same_run(original_receipt['run'], {'id': 44284000276, 'attempt': 1, 'repository': repository,
                'workflow': 'Checks', 'event': 'pull_request', 'workflow_sha': CARRY_752_MERGE,
                'workflow_ref': repository + '/' + continuation.WORKFLOW + '@refs/pull/86/merge'})
            carry_require(original_receipt.get('merge') == old_merge
                          and original_receipt.get('base_at_run') == controller_source['base_at_run']
                          and original_receipt.get('head', {}).get('sha') == CARRY_752_OLD
                          and original_receipt.get('shard') == {'name': job['name'], 'steps': job['steps'].split(',')},
                          'original source/assignment receipt differs')
        python_keys, python_files = set(), set()
        with tempfile.TemporaryDirectory(prefix='carry-752-raw-') as temp:
            for scope, execution in executions.items():
                key = execution['archive']; content = archives[key]; step = execution['step']
                out = Path(temp) / scope; out.mkdir()
                for name, value in content.items():
                    target = out / name; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(value)
                expected = inventory['cases'][scope]
                if scope in carried_by_scope:
                    old = carried_by_scope[scope]
                    carry_require(key == old['archive'] and step == old['normalized_step_receipt'], 'carried step/placement differs')
                    if scope == 'wake-replay':
                        carry_require(digest(content['replay/candidate-1/replay.json']) == old['raw_report_sha256']
                                      and digest(content['wake-replay-candidate-1.log']) == old['raw_log_sha256'], 'replay raw bytes differ')
                        carry_require(expected == [{'name': 'candidate-1'}], 'replay inventory differs')
                    else:
                        report = base_move.loads(content[old['report_member']])
                        carry_require(digest(content[old['report_member']]) == old['raw_sha256']
                                      and report['results'] == old['raw_cases'], 'omitted/altered original red or control')
                        carry_cases(report['results'], expected, scope)
                        if 'raw_log_sha256' in old:
                            carry_require(digest(content[scope + '.log']) == old['raw_log_sha256'], 'carried raw log differs')
                    continue
                binding = bindings[archive_rows[key]['run']]; run = runs[binding['run']][0]
                carry_require(binding['source_head'] == CARRY_752_HEAD, 'refused old-source whole-step reused')
                if scope in CARRY_752_RETURNED:
                    carry_require((archive_rows[key]['id'], archive_rows[key]['archive']['sha256']) == CARRY_752_RETURNED[scope],
                                  'independently reviewed returned artifact differs')
                if scope == 'python-4':
                    carry_dispatch(content, binding, run, git, repository)
                    carry_require(binding['run'] == 44305214536, 'Python4 source run differs')
                    carry_require(step == prior['python4-explicit-case-union']['result'], 'Python4 result record differs')
                    carry_python4(content, archives['original/check-7'], prior, expected, inventory['python4'])
                    continue
                receipt, raw = carry_replacement(content, binding, run, git, repository, scope, step)
                job = runs[binding['run']][1][archive_rows[key]['job']]
                release = [s for s in job.get('steps', []) if s.get('name') ==
                           'Whole release check, ' + ','.join(s['name'] for s in raw['steps'])]
                carry_require(job.get('name') == 'PR86 correction ' + receipt['shard']['name']
                              and len(release) == 1 and release[0].get('status') == 'completed'
                              and release[0].get('conclusion') in ('success', 'failure'), 'replacement job/command assignment differs')
                if scope == 'native-compose':
                    carry_require(step['name'] == scope and release_check.ran_whole(step), 'compose not whole')
                    ci.cases(step, out, expected)
                    report = base_move.loads(content['native/compose/native.json'])
                    placement = carry_compose_authority(report['results'], data['complete_union'])
                    base_move.teardown(report)
                    carry_require(not report.get('instrumentError') and not report.get('pageErrors')
                                  and not report.get('left'), 'compose cleanup/instrument failure')
                    continuation.native_source_proof(report, False, None,
                        lambda head, path: continuation.git_bytes(git, head, path), CARRY_752_HEAD, CARRY_752_HEAD)
                else:
                    name = 'python-units' if scope.startswith('python-') else scope
                    carry_require(step['name'] == name, 'wrong unit step')
                    rows = carry_unit(step, out, expected, scope)
                    if scope.startswith('python-'):
                        index = int(scope[-1]); part = step['python_shard']
                        carry_require(part['index'] == index and part['total'] == 4 and raw.get('python_shard') == part,
                                      'Python partition differs')
                        carry_require(part['files'] == python_plan[index]['files'] and step.get('argv', [])[1:] ==
                            [raw['checkout'] + '/tools/unit_shards.py', '--root', raw['checkout'], '--shard', '%d/4' % index],
                            'Python whole partition command/files differs')
                        metadata = [base_move.loads(line) for line in content['python-units.log'].decode().splitlines()
                                    if line.startswith('{"unit_shards":')]
                        carry_require(len(metadata) == 1 and metadata[0].get('python_shard') == part
                                      and metadata[0].get('tests') == step['counts']['tests'], 'Python partition log differs')
                        files = part['files']; keys = {ci.key(r) for r, _ in rows}
                        carry_require(len(files) == len(set(files)) and not python_files.intersection(files)
                                      and not python_keys.intersection(keys), 'Python overlap')
                        python_files.update(files); python_keys.update(keys)
                    else:
                        argv = step.get('argv')
                        if scope == 'node-units':
                            node_files = sorted(p for p in source_paths if '/' not in p[len('tests/'):]
                                                and p.endswith('.test.mjs'))
                            carry_require(isinstance(argv, list) and argv[1:] ==
                                ['--test', '--test-reporter=tap'] + node_files, 'Node whole command/input inventory differs')
                        else:
                            carry_require(isinstance(argv, list) and argv[1:] ==
                                ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_tools_*.py',
                                 '-k', 'test_tools_deploy.DeployRefuses', '-k', 'test_tools_train.', '-v'],
                                'deploy-refusals command differs')
        py4_ids = set(prior['python4-explicit-case-union']['inventory']['original_inventory'])
        def dotted_key(row):
            match = re.fullmatch(r'(\S+) \(([^)]+)\)', row['name'])
            carry_require(match is not None, 'Python invalid union identity')
            return match[2] + '.' + match[1]
        other_py = [r for scope in ('python-1', 'python-2', 'python-3') for r in inventory['cases'][scope]]
        carry_require(not py4_ids.intersection(dotted_key(r) for r in other_py), 'Python4 case overlap')
        review = carry_review(data, judgment)
        carry_require(review['workflow_sha256'] == workflows, 'independent workflow byte binding differs')
        # Own acceptance stays separate and uses the existing exact-source reader.
        obligations = review['obligations']; expected_own = []
        carry_require(isinstance(obligations, list) and bool(obligations), 'missing independent own-case obligations')
        for row in obligations:
            base_move.fields(row, 'step case phase engine')
            carry_require(row['step'] in ci.NATIVE and _words(row['case']) and row['engine'] in ('chromium', 'webkit')
                          and (row['phase'] is None or _words(row['phase'])), 'invalid own-case obligation')
            expected_own.append((row['step'], row['case'], row['phase'], row['engine']))
        carry_require(len(set(expected_own)) == len(expected_own) and all(
            (s, c, p, e) in expected_own for s, c, p, _ in expected_own for e in ('chromium', 'webkit')), 'incomplete own engines')
        got = Counter()
        for receipt in data['receipts']:
            if isinstance(receipt, dict) and 'compose_union' in receipt:
                keys = carry_compose_own(receipt, executions, archives, expected_own)
            else:
                keys, _ = base_move.own_receipt(receipt, git, github, repository, CARRY_752_HEAD, CARRY_752_TREE, expected_own)
            got.update(keys)
        carry_require(got == Counter({key: 1 for key in expected_own}), 'missing/duplicate own-case receipts')
        return {'version': 1, 'evidence': ref, 'carry': data['carry'], 'review': data['review'],
                'inventory': data['inventory'], 'complete_union': data['complete_union'],
                'compose_placement': placement, 'source_facts': source_facts, 'controller': controller,
                'context': 'merged' if merged else 'premerge-source-proof; NOT deploy admission',
                'scopes': 55, 'required_steps': 52, 'qualified_unexecuted': 12,
                'kind': 'exact-two-source-carry; original outcomes retained'}
    except (base_move.Refused, ci.Refused, release_check.Refused, OSError, ValueError, KeyError, IndexError, TypeError,
            AttributeError, RecursionError, zipfile.BadZipFile) as error:
        raise Refused('source carry 752: invalid or incomplete evidence: %s' % error)


def carry_controller(source, judgment, github, repository, head, merged_context):
    data = base_move.fields(source['controller'], 'run attempt current_base verdict_artifact published_artifact')
    current = base_move.base_fact(data['current_base'])
    original = base_move.base_fact(source.get('base_at_run'))
    base_move.require(source['tested_merge']['first_parent'] == original['sha']
            and source['tested_merge']['second_parent'] == head, 'controller original merge binding differs')
    base_move.number(data['run']); base_move.number(data['attempt'])
    base_move.require(data['run'] != source['run'], 'controller is not a separate run')
    run = github.get('repos/%s/actions/runs/%d' % (repository, data['run']))
    base_move.require(run.get('id') == data['run'] and run.get('run_attempt') == data['attempt']
            and run.get('name') == 'Verdict' and run.get('path') == '.github/workflows/verdict.yml'
            and run.get('event') == 'workflow_run' and run.get('status') == 'completed'
            and run.get('conclusion') in ('success', 'failure'), 'controller run identity differs')
    base_move.sha(run['head_sha'])
    suffix = '%d-%d-c%d' % (source['run'], source['attempt'], data['attempt'])
    verdict = base_move.controller_archive(data['verdict_artifact'], github, repository, run, 'verdict-' + suffix)
    published = base_move.controller_archive(data['published_artifact'], github, repository, run, 'published-' + suffix)
    binding = base_move.loads(verdict['producer.json']); check = base_move.loads(verdict['check-run.json'])
    pub = base_move.loads(published['published.json'])
    producer, controller = binding['producer'], binding['controller']
    ci.same_run({'id': producer.get('run_id'), 'attempt': producer.get('run_attempt')},
                {'id': source['run'], 'attempt': source['attempt']})
    base_move.require(producer.get('head_sha') == head and producer.get('head_repository') == repository
            and producer.get('event') == 'pull_request' and producer.get('workflow_name') == 'Checks'
            and producer.get('workflow_path') == '.github/workflows/checks.yml'
            and producer.get('conclusion') == judgment['producer_runs'][0]['conclusion'], 'controller producer binding differs')
    pr = producer['pull_request']
    base_move.require(pr.get('head_sha') == head and pr.get('base_sha') == current['sha']
            and pr.get('base_ref') == current['ref'], 'controller current PR binding differs')
    base_move.number(pr['number'])
    url = 'https://github.com/%s/actions/runs/%d' % (repository, data['run'])
    ci.same_run({'id': controller.get('run_id'), 'attempt': controller.get('run_attempt')},
                {'id': data['run'], 'attempt': data['attempt']})
    base_move.require(controller.get('repository') == repository and controller.get('url') == url
            and controller.get('sha') == controller.get('workflow_sha') == run['head_sha']
            and controller.get('ref') == 'refs/heads/' + run['head_branch']
            and controller.get('workflow_ref') == repository + '/.github/workflows/verdict.yml@' + controller['ref'],
            'protected controller identity differs')
    base_move.require(len(judgment['verdict_checks']) == 1, 'need exact published Verdict check')
    listed = judgment['verdict_checks'][0]
    raw = github.get('repos/%s/check-runs/%d' % (repository, listed['id']))
    prs = raw.get('pull_requests')
    if prs == []:
        # Context comes only from the reviewed two-edge Git chain in validate,
        # never from a manifest override or a missing/nonempty association.
        base_move.require(isinstance(merged_context, dict), 'empty check association needs merged train context')
        ctx = merged_context
        pull = ctx['pull']
        base_move.require(pull.get('number') == ctx['number'] == pr['number']
                and pull.get('merged') is True and pull.get('merge_commit_sha') == ctx['merge']
                and pull.get('head', {}).get('sha') == ctx['assembly']
                and pull.get('base', {}).get('sha') == ctx['live']
                and pull.get('base', {}).get('ref') == current['ref'] == ctx['release_branch']
                and original['sha'] == ctx['original_base']
                and current['sha'] in (ctx['original_base'], ctx['live'])
                and head == ctx['source_head'], 'empty check association merged PR binding differs')
    else:
        # This sole opted-in family has two separately authenticated source
        # heads. GitHub's PR association is mutable; check.head_sha, producer,
        # publication and failed conclusion remain the original immutable facts.
        base_move.require(isinstance(merged_context, dict), 'carry check needs actual merged context')
        ctx = merged_context
        pull = ctx['pull']
        base_move.require(head == CARRY_752_OLD and ctx['source_head'] == head
                and ctx['assembly'] == CARRY_752_HEAD and ctx['live'] == CARRY_752_BASE
                and pull.get('number') == ctx['number'] == pr['number'] == 86
                and (pull.get('merged') is True or (ctx.get('mode') == 'premerge-source-proof'
                     and pull.get('merged') is False and pull.get('state') == 'open'))
                and pull.get('merge_commit_sha') == ctx['merge']
                and pull.get('head', {}).get('sha') == CARRY_752_HEAD
                and pull.get('base', {}).get('sha') == CARRY_752_BASE
                and pull.get('base', {}).get('ref') == current['ref'] == ctx['release_branch']
                and current['sha'] == original['sha'] == CARRY_752_BASE,
                'carry check actual merge/base context differs')
        base_move.require(isinstance(prs, list) and len(prs) == 1 and prs[0].get('number') == pr['number']
                and prs[0].get('head', {}).get('sha') in (CARRY_752_OLD, CARRY_752_HEAD)
                and prs[0].get('base', {}).get('ref') == current['ref']
                and prs[0].get('base', {}).get('sha') == current['sha'], 'archived check current PR binding differs')
    external = '%d-%d' % (source['run'], source['attempt'])
    # Plain early refusals require equal complete base facts and the exact
    # publication pair. Branch-named receipts also occur without a base move.
    # Both PR records above and all three names below must still agree.
    plain = current == original and (pub.get('name'), pub.get('base')) == ('Verdict', '')
    name = 'Verdict' if plain else 'Verdict for ' + current['ref']
    published_base = '' if plain else current['ref']
    base_move.require(pub.get('check_run_id') == listed['id'] == raw.get('id')
            and pub.get('head_sha') == head and pub.get('name') == name and pub.get('base') == published_base
            and pub.get('external_id') == external, 'published Verdict binding differs')
    for key, expected in (('controller_run', data['run']), ('controller_attempt', data['attempt']),
                          ('producer_run', source['run']), ('producer_attempt', source['attempt'])):
        base_move.require(str(pub.get(key)) == str(expected), 'published attempt binding differs')
    base_move.require(raw.get('app', {}).get('id') == base_move.VERDICT_APP['id']
            and raw.get('app', {}).get('slug') == base_move.VERDICT_APP['slug'], 'untrusted Verdict App')
    expected = {'name': name, 'head_sha': head, 'status': 'completed',
                'conclusion': listed['conclusion'], 'details_url': url, 'external_id': external}
    base_move.require(listed['conclusion'] in ('success', 'failure') and all(
        raw.get(k) == check.get(k) == v for k, v in expected.items()), 'source check binding differs')
    output = check['output']; api_output = raw.get('output') or {}
    summary = output['summary']
    appended = '\nPublished by controller run %d attempt %d.' % (data['run'], data['attempt'])
    base_move.require(api_output.get('title') == output.get('title')
            and api_output.get('summary') in (summary, summary + appended), 'Verdict output differs')
    refusal = verdict['refusals'].decode()
    if refusal.strip():
        base_move.require(output.get('title') == 'refused' and check['conclusion'] == 'failure'
                and summary.startswith('Refused:\n' + ''.join('- ' + line + '\n' for line in refusal.splitlines())),
                'Verdict refusal ground differs')
    return {'run': data['run'], 'attempt': data['attempt'], 'head': run['head_sha'],
            'check': listed['id'], 'current_base': current, 'output': output, 'refusals': refusal,
            'producer': {'head_ref': producer['head_branch'], 'pr': pr['number']}}
