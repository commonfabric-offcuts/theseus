from __future__ import annotations

"""Private isolated fixture Build faults; no checkout edits or Core substitution."""
import hashlib
from pathlib import Path

MUTATIONS = {
    "no-hold": ("app.mjs", "function restoreListAnchor(saved) {", "function restoreListAnchor(saved) { return;"),
    "wrong-anchor": ("app.mjs", "const first = writing || field || acted ? null : firstInView();", "const first = writing || field || acted ? null : entries(list).at(-1);"),
    "pill-top": ("aim.css", ".new-above{position:fixed;top:12px;", ".new-above{position:fixed;top:0px;"),
    "pill-centre": ("aim.css", "left:anchor(--message-column center)!important;", "left:calc(anchor(--message-column center) + 40px)!important;"),
    "pill-surface": ("aim.css", "background:var(--accent);color:var(--on-accent);font-size:.875rem;", "background:transparent;color:var(--on-accent);font-size:.875rem;"),
    "pill-shadow": ("aim.css", "box-shadow:0 4px 16px rgb(0 0 0 / .18)", "box-shadow:none"),
    "fallback": ("aim.css", "left:anchor(--message-column center)!important;transform:translateX(-50%);", ""),
}


def hashes(build):
    return {name: hashlib.sha256(data).hexdigest() for name, data in build.files.items()}


class Reading785Runtime:
    def __init__(self, server, root, load):
        self.server, self.root, self.load = server, Path(root), load
        self.candidate, self.csp = server.build, server.csp
        self.history = []

    def select(self, phase):
        before = hashes(self.candidate)
        if phase == "restored":
            self.server.build, self.server.csp = self.candidate, self.csp
        else:
            name, old, new = MUTATIONS[phase]
            original = self.candidate.files[name]
            assert original.count(old.encode()) == 1, (phase, "unique source target")
            changed = original.replace(old.encode(), new.encode())
            assert changed != original and new.encode() in changed
            destination = self.root / ("reading785-" + phase)
            destination.mkdir(exist_ok=True)
            for filename, data in self.candidate.files.items():
                path = destination / filename
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(changed if filename == name else data)
            self.server.build = self.load(destination)
            assert self.server.build.stamp != self.candidate.stamp, "copied public mutant changes Build stamp"
            assert self.server.build.files[name] == changed
            script_src = " ".join(["'self'"] + ["'%s'" % digest for digest in self.server.build.script_hashes])
            first, rest = self.csp.split("script-src ", 1)
            self.server.csp = first + "script-src " + script_src + ";" + rest.split(";", 1)[1]
        receipt = {"phase": phase, "stamp": self.server.build.stamp, "hashes": hashes(self.server.build),
                   "candidate_hashes": before, "restored": self.server.build is self.candidate,
                   "csp_sha256": hashlib.sha256(self.server.csp.encode()).hexdigest()}
        if phase == "restored":
            assert receipt["hashes"] == before and self.server.csp == self.csp, "exact candidate Build and CSP restored"
        self.history.append(receipt)
        return receipt

    def close(self):
        unrestored = self.server.build is not self.candidate
        self.select("restored")
        assert not unrestored, "Item 785 runtime was not restored by its case"
