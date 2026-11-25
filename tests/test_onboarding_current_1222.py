from __future__ import annotations

import io
import json
from pathlib import Path
import shlex
import sqlite3
import unittest
from unittest.mock import patch

from aim_next import cli
from aim_next.profile import write_profile
import test_pipeline_steering as fixtures


class CurrentOnboardingCase(fixtures.PipelineCase):
    def prompt(self, variant="codex"):
        answer = self.store.view("owner", "onboarding_prompt", {"workspace_id": "w1", "variant": variant})
        self.assertNotIn("error", answer, answer)
        return answer["prompt"]

    def active(self):
        self.committed(self.on(ships_in_releases=True))
        self.stages({"stage_id": "build", "name": "Build"})
        number = self.add("Actual active work", section="now", size="small")
        self.build_topic("build1222")
        piece = self.committed(self.command("pipeline.piece_start", {"numbers": [number], "topic_id": "build1222", "stage_id": "build"},
                                           {"workspace_id": "w1"}))["piece_id"]
        return number, piece

    def history(self, count=102, shipped=()):
        with sqlite3.connect(str(self.path)) as db:
            for n in range(1, count + 1):
                db.execute("INSERT INTO releases(number,commit_sha,deployed_at,deployed_ms,items,source,recorded_ms) "
                           "VALUES (?,?,'2026-01-01',0,?,'backfill',0)",
                           (n, "%040d" % n, json.dumps(list(shipped) if n == 1 else [])))

    def rules(self, summary="The current sourced rule"):
        for item in ("rules-source", "rules-render"):
            self.committed(self.memory(item=item, scope={"kind": "workspace", "id": "w1"}, body="Published source"))
        args = {"policy_id": "current-policy", "notebook_id": "rules-render", "rules": [
            {"id": "only-current", "summary": summary, "scope": {}, "effect": {},
             "source": {"kind": "memory", "id": "rules-source", "revision": 1}, "supersedes": []}],
            "owners": {"reader": "agent-a", "carrier": "agent-a", "freezer": "agent-a", "lander": "owner"}}
        return self.committed(self.command("current_rule.update", args, {"workspace_id": "w1"},
                                           {"rule_revision": 0, "item_revision": 1}))["record"]

    def test_active_now_survives_long_history_without_release_reconstruction(self):
        number, piece = self.active()
        self.history()
        with patch.object(self.store, "_shipped_numbers", side_effect=AssertionError("all-release reconstruction")), \
                patch.object(self.store, "_view_pipeline", side_effect=AssertionError("general pipeline view")):
            text = self.prompt()
        self.assertIn("%d: Actual active work" % number, text)
        pipeline = self.sql("SELECT version FROM pipelines WHERE workspace_id='w1'")[0][0]
        item = self.sql("SELECT version FROM pipeline_items WHERE workspace_id='w1' AND number=?", (number,))[0][0]
        piece_version = self.sql("SELECT version FROM pipeline_pieces WHERE id=?", (piece,))[0][0]
        self.assertIn("pipeline w1 revision %d" % pipeline, text)
        self.assertIn("item %d revision %d" % (number, item), text)
        self.assertIn("piece %s revision %d" % (piece, piece_version), text)
        self.assertIn("stage entry", text)

    def test_active_now_is_not_hidden_behind_a_full_legacy_sample(self):
        self.active()
        with sqlite3.connect(str(self.path)) as db:
            for n in range(2, 105):
                db.execute("INSERT INTO pipeline_items(workspace_id,number,title,description,section,position,version) "
                           "VALUES ('w1',?,'Unverified historical work','','now',?,1)", (n, -n))
        self.history()
        text = self.prompt()
        self.assertIn("1: Actual active work", text)
        self.assertIn("Now context is truncated", text)
        self.assertIn("unavailable for unverified", text)
        self.assertNotIn("No Now items", text)

    def test_exact_release_index_excludes_a_shipped_item_without_history_scan(self):
        self.active()
        number = self.add("INDEXED SHIPPED CANARY", section="now")
        self.history(shipped=(number,))
        with sqlite3.connect(str(self.path)) as db:
            self.store._clock_record_release(db, {"release": 1, "items": [number]})
        text = self.prompt()
        self.assertIn("1: Actual active work", text)
        self.assertNotIn("INDEXED SHIPPED CANARY", text)
        self.assertNotIn("unavailable for unverified", text)

    def test_unindexed_legacy_rows_are_unavailable_not_empty_or_claimed_current(self):
        self.committed(self.on(ships_in_releases=True))
        self.add("UNVERIFIED OLD TITLE", section="now")
        self.history()
        text = self.prompt()
        self.assertIn("Now context is unavailable", text)
        self.assertNotIn("No Now items", text)
        self.assertNotIn("UNVERIFIED OLD TITLE", text)

    def test_missing_disabled_and_empty_pipeline_have_distinct_words(self):
        self.assertIn("No pipeline is configured", self.prompt())
        self.committed(self.on(enabled=False))
        self.assertIn("Pipeline is disabled", self.prompt())
        self.committed(self.on())
        self.assertIn("No Now items", self.prompt())

    def test_rules_use_current_authorized_contract_with_exact_source_references(self):
        self.rules()
        with patch.object(self.store, "_view_memory_items", side_effect=AssertionError("arbitrary Notebook scan")), \
                patch.object(self.store, "_source", side_effect=AssertionError("source bodies are not prompt input")):
            text = self.prompt()
        for exact in ("current-policy revision 1", "Notebook rules-render revision 2", "only-current revision 1",
                      "The current sourced rule", '"id":"rules-source"', '"revision":1', '"kind":"memory"'):
            self.assertIn(exact, text)
        self.assertNotIn("this version has no outcome rules", text)

    def test_unconfigured_and_unavailable_rules_are_distinct(self):
        self.assertIn("No current rule is configured", self.prompt())
        with patch.object(self.store, "_view_current_rule", return_value={"availability": "unavailable", "record": None}):
            self.assertIn("Current rules are unavailable", self.prompt())

    def test_rules_are_screened_and_owner_denial_precedes_new_context_reads(self):
        self.rules("token=RULE1222CANARY")
        result = self.store.view("owner", "onboarding_prompt", {"workspace_id": "w1", "variant": "codex"})
        self.assertEqual(result.get("error", {}).get("code"), "ONBOARDING_UNSAFE_CONTEXT", result)
        self.assertNotIn("RULE1222CANARY", json.dumps(result))
        with patch.object(self.store, "_view_current_rule", side_effect=AssertionError("context before owner check")):
            denied = self.store.view("agent-a", "onboarding_prompt", {"workspace_id": "w1", "variant": "codex"})
        self.assertEqual(denied.get("error", {}).get("code"), "FORBIDDEN")

    def test_rule_truncation_is_disclosed_and_keeps_the_record_reference(self):
        record = self.rules()
        record["rules"] = [dict(record["rules"][0], id="rule-%d" % n, summary="Safe rule " + "x" * 2000) for n in range(12)]
        with patch.object(self.store, "_view_current_rule", return_value={"availability": "available", "record": record}):
            text = self.prompt()
        self.assertIn("Rules context is truncated", text)
        self.assertIn("current-policy revision 1", text)
        self.assertIn("Notebook rules-render revision 2", text)
        self.assertLess(len(json.dumps(text, ensure_ascii=False).encode()), 120000)
        record["rules"][-1]["summary"] = "token=OMITTED1222CANARY"
        with patch.object(self.store, "_view_current_rule", return_value={"availability": "available", "record": record}):
            result = self.store.view("owner", "onboarding_prompt", {"workspace_id": "w1", "variant": "codex"})
        self.assertEqual(result.get("error", {}).get("code"), "ONBOARDING_UNSAFE_CONTEXT", result)
        self.assertNotIn("OMITTED1222CANARY", json.dumps(result))

    def test_generated_human_ask_publishes_exact_quote_and_literal_cover_choices(self):
        for variant in ("codex", "claude"):
            text = self.prompt(variant)
            examples = [line.strip() for line in text.splitlines() if "--ask-wait" in line and "bin/aim-next" in line]
            self.assertEqual(len(examples), 1, text)
            source = self.source(self.opening, actor="agent-a")
            parent = source["source_ref"]["id"]
            cover = self.store.view("agent-a", "dossier_cover", {"message_id": parent})
            profile = Path(self.temp.name) / (variant + ".json")
            write_profile(profile, str(self.path), "test-instance", "agent-a", binding=self.binding)
            operation = "ask1222-" + variant
            values = {"<OWNER_SUPPLIED_SIGN_IN>": str(profile), "<MESSAGE>": parent, "<HUMAN>": "owner",
                      "<SOURCE_REVISION>": str(source["current_revision"]), "<START>": "0", "<END>": str(len(source["body"])),
                      "<DOSSIER_ROOT>": source["dossier"]["root_id"], "<COVER_REVISION>": str(cover["cover_revision"]),
                      "<RETAINED_OPERATION>": operation}
            example = examples[0]
            for key, value in values.items():
                example = example.replace(key, value)
            argv = shlex.split(example)[1:]
            out, err = io.StringIO(), io.StringIO()
            with patch("sys.stdin", io.StringIO("Which option?\n")):
                code = cli.main(["--outbox", str(Path(self.temp.name) / "outbox")] + argv, stdout=out, stderr=err)
            self.assertEqual(code, 0, (out.getvalue(), err.getvalue()))
            row = self.sql("SELECT id,quotes FROM messages WHERE reply_to=? AND intent='ask' ORDER BY seq DESC LIMIT 1", (parent,))[0]
            self.assertEqual(json.loads(row[1])[0]["excerpt"], source["body"])
            shown = self.store.view("owner", "dossier_cover", {"message_id": parent})["cover"]
            wait = next(w for w in shown["waiting"] if w["ask_id"] == row[0])
            self.assertEqual(wait["options"], ["A", "B"])
            self.assertIsNone(wait["default"])
            self.assertEqual(wait["reason"], "No default promised.")


if __name__ == "__main__":
    unittest.main()
