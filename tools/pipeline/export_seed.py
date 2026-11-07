#!/usr/bin/python3 -I
from __future__ import annotations

"""Build the seed that moves the hand-written Release pipeline page into Theseus (docs/pipeline.md, "The import").

Reads the page as `view source` returns it (JSON with its body and source_ref),
tools/pipeline/items.json for the sources of the items it lists, and a file of
gathered sources for later items (JSON {"N": {"from": [{"t": topic, "n": seq} |
{"note": text}]}}, or the mockup's pipeline-origins.js). Writes one JSON seed
for `bin/aim-next-admin pipeline-import`.

Every item keeps its number. ❓ and 🔨 are not carried: a question comes only
from an open ask, a stage only from a tool. An item with no known source is
refused (exit 2, naming them) unless --allow-unsourced, which gives it the note
"listed on the hand-written Release pipeline page" and says so in the report.
"""

import argparse
import json
from pathlib import Path
import re
import sys

ITEM = re.compile(r"^(🔨|⏭|💤|❓|✅)\s+(\d+)\.\s+(.*)$")
TAIL = re.compile(r"^(.*?)\s{2,}\((small|medium|large); (asked by ([^)]+)|found in review)\)\s*$")
SHIPPED_GROUP = re.compile(r"^Release (\d+),")
UNNUMBERED_GROUP = re.compile(r"^(\d{1,2} [A-Z][a-z]+ \d{4})$")
SIZES = {"S": "small", "M": "medium", "L": "large"}
WHO = {"you": "tony", "Fable": "fable"}

# Building Theseus's stages (3.2 of the outcome-page plan).
STAGES = [
    {"stage_id": "build", "name": "Build", "rounds": "split", "scope": "piece",
     "done_when": "done when the piece's change is written, with a check that failed before it, and pushed for review",
     "gate": {"checks": [], "owner": False, "words": ""}},
    {"stage_id": "review", "name": "Review", "rounds": "together", "scope": "piece",
     "done_when": "done when an independent review approves it or sends it back with findings",
     "gate": {"checks": [], "owner": False, "words": ""}},
    {"stage_id": "wait", "name": "Waits to combine", "rounds": "none", "scope": "piece",
     "done_when": "done when the next release is put together", "gate": {"checks": [], "owner": False, "words": ""}},
    {"stage_id": "combine", "name": "Combine", "rounds": "none", "scope": "release",
     "done_when": "done when the approved pieces are merged into one release commit", "gate": {"checks": [], "owner": False, "words": ""}},
    {"stage_id": "checks", "name": "Browser checks", "rounds": "together", "scope": "release",
     "done_when": "done when the release check passes at the release commit",
     "gate": {"checks": ["units", "browser-checks"], "owner": False, "words": ""}},
    {"stage_id": "deploy", "name": "Deploy", "rounds": "none", "scope": "release",
     "done_when": "done when the release is live and no check got worse", "gate": {"checks": ["deploy-refuses"], "owner": False, "words": ""}},
]


def _origins(path):
    text = Path(path).read_text(encoding="utf-8")
    if path.endswith(".js"):
        text = text[text.index("{"):text.rindex("}") + 1]
    return json.loads(text)


def _source(text):
    """'What's live #461' -> {"topic": "What's live", "seq": 461}; anything else is a note."""
    match = re.match(r"^(.*?)\s*#(\d+)$", text.strip())
    return {"topic": match.group(1), "seq": int(match.group(2))} if match else {"note": text.strip()}


def parse(body):
    """The page's items in order, with their sections, groups, words and progress, and the shipped groups."""
    items, notes, section, group, shipped_in, current = [], {}, None, "", None, None
    next_seen = False
    for line in body.splitlines():
        if not line.strip():
            continue
        if not line.startswith(" "):
            head = line.split(":")[0].strip()
            if head == "NOW" or line.startswith("NOW:"):
                section, group, current = "now", "", None
                continue
            if line.startswith("NEXT"):
                section, current = ("later" if next_seen else "next"), None
                next_seen = True
                continue
            if line.startswith("LATER"):
                section, current = "later", None
                continue
            if line.startswith("CANDIDATES"):
                section, group, current = "candidates", line.split(":", 1)[1].strip() if ":" in line else "", None
                continue
            if line.strip() == "SHIPPED":
                section, current = "shipped", None
                continue
            if section == "shipped":
                release = SHIPPED_GROUP.match(line)
                unnumbered = UNNUMBERED_GROUP.match(line.strip())
                if release:
                    shipped_in = {"release": int(release.group(1))}
                    continue
                if unnumbered:
                    shipped_in = {"note": "%s, before releases were numbered" % unnumbered.group(1), "label": unnumbered.group(1)}
                    continue
                if line.startswith("- ") and shipped_in is not None:
                    label = str(shipped_in.get("release") or shipped_in["label"])
                    notes.setdefault(label, []).append(line[2:].strip())
                    continue
            match = ITEM.match(line)
            if match and section is not None:
                glyph, number, rest = match.groups()
                item = {"number": int(number), "description": "", "progress": [], "ask_on_page": glyph == "❓",
                        "built_on_page": glyph == "🔨"}
                tail = TAIL.match(rest)
                if tail:
                    item["title"] = tail.group(1).strip()
                    item["size"] = tail.group(2)
                    item["raised_by"] = WHO.get(tail.group(4), tail.group(4)) if tail.group(4) else None
                    item["raised_note"] = "" if tail.group(4) else "found in review"
                else:
                    item["title"] = rest.strip().rstrip(".")
                if section == "shipped":
                    item["section"], item["candidate_group"] = "now", ""
                    if shipped_in and "release" in shipped_in:
                        item["shipped_in"] = shipped_in["release"]
                    elif shipped_in:
                        item["finished_note"] = shipped_in["note"]
                else:
                    item["section"], item["candidate_group"] = section, group if section == "candidates" else ""
                items.append(item)
                current = item
            continue
        if current is not None:
            words = line.strip()
            if words.startswith("Progress:"):
                current["progress"].append(words[len("Progress:"):].strip())
            else:
                current["description"] = (current["description"] + "\n" + words).strip()
    return items, notes


