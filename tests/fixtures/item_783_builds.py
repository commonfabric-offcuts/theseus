from __future__ import annotations

"""Complete immutable public Builds for 783 comparisons; no product files change."""
import hashlib
import json
from pathlib import Path
import tarfile

MUTANTS = {
    "wrong-order": ("reply-stacks.mjs", b"...(p.cover ? [p.cover] : []), head,", b"head, ...(p.cover ? [p.cover] : []),"),
    "wrong-background": ("stack-look.css", b"background:var(--stack-folder);box-shadow:var(--stack-cover-inset)", b"background:var(--panel);box-shadow:var(--stack-cover-inset)"),
    "outer-shadow": ("stack-look.css", b"box-shadow:var(--stack-cover-inset)", b"box-shadow:0 8px 12px #0008"),
}

def hashes783(build):
    return {name: hashlib.sha256(data).hexdigest() for name, data in build.files.items()}

class Builds783:
    def __init__(self, server, root, loader):
        self.server, self.root, self.loader = server, root, loader
        self.candidate, self.csp = server.build, server.csp
        self.history = []

    def select(self, phase):
        if phase == "restored":
            build = self.candidate
        else:
            destination = self.root / ("item783-" + phase)
            destination.mkdir(exist_ok=True)
            if phase in ("original", "flat"):
                folder = Path(__file__).parent
                manifest = json.loads((folder / ("item_783_" + phase + ".json")).read_text())
                archive = folder / ("item_783_" + phase + ".tar.gz")
                assert hashlib.sha256(archive.read_bytes()).hexdigest() == manifest["archive_sha256"]
                with tarfile.open(str(archive), "r:gz") as packed:
                    for member in packed.getmembers():
                        assert member.name.startswith("web/") or member.name == "web"
                        assert ".." not in Path(member.name).parts and (member.isfile() or member.isdir())
                    packed.extractall(str(destination))
                build = self.loader(destination / "web")
                assert hashes783(build) == manifest["files"]
            else:
                name, old, new = MUTANTS[phase]
                for filename, data in self.candidate.files.items():
                    target = destination / filename
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(data)
                target = destination / name
                data = target.read_bytes()
                assert data.count(old) == 1, (phase, data.count(old))
                target.write_bytes(data.replace(old, new))
                assert target.read_bytes() != data
                build = self.loader(destination)
                assert hashes783(build)[name] != hashes783(self.candidate)[name]
        self.server.build = build
        before, rest = self.csp.split("script-src ", 1)
        self.server.csp = before + "script-src " + " ".join(["'self'"] + ["'%s'" % h for h in build.script_hashes]) + ";" + rest.split(";", 1)[1]
        if phase == "restored":
            assert self.server.csp == self.csp
            assert hashes783(build) == hashes783(self.candidate)
        receipt = {"phase": phase, "stamp": build.stamp, "hashes": hashes783(build), "candidate_hashes": hashes783(self.candidate),
                   "restored": build is self.candidate, "csp_sha256": hashlib.sha256(self.server.csp.encode()).hexdigest()}
        self.history.append(receipt)
        return receipt
