#!/usr/bin/python3 -I
from __future__ import annotations

"""Apply a mutant, run the named tests, require a failed assertion, restore, and rerun the tests as a control.

Usage: tools/mutant.py [--name NAME] [--killed-by REGEX] [--evidence DIR]
                       --replace FILE OLD NEW [--replace FILE OLD NEW ...] -- COMMAND [ARG ...]
       tools/mutant.py --verify EVIDENCE
       tools/mutant.py --reviewed EVIDENCE

Each OLD must occur exactly once in its FILE, or nothing is changed. The
command runs with the mutant applied and its own PYTHONPYCACHEPREFIX; it kills
the mutant only by exiting non-zero AND printing a line that matches
--killed-by, by default a failed assertion. The files are then restored byte for byte, and the command runs
again with a fresh PYTHONPYCACHEPREFIX and must pass. Exit 0 means killed,
restored and the control passed; 1 means the mutant survived or the control
failed; 2 means refused before anything changed. Run it in a worktree no one
else is editing: restoring writes the files back as they were at the start.

The verdict names the exact revision: the repository, the checkout's commit
and its uncommitted changes, each file's sha256 before, mutated and restored,
and each replacement. The mutant checkout (that commit, those changes and the
mutant applied) is kept in EVIDENCE/checkout until a reviewer is done with it:
--verify checks the kill against the recorded commit, read from the
repository, which outlives a removed worktree, and --reviewed removes the
checkout and records when. A kill on uncommitted changes, or outside git, does
not verify: no commit holds what ran.
"""

import datetime
import difflib
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile

# A failed assertion: unittest's "FAIL: test_name (...)" or node:assert's ERR_ASSERTION, which both
# node reporters print. Not a summary such as "FAILED (errors=1)", "not ok" or "✖": those also
# follow a test module that could not load, where no assertion ran.
KILLED_BY = r"^FAIL: |\bERR_ASSERTION\b"


class Refused(Exception):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def plan(replacements):
    """[(path, original bytes, mutated bytes)], or Refused if any OLD is not exactly once in its file."""
    changes, seen = [], {}
    for name, old, new in replacements:
        path = Path(name).resolve()
        if old == new:
            raise Refused("the mutant for %s changes nothing" % name)
        original = seen[path] if path in seen else path.read_bytes() if path.is_file() else None
        if original is None:
            raise Refused("no such file: %s" % name)
        count = original.decode().count(old)
        if count != 1:
            raise Refused("%r occurs %d times in %s, not once" % (old, count, name))
        seen[path] = original.decode().replace(old, new).encode()
        changes.append(path)
    originals = {path: path.read_bytes() for path in dict.fromkeys(changes)}
    return [(path, originals[path], seen[path]) for path in originals]


def git(root, *args):
    return subprocess.run(["git", "-C", str(root)] + list(args), capture_output=True)


def revision(paths):
    """{root, git_dir, commit, dirty}: the one checkout every mutated file is in, or their common folder outside git.

    git_dir is the repository's own directory (a worktree's common one), where
    the commit can still be read once the worktree is removed. dirty is git's
    porcelain listing of tracked and untracked changes, so a verdict on an
    uncommitted tree says so; outside git, git_dir, commit and dirty are None."""
    top = git(paths[0].parent, "rev-parse", "--show-toplevel")
    if top.returncode == 0:
        root = Path(top.stdout.decode().strip()).resolve()
        head = git(root, "rev-parse", "--verify", "HEAD^{commit}")
        status = git(root, "status", "--porcelain=v1", "-z", "--untracked-files=all")
        common = git(root, "rev-parse", "--git-common-dir")
        if head.returncode or status.returncode or common.returncode:
            raise Refused("cannot read the git state of %s: %s%s%s" % (root, head.stderr.decode(), status.stderr.decode(),
                                                                      common.stderr.decode()))
        commit, dirty = head.stdout.decode().strip(), porcelain(status.stdout.decode())
        git_dir = str((root / common.stdout.decode().strip()).resolve())
    else:
        root, git_dir, commit, dirty = Path(os.path.commonpath([str(path.parent) for path in paths])), None, None, None
    for path in paths:
        try:
            path.relative_to(root)
        except ValueError:
            raise Refused("%s is not in %s; mutate one checkout at a time" % (path, root))
    return {"root": str(root), "git_dir": git_dir, "commit": commit, "dirty": dirty}


