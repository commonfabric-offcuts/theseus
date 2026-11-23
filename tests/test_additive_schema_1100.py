from __future__ import annotations

"""Real immutable Git inputs and disposable SQLite migration controls (1100)."""
import json
import ast
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
import uuid

from aim_next.judgment import guarded, source_diff
from aim_next.store import SCHEMA_VERSION
from test_gauntlet_source_987 import Binder987
from test_gauntlet_admission_987 import Admission987
import test_tools_train as trains
import test_store as stores


ENGINE = '''
class MigrationError(Exception):
    pass

def migrate(db, target):
    old, new, up, down, occupied = STEPS[-1]
    if target == new:
        for sql in up:
            db.execute(sql)
    else:
        if db.execute(occupied).fetchone()[0]:
            raise MigrationError('RECORDS_WOULD_BE_LOST')
        for sql in down:
            db.execute(sql)
'''

COVERAGE = '''from unittest import TestCase
from aim_next.migrations import migrate, MigrationError

class MigrationCases(TestCase):
    def test_up(self):
        migrate(self.db, '3')
        self.assertEqual(self.db.execute('SELECT count(*) FROM extra').fetchone()[0], 0)
    def test_down(self):
        migrate(self.db, '3')
        migrate(self.db, '2')
        self.assertEqual(self.db.execute("SELECT count(*) FROM sqlite_master WHERE name='extra'").fetchone()[0], 0)
    def test_occupied(self):
        migrate(self.db, '3')
        self.db.execute("INSERT INTO extra VALUES (1)")
        with self.assertRaisesRegex(MigrationError, 'RECORDS_WOULD_BE_LOST'):
            migrate(self.db, '2')
'''


