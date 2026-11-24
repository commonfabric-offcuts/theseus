#!/usr/bin/python3 -I
from __future__ import annotations

"""Read-only Fast lane consumer discovery; imports no product or test modules."""

import argparse
import ast
from collections import defaultdict, deque
from dataclasses import dataclass
import json
from pathlib import Path, PurePosixPath
import posixpath
import subprocess
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.ci_input_reads import read_calls
from tools import steps_for


SOURCE_SUFFIXES = (".py", ".mjs", ".js")


@dataclass(frozen=True, order=True)
class Edge:
    target: str
    kind: str
    line: int = 0


def test_file(path):
    if not path.startswith("tests/"):
        return False
    name = PurePosixPath(path).name
    return ((name.startswith("test_") and name.endswith(".py"))
            or name.endswith(".test.mjs")
            or (name.endswith(".mjs") and "native" in name))


def module_file(name, files):
    path = name.replace(".", "/")
    return next((p for p in (path + ".py", path + "/__init__.py") if p in files), None)


def python_imports(path, tree, files):
    found, unresolved = set(), []
    dynamic_names = {"__import__", "import_module"}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == "importlib":
            dynamic_names.update(alias.asname or alias.name for alias in node.names
                                 if alias.name == "import_module")
    for node in ast.walk(tree):
        names = []
        if isinstance(node, ast.Import):
            names = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            prefix = node.module or ""
            if node.level:
                parts = path.split("/")[:-node.level]
                prefix = ".".join(parts + ([prefix] if prefix else []))
            names = [prefix] + [prefix + "." + alias.name for alias in node.names]
        elif isinstance(node, ast.Call):
            name = (node.func.attr if isinstance(node.func, ast.Attribute)
                    else node.func.id if isinstance(node.func, ast.Name) else "")
            if name in dynamic_names:
                value = node.args[0] if node.args else None
                if isinstance(value, ast.Constant) and isinstance(value.value, str):
                    if not value.value.startswith("."):
                        names = [value.value]
                    else:
                        unresolved.append({"path": path, "kind": "computed-import", "line": node.lineno})
                else:
                    unresolved.append({"path": path, "kind": "computed-import", "line": node.lineno})
        for name in names:
            target = module_file(name, files) or module_file("tests." + name, files)
            if target:
                found.add(Edge(target, "import", node.lineno))
                parts = target.split("/")[:-1]
                for end in range(1, len(parts) + 1):
                    package = "/".join(parts[:end]) + "/__init__.py"
                    if package in files:
                        found.add(Edge(package, "package-init", node.lineno))
    return found, unresolved


def javascript_imports(path, text, files):
    tokens = steps_for.tokenize(text)[0]
    found, unresolved = set(), []
    for index, token in enumerate(tokens):
        if token.kind != "id" or token.text not in ("import", "from", "require"):
            continue
        if index + 1 >= len(tokens):
            continue
        following = tokens[index + 1]
        if following.text == "(":
            if index + 2 >= len(tokens):
                continue
            following = tokens[index + 2]
            if (following.kind not in ("str", "tpl")
                    or steps_for.js_string(following)[1]
                    or index + 3 >= len(tokens)
                    or tokens[index + 3].text not in (")", ",")):
                unresolved.append({"path": path, "kind": "computed-import",
                                   "line": text.count("\n", 0, token.start) + 1})
                continue
        if following.kind not in ("str", "tpl"):
            continue
        specifier = steps_for.js_string(following)[0]
        if not specifier.startswith("."):
            continue
        target = posixpath.normpath(posixpath.join(posixpath.dirname(path), specifier))
        target = next((p for p in (target, target + ".js", target + "/index.js")
                       if p in files), target)
        if target in files:
            found.add(Edge(target, "import", text.count("\n", 0, token.start) + 1))
        else:
            unresolved.append({"path": path, "kind": "missing-import", "target": target})
    literals = {steps_for.js_string(token)[0] for token in tokens
                if token.kind in ("str", "tpl") and not steps_for.js_string(token)[1]}
    return found, unresolved, literals


def path_index(files):
    basenames = defaultdict(set)
    parts = []
    for path in files:
        split = PurePosixPath(path).parts
        basenames[split[-1]].add(path)
        if len(split) > 1:
            parts.append((path, frozenset(split)))
    return basenames, parts