def porcelain(text):
    """Porcelain -z entries as 'XY path' lines; a rename or copy names its new path."""
    fields, entries = text.split("\0"), []
    while fields:
        field = fields.pop(0)
        if not field:
            continue
        entries.append(field)
        if field[0] in "RC" or field[1] in "RC":
            fields.pop(0)  # the path it came from
    return entries


def keep_checkout(found, changes, checkout):
    """The tree the mutant ran in, as files: the commit, the uncommitted changes, then the mutated bytes."""
    root = Path(found["root"])
    if checkout.is_dir():
        # A run reusing an evidence directory replaces its verdict, so the checkout goes with it.
        shutil.rmtree(str(checkout))
    checkout.mkdir()
    if found["commit"] is not None:
        archive = git(root, "archive", "--format=tar", found["commit"])
        if archive.returncode:
            raise Refused("cannot archive %s: %s" % (found["commit"], archive.stderr.decode()))
        with tarfile.open(fileobj=io.BytesIO(archive.stdout)) as tar:
            tar.extractall(str(checkout))
        for entry in found["dirty"]:
            relative = entry[3:]
            source, target = root / relative, checkout / relative
            if os.path.lexists(str(source)):
                target.parent.mkdir(parents=True, exist_ok=True)
                if os.path.lexists(str(target)):
                    target.unlink()
                shutil.copy2(str(source), str(target), follow_symlinks=False)
            elif os.path.lexists(str(target)):
                target.unlink()
    for path, _, mutated in changes:
        target = checkout / path.relative_to(root)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(mutated)


def run(command, log, cache):
    env = dict(os.environ, PYTHONPYCACHEPREFIX=cache)
    with open(log, "wb") as handle:
        try:
            code = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=handle, stderr=subprocess.STDOUT,
                                  env=env).returncode
        except OSError as error:
            handle.write(("could not start %r: %s\n" % (command, error)).encode())
            code = None
    return code, Path(log).read_text(errors="replace")


def mutate(replacements, command, evidence, name="mutant", killed_by=KILLED_BY):
    """The verdict as a dict; the files are restored before it returns, whatever happened."""
    changes = plan(replacements)
    found = revision([path for path, _, _ in changes])
    root = Path(found["root"])
    evidence = Path(evidence)
    evidence.mkdir(parents=True, exist_ok=True)
    for index, (path, original, _) in enumerate(changes):
        # A copy on disk in case this process is killed before it restores.
        (evidence / ("original-%d-%s" % (index, path.name))).write_bytes(original)
    relative = lambda name: Path(name).resolve().relative_to(root).as_posix()
    verdict = {"name": name, "command": command, "files": [str(path) for path, _, _ in changes],
               "started_at": datetime.datetime.now().astimezone().isoformat(), "revision": found,
               "replacements": [{"file": relative(file), "old": old, "new": new} for file, old, new in replacements]}
    (evidence / "mutant.patch").write_text("".join(
        "".join(difflib.unified_diff(original.decode().splitlines(True), mutated.decode().splitlines(True),
                                     "a/" + relative(path), "b/" + relative(path)))
        for path, original, mutated in changes))
    keep_checkout(found, changes, evidence / "checkout")
    verdict["checkout"] = str(evidence / "checkout")
    previous = signal.signal(signal.SIGTERM, lambda signum, frame: sys.exit(128 + signum))
    try:
        for path, original, mutated in changes:
            path.write_bytes(mutated)
        verdict["applied"] = all(path.read_bytes() == mutated for path, _, mutated in changes)
        code, output = run(command, evidence / "mutant.log", tempfile.mkdtemp(prefix="pyc-mutant-", dir=str(evidence)))
    finally:
        for path, original, _ in changes:
            path.write_bytes(original)
        signal.signal(signal.SIGTERM, previous)
    verdict["hashes"] = [{"file": relative(path), "original_sha256": digest(original), "mutated_sha256": digest(mutated),
                          "restored_sha256": digest(path.read_bytes())} for path, original, mutated in changes]
    verdict["restored"] = all(entry["restored_sha256"] == entry["original_sha256"] for entry in verdict["hashes"])
    lines = [line for line in output.splitlines() if re.search(killed_by, line)]
    verdict.update(mutant_exit=code, failed_line=lines[0] if lines else None,
                   killed=verdict["applied"] and code not in (0, None) and bool(lines))
    control_code, _ = run(command, evidence / "control.log", tempfile.mkdtemp(prefix="pyc-control-", dir=str(evidence)))
    verdict.update(control_exit=control_code, control_passed=control_code == 0)
    verdict["ok"] = verdict["killed"] and verdict["restored"] and verdict["control_passed"]
    (evidence / "verdict.json").write_text(json.dumps(verdict, indent=1) + "\n")
    return verdict


