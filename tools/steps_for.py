#!/usr/bin/python3 -I
from __future__ import annotations

"""Choose the native release-check steps a change must run, from what its diff touches (item 608).

Usage: tools/steps_for.py WORKTREE BASE [--head REV] [--json] [--checkers]

Reads `git diff BASE..HEAD` in WORKTREE (or BASE..REV with --head) and prints
each chosen native step on one line with its reasons; every reason names what
matched and where. Every rule is read from the code at the head commit
(through git, so a dirty tree does not matter): the steps from
tools/release_check.py NATIVE_STEPS, and for each harness its mode branches,
its ternaries, its case-name filter, its file lists and the test modules it
imports and calls.

A step is chosen when:
  1. a selector (#id, .class, [data-*]) the diff adds, removes or changes, or a
     changed file's basename, is read by a case (or a helper a case calls) that
     the step runs;
  2. the diff changes markup or CSS for a control and the step runs a generic
     checker, one that sweeps every control or element of the page
     (document.querySelectorAll over controls, or X.querySelectorAll('*'));
  4. a changed file is on the step's own part of a harness file list;
  5. a changed test module holds a case or helper the step runs (a changed
     harness chooses all its steps);
  6. a changed tool runs the step (tools/native.py runs them all; a
     tools/release_check.py change to NATIVE_STEPS or to the code native.py
     calls), or a .github change names it.
Python units, node units and the acts ledger always run; they are not native
steps (rule 3). Nor are the deploy's refusals and the wake replay, which a
scoped release check (tools/release_check.py --scoped) runs beside the steps
chosen here.

--json prints the same as one JSON object. --checkers also lists the generic
checkers found. tools/release_check.py and the deploy (tools/deploy.py) read
the same choice through choose(); docs/tools.md has the rule.
"""

import ast
import bisect
import collections
import json
import os
import posixpath
import re
import subprocess
import sys

Step = collections.namedtuple("Step", "name harness flags")
Hunk = collections.namedtuple("Hunk", "old_start old new_start new")  # old/new: [(line, text)]
Tok = collections.namedtuple("Tok", "kind text start end")
Case = collections.namedtuple("Case", "name partial start end line index title")
Decl = collections.namedtuple("Decl", "name start end refs")

UNDEF = ("undef",)
UNK = ("unk",)
WEB_CONTROL = re.compile(
    r"createElement\(\s*['\"](?:button|input|a|select|textarea|summary|details|label)['\"]"
    r"|<(?:button|input|a|select|textarea|summary|details)\b"
    r"|\brole\s*[=:,]\s*['\"]?(?:button|link|menuitem|tab|checkbox|radio|switch|option)"
    r"|setAttribute\(\s*['\"](?:role|aria-label|title|tabindex)['\"]"
    r"|\.(?:title|ariaLabel|tabIndex)\s*=|\.type\s*=\s*['\"]button|aria-label")
TAGS = ("a|abbr|article|aside|button|dd|details|dialog|div|dl|dt|fieldset|figure|footer|form|h1|h2|h3|h4|h5|h6|header|"
        "img|input|label|legend|li|main|mark|menu|nav|ol|option|p|pre|rect|section|select|span|summary|svg|table|tbody|"
        "td|textarea|th|thead|time|tr|ul|code|blockquote|strong|em|small|output|progress|meter|circle|path|g|line|text")
CONTROL_PART = re.compile(r"^(?:button|input|textarea|select|summary|a(?:\[[^\]]*\])?|\*|body\s+\*|\[role=['\"]?button['\"]?\]|\[tabindex[^\]]*\](?::not\(.*\))?)(?::[\w-]+(?:\(.*\))?)*$")
GENERIC_SWEEP = re.compile(r"querySelectorAll\(\s*(['\"`])((?:(?!\1).)*)\1", re.S)
DOC_RECEIVER = re.compile(r"(?:\bdocument(?:\s*\.\s*body)?|\?\?\s*document\s*\))\s*\.\s*$")


# ---------------------------------------------------------------- git

class Refused(Exception):
    """git could not say what the choice needs, so no choice is made: never taken as nothing changed or nothing there."""


def run_git(root, *args):
    """git in root, its output read as text (undecodable bytes replaced, as a file's text is only searched)."""
    return subprocess.run(["git", "-C", str(root)] + list(args), capture_output=True, text=True, errors="replace")


class Repo:
    """The change from base to head in the repository at root, read through git(root, *args) (run_git, or the deploy's
    own runner): the deploy reads its live checkout, whose HEAD is the live commit, not the commit it deploys."""

    def __init__(self, root, base, head="HEAD", git=run_git):
        self.root, self._git = str(root), git
        self.head = self.git("rev-parse", "--verify", head + "^{commit}").strip()
        self.base = self.git("rev-parse", "--verify", base + "^{commit}").strip()
        self.cache, self.trees = {}, {}

    def git(self, *args):
        answer = self._git(self.root, *args)
        if answer.returncode:
            raise Refused("git %s: %s" % (" ".join(args), (answer.stderr or "").strip()))
        return answer.stdout

    def show(self, rev, path):
        """The file's text at rev, or None when rev holds no such file; Refused when git cannot show a file it holds."""
        if rev not in self.trees:
            self.trees[rev] = set(self.git("ls-tree", "-r", "--name-only", "-z", rev).split("\0")) - {""}
        if path not in self.trees[rev]:
            return None
        key = (rev, path)
        if key not in self.cache:
            self.cache[key] = self.git("show", "%s:%s" % (rev, path))
        return self.cache[key]

    def diff(self):
        """{path: [Hunk]} for every file the diff touches, renames as a delete and an add."""
        text = self.git("diff", "-U0", "--no-renames", "--no-color", "--no-ext-diff", self.base, self.head)
        files, path, hunk, old_at, new_at = collections.OrderedDict(), None, None, 0, 0
        for line in text.split("\n"):
            if line.startswith("diff --git "):
                match = re.match(r"diff --git a/(.*) b/(.*)$", line)
                path = match.group(2) if match else None
                files.setdefault(path, [])
                hunk = None
            elif line.startswith("--- ") or line.startswith("+++ "):
                continue
            elif line.startswith("@@"):
                match = re.match(r"@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@", line)
                old_at, new_at = int(match.group(1)), int(match.group(2))
                hunk = Hunk(old_at, [], new_at, [])
                files[path].append(hunk)
            elif hunk is not None and line.startswith("-"):
                hunk.old.append((old_at, line[1:]))
                old_at += 1
            elif hunk is not None and line.startswith("+"):
                hunk.new.append((new_at, line[1:]))
                new_at += 1
        return files


# ---------------------------------------------------------------- steps (tools/release_check.py)

def python_assigns(source):
    tree = ast.parse(source)
    assigns = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            assigns.setdefault(node.targets[0].id, node.value)
    return tree, assigns


def evaluate_python(node, assigns, env=None, depth=0):
    """The value of a constant expression: literals, names, +, tuple(), NativeStep(), comprehensions."""
    env = env or {}
    if depth > 40:
        raise ValueError("too deep")
    again = lambda n, e=env: evaluate_python(n, assigns, e, depth + 1)
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        if node.id in env:
            return env[node.id]
        if node.id in assigns:
            return again(assigns[node.id])
        raise ValueError("unknown name %s" % node.id)
    if isinstance(node, (ast.Tuple, ast.List)):
        return [again(item) for item in node.elts]
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left, right = again(node.left), again(node.right)
        if isinstance(left, (list, tuple)):
            return list(left) + list(right)
        return left + right
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        if node.func.id in ("tuple", "list"):
            return list(again(node.args[0]))
        if node.func.id == "NativeStep":
            values = [again(arg) for arg in node.args]
            values += [again(keyword.value) for keyword in node.keywords]
            return Step(values[0], values[1], tuple(values[2]))
    if isinstance(node, (ast.ListComp, ast.GeneratorExp)) and len(node.generators) == 1:
        generator = node.generators[0]
        out = []
        for value in again(generator.iter):
            inner = dict(env)
            inner[generator.target.id] = value
            if all(again(test, inner) for test in generator.ifs):
                out.append(again(node.elt, inner))
        return out
    if isinstance(node, ast.Compare) and len(node.ops) == 1 and isinstance(node.ops[0], (ast.Eq, ast.NotEq)):
        same = again(node.left) == again(node.comparators[0])
        return same if isinstance(node.ops[0], ast.Eq) else not same
    raise ValueError("cannot read %s" % ast.dump(node)[:80])


def read_steps(source):
    _, assigns = python_assigns(source)
    return [step for step in evaluate_python(assigns["NATIVE_STEPS"], assigns) if isinstance(step, Step)]


def read_units(source):
    _, assigns = python_assigns(source)
    try:
        return list(evaluate_python(assigns["UNIT_STEPS"], assigns))
    except (KeyError, ValueError):
        return ["python-units", "node-units"]


# ---------------------------------------------------------------- JS tokens

