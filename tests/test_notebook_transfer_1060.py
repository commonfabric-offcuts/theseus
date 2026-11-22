from __future__ import annotations

"""1060's public Core effects, access refusals and fenced inverses in scratch DBs."""
import concurrent.futures
import json
import sqlite3
import subprocess
from pathlib import Path

from reader_fixture import ReaderCase
from aim_next.profile import write_profile
from aim_next.migrations import MigrationError, migrate
import test_media

TOPIC = {"kind": "topic", "id": "t1"}
OUTCOME = {"kind": "workspace", "id": "w1"}
OTHER = {"kind": "workspace", "id": "w2"}
WORDS = "Original Notebook words\n\nA second paragraph."


class TransferCase(ReaderCase):
    begin, publish, ready, read_all = test_media.MediaCase.begin, test_media.MediaCase.publish, test_media.MediaCase.ready, test_media.MediaCase.read_all
    def setUp(self):
        super().setUp()
        self.committed(self.command("workspace.create", {
            "id": "w2", "title": "Another isolated outcome", "team": ["agent-a", "other-reader"],
        }))

    def page(self, item="memory-one", actor="owner"):
        answer = self.store.view(actor, "memory_current", {"item_id": item})
        self.assertNotIn("error", answer, answer)
        return answer

    def transfer(self, kind="move", destination=OTHER, item="memory-one", revision=1,
                 actor="owner", copy_id="clone-one", op=None):
        args = {"owner_scope": destination}
        expected = {"item_revision": revision}
        if kind == "copy":
            args["copy_id"] = copy_id
            expected["copy_revision"] = 0
        return self.command("memory." + kind, args, {"item_id": item}, expected, actor=actor, op=op)

    def inverse(self, transfer, revision=2, copy_revision=None, actor="owner", op=None):
        expected = {"item_revision": revision}
        if copy_revision is not None:
            expected["copy_revision"] = copy_revision
        return self.command("memory.transfer.undo", {}, {"transfer_id": transfer}, expected, actor=actor, op=op)

    def effects(self):
        tables = ("memory_items", "memory_revisions", "memory_notebooks", "memory_reads", "memory_star_acts")
        return {name: self.sql("SELECT * FROM " + name + " ORDER BY rowid") for name in tables}

    def version(self, scope):
        rows = self.sql("SELECT version FROM memory_notebooks WHERE scope_kind=? AND scope_id=?",
                        (scope["kind"], scope["id"]))
        return rows[0][0] if rows else 0

    def another_topic(self):
        source = {"kind": "new_topic", "id": "opening-two", "workspace_id": "w2"}
        self.committed(self.save_draft("second-opening", source, "t2", "Another opening",
            opening={"workspace_id": "w2", "title": "Destination", "participants": ["agent-a"]}))
        self.committed(self.prepare("second-opening", "t2", submission="second", send_op="second-send"))
        self.committed(self.command("topic.create_and_send", {"submission_id": "second"},
                                    {"topic_id": "t2"}, op="second-send"))
        return {"kind": "topic", "id": "t2"}

    def test_move_preserves_identity_history_and_personal_reads_and_ticks_both_scopes(self):
        self.committed(self.memory(body=WORDS))
        before = self.sql("SELECT seq,id,creator_id FROM memory_items")
        old_public = self.public_state()
        self.committed(self.command("memory.read", {"revision": 1}, {"item_id": "memory-one"}, actor="agent-b"))
        versions = [self.version(TOPIC), self.version(OTHER)]
        result = self.committed(self.transfer(op="move-one"))
        self.assertEqual((result["item_id"], result["revision"], result["owner_scope"], result["transfer_id"]),
                         ("memory-one", 2, OTHER, "move-one"))
        self.assertEqual(self.sql("SELECT seq,id,creator_id FROM memory_items"), before)
        self.assertEqual((self.page()["body"], self.source(self.memory_ref())["body"]), (WORDS, WORDS))
        self.assertEqual(self.source(self.memory_ref())["author"], "agent-a")
        self.assertEqual(self.page()["author"], "owner")
        self.assertEqual(self.sql("SELECT revision FROM memory_reads WHERE actor_id='agent-b'"), [(1,)])
        self.assertEqual([self.version(TOPIC), self.version(OTHER)], [v + 1 for v in versions])
        self.assertEqual(self.public_state(), old_public, "a transfer sends/enrolls nobody")
        self.assertEqual(self.store.view("agent-b", "memory_current", {"item_id": "memory-one"})["error"]["code"], "FORBIDDEN")

    def test_stars_follow_current_scope_and_never_reveal_moved_private_page_to_former_reader(self):
        destination = self.another_topic()
        self.committed(self.memory(body=WORDS))
        for actor in ["agent-a", "agent-b"]:
            self.committed(self.command("memory.star", {"starred": True}, {"item_id": "memory-one"},
                                        {"star_revision": 0}, actor=actor))
        acts = self.sql("SELECT * FROM memory_star_acts ORDER BY id")
        self.committed(self.transfer(destination=destination, op="star-move"))
        self.committed(self.memory(revision=2, actor="owner", title="New private destination title"))
        self.assertEqual(self.sql("SELECT * FROM memory_star_acts ORDER BY id"), acts)
        for actor in ["agent-a", "agent-b"]:
            old = self.store.view(actor, "memory_stars", {"topic_id": "t1"})
            self.assertEqual(old["items"], [])
            listed = self.store.view(actor, "memory_items", {"owner_scope": TOPIC})
            self.assertEqual(listed["items"], [])
            self.assertNotIn("New private", json.dumps(old) + json.dumps(listed))
        new = self.store.view("agent-a", "memory_stars", {"topic_id": "t2"})
        self.assertEqual([(r["item_id"], r["owner_scope"]) for r in new["items"]], [("memory-one", destination)])
        denied = self.store.view("agent-b", "memory_stars", {"topic_id": "t2"})
        self.assertEqual(denied["error"]["code"], "FORBIDDEN")

    def test_copy_reciprocal_links_and_inverse_are_atomic_exact_attributed_revisions(self):
        self.committed(self.memory(title="Plan", body=WORDS))
        result = self.committed(self.transfer("copy", op="copy-one"))
        self.assertEqual((result["revision"], result["copy"]["item_id"], result["copy"]["revision"]), (2, "clone-one", 1))
        original, clone = self.page(), self.page("clone-one")
        self.assertEqual(original["body"], "[Copy](?workspace=w2&page=clone-one)\n\n" + WORDS)
        self.assertEqual(clone["body"], "[Original](?topic=t1&page=memory-one)\n\n" + WORDS)
        self.assertEqual((clone["title"], clone["creator"], clone["author"]), ("Plan copy", "owner", "owner"))
        self.assertEqual(self.source(self.memory_ref())["body"], WORDS)
        self.committed(self.inverse("copy-one", copy_revision=1, op="undo-copy"))
        self.assertEqual(self.page()["body"], WORDS)
        self.assertEqual(self.page()["version"], 3)
        status = self.store.view("owner", "memory_status", {"item_id": "clone-one"})
        self.assertTrue(status["deleted"])
        latest = self.sql("SELECT body,deleted FROM memory_revisions WHERE item_id='clone-one' ORDER BY revision DESC LIMIT 1")
        self.assertEqual(latest, [(WORDS, 1)])
        self.assertEqual(self.sql("SELECT count(*) FROM memory_revisions WHERE item_id='clone-one'"), [(2,)])

    def test_same_notebook_copy_ticks_one_counter_once_for_two_page_revisions(self):
        self.committed(self.memory(body=WORDS))
        before = self.version(TOPIC)
        self.committed(self.transfer("copy", TOPIC))
        self.assertEqual(self.version(TOPIC), before + 1)
        self.assertEqual(self.sql("SELECT count(*) FROM memory_items"), [(2,)])
        self.assertEqual(self.page()["version"], 2)

    def test_move_inverse_returns_same_id_to_original_scope_without_rewriting_history(self):
        self.committed(self.memory(body=WORDS))
        self.committed(self.transfer(op="outward"))
        self.committed(self.inverse("outward", op="return"))
        self.assertEqual((self.page()["owner_scope"], self.page()["body"], self.page()["version"]), (TOPIC, WORDS, 3))
        self.assertEqual(self.sql("SELECT body FROM memory_revisions ORDER BY revision"), [(WORDS,)] * 3)
        before = self.effects()
        self.rejected(self.inverse("outward", op="second-return"), "REVISION_CONFLICT")
        self.assertEqual(self.effects(), before)

    def test_same_scope_move_and_stale_source_refuse_without_partial_effects(self):
        self.committed(self.memory(body=WORDS))
        before = self.effects()
        self.rejected(self.transfer(destination=TOPIC), "INVALID_ARGUMENT")
        self.rejected(self.transfer(revision=0), "REVISION_CONFLICT")
        self.assertEqual(self.effects(), before)

    def test_source_write_refusal_and_destination_post_refusal_keep_exact_original(self):
        self.committed(self.memory(body=WORDS))
        before = self.effects()
        self.rejected(self.transfer(actor="agent-b"), "FORBIDDEN")
        self.assertEqual(self.effects(), before)
        self.committed(self.memory(item="outcome-page", actor="agent-b", scope=OUTCOME, body=WORDS))
        before = self.effects()
        self.rejected(self.transfer(destination=TOPIC, item="outcome-page", actor="agent-b"), "FORBIDDEN")
        self.assertEqual(self.effects(), before)

    def test_destination_outcome_team_counts_as_readers_even_without_topic_participation(self):
        destination = self.another_topic()
        self.committed(self.memory(body="Quoted original", references=[self.opening]))
        before = self.effects()
        self.rejected(self.transfer(destination=destination), "NOTEBOOK_AUDIENCE_CONFLICT")
        self.assertEqual(self.effects(), before)

    def test_move_checks_exposed_history_not_only_current_references(self):
        self.committed(self.memory(body="Historically quoted", references=[self.opening]))
        self.committed(self.memory(revision=1, body="Now plain", references=[]))
        before = self.effects()
        self.rejected(self.transfer(revision=2), "NOTEBOOK_AUDIENCE_CONFLICT")
        self.assertEqual(self.effects(), before)
        # A new copy exposes only the current revision, not hidden older history.
        self.committed(self.transfer("copy", revision=2))
        self.assertTrue(self.page("clone-one")["body"].endswith("Now plain"))

    def test_pipeline_source_stays_in_its_outcome_but_copy_does_not_move_that_identity(self):
        self.committed(self.memory(body=WORDS))
        self.committed(self.command("pipeline.configure", {"enabled": True}, {"workspace_id": "w1"}, {"pipeline_revision": 0}))
        self.committed(self.command("pipeline.item_add", {"title": "Uses the page", "sources": [{"memory_item_id": "memory-one"}]}, {"workspace_id": "w1"}))
        before = self.effects()
        self.rejected(self.transfer(), "NOTEBOOK_SOURCE_OUTCOME_CONFLICT")
        self.assertEqual(self.effects(), before)
        self.committed(self.transfer("copy"))
        self.assertEqual(self.page()["owner_scope"], TOPIC)
        self.assertEqual(self.sql("SELECT memory_item_id FROM pipeline_item_sources WHERE memory_item_id IS NOT NULL"), [("memory-one",)])

    def test_undo_copy_refuses_newer_original_or_clone_without_erasing_other_words(self):
        for changed in ["source", "clone"]:
            with self.subTest(changed=changed):
                item, clone = "page-" + changed, "copy-" + changed
                self.committed(self.memory(item=item, body=WORDS))
                self.committed(self.transfer("copy", item=item, copy_id=clone, op="copy-" + changed))
                self.committed(self.memory(item=item if changed == "source" else clone, revision=2 if changed == "source" else 1,
                                           actor="owner", body="Unrelated newer writing"))
                before = self.effects()
                self.rejected(self.inverse("copy-" + changed, copy_revision=1), "REVISION_CONFLICT")
                self.assertEqual(self.effects(), before)

    def test_undo_move_cannot_borrow_later_revision_or_another_actor(self):
        self.committed(self.memory(body=WORDS))
        self.committed(self.transfer(op="move"))
        self.committed(self.memory(revision=2, actor="owner", body="Later words"))
        before = self.effects()
        self.rejected(self.inverse("move", revision=3), "REVISION_CONFLICT")
        self.rejected(self.inverse("move", actor="agent-a"), "FORBIDDEN")
        self.assertEqual(self.effects(), before)

    def test_copy_retries_use_one_kept_id_and_changed_retry_never_creates_another(self):
        self.committed(self.memory(body=WORDS))
        envelope = self.envelope("memory.copy", {"item_id": "memory-one"},
            {"owner_scope": OTHER, "copy_id": "clone-one"}, {"item_revision": 1, "copy_revision": 0}, op="once")
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            answers = list(pool.map(lambda _: self.store.command("owner", envelope), range(2)))
        self.committed(answers[0])
        self.assertEqual(answers[0], answers[1])
        before = self.effects()
        self.assertEqual(self.store.command("owner", envelope), answers[0])
        changed = dict(envelope, args=dict(envelope["args"], copy_id="other-copy"))
        self.rejected(self.store.command("owner", changed), "OPERATION_PAYLOAD_MISMATCH")
        self.assertEqual(self.effects(), before)
        self.assertEqual(self.sql("SELECT count(*) FROM memory_items"), [(2,)])

    def test_copy_collision_and_oversized_link_prefix_are_all_or_nothing(self):
        self.committed(self.memory(body=WORDS))
        self.committed(self.memory(item="clone-one", body="Existing copy id"))
        before = self.effects()
        self.rejected(self.transfer("copy"), "REVISION_CONFLICT")
        self.assertEqual(self.effects(), before)
        self.committed(self.memory(item="full", body="x" * 1048576))
        before = self.effects()
        self.rejected(self.transfer("copy", item="full", copy_id="full-copy"), "BODY_TOO_LARGE")
        self.assertEqual(self.effects(), before)

    def test_draft_stays_withheld_from_agents_and_agent_cannot_transfer_it(self):
        self.committed(self.memory(actor="owner", body="Private draft", draft=True))
        before = self.effects()
        self.rejected(self.transfer("copy", actor="agent-a"), "FORBIDDEN")
        self.assertEqual(self.effects(), before)
        self.committed(self.transfer("copy", actor="owner"))
        for item in ["memory-one", "clone-one"]:
            page = self.page(item, actor="agent-a")
            self.assertTrue(page["withheld"])
            self.assertEqual((page["body"], page["attachments"], page["references"]), ("", [], []))

    def test_direct_scope_identity_mutation_without_transfer_witness_stays_impossible(self):
        self.committed(self.memory(body=WORDS))
        with sqlite3.connect(str(self.path)) as db:
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute("UPDATE memory_items SET scope_kind='workspace',scope_id='w2',current_revision=2 WHERE id='memory-one'")
        self.assertEqual(self.page()["owner_scope"], TOPIC)

    def test_upgrade_preserves_legacy_page_and_occupied_downgrade_refuses_transfer_history(self):
        self.committed(self.memory(body=WORDS))
        identity = self.sql("SELECT seq,id,creator_id,current_revision FROM memory_items")
        migrate(self.path, "test-instance", self.binding, "65")
        with sqlite3.connect(str(self.path)) as db:
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute("UPDATE memory_items SET scope_id='elsewhere' WHERE id='memory-one'")
        migrate(self.path, "test-instance", self.binding)
        self.assertEqual(self.sql("SELECT seq,id,creator_id,current_revision FROM memory_items"), identity)
        self.assertEqual(self.page()["body"], WORDS)
        self.committed(self.transfer(op="after-upgrade"))
        before = self.effects()
        with self.assertRaises(MigrationError):
            migrate(self.path, "test-instance", self.binding, "65")
        self.assertEqual(self.effects(), before)

    def test_second_copy_revision_storage_failure_rolls_back_both_pages_and_witness(self):
        self.committed(self.memory(body=WORDS))
        before = self.effects()
        with sqlite3.connect(str(self.path)) as db:
            db.execute("CREATE TRIGGER injected_second_revision BEFORE INSERT ON memory_revisions WHEN NEW.item_id='clone-one' "
                       "AND EXISTS(SELECT 1 FROM memory_revisions WHERE item_id='memory-one' AND revision=2 AND operation_id='failed-copy') "
                       "BEGIN SELECT RAISE(ABORT,'injected copy storage failure'); END")
        self.rejected(self.transfer("copy", op="failed-copy"), "INTERNAL_ERROR")
        self.assertEqual(self.effects(), before)
        self.assertEqual(self.sql("SELECT * FROM memory_transfer_acts"), [])
        with sqlite3.connect(str(self.path)) as db:
            db.execute("DROP TRIGGER injected_second_revision")
        self.committed(self.transfer("copy", op="failed-copy"))
        self.assertEqual(self.sql("SELECT count(*) FROM memory_revisions WHERE operation_id='failed-copy'"), [(2,)])

    def test_source_or_destination_closed_and_lost_permission_never_bypass_current_core_rules(self):
        self.committed(self.memory(body=WORDS))
        self.committed(self.command("outcome.end_set", {"state": "archived"}, {"workspace_id": "w2"}))
        before = self.effects()
        self.rejected(self.transfer(), "OUTCOME_ARCHIVED")
        self.assertEqual(self.effects(), before)
        self.committed(self.command("outcome.end_set", {"state": "open"}, {"workspace_id": "w2"}))
        self.committed(self.transfer(actor="agent-a", op="agent-move"))
        self.committed(self.command("workspace.member_set", {"actor_id": "agent-a", "present": False},
                                    {"workspace_id": "w2"}, {"workspace_revision": self.sql("SELECT version FROM workspaces WHERE id='w2'")[0][0]}))
        before = self.effects()
        self.rejected(self.inverse("agent-move", actor="agent-a"), "FORBIDDEN")
        self.assertEqual(self.effects(), before)
        self.committed(self.command("outcome.end_set", {"state": "completed"}, {"workspace_id": "w2"}))
        self.rejected(self.transfer(destination=TOPIC, revision=2), "OUTCOME_COMPLETED")
        self.assertEqual(self.effects(), before)

    def test_missing_copy_fence_wrong_authority_and_instance_leave_no_effect(self):
        self.committed(self.memory(body=WORDS))
        envelope = self.envelope("memory.copy", {"item_id": "memory-one"}, {"owner_scope": OTHER, "copy_id": "clone-one"}, {"item_revision": 1})
        before = self.effects()
        self.rejected(self.store.command("owner", envelope), "INVALID_ARGUMENT")
        envelope["expected"]["copy_revision"] = 0
        self.rejected(self.store.command("owner", dict(envelope, instance_id="another-instance")), "INSTANCE_MISMATCH")
        envelope["expected"]["authority"] = dict(self.pin, authority_epoch=self.pin["authority_epoch"] + "-other")
        self.rejected(self.store.command("owner", envelope), "AUTHORITY_CHANGED")
        self.assertEqual(self.effects(), before)

    def test_empty_downgrade_restores_exact_revision_layout_and_all_legacy_values(self):
        self.committed(self.memory(body=WORDS))
        before = self.effects()
        migrate(self.path, "test-instance", self.binding, "65")
        def unique_columns():
            return sorted(tuple(row[2] for row in self.sql('PRAGMA index_info(' + index[1] + ')'))
                          for index in self.sql('PRAGMA index_list(memory_revisions)') if index[2])
        self.assertEqual(unique_columns(), [('author_id', 'operation_id'), ('item_id', 'revision')])
        sql = self.sql("SELECT sql FROM sqlite_master WHERE name='memory_revisions'")[0][0]
        self.assertTrue(sql.startswith("CREATE TABLE memory_revisions ("), sql)
        self.assertIn("UNIQUE(author_id,operation_id))", sql)
        self.assertEqual(self.effects(), before)
        migrate(self.path, "test-instance", self.binding)
        self.assertEqual(unique_columns(), [('author_id', 'operation_id', 'item_id'), ('item_id', 'revision')])
        self.assertEqual(self.effects(), before)
        self.assertEqual(self.sql("PRAGMA foreign_key_check"), [])
        self.assertEqual(self.sql("PRAGMA integrity_check"), [("ok",)])

    def test_reinstall_keeps_existing_paired_revisions_witnesses_and_lossy_down_refusal(self):
        self.committed(self.memory(body=WORDS))
        self.committed(self.transfer("copy", op="before-reinstall"))
        before = self.effects()
        witnesses = self.sql("SELECT * FROM memory_transfer_acts ORDER BY rowid")
        schema = self.sql("SELECT name,sql FROM sqlite_master WHERE name LIKE '%memory%' ORDER BY name")
        for _ in range(2):
            # Model the same retained later layout that the existing seat
            # migration fixtures leave beside their lower schema marker.
            with sqlite3.connect(str(self.path)) as db:
                db.execute("UPDATE metadata SET value='65' WHERE key='schema_version'")
            migrate(self.path, "test-instance", self.binding)
            self.assertEqual(self.effects(), before)
            self.assertEqual(self.sql("SELECT * FROM memory_transfer_acts ORDER BY rowid"), witnesses)
            self.assertEqual(self.sql("SELECT name,sql FROM sqlite_master WHERE name LIKE '%memory%' ORDER BY name"), schema)
            self.assertEqual(self.sql("PRAGMA foreign_key_check"), [])
            self.assertEqual(self.sql("PRAGMA integrity_check"), [("ok",)])
        with self.assertRaises(MigrationError) as refused:
            migrate(self.path, "test-instance", self.binding, "65")
        self.assertEqual(refused.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.effects(), before)
        with sqlite3.connect(str(self.path)) as db:
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute("UPDATE memory_transfer_acts SET id='changed'")
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute("UPDATE memory_revisions SET body='changed'")
        self.committed(self.inverse("before-reinstall", copy_revision=1, op="after-reinstall"))
        self.assertEqual(self.page()["body"], WORDS)

    def test_inverse_second_revision_storage_failure_keeps_both_links_and_exact_retry(self):
        self.committed(self.memory(body=WORDS))
        self.committed(self.transfer('copy', op='paired-forward'))
        before = self.effects()
        witnesses = self.sql('SELECT * FROM memory_transfer_acts')
        with sqlite3.connect(str(self.path)) as db:
            db.execute("CREATE TRIGGER injected_inverse_second BEFORE INSERT ON memory_revisions WHEN NEW.item_id='clone-one' AND NEW.revision=2 "
                       "AND EXISTS(SELECT 1 FROM memory_revisions WHERE item_id='memory-one' AND revision=3 AND operation_id='paired-inverse') "
                       "BEGIN SELECT RAISE(ABORT,'injected inverse storage failure'); END")
        self.rejected(self.inverse('paired-forward', copy_revision=1, op='paired-inverse'), 'INTERNAL_ERROR')
        self.assertEqual(self.effects(), before)
        self.assertEqual(self.sql('SELECT * FROM memory_transfer_acts'), witnesses)
        with sqlite3.connect(str(self.path)) as db:
            db.execute('DROP TRIGGER injected_inverse_second')
        envelope = self.envelope('memory.transfer.undo', {'transfer_id': 'paired-forward'}, {},
                                 {'item_revision': 2, 'copy_revision': 1}, op='paired-inverse')
        receipt = self.store.command('owner', envelope)
        self.committed(receipt)
        after = self.effects()
        self.assertEqual(self.store.command('owner', envelope), receipt)
        self.assertEqual(self.effects(), after)
        self.assertEqual(self.page()['body'], WORDS)

    def test_local_cli_uses_bound_envelope_and_saved_receipt_without_adapter_owned_effects(self):
        self.committed(self.memory(body=WORDS))
        profile = Path(self.temp.name).resolve() / 'isolated-transfer-owner.json'
        write_profile(profile, str(self.path.resolve()), 'test-instance', 'owner', binding=self.binding)
        cli = ['/usr/bin/python3', '-I', str(Path(__file__).resolve().parents[1] / 'bin/aim-next'), '--profile', str(profile)]
        def run(verb, request=None):
            result = subprocess.run(cli + [verb] + ([] if request is None else ['-']),
                                    input='' if request is None else json.dumps(request), capture_output=True, text=True)
            self.assertEqual((result.returncode, result.stderr), (0, ''), result.stdout)
            return json.loads(result.stdout)
        binding = run('binding')['binding']
        copy = self.envelope('memory.copy', {'item_id': 'memory-one'}, {'owner_scope': OTHER, 'copy_id': 'cli-copy'},
                             {'item_revision': 1, 'copy_revision': 0}, op='cli-copy')
        request = {'v': 1, 'binding': binding, 'command': copy}
        answer = run('command', request)
        self.committed(answer)
        self.assertEqual(run('command', request), answer)
        lookup = run('view', {'v': 1, 'binding': binding, 'view': {'name': 'operation', 'args': {'operation_id': 'cli-copy'}}})
        self.assertEqual(lookup, answer)
        undo = self.envelope('memory.transfer.undo', {'transfer_id': 'cli-copy'}, {},
                             {'item_revision': 2, 'copy_revision': 1}, op='cli-inverse')
        self.committed(run('command', {'v': 1, 'binding': binding, 'command': undo}))
        self.assertEqual(self.page()['body'], WORDS)
        self.assertTrue(self.store.view('owner', 'memory_status', {'item_id': 'cli-copy'})['deleted'])

    def test_copied_media_bytes_stay_exact_and_current_scope_remains_the_media_gate(self):
        data = b'Isolated Notebook bytes\x00\xff\n'
        self.ready('transfer-media', data, actor='agent-a')
        self.committed(self.memory(body=WORDS, attachments=[{'id': 'transfer-media'}]))
        self.committed(self.transfer('copy', op='with-media'))
        for item, revision, reader in [('memory-one', 2, 'agent-b'), ('clone-one', 1, 'other-reader')]:
            with self.store.open_media(reader, {'media_id': 'transfer-media', 'source_ref': self.memory_ref(item, revision)}) as resource:
                self.assertEqual(self.read_all(resource), data)
        self.committed(self.transfer(item='memory-one', revision=2, op='move-original-media'))
        from aim_next.contract import Refusal
        with self.assertRaises(Refusal) as denied:
            with self.store.open_media('agent-b', {'media_id': 'transfer-media', 'source_ref': self.memory_ref('memory-one', 1)}):
                pass
        self.assertEqual(denied.exception.code, 'FORBIDDEN')
        with self.store.open_media('other-reader', {'media_id': 'transfer-media', 'source_ref': self.memory_ref('memory-one', 1)}) as resource:
            self.assertEqual(self.read_all(resource), data)
