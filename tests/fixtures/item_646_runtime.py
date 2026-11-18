from __future__ import annotations

"""Private fixture source switches; never a product endpoint or live write."""

import hashlib
import io
import json
from pathlib import Path
import tarfile

from aim_next import web_build


class Item646Runtime:
    def __init__(self, server, root, instance, actor):
        self.server, self.root = server, root
        self.candidate, self.csp = server.build, server.csp
        self.identity = {"instance_id": instance, "actor": actor}
        checkout = Path(__file__).resolve().parents[2]
        self.wrapper_hashes = {name: hashlib.sha256((checkout / name).read_bytes()).hexdigest() for name in (
            "tests/item_646_native.mjs", "tests/fixtures/item_646_runtime.py", "tests/fixtures/ui_http.py",
            "tests/fixtures/item_646_original_web.json", "tests/fixtures/item_646_original_web.tar.gz",
            "tests/fixtures/item_646_approved_web.json", "tests/fixtures/item_646_approved_web.tar.gz")}

    def select(self, phase):
        def hashes(build):
            return {name: hashlib.sha256(data).hexdigest() for name, data in build.files.items()}

        mutation = None
        if phase == "restored":
            self.server.build = self.candidate
        else:
            destination = self.root / ("item646-" + phase)
            destination.mkdir(exist_ok=True)
            if phase in ("original", "approved"):
                folder = Path(__file__).parent
                manifest = json.loads((folder / ("item_646_" + phase + "_web.json")).read_text())
                packed = (folder / ("item_646_" + phase + "_web.tar.gz")).read_bytes()
                assert hashlib.sha256(packed).hexdigest() == manifest["archive_sha256"]
                with tarfile.open(fileobj=io.BytesIO(packed), mode="r:gz") as archive:
                    for member in archive.getmembers():
                        if member.isdir():
                            continue
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
                    "wrong-root": ("stack-feed.mjs", b"await this.star(item, { confirmed: true });", b"await this.star(current.replies.at(-1), { confirmed: true });"),
                    "loaded-reply": ("stack-feed.mjs", b"const root = dossierOf(stack), anchor = stack.head.id;", b"const root = stack.head.id, anchor = stack.head.id;"),
                    "reply-state": ("reply-stacks.mjs", b"const marked = first ? first.acts?.starred === true : (positionOf(stack)?.starred ?? []).includes(root);", b"const marked = [stack.head, ...stack.replies].some(item => item.acts?.starred) || (positionOf(stack)?.starred ?? []).length > 0;"),
                    "navigation": ("stack-feed.mjs", b"await this.star(item, { confirmed: true });", b"await this.star(item, { confirmed: true }); this.focusOn(item.id);"),
                    "focus": ("reply-stacks.mjs", b"star.onmousedown = event => event.preventDefault();", b"star.onmousedown = event => star.focus();"),
                    "optimistic": ("stack-feed.mjs", b"await this.star(item, { confirmed: true });", b"await this.star(item, { confirmed: false });"),
                    "doubt": ("stack-feed.mjs", b"if ([...this.doubts.values()].some(act => act.kind === 'message.star' && act.item.id === root))", b"if (false)"),
                    "pending": ("stack-feed.mjs", b"if (this.headerStars.has(root) || this.pending.get(root)?.some(mark => 'starred' in mark))", b"if (false)"),
                    "touch-cancel": ("reply-stacks.mjs", b"star.onmousedown = event => event.preventDefault();", b"star.onpointerdown = event => event.preventDefault();"),
                    "touch-gate": ("message-menu.mjs", b"a, .fold-line, .stack-star", b"a, .fold-line"),
                    "padding": ("stack-look.css", b"--stack-tab-pad:.45rem .85rem .4rem;", b"--stack-tab-pad:0 .85rem .4rem;"),
                    "background": ("stack-look.css", b"cursor:pointer;background:transparent;-webkit-tap-highlight-color:transparent", b"cursor:pointer;background:var(--stack-folder-deep);-webkit-tap-highlight-color:transparent"),
                    "target": ("stack-look.css", b".stack-star{flex:none;", b".stack-star{min-width:44px;min-height:44px;flex:none;"),
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