class Source1100(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='additive1100-')
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name)
        self.git('init', '-q')
        self.git('config', 'user.email', 'scratch1100@example.invalid')
        self.git('config', 'user.name', 'Scratch 1100')
        self.write('aim_next/store.py', 'SCHEMA_VERSION = "2"\n')
        self.write('aim_next/migrations.py', 'STEPS = (("1", "2", ["CREATE TABLE old (id INTEGER)"], '
                   '["DROP TABLE old"], "SELECT EXISTS (SELECT 1 FROM old)"),)\n' + ENGINE)
        self.write('tests/test_migrations.py', '# no new coverage yet\n')
        self.base = self.commit()

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], text=True,
                                       stderr=subprocess.DEVNULL).strip()

    def write(self, path, text):
        file = self.repo/path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text)

    def commit(self):
        self.git('add', '.'); self.git('commit', '-qm', 'Synthetic migration source')
        return self.git('rev-parse', 'HEAD')

    def candidate(self, up=None, down=None, occupied=None, coverage=COVERAGE):
        up = ['CREATE TABLE extra (id INTEGER)'] if up is None else up
        down = ['DROP TABLE extra'] if down is None else down
        occupied = 'SELECT EXISTS (SELECT 1 FROM extra)' if occupied is None else occupied
        old = self.git('show', self.base+':aim_next/migrations.py')
        prefix, engine = old.split('\nclass MigrationError')
        prefix = prefix.replace('),)', '), ("2", "3", UP, DOWN, OCCUPIED),)')
        self.write('aim_next/migrations.py', 'from .extra import UP, DOWN, OCCUPIED\n' + prefix + '\nclass MigrationError' + engine + '\n')
        self.write('aim_next/extra.py', 'UP = %r\nDOWN = %r\nOCCUPIED = %r\n' % (up, down, occupied))
        self.write('aim_next/store.py', 'SCHEMA_VERSION = "3"\n')
        self.write('tests/test_migrations.py', coverage)
        return self.commit()

    def test_table_addition_is_ordinary_from_actual_git_not_checkout(self):
        head = self.candidate()
        self.write('aim_next/extra.py', 'raise RuntimeError("mutable worktree is not a source")\n')
        paths = source_diff(self.repo, self.base, head)
        self.assertEqual(guarded(paths), [], 'proved additive table must no longer wait for judgment')
        self.assertEqual(guarded(list(paths)), ['aim_next/migrations.py'], 'path-only callers stay conservative')

    def test_nullable_defaulted_column_and_index_are_ordinary(self):
        for sql, down, occupied in [
            ('ALTER TABLE old ADD COLUMN note TEXT', 'ALTER TABLE old DROP COLUMN note',
             'SELECT EXISTS (SELECT 1 FROM old WHERE note IS NOT NULL)'),
            ("ALTER TABLE old ADD COLUMN flag INTEGER NOT NULL DEFAULT 0", 'ALTER TABLE old DROP COLUMN flag',
             'SELECT EXISTS (SELECT 1 FROM old WHERE flag IS NOT 0)'),
            ('CREATE INDEX old_id ON old(id)', 'DROP INDEX old_id', 'SELECT 0'),
        ]:
            with self.subTest(sql=sql):
                head = self.candidate([sql], [down], occupied)
                self.assertEqual(guarded(source_diff(self.repo, self.base, head)), [])

    def test_destructive_rename_rewrite_constraints_and_bad_down_stay_judged(self):
        for up, down, occupied in [
            (['DROP TABLE old'], ['CREATE TABLE old (id INTEGER)'], 'SELECT 0'),
            (['ALTER TABLE old RENAME TO renamed'], ['ALTER TABLE renamed RENAME TO old'], 'SELECT 0'),
            (['UPDATE old SET id=0'], [], 'SELECT 0'),
            (['ALTER TABLE old ADD COLUMN note TEXT NOT NULL'], ['ALTER TABLE old DROP COLUMN note'], 'SELECT 0'),
            (['CREATE UNIQUE INDEX old_id ON old(id)'], ['DROP INDEX old_id'], 'SELECT 0'),
            (['CREATE TABLE extra (id INTEGER)'], ['DROP TABLE old'], 'SELECT EXISTS (SELECT 1 FROM extra)'),
            (['CREATE TABLE extra (id INTEGER)'], ['DROP TABLE extra'], 'SELECT 0'),
        ]:
            with self.subTest(up=up, down=down, occupied=occupied):
                head = self.candidate(up, down, occupied)
                self.assertIn('aim_next/migrations.py', guarded(source_diff(self.repo, self.base, head)))

    def test_unchanged_or_name_only_tests_are_not_migration_coverage(self):
        for coverage in ['# no coverage\n', 'def test_up_down_occupied():\n    pass\n', COVERAGE.replace("'3'", "'1'").replace("'2'", "'1'")]:
            with self.subTest(coverage=coverage):
                head = self.candidate(coverage=coverage)
                self.assertIn('aim_next/migrations.py', guarded(source_diff(self.repo, self.base, head)))

    def test_old_step_or_engine_change_and_other_guarded_owner_stay_judged(self):
        self.candidate()
        file = self.repo/'aim_next/migrations.py'
        for old, new in [('CREATE TABLE old (id INTEGER)', 'CREATE TABLE old (id TEXT)'),
                         ('raise MigrationError', 'raise RuntimeError')]:
            before = file.read_text(); file.write_text(before.replace(old, new))
            head = self.commit()
            self.assertIn('aim_next/migrations.py', guarded(source_diff(self.repo, self.base, head)))
            file.write_text(before)
        self.write('tools/deploy.py', '# changed guard\n')
        head = self.commit()
        self.assertEqual(guarded(source_diff(self.repo, self.base, head)), ['tools/deploy.py'])

    def test_new_executable_migration_expression_and_changed_occupied_guard_are_judged(self):
        self.candidate()
        file = self.repo/'aim_next/migrations.py'
        file.write_text(file.read_text() + '\nSIDE_EFFECT = rewrite_records()\n')
        head = self.commit()
        self.assertIn('aim_next/migrations.py', guarded(source_diff(self.repo, self.base, head)))
        head = self.candidate(occupied='SELECT EXISTS (SELECT 1 FROM extra) AND 0')
        self.assertIn('aim_next/migrations.py', guarded(source_diff(self.repo, self.base, head)))

    def test_transitive_old_sql_change_is_judged(self):
        file = self.repo/'aim_next/migrations.py'
        file.write_text('from .old_sql import LEGACY\n' + file.read_text().replace('["CREATE TABLE old (id INTEGER)"]', 'LEGACY'))
        self.write('aim_next/old_sql.py', 'LEGACY = ["CREATE TABLE old (id INTEGER)"]\n')
        self.base = self.commit(); self.candidate()
        self.write('aim_next/old_sql.py', 'LEGACY = ["CREATE TABLE old (id TEXT)"]\n')
        head = self.commit()
        self.assertIn('aim_next/migrations.py', guarded(source_diff(self.repo, self.base, head)))

    def test_imported_sql_rewrite_without_migrations_path_is_still_judged(self):
        head = self.candidate(); self.base = head
        self.write('aim_next/extra.py', "UP = ['DROP TABLE old']\nDOWN = ['CREATE TABLE old (id INTEGER)']\nOCCUPIED = 'SELECT 0'\n")
        head = self.commit(); paths = source_diff(self.repo, self.base, head)
        self.assertNotIn('aim_next/migrations.py', paths)
        self.assertEqual(guarded(paths), ['aim_next/extra.py'])

    def test_imported_sql_deletion_symlink_and_missing_literal_proof_are_judged(self):
        head = self.candidate(); self.base = head
        file = self.repo/'aim_next/extra.py'; original = file.read_text()
        for mode in ('deleted', 'symlink', 'bad-python'):
            with self.subTest(mode=mode):
                if file.exists() or file.is_symlink(): file.unlink()
                if mode == 'symlink': file.symlink_to('unbound-local-source.py')
                if mode == 'bad-python': file.write_text('invalid Python !\n')
                head = self.commit()
                self.assertEqual(guarded(source_diff(self.repo,self.base,head)), ['aim_next/extra.py'])
                if file.exists() or file.is_symlink(): file.unlink()
                file.write_text(original)

    def test_schema_number_alone_cannot_claim_an_ordinary_migration(self):
        self.write('aim_next/store.py', 'SCHEMA_VERSION = "3"\n')
        head = self.commit()
        self.assertEqual(guarded(source_diff(self.repo,self.base,head)), ['aim_next/store.py'])

    def test_changed_engine_import_and_new_executable_import_stay_judged(self):
        file = self.repo/'aim_next/migrations.py'
        file.write_text('from pathlib import Path\n' + file.read_text())
        self.base = self.commit(); self.candidate()
        file.write_text(file.read_text().replace('from pathlib import Path', 'from pathlib import PurePath as Path'))
        head = self.commit()
        self.assertIn('aim_next/migrations.py', guarded(source_diff(self.repo,self.base,head)))

    def test_expanding_declarations_do_not_get_an_ordinary_exception(self):
        self.candidate(); file = self.repo/'aim_next/migrations.py'
        additions = ['EXPAND0 = ("x",)'] + ['EXPAND%d = (EXPAND%d, EXPAND%d)' % (n,n-1,n-1) for n in range(1,40)]
        additions.append('EXPAND_RESULT = "%s" % (EXPAND39,)')
        file.write_text(file.read_text()+'\n'+'\n'.join(additions)+'\n')
        head = self.commit()
        self.assertIn('aim_next/migrations.py', guarded(source_diff(self.repo,self.base,head)))
        self.candidate()
        file.write_text(file.read_text()+'\nfrom .danger import rewrite_records\n')
        self.write('aim_next/danger.py', 'def rewrite_records():\n    raise AssertionError("never execute candidate code")\n')
        head = self.commit()
        self.assertIn('aim_next/migrations.py', guarded(source_diff(self.repo,self.base,head)))

    def test_actual_full_migration_chain_accepts_an_appended_literal_step(self):
        root = Path(__file__).resolve().parents[1]
        for file in (root/'aim_next').glob('*.py'):
            self.write('aim_next/'+file.name, file.read_text())
        self.write('tests/test_migrations.py', '# synthetic coverage baseline\n')
        self.base = self.commit()
        before = SCHEMA_VERSION; after = str(int(before)+1)
        file = self.repo/'aim_next/migrations.py'; text = file.read_text()
        node = next(n for n in ast.parse(text).body if isinstance(n, ast.Assign) and any(isinstance(t,ast.Name) and t.id=='STEPS' for t in n.targets))
        lines = text.splitlines(keepends=True)
        lines.insert(node.end_lineno-1, '    (%r, %r, UP, DOWN, OCCUPIED),\n' % (before,after))
        text = ''.join(lines).replace('STEPS = (', 'from .extra import UP, DOWN, OCCUPIED\n\nSTEPS = (')
        file.write_text(text)
        store = self.repo/'aim_next/store.py'; store.write_text(store.read_text().replace('SCHEMA_VERSION = "'+before+'"', 'SCHEMA_VERSION = "'+after+'"'))
        self.write('aim_next/extra.py', "UP = ['CREATE TABLE extra (id INTEGER)']\nDOWN = ['DROP TABLE extra']\nOCCUPIED = 'SELECT EXISTS (SELECT 1 FROM extra)'\n")
        coverage = COVERAGE.replace("migrate(self.db, '3')", "migrate(self.path, 'test-instance', self.binding, target=%r)" % after)
        coverage = coverage.replace("migrate(self.db, '2')", "migrate(self.path, 'test-instance', self.binding, target=%r)" % before)
        self.write('tests/test_migrations.py', coverage)
        head = self.commit()
        self.assertEqual(guarded(source_diff(self.repo,self.base,head)), [])

    def test_actual_up_down_occupied_and_existing_rows(self):
        head = self.candidate()
        # The fixture's actual suite executes its real migration entry, not the classifier.
        namespace = {}
        exec(self.git('show', head+':aim_next/extra.py'), namespace)
        exec(self.git('show', head+':aim_next/migrations.py').replace('from .extra import UP, DOWN, OCCUPIED', ''), namespace)
        with sqlite3.connect(':memory:') as db:
            db.execute('CREATE TABLE old (id INTEGER)'); db.execute('INSERT INTO old VALUES (42)')
            namespace['migrate'](db, '3')
            self.assertEqual(db.execute('SELECT * FROM old').fetchall(), [(42,)])
            db.execute('INSERT INTO extra VALUES (1)')
            with self.assertRaisesRegex(namespace['MigrationError'], 'RECORDS_WOULD_BE_LOST'):
                namespace['migrate'](db, '2')
            self.assertEqual(db.execute('SELECT * FROM extra').fetchall(), [(1,)])
            db.execute('DELETE FROM extra')
            namespace['migrate'](db, '2')
            self.assertIsNone(db.execute("SELECT name FROM sqlite_master WHERE name='extra'").fetchone())
            self.assertEqual(db.execute('SELECT * FROM old').fetchall(), [(42,)])


