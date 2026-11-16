from __future__ import annotations

"""One build per document (item 523, docs/rails.md): the server serves the page's files as one build, read once,
named by a stamp; every module is served under that build, and an address under another build is refused."""

import base64
import hashlib
import http.client
import json
from pathlib import Path
import re
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aim_next import web_build  # noqa: E402
from aim_next.server import create_server  # noqa: E402

REPO_WEB = Path(__file__).resolve().parents[1] / "web"
INDEX = ('<meta name="aim-next-session" content="__AIM_SESSION_TOKEN__">\n'
         '<script type="module" src="/app.mjs"></script>\n')
BOOT = "addEventListener('error', () => {}, true);\n"
hash_of = lambda text: "sha256-" + base64.b64encode(hashlib.sha256(text.encode()).digest()).decode()


class WebBuildTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.web = Path(self.tmp.name) / "web"
        self.web.mkdir()
        (self.web / "index.html").write_text(INDEX)
        (self.web / "app.mjs").write_text("import { ready } from './lines.mjs';\n")
        (self.web / "lines.mjs").write_text("export const ready = true;\n")
        (self.web / "aim.css").write_text("body{}\n")
        (self.web / "boot.js").write_text(BOOT)
        (self.web / "notes.txt").write_text("not the page's\n")

    def test_the_stamp_names_exactly_the_bytes_served(self):
        first, again = web_build.load(self.web), web_build.load(self.web)
        self.assertEqual(first.stamp, again.stamp, "the same files are the same build")
        self.assertRegex(first.stamp, r"^[0-9a-f]{20}$")
        self.assertNotIn("notes.txt", first.files, "only the page's files are the build")
        (self.web / "lines.mjs").write_text("export const ready = false;\n")
        changed = web_build.load(self.web)
        self.assertNotEqual(changed.stamp, first.stamp, "one changed byte is another build")
        # What a server read as it started is what it serves until it stops: a file changed under it is not served.
        self.assertEqual(first.asset("/b/%s/lines.mjs" % first.stamp), b"export const ready = true;\n")
        (self.web / "extra.mjs").write_text("export {};\n")
        self.assertNotEqual(web_build.load(self.web).stamp, changed.stamp, "a file added is another build")
        self.assertIsNone(changed.asset("/b/%s/extra.mjs" % changed.stamp))

    def test_every_module_is_served_under_its_build_and_another_build_is_refused(self):
        build = web_build.load(self.web)
        mine = "/b/%s/" % build.stamp
        self.assertEqual(build.asset(mine + "app.mjs"), (self.web / "app.mjs").read_bytes())
        self.assertEqual(build.asset(mine + "app.mjs", "place=2"), (self.web / "app.mjs").read_bytes(), "a move in place's run, under its build")
        self.assertEqual(build.asset(mine + "aim.css"), b"body{}\n")
        for refused, query in (("/b/0123456789abcdef0123/app.mjs", ""), ("/b/0123456789abcdef0123/app.mjs", "place=2"),
                               (mine + "index.html", ""), (mine, ""), ("/b/", ""), (mine + "missing.mjs", ""),
                               (mine + "notes.txt", ""), ("/app.mjs", "place=2"), ("/lines.mjs", "v=1")):
            with self.subTest(path=refused, query=query):
                self.assertIsNone(build.asset(refused, query))
        # Outside a build: a file as it stands, for a document that is not a page (a check's own, a console).
        self.assertEqual(build.asset("/lines.mjs"), b"export const ready = true;\n")
        self.assertEqual(build.asset("/aim.css", "v=1"), b"body{}\n", "a query on what is not a module asks for no run")
        self.assertEqual(build.asset("/"), build.index)
        self.assertEqual(build.asset("/index.html"), build.index)

    def test_the_page_names_its_entry_under_its_build_after_its_boot_and_an_import_map_whose_hashes_the_policy_allows(self):
        build = web_build.load(self.web)
        index = build.index.decode()
        self.assertNotIn('src="/app.mjs"', index, "the entry is no longer outside a build")
        self.assertIn('<script type="module" src="/b/%s/app.mjs"></script>' % build.stamp, index)
        found = re.search(r'<script type="importmap">(.*?)</script>', index)
        self.assertIsNotNone(found)
        self.assertLess(index.index("importmap"), index.index('type="module"'), "the import map comes before any module")
        self.assertEqual(json.loads(found.group(1)), {"imports": {"/": "/b/%s/" % build.stamp, "/b/": "/b/"}})
        # The boot is written inline, word for word, before the import map and the entry: it needs no request of its own.
        self.assertIn("<script>%s</script>" % BOOT, index)
        self.assertLess(index.index("<script>" + BOOT), index.index("importmap"))
        self.assertEqual(build.script_hashes, (hash_of(BOOT), hash_of(found.group(1))))
        # A page with no entry script (a fixture's) has no inline scripts and needs no hash.
        (self.web / "index.html").write_text('<meta content="__AIM_SESSION_TOKEN__">')
        bare = web_build.load(self.web)
        self.assertEqual((bare.index, bare.script_hashes), (b'<meta content="__AIM_SESSION_TOKEN__">', ()))
        (self.web / "index.html").write_text(INDEX + INDEX)
        with self.assertRaises(ValueError):
            web_build.load(self.web)

    def test_a_page_with_an_entry_needs_its_boot_written_whole(self):
        (self.web / "boot.js").unlink()
        with self.assertRaisesRegex(ValueError, "boot.js"):
            web_build.load(self.web)
        (self.web / "boot.js").write_text("\n")
        with self.assertRaisesRegex(ValueError, "boot.js"):
            web_build.load(self.web)
        (self.web / "boot.js").write_text("document.write('</SCRIPT>');\n")
        with self.assertRaisesRegex(ValueError, "</script"):
            web_build.load(self.web)

    def test_the_real_page_is_served_under_its_build(self):
        # web/index.html names its entry exactly as the build rewrites it, once: were it written otherwise, its
        # modules would be served outside the build and a move in place refused on every page.
        self.assertEqual((REPO_WEB / "index.html").read_bytes().count(web_build.ENTRY), 1)
        build = web_build.load(REPO_WEB)
        self.assertIn(("/b/%s/app.mjs" % build.stamp).encode(), build.index)
        self.assertIn(b"<script>" + (REPO_WEB / "boot.js").read_bytes() + b"</script>", build.index, "the real boot, inline")
        self.assertEqual(len(build.script_hashes), 2)
        # Every module's own imports are relative, so each resolves under the build its importer came from.
        for name, data in build.files.items():
            if name.endswith(".mjs"):
                with self.subTest(module=name):
                    specifiers = re.findall(rb"""(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"`]([^'"`\s]+\.m?js[^'"`\s]*)['"`]""", data, re.M)
                    self.assertTrue(all(s.startswith(b"./") for s in specifiers), specifiers)
                    if name == "app.mjs":
                        self.assertIn(b"./message-edit-writing.mjs", specifiers, "the scan reads the imports it checks")


class ServedBuildTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.web = Path(self.tmp.name)
        (self.web / "index.html").write_text(INDEX)
        (self.web / "app.mjs").write_text("export const ready = true;\n")
        (self.web / "boot.js").write_text(BOOT)
        self.server = create_server(lambda: None, "new-test", "test-owner", self.web, token="test-session")
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": .01}, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)

    def get(self, path):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        try:
            connection.request("GET", path)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_the_server_says_its_build_serves_under_it_and_refuses_another(self):
        stamp = self.server.build.stamp
        status, headers, raw = self.get("/api/build")
        self.assertEqual((status, json.loads(raw)), (200, {"build": stamp}), "read without a session: the files are public")
        self.assertEqual(headers["Cache-Control"], "no-store")
        status, headers, raw = self.get("/")
        self.assertEqual(status, 200)
        self.assertIn(('src="/b/%s/app.mjs"' % stamp).encode(), raw)
        self.assertIn(b'content="test-session"', raw)
        self.assertIn("script-src 'self' '%s' '%s';" % self.server.build.script_hashes, headers["Content-Security-Policy"])
        self.assertIn(("<script>%s</script>" % BOOT).encode(), raw, "the boot the policy allows is the page's")
        status, headers, raw = self.get("/b/%s/app.mjs?place=2" % stamp)
        self.assertEqual((status, raw), (200, b"export const ready = true;\n"))
        self.assertIn("javascript", headers["Content-Type"])
        for path in ("/b/0123456789abcdef0123/app.mjs", "/b/0123456789abcdef0123/app.mjs?place=2", "/app.mjs?place=2"):
            with self.subTest(path=path):
                status, _, raw = self.get(path)
                self.assertEqual(status, 404)
                self.assertNotIn(b"ready", raw)
        self.assertEqual(self.get("/app.mjs")[0], 200, "outside a build, a file as it stands")


if __name__ == "__main__":
    unittest.main()