def main(argv=None):
    parser = argparse.ArgumentParser(description="Build the seed that moves the hand-written Release pipeline page into Theseus.")
    parser.add_argument("--page", required=True, help="the Release pipeline page as `view source` returns it (JSON)")
    parser.add_argument("--items", required=True, help="tools/pipeline/items.json")
    parser.add_argument("--origins", help="gathered sources for later items (JSON or pipeline-origins.js)")
    parser.add_argument("--workspace", default="building-theseus")
    parser.add_argument("--out", required=True)
    parser.add_argument("--allow-unsourced", action="store_true")
    options = parser.parse_args(argv)
    page = json.loads(Path(options.page).read_text(encoding="utf-8"))
    items, notes = parse(page["body"])
    listed = json.loads(Path(options.items).read_text(encoding="utf-8"))["items"]
    by_title = {}
    for number, entry in enumerate(listed, 1):
        by_title[number] = entry
    origins = _origins(options.origins) if options.origins else {}
    seen, unsourced = set(), []
    for item in items:
        if item["number"] in seen:
            print("item %d is listed twice" % item["number"], file=sys.stderr)
            return 2
        seen.add(item["number"])
        old = by_title.get(item["number"])
        sources = []
        if str(item["number"]) in origins:
            for entry in origins[str(item["number"])]["from"]:
                sources.append({"note": entry["note"]} if "note" in entry else {"topic": entry["t"], "seq": entry["n"]})
        elif old is not None and old.get("sources"):
            sources = [_source(text) for text in old["sources"]]
        if not sources:
            unsourced.append(item["number"])
            sources = [{"note": "listed on the hand-written Release pipeline page"}]
        item["sources"] = sources
        if (item.get("shipped_in") or item.get("finished_note")) and old is not None:
            # A shipped line says what shipped; the item keeps the title it was built under.
            item["title"] = old["title"]
        if "size" not in item:
            item["size"] = SIZES.get((old or {}).get("size"))
            asked = (old or {}).get("asked_by")
            item["raised_by"] = None if asked in (None, "found-in-review") else WHO.get(asked, asked)
            item["raised_note"] = "found in review" if asked == "found-in-review" else ""
            if not item.get("description") and old:
                item["description"] = old.get("what", "")
    numbers = sorted(seen)
    gaps = [n for n in range(1, numbers[-1] + 1) if n not in seen]
    if gaps:
        print("numbers missing from the page: %s" % ", ".join(map(str, gaps)), file=sys.stderr)
        return 2
    if unsourced and not options.allow_unsourced:
        print("no known source for: %s (add them, or pass --allow-unsourced)" % ", ".join(map(str, unsourced)), file=sys.stderr)
        return 2
    seed = {"workspace_id": options.workspace,
            "built_from": {"memory_item_id": page["source_ref"]["id"], "revision": page["source_ref"]["revision"]},
            "pipeline": {"title": "Release pipeline", "unit_one": "item", "unit_many": "items", "sized": True, "ships_in_releases": True},
            "stages": STAGES, "items": items, "release_notes": notes, "unsourced": unsourced}
    Path(options.out).write_text(json.dumps(seed, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    counts = {}
    for item in items:
        key = "shipped" if item.get("shipped_in") or item.get("finished_note") else item["section"]
        counts[key] = counts.get(key, 0) + 1
    print(json.dumps({"items": len(items), "by_section": counts, "unsourced": unsourced,
                      "asked_on_page": [item["number"] for item in items if item["ask_on_page"]]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