TOKEN = re.compile(r"""
 (?P<ws>\s+)
|(?P<str>'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")
|(?P<id>[A-Za-z_$][\w$]*)
|(?P<num>\d[\w.]*|\.\d\w*)
|(?P<punc>\.\.\.|===|!==|>>>=|\*\*=|\?\?=|&&=|\|\|=|<<=|>>=|>>>|\?\.(?!\d)|\?\?|=>|==|!=|<=|>=|&&|\|\||\+\+|--|\+=|-=|\*=|%=|&=|\|=|\^=|\*\*|<<|>>|[{}()\[\];,<>+\-*%&|^!~?:=.@#])
""", re.S | re.X)
REGEX_AFTER = set("( , = : [ ! & | ? { } ; + - * % < > ~ ^ => == === != !== && || ?? += -= *= %= ... return typeof instanceof in of new delete void throw case do else yield await".split())
OPENERS, CLOSERS = {"(": ")", "[": "]", "{": "}"}, {")": "(", "]": "[", "}": "{"}


def scan_template(src, pos):
    i, n = pos + 1, len(src)
    while i < n:
        ch = src[i]
        if ch == "\\":
            i += 2
        elif ch == "`":
            return i + 1
        elif src.startswith("${", i):
            _, _, i = tokenize(src, i + 2, nested=True)
            i += 1
        else:
            i += 1
    return n


def scan_regex(src, pos):
    i, n, klass = pos + 1, len(src), False
    while i < n:
        ch = src[i]
        if ch == "\\":
            i += 2
            continue
        if ch == "\n":
            return None
        if ch == "[":
            klass = True
        elif ch == "]":
            klass = False
        elif ch == "/" and not klass:
            i += 1
            while i < n and (src[i].isalnum() or src[i] == "_"):
                i += 1
            return i
        i += 1
    return None


def tokenize(src, pos=0, nested=False):
    """(tokens, comment spans, end): strings and templates are single tokens; with nested, stop at an unmatched }."""
    toks, comments, depth, n = [], [], 0, len(src)
    while pos < n:
        ch = src[pos]
        if ch == "`":
            end = scan_template(src, pos)
            toks.append(Tok("tpl", src[pos:end], pos, end))
            pos = end
            continue
        if ch == "/":
            if src.startswith("//", pos):
                end = src.find("\n", pos)
                end = n if end < 0 else end
                comments.append((pos, end))
                pos = end
                continue
            if src.startswith("/*", pos):
                end = src.find("*/", pos + 2)
                end = n if end < 0 else end + 2
                comments.append((pos, end))
                pos = end
                continue
            prev = toks[-1] if toks else None
            if prev is None or (prev.kind in ("punc", "id") and prev.text in REGEX_AFTER):
                end = scan_regex(src, pos)
                if end:
                    toks.append(Tok("re", src[pos:end], pos, end))
                    pos = end
                    continue
            text = "/=" if src.startswith("/=", pos) else "/"
            toks.append(Tok("punc", text, pos, pos + len(text)))
            pos += len(text)
            continue
        if nested and ch == "}" and depth == 0:
            return toks, comments, pos
        match = TOKEN.match(src, pos)
        if not match:
            pos += 1
            continue
        kind = match.lastgroup
        if kind != "ws":
            text = match.group()
            toks.append(Tok(kind, text, pos, match.end()))
            if kind == "punc" and text == "{":
                depth += 1
            elif kind == "punc" and text == "}":
                depth -= 1
        pos = match.end()
    return toks, comments, pos


def js_string(tok):
    """(value, partial): a string token's value; a template's text up to its first ${."""
    if tok.kind == "str":
        body = tok.text[1:-1]
        return re.sub(r"\\(.)", r"\1", body), False
    body = tok.text[1:-1] if tok.text.endswith("`") else tok.text[1:]
    cut = body.find("${")
    if cut >= 0:
        return re.sub(r"\\(.)", r"\1", body[:cut]), True
    return re.sub(r"\\(.)", r"\1", body), False


class JS:
    """One JavaScript file: tokens, brackets, comments, strings, cases, top-level declarations and imports."""

    def __init__(self, path, src):
        self.path, self.src = path, src
        self.toks, self.comments, _ = tokenize(src)
        self.starts = [tok.start for tok in self.toks]
        self.match, self.depth = {}, []
        stack = []
        for index, tok in enumerate(self.toks):
            if tok.kind == "punc" and tok.text in OPENERS:
                self.depth.append(len(stack))
                stack.append(index)
            elif tok.kind == "punc" and tok.text in CLOSERS:
                if stack and self.toks[stack[-1]].text == CLOSERS[tok.text]:
                    opener = stack.pop()
                    self.match[opener], self.match[index] = index, opener
                self.depth.append(len(stack))
            else:
                self.depth.append(len(stack))
        self.lines = [0] + [m.end() for m in re.finditer("\n", src)]
        self.comment_starts = [span[0] for span in self.comments]
        spans = [(tok.start, tok.end) for tok in self.toks if tok.kind in ("str", "tpl")]
        self.string_starts, self.string_spans = [s for s, _ in spans], spans
        self.decls, self.imports, self.exports = self.top_level()
        self.decl_starts = [decl.start for decl in self.decls]

    def line(self, pos):
        return bisect.bisect_right(self.lines, pos)

    def _inside(self, starts, spans, pos):
        at = bisect.bisect_right(starts, pos) - 1
        return at >= 0 and spans[at][0] <= pos < spans[at][1]

    def in_comment(self, pos):
        return self._inside(self.comment_starts, self.comments, pos)

    def in_string(self, pos):
        return self._inside(self.string_starts, self.string_spans, pos)

    def at(self, pos):
        """Index of the token holding pos, or of the first token after it."""
        return max(0, bisect.bisect_right(self.starts, pos) - 1)

    def cases(self, declarers):
        out, toks = [], self.toks
        for index, tok in enumerate(toks[:-2]):
            if tok.kind == "id" and tok.text in declarers and toks[index + 1].text == "(" and toks[index + 2].kind in ("str", "tpl") \
                    and (index == 0 or toks[index - 1].text not in (".", "function")):
                name, partial = js_string(toks[index + 2])
                close = self.match.get(index + 1, index + 2)
                raw = toks[index + 2].text[1:-1]
                title = re.sub(r"\$\{[^}]*\}", "…", raw) if toks[index + 2].kind == "tpl" else name
                out.append(Case(name, partial, tok.start, toks[close].end, self.line(tok.start), len(out), title))
        return out

    def top_level(self):
        decls, imports, exports = [], {}, {}
        toks, starters = self.toks, ("export", "import", "async", "function", "const", "let", "var", "class")
        heads = [i for i, tok in enumerate(toks) if self.depth[i] == 0 and tok.kind == "id" and tok.text in starters
                 and not (tok.text == "function" and i and toks[i - 1].text == "async")
                 and not (tok.text in ("function", "const", "let", "var", "class", "async") and i and toks[i - 1].text in ("export", "default"))]
        for number, i in enumerate(heads):
            end = toks[heads[number + 1]].start if number + 1 < len(heads) else len(self.src)
            j = i
            exported = False
            if toks[j].text == "export":
                exported = True
                j += 1
                if j < len(toks) and toks[j].text == "default":
                    j += 1
            if toks[i].text == "import":
                self.read_import(i, imports)
                continue
            if j < len(toks) and toks[j].text == "{" and exported:
                close = self.match.get(j, j)
                k = j + 1
                while k < close:
                    local = toks[k].text
                    if k + 2 < close and toks[k + 1].text == "as":
                        exports[toks[k + 2].text] = local
                        k += 3
                    else:
                        exports[local] = local
                        k += 1
                    if k < close and toks[k].text == ",":
                        k += 1
                continue
            if j < len(toks) and toks[j].text == "async":
                j += 1
            name = None
            if j + 1 < len(toks) and toks[j].text in ("function", "class"):
                k = j + 1
                if toks[k].text == "*":
                    k += 1
                name = toks[k].text if toks[k].kind == "id" else None
            elif j + 1 < len(toks) and toks[j].text in ("const", "let", "var") and toks[j + 1].kind == "id":
                name = toks[j + 1].text
            refs = set()
            k = i
            while k < len(toks) and toks[k].start < end:
                tok = toks[k]
                if tok.kind == "id":
                    refs.add(tok.text)
                elif tok.kind == "tpl":
                    refs.update(re.findall(r"[A-Za-z_$][\w$]*", tok.text))
                k += 1
            refs.discard(name)
            decls.append(Decl(name, toks[i].start, end, refs))
            if exported and name:
                exports[name] = name
        return decls, imports, exports

    def read_import(self, i, imports):
        toks, k = self.toks, i + 1
        names = []
        while k < len(toks) and toks[k].kind != "str":
            tok = toks[k]
            if tok.text == "*" and k + 2 < len(toks) and toks[k + 1].text == "as":
                names.append(("*", toks[k + 2].text))
                k += 3
                continue
            if tok.text == "{":
                close = self.match.get(k, k)
                m = k + 1
                while m < close:
                    if toks[m].kind == "id":
                        if m + 2 < close and toks[m + 1].text == "as":
                            names.append((toks[m].text, toks[m + 2].text))
                            m += 3
                            continue
                        names.append((toks[m].text, toks[m].text))
                    m += 1
                k = close + 1
                continue
            if tok.kind == "id" and tok.text not in ("from", "import"):
                names.append(("default", tok.text))
            k += 1
        if k >= len(toks):
            return
        spec, _ = js_string(toks[k])
        if not spec.startswith("."):
            return
        target = posixpath.normpath(posixpath.join(posixpath.dirname(self.path), spec))
        for exported, local in names:
            imports[local] = (target, exported, toks[i].start, toks[k].end)

    def decl_at(self, pos):
        at = bisect.bisect_right(self.decl_starts, pos) - 1
        if at >= 0 and self.decls[at].start <= pos < self.decls[at].end:
            return self.decls[at]
        return None


