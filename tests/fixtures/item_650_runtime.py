from __future__ import annotations

"""650's historical public tree, loaded as one real Build, never a module overlay."""
import hashlib
from pathlib import Path
import subprocess

BASE = "1bc72642c726076e29362171131bc1babf7e2c50"
TREE = "0f739ffdff5d75b452e1eedd9c5ca08418d9ce76"


class Item650Runtime:
    def __init__(self, checkout, root, load):
        self.checkout, self.root, self.load = Path(checkout), Path(root), load
        self.baseline = None
        self.binding = None
        self.active = None

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=str(self.checkout))

    @staticmethod
    def hashes(build):
        return {name: hashlib.sha256(data).hexdigest() for name, data in build.files.items()}

    def load_baseline(self):
        assert self.git("rev-parse", BASE + "^{tree}").decode().strip() == TREE
        destination = self.root / "item650-baseline-web"
        destination.mkdir()
        files = {}
        # Enumerate only this exact committed web tree; no working-tree fallback.
        for row in self.git("ls-tree", "-rz", BASE, "--", "web/").split(b"\0"):
            if not row:
                continue
            metadata, name = row.split(b"\t", 1)
            mode, kind, blob = metadata.decode().split()
            name = name.decode()
            assert mode == "100644" and kind == "blob"
            relative = Path(name).relative_to("web")
            assert ".." not in relative.parts
            data = self.git("show", BASE + ":" + name)
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            assert target.read_bytes() == data
            files[str(relative)] = {"blob": blob, "sha256": hashlib.sha256(data).hexdigest()}
        build = self.load(destination)
        public_hashes = self.hashes(build)
        assert public_hashes == {name: files[name]["sha256"] for name in files if name in build.files}
        assert "app.mjs" in public_hashes and "reader.mjs" in public_hashes and "index.html" in public_hashes
        self.binding = {"commit": BASE, "tree": TREE,
                        "web_tree": self.git("rev-parse", BASE + ":web").decode().strip(),
                        "ordered_parents": self.git("show", "-s", "--format=%P", BASE).decode().strip().split(),
                        "files": files, "hashes": public_hashes, "stamp": build.stamp}
        self.baseline = build

    def select(self, server, phase):
        if phase == "baseline":
            assert self.active is None, "650 baseline already active"
            if self.baseline is None:
                self.load_baseline()
            candidate, csp = server.build, server.csp
            scripts = " ".join(["'self'"] + ["'%s'" % digest for digest in self.baseline.script_hashes])
            before, rest = csp.split("script-src ", 1)
            baseline_csp = before + "script-src " + scripts + ";" + rest.split(";", 1)[1]
            self.active = (server, candidate, csp)
            server.build, server.csp = self.baseline, baseline_csp
            return dict(self.binding, phase=phase, candidate_hashes=self.hashes(candidate), restored=False,
                        csp_sha256=hashlib.sha256(baseline_csp.encode()).hexdigest(),
                        candidate_csp_sha256=hashlib.sha256(csp.encode()).hexdigest(),
                        index_sha256=hashlib.sha256(self.baseline.index).hexdigest())
        assert phase == "restored", "Unknown 650 runtime phase"
        assert self.active is not None, "650 baseline is not active"
        owner, candidate, csp = self.active
        assert server is owner, "650 fixture changed during baseline"
        server.build, server.csp = candidate, csp
        self.active = None
        return {"phase": phase, "stamp": candidate.stamp, "hashes": self.hashes(candidate), "restored": True,
                "csp_sha256": hashlib.sha256(csp.encode()).hexdigest()}

    def close(self):
        if self.active is not None:
            self.select(self.active[0], "restored")
            raise AssertionError("650 baseline was not restored before fixture cleanup")