class Core1100(Binder987):
    write = Source1100.write
    candidate = Source1100.candidate

    def cli(self, piece, base, head, profile=None):
        root = Path(__file__).resolve().parents[1]
        cache = Path(self.temp.name).resolve()/('cli-cache-'+uuid.uuid4().hex)
        return subprocess.run(['/usr/bin/python3','-I','-X','pycache_prefix='+str(cache),'-B',str(root/'bin/aim-next'),
            '--profile',str(profile or self.profile),'--json','freeze',piece,'--repo',str(self.repo),
            '--base',base,'--head',head],capture_output=True,text=True)

    def setUp(self):
        super().setUp()
        self.write('aim_next/store.py', 'SCHEMA_VERSION = "2"\n')
        self.write('aim_next/migrations.py', 'STEPS = (("1", "2", ["CREATE TABLE old (id INTEGER)"], '
                   '["DROP TABLE old"], "SELECT EXISTS (SELECT 1 FROM old)"),)\n' + ENGINE)
        self.write('tests/test_migrations.py', '# no new coverage yet\n')
        self.base = self.commit()

    def test_1100_real_cli_freezes_ordinary_and_receipt_retains_input_hashes(self):
        head = self.candidate(); piece = self.piece([1])
        answer = self.cli(piece, self.base, head)
        self.assertEqual(answer.returncode, 0, answer.stdout+answer.stderr)
        decoder = json.JSONDecoder(); first, end = decoder.raw_decode(answer.stdout)
        receipt = decoder.raw_decode(answer.stdout[end:].lstrip())[0]
        self.assertFalse(receipt['result']['freeze']['judged'])
        self.assertEqual(receipt['result']['migration']['head_commit'], head)
        self.assertIn('aim_next/extra.py', receipt['result']['migration']['inputs']['head'])
        self.assertFalse(self.shown(piece)['freeze']['judged'], answer.stdout)

    def test_1100_full_chain_witness_fits_real_cli_and_core_receipt(self):
        from aim_next.contract import LIMITS
        Source1100.test_actual_full_migration_chain_accepts_an_appended_literal_step(self)
        head = self.git('rev-parse', 'HEAD'); paths = source_diff(self.repo,self.base,head)
        self.assertLess(len(json.dumps(paths.migration_sources).encode('utf-8')), LIMITS['http_envelope_bytes']-32768)
        piece = self.piece([1]); answer = self.cli(piece,self.base,head)
        self.assertEqual(answer.returncode,0,answer.stdout+answer.stderr)
        self.assertFalse(self.shown(piece)['freeze']['judged'], answer.stdout)

    def test_1100_core_derives_mark_refuses_foreign_witness_and_never_reads_git(self):
        from unittest import mock
        import copy
        head = self.candidate(); paths = source_diff(self.repo, self.base, head); piece = self.piece([1])
        args = {'base_commit':self.base, 'head_commit':head, 'files':list(paths), 'migration_sources':getattr(paths,'migration_sources',None)}
        with mock.patch('subprocess.run', side_effect=AssertionError('Core must not launch Git or migration workloads')):
            answer = self.command('pipeline.freeze', args, {'piece_id':piece}, {'piece_revision':self.version(piece)}, actor='owner')
        self.assertFalse(self.committed(answer)['freeze']['judged'])
        for change in ('base_commit', 'head_commit', 'files'):
            bad = copy.deepcopy(args)
            bad['migration_sources'][change] = [] if change == 'files' else 'f'*40
            self.rejected(self.command('pipeline.freeze', bad, {'piece_id':piece}, {'piece_revision':self.version(piece)}, actor='owner'), 'INVALID_ARGUMENT')
        self.assertEqual(self.sql('SELECT count(*) FROM pipeline_piece_freezes'), [(1,)])

    def test_1100_missing_or_unqualified_witness_is_judged_without_override(self):
        head = self.candidate(); paths = source_diff(self.repo, self.base, head); piece = self.piece([1])
        args = {'base_commit':self.base, 'head_commit':head, 'files':list(paths)}
        answer = self.command('pipeline.freeze', args, {'piece_id':piece}, {'piece_revision':self.version(piece)}, actor='owner')
        self.assertTrue(self.committed(answer)['freeze']['judged'])
        args['judged'] = False
        self.rejected(self.command('pipeline.freeze', args, {'piece_id':piece}, {'piece_revision':self.version(piece)}, actor='owner'), 'INVALID_ARGUMENT')


