from __future__ import annotations

"""Every read of a message's words goes through aim_next/message_edit.py.

A message's words are its latest revision (docs/message-edit.md), so a read of
`messages.body` anywhere else would show the words as first sent. This reads
each module's SQL and fails on a read of the column itself: `alias.body` or
`alias.*` where the alias names `messages`, `SELECT *` from it, or a bare
`body` selected from it.

SQL is often built in pieces: a column list in one statement, a clause from a
function, a constant from another module, joined to `FROM messages m` in
another. So each string expression is read as the text it makes, with each
name, attribute and call it uses resolved to the strings it is assigned or
returns, in this module or the one it was imported from (every assignment of
a name counts). What the words helper gives, and what cannot be resolved (a
parameter, a value read at run time), is a hole. A piece that reads
`alias.body` and binds no table to that alias itself is a read of the column
when its module binds that alias to `messages` anywhere, or binds that alias
to no table and some module binds it to `messages`.
"""

import ast
import re
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent / "aim_next"
HELPER = "message_edit"
HOLE = " ? "
KEYWORDS = r"(?!(?:WHERE|ON|INDEXED|NOT|JOIN|CROSS|LEFT|INNER|OUTER|USING|ORDER|GROUP|LIMIT|AND|OR|SET|VALUES|UNION|HAVING)\b)"
BOUND = re.compile(r"\b(?:FROM|JOIN)\s+messages\b(?:\s+(?:AS\s+)?" + KEYWORDS + r"(\w+))?", re.I)
# Any table and the alias it is read by (the table's own name when it has none).
ANY_BOUND = re.compile(r"\b(?:FROM|JOIN)\s+(\w+)(?:\s+(?:AS\s+)?" + KEYWORDS + r"(\w+))?", re.I)
COMPOSING = (ast.BinOp, ast.JoinedStr, ast.FormattedValue, ast.IfExp, ast.Tuple, ast.List)
STRING_METHODS = {"join", "format", "strip", "lstrip", "rstrip", "upper", "lower", "replace"}


