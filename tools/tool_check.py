#!/usr/bin/python3 -I
from __future__ import annotations

"""The tool step: a release candidate's changed skills and tools run their own checks before it is judged.

Usage: tools/tool_check.py --cli LIVE/bin/aim-next --profile /abs/agent.json --out /abs/new-dir
         [--items /abs/items.json] [--python P] [--node N]

It speaks for HEAD of the checkout this file lives in (docs/skills-and-tools.md, section 4, and docs/tools.md,
"Tool check"). A tool changed when its content id differs between the live release's commit and HEAD. Each changed
tool with a check runs it once, at HEAD, in a fresh detached worktree outside the checkout. When every one passes,
the release goes on at HEAD. A tool whose check did not pass goes back: every path it names, at either commit, gets
its live content, in one commit on top of HEAD, and the release is checked again there; a still-new tool that fails
there goes back too, round after round. A tool that went back and still fails at its live content stops the release
(exit 1): something else in it breaks the tool. Every run is recorded in the tool's home through the live CLI
(tool-record), each version that went back opening a topic there, and only then is the checkout fast-forwarded to
the new commit. Exit 0: the release goes on (summary.json in --out says at which commit); 1: the release stops;
2: refused, naming the first problem, with nothing run or written (or, after the checks, nothing recorded twice and
the checkout not moved).

It is ordinary code: the deploy does not load it. --items is the train's items, [{"item": N, "approved_head": SHA}].
"""

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aim_next import tool_records, tool_words  # noqa: E402
from aim_next.tools_core import FAILING_BYTES, FAILING_NAMES, WHY_BYTES  # noqa: E402
from tools import release_check  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
PYTHON = "/usr/bin/python3"
NODE = "node"
LEDGER = "tests/acts.json"
LEDGER_TAIL = "\n ]\n}\n"
SHA = re.compile(r"[0-9a-f]{40}")
FILE_MODES = ("100644", "100755")
NO_ITEMS = "a tool went back, and without --items it cannot say which items carry its change"


class Refused(Exception):
    """Exit 2: the step cannot speak for this commit. The first line names the first problem; more lists the rest."""

    def __init__(self, first, more=()):
        self.first, self.more = first, list(more)
        super().__init__(first)


class Stopped(Exception):
    """Exit 1: a tool that went back fails at its live version too, so the release stops."""


class LiveCli:
    """The live release's agent CLI, run by the system interpreter as the live code is. The tests pass a typed
    stand-in with the same four methods instead."""

    def __init__(self, cli, profile, python=PYTHON):
        self.cli, self.profile, self.python = str(cli), str(profile), python
        self._binding = None

    def actor(self):
        try:
            actor = json.loads(Path(self.profile).read_text(encoding="utf-8")).get("actor_id")
        except (OSError, ValueError, AttributeError) as error:
            raise Refused("the profile %s could not be read: %s" % (self.profile, error))
        if not isinstance(actor, str):
            raise Refused("the profile %s names no actor" % self.profile)
        return actor

    def live_commit(self):
        try:
            return release_check.live_commit(self.cli, self.profile)
        except release_check.Refused as error:
            raise Refused(str(error).replace("--base: ", ""))

    def _run(self, argv, request=None):
        answer = subprocess.run([self.python, "-I", "-B", self.cli, "--profile", self.profile] + argv, capture_output=True, text=True,
                                input=None if request is None else json.dumps(request), stdin=subprocess.DEVNULL if request is None else None)
        lines = [line for line in answer.stdout.splitlines() if line.startswith("{")]
        try:
            return answer.returncode, json.loads(lines[-1]) if lines else None, answer.stderr.strip()
        except ValueError:
            return answer.returncode, None, answer.stderr.strip()

    def view(self, name, args):
        if self._binding is None:
            code, answer, said = self._run(["binding"])
            if code != 0 or not isinstance(answer, dict) or "binding" not in answer:
                raise Refused("the live CLI's binding could not be read (exit %s): %s" % (code, said))
            self._binding = answer["binding"]
        code, answer, said = self._run(["view", "-"], {"v": 1, "binding": self._binding, "view": {"name": name, "args": args}})
        if not isinstance(answer, dict):
            raise Refused("the live CLI did not answer the %s view (exit %s): %s" % (name, code, said))
        return answer

    def record(self, path):
        code, answer, said = self._run(["--json", "tool-record", str(path)])
        if not isinstance(answer, dict):
            raise Refused("the live CLI did not answer tool-record %s (exit %s): %s" % (path, code, said))
        return answer