def literal_targets(path, literals, files, index):
    """Conservative path literals in read-bearing modules, not execution proof."""
    if not literals:
        return set()
    basenames, file_parts = index
    found, components = set(), set()
    for literal in literals:
        if not literal or "\n" in literal or len(literal) > 1024:
            continue
        if literal.startswith(("/", "file:", "~")):
            continue
        candidates = {posixpath.normpath(literal)}
        if literal.startswith(("./", "../")):
            candidates.add(posixpath.normpath(posixpath.join(posixpath.dirname(path), literal)))
        found.update(candidates & files.keys())
        parts = PurePosixPath(literal).parts
        components.update(p for p in parts if p not in (".", ".."))
        if "/" not in literal and literal.endswith(SOURCE_SUFFIXES):
            found.update(basenames.get(literal, ()))
    # Path(root) / "web" / "app.mjs", and analogous constant component lists.
    found.update(p for p, parts in file_parts if parts <= components)
    return found


def graph(files):
    edges, unresolved = defaultdict(set), []
    index = path_index(files)
    for path, text in files.items():
        if not path.endswith(SOURCE_SUFFIXES) or text is None:
            continue
        try:
            if path.endswith(".py"):
                tree = ast.parse(text, filename=path)
                imports, unknown = python_imports(path, tree, files)
                edges[path].update(imports)
                unresolved.extend(unknown)
            else:
                imports, unknown, js_literals = javascript_imports(path, text, files)
                edges[path].update(imports)
                unresolved.extend(unknown)
            calls, literals = read_calls(path, text)
            if not path.endswith(".py"):
                # Regex string scanning treats apostrophes in comments as
                # quotes; source-reader literals must come from lexical tokens.
                literals = js_literals
            if calls:
                targets = literal_targets(path, literals, files, index)
                edges[path].update(Edge(target, "source-read") for target in targets)
                indirect = []
                for expression in calls.values():
                    if path.endswith(".py"):
                        expression_literals = read_calls(path, expression)[1]
                    else:
                        expression_literals = {steps_for.js_string(token)[0]
                                               for token in steps_for.tokenize(expression)[0]
                                               if token.kind == "str"}
                    if not literal_targets(path, expression_literals, files, index):
                        indirect.append(expression)
                if indirect:
                    unresolved.append({"path": path, "kind": "unresolved-read",
                                       "expressions": sorted(indirect)})
        except (SyntaxError, ValueError, IndexError) as error:
            unresolved.append({"path": path, "kind": "parse-error",
                               "message": str(error)})
    return edges, unresolved


def discover(before, after, changed):
    """Return test paths and shortest explanations across both source versions."""
    old, old_unknown = graph(before)
    new, new_unknown = (old, old_unknown) if before == after else graph(after)
    reverse = defaultdict(set)
    for version, edges in (("base", old), ("candidate", new)):
        for source, dependencies in edges.items():
            for edge in dependencies:
                reverse[edge.target].add((source, edge.kind, version, edge.line))
    changed = sorted(set(changed))
    reached, next_edge = set(changed), {}
    pending = deque(changed)
    while pending:
        target = pending.popleft()
        for source, kind, version, line in sorted(reverse[target]):
            if source not in reached:
                reached.add(source)
                next_edge[source] = (target, kind, version, line)
                pending.append(source)
    tests, removed = [], []
    for path in sorted(p for p in reached if test_file(p)):
        chain, at = [], path
        while at in next_edge:
            target, kind, version, line = next_edge[at]
            chain.append({"from": at, "to": target, "kind": kind,
                          "version": version, "line": line})
            at = target
        runner = ("python-unit" if path.endswith(".py") else
                  "node-unit" if path.endswith(".test.mjs") else "browser-consumer")
        record = {"path": path, "runner": runner, "changed_input": at, "chain": chain}
        (tests if path in after else removed).append(record)
    # Stable, deduplicated unknowns; no instruction to wait on their repair.
    unknown = {json.dumps(x, sort_keys=True): x for x in old_unknown + new_unknown}
    return {"changed": changed, "tests": tests, "removed_tests": removed,
            "unresolved": [unknown[k] for k in sorted(unknown)],
            "limits": ["Static imports and read-module path literals can overselect.",
                       "Computed paths/imports can have additional consumers.",
                       "Browser selectors and runtime reads can add consumers.",
                       "Selection is neither assertion coverage nor a shipping gate."]}