# ---------------------------------------------------------------- conditions on mode and case name

def t_and(a, b):
    if a is False or b is False:
        return False
    return True if a is True and b is True else None


def t_or(a, b):
    if a is True or b is True:
        return True
    return False if a is False and b is False else None


def truth(value):
    kind = value[0]
    if kind == "b":
        return value[1]
    if kind == "undef":
        return False
    if kind == "s":
        return bool(value[1])
    if kind in ("obj", "list"):
        return True
    return None


class Condition:
    """A tri-state reading of a JS expression in terms of `mode` and the case `name`."""

    def __init__(self, harness, env, a, b, depth=0):
        self.h, self.env, self.i, self.b, self.depth = harness, env, a, b, depth
        self.toks = harness.js.toks

    def peek(self, offset=0):
        at = self.i + offset
        return self.toks[at].text if at < self.b else None

    def sub(self, a, b):
        return Condition(self.h, self.env, a, b, self.depth + 1).value()

    def value(self):
        try:
            return self.ternary()
        except (IndexError, KeyError, ValueError, RecursionError):
            return UNK

    def ternary(self):
        test = self.either()
        if self.peek() == "?":
            self.i += 1
            yes = self.ternary()
            if self.peek() == ":":
                self.i += 1
            no = self.ternary()
            answer = truth(test)
            return yes if answer is True else no if answer is False else UNK
        return test

    def either(self):
        left = self.both()
        while self.peek() in ("||", "??"):
            op = self.peek()
            self.i += 1
            right = self.both()
            if op == "??":
                left = right if left[0] == "undef" else (left if left[0] != "unk" else UNK)
            else:
                left = ("b", t_or(truth(left), truth(right)))
        return left

    def both(self):
        left = self.negation()
        while self.peek() == "&&":
            self.i += 1
            right = self.negation()
            left = ("b", t_and(truth(left), truth(right)))
        return left

    def negation(self):
        if self.peek() == "!":
            self.i += 1
            answer = truth(self.negation())
            return ("b", None if answer is None else not answer)
        return self.comparison()

    def comparison(self):
        left = self.member()
        while self.peek() in ("===", "!==", "==", "!=", "in", "<", ">", "<=", ">=", "instanceof", "+", "-", "*", "/", "%"):
            op = self.peek()
            self.i += 1
            right = self.member()
            if op == "in":
                if right[0] == "obj" and left[0] == "s":
                    left = ("b", left[1] in right[1])
                elif right[0] == "obj" and not right[1]:
                    left = ("b", False)
                else:
                    left = ("b", None)
            elif op in ("===", "!==", "==", "!="):
                same = None
                if left[0] in ("s", "undef") and right[0] in ("s", "undef"):
                    same = left == right
                left = ("b", same if op in ("===", "==") or same is None else not same)
            else:
                left = UNK
        return left

    def call_argument(self):
        """The value inside the parentheses at self.i, leaving self.i after them."""
        close = self.h.js.match[self.i]
        value = self.sub(self.i + 1, close)
        self.i = close + 1
        return value

    def member(self):
        value = self.primary()
        while self.peek() in (".", "?.", "[", "("):
            op = self.peek()
            if op in (".", "?."):
                name = self.peek(1)
                self.i += 2
                if self.peek() == "(":
                    argument = self.call_argument()
                    if name == "includes" and value[0] == "list":
                        items = value[1]
                        if argument[0] in ("s", "undef") and all(item[0] == "s" for item in items):
                            value = ("b", argument in items)
                        else:
                            value = ("b", None)
                    elif name == "startsWith" and argument[0] == "s":
                        prefix = argument[1]
                        if value[0] == "s":
                            value = ("b", value[1].startswith(prefix))
                        elif value[0] == "pfx":
                            value = ("b", True if value[1].startswith(prefix) else (None if prefix.startswith(value[1]) else False))
                        else:
                            value = ("b", None)
                    else:
                        value = UNK
                else:
                    value = UNK
            elif op == "[":
                close = self.h.js.match[self.i]
                key = self.sub(self.i + 1, close)
                self.i = close + 1
                if value[0] == "obj" and key[0] == "s":
                    value = value[1].get(key[1], UNDEF)
                elif value[0] == "obj" and key[0] == "undef":
                    value = UNDEF
                else:
                    value = UNK
            else:
                self.i = self.h.js.match[self.i] + 1
                value = UNK
        return value

    def primary(self):
        tok = self.toks[self.i]
        if tok.text == "(" and tok.kind == "punc":
            close = self.h.js.match[self.i]
            value = self.sub(self.i + 1, close)
            self.i = close + 1
            return value
        if tok.text == "[" and tok.kind == "punc":
            close = self.h.js.match[self.i]
            items, start, k = [], self.i + 1, self.i + 1
            while k <= close:
                if k == close or (self.toks[k].text == "," and self.h.js.depth[k] == self.h.js.depth[self.i] + 1):
                    if k > start:
                        items.append(self.sub(start, k))
                    start = k + 1
                elif self.toks[k].text in OPENERS and self.toks[k].kind == "punc":
                    k = self.h.js.match.get(k, k)
                k += 1
            self.i = close + 1
            return ("list", items)
        if tok.text == "{" and tok.kind == "punc":
            opener = self.i
            self.i = self.h.js.match[opener] + 1
            return ("obj", self.h.object_keys(opener))
        self.i += 1
        if tok.kind == "str" or (tok.kind == "tpl" and "${" not in tok.text):
            return ("s", js_string(tok)[0])
        if tok.kind == "id":
            if tok.text == "mode":
                return self.env.get("mode", UNK)
            if tok.text == "name":
                return self.env.get("name", UNK)
            if tok.text in ("undefined", "null"):
                return UNDEF
            if tok.text in ("true", "false"):
                return ("b", tok.text == "true")
            if self.depth < 6 and tok.text in self.h.consts:
                a, b = self.h.consts[tok.text]
                return Condition(self.h, self.env, a, b, self.depth + 1).value()
        return UNK


# ---------------------------------------------------------------- harnesses

