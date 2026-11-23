from __future__ import annotations

"""Inert frozen Git bodies, through the real CLI and isolated Core records."""
import json
import os
from pathlib import Path
import subprocess
import unittest

from test_gauntlet_source_987 import Binder987, ROOT


class MigrationFreeze1105(Binder987):
    test_path = 'tests/test_synthetic_migration.py'

    def head(self, body, path=None):
        path = self.repo / (path or self.test_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding='utf-8')
        return self.commit()

    def cli(self, piece, base, head, profile=None):
        # -I ignores PYTHONPYCACHEPREFIX; pass this phase's unique cache explicitly.
        return subprocess.run(['/usr/bin/python3', '-I', '-X',
            'pycache_prefix=' + os.environ['PYTHONPYCACHEPREFIX'], str(ROOT/'bin/aim-next'),
            '--profile', str(profile or self.profile), '--json', 'freeze', piece,
            '--repo', str(self.repo), '--base', base, '--head', head], capture_output=True, text=True)

    def records(self, piece):
        return (self.version(piece), self.sql('SELECT * FROM pipelines'),
                self.sql('SELECT * FROM pipeline_piece_freezes'), self.sql('SELECT * FROM pipeline_facts'))

    def rejected_head(self, body, line=1):
        if not hasattr(self, '_probe_piece'):
            self._probe_piece = self.piece([1])
        piece = self._probe_piece
        head = self.head(body)
        before = self.records(piece)
        answer = self.cli(piece, self.base, head)
        self.assertEqual(answer.returncode, 2, answer.stdout + answer.stderr)
        replies = [json.loads(s) for s in answer.stdout.splitlines() if s.strip()]
        refusal = next(s for s in replies if s.get('status') == 'rejected')
        self.assertEqual(refusal['error']['code'], 'MIGRATION_TEST_LITERAL', answer.stdout)
        words = refusal['error']['message']
        for expected in (self.test_path + ':' + str(line), 'STEPS[-1][1]', 'step[2] is X_SCHEMA'):
            self.assertIn(expected, words)
        self.assertEqual(self.records(piece), before)
        self.assertNotIn('Traceback', answer.stderr)

    def raw(self, piece, sources, actor='owner', expected=None, op=None):
        return self.command('pipeline.freeze', {'base_commit': self.base, 'head_commit': 'b'*40,
            'files': [self.test_path], 'test_sources': sources}, {'piece_id': piece},
            {'piece_revision': self.version(piece) if expected is None else expected}, actor=actor, op=op)

    def test_1105_cli_refuses_direct_migrate_targets_and_import_aliases(self):
        for body, line in [
            ('migrate(path, instance, binding, "66")\n', 1),
            ('# Unicode: π\nmigrate(path, instance, binding, target="65")\n', 2),
            ('from aim_next.migrations import migrate as upgrade\nupgrade(p, i, b, "66")\n', 2),
            ('migrations.migrate(p, i, b, target="60")\n', 1),
        ]:
            with self.subTest(body=body): self.rejected_head(body, line)

    def test_1105_cli_refuses_metadata_writes_without_executing_them(self):
        for body in [
            'db.execute("UPDATE metadata SET value=\'66\' WHERE key=\'schema_version\'")\n',
            'self.sql("UPDATE metadata SET value=? WHERE key=\'schema_version\'", ("65",))\n',
            'db.execute("INSERT OR REPLACE INTO metadata(key,value) VALUES(\'schema_version\',?)", ("66",))\n',
            'db.execute("INSERT INTO metadata(key,value) VALUES(?,?)", ("schema_version", "66"))\n',
            'metadata["schema_version"] = "66"\n',
            'self.metadata.schema_version = "66"\n',
            'metadata.update(schema_version="66")\n',
        ]:
            with self.subTest(body=body): self.rejected_head(body)

    def test_1105_cli_refuses_literal_step_pairs(self):
        for body in [
            'self.assertEqual(step[:2], ("65", "66"))\n',
            'assert ("65", "66") == step[:2]\n',
            'self.assertSequenceEqual(STEPS[-1][:2], ["65", "66"])\n',
        ]:
            with self.subTest(body=body): self.rejected_head(body)

    def test_1105_token_latest_defaults_and_unrelated_literals_remain_valid(self):
        body = '''# migrate(p, i, b, "66") is a comment, not a call.
"""metadata["schema_version"] = "66" is a docstring."""
step = next(step for step in STEPS if step[2] is LINK_SCHEMA)
migrate(p, i, b, step[0])
migrate(p, i, b, target=step[1])
migrate(p, i, b, target=STEPS[-1][1])
migrate(p, i, b, target=SCHEMA_VERSION)
migrate(p, i, b)
db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (step[0],))
metadata["schema_version"] = step[0]
self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='schema_version'"), [("65",)])
self.assertEqual(coords, ("65", "66"))
assert ("65", "66") == coordinates
'''
        head = self.head(body); piece = self.piece([1])
        result = self.cli(piece, self.base, head)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.shown(piece)['freeze']['head_commit'], head)

    def test_1105_only_changed_files_are_scanned_and_deleted_bodies_are_absent(self):
        old = self.head('migrate(p, i, b, "60")\n')
        (self.repo/'note.txt').write_text('unrelated')
        head = self.commit(); piece = self.piece([1])
        answer = self.cli(piece, old, head)
        self.assertEqual(answer.returncode, 0, answer.stdout + answer.stderr)
        (self.repo/self.test_path).unlink(); deleted = self.commit()
        other = self.piece([2], 'deleted-piece')
        answer = self.cli(other, head, deleted)
        self.assertEqual(answer.returncode, 0, answer.stdout + answer.stderr)

    def test_1105_reads_head_not_worktree_in_both_directions_and_rename_is_scanned(self):
        bad = self.head('migrate(p, i, b, "66")\n'); piece = self.piece([1])
        (self.repo/self.test_path).write_text('migrate(p, i, b, target=STEPS[-1][1])\n')
        before = self.records(piece)
        answer = self.cli(piece, self.base, bad)
        self.assertEqual(answer.returncode, 2, answer.stdout + answer.stderr)
        self.assertEqual(self.records(piece), before)
        good = self.commit()
        (self.repo/self.test_path).write_text('migrate(p, i, b, "66")\n')
        answer = self.cli(piece, self.base, good)
        self.assertEqual(answer.returncode, 0, answer.stdout + answer.stderr)
        self.git('reset', '--hard', bad)
        (self.repo/self.test_path).rename(self.repo/'tests/test_renamed.py')
        renamed = self.commit(); other = self.piece([2], 'renamed-piece')
        answer = self.cli(other, self.base, renamed)
        self.assertEqual(answer.returncode, 2, answer.stdout + answer.stderr)
        self.assertIn('tests/test_renamed.py:1', answer.stdout)

    def test_1105_raw_core_refusal_is_atomic_and_foreign_and_stale_stay_first(self):
        piece = self.piece([1]); sources = {self.test_path: 'migrate(p, i, b, "66")\n'}
        before = self.records(piece)
        self.rejected(self.raw(piece, sources), 'MIGRATION_TEST_LITERAL')
        self.assertEqual(self.records(piece), before)
        self.rejected(self.raw(piece, sources, actor='agent-b'), 'FORBIDDEN')
        self.rejected(self.raw(piece, sources, expected=self.version(piece)-1), 'REVISION_CONFLICT')
        self.assertEqual(self.records(piece), before)

    def test_1105_raw_sources_require_exact_coverage_valid_body_and_bounds(self):
        piece = self.piece([1]); before = self.records(piece)
        for sources in [None, {}, {self.test_path: 7}, {self.test_path: 'def broken('},
                        {self.test_path: 'x'*262145}, {self.test_path: '\ud800'},
                        {self.test_path: '', 'tests/extra.py': ''}]:
            with self.subTest(sources_type=type(sources).__name__):
                self.rejected(self.raw(piece, sources), 'INVALID_ARGUMENT')
                self.assertEqual(self.records(piece), before)
        missing = self.command('pipeline.freeze', {'base_commit': self.base, 'head_commit': 'b'*40,
            'files': [self.test_path]}, {'piece_id': piece}, {'piece_revision': self.version(piece)})
        self.rejected(missing, 'INVALID_ARGUMENT')

    def test_1105_core_success_shared_noop_replay_and_approved_source_still_protected(self):
        piece = self.piece([1]); sources = {self.test_path: 'migrate(p, i, b, STEPS[-1][1])\n'}
        version = self.version(piece)
        first = self.raw(piece, sources, op='source-once')
        value = self.committed(first)
        self.assertEqual(self.raw(piece, sources, expected=version, op='source-once'), first)
        self.assertFalse(self.committed(self.raw(piece, sources))['changed'])
        shared = self.store.view('agent-b', 'pipeline', {'workspace_id': 'w1'})
        self.assertEqual(next(p for p in shared['pieces'] if p['id']==piece)['freeze'], value['freeze'])
        self.wait(piece)
        self.rejected(self.command('pipeline.freeze', {'base_commit': self.base, 'head_commit': 'c'*40,
            'files': [self.test_path], 'test_sources': sources}, {'piece_id': piece},
            {'piece_revision': self.version(piece)}), 'PIECE_APPROVED')

    def test_1105_invalid_utf8_symlinks_and_syntax_refuse_without_execution(self):
        marker = self.repo/'candidate-was-executed'
        prefix = 'from pathlib import Path\nPath(%r).write_text("executed")\n' % str(marker)
        piece = self.piece([1])
        for body in [b'\xff', b'def broken(', (prefix+'migrate(p, i, b, "66")\n').encode()]:
            path = self.repo/self.test_path; path.parent.mkdir(exist_ok=True);path.write_bytes(body)
            head = self.commit(); before = self.records(piece)
            result = self.cli(piece, self.base, head)
            self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
            self.assertEqual(self.records(piece), before)
            self.assertFalse(marker.exists())
        path.unlink();path.symlink_to('../tools/deploy.py');head=self.commit()
        result=self.cli(piece,self.base,head)
        self.assertEqual(result.returncode,2,result.stdout+result.stderr)
        self.assertFalse(marker.exists())


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(MigrationFreeze1105(name) for name in MigrationFreeze1105.__dict__
                              if name.startswith('test_1105_'))
