from __future__ import annotations

"""Immutable public-source controls for item 721's allocated compose run."""
import hashlib
import json
from pathlib import Path
import tarfile


class Item721Runtime:
    def __init__(self, server, root, load):
        self.server, self.root, self.load = server, root, load
        self.candidate, self.csp = server.build, server.csp
        self.phase = "restored"

    @staticmethod
    def hashes(build):
        return {name: hashlib.sha256(data).hexdigest() for name, data in build.files.items()}

    def select(self, phase):
        folder = Path(__file__).parent
        destination = self.root / ("item721-" + phase)
        if phase == "restored":
            build = self.candidate
        elif phase in ("baseline", "held"):
            manifest = json.loads((folder / "item_721_sources.json").read_text())[phase]
            archive = folder / manifest["archive"]
            assert hashlib.sha256(archive.read_bytes()).hexdigest() == manifest["archive_sha256"]
            destination.mkdir(exist_ok=True)
            with tarfile.open(str(archive), "r:gz") as packed:
                for member in packed.getmembers():
                    assert member.name == "web" or (member.name.startswith("web/") and ".." not in Path(member.name).parts)
                    assert member.isdir() or member.isfile()
                packed.extractall(str(destination))
            build = self.load(destination / "web")
            assert self.hashes(build) == manifest["files"]
        else:
            rows = json.loads((folder / "item_721_mutants.json").read_text())
            [row] = [row for row in rows if row["key"] == phase]
            destination.mkdir(exist_ok=True)
            for name, data in self.candidate.files.items():
                target = destination / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
            for name, old, new in row["break"]:
                target = destination / name[4:]
                original = target.read_bytes()
                assert original.count(old.encode()) == 1, "Mutation must apply exactly once"
                target.write_bytes(original.replace(old.encode(), new.encode()))
                assert target.read_bytes() != original, "Actual served source must change"
            build = self.load(destination)
            assert self.hashes(build) != self.hashes(self.candidate)
        self.server.build, self.phase = build, phase
        scripts = " ".join(["'self'"] + ["'%s'" % digest for digest in build.script_hashes])
        before, rest = self.csp.split("script-src ", 1)
        self.server.csp = before + "script-src " + scripts + ";" + rest.split(";", 1)[1]
        if phase == "restored":
            assert self.server.csp == self.csp
        return {"phase": phase, "stamp": build.stamp, "hashes": self.hashes(build),
                "candidate_hashes": self.hashes(self.candidate), "restored": build is self.candidate}

    def close(self):
        unrestored = self.phase != "restored"
        self.select("restored")
        assert not unrestored, "Item 721 runtime was not restored before fixture cleanup"