class Harness:
    """A native entry point: which of its steps reach each position, and which cases each step runs."""

    def __init__(self, js, steps):
        self.js, self.steps = js, steps
        self.names = [step.name for step in steps]
        toks = js.toks
        self.consts = {}
        for i, tok in enumerate(toks[:-2]):
            if tok.kind == "id" and tok.text in ("const", "let") and toks[i + 1].kind == "id" and toks[i + 2].text == "=" \
                    and toks[i + 1].text not in self.consts:
                end = self.statement_end(i + 3)
                self.consts[toks[i + 1].text] = (i + 3, end)
        self.regions = []
        for start, end, conjuncts in self.find_regions():
            excluded = set()
            for step in steps:
                answer = True
                for (a, b), polarity in conjuncts:
                    value = truth(Condition(self, self.env(step), a, b).value())
                    value = value if polarity else (None if value is None else not value)
                    answer = t_and(answer, value)
                if answer is False:
                    excluded.add(step.name)
            if excluded:
                self.regions.append((start, end, excluded))
        self.declarer, self.filters, self.push_array = self.find_declarer()
        self.case_list = js.cases({self.declarer}) if self.declarer else []
        self.slices = []
        if self.push_array:
            for i, tok in enumerate(toks[:-4]):
                if tok.text == self.push_array and toks[i + 1].text == "." and toks[i + 2].text == "slice" and toks[i + 3].text == "(":
                    close = js.match.get(i + 3, i + 3)
                    numbers = [int(t.text) for t in toks[i + 4:close] if t.kind == "num" and t.text.isdigit()]
                    if numbers:
                        self.slices.append((tok.start, numbers[0], numbers[1] if len(numbers) > 1 else None))
        self.lists = self.find_lists()

    def env(self, step, name=None):
        env = {"mode": ("s", step.flags[0]) if step.flags else UNDEF}
        if name is not None:
            env["name"] = name
        return env

    def statement_end(self, i):
        toks, js = self.js.toks, self.js
        while i < len(toks):
            tok = toks[i]
            if tok.kind == "punc" and tok.text in OPENERS:
                i = js.match.get(i, i) + 1
                continue
            if tok.kind == "punc" and (tok.text == ";" or tok.text in CLOSERS):
                return i
            i += 1
        return i

    def object_keys(self, opener):
        """{key: value} of an object literal; nested objects are read, other values are unknown."""
        toks, js = self.js.toks, self.js
        close = js.match.get(opener, opener)
        out, k = {}, opener + 1
        while k < close:
            tok = toks[k]
            if tok.kind in ("str", "id") and k + 1 < close and toks[k + 1].text == ":":
                key = js_string(tok)[0] if tok.kind == "str" else tok.text
                k += 2
                if toks[k].text == "{":
                    out[key] = ("obj", self.object_keys(k))
                else:
                    out[key] = UNK
                while k < close and not (toks[k].text == "," and js.depth[k] == js.depth[opener] + 1):
                    if toks[k].kind == "punc" and toks[k].text in OPENERS:
                        k = js.match.get(k, k)
                    k += 1
            k += 1
        return out

    def find_regions(self):
        """(start, end, [((a, b), polarity)]) for every if/else branch and every ternary arm."""
        toks, js, out = self.js.toks, self.js, []
        n = len(toks)
        for i, tok in enumerate(toks):
            if tok.kind == "id" and tok.text == "if" and i + 1 < n and toks[i + 1].text == "(" and not (i and toks[i - 1].text == "else"):
                conds, j = [], i
                while j + 1 < n and toks[j + 1].text == "(" and (j + 1) in js.match:
                    close = js.match[j + 1]
                    cond = (j + 2, close)
                    body = close + 1
                    if body >= n:
                        break
                    body_end = js.match.get(body, body) if toks[body].text == "{" else self.statement_end(body)
                    body_end = min(body_end, n - 1)
                    out.append((toks[body].start, toks[body_end].end, [(c, False) for c in conds] + [(cond, True)]))
                    conds.append(cond)
                    k = body_end + 1
                    if k + 1 < n and toks[k].text == "else":
                        if toks[k + 1].text == "if":
                            j = k + 1
                            continue
                        stop = js.match.get(k + 1, k + 1) if toks[k + 1].text == "{" else self.statement_end(k + 1)
                        stop = min(stop, n - 1)
                        out.append((toks[k + 1].start, toks[stop].end, [(c, False) for c in conds]))
                    break
            elif tok.kind == "punc" and tok.text == "?":
                arms = self.ternary(i)
                if arms:
                    out.extend(arms)
        return out

    def ternary(self, q):
        toks, js, n = self.js.toks, self.js, len(self.js.toks)
        boundary = {"(", "[", "{", ",", ";", "=", "=>", ":", "?", "+=", "-=", "||=", "&&=", "??="}
        j = q - 1
        while j >= 0:
            tok = toks[j]
            if tok.kind == "punc" and tok.text in CLOSERS and j in js.match:
                j = js.match[j] - 1
                continue
            if (tok.kind == "punc" and tok.text in boundary) or (tok.kind == "id" and tok.text in ("return", "case", "else", "yield", "await")):
                break
            j -= 1
        cond = (j + 1, q)
        k, nest = q + 1, 0
        while k < n:
            tok = toks[k]
            if tok.kind == "punc" and tok.text in OPENERS:
                k = js.match.get(k, k) + 1
                continue
            if tok.kind == "punc" and (tok.text in CLOSERS or tok.text == ";"):
                return None
            if tok.text == "?" and tok.kind == "punc":
                nest += 1
            elif tok.text == ":" and tok.kind == "punc":
                if nest == 0:
                    break
                nest -= 1
            k += 1
        if k >= n or k == q + 1:
            return None
        colon, m, nest = k, k + 1, 0
        while m < n:
            tok = toks[m]
            if tok.kind == "punc" and tok.text in OPENERS:
                m = js.match.get(m, m) + 1
                continue
            if tok.kind == "punc" and (tok.text in CLOSERS or tok.text in (",", ";")):
                break
            if tok.text == "?" and tok.kind == "punc":
                nest += 1
            elif tok.text == ":" and tok.kind == "punc":
                if nest == 0:
                    break
                nest -= 1
            m += 1
        if m - 1 <= colon:
            return None
        return [(toks[q + 1].start, toks[colon - 1].end, [(cond, True)]),
                (toks[colon + 1].start, toks[m - 1].end, [(cond, False)])]

    def find_declarer(self):
        """The function cases are declared with, its `if (...) return` filters, and the array it defers cases to.

        The declarer takes (name, action) and runs action, or pushes it with the name to run later; other
        functions whose first parameter is `name` (a key press, a view read) do neither."""
        toks, js = self.js.toks, self.js
        for i, tok in enumerate(toks[:-6]):
            body, params = None, None
            if tok.text == "function" and toks[i + 1].kind == "id" and toks[i + 2].text == "(" and toks[i + 3].text == "name":
                close = js.match.get(i + 2)
                if close is not None and toks[close + 1].text == "{":
                    body, declarer, params = close + 1, toks[i + 1].text, (i + 3, close)
            elif tok.text in ("const", "let") and toks[i + 1].kind == "id" and toks[i + 2].text == "=":
                k = i + 3
                if toks[k].text == "async":
                    k += 1
                if toks[k].text == "(" and toks[k + 1].text == "name":
                    close = js.match.get(k)
                    if close is not None and toks[close + 1].text == "=>":
                        declarer, body, params = toks[i + 1].text, close + 2, (k + 1, close)
            if body is None:
                continue
            names = [t.text for t in toks[params[0]:params[1]] if t.kind == "id"]
            if len(names) < 2:
                continue
            action = names[1]
            end = js.match.get(body, body) if toks[body].text == "{" else self.statement_end(body)
            filters, pushed, runs = [], None, False
            k = body
            while k < end:
                if toks[k].text == "if" and toks[k + 1].text == "(" and (k + 1) in js.match:
                    close = js.match[k + 1]
                    if close + 1 < len(toks) and toks[close + 1].text == "return":
                        filters.append((k + 2, close))
                if toks[k].kind == "id" and toks[k].text == action and toks[k + 1].text == "(":
                    runs = True
                if toks[k].kind == "id" and toks[k + 1].text == "." and toks[k + 2].text == "push" and toks[k + 3].text == "(":
                    close = js.match.get(k + 3, k + 3)
                    if any(t.kind == "id" and t.text == action for t in toks[k + 4:close]):
                        pushed, runs = toks[k].text, True
                k += 1
            if runs:
                return declarer, filters, pushed
        return None, [], None

    def find_lists(self):
        """[(path, position, steps)] for every path string in a `for (const x of [...])` file list."""
        toks, js, out = self.js.toks, self.js, []
        for i, tok in enumerate(toks[:-6]):
            if tok.text == "for" and toks[i + 1].text == "(" and toks[i + 2].text in ("const", "let") and toks[i + 4].text == "of" and toks[i + 5].text == "[":
                close = js.match.get(i + 5, i + 5)
                entries = [t for t in toks[i + 6:close] if t.kind == "str" and re.match(r"^['\"](web|tests|aim_next|tools)/", t.text)]
                if entries:
                    for entry in entries:
                        out.append((js_string(entry)[0], entry.start, self.steps_at(entry.start)))
                    # The loop hashes the files as evidence: its body names them too, and that is no read by a case.
                    head = js.match.get(i + 1, close)
                    body_end = js.match.get(head + 1, head) if head + 1 < len(toks) and toks[head + 1].text == "{" else self.statement_end(head + 1)
                    self.list_spans = getattr(self, "list_spans", []) + [(tok.start, toks[min(body_end, len(toks) - 1)].end)]
        return out

    def in_list(self, pos):
        return any(a <= pos < b for a, b in getattr(self, "list_spans", []))

    def steps_at(self, pos):
        names = set(self.names)
        for start, end, excluded in self.regions:
            if start <= pos < end:
                names -= excluded
        return names

    def case_at(self, pos):
        for case in self.case_list:
            if case.start <= pos < case.end:
                return case
        return None

    def runs(self, step_name, case):
        """Whether the step runs this case: no filter refuses its name, and a deferred list selects its index."""
        if case is None:
            return True
        step = next(s for s in self.steps if s.name == step_name)
        name = ("pfx", case.name) if case.partial else ("s", case.name)
        for a, b in self.filters:
            if truth(Condition(self, self.env(step, name), a, b).value()) is True:
                return False
        if self.slices and case in self.case_list:
            index = self.case_list.index(case)
            active = [(lo, hi) for pos, lo, hi in self.slices if step_name in self.steps_at(pos)]
            if active and not any(lo <= index < (hi if hi is not None else 10 ** 9) for lo, hi in active):
                return False
        return True


# ---------------------------------------------------------------- the whole picture at HEAD

