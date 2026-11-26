from __future__ import annotations

"""Offline reconciliation of the retained, single 1298 baseline. Starts no producer."""

import argparse
from collections import Counter, defaultdict, deque
import hashlib
import json
from pathlib import Path
import subprocess
from urllib.parse import urljoin


def digest(path):
    data = path.read_bytes()
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args], text=True).strip()


def reconcile(root, repo):
    r = json.loads((root / "result.json").read_text())
    ledger = json.loads((root / "seed-ledger.json").read_text())
    obs = r["observations"]
    roots = [d["root"]["message_id"] for d in ledger["dossiers"]]
    labels = dict(zip(roots, ["D" + str(i) for i in range(10)]))
    queued, entered, after = [json.loads((root / ("native-one-" + phase + "-inputs.json")).read_text())
                               for phase in ["queued", "entry", "after"]]
    assert queued == entered == after
    assert all(digest(Path(path)) == value for path, value in entered.items())
    assert r["status"] == "complete" and len(r["arrivals"]) == 12
    assert not r["errors"] and not obs["errors"] and obs["dropped"] == 0
    assert not r.get("networkDropped", 0)
    assert not any(k.endswith("Failure") for k in r)
    assert git(repo, "rev-parse", "HEAD") == r["productHead"]
    assert not git(repo, "status", "--porcelain")
    assert digest(root / "seed/frozen.sqlite3")["sha256"] == ledger["frozen_db_sha256"]
    for file, value in r["moduleBytes"].items():
        assert digest(repo / "web" / file) == {k: value[k] for k in ["bytes", "sha256"]}

    spans = []
    events = obs["events"]
    for e in events:
        if not e["kind"].endswith(":entry"):
            continue
        end = next(x for x in events if x["call"] == e["call"] and x["kind"].endswith(":return"))
        spans.append({"phase": e["phase"], "owner": e["kind"].split(":")[0],
                      "call": e["call"], "entry_ms": e["at"], "return_ms": end["at"],
                      "duration_ms": end["at"] - e["at"], "kind": e.get("paintKind"),
                      "return_value": end.get("value"), "promise": end.get("promise")})

    # Join fetch facts to the ordered CDP request with exactly the same URL/body.
    net = defaultdict(dict)
    pending = defaultdict(deque)
    for e in r["network"]:
        net[e["requestId"]][e["kind"]] = e
        if e["kind"] == "requestWillBeSent":
            pending[(e["request"]["url"], e["request"].get("postData"))].append(e["requestId"])
    requests = []
    for i, q in enumerate(obs["requests"]):
        key = (urljoin(r["fixture"]["origin"], q["url"]), q.get("body"))
        rid = pending[key].popleft() if pending[key] else None
        n = net.get(rid, {})
        args = json.loads(q["body"]) if q.get("body") else None
        record = {"index": i, "phase": q["phase"], "request": args, "url": q["url"],
                  "call_ms": q["callAt"], "headers_ms": q.get("headersAt"),
                  "json_start_ms": q.get("jsonStart"), "json_end_ms": q.get("jsonEnd"),
                  "status": q.get("status"), "failure": q.get("failure"),
                  "decode_failure": q.get("decodeFailure"), "cdp_id": rid}
        for name, start, end in [("fetch_to_headers_ms", "callAt", "headersAt"),
                                  ("json_decode_ms", "jsonStart", "jsonEnd"),
                                  ("fetch_through_json_ms", "callAt", "jsonEnd")]:
            record[name] = q[end] - q[start] if start in q and end in q else None
        record["call_gap_from_previous_ms"] = q["callAt"] - obs["requests"][i - 1]["callAt"] if i else None
        record["signed_gap_from_previous_json_ms"] = (q["callAt"] - obs["requests"][i - 1]["jsonEnd"]
                                                       if i and "jsonEnd" in obs["requests"][i - 1] else None)
        record["cdp_monotonic_seconds"] = {kind: event.get("timestamp") for kind, event in n.items()}
        header = n.get("responseReceived", {}).get("timestamp")
        finished = n.get("loadingFinished", {}).get("timestamp")
        record["cdp_signed_finished_minus_response_event_ms"] = (finished - header) * 1000 if header and finished else None
        response = n.get("responseReceived", {}).get("response", {})
        timing = response.get("timing", {})
        record["cdp_resource_timing"] = timing
        record["server_timing_header"] = response.get("headers", {}).get("Server-Timing")
        received = timing.get("receiveHeadersEnd", -1)
        header_end = timing["requestTime"] + received / 1000 if received >= 0 else None
        record["cdp_header_end_to_transfer_end_ms"] = (finished - header_end) * 1000 if finished and header_end else None
        record["encoded_data_length"] = n.get("loadingFinished", {}).get("encodedDataLength")
        requests.append(record)

    # The precise-coverage take timestamps directly share the profile/trace monotonic clock.
    # These brackets include observer snapshots and other work, not only paintStack.
    profile = r["cpuProfile"]
    nodes = {n["id"]: n for n in profile["nodes"]}
    parents = {child: n["id"] for n in profile["nodes"] for child in n.get("children", [])}
    chains = {}
    for node in nodes:
        at, frames = node, []
        while at in nodes:
            frames.append(nodes[at]["callFrame"])
            at = parents.get(at)
        chains[node] = frames
    samples, negative, at = [], [], profile["startTime"]
    boundaries = [r["idleCoverage"]["timestamp"] * 1e6] + [row["coverage"]["timestamp"] * 1e6 for row in r["arrivals"]]
    for index, (node, dt) in enumerate(zip(profile["samples"], profile["timeDeltas"])):
        before = at
        at += dt
        samples.append((at, node, dt))
        if dt < 0:
            negative.append({"index": index, "node": node, "delta_us": dt, "before_us": before, "after_us": at,
                             "inside_arrival_brackets": boundaries[0] <= at < boundaries[-1],
                             "crosses_coverage_boundary": any(at < bound <= before for bound in boundaries),
                             "frames": chains[node]})
    # A backwards profile clock has no justified nonnegative duration conversion.
    # Keep exact signed arithmetic; never clamp, sort or silently repair its sign.
    owners = ["paintStack", "arrangeStacks", "repaintStackReading", "paintArrangement", "messagesPage"]
    qualified = {name: {"samples": 0, "signed_delta_sum_us": 0, "negative_samples": 0,
                        "negative_delta_sum_us": 0, "duration_ms": None} for name in owners}
    for time, node, dt in samples:
        if not boundaries[0] <= time < boundaries[-1]:
            continue
        for name in owners:
            if any(f["functionName"] == name for f in chains[node]):
                value = qualified[name]
                value["samples"] += 1
                value["signed_delta_sum_us"] += dt
                if dt < 0:
                    value["negative_samples"] += 1
                    value["negative_delta_sum_us"] += dt
    trace = json.loads((root / "trace.json").read_text())["traceEvents"]
    per_arrival, expected = [], list(ledger["initial_ids"])
    previous_take = r["idleCoverage"]["timestamp"] * 1e6
    for row in r["arrivals"]:
        ordinal, mid = row["ordinal"], row["receipt"]["message_id"]
        phase = "arrival-" + str(ordinal)
        expected.append(mid)
        s = row["snapshot"]
        assert sorted(s["ids"]) == sorted(expected) == sorted(s["window"]["loaded"])
        assert len(set(s["ids"])) == len(expected) == s["window"]["fullRecords"] == s["window"]["canonicalDOM"]
        assert [d["id"] for d in s["dossiers"]] == roots
        assert all(d["fold"] == "open" for d in s["dossiers"])
        assert s["y"] == r["initial"]["y"] and s["active"] == r["initial"]["active"]
        assert s["selection"] == r["initial"]["selection"] and s["visibility"] == "visible"
        assert s["dossiers"][4]["top"] == r["initial"]["dossiers"][4]["top"]
        assert row["endedMs"] - row["startedMs"] <= 3000
        assert row["admission"] and all(a["returned"]["value"] is True and mid in a["entry"]["ids"] for a in row["admission"])
        for j in range(9):
            # Membership is checked here; literal DOM equality is reported below.
            assert [m["id"] for m in s["dossiers"][j]["members"]] == [m["id"] for m in r["initial"]["dossiers"][j]["members"]]
        muts = [m for m in obs["mutations"] if m["phase"] == phase]
        counts = Counter(labels.get(m["dossier"], "outer") for m in muts)
        coverage = []
        for script in row["coverage"]["result"]:
            for f in script["functions"]:
                if f["functionName"] in owners + ["coverSheet", "coverKey"]:
                    coverage.append({"url": script["url"], "function": f["functionName"], "range": f["ranges"][0]})
        until = row["coverage"]["timestamp"] * 1e6
        cost = {name: {"samples": 0, "signed_delta_sum_us": 0, "duration_ms": None} for name in owners}
        self_frames = Counter()
        for time, node, dt in samples:
            if not previous_take <= time < until:
                continue
            frames = chains[node]
            self_frames[(frames[0]["functionName"], frames[0]["url"])] += dt
            for name in owners:
                if any(f["functionName"] == name for f in frames):
                    cost[name]["samples"] += 1
                    cost[name]["signed_delta_sum_us"] += dt
        layout = defaultdict(lambda: {"events": 0, "wall_ms": 0, "thread_ms": 0})
        for e in trace:
            if e.get("ph") == "X" and e.get("name") in ["Layout", "UpdateLayoutTree", "Paint", "PrePaint"] and previous_take <= e["ts"] < until:
                item = layout[e["name"]]
                item["events"] += 1
                item["wall_ms"] += e.get("dur", 0) / 1000
                item["thread_ms"] += e.get("tdur", 0) / 1000
        selected = [q for q in requests if q["phase"] == phase]
        per_arrival.append({"ordinal": ordinal, "receipt": row["receipt"], "wall_elapsed_ms": row["endedMs"] - row["startedMs"],
                            "snapshot_at_ms": s["at"], "coverage_bracket_monotonic_us": [previous_take, until],
                            "owner_spans": [x for x in spans if x["phase"] == phase],
                            "coverage_functions": coverage, "mutation_records": len(muts), "mutation_dossiers": dict(counts),
                            "mutation_types": dict(Counter(m["type"] for m in muts)),
                            "inclusive_sampled_cost": cost,
                            "sampled_self_top": [{"function": k[0], "url": k[1], "signed_delta_sum_us": v} for k, v in self_frames.most_common(12)],
                            "layout_bracket": dict(layout), "request_indexes": [q["index"] for q in selected],
                            "view_multiplicity": dict(Counter(q["request"].get("name", "command") if q["request"] else q["url"] for q in selected)),
                            "unchanged_D0_D8_html_equal_to_previous": [s["dossiers"][j]["html"] == (r["initial"] if ordinal == 0 else r["arrivals"][ordinal - 1]["snapshot"])["dossiers"][j]["html"] for j in range(9)]})
        previous_take = until

    result = {"kind": "1298-offline-baseline-reconciliation-v2", "product_head": r["productHead"],
              "profile_time_qualification": {"sample_count": len(samples), "negative_count": len(negative),
                  "negative_sum_us": sum(x["delta_us"] for x in negative), "minimum_delta_us": min(profile["timeDeltas"]),
                  "duration_interpretation_refused": bool(negative), "owners": qualified, "negative_records": negative},
              "raw": {file: digest(root / file) for file in ["result.json", "trace.json", "seed-ledger.json", "seed/frozen.sqlite3"]},
              "fixed_native_input_count": len(entered), "queued_entry_after_equal_and_current_hashes_match": True,
              "module_bytes": r["moduleBytes"], "observer_identity": r["observerIdentity"],
              "paintStack_sample_frames": [n for n in profile["nodes"] if n["callFrame"]["functionName"] == "paintStack"],
              "initial_ids": ledger["initial_ids"], "arrival_ids": [row["receipt"]["message_id"] for row in r["arrivals"]],
              "final_ids": r["final"]["ids"], "per_arrival": per_arrival, "requests": requests,
              "all_owner_spans": spans, "inputs": obs["inputs"], "observer_overhead_ms": obs["overheadMs"],
              "errors": r["errors"] + obs["errors"], "dropped": obs["dropped"],
              "cover_control": {"receipt": r["coverReceipt"], "cover_changed": r["coverSnapshot"]["dossiers"][4]["cover"] != r["final"]["dossiers"][4]["cover"],
                                "D4_top_before": r["final"]["dossiers"][4]["top"], "D4_top_after": r["coverSnapshot"]["dossiers"][4]["top"],
                                "mutations": dict(Counter(labels.get(m["dossier"], "outer") for m in obs["mutations"] if m["phase"] == "cover-control"))},
              "terminals": {file: json.loads((root / file).read_text()) for file in ["capture-terminal.json", "native-one-entered-terminal.json", "native-one-wrapper/terminal.json", "fixture-terminal.json"]},
              "limits": ["Nested spans and inclusive sampled weights overlap and must not be added.",
                         "The raw profile has negative deltas and a nonmonotonic clock. Signed sums are raw arithmetic, never calibrated CPU durations or isolated savings. Duration interpretation is refused; no clamp/sort/sign repair or cause is inferred.",
                         "Coverage brackets include snapshots and background work; observerOverhead excludes profiler/trace and all fetch wrapper overhead.",
                         "Fetch/JSON facts are browser wall intervals, not exclusive server CPU; signed inter-request gaps may be negative.",
                         "CDP response event delivery can follow transfer completion: signed event deltas are not transfer durations. ResourceTiming.receiveHeadersEnd is retained separately.",
                         "Stable scroll, BODY focus and collapsed empty selection do not prove focused-editor or nonempty-selection behavior.",
                         "Native wheel was setup only; no native send, More, typing, touch or selection gesture acceptance.",
                         "No candidate, current472 timing, general speedup or Tony-incident attribution.",
                         "Historical syntax wrapper terminal remains absent; later PID absence cannot reconstruct closure."]}
    assert result["cover_control"]["cover_changed"]
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", type=Path)
    parser.add_argument("product", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = reconcile(args.evidence, args.product)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"output": str(args.output), **digest(args.output)}))


if __name__ == "__main__":
    main()