class Module:
    """One module's names, functions and imports, and the text each string expression in it makes."""

    def __init__(self, name, source, package):
        self.module, self.package = name, package
        self.tree = ast.parse(source)
        self.parents = {child: node for node in ast.walk(self.tree) for child in ast.iter_child_nodes(node)}
        self.names, self.functions, self.imports, self.modules = {}, {}, {}, {}
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Assign):
                targets, value = node.targets, node.value
            elif isinstance(node, (ast.AnnAssign, ast.AugAssign)) and node.value is not None:
                targets, value = [node.target], node.value
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                self.functions.setdefault(node.name, []).append(node)
                continue
            elif isinstance(node, ast.ImportFrom) and node.level == 1:
                for alias in node.names:
                    if node.module:
                        self.imports[alias.asname or alias.name] = (node.module, alias.name)
                    else:
                        self.modules[alias.asname or alias.name] = alias.name
                continue
            else:
                continue
            for target in targets:
                for name in ast.walk(target):
                    if isinstance(name, ast.Name):
                        self.names.setdefault((self.scope(node), name.id), []).append(value)
                    elif isinstance(name, ast.Attribute):
                        self.names.setdefault((None, name.attr), []).append(value)
        self.memo, self.busy = {}, set()

    def scope(self, node):
        while node in self.parents:
            node = self.parents[node]
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                return node
        return None

    def name(self, scope, name):
        """The text a name in scope can hold: every value assigned to it there, else in the module, else imported."""
        for where in ((scope, None) if scope is not None else (None,)):
            if (where, name) in self.names:
                return self.resolved((where, name), lambda: " ".join(self.fold(value) for value in self.names[(where, name)]))
        if name in self.imports:
            module, original = self.imports[name]
            other = self.package.get(module)
            return other.name(None, original) if other else HOLE
        return HOLE

    def call(self, name):
        """What a function of this module returns, every return together."""
        if name in self.imports:
            module, original = self.imports[name]
            other = self.package.get(module)
            return other.call(original) if other else HOLE
        if name not in self.functions:
            return HOLE
        return self.resolved(("()", name), lambda: " ".join(
            self.fold(node.value) for function in self.functions[name] for node in ast.walk(function)
            if isinstance(node, ast.Return) and node.value is not None))

    def resolved(self, key, text):
        if self.module == HELPER:
            return HOLE
        if key in self.busy:
            return HOLE
        if key not in self.memo:
            self.busy.add(key)
            try:
                self.memo[key] = text()
            finally:
                self.busy.discard(key)
        return self.memo[key]

    def fold(self, node):
        """The text node makes, holes where it holds what cannot be known here."""
        if isinstance(node, ast.Constant):
            return node.value if isinstance(node.value, str) else HOLE
        if isinstance(node, ast.JoinedStr):
            return "".join(self.fold(part) for part in node.values)
        if isinstance(node, ast.FormattedValue):
            return self.fold(node.value)
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            return self.fold(node.left) + self.fold(node.right)
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Mod):
            values = node.right.elts if isinstance(node.right, ast.Tuple) else [node.right]
            return _fill(self.fold(node.left), r"%(?:\([^)]*\))?[sdrif]", [self.fold(value) for value in values])
        if isinstance(node, ast.IfExp):
            return self.fold(node.body) + " " + self.fold(node.orelse)
        if isinstance(node, (ast.Tuple, ast.List, ast.Set)):
            return " ".join(self.fold(element) for element in node.elts)
        if isinstance(node, (ast.GeneratorExp, ast.ListComp)):
            return self.fold(node.elt)
        if isinstance(node, ast.Name):
            return self.name(self.scope(node), node.id)
        if isinstance(node, ast.Attribute):
            if isinstance(node.value, ast.Name) and node.value.id in self.modules:
                other = self.package.get(self.modules[node.value.id])
                return other.name(None, node.attr) if other else HOLE
            return self.name(None, node.attr)
        if isinstance(node, ast.Call):
            function = node.func
            if isinstance(function, ast.Attribute) and function.attr in STRING_METHODS:
                arguments = [self.fold(argument) for argument in node.args] + [self.fold(keyword.value) for keyword in node.keywords]
                if function.attr == "format":
                    return _fill(self.fold(function.value), r"\{[^{}]*\}", arguments)
                return " ".join([self.fold(function.value)] + arguments)
            if isinstance(function, ast.Name):
                return self.call(function.id)
            if isinstance(function, ast.Attribute) and isinstance(function.value, ast.Name) and function.value.id in self.modules:
                other = self.package.get(self.modules[function.value.id])
                return other.call(function.attr) if other else HOLE
            return HOLE
        return HOLE

    def strings(self):
        """(line, text) for each string expression not part of a larger one."""
        for node in ast.walk(self.tree):
            if not isinstance(node, (ast.Constant, ast.JoinedStr, ast.BinOp, ast.Call)):
                continue
            if isinstance(node, ast.Constant) and not isinstance(node.value, str):
                continue
            if isinstance(node, ast.Call) and not (isinstance(node.func, ast.Attribute) and node.func.attr in STRING_METHODS):
                continue
            if self._inside_a_string(node):
                continue
            text = self.fold(node)
            if text.strip(" ?"):
                yield node.lineno, text

    def _inside_a_string(self, node):
        parent = self.parents.get(node)
        while parent is not None:
            if isinstance(parent, (ast.BinOp, ast.JoinedStr, ast.FormattedValue)):
                return True
            if isinstance(parent, ast.Call) and isinstance(parent.func, ast.Attribute) and parent.func.attr in STRING_METHODS:
                return True
            if not isinstance(parent, COMPOSING):
                return False
            parent = self.parents.get(parent)
        return False


def _fill(template, placeholder, values):
    """template with each placeholder replaced by the next value; any left over follow it."""
    values = list(values)
    filled = re.sub(placeholder, lambda match: values.pop(0) if values else HOLE, template)
    return " ".join([filled] + values)


def package_of(sources):
    """{module name: Module} for {module name: source}."""
    package = {}
    for name, source in sources.items():
        package[name] = Module(name, source, package)
    return package


def _statement_reads(text):
    found = []
    aliases = {match.group(1) or "messages" for match in BOUND.finditer(text)}
    for alias in sorted(aliases):
        for pattern, what in ((r"\b%s\.body\b" % alias, alias + ".body"), (r"\b%s\.\*" % alias, alias + ".*")):
            if re.search(pattern, text):
                found.append(what)
    if re.search(r"\bSELECT\s+\*\s+FROM\s+messages\b", text, re.I):
        found.append("SELECT *")
    if re.search(r"\bSELECT\b(?:(?!\bFROM\b).)*?(?<![\w.])(?<!AS )body\b(?:(?!\bFROM\b).)*\bFROM\s+messages\b", text, re.I | re.S):
        found.append("body")
    return found