class Tests:
    """Harnesses, the test modules they import, and which steps reach each declaration."""

    def __init__(self, repo, steps):
        self.repo, self.steps = repo, steps
        self.by_name = {step.name: step for step in steps}
        self.js = {}
        harness_paths = []
        for step in steps:
            if step.harness not in harness_paths:
                harness_paths.append(step.harness)
        self.harness = {}
        for path in harness_paths:
            js = self.load(path)
            if js is None:
                continue
            self.harness[path] = Harness(js, [s for s in steps if s.harness == path])
        # Every module reachable by import from a harness.
        queue = list(self.harness)
        seen = set(queue)
        while queue:
            path = queue.pop()
            js = self.load(path)
            if js is None:
                continue
            for local, (target, _, _, _) in js.imports.items():
                if target.endswith((".mjs", ".js")) and target.startswith("tests/") and target not in seen:
                    seen.add(target)
                    queue.append(target)
        self.modules = sorted(p for p in seen if p not in self.harness and self.load(p) is not None)
        self.declarers = {h.declarer for h in self.harness.values() if h.declarer} or {"check"}
        self.module_cases = {path: self.js[path].cases(self.declarers) for path in self.modules}
        self.contexts = self.propagate()

    def load(self, path):
        if path not in self.js:
            source = self.repo.show(self.repo.head, path)
            self.js[path] = JS(path, source) if source is not None else None
        return self.js[path]

    def resolve(self, target, exported):
        """The declaration names in target an import of `exported` reaches."""
        js = self.load(target)
        if js is None:
            return []
        if exported == "*":
            return [d.name for d in js.decls if d.name]
        local = js.exports.get(exported, exported)
        return [local] if any(d.name == local for d in js.decls) else []

    def propagate(self):
        """{(module, decl): {step: call site}}: a harness's use of an imported name, in a branch some steps reach,
        runs that declaration in those steps; a declaration runs whatever it names."""
        contexts = collections.defaultdict(dict)
        work = []
        for path, harness in self.harness.items():
            js = harness.js
            for local, (target, exported, a, b) in js.imports.items():
                for name in self.resolve(target, exported):
                    for tok in js.toks:
                        if tok.kind == "id" and tok.text == local and not (a <= tok.start < b):
                            site = "%s:%d" % (path, js.line(tok.start))
                            for step in harness.steps_at(tok.start):
                                if step not in contexts[(target, name)]:
                                    contexts[(target, name)][step] = site
                                    work.append((target, name))
        while work:
            path, name = work.pop()
            js = self.load(path)
            decl = next((d for d in js.decls if d.name == name), None)
            if decl is None:
                continue
            targets = []
            for ref in decl.refs:
                if any(d.name == ref for d in js.decls):
                    targets.append((path, ref))
                elif ref in js.imports:
                    target, exported, _, _ = js.imports[ref]
                    targets.extend((target, n) for n in self.resolve(target, exported))
            for target in targets:
                for step, site in list(contexts[(path, name)].items()):
                    if step not in contexts[target]:
                        contexts[target][step] = site
                        work.append(target)
        return contexts

    def case_at(self, path, pos):
        if path in self.harness:
            return self.harness[path].case_at(pos)
        for case in self.module_cases.get(path, []):
            if case.start <= pos < case.end:
                return case
        return None

    def steps_for(self, path, pos):
        """{step: where it is called from} for a position in a harness or a module, after each harness's case filter."""
        if path in self.harness:
            harness = self.harness[path]
            case = harness.case_at(pos)
            return {s: "%s:%d" % (path, harness.js.line(pos)) for s in harness.steps_at(pos) if harness.runs(s, case)}
        js = self.js.get(path)
        if js is None or path not in self.modules:
            return {}
        decl = js.decl_at(pos)
        reached = {}
        if decl is not None and decl.name:
            reached = dict(self.contexts.get((path, decl.name), {}))
        else:
            for d in js.decls:
                for step, site in self.contexts.get((path, d.name), {}).items():
                    reached.setdefault(step, site)
        case = self.case_at(path, pos)
        out = {}
        for step, site in reached.items():
            harness = self.harness[self.by_name[step].harness]
            if harness.runs(step, case):
                out[step] = site
        return out

    def where(self, path, pos):
        """'tests/x.mjs:L case "…"' or 'tests/x.mjs:L in helper f'."""
        js = self.js[path]
        case = self.case_at(path, pos)
        text = "%s:%d" % (path, js.line(pos))
        if case:
            return '%s case "%s"' % (text, shorten(case.title))
        decl = js.decl_at(pos) if path in self.modules else None
        if decl and decl.name:
            return "%s in %s" % (text, decl.name)
        return text

    def generic_checkers(self):
        """[(path, pos, selector, kind)]: sweeps over every control of the page, or every element of a region."""
        out = []
        for path in list(self.harness) + self.modules:
            js = self.js[path]
            for match in GENERIC_SWEEP.finditer(js.src):
                if js.in_comment(match.start()):
                    continue
                selector = match.group(2).strip()
                parts = [part.strip() for part in selector.split(",")]
                if not parts or any("#" in part or re.search(r"(^|[\s>+~(])\.", part) for part in parts):
                    continue
                every = all(part in ("*", "body *") for part in parts)
                document = DOC_RECEIVER.search(js.src[max(0, match.start() - 60):match.start()])
                if every or (document and any(CONTROL_PART.match(part) for part in parts)):
                    out.append((path, match.start(), selector, "every element" if every else "every control"))
        return out


def shorten(text, limit=70):
    return text if len(text) <= limit else text[:limit - 1] + "…"


# ---------------------------------------------------------------- what the diff changes

def css_rules(text):
    """[(at-rule context, selector, body)] with whitespace collapsed."""
    text = re.sub(r"/\*.*?\*/", "", text or "", flags=re.S)
    out, n = [], len(text)
    norm = lambda s: re.sub(r"\s+", " ", s).strip()

    def block_end(i):
        depth, j = 1, i + 1
        while j < n and depth:
            if text[j] in "\"'":
                quote, j = text[j], j + 1
                while j < n and text[j] != quote:
                    j += 2 if text[j] == "\\" else 1
            elif text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
            j += 1
        return j

    def walk(i, context):
        start = i
        while i < n:
            ch = text[i]
            if ch in "\"'":
                quote, i = ch, i + 1
                while i < n and text[i] != quote:
                    i += 2 if text[i] == "\\" else 1
                i += 1
                continue
            if ch == "{":
                prelude = norm(text[start:i])
                if prelude.startswith("@"):
                    i = walk(i + 1, context + (prelude,))
                else:
                    end = block_end(i)
                    out.append((context, prelude, norm(text[i + 1:end - 1])))
                    i = end
                start = i
                continue
            if ch == "}":
                return i + 1
            if ch == ";":
                start = i + 1
            i += 1
        return i

    walk(0, ())
    return out


def selector_names(selector):
    """[(kind, name)] of the ids, classes and data attributes a CSS selector names."""
    names = [("data", m) for m in re.findall(r"\[\s*(data-[\w-]+)", selector)]
    bare = re.sub(r"\[[^\]]*\]", " ", re.sub(r"(['\"]).*?\1", " ", selector))
    names += [("id", m) for m in re.findall(r"#(-?[A-Za-z_][\w-]*)", bare)]
    names += [("class", m) for m in re.findall(r"\.(-?[A-Za-z_][\w-]*)", bare)]
    return names




def code_names(line):
    """[(kind, name)] of the ids, classes and data attributes a line of web code or markup gives an element:
    id= and class= in markup, .id and .className set, classList.add/remove/toggle/replace, setAttribute, and
    data attributes written (data-x= in markup, dataset.x set, setAttribute/toggleAttribute). A lookup
    (getElementById, querySelector, classList.contains, a dataset read) gives nothing, so is not a change."""
    names = []
    for m in re.finditer(r"(?:\.id\s*=(?!=)\s*|(?<![\w-])id\s*=\s*\\?)['\"`]([\w-]+)", line):
        names.append(("id", m.group(1)))
    for m in re.finditer(r"(?:className\s*=(?!=)\s*|(?<![\w-])class\s*=\s*\\?)['\"`]([^'\"`\\]+)", line):
        names += [("class", c) for c in m.group(1).split() if re.match(r"^-?[A-Za-z_][\w-]*$", c)]
    for m in re.finditer(r"classList\.(?:add|remove|toggle|replace)\(([^)]*)\)", line):
        names += [("class", c) for c in re.findall(r"['\"`]([\w-]+)['\"`]", m.group(1))]
    for m in re.finditer(r"(?:setAttribute|toggleAttribute|removeAttribute)\(\s*['\"](id|class|data-[\w-]+)['\"]\s*(?:,\s*['\"`]([^'\"`]*))?", line):
        if m.group(1) == "id" and m.group(2):
            names.append(("id", m.group(2)))
        elif m.group(1) == "class" and m.group(2):
            names += [("class", c) for c in m.group(2).split()]
        elif m.group(1).startswith("data-"):
            names.append(("data", m.group(1)))
    names += [("data", m) for m in re.findall(r"(?<![\w-])(data-[a-z][\w-]*)\s*=", line)]
    for m in re.finditer(r"\bdataset\.([A-Za-z_]\w*)\s*=(?!=)|\bdelete\s+[\w.]*\bdataset\.([A-Za-z_]\w*)", line):
        prop = m.group(1) or m.group(2)
        names.append(("data", "data-" + re.sub(r"([A-Z])", lambda c: "-" + c.group(1).lower(), prop)))
    return names