class Admission1100(Admission987):
    write = Source1100.write
    candidate = Source1100.candidate

    def commit(self, words='Synthetic migration\n\nPipeline: 1100'):
        return super().commit(words)

    def setUp(self):
        super().setUp()
        self.write('aim_next/store.py', 'SCHEMA_VERSION = "2"\n')
        self.write('aim_next/migrations.py', 'STEPS = (("1", "2", ["CREATE TABLE old (id INTEGER)"], '
                   '["DROP TABLE old"], "SELECT EXISTS (SELECT 1 FROM old)"),)\n' + ENGINE)
        self.write('tests/test_migrations.py', '# no new coverage yet\n')
        self.base = self.commit()

    def test_1100_ordinary_addition_needs_no_pipeline_and_destructive_change_is_judged(self):
        from tools import deploy
        head = self.candidate(); self.git('checkout', '--detach', self.base)
        (self.root/'pages').write_text('unavailable')
        self.assertFalse(deploy.admit(self.config, head)['judged'])
        self.assertFalse((self.root/'reads').exists())
        head = self.candidate(['DROP TABLE old'], ['CREATE TABLE old (id INTEGER)'], 'SELECT 0')
        self.git('checkout', '--detach', self.base); self.pages({0:self.page()})
        self.assertTrue(deploy.admit(self.config, head)['judged'])

    def test_1100_frozen_ordinary_migration_blocks_judged_work_and_forgery_refuses(self):
        from tools import deploy
        head = self.candidate(); paths = source_diff(self.repo, self.base, head)
        self.write('tools/deploy.py', '# synthetic guarded head\n'); judged = self.commit()
        self.git('checkout', '--detach', self.base)
        piece = self.piece(42)
        piece['freeze'].update(base_commit=self.base, head_commit=head, files=list(paths))
        self.pages({0:self.page([piece], [42])})
        with self.assertRaisesRegex(deploy.Refused, 'Approved, unshipped work is waiting'):
            deploy.admit(self.config, judged)
        piece['freeze']['files'] = ['aim_next/migrations.py']
        self.pages({0:self.page([piece], [42])})
        with self.assertRaisesRegex(deploy.Refused, 'differs from its actual source'):
            deploy.admit(self.config, judged)