def read_verdict(evidence):
    path = Path(evidence) / "verdict.json"
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError) as error:
        raise Refused("no readable verdict at %s: %s" % (path, error))


def repository(found):
    """The git directory that holds the recorded commit; an older verdict names only its checkout."""
    if found.get("git_dir"):
        return found["git_dir"]
    common = git(found["root"], "rev-parse", "--git-common-dir") if Path(found["root"]).is_dir() else None
    return str(Path(found["root"], common.stdout.decode().strip()).resolve()) if common and not common.returncode else None


def committed(git_dir, *args):
    """git's output from the recorded repository, or None when it cannot be read there."""
    if git_dir is None:
        return None
    result = subprocess.run(["git", "--git-dir=" + git_dir] + list(args), capture_output=True)
    return None if result.returncode else result.stdout


def tree_of_archive(data):
    """{path: (kind, bytes)} for each file and symlink in a tar, as git archive gives it."""
    files = {}
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        for member in tar:
            if member.issym():
                files[member.name] = ("link", member.linkname.encode())
            elif member.isfile():
                files[member.name] = ("file", tar.extractfile(member).read())
    return files


def tree_of_folder(top):
    """{path: (kind, bytes)} for each file and symlink under a folder."""
    files = {}
    for folder, folders, names in os.walk(str(top)):
        for name in names + [name for name in folders if os.path.islink(os.path.join(folder, name))]:
            path = os.path.join(folder, name)
            key = Path(path).relative_to(top).as_posix()
            files[key] = ("link", os.readlink(path).encode()) if os.path.islink(path) else ("file", Path(path).read_bytes())
    return files


def verify(evidence):
    """(ok, lines): the kept evidence checked against the recorded commit, read from the recorded repository.

    The verdict must show a kill: killed, restored and its control passed,
    with its failed line in the mutant log, and a hash for each file it
    mutated. The tree must have been clean, since no commit holds uncommitted
    changes. Each original copy must hash as recorded and be the file at that
    commit; each recorded replacement must occur once in it and give the
    recorded mutant; and the kept checkout, until a reviewer removes it, must
    be that commit with only those mutants applied."""
    evidence = Path(evidence)
    verdict = read_verdict(evidence)
    found, failures, lines = verdict.get("revision") or {}, [], []
    commit, git_dir = found.get("commit"), repository(found)
    where = git_dir or "no repository: the verdict names none and %s is not a git checkout" % found.get("root")
    try:
        log = (evidence / "mutant.log").read_text(errors="replace").splitlines()
    except OSError:
        log = []
    if not (verdict.get("killed") and verdict.get("restored") and verdict.get("control_passed")
            and verdict.get("failed_line") in log):
        failures.append("FAILED not killed: killed=%s restored=%s control_passed=%s, failed line %s"
                        % (verdict.get("killed"), verdict.get("restored"), verdict.get("control_passed"),
                           "in the mutant log" if verdict.get("failed_line") in log else "not in the mutant log"))
    hashes = verdict.get("hashes") or []
    replaced = sorted({replacement["file"] for replacement in verdict.get("replacements") or []})
    if not hashes or sorted(entry["file"] for entry in hashes) != replaced:
        failures.append("FAILED hashes: %s recorded for the mutated files %s" % ([e["file"] for e in hashes], replaced))
    if commit is None:
        failures.append("FAILED no commit: the mutated files were not in a git checkout, so no revision holds what ran")
    elif found.get("dirty"):
        failures.append("FAILED uncommitted: no commit holds the tree the mutant ran in: %s" % found["dirty"])
    expected = None
    if commit is not None and not verdict.get("checkout_removed_at"):
        archive = committed(git_dir, "archive", "--format=tar", commit)
        expected = tree_of_archive(archive) if archive is not None else None
    for index, entry in enumerate(hashes):
        name = entry["file"]
        copies = list(evidence.glob("original-%d-*" % index))
        original = copies[0].read_bytes() if len(copies) == 1 else None
        problems = []
        if original is None or digest(original) != entry["original_sha256"]:
            problems.append("original copy")
        else:
            text = original.decode()
            for replacement in verdict.get("replacements") or []:
                if replacement["file"] == name:
                    if text.count(replacement["old"]) != 1:
                        problems.append("replacements")
                        break
                    text = text.replace(replacement["old"], replacement["new"])
            if "replacements" not in problems and digest(text.encode()) != entry["mutated_sha256"]:
                problems.append("replacements")
            if expected is not None:
                expected[name] = ("file", text.encode())
        if problems:
            failures.append("FAILED %s %s" % (" ".join(problems), name))
            continue
        if commit is not None:
            shown = committed(git_dir, "show", "%s:%s" % (commit, name))
            if shown is None:
                failures.append("FAILED commit %s: cannot read %s:%s from %s" % (name, commit, name, where))
                continue
            if digest(shown) != entry["original_sha256"]:
                failures.append("FAILED commit %s: the original is not the file at %s" % (name, commit))
                continue
        if verdict.get("checkout_removed_at"):
            lines.append("reviewed %s: checkout removed at %s" % (name, verdict["checkout_removed_at"]))
        lines.append("ok %s: killed=%s at %s" % (name, verdict.get("killed"), commit))
    if commit is not None and not verdict.get("checkout_removed_at"):
        if expected is None:
            failures.append("FAILED checkout: cannot read %s from %s to compare it" % (commit, where))
        else:
            kept = tree_of_folder(evidence / "checkout") if (evidence / "checkout").is_dir() else {}
            differ = sorted(path for path in set(expected) | set(kept) if expected.get(path) != kept.get(path))
            if differ:
                failures.append("FAILED checkout: %s%s is not %s with only the mutant applied"
                                % (", ".join(differ[:10]), " and %d more" % (len(differ) - 10) if len(differ) > 10 else "",
                                   commit))
    if failures:
        lines = [line for line in lines if not line.startswith("ok ")] + failures
    return not failures, lines