def js_units(js):
    """[(name, start, end, class text)]: every class method, then every top-level declaration."""
    toks, out = js.toks, []
    for decl in js.decls:
        k = js.at(decl.start)
        head = [t.text for t in toks[k:k + 4]]
        if "class" in head:
            b = k
            while b < len(toks) and toks[b].start < decl.end and toks[b].text != "{":
                b += 1
            close = js.match.get(b)
            if close is not None:
                inner, m = js.depth[b] + 1, b + 1
                text = js.src[toks[b].start:toks[close].end]
                while m < close:
                    tok = toks[m]
                    if js.depth[m] == inner and tok.kind == "id" and toks[m + 1].text == "(" and (m + 1) in js.match:
                        after = js.match[m + 1] + 1
                        if after < close and toks[after].text == "{":
                            end = js.match.get(after, after)
                            out.append(("%s.%s" % (decl.name, tok.text), tok.start, toks[end].end, text))
                            m = end + 1
                            continue
                    m += 1
                out.append((decl.name, decl.start, decl.end, text))
                continue
        out.append((decl.name or "module level", decl.start, decl.end, None))
    return out


def smallest_unit(units, pos):
    best = None
    for unit in units:
        if unit[1] <= pos < unit[2] and (best is None or unit[2] - unit[1] < best[2] - best[1]):
            best = unit
    return best


STATEMENT_LINES = 60  # a longer enclosing statement contributes only its first line (where a handler is attached)


def statement_chain(js, i, unit):
    """Source of the statement holding token i, then of each statement enclosing it, up to the unit's body."""
    toks, out = js.toks, []
    lo = unit[1] if unit else 0
    while 0 <= i < len(toks) and toks[i].start >= lo:
        depth = js.depth[i]
        a = i
        while a - 1 >= 0 and toks[a - 1].start >= lo:
            prev = toks[a - 1]
            if prev.kind == "punc" and prev.text in (")", "]") and (a - 1) in js.match and js.depth[a - 1] == depth:
                a = js.match[a - 1]
                continue
            if js.depth[a - 1] != depth or (prev.kind == "punc" and prev.text in (";", "}", "{", ",")):
                break
            a -= 1
        b = i
        while b + 1 < len(toks):
            nxt = toks[b + 1]
            if nxt.kind == "punc" and nxt.text in OPENERS and js.depth[b + 1] == depth:
                b = js.match.get(b + 1, b + 1)
                continue
            if js.depth[b + 1] < depth or (nxt.kind == "punc" and nxt.text in CLOSERS) or (nxt.kind == "punc" and nxt.text in (";", ",") and js.depth[b + 1] == depth):
                break
            b += 1
        text = js.src[toks[a].start:toks[b].end]
        out.append(text if text.count("\n") <= STATEMENT_LINES else text.split("\n", 1)[0])
        # The group holding this statement, and the statement that holds the group.
        opener = None
        for k in range(a - 1, -1, -1):
            if toks[k].kind == "punc" and toks[k].text in OPENERS and js.match.get(k, -1) >= b:
                opener = k
                break
        if opener is None or toks[opener].start < lo:
            break
        if unit and toks[opener].text == "{" and opener > 0 and toks[opener - 1].text == ")" and js.match.get(opener - 1) is not None:
            head = js.match[opener - 1] - 1
            if head >= 0 and toks[head].start == unit[1] or (head >= 0 and toks[head].text in (unit[0].split(".")[-1],) and js.depth[head] == js.depth[opener]):
                break  # the unit's own body
        i = opener
    return out


def surface_names(text, owner=None):
    """[(kind, name)] of the elements a piece of code wires: looked up, created, or given a class or handler."""
    names = list(code_names(text))
    for m in re.finditer(r"(?:getElementById|\$)\(\s*['\"`]([\w-]+)['\"`]\s*\)", text):
        names.append(("id", m.group(1)))
    for m in re.finditer(r"(?:querySelector(?:All)?|closest|matches)\(\s*(['\"`])((?:(?!\1).)*)\1", text):
        names += [(k, v) for k, v in selector_names(m.group(2)) if not (k == "class" and re.match(r"^\d", v))]
    for m in re.finditer(r"classList\.contains\(\s*['\"`]([\w-]+)['\"`]", text):
        names.append(("class", m.group(1)))
    for m in re.finditer(r"\bdataset\.([A-Za-z_]\w*)", text):
        names.append(("data", "data-" + re.sub(r"([A-Z])", lambda c: "-" + c.group(1).lower(), m.group(1))))
    if owner:
        for field in sorted(set(re.findall(r"\bthis\.([A-Za-z_]\w*)", text))):
            for m in re.finditer(r"\bthis\.%s\s*=(?!=)([^;\n]*)" % re.escape(field), owner):
                names += surface_names(m.group(1))
    out = []
    for item in names:
        if item not in out:
            out.append(item)
    return out


class Changes:
    """What the diff changes: selectors (with the files and the sense of each change), files, controls."""

    def __init__(self, repo, files):
        self.repo, self.files = repo, files
        self.selectors = collections.OrderedDict()  # (kind, name) -> {path: set(verbs)}
        self.controls = collections.OrderedDict()   # path -> why it changes a control
        self.surface = collections.OrderedDict()    # (kind, name) -> {path: [units whose behaviour changes]}
        for path, hunks in files.items():
            if path.startswith("web/") and path.endswith(".css"):
                self.css(path)
            elif path.startswith("web/") and path.endswith((".html", ".mjs", ".js")):
                self.code(path, hunks)
                if not path.endswith(".html"):
                    self.behaviour(path, hunks)

    def behaviour(self, path, hunks):
        """What a change to existing code drives. For each changed line that is code: its statement and every
        statement enclosing it up to its unit (class method, function or top-level statement), so a changed handler
        body counts with the element the handler is attached to; for a changed method, the statements that call it
        (its entry points); and the elements those statements wire: ids and classes looked up, created or given a
        class, and the `this.x` fields they use, as the class sets them."""
        for rev, side in ((self.repo.base, "old"), (self.repo.head, "new")):
            text = self.repo.show(rev, path)
            if text is None:
                continue
            js = JS(path, text)
            units = js_units(js)
            for hunk in hunks:
                for number, line in getattr(hunk, side):
                    stripped = line.strip()
                    if not stripped or stripped.startswith(("//", "*", "/*")) or number - 1 >= len(js.lines):
                        continue
                    pos = js.lines[number - 1] + (len(line) - len(line.lstrip()))
                    unit = smallest_unit(units, pos)
                    name = unit[0] if unit else "line %d" % number
                    owner = unit[3] if unit else None
                    pieces = statement_chain(js, js.at(pos), unit)
                    method = name.split(".", 1)[1] if unit and "." in name else None
                    if method and method != "constructor" and owner:
                        base = js.src.index(owner)
                        for call in re.finditer(r"\bthis\.%s\b" % re.escape(method), owner):
                            site = base + call.start()
                            pieces += statement_chain(js, js.at(site), smallest_unit(units, site))
                    for kind, label in surface_names("\n".join(pieces), owner):
                        held = self.surface.setdefault((kind, label), collections.OrderedDict()).setdefault(path, [])
                        if name not in held:
                            held.append(name)

    def wiring(self, key):
        return ", ".join("%s %s" % (path, "/".join(units[:4]) + ("…" if len(units) > 4 else ""))
                         for path, units in self.surface[key].items())

    def note(self, kind, name, path, verb):
        if name:
            self.selectors.setdefault((kind, name), collections.OrderedDict()).setdefault(path, set()).add(verb)

    def css(self, path):
        old = collections.Counter(css_rules(self.repo.show(self.repo.base, path)))
        new = collections.Counter(css_rules(self.repo.show(self.repo.head, path)))
        removed, added = old - new, new - old
        for rules, verb in ((removed, "removes"), (added, "adds")):
            for context, selector, body in rules:
                for kind, name in selector_names(selector):
                    self.note(kind, name, path, verb)
        if removed or added:
            self.controls[path] = "changes %d CSS rule%s" % (len(removed) + len(added), "" if len(removed) + len(added) == 1 else "s")

    def code(self, path, hunks):
        html = path.endswith(".html")
        control = False
        for hunk in hunks:
            for lines, verb in ((hunk.old, "removes"), (hunk.new, "adds")):
                for _, text in lines:
                    stripped = text.strip()
                    if not html and (stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("/*")):
                        continue
                    for kind, name in code_names(text):
                        self.note(kind, name, path, verb)
                    if (html and "<" in text) or WEB_CONTROL.search(text):
                        control = True
        if control:
            self.controls[path] = "changes markup" if html else "creates or changes a control"

    @staticmethod
    def label(kind, name):
        return {"id": "#", "class": "."}.get(kind, "") + name if kind != "data" else "[%s]" % name

    def sense(self, key):
        parts = []
        for path, verbs in self.selectors[key].items():
            verb = "changes" if len(verbs) > 1 else next(iter(verbs))
            parts.append("%s %s" % (path, verb))
        return ", ".join(parts)