def _bindings(text):
    """{alias: {table, ...}} for each table the text reads."""
    bound = {}
    for match in ANY_BOUND.finditer(text):
        bound.setdefault(match.group(2) or match.group(1), set()).add(match.group(1).lower())
    return bound


def reads_of_the_column(source, sources=None, name="subject"):
    """(line, what) for each read of messages.body in source, its imports resolved among sources ({module: source})."""
    return reads_in(dict(sources or {}, **{name: source}))[name]


def reads_in(sources):
    """{module: [(line, what), ...]}: each read of messages.body in each module of sources ({module: source})."""
    package = package_of(sources)
    texts = {module: list(package[module].strings()) for module in package}
    everywhere = {module: {} for module in package}
    for module, found in texts.items():
        for _, text in found:
            for alias, tables in _bindings(text).items():
                everywhere[module].setdefault(alias, set()).update(tables)
    messages_anywhere = {alias for module in everywhere.values() for alias, tables in module.items() if "messages" in tables}
    return {module: _reads(texts[module], everywhere[module], messages_anywhere) for module in package}


def _reads(texts, module_binds, messages_anywhere):
    found = []
    for line, text in texts:
        reads = _statement_reads(text)
        own = _bindings(text)
        for alias in sorted(set(re.findall(r"\b(\w+)\.(?:body\b|\*)", text)) - set(own)):
            tables = module_binds.get(alias)
            if ("messages" in tables) if tables else (alias in messages_anywhere or alias == "messages"):
                reads += [what for what in (alias + ".body", alias + ".*") if re.search(r"\b%s\.%s" % (alias, re.escape(what.split(".")[1])), text)]
        found += [(line, what) for what in dict.fromkeys(reads)]
    return found