class Train1100(trains.DeployRefusesTrain):
    def schema_train(self, up=None, down=None, occupied=None):
        helper = Source1100('test_table_addition_is_ordinary_from_actual_git_not_checkout')
        helper.setUp(); self.addCleanup(helper.doCleanups)
        def contents(revision):
            return [(p, helper.git('show', revision+':'+p)+'\n') for p in helper.git('ls-tree', '-r', '--name-only', revision).splitlines()]
        tip = self.git(self.live, 'rev-parse', 'HEAD')
        base = self.branch('schema-base', tip, contents(helper.base))
        self.merge(base)
        self.git(self.live, 'merge', '-q', '--ff-only', base)
        source = helper.candidate(up, down, occupied)
        self.head = self.branch('schema-step', base, contents(source))
        self.merged = self.merge(self.head)

    def test_1100_real_ordinary_train_accepts_addition(self):
        self.schema_train()
        value = self.judged()
        self.assertEqual(value['guarded_changes'], [])
        self.assertEqual(value['judgment'], 'pending')

    def test_1100_real_ordinary_train_refuses_rewrite(self):
        self.schema_train(['UPDATE old SET id=0'], [], 'SELECT 0')
        with self.assertRaisesRegex(trains.deploy.train_check.Refused, 'ordinary train cannot change aim_next/migrations.py'):
            self.judged()