def selector_pattern(kind, name):
    n = re.escape(name)
    if kind == "data":
        camel = re.sub(r"-([a-z])", lambda m: m.group(1).upper(), name[5:])
        return re.compile(r"(?<![\w-])%s(?![\w-])|\bdataset\.%s\b|\bdataset\[['\"]%s['\"]\]" % (n, re.escape(camel), re.escape(camel))), False
    if kind == "id":
        bare = r"|(?<=['\"`])%s(?=['\"`])" % n if "-" in name else ""
        return re.compile(r"(?<![\w&-])#%s(?![\w-])|getElementById\(\s*['\"`]%s['\"`]|\bid\s*[=:]=*\s*\\?['\"`]%s['\"`]|\[id=['\"]?%s\b%s" % (n, n, n, n, bare)), "-" not in name
    bare = r"|(?<=['\"`])%s(?=['\"`])" % n if "-" in name else ""
    return re.compile(r"\.%s(?![\w-])|classList\.\w+\(\s*['\"`]%s['\"`]|\bclass(?:Name)?\s*[=:]=*\s*\\?['\"`](?:[^'\"`]*\s)?%s(?=[\s'\"`])%s"
                      % (n, n, n, bare)), "-" not in name


TAG_SET = set(TAGS.split("|"))


def class_context(src, pos):
    """Whether a .name at pos stands where a selector puts a class: after a non-word character, or after a tag name."""
    if pos == 0 or src[pos] != ".":
        return True
    if not re.match(r"[\w$-]", src[pos - 1]):
        return True
    word = re.search(r"(?<![\w$.-])([A-Za-z][A-Za-z0-9]*)$", src[max(0, pos - 16):pos])
    return bool(word) and word.group(1) in TAG_SET



METHOD_BRANCH = re.compile(r"^\s*(?:el)?if\b.*\brequest\[[\"']method[\"']\]\s*(?:==|in)\s*(.+?):\s*(?:#.*)?$")


def fixture_methods(repo, path, hunks):
    """The control methods a change to a test fixture is confined to: every changed line sits in a
    `request["method"] == "x"` branch. None when any line is outside one (then the fixture is the harness's)."""
    if not (path.startswith("tests/") and path.endswith(".py")):
        return None
    sides = ((repo.show(repo.base, path), [h.old for h in hunks]), (repo.show(repo.head, path), [h.new for h in hunks]))
    methods = []
    for text, groups in sides:
        if text is None:
            if any(groups):
                return None
            continue
        lines = text.split("\n")
        for group in groups:
            for number, _ in group:
                found = enclosing_method(lines, number)
                if found is None:
                    return None
                methods += [m for m in found if m not in methods]
    return methods or None


def enclosing_method(lines, number):
    text = lines[number - 1] if number - 1 < len(lines) else ""
    match = METHOD_BRANCH.match(text)
    if match:
        return re.findall(r"['\"]([\w.:-]+)['\"]", match.group(1))
    indent = len(text) - len(text.lstrip()) if text.strip() else 10 ** 6
    for k in range(number - 2, -1, -1):
        line = lines[k]
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        depth = len(line) - len(line.lstrip())
        if depth < indent:
            match = METHOD_BRANCH.match(line)
            if match:
                return re.findall(r"['\"]([\w.:-]+)['\"]", match.group(1))
            if re.match(r"\s*(def|class)\b", line) or depth == 0:
                return None
            indent = depth
    return None

# ---------------------------------------------------------------- choosing

class Choice:
    def __init__(self, steps):
        self.order = [step.name for step in steps]
        self.reasons = collections.defaultdict(collections.OrderedDict)  # step -> key -> {"text": , "where": [..]}

    def add(self, step, key, text, where=None):
        entry = self.reasons[step].setdefault(key, {"text": text, "where": []})
        if where and where not in entry["where"]:
            entry["where"].append(where)

    def lines(self, step, limit=3):
        out = []
        for entry in self.reasons[step].values():
            where = entry["where"]
            if where:
                shown = "; ".join(where[:limit]) + (" (+%d more)" % (len(where) - limit) if len(where) > limit else "")
                out.append("%s (%s)" % (entry["text"], shown))
            else:
                out.append(entry["text"])
        return out


