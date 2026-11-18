from __future__ import annotations

"""Public source controls for item 674's isolated native fixture only."""
import base64
import hashlib
import gzip
import json
from pathlib import Path


def hashes(build):
    return {name: hashlib.sha256(data).hexdigest() for name, data in build.files.items()}


def runtime(server, candidate, csp, root, phase, loader):
    original = json.loads((Path(__file__).parent / "item_674_original_web.json").read_text())
    archive = (Path(__file__).parent / "item_674_original_web.json.gz").read_bytes()
    assert hashlib.sha256(archive).hexdigest() == original["archive_sha256"]
    overrides = json.loads(gzip.decompress(archive))
    files = dict(candidate.files)
    mutation = None
    if phase == "original":
        for name, data in overrides.items():
            if data is None:
                files.pop(name, None)
            else:
                files[name] = base64.b64decode(data)
    elif phase == "wrong-quote":
        name = "dossier-selection-quote.mjs"
        old = b"chosen.id, chosen.card, chosen.excerpt"
        new = b"chosen.id, chosen.card, { ...chosen.excerpt, text: 'Wrong words', revision: 999 }"
        assert files[name].count(old) == 1, "one exact item 674 quote call"
        before = files[name]
        files[name] = before.replace(old, new)
        assert files[name] != before and files[name].count(new) == 1
        mutation = {"file": name, "before": hashlib.sha256(before).hexdigest(),
                    "after": hashlib.sha256(files[name]).hexdigest(), "count": 1}
    elif phase == "tiny-target":
        name = "aim.css"
        old = b".dossier-quote-pill{position:fixed;z-index:21;min-width:44px;min-height:44px;"
        new = b".dossier-quote-pill{position:fixed;z-index:21;min-width:12px;min-height:12px;"
        assert files[name].count(old) == 1, "one exact item 674 touch target"
        before = files[name]
        files[name] = before.replace(old, new)
        assert files[name] != before and files[name].count(new) == 1
        mutation = {"file": name, "before": hashlib.sha256(before).hexdigest(),
                    "after": hashlib.sha256(files[name]).hexdigest(), "count": 1}
    elif phase != "restored":
        raise ValueError("Unknown item 674 phase: " + phase)
    if phase == "restored":
        server.build = candidate
    else:
        destination = root / ("item674-" + phase)
        destination.mkdir(exist_ok=True)
        for name, data in files.items():
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        server.build = loader(destination)
        assert hashes(server.build) == {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
    script_src = " ".join(["'self'"] + ["'%s'" % digest for digest in server.build.script_hashes])
    before, rest = csp.split("script-src ", 1)
    server.csp = before + "script-src " + script_src + ";" + rest.split(";", 1)[1]
    if phase == "restored":
        assert server.csp == csp
    return {"phase": phase, "stamp": server.build.stamp, "hashes": hashes(server.build),
            "candidate_hashes": hashes(candidate), "restored": server.build is candidate,
            "original_commit": original["commit"], "mutation": mutation}
