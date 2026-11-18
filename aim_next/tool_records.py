from __future__ import annotations

"""Skill and tool records (item 17; docs/skills-and-tools.md): the parser, the rules across records, and the content id.

One JSON file per skill or tool, skills/<id>.json, names its home outcome, its files and its check. Everything here is
pure: it reads bytes and a file listing given to it, so the server (its own checkout), the CLI, the tool step (git's
blobs at a commit) and tests/test_tool_records.py read records by one rule and compute one content id.
"""

import hashlib
import json
import re

KEYS = ("id", "kind", "name", "summary", "home", "files", "check")
KINDS = ("skill", "tool")
ID = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
RECORD = re.compile(r"skills/([^/]+)\.json")
# Where a tool's files may live.
ROOTS = ("skills/", "tools/", "tests/")
CHECKS = {"python": re.compile(r"tests/test_[^/]+\.py"), "node": re.compile(r"tests/[^/]+\.test\.mjs")}
# Never a tool's file (R3): deploy and the release checks stay ordinary code. The closed lists, read from the code that
# guards each by tests/test_tool_records.py, so a file that starts being guarded there is named here or that test fails.
# tools/train.py's DEPLOY_TOOL and MIGRATIONS (its CONTROLLER, .github/, is outside ROOTS):
DEPLOY_OWN = ("aim_next/migrations.py", "tools/base_move.py", "tools/checks.py", "tools/ci-input-reads.json", "tools/ci_input_reads.py",
              "tools/ci_known_reds.py", "tools/continuation_envelope.py", "tools/deploy.py", "tools/known_reds.py", "tools/quarantine.py",
              "tools/own_case_receipt.py", "tools/release_check.py", "tools/releases.py", "tools/steps_for.py", "tools/train.py")
# tools/release_check.py and every file it runs besides the unit modules: release_check.harnesses(), the native harnesses
# with the wake replay, its stand-in and its traffic.
RELEASE_CHECK_OWN = ("tests/card_marks_native.mjs", "tests/fence_copy_native.mjs", "tests/fixtures/replay/wake-2026-11-05.json",
                     "tests/reader_compose_native.mjs", "tests/reader_native.mjs", "tests/reader_openings_native.mjs",
                     "tests/reader_persistence_native.mjs", "tests/webkit_native.mjs", "tools/release_check.py",
                     "tools/wake_replay.py", "tools/wake_standin.py")
# The tool step itself, and the act ledger it edits when a tool goes back.
STEP_OWN = ("tests/acts.json", "tools/tool_check.py")
OWN_WORDS = ((DEPLOY_OWN, "the deploy's own code"), (RELEASE_CHECK_OWN, "the release check's own code"),
             (STEP_OWN, "the tool step's own code"))
NAME_CHARACTERS, SUMMARY_CHARACTERS, HOME_CHARACTERS, ID_CHARACTERS = 60, 200, 200, 40


class Unreadable(Exception):
    """The records could not be read or do not pass the parser: never "no tools"."""

    def __init__(self, path, problems):
        self.path, self.problems = path, list(problems)
        super().__init__("; ".join(self.problems))


def _unique(pairs):
    found = {}
    for key, value in pairs:
        if key in found:
            raise ValueError("the key %r is given twice" % key)
        found[key] = value
    return found


def _line(value, most):
    return isinstance(value, str) and 1 <= len(value) <= most and value.strip() == value and value \
        and not any(ord(c) < 32 or ord(c) == 127 for c in value)


def _path_problem(path):
    """Why a listed path is not a repository path a tool may name, or None."""
    if not isinstance(path, str) or not path:
        return "a file is not a path"
    if any(ord(c) < 32 or ord(c) == 127 for c in path) or "\\" in path:
        return "%r is not a plain repository path" % path
    parts = path.split("/")
    if path.startswith("/") or any(part in ("", ".", "..") for part in parts):
        return "%s is not a plain repository path (no leading /, no empty, . or .. parts)" % path
    if not path.startswith(ROOTS):
        return "%s is not under skills/, tools/ or tests/" % path
    return None