def reviewed(evidence):
    """Remove the kept checkout once a reviewer is done, and record when; the verdict, patch and logs stay."""
    evidence = Path(evidence)
    verdict = read_verdict(evidence)
    checkout = evidence / "checkout"
    if checkout.is_dir():
        shutil.rmtree(str(checkout))
    verdict["checkout_removed_at"] = datetime.datetime.now().astimezone().isoformat()
    (evidence / "verdict.json").write_text(json.dumps(verdict, indent=1) + "\n")
    return verdict


def main(argv=None):
    import argparse
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) == 2 and argv[0] in ("--verify", "--reviewed"):
        try:
            if argv[0] == "--reviewed":
                print("checkout removed at %s" % reviewed(argv[1])["checkout_removed_at"])
                return 0
            ok, lines = verify(argv[1])
        except Refused as refusal:
            print("refused: %s" % refusal, file=sys.stderr)
            return 2
        print("\n".join(lines))
        return 0 if ok else 1
    if "--" not in argv:
        argv = argv + ["--"]
    split = argv.index("--")
    parser = argparse.ArgumentParser(description="Apply a mutant, require a failed assertion, restore, rerun.")
    parser.add_argument("--replace", nargs=3, action="append", required=True, metavar=("FILE", "OLD", "NEW"))
    parser.add_argument("--name", default="mutant")
    parser.add_argument("--killed-by", default=KILLED_BY)
    parser.add_argument("--evidence")
    args = parser.parse_args(argv[:split])
    command = argv[split + 1:]
    if not command:
        print("refused: give the test command after --", file=sys.stderr)
        return 2
    evidence = args.evidence or tempfile.mkdtemp(prefix="mutant-%s-" % re.sub(r"[^\w-]", "_", args.name))
    try:
        verdict = mutate(args.replace, command, evidence, args.name, args.killed_by)
    except Refused as refusal:
        print("refused: %s" % refusal, file=sys.stderr)
        return 2
    print(json.dumps({key: verdict[key] for key in ("name", "killed", "failed_line", "mutant_exit", "restored",
                                                     "control_exit", "ok")}))
    print("evidence: %s" % evidence)
    return 0 if verdict["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