def choose(repo):
    head_check = repo.show(repo.head, "tools/release_check.py")
    if head_check is None:
        raise Refused("no tools/release_check.py at %s" % repo.head)
    steps = read_steps(head_check)
    units = read_units(head_check)
    files = repo.diff()
    tests = Tests(repo, steps)
    changes = Changes(repo, files)
    choice = Choice(steps)
    notes, used = [], set()
    native = lambda name: "native-" + name
    all_names = [s.name for s in steps]
    harness_of = {s.name: s.harness for s in steps}

    # Which steps list each file, for rule 4 and for telling page-wide files apart.
    listing = collections.defaultdict(dict)  # path -> harness -> (steps, line)
    for path, harness in tests.harness.items():
        for entry, pos, names in harness.lists:
            have = listing[entry].setdefault(path, (set(), harness.js.line(pos)))
            have[0].update(names)
    listed_by = lambda f: set().union(*[v[0] for v in listing.get(f, {}).values()]) if listing.get(f) else set()
    page_wide = lambda f: f.startswith("web/") and len(listed_by(f)) * 2 > len(all_names)

    # 1. Selectors and basenames, grepped across every harness and the modules they load.
    scope = list(tests.harness) + tests.modules
    for key, sources in changes.selectors.items():
        pattern, needs_string = selector_pattern(*key)
        label = Changes.label(*key)
        found = False
        for path in scope:
            js = tests.js[path]
            harness = tests.harness.get(path)
            for match in pattern.finditer(js.src):
                pos = match.start()
                if js.in_comment(pos) or (needs_string and not js.in_string(pos)) or (harness and harness.in_list(pos)):
                    continue
                if key[0] == "class" and not class_context(js.src, pos):
                    continue
                for step in tests.steps_for(path, pos):
                    choice.add(step, ("selector", label), "[selector] %s (%s) is read" % (label, changes.sense(key)), tests.where(path, pos))
                    found = True
                    used.update(sources)
        if not found:
            notes.append("no case any native step runs reads %s (%s)" % (label, changes.sense(key)))
    # 1b. Behaviour: a change to existing code chooses the cases that read what the changed unit wires.
    for key, sources in changes.surface.items():
        if key in changes.selectors:
            continue  # the selector rule already reads it
        pattern, needs_string = selector_pattern(*key)
        label = Changes.label(*key)
        for path in scope:
            js = tests.js[path]
            harness = tests.harness.get(path)
            for match in pattern.finditer(js.src):
                pos = match.start()
                if js.in_comment(pos) or (needs_string and not js.in_string(pos)) or (harness and harness.in_list(pos)):
                    continue
                if key[0] == "class" and not class_context(js.src, pos):
                    continue
                for step in tests.steps_for(path, pos):
                    choice.add(step, ("behaviour", label), "[behaviour] %s is wired by %s, whose code the diff changes, and is read"
                               % (label, changes.wiring(key)), tests.where(path, pos))
                    used.update(sources)
    confined = {}
    for path, hunks in files.items():
        methods = fixture_methods(repo, path, hunks)
        if methods:
            confined[path] = methods
            for method in methods:
                pattern = re.compile(r"\bmethod\s*:\s*['\"`]%s['\"`]" % re.escape(method))
                found = False
                for test in scope:
                    js = tests.js[test]
                    for match in pattern.finditer(js.src):
                        if js.in_comment(match.start()):
                            continue
                        for step in tests.steps_for(test, match.start()):
                            choice.add(step, ("method", path, method), "[fixture] method %s (%s changes only its branch) is called"
                                       % (method, path), tests.where(test, match.start()))
                            found = True
                            used.add(path)
                if not found:
                    notes.append("no case any native step runs calls fixture method %s (%s)" % (method, path))
    for path in files:
        if path in confined:
            continue
        base = posixpath.basename(path)
        pattern = re.compile(r"(?<![\w-])%s(?![\w-])" % re.escape(base))
        for test in scope:
            js = tests.js[test]
            harness = tests.harness.get(test)
            for match in pattern.finditer(js.src):
                pos = match.start()
                if js.in_comment(pos) or (harness and harness.in_list(pos)):
                    continue
                imported = [(local, spec) for local, spec in js.imports.items() if spec[2] <= pos < spec[3]]
                if imported:
                    # An import names the file where its bindings are used; a changed test module is rule 5's.
                    if any(spec[0] == path for _, spec in imported) and path in tests.modules:
                        continue
                    uses = [tok.start for tok in js.toks for local, spec in imported
                            if tok.kind == "id" and tok.text == local and not (spec[2] <= tok.start < spec[3])]
                else:
                    uses = [pos]
                for use in uses:
                    reached = tests.steps_for(test, use)
                    if harness and page_wide(path) and set(reached) == set(harness.names) and not harness.case_at(use):
                        continue  # a file every page loads, named by code every step of the harness runs
                    for step in reached:
                        choice.add(step, ("file", path), "[file] %s (changed) is named" % base, tests.where(test, use))
                        used.add(path)

    # 2. Generic checkers, when the diff changes a control's markup or CSS.
    checkers = []
    for path, pos, selector, kind in tests.generic_checkers():
        reached = tests.steps_for(path, pos)
        checkers.append({"where": tests.where(path, pos), "selector": selector, "reads": kind,
                         "steps": [native(s) for s in all_names if s in reached]})
        if changes.controls:
            why = ", ".join(changes.controls)
            for step in reached:
                choice.add(step, ("generic", path, kind), "[generic] checker %s reads %s, and the diff changes controls (%s)"
                           % (path, kind, why), "%s querySelectorAll('%s')" % (tests.where(path, pos), shorten(selector, 50)))
                used.update(changes.controls)

    # 4. A changed file on a step's own part of a harness file list.
    for path in files:
        if path not in listing or path in tests.modules or path in tests.harness or path in confined:
            continue  # a test module's own cases are rule 5's
        if page_wide(path):
            notes.append("%s is on the file lists of %d of %d native steps (every page loads it), so it chooses none by itself"
                         % (path, len(listed_by(path)), len(all_names)))
            continue
        for harness_path, (names, line) in listing[path].items():
            harness = tests.harness[harness_path]
            conditional = names != set(harness.names)
            infrastructure = path.startswith("tests/") and path not in tests.modules and path not in tests.harness
            own = conditional or len(harness.names) == 1 or infrastructure \
                or not any(h != harness_path for h in listing[path])
            if own:
                what = "file list of %s" % ("--" + "/".join(sorted(n for n in names)) if conditional else "every %s step" % harness_path)
                for step in names:
                    choice.add(step, ("list", path), "[list] %s is on the %s" % (path, what), "%s:%d" % (harness_path, line))
                used.add(path)
            else:
                notes.append("%s is on the every-mode file list of %s (%s:%d), which other harnesses also list; not chosen by that"
                             % (path, harness_path, harness_path, line))

    # 5. Changed tests: a harness chooses all its steps; a module the steps its changed cases and helpers run in.
    for path, hunks in files.items():
        if path in tests.harness:
            for step in tests.harness[path].names:
                choice.add(step, ("harness", path), "[harness] %s changed: the harness itself runs this step" % path)
            used.add(path)
        elif path in tests.modules:
            js = tests.js[path]
            for hunk in hunks:
                lines = [line for line, _ in hunk.new] or [max(1, hunk.new_start)]
                for line in lines:
                    pos = js.lines[min(line, len(js.lines)) - 1]
                    end = js.lines[line] if line < len(js.lines) else len(js.src)
                    while pos < end and js.src[pos] in " \t":
                        pos += 1
                    case = tests.case_at(path, pos)
                    decl = js.decl_at(pos)
                    label = ('case "%s"' % shorten(case.title)) if case else \
                        ("helper %s" % decl.name if decl and decl.name else "module level")
                    for step, site in tests.steps_for(path, pos).items():
                        entry = choice.reasons[step].get(("test", path))
                        if entry and any(w.endswith(label) for w in entry["where"]):
                            continue
                        choice.add(step, ("test", path), "[test] %s changes its own cases" % path, "%s:%d %s" % (path, line, label))
                        used.add(path)

    # 6. Tools and CI.
    old_check = repo.show(repo.base, "tools/release_check.py")
    for path, hunks in files.items():
        if path == "tools/native.py":
            for step in all_names:
                choice.add(step, ("tool", path), "[tool] tools/native.py changed: it runs every native step")
            used.add(path)
        elif path == "tools/release_check.py":
            try:
                before = {s.name: s for s in read_steps(old_check)} if old_check else {}
            except (KeyError, ValueError, SyntaxError):
                before = {}
            for step in steps:
                if before.get(step.name) != step:
                    choice.add(step.name, ("tool", path), "[tool] tools/release_check.py %s this step in NATIVE_STEPS"
                               % ("adds" if step.name not in before else "changes"))
                    used.add(path)
            runner = runner_lines(head_check, repo.show(repo.head, "tools/native.py") or "")
            touched = sorted({name for hunk in hunks for line, _ in hunk.new for name, lo, hi in runner if lo <= line <= hi}
                             | {name for hunk in hunks for line, _ in hunk.old for name, lo, hi in runner_lines(old_check or "", repo.show(repo.base, "tools/native.py") or "") if lo <= line <= hi})
            if touched:
                for step in all_names:
                    choice.add(step, ("tool-runner", path), "[tool] tools/release_check.py changes %s, which tools/native.py runs every step through" % ", ".join(touched))
                used.add(path)
        elif path.startswith(".github/"):
            text = "\n".join(t for hunk in hunks for _, t in hunk.old + hunk.new)
            for step in steps:
                if re.search(r"(?<![\w-])native-%s(?![\w-])" % re.escape(step.name), text) or step.harness in text:
                    choice.add(step.name, ("ci", path), "[ci] %s changes a line naming this step" % path)
                    used.add(path)
    tools_changed = [p for p in files if p.startswith("tools/")]
    ci_changed = [p for p in files if p.startswith(".github/")]
    if tools_changed:
        unread = [p for p in tools_changed if p not in used]
        notes.append("the diff touches tools/: %s%s" % (", ".join(tools_changed),
                     "; no native harness or step runner reads %s" % ", ".join(unread) if unread else ""))
    if ci_changed:
        notes.append("the diff touches .github/: %s%s" % (", ".join(ci_changed),
                     "" if all(p in used for p in ci_changed) else "; it names no native step"))

    always_files = [p for p in files if p == "tests/acts.json" or re.match(r"tests/(test_[^/]+\.py|[^/]+\.test\.mjs)$", p)]
    unexplained = [p for p in files if p not in used and p not in always_files and not p.startswith(("tools/", ".github/"))]
    if unexplained:
        notes.append("no native step reads %d changed file%s: %s" % (len(unexplained), "" if len(unexplained) == 1 else "s", ", ".join(unexplained)))
    always = "always run, not native steps: %s and the acts ledger (tests/acts.json)%s" % (
        ", ".join(units), "; changed here: %s" % ", ".join(always_files) if always_files else "")
    chosen = [s for s in all_names if choice.reasons.get(s)]
    return {"worktree": repo.root, "base": repo.base, "head": repo.head,
            "steps": [{"step": native(s), "harness": harness_of[s], "flags": list(next(x for x in steps if x.name == s).flags),
                       "reasons": choice.lines(s)} for s in chosen],
            "always": always, "notes": notes, "checkers": checkers,
            "selectors": {Changes.label(*k): changes.sense(k) for k in changes.selectors},
            "controls": dict(changes.controls)}


def runner_lines(release_check_source, native_source):
    """[(name, first line, last line)] of every release_check function tools/native.py calls."""
    if not release_check_source:
        return []
    try:
        tree, _ = python_assigns(release_check_source)
    except SyntaxError:
        return []
    # NATIVE_STEPS itself is compared step by step instead: a changed step is chosen, not every one.
    called = set(re.findall(r"release_check\.([A-Za-z_]\w*)\s*\(", native_source))
    out = []
    for node in tree.body:
        name = node.name if isinstance(node, (ast.FunctionDef, ast.ClassDef)) else \
            node.targets[0].id if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name) else None
        if name in called:
            out.append((name, node.lineno, getattr(node, "end_lineno", node.lineno)))
    return out


def render(result, checkers=False):
    lines = ["steps-for %s..%s in %s" % (result["base"][:10], result["head"][:10], result["worktree"])]
    for step in result["steps"]:
        lines.append("%s: %s" % (step["step"], "; ".join(step["reasons"])))
    if not result["steps"]:
        lines.append("no native step chosen")
    lines.append(result["always"])
    for note in result["notes"]:
        lines.append("note: " + note)
    if checkers:
        lines.append("generic checkers:")
        for checker in result["checkers"]:
            lines.append("  %s querySelectorAll('%s') reads %s; runs in %s" % (checker["where"], shorten(checker["selector"], 60), checker["reads"],
                                                                                ", ".join(checker["steps"]) or "no step"))
    return "\n".join(lines)


USAGE = "Usage: tools/steps_for.py WORKTREE BASE [--head REV] [--json] [--checkers]"


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    as_json = "--json" in argv
    show_checkers = "--checkers" in argv
    rest = [a for a in argv if a not in ("--json", "--checkers")]
    head = "HEAD"
    if "--head" in rest:
        at = rest.index("--head")
        if at + 1 >= len(rest):
            print(USAGE, file=sys.stderr)
            return 2
        head = rest[at + 1]
        rest = rest[:at] + rest[at + 2:]
    if len(rest) != 2 or any(a.startswith("-") for a in rest):
        print(USAGE, file=sys.stderr)
        return 2
    worktree, base = rest
    if not os.path.isdir(worktree):
        print("not a directory: %s" % worktree, file=sys.stderr)
        return 2
    try:
        result = choose(Repo(os.path.abspath(worktree), base, head))
    except Refused as refusal:
        print("refused: %s" % refusal, file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2) if as_json else render(result, show_checkers))
    return 0


if __name__ == "__main__":
    sys.exit(main())