def parse(path, data):
    """(record, problems) for one record file's bytes; record is None when it cannot be read at all."""
    match = RECORD.fullmatch(path)
    if match is None:
        return None, ["%s is not a record's path (skills/<id>.json)" % path]
    try:
        value = json.loads(data.decode("utf-8"), object_pairs_hook=_unique)
    except (UnicodeError, ValueError) as error:
        return None, ["%s is not JSON: %s" % (path, error)]
    if not isinstance(value, dict):
        return None, ["%s is not a JSON object" % path]
    problems = ["%s: unknown key %r" % (path, key) for key in sorted(set(value) - set(KEYS))]
    problems += ["%s: it has no %r" % (path, key) for key in KEYS if key not in value]
    if problems:
        return None, problems
    record = dict(value)
    if not (isinstance(record["id"], str) and len(record["id"]) <= ID_CHARACTERS and ID.fullmatch(record["id"])):
        problems.append("%s: its id is not lowercase words joined by hyphens, at most %d characters" % (path, ID_CHARACTERS))
    elif record["id"] != match.group(1):
        problems.append("%s: its id %r is not its file's name" % (path, record["id"]))
    if record["kind"] not in KINDS:
        problems.append("%s: its kind is skill or tool" % path)
    if not _line(record["name"], NAME_CHARACTERS):
        problems.append("%s: its name is 1 to %d characters on one line" % (path, NAME_CHARACTERS))
    if not _line(record["summary"], SUMMARY_CHARACTERS):
        problems.append("%s: its summary is 1 to %d characters on one line" % (path, SUMMARY_CHARACTERS))
    if not _line(record["home"], HOME_CHARACTERS):
        problems.append("%s: its home is an outcome's id, at most %d characters" % (path, HOME_CHARACTERS))
    files = record["files"]
    if not isinstance(files, list) or not files:
        problems.append("%s: it lists at least one file" % path)
        files = []
    for file in files:
        problem = _path_problem(file)
        if problem:
            problems.append("%s: %s" % (path, problem))
            continue
        for own, words in OWN_WORDS:
            if file in own:
                problems.append("%s names %s, which is %s; deploy and the release checks stay ordinary code." % (path, file, words))
        if RECORD.fullmatch(file):
            problems.append("%s names %s, which is a record of its own" % (path, file))
    seen = [file for file in files if isinstance(file, str)]
    for file in sorted({file for file in seen if seen.count(file) > 1}):
        problems.append("%s lists %s twice" % (path, file))
    check = record["check"]
    if check is not None:
        if not isinstance(check, dict) or len(check) != 1 or next(iter(check)) not in CHECKS:
            problems.append("%s: its check is null, {\"python\": PATH} or {\"node\": PATH}" % path)
        else:
            (runner, module), = check.items()
            if not isinstance(module, str) or not CHECKS[runner].fullmatch(module):
                problems.append("%s: its %s check is %s" % (path, runner, "a tests/test_*.py module" if runner == "python" else "a tests/*.test.mjs module"))
            elif module not in seen:
                problems.append("the check %s is not one of %s's files." % (module, record["id"]))
    return record, problems


def read(listing, data_of, kind_of):
    """({id: record}, problems) for every record at one commit or checkout.

    listing: every path there; data_of(path): its bytes; kind_of(path): "file" for a regular file, anything else
    (a directory, a link, None for none) for what is not one. Every problem is listed, by file."""
    records, problems, owners = {}, [], {}
    for path in sorted(path for path in listing if RECORD.fullmatch(path)):
        record, found = parse(path, data_of(path))
        problems += found
        if record is None:
            continue
        records[record["id"]] = record
        for file in record["files"] if isinstance(record["files"], list) else []:
            if not isinstance(file, str) or _path_problem(file):
                continue
            owners.setdefault(file, []).append(record["id"])
            if kind_of(file) != "file":
                problems.append("%s names %s, which is not a regular file here" % (path, file))
    for file, ids in sorted(owners.items()):
        if len(set(ids)) > 1:
            problems.append("%s belongs to two tools: %s." % (file, " and ".join(sorted(set(ids)))))
    return records, problems


def _file_of(problem, records):
    """The record file a problem is about: the first record path in its words, or the record of the first id it names."""
    found = re.search(r"skills/[^ :/]+\.json", problem)
    if found:
        return found.group()
    for tool_id in sorted(records, key=lambda tool_id: problem.find(tool_id) if tool_id in problem else len(problem)):
        if tool_id in problem:
            return "skills/%s.json" % tool_id
    return "skills/"


def paths(record):
    """The record's own file and each of its files: its content."""
    return ["skills/%s.json" % record["id"]] + list(record["files"])


def content_id(entries):
    """The sha256 of the lines PATH\\0SHA256(BYTES)\\n for each (path, bytes), sorted by path."""
    lines = "".join("%s\0%s\n" % (path, hashlib.sha256(data).hexdigest()) for path, data in sorted(entries))
    return hashlib.sha256(lines.encode("utf-8")).hexdigest()


def check_path(record):
    """The check's module, or None for a record with no check."""
    return next(iter(record["check"].values())) if record.get("check") else None


class Records:
    """The records a process read once, when it started, from the files of its own checkout (or a directory a test
    passes in). error is the first problem, naming its file, when they could not be read: then there are no records,
    never an empty list."""

    def __init__(self, root):
        from pathlib import Path
        self.root = Path(root)
        self.tools, self.content, self.error = {}, {}, None
        try:
            listing = self._listing()
            records, problems = read(listing, self._data, self._kind)
            if problems:
                raise Unreadable(_file_of(problems[0], records), problems)
            self.tools = records
            self.content = {tool_id: content_id([(path, self._data(path)) for path in paths(record)])
                            for tool_id, record in records.items()}
        except Unreadable as error:
            self.tools, self.content, self.error = {}, {}, error
        except OSError as error:
            self.tools, self.content, self.error = {}, {}, Unreadable(getattr(error, "filename", None) or str(self.root / "skills"), [str(error)])

    def _listing(self):
        found = []
        skills = self.root / "skills"
        for record in sorted(skills.glob("*.json")):
            found.append("skills/" + record.name)
        # Every file a record names is looked up by _kind; the listing need only hold the records.
        return found

    def _data(self, path):
        return (self.root / path).read_bytes()

    def _kind(self, path):
        import os
        import stat
        try:
            mode = os.lstat(str(self.root / path)).st_mode
        except FileNotFoundError:
            return None
        return "file" if stat.S_ISREG(mode) else "other"