# Git ------------------------------------------------------------------------------------------------------------------

def git(root, *args, env=None, data=None):
    """git's stdout as bytes; a git that fails is a refusal, never "nothing there"."""
    answer = subprocess.run(["git", "-C", str(root)] + list(args), capture_output=True, input=data,
                            stdin=subprocess.DEVNULL if data is None else None, env=env)
    if answer.returncode != 0:
        raise Refused("git %s failed: %s" % (" ".join(args[:3]), answer.stderr.decode("utf-8", "replace").strip()))
    return answer.stdout


def text(root, *args, **options):
    return git(root, *args, **options).decode("utf-8").strip()


class Tree:
    """Every path at one commit or tree, with its mode and blob, read once from git."""

    def __init__(self, root, ref):
        self.root, self.entries = root, {}
        self.tree_sha = text(root, "rev-parse", "--verify", ref + "^{tree}")
        for entry in git(root, "ls-tree", "-r", "-z", "--full-tree", ref).split(b"\0"):
            if entry:
                meta, _, path = entry.decode("utf-8").partition("\t")
                mode, kind, sha = meta.split(" ")
                self.entries[path] = (mode, kind, sha)
        self._blobs = {}

    def data(self, path):
        if path not in self._blobs:
            self._blobs[path] = git(self.root, "cat-file", "blob", self.entries[path][2])
        return self._blobs[path]

    def kind(self, path):
        entry = self.entries.get(path)
        return None if entry is None else "file" if entry[0] in FILE_MODES and entry[1] == "blob" else "other"

    def records(self):
        records, problems = tool_records.read(list(self.entries), self.data, self.kind)
        content = {tool_id: tool_records.content_id([(path, self.data(path)) for path in tool_records.paths(record)])
                   for tool_id, record in records.items()} if not problems else {}
        return records, problems, content


# Counting a check's run, by the release check's own rules ---------------------------------------------------------------

def _cut(words, most):
    data = words.encode("utf-8")[:most]
    return data.decode("utf-8", "ignore").strip()


def _failing(names):
    """Each failing test once, in the order the report names them, cut to FAILING_BYTES at a character's edge."""
    distinct = []
    for name in names:
        name = _cut(name, FAILING_BYTES)
        if name and name not in distinct:
            distinct.append(name)
    return distinct


def python_result(log, code):
    """(result, passed, total, failing, why) for `unittest -v`'s output and exit code."""
    counts, judged = release_check.python_counts(log)
    ran, skipped = counts["tests"], counts.get("skipped", 0)
    total = ran - skipped
    loader = re.findall(r"^(?:FAIL|ERROR): \S+ \(unittest\.loader\._FailedTest[^)]*\)", log, re.M)
    if counts["status"] is None:
        return "counted_nothing", None, None, [], "it exited %d and printed no test count" % code
    if loader:
        return "counted_nothing", None, None, [], "its module could not be loaded"
    if total < 1:
        return "counted_nothing", None, None, [], tool_words.RAN_NO_TESTS
    if judged and code == 0:
        return "passed", total, total, [], None
    names = _failing(re.findall(r"^(?:FAIL|ERROR): (\S+)", log, re.M))
    if counts["status"] != "FAILED" or not names:
        return "counted_nothing", None, None, [], "it exited %d and named no failing test" % code
    return "failed", max(0, total - len(names)), total, names, None


def node_result(log, code):
    """(result, passed, total, failing, why) for `node --test --test-reporter=tap`'s output and exit code."""
    counts, judged = release_check.node_counts(log)
    if "tests" not in counts:
        return "counted_nothing", None, None, [], "it exited %d and printed no test count" % code
    total = counts.get("pass", 0) + counts.get("fail", 0) + counts.get("cancelled", 0)
    if total < 1:
        return "counted_nothing", None, None, [], tool_words.RAN_NO_TESTS
    if judged and code == 0:
        return "passed", counts.get("pass", 0), total, [], None
    names = _failing(re.sub(r"\s+#\s.*$", "", name) for name in re.findall(r"^\s*not ok \d+ - (.*)$", log, re.M))
    if not names or counts.get("pass", 0) >= total:
        return "counted_nothing", None, None, [], "it exited %d and named no failing test" % code
    return "failed", counts.get("pass", 0), total, names, None


