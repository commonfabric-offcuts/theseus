from __future__ import annotations

"""The page's files as one build: what the server serves, and the stamp that names it (docs/rails.md, "One build per document").

A server reads web/ once, as it starts, and serves those bytes until it stops,
so the stamp names exactly what it serves. A deploy stops the server, moves the
checkout on and starts it again, so a new release is a new build with a new
stamp.

Every module of a page is served under its build, /b/<stamp>/<name>: the page's
entry script is written that way into index.html, and each module's relative
imports resolve against it, so the whole module graph of a document carries
the build it was opened on, the dynamic import of a move in place included
(web/in-place-navigation.mjs). An absolute specifier, such as a check's
import('/api.mjs'), goes through the import map written beside the entry, to the
same build's address. An address under another build is refused, so no
document can assemble its modules from two builds.

The page's boot (web/boot.js) is written inline where index.html names it, before
its stylesheets and every module, so it holds up no parsing and needs no
request of its own: a page whose index.html came from one server and whose
modules are asked for of the next one (a deploy between the two), or of none
(the server restarting), loads afresh on the build served, or says so, rather
than stay blank.
"""

import base64
from dataclasses import dataclass, field
import hashlib
import json
from pathlib import Path
from typing import Dict, Optional, Tuple

# What the server serves from web/ (index.html, and these suffixes): the page and what it loads.
PUBLIC = frozenset((".js", ".mjs", ".css", ".svg", ".png", ".ico", ".woff", ".woff2"))
MODULES = frozenset((".js", ".mjs"))
# The entry script as index.html writes it, and the prefix every module of a build is served under.
ENTRY = b'<script type="module" src="/app.mjs"></script>'
PREFIX = "/b/"
# The page's boot, which index.html names as a script before its stylesheets, and which is written there inline: an
# inline script after a stylesheet would hold the page's parsing until that stylesheet came.
BOOT = "boot.js"
BOOT_TAG = b'<script src="/boot.js"></script>'


def public(name: str) -> bool:
    return name == "index.html" or Path(name).suffix in PUBLIC


@dataclass(frozen=True)
class Build:
    stamp: str
    files: Dict[str, bytes]
    # index.html with its entry under the build and the import map before it; None when web/ has none.
    index: Optional[bytes]
    # The hashes of the page's inline scripts (the boot, the import map) for its Content-Security-Policy; none without an entry.
    script_hashes: Tuple[str, ...] = field(default=())

    def asset(self, path: str, query: str = "") -> Optional[bytes]:
        """The bytes for a request's path and query, or None when this build has nothing at that address.

        /b/<stamp>/<name> is this build's file when the stamp is this build's.
        A path with no build is a file as it stands, for a document that is not
        a page (a check's own document, a person's console); a module asked for
        with a query is a run of a page already open (app.mjs?place=N), and
        names its build, so one with no build is refused: a page opened before
        builds were stamped loads afresh rather than run this build's code
        beside its own modules.
        """
        if path.startswith(PREFIX):
            stamp, _, name = path[len(PREFIX):].partition("/")
            if stamp != self.stamp or not name or name == "index.html":
                return None
            return self.files.get(name)
        name = path.lstrip("/") or "index.html"
        if name == "index.html":
            return self.index
        if query and Path(name).suffix in MODULES:
            return None
        return self.files.get(name)


def load(web_root) -> Build:
    """Reads every public file under web_root once and names the build they make."""
    root = Path(web_root).resolve()
    files = {}
    for path in sorted(root.rglob("*")):
        name = path.relative_to(root).as_posix()
        if not path.is_file() or not public(path.name):
            continue
        # A link that leads out of web/ is not the page's.
        try:
            path.resolve().relative_to(root)
        except ValueError:
            continue
        files[name] = path.read_bytes()
    digest = hashlib.sha256()
    for name in sorted(files):
        data = files[name]
        digest.update(name.encode("utf-8") + b"\0" + str(len(data)).encode("ascii") + b"\0" + data)
    stamp = digest.hexdigest()[:20]
    index, script_hashes = files.get("index.html"), ()
    if index is not None and ENTRY in index:
        if index.count(ENTRY) != 1:
            raise ValueError("index.html names its entry script more than once")
        boot = files.get(BOOT, b"").decode("utf-8")
        if not boot.strip():
            raise ValueError("index.html names its entry script and web/ has no %s to load the page afresh when its build is gone" % BOOT)
        links = index.find(b"<link")
        if index.count(BOOT_TAG) != 1 or 0 <= links < index.index(BOOT_TAG) or index.index(ENTRY) < index.index(BOOT_TAG):
            raise ValueError("index.html names its entry script, and must name %s once, before any stylesheet" % BOOT)
        if "</script" in boot.lower():
            raise ValueError("%s cannot be written inline: it holds </script" % BOOT)
        # An absolute address outside a build ("/api.mjs") is this build's ("/b/<stamp>/api.mjs"); one that
        # names a build already (a module's relative import, "/b/<stamp>/lines.mjs") stays as it is.
        text = json.dumps({"imports": {"/": PREFIX + stamp + "/", PREFIX: PREFIX}}, separators=(",", ":"), sort_keys=True)
        script_hashes = tuple("sha256-" + base64.b64encode(hashlib.sha256(script.encode("utf-8")).digest()).decode("ascii") for script in (boot, text))
        entry = ('<script type="importmap">%s</script><script type="module" src="%s%s/app.mjs"></script>'
                 % (text, PREFIX, stamp)).encode("utf-8")
        index = index.replace(ENTRY, entry).replace(BOOT_TAG, ("<script>%s</script>" % boot).encode("utf-8"))
    return Build(stamp=stamp, files=files, index=index, script_hashes=script_hashes)