class Migration1100(stores.StoreCase):
    def test_1100_actual_engine_up_down_and_occupied_preserve_existing_records(self):
        from unittest import mock
        from aim_next import migrations, store
        initial = list(migrations.STEPS)
        old, new = store.SCHEMA_VERSION, str(int(store.SCHEMA_VERSION)+1)
        with sqlite3.connect(self.path) as db:
            cursor = db.execute('SELECT * FROM actors ORDER BY id')
            columns = ','.join(x[0] for x in cursor.description)
            original = cursor.fetchall()
            before = db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
            layout = {name:[row[1] for row in db.execute('PRAGMA table_info("'+name+'")')]
                      for kind,name,table,sql in before if kind=='table'}
            def retained_rows(db):
                rows = {name: sorted(db.execute('SELECT '+','.join('"'+c+'"' for c in cols)+' FROM "'+name+'"').fetchall(),key=repr)
                        for name,cols in layout.items()}
                rows['metadata'] = [r for r in rows['metadata'] if r[0] not in ('schema_version','commit_seq','commit_id')]
                return rows
            original_rows = retained_rows(db)
        cases = [
            (['CREATE TABLE extra1100 (id INTEGER)'], ['DROP TABLE extra1100'],
             'SELECT EXISTS (SELECT 1 FROM extra1100)', 'INSERT INTO extra1100 VALUES (1)', 'DELETE FROM extra1100'),
            (['ALTER TABLE actors ADD COLUMN extra1100 TEXT'], ['ALTER TABLE actors DROP COLUMN extra1100'],
             'SELECT EXISTS (SELECT 1 FROM actors WHERE extra1100 IS NOT NULL)', "UPDATE actors SET extra1100='kept'", 'UPDATE actors SET extra1100=NULL'),
            (['ALTER TABLE actors ADD COLUMN extra1100 INTEGER NOT NULL DEFAULT 0'], ['ALTER TABLE actors DROP COLUMN extra1100'],
             'SELECT EXISTS (SELECT 1 FROM actors WHERE extra1100 IS NOT 0)', 'UPDATE actors SET extra1100=9', 'UPDATE actors SET extra1100=0'),
            (['CREATE INDEX extra1100 ON actors(id)'], ['DROP INDEX extra1100'], 'SELECT 0', None, None),
        ]
        for up, down, occupied, populate, clear in cases:
            with self.subTest(up=up), mock.patch.object(migrations, 'STEPS', tuple(initial+[(old,new,up,down,occupied)])), mock.patch.object(store, 'SCHEMA_VERSION', new):
                self.assertTrue(migrations.migrate(self.path, 'test-instance', self.binding)['migrated'])
                with sqlite3.connect(self.path) as db:
                    self.assertEqual(db.execute('SELECT '+columns+' FROM actors ORDER BY id').fetchall(), original)
                    self.assertEqual(retained_rows(db), original_rows)
                    if populate: db.execute(populate)
                if populate:
                    with self.assertRaisesRegex(migrations.MigrationError, 'older version cannot hold records'):
                        migrations.migrate(self.path, 'test-instance', self.binding, old)
                    with sqlite3.connect(self.path) as db:
                        self.assertEqual(db.execute("SELECT value FROM metadata WHERE key='schema_version'").fetchone()[0], new)
                        db.execute(clear)
                self.assertTrue(migrations.migrate(self.path, 'test-instance', self.binding, old)['migrated'])
                with sqlite3.connect(self.path) as db:
                    self.assertEqual(db.execute('SELECT * FROM actors ORDER BY id').fetchall(), original)
                    self.assertEqual(retained_rows(db), original_rows)
                    self.assertEqual(db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall(), before)


def load_tests(loader, tests, pattern):
    return unittest.TestSuite([loader.loadTestsFromTestCase(Source1100)] + [unittest.TestSuite(
        cls(name) for name in loader.getTestCaseNames(cls) if name.startswith('test_1100_'))
        for cls in (Core1100, Admission1100, Train1100, Migration1100)])


if __name__ == '__main__':
    unittest.main()