# The step ---------------------------------------------------------------------------------------------------------------

class Step:
    def __init__(self, root, out, cli, items=None, python=PYTHON, node=NODE, say=None):
        self.root, self.out, self.cli, self.items = Path(root), Path(out), cli, items
        self.python, self.node = python, node
        self.say = say or (lambda line: print(line, flush=True))
        self.runs, self.logs = [], 0

    # Refusals, before anything runs or is written.

    def refusals(self):
        root, out = self.root, self.out
        if text(root, "status", "--porcelain=v1", "--untracked-files=all"):
            raise Refused("the checkout %s has tracked or untracked changes" % root)
        if not out.is_absolute():
            raise Refused("--out %s is not absolute" % out)
        if out.exists() and (not out.is_dir() or out.is_symlink() or any(out.iterdir())):
            raise Refused("--out %s is not a new, empty directory" % out)
        top = Path(text(root, "rev-parse", "--show-toplevel")).resolve()
        resolved = out.resolve() if out.exists() else out.parent.resolve() / out.name
        if resolved == top or top in resolved.parents:
            ignored = subprocess.run(["git", "-C", str(root), "check-ignore", "-q", str(resolved)], stdin=subprocess.DEVNULL).returncode == 0
            if not ignored:
                raise Refused("--out %s is inside the checkout and not ignored" % out)
        self.head = text(root, "rev-parse", "--verify", "HEAD^{commit}")
        self.live = self.cli.live_commit()
        if not SHA.fullmatch(str(self.live)):
            raise Refused("the live release's commit could not be read with the live CLI")
        if subprocess.run(["git", "-C", str(root), "cat-file", "-e", self.live + "^{commit}"], stdin=subprocess.DEVNULL,
                          capture_output=True).returncode != 0:
            raise Refused("the live release's commit %s is not in this repository" % self.live)
        if subprocess.run(["git", "-C", str(root), "merge-base", "--is-ancestor", self.live, self.head], stdin=subprocess.DEVNULL).returncode != 0:
            raise Refused("the live release's commit %s is not an ancestor of HEAD %s" % (self.live, self.head))
        if self.items is not None:
            for item in self.items:
                if subprocess.run(["git", "-C", str(root), "cat-file", "-e", item["approved_head"] + "^{commit}"], stdin=subprocess.DEVNULL,
                                  capture_output=True).returncode != 0:
                    raise Refused("item %d: its approved head %s is not in this repository" % (item["item"], item["approved_head"]))
        self.trees = {"live": Tree(root, self.live), "head": Tree(root, self.head)}
        self.at = {}
        for side in ("head", "live"):
            records, problems, content = self.trees[side].records()
            if problems:
                # HEAD's problems in the parser's own words, as tests/test_tool_records.py says them; the live commit's
                # (read by this code's parser, which may be stricter than the live code's) say where they are.
                where = "" if side == "head" else "at the live commit %s: " % self.live[:12]
                raise Refused(where + problems[0], [where + problem for problem in problems[1:]])
            self.at[side] = (records, content)
        live, head = self.at["live"], self.at["head"]
        self.changed = sorted(tool_id for tool_id in set(live[0]) | set(head[0]) if live[1].get(tool_id) != head[1].get(tool_id))
        self.checked = [tool_id for tool_id in self.changed if tool_id in head[0] and head[0][tool_id]["check"]]
        self.recordable, self.why_not = self._recordable()
        if self.recordable:
            actor = self.cli.actor()
            homes = set()
            for tool_id in self.checked:
                homes.add(head[0][tool_id]["home"])
                if tool_id in live[0] and live[0][tool_id]["check"]:
                    homes.add(live[0][tool_id]["home"])
            for home in sorted(homes):
                self._may_record(actor, home)

    def _recordable(self):
        """Whether the live code keeps tool runs: its views know the tool view."""
        if not self.checked:
            return True, None
        answer = self.cli.view("tool", {"tool_id": self.checked[0]})
        code = (answer.get("error") or {}).get("code")
        if code == "UNKNOWN_VIEW":
            return False, "the live code has no tool.record"
        if code not in (None, "TOOL_NOT_FOUND"):
            raise Refused("the live code's tools could not be read: %s: %s" % (code, answer["error"].get("message")))
        return True, None

    def _may_record(self, actor, home):
        kind = self.cli.view("capabilities", {})
        if kind.get("error") or kind.get("actor_kind") != "agent":
            raise Refused("%s is not an agent, so it cannot record in %s" % (actor, home))
        cursor = None
        while True:
            args = {"workspace_id": home, "limit": 100}
            if cursor is not None:
                args["cursor"] = cursor
            page = self.cli.view("workspace_members", args)
            if page.get("error"):
                raise Refused("%s cannot record in %s, a changed tool's home: %s" % (actor, home, page["error"].get("message")))
            if any(member.get("actor_id") == actor for member in page.get("items", [])):
                return
            cursor = page.get("next_cursor")
            if cursor is None:
                raise Refused("%s is not on %s, a changed tool's home, so it cannot record there" % (actor, home))

    # Running one check.

    def run_check(self, tool_id, record, tree, commit, round_number):
        """Run the record's check once, at `tree`, in a fresh detached worktree outside the checkout."""
        runner, module = next(iter(record["check"].items()))
        self.logs += 1
        name = "%02d-round%d-%s" % (self.logs, round_number, tool_id)
        log = self.out / "logs" / (name + ".log")
        log.parent.mkdir(parents=True, exist_ok=True)
        place = Path(tempfile.mkdtemp(prefix="tool-check-")) / "wt"
        git(self.root, "worktree", "add", "--detach", "--quiet", str(place), self.head)
        try:
            if tree != self.trees["head"].tree_sha:
                git(place, "read-tree", "-u", "--reset", tree)
            if runner == "python":
                argv = [self.python, "-m", "unittest", "discover", "-s", "tests", "-p", module.split("/", 1)[1], "-v"]
            else:
                argv = [self.node, "--test", "--test-reporter=tap", module]
            env = dict(os.environ, PYTHONPYCACHEPREFIX=str(self.out / "pyc" / name))
            with open(log, "wb") as handle:
                code = subprocess.run(argv, cwd=str(place), stdin=subprocess.DEVNULL, stdout=handle, stderr=subprocess.STDOUT, env=env).returncode
        finally:
            git(self.root, "worktree", "remove", "--force", str(place))
            shutil.rmtree(str(place.parent), ignore_errors=True)
        said = log.read_text(errors="replace")
        result, passed, total, failing, why = (python_result if runner == "python" else node_result)(said, code)
        run = {"tool_id": tool_id, "name": record["name"], "home": record["home"], "check_path": module, "tree": tree, "commit": commit,
               "round": round_number, "result": result, "passed": passed, "total": total, "failing": failing[:FAILING_NAMES],
               "failing_more": max(0, len(failing) - FAILING_NAMES), "why": None if why is None else _cut(why, WHY_BYTES), "exit": code,
               "log": str(log)}
        self.runs.append(run)
        self.say("%s: round %d: %s" % (tool_id, round_number, self._found(run)))
        return run

    @staticmethod
    def _found(run):
        if run["result"] == "passed":
            return "passed %d of %d" % (run["passed"], run["total"])
        if run["result"] == "failed":
            return tool_words.found(run)
        return run["why"]

    # Going back.

    def restored_paths(self, back):
        live, head = self.at["live"][0], self.at["head"][0]
        paths = set()
        for tool_id in back:
            for records in (live, head):
                if tool_id in records:
                    paths.update(tool_records.paths(records[tool_id]))
        return paths

    def ledger(self, paths):
        """HEAD's act ledger with the rows new since live that name a restored path removed, and the live rows naming one
        that HEAD lost put back: edited as text, as release-squash.py edits it, never re-dumped. None when unchanged."""
        head, live = self.trees["head"], self.trees["live"]
        if head.kind(LEDGER) != "file":
            return None
        ledger = head.data(LEDGER).decode("utf-8")
        old = json.loads(live.data(LEDGER).decode("utf-8"))["acts"] if live.kind(LEDGER) == "file" else []
        key = lambda row: json.dumps(row, sort_keys=True)
        names = lambda row: {entry[0] for entry in row.get("break", [])} | _check_module(row.get("check") or {})
        rows = json.loads(ledger)["acts"]
        live_keys, head_keys = {key(row) for row in old}, {key(row) for row in rows}
        gone = [row for row in rows if key(row) not in live_keys and names(row) & paths]
        back = [row for row in old if key(row) not in head_keys and names(row) & paths]
        if not gone and not back:
            return None
        for row in gone:
            piece = _row_text(row)
            for candidate in (",\n" + piece, piece + ",\n", piece):
                if ledger.count(candidate) == 1:
                    ledger = ledger.replace(candidate, "")
                    break
            else:
                raise Refused("the ledger row for item %s is not found exactly once in %s" % (row.get("item"), LEDGER))
        if not ledger.endswith(LEDGER_TAIL):
            raise Refused("%s does not end as the ledger does" % LEDGER)
        body = ledger[:-len(LEDGER_TAIL)]
        joiner = ",\n" if not body.rstrip().endswith("[") else "\n"
        ledger = body + "".join((joiner if index == 0 else ",\n") + _row_text(row) for index, row in enumerate(back)) + LEDGER_TAIL
        got = sorted(key(row) for row in json.loads(ledger)["acts"])
        if got != sorted([key(row) for row in rows if row not in gone] + [key(row) for row in back]):
            raise Refused("the edited ledger does not hold exactly HEAD's rows less those that left, with the live rows put back")
        return ledger

    def restore(self, back, round_number):
        """The restored tree: HEAD with every path of every tool in `back` at its live content, or removed."""
        paths = self.restored_paths(back)
        index = self.out / "index" / ("round-%d" % round_number)
        index.parent.mkdir(parents=True, exist_ok=True)
        env = dict(os.environ, GIT_INDEX_FILE=str(index))
        git(self.root, "read-tree", self.head, env=env)
        live = self.trees["live"]
        for path in sorted(paths):
            entry = live.entries.get(path)
            if entry is not None:
                git(self.root, "update-index", "--add", "--cacheinfo", "%s,%s,%s" % (entry[0], entry[2], path), env=env)
            elif path in self.trees["head"].entries:
                git(self.root, "update-index", "--force-remove", "--", path, env=env)
        ledger = self.ledger(paths)
        if ledger is not None:
            blob = text(self.root, "hash-object", "-w", "--stdin", data=ledger.encode("utf-8"))
            git(self.root, "update-index", "--add", "--cacheinfo", "100644,%s,%s" % (blob, LEDGER), env=env)
        return text(self.root, "write-tree", env=env), paths

    def items_back(self, paths):
        """The --items whose change, from their merge base with the live commit to their approved head, touches a path."""
        taken = []
        for item in self.items:
            base = text(self.root, "merge-base", self.live, item["approved_head"])
            touched = set(git(self.root, "diff", "--name-only", "-z", "--no-renames", base, item["approved_head"]).decode("utf-8").split("\0")) - {""}
            if touched & paths:
                taken.append(item["item"])
        return sorted(taken)

    def message(self, back, items):
        head = self.at["head"][0]
        runs = {run["tool_id"]: run for run in self.runs if run["tool_id"] in back and run["result"] != "passed" and run.get("went_back")}
        names = [head[tool_id]["name"] for tool_id in back]
        lines = ["Tools back to their live versions: " + ", ".join(names), ""]
        for tool_id in back:
            run = runs[tool_id]
            if run["result"] == "failed":
                said = "its check failed, %s failed" % tool_words.counts(run["total"] - run["passed"], run["total"])
            elif run["why"] == tool_words.RAN_NO_TESTS:
                said = "its check ran no tests"
            else:
                said = "its check could not run, %s" % run["why"]
            lines.append("%s: %s (%s)." % (run["name"], said, run["check_path"]))
        if items:
            lines += ["", "Train-Item: Revert " + ", ".join(str(item) for item in items)]
        return "\n".join(lines) + "\n"

    def commit(self, tree, back, items):
        """The restored commit on HEAD, with HEAD's committer and date as its author, committer and dates: the same
        input always makes the same commit."""
        name, email, date = git(self.root, "log", "-1", "--format=%cn%x00%ce%x00%cd", "--date=raw", self.head).decode("utf-8").strip().split("\0")
        env = dict(os.environ, GIT_AUTHOR_NAME=name, GIT_AUTHOR_EMAIL=email, GIT_AUTHOR_DATE=date,
                   GIT_COMMITTER_NAME=name, GIT_COMMITTER_EMAIL=email, GIT_COMMITTER_DATE=date)
        return text(self.root, "commit-tree", tree, "-p", self.head, "-F", "-", env=env, data=self.message(back, items).encode("utf-8"))

    # The whole step.

    def go(self):
        self.refusals()
        self.out.mkdir(parents=True, exist_ok=True)
        head_records = self.at["head"][0]
        live_records = self.at["live"][0]
        summary = {"head_in": self.head, "live_commit": self.live, "changed": self.changed, "rounds": 0, "back": [], "items_back": [],
                   "recorded": self.recordable, "why": self.why_not, "records": []}
        self.say("live %s, HEAD %s: changed %s" % (self.live[:12], self.head[:12], ", ".join(self.changed) or "nothing"))
        back, new, rounds, tree = [], list(self.checked), [], self.trees["head"].tree_sha
        while True:
            number = len(rounds) + 1
            rounds.append({"round": number, "tree": tree, "back_before": list(back)})
            failed = []
            for tool_id in new:
                run = self.run_check(tool_id, head_records[tool_id], tree, None, number)
                run["fate"] = "new"
                if run["result"] != "passed":
                    run["fate"], run["went_back"] = "back", True
                    failed.append(tool_id)
            if failed:
                back += failed
                new = [tool_id for tool_id in new if tool_id not in failed]
                if self.items is None:
                    raise Refused(NO_ITEMS)
                if not self.recordable:
                    raise Refused("a tool went back, and %s, so its topic cannot open" % self.why_not)
                tree, _ = self.restore(back, number + 1)
                continue
            if not back:
                break
            # The tools that went back run their checks as the live commit has them, and must pass.
            for tool_id in back:
                record = live_records.get(tool_id)
                if record is None or not record["check"]:
                    continue
                run = self.run_check(tool_id, record, tree, None, number)
                run["fate"] = "live"
                if run["result"] != "passed":
                    summary.update(rounds=len(rounds), back=back, stopped=tool_id, runs=self.runs, head_out=None)
                    self._summary(summary)
                    raise Stopped("%s's check fails with it at its live version too: something else in this release breaks it (%s: %s). "
                                  "The release stops." % (record["name"], record["check"][next(iter(record["check"]))],
                                                          ", ".join(run["failing"]) or run["why"]))
            break
        summary.update(rounds=len(rounds), back=back)
        items, paths = [], set()
        if back:
            paths = self.restored_paths(back)
            items = self.items_back(paths)
            # Each round's tree becomes a commit once the step will go on, so every run names the commit it ran on.
            commits = {self.trees["head"].tree_sha: self.head}
            for entry in rounds[1:]:
                commits[entry["tree"]] = self.commit(entry["tree"], entry["back_before"], self.items_back(self.restored_paths(entry["back_before"])))
            head_out = commits[tree]
        else:
            commits, head_out = {tree: self.head}, self.head
        for run in self.runs:
            run["commit"] = commits[run["tree"]]
        summary.update(items_back=items, head_out=head_out, restored_paths=sorted(paths))
        if self.recordable:
            summary["records"] = self.record(back, head_out, items)
        summary["runs"] = self.runs
        self._summary(summary)
        if head_out != self.head:
            git(self.root, "merge", "--ff-only", "--quiet", head_out)
            self.say("went back: %s; items taken back: %s; the release goes on at %s" % (", ".join(back), ", ".join(map(str, items)) or "none", head_out))
        else:
            self.say("the release goes on at HEAD %s" % head_out)
        return summary

    def record(self, back, head_out, items):
        """Every back run (from the round it failed in), then every run on the commit that ships (live for a tool that
        went back, new for one that stayed new), recorded through the live CLI in that order; a refusal stops the step
        before the checkout moves. A still-new tool's runs in earlier rounds were on commits that never ship."""
        head_records, live_records = self.at["head"][0], self.at["live"][0]
        head_content, live_content = self.at["head"][1], self.at["live"][1]
        chosen = [run for run in self.runs if run["fate"] == "back"]
        chosen += [run for run in self.runs if run["fate"] == "live" and run["commit"] == head_out]
        chosen += [run for run in self.runs if run["fate"] == "new" and run["commit"] == head_out]
        receipts = []
        directory = self.out / "records"
        directory.mkdir(exist_ok=True)
        for number, run in enumerate(chosen, 1):
            tool_id = run["tool_id"]
            live = run["fate"] == "live"
            record = (live_records if live else head_records)[tool_id]
            row = {"tool_id": tool_id, "name": record["name"], "content_id": (live_content if live else head_content)[tool_id],
                   "commit_sha": run["commit"], "tree_sha": run["tree"], "live_commit": self.live, "check_path": run["check_path"],
                   "result": run["result"], "passed": run["passed"], "total": run["total"], "failing": run["failing"],
                   "failing_more": run["failing_more"], "why": run["why"], "fate": run["fate"],
                   "first_version": 1 if run["fate"] == "back" and tool_id not in live_records else 0,
                   "items_back": self.items_back(self.restored_paths([tool_id])) if run["fate"] == "back" else [],
                   "home_workspace_id": record["home"]}
            path = directory / ("%02d-%s-%s.json" % (number, tool_id, run["fate"]))
            path.write_text(json.dumps(row, indent=1) + "\n", encoding="utf-8")
            receipt = self.cli.record(path)
            error = receipt.get("error")
            if error or receipt.get("status") not in (None, "committed"):
                raise Refused("recording %s's %s run was refused: %s: %s" % (tool_id, run["fate"], (error or {}).get("code"), (error or {}).get("message")))
            result = receipt.get("result") or {}
            topic = ((result.get("run") or {}).get("topic") or {}).get("topic_id")
            receipts.append({"tool_id": tool_id, "fate": run["fate"], "file": str(path), "recorded": result.get("recorded"), "topic_id": topic})
            self.say("recorded %s %s%s%s" % (tool_id, run["fate"], "" if result.get("recorded") else " (already recorded)",
                                             " (topic %s)" % topic if topic else ""))
        return receipts

    def _summary(self, summary):
        (self.out / "summary.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def _row_text(row):
    return "\n".join("  " + line for line in json.dumps(row, indent=1, ensure_ascii=False).split("\n"))


def _check_module(check):
    """The repository path of an act's unit check: {"python": "test_x.py"} is tests/test_x.py, {"node": PATH} is PATH."""
    if "python" in check:
        return {"tests/" + check["python"]}
    if "node" in check:
        return {check["node"]}
    return set()


def read_items(path):
    try:
        items = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise Refused("--items %s could not be read: %s" % (path, error))
    if not isinstance(items, list) or not all(isinstance(item, dict) and set(item) == {"item", "approved_head"}
                                               and isinstance(item["item"], int) and not isinstance(item["item"], bool) and item["item"] >= 1
                                               and isinstance(item["approved_head"], str) and SHA.fullmatch(item["approved_head"])
                                               for item in items):
        raise Refused("--items is a list of {\"item\": N, \"approved_head\": SHA}")
    if len({item["item"] for item in items}) != len(items):
        raise Refused("--items names an item twice")
    return items


def main(argv=None, cli=None, root=ROOT, stdout=None, stderr=None):
    stdout, stderr = stdout or sys.stdout, stderr or sys.stderr
    parser = argparse.ArgumentParser(prog="tool_check.py")
    parser.add_argument("--cli", required=cli is None)
    parser.add_argument("--profile", required=cli is None)
    parser.add_argument("--out", required=True)
    parser.add_argument("--items")
    parser.add_argument("--python", default=PYTHON)
    parser.add_argument("--node", default=NODE)
    options = parser.parse_args(argv)
    say = lambda line: print(line, file=stdout, flush=True)
    try:
        for name in ("cli", "profile", "items"):
            value = getattr(options, name)
            if value is not None and not Path(value).is_absolute():
                raise Refused("--%s %s is not absolute" % (name, value))
        items = read_items(options.items) if options.items else None
        live = cli or LiveCli(options.cli, options.profile)
        Step(root, Path(options.out), live, items, options.python, options.node, say).go()
        return 0
    except Refused as refused:
        print("tool_check: refused: " + refused.first, file=stderr, flush=True)
        for more in refused.more:
            print("  " + more, file=stderr, flush=True)
        return 2
    except Stopped as stopped:
        print("tool_check: " + str(stopped), file=stderr, flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