class WordsHelperCase(unittest.TestCase):
    def test_no_module_reads_messages_body_but_the_words_helper(self):
        sources = {path.stem: path.read_text(encoding="utf-8") for path in sorted(PACKAGE.glob("*.py"))}
        self.assertGreater(len(sources), 20)
        found = ["%s.py:%d %s" % (name, line, what) for name, reads in reads_in(sources).items() if name != HELPER
                 for line, what in reads]
        self.assertEqual(found, [], "read a message's words with words()/current_words() from aim_next/message_edit.py")

    def test_the_helper_reads_the_words_only_through_marked_words(self):
        # Slice 2 (item 452): marked_words is where a held message reads as "" for an agent and every other message's
        # words are marked as handed, so the helper's own reads of a body column go through it, each one.
        source = (PACKAGE / (HELPER + ".py")).read_text(encoding="utf-8")
        self.assertGreater(len(body_reads(source)), 3)
        self.assertEqual(unmarked_body_reads(source), [])
        planted = source + '\n\ndef planted(db):\n    return db.execute("SELECT r.body FROM message_revisions r").fetchall()\n'
        self.assertEqual(len(unmarked_body_reads(planted)), 1, "a read outside marked_words is found")

    def test_the_scan_finds_each_way_of_reading_the_column_and_passes_the_helper(self):
        cases = {
            'db.execute("SELECT m.body FROM messages m WHERE m.id=?")\n': ["m.body"],
            'db.execute("SELECT m.* FROM topics t "\n            "JOIN messages m ON m.topic_id=t.id")\n': ["m.*"],
            'db.execute("SELECT * FROM messages WHERE id=?")\n': ["SELECT *"],
            'db.execute("SELECT id,body FROM messages WHERE id=?")\n': ["body"],
            'db.execute("SELECT x FROM messages AS q WHERE q.body LIKE ?")\n': ["q.body"],
            'db.execute("SELECT m.id," + words("m") + " AS body FROM messages m WHERE m.id=?")\n': [],
            'db.execute("SELECT r.body FROM memory_revisions r")\n': [],
            'db.execute("SELECT d.* FROM deliveries d JOIN messages m ON m.id=d.message_id")\n': [],
            'db.execute("INSERT INTO messages(id,body) VALUES (?,?)")\n': [],
            'body = "words"\n': [],
        }
        for source, expected in cases.items():
            with self.subTest(source=source):
                self.assertEqual([what for _, what in reads_of_the_column(source)], expected)

    def test_the_scan_reads_sql_built_in_pieces_as_the_text_it_makes(self):
        # Each piece that reads the column is found, and so is the statement it is joined into.
        cases = {
            # A column list in one statement, joined to the table in another.
            'columns = "m.id,substr(m.body,1,10) AS excerpt"\ndb.execute("SELECT " + columns + " FROM messages m WHERE m.id=?")\n': ["m.body", "m.body"],
            'def read(db):\n    columns = ("m.id,"\n               "m.body")\n    return db.execute(f"SELECT {columns} FROM messages m").fetchall()\n': ["m.body", "m.body"],
            # A bare body, which reads the column only once joined to the table.
            'cols = "id,body"\ndb.execute("SELECT " + cols + " FROM messages WHERE id=?")\n': ["body"],
            'db.execute("SELECT %s FROM messages m" % "m.id,m.body")\n': ["m.body"],
            'db.execute("SELECT {} FROM messages m".format("m.body"))\n': ["m.body"],
            'db.execute("SELECT " + ",".join(["m.id", "m.body"]) + " FROM messages m")\n': ["m.body"],
            # A clause a function of the module returns.
            'def clause():\n    return "p.body LIKE ?"\ndb.execute("SELECT m.id FROM messages m JOIN messages p ON p.id=m.reply_to WHERE " + clause())\n': ["p.body", "p.body"],
            # Nothing reads the column: the helper's words, a column of another table, an alias bound to another table.
            'columns = "m.id," + words("m") + " AS body"\ndb.execute("SELECT " + columns + " FROM messages m")\n': [],
            'db.execute("SELECT r.body FROM memory_revisions r")\ncolumns = "r.body"\n': [],
            'columns = "d.body"\ndb.execute("SELECT " + columns + " FROM drafts d JOIN messages m ON m.id=d.message_id")\n': [],
        }
        for source, expected in cases.items():
            with self.subTest(source=source):
                self.assertEqual([what for _, what in reads_of_the_column(source)], expected)

    def test_the_scan_follows_names_and_modules_imported_from_the_package_and_not_the_helper(self):
        sources = {
            "asks": 'ASK_COLUMNS = "m.id,m.seq,m.body"\nCLEAN = "m.id,m.seq"\n',
            "whispers": 'VISIBLE = "(m.private_to IS NULL OR m.body IS NOT NULL)"\n',
            "clauses": 'def open_items():\n    return " AND m.body<>\'\'"\n',
            HELPER: 'def words(alias="m"):\n    return "coalesce((SELECT r.body FROM message_revisions r WHERE r.message_id=%s.id),%s.body)" % (alias, alias)\n'
                    'def current():\n    return "coalesce((SELECT r.body FROM message_revisions r WHERE r.message_id=m.id),m.body)"\n',
        }
        cases = {
            'from .asks import ASK_COLUMNS\ndb.execute("SELECT " + ASK_COLUMNS + " FROM messages m")\n': ["m.body"],
            'from .asks import ASK_COLUMNS as columns\ndb.execute("SELECT b.ref," + columns + " FROM message_blocks b JOIN messages m ON m.id=b.ref")\n': ["m.body"],
            'from . import whispers\ndb.execute("SELECT m.id FROM messages m WHERE " + whispers.VISIBLE)\n': ["m.body"],
            'from .clauses import open_items\ndb.execute("SELECT m.id FROM messages m WHERE 1" + open_items())\n': ["m.body"],
            'from .asks import CLEAN\ndb.execute("SELECT " + CLEAN + " FROM messages m")\n': [],
            'from .%s import words\ndb.execute("SELECT m.id," + words("m") + " AS body FROM messages m")\n' % HELPER: [],
            'from .%s import current\ndb.execute("SELECT m.id," + current() + " AS body FROM messages m")\n' % HELPER: [],
        }
        for source, expected in cases.items():
            with self.subTest(source=source):
                self.assertEqual([what for _, what in reads_of_the_column(source, sources)], expected)


def body_reads(source):
    """(line, text) of each SQL string constant in source that reads a body column by its alias."""
    return [(node.lineno, node.value) for node in ast.walk(ast.parse(source))
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and "SELECT" in node.value
            and re.search(r"\b\w+\.body\b", node.value)]


def unmarked_body_reads(source):
    """The body reads in source that are not arguments of marked_words on their own line."""
    lines = source.splitlines()
    return [(line, text) for line, text in body_reads(source)
            if not re.search(r"marked_words\([^\n]*\b\w+\.body\b", lines[line - 1])]


if __name__ == "__main__":
    unittest.main()