class SourceError(Exception):
    pass


def git(root, *args, input=None):
    result = subprocess.run(["git", "-C", str(root), "--no-replace-objects"] + list(args),
                            input=input, capture_output=True)
    if result.returncode:
        raise SourceError(result.stderr.decode("utf-8", "replace").strip())
    return result.stdout


def revision(root, value):
    return git(root, "rev-parse", "--verify", "--end-of-options",
               value + "^{commit}").decode().strip()


def committed_files(root, commit):
    entries = []
    for row in git(root, "ls-tree", "-rz", "--full-tree", commit).split(b"\0"):
        if not row:
            continue
        metadata, raw_path = row.split(b"\t", 1)
        mode, kind, oid = metadata.split()
        path = raw_path.decode("utf-8")
        if kind == b"blob" and mode in (b"100644", b"100755"):
            entries.append((path, oid))
    files = {path: None for path, _ in entries}
    selected = [(path, oid) for path, oid in entries if path.endswith(SOURCE_SUFFIXES)]
    raw = git(root, "cat-file", "--batch", input=b"".join(oid + b"\n" for _, oid in selected))
    cursor = 0
    for path, oid in selected:
        end = raw.index(b"\n", cursor)
        actual, kind, size = raw[cursor:end].split()
        if actual != oid or kind != b"blob":
            raise SourceError("Unexpected Git object for " + path)
        cursor = end + 1
        files[path] = raw[cursor:cursor + int(size)].decode("utf-8-sig")
        cursor += int(size) + 1
    if cursor != len(raw):
        raise SourceError("Unexpected trailing Git objects")
    return files


def working_files(root):
    paths = git(root, "ls-files", "-z", "--cached", "--others", "--exclude-standard").split(b"\0")
    files = {}
    for raw_path in paths:
        if not raw_path:
            continue
        path = raw_path.decode("utf-8")
        full = root / path
        if not full.is_file():
            continue
        if full.is_symlink():
            raise SourceError("Source symlink is not followed: " + path)
        files[path] = full.read_text(encoding="utf-8-sig") if path.endswith(SOURCE_SUFFIXES) else None
    return files


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="*", help="Explicit repository-relative changed paths")
    parser.add_argument("--repo", default=".", help="Repository/worktree (default current directory)")
    parser.add_argument("--base", default="HEAD", help="Base revision (default HEAD)")
    parser.add_argument("--head", help="Candidate revision; default includes the working tree")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--explain", action="store_true")
    args = parser.parse_args(argv)
    try:
        root = Path(git(args.repo, "rev-parse", "--show-toplevel").decode().strip())
        base = revision(root, args.base)
        head = revision(root, args.head) if args.head else None
        before = committed_files(root, base)
        after = committed_files(root, head) if head else working_files(root)
        if args.files:
            changed = []
            for path in args.files:
                if path.startswith("/") or ".." in PurePosixPath(path).parts:
                    raise SourceError("Use a repository-relative path: " + path)
                path = posixpath.normpath(path)
                if path not in before and path not in after:
                    raise SourceError("Changed path is absent from both trees: " + path)
                changed.append(path)
        else:
            changed = git(root, "diff", "--name-only", "--no-renames", "-z",
                          base, *([head] if head else [])).decode().split("\0")
            if head is None:
                changed += git(root, "ls-files", "--others", "--exclude-standard", "-z").decode().split("\0")
            changed = [p for p in changed if p]
        result = discover(before, after, changed)
        result.update({"base": base, "head": head or "worktree", "repo": str(root)})
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            for test in result["tests"]:
                if args.explain:
                    chain = "[%s] %s" % (test["runner"], test["path"]) + "".join(
                        " --%s[%s]--> %s" % (edge["kind"], edge["version"], edge["to"])
                        for edge in test["chain"])
                    print(chain)
                else:
                    print(test["path"])
            print("%d test files; %d unresolved expressions. Static selection only; no tests executed."
                  % (len(result["tests"]), len(result["unresolved"])), file=sys.stderr)
        return 0
    except (SourceError, OSError, UnicodeError, ValueError) as error:
        print("Consumer discovery could not read source: " + str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
