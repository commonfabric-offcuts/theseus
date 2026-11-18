from __future__ import annotations

"""Private fixture source switches; never a product endpoint or live write."""

import hashlib
import io
import json
from pathlib import Path
import tarfile

from aim_next import web_build


class Item735Runtime:
    def __init__(self, server, root, instance, actor):
        self.server, self.root = server, root
        self.candidate, self.csp = server.build, server.csp
        self.identity = {"instance_id": instance, "actor": actor}
        checkout = Path(__file__).resolve().parents[2]
        self.wrapper_hashes = {name: hashlib.sha256((checkout / name).read_bytes()).hexdigest() for name in (
            "tests/item_735_native.mjs", "tests/fixtures/item_735_runtime.py", "tests/fixtures/ui_http.py",
            "tests/fixtures/item_735_base_web.json", "tests/fixtures/item_735_base_web.tar.gz")}

    def select(self, phase):
        def hashes(build):
            return {name: hashlib.sha256(data).hexdigest() for name, data in build.files.items()}

        mutation = None
        if phase == "restored":
            self.server.build = self.candidate
        else:
            destination = self.root / ("item735-" + phase)
            destination.mkdir(exist_ok=True)
            if phase == "base":
                folder = Path(__file__).parent
                manifest = json.loads((folder / "item_735_base_web.json").read_text())
                packed = (folder / "item_735_base_web.tar.gz").read_bytes()
                assert hashlib.sha256(packed).hexdigest() == manifest["archive_sha256"]
                with tarfile.open(fileobj=io.BytesIO(packed), mode="r:gz") as archive:
                    for member in archive.getmembers():
                        assert member.isfile() and member.name.startswith("web/") and ".." not in Path(member.name).parts
                        path = destination / member.name[4:]
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_bytes(archive.extractfile(member).read())
                self.server.build = web_build.load(destination)
                assert hashes(self.server.build) == manifest["files"]
            else:
                for name, data in self.candidate.files.items():
                    path = destination / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(data)
                filename, old, new = {
                    "no-reveal": ("app.mjs", b"showStarred: id => run(() => landReadingMessage({ id })),", b"showStarred: id => {},"),
                    "wrong-destination": ("stack-feed.mjs", b"this.showStarred(id);", b"this.showStarred(stack.replies.at(-1).id);"),
                    "touch-gate": ("message-menu.mjs", b"a, .fold-line, [data-stack-act=starred]", b"a, .fold-line"),
                    "no-scroll": ("app.mjs", b"    revealSelection(card);\n    card.focus({ preventScroll: true });", b"    // source mutant: selection scroll omitted\n    card.focus({ preventScroll: true });"),
                }[phase]
                path = destination / filename
                before = path.read_bytes()
                assert before.count(old) == 1, (phase, before.count(old))
                after = before.replace(old, new)
                path.write_bytes(after)
                assert path.read_bytes() == after and after != before
                mutation = {"file": filename, "before_sha256": hashlib.sha256(before).hexdigest(),
                            "after_sha256": hashlib.sha256(after).hexdigest(), "old": old.decode(), "new": new.decode()}
                self.server.build = web_build.load(destination)
                assert self.server.build.files[filename] == after
        script_src = " ".join(["'self'"] + ["'%s'" % digest for digest in self.server.build.script_hashes])
        before, rest = self.csp.split("script-src ", 1)
        self.server.csp = before + "script-src " + script_src + ";" + rest.split(";", 1)[1]
        restored = self.server.build is self.candidate
        if restored:
            assert self.server.csp == self.csp
        return {"phase": phase, "stamp": self.server.build.stamp, "hashes": hashes(self.server.build),
                "candidate_hashes": hashes(self.candidate), "restored": restored, "mutation": mutation,
                "core_identity": self.identity, "wrapper_hashes": self.wrapper_hashes}
