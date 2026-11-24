"""The landing kit's decisions (1196): each step's refusals and passes, driven through the real scripts where they are
scripts, against a copy of the kit and a seat config in a scratch folder. Nothing here reaches a board, a clone or a
deploy."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
KIT = ROOT / 'tools' / 'landing'
sys.path.insert(0, str(KIT))
import cards_add  # noqa: E402
import config  # noqa: E402
import decisions  # noqa: E402
import runner_visible  # noqa: E402

A, B, BASE, CARRY = 'a' * 40, 'b' * 40, 'c' * 40, 'd' * 40


class Seat(unittest.TestCase):
    """A copy of the kit beside tools/lane_lock.py, and a config naming folders in the scratch folder."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.kit = self.root / 'clone' / 'tools' / 'landing'
        shutil.copytree(KIT, self.kit, ignore=shutil.ignore_patterns('__pycache__'))
        shutil.copy(ROOT / 'tools' / 'lane_lock.py', self.kit.parent / 'lane_lock.py')
        self.settings = {key: str(self.root / key) for key in config.KEYS}
        self.settings.update({'guard': 'guard.json', 'seat': 'tester', 'workspace': 'w', 'dossier_tells': 'tony',
                              'cards_note': 'n-1', 'releases_topic': 't-1', 'remote': 'r', 'repo': 'o/r', 'release_branch': 'b'})
        for name in ('work', 'posts', 'scratch', 'live', 'coordinator'):
            Path(self.settings[name]).mkdir()
        for path in (self.settings['ship'], Path(self.settings['coordinator']) / 'deploy-trains.json',
                     Path(self.settings['coordinator']) / 'guard.json', Path(self.settings['live']) / 'bin' / 'aim-next'):
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            Path(path).write_text('{}')
        self.write_config()

    def tearDown(self):
        self.tmp.cleanup()

    def write_config(self):
        path = self.root / 'landing.json'
        path.write_text(json.dumps(self.settings))
        self.env = dict(os.environ, THESEUS_LANDING_CONFIG=str(path), THESEUS_LOCK_DIR=str(self.root / 'locks'))

    def run_kit(self, *argv):
        script = self.kit / argv[0]
        command = (['bash'] if script.suffix == '.sh' else [sys.executable, '-I']) + [str(script)] + [str(a) for a in argv[1:]]
        return subprocess.run(command, env=self.env, capture_output=True, text=True)

    def folder(self, item='1300'):
        made = self.run_kit('new_folder.sh', item)
        self.assertEqual(made.returncode, 0, made.stdout + made.stderr)
        return Path(self.settings['work']) / (item + '-land')


class Config(Seat):
    def test_every_key_reads_from_the_file_the_environment_names(self):
        self.assertEqual(self.run_kit('config.py', 'seat').stdout.strip(), 'tester')
        self.assertIn('all %d keys present' % len(config.KEYS), self.run_kit('config.py', '--check').stdout)

    def test_a_missing_file_refuses_and_names_the_example(self):
        self.env['THESEUS_LANDING_CONFIG'] = str(self.root / 'none.json')
        out = self.run_kit('config.py', 'seat')
        self.assertNotEqual(out.returncode, 0)
        self.assertIn('config.example.json', out.stderr)

    def test_a_missing_key_refuses_naming_it(self):
        del self.settings['clone']
        self.write_config()
        out = self.run_kit('config.py', 'seat')
        self.assertNotEqual(out.returncode, 0)
        self.assertIn('lacks clone', out.stderr)

    def test_an_unknown_key_refuses_and_an_optional_one_reads_empty(self):
        self.assertNotEqual(self.run_kit('config.py', 'nope').returncode, 0)
        out = self.run_kit('config.py', 'on_live')
        self.assertEqual((out.returncode, out.stdout), (0, '\n'))

    def test_the_example_holds_every_key(self):
        example = json.loads((KIT / 'config.example.json').read_text())
        self.assertEqual(sorted(example), sorted(config.KEYS))


class CarryRefusal(unittest.TestCase):
    def spec(self, **fields):
        value = {'approved_head': A, 'review_head': A, 'source': CARRY, 'base': BASE}
        value.update(fields)
        return value

    def test_the_carry_of_the_reviewed_head_onto_live_passes(self):
        self.assertIsNone(decisions.carry_refusal(self.spec(), [A, BASE]))

    def test_the_reviewed_head_itself_passes(self):
        self.assertIsNone(decisions.carry_refusal(self.spec(source=A), [BASE]))

    def test_a_review_naming_no_head_refuses(self):
        self.assertIn('no review_head', decisions.carry_refusal(self.spec(review_head=None), [A, BASE]))

    def test_a_review_written_of_another_head_refuses(self):
        self.assertIn('written of bbbbbbbb', decisions.carry_refusal(self.spec(review_head=B), [A, BASE]))

    def test_a_carry_of_another_head_refuses(self):
        self.assertIn('not live', decisions.carry_refusal(self.spec(), [B, BASE]))

    def test_a_carry_onto_another_base_refuses(self):
        self.assertIn('not live', decisions.carry_refusal(self.spec(), [A, B]))


class Proof(unittest.TestCase):
    SPEC = {'piece': 'p-1', 'approved_head': A, 'carry': CARRY}

    def test_a_freeze_at_the_approved_head_needs_an_approval_after_it(self):
        piece = {'freeze': {'head_commit': A, 'at_ms': 2000}, 'approval': {'at_ms': 3000}}
        self.assertIn('approved in Review', decisions.proof(self.SPEC, piece))
        piece['approval']['at_ms'] = 1000
        with self.assertRaisesRegex(ValueError, 'no approval given after its freeze'):
            decisions.proof(self.SPEC, piece)

    def test_a_freeze_at_the_carry_names_who_froze_it(self):
        piece = {'freeze': {'head_commit': CARRY, 'at_ms': 2000, 'by': 'fable'}}
        self.assertIn('the carry frozen by fable', decisions.proof(self.SPEC, piece))

    def test_a_freeze_at_any_other_head_refuses(self):
        with self.assertRaisesRegex(ValueError, 'not the landing head'):
            decisions.proof(self.SPEC, {'freeze': {'head_commit': B, 'at_ms': 2000}})

    def test_with_no_freeze_fables_read_of_the_exact_carry_is_the_proof(self):
        spec = dict(self.SPEC, carry_read={'topic': 't', 'seq': 5, 'id': 'm-1', 'why': 'a test file over the freeze limit'})
        read = {'id': 'm-1', 'author_id': 'fable', 'body': 'read ' + CARRY, 'sent_ms': 3000}
        self.assertIn('the carry read by fable', decisions.proof(spec, {}, read))
        with self.assertRaisesRegex(ValueError, 'not fable'):
            decisions.proof(spec, {}, dict(read, author_id='flex'))
        with self.assertRaisesRegex(ValueError, 'not fable'):
            decisions.proof(spec, {}, dict(read, body='read ' + B))
        with self.assertRaisesRegex(ValueError, 'not on the board'):
            decisions.proof(spec, {}, None)


class Steps(Seat):
    def step(self, marker, command):
        receipts = self.root / 'receipts'
        receipts.mkdir(exist_ok=True)
        script = '. "%s"; step "%s" one "%s" %s; echo "rc $?"; phases "%s" one two' % (
            self.kit / 'kit.sh', receipts, marker, command, receipts)
        out = subprocess.run(['bash', '-c', script], env=self.env, capture_output=True, text=True).stdout
        return out.strip().split('\n')[-1], receipts

    def test_step_passes_only_on_a_zero_exit_with_output_and_its_marker(self):
        self.assertEqual(self.step('OK', 'echo OK')[0], 'rc 0')
        self.assertEqual(self.step('OK', 'false')[0], 'rc 1')
        self.assertEqual(self.step('', 'true')[0], 'rc 2')
        self.assertEqual(self.step('OK', 'echo other')[0], 'rc 3')

    def test_step_keeps_its_receipts_and_phases_names_what_was_not_reached(self):
        _, receipts = self.step('', 'echo hello')
        self.assertEqual((receipts / 'one.out').read_text(), 'hello\n')
        self.assertEqual((receipts / 'one.exit').read_text(), '0\n')
        self.assertIn('echo hello', (receipts / 'one.cmd').read_text())
        self.assertEqual((receipts / 'phases.txt').read_text(), 'one exit 0\ntwo not reached\n')


class Inputs(Seat):
    def test_a_new_folder_records_the_kit_and_a_changed_kit_refuses(self):
        folder = self.folder()
        spec = json.loads((folder / 'SPEC.json').read_text())
        self.assertEqual((spec['items'], spec['guard'], spec['review_head']), ([1300], 'guard.json', None))
        (folder / 'MERGE-BODY.txt').write_text('body\n\nPipeline: 1300\n')
        self.assertIn('INPUTS OK', self.run_kit('check_inputs.py', folder).stdout)
        with open(self.kit / 'decisions.py', 'a') as kit_file:
            kit_file.write('\n# changed\n')
        out = self.run_kit('check_inputs.py', folder)
        self.assertEqual(out.returncode, 2)
        self.assertIn('the kit changed since the folder was made: decisions.py', out.stdout)

    def test_a_second_folder_for_the_same_item_refuses(self):
        self.folder()
        self.assertIn('exists', self.run_kit('new_folder.sh', '1300').stdout)

    def test_a_missing_merge_body_or_helper_refuses(self):
        folder = self.folder()
        self.assertIn('MERGE-BODY.txt is missing', self.run_kit('check_inputs.py', folder).stdout)
        (folder / 'MERGE-BODY.txt').write_text('body\n')
        os.remove(self.settings['ship'])
        self.assertIn('external helper', self.run_kit('check_inputs.py', folder).stdout)


class Landing(Seat):
    def test_the_kit_refuses_to_run_from_the_live_checkout(self):
        self.settings['live'] = str(self.root / 'clone')
        self.write_config()
        out = self.run_kit('land_ordinary.sh', '1300', self.root)
        self.assertEqual(out.returncode, 2)
        self.assertIn('not from the live checkout', out.stdout)

    def test_a_landing_without_its_dossier_and_card_drafts_refuses_before_anything_runs(self):
        folder = self.folder()
        (folder / 'MERGE-BODY.txt').write_text('body\n\nPipeline: 1300\n')
        out = self.run_kit('land_ordinary.sh', '1300', self.root)
        self.assertEqual(out.returncode, 2)
        self.assertIn('dossier-1300.txt before landing', out.stdout)
        self.assertFalse((folder / 'attempts').exists())

    def test_publication_refuses_without_a_successful_deploy(self):
        attempt = self.folder() / 'attempts' / '1'
        attempt.mkdir(parents=True)
        (attempt / 'land.exit').write_text('5\n')
        out = self.run_kit('publish.sh', '1300', attempt)
        self.assertEqual(out.returncode, 2)
        self.assertIn('holds no successful deploy', out.stdout)

    def test_a_carry_whose_review_names_another_head_refuses_before_any_fetch(self):
        folder = self.folder()
        spec = json.loads((folder / 'SPEC.json').read_text())
        spec.update({'piece': 'p', 'topic': 't', 'release': 9, 'title': 'x', 'review': 'r', 'approved_head': A, 'review_head': B})
        (folder / 'SPEC.json').write_text(json.dumps(spec))
        out = self.run_kit('carry_ordinary.sh', '1300', A, BASE, 'branch')
        self.assertNotEqual(out.returncode, 0)
        self.assertIn('its review was written of bbbbbbbb', out.stdout + out.stderr)


def git(cwd, *args):
    return subprocess.run(['git', '-C', str(cwd), '-c', 'user.name=t', '-c', 'user.email=t@t', *args],
                          capture_output=True, text=True, check=True).stdout.strip()


class Carry(Seat):
    """carry_ordinary.sh against a local bare repository standing in for the remote."""

    def setUp(self):
        super().setUp()
        remote, work = self.root / 'remote.git', self.root / 'work'
        subprocess.run(['git', 'init', '-q', '--bare', str(remote)], check=True)
        subprocess.run(['git', 'init', '-q', str(work)], check=True)
        (work / 'base.txt').write_text('base\n')
        git(work, 'add', '.'); git(work, 'commit', '-q', '-m', 'start')
        git(work, 'checkout', '-q', '-b', 'piece')
        (work / 'piece.txt').write_text('piece\n')
        git(work, 'add', '.'); git(work, 'commit', '-q', '-m', 'piece')
        self.head = git(work, 'rev-parse', 'HEAD')
        git(work, 'checkout', '-q', '-b', 'live', 'HEAD~1')
        (work / 'live.txt').write_text('live\n')
        git(work, 'add', '.'); git(work, 'commit', '-q', '-m', 'live')
        self.live = git(work, 'rev-parse', 'HEAD')
        git(work, 'push', '-q', str(remote), 'piece', 'live')
        subprocess.run(['git', 'clone', '-q', str(remote), str(self.root / 'gitclone')], check=True)
        self.settings.update({'remote': str(remote), 'release_branch': 'live', 'clone': str(self.root / 'gitclone')})
        self.write_config()
        self.landing = self.folder()
        spec = json.loads((self.landing / 'SPEC.json').read_text())
        spec.update({'piece': 'p', 'topic': 't', 'release': 9, 'title': 'x', 'review': 'r',
                     'approved_head': self.head, 'review_head': self.head})
        (self.landing / 'SPEC.json').write_text(json.dumps(spec))

    def test_a_refused_preflight_after_the_carry_is_the_carrys_exit(self):
        out = self.run_kit('carry_ordinary.sh', '1300', self.head, self.live, 'piece-carry')
        self.assertIn('CARRIED 1300', out.stdout)
        self.assertEqual(out.returncode, 5, out.stdout + out.stderr)
        self.assertIn('the preflight refused', out.stdout)
        self.assertTrue((self.landing / 'carry-preflight.out').read_text())

    def test_a_refused_push_is_the_carrys_exit_and_leaves_the_spec_alone(self):
        hook = self.root / 'remote.git' / 'hooks' / 'pre-receive'
        hook.write_text('#!/bin/sh\necho refused by the stand-in remote\nexit 1\n')
        hook.chmod(0o755)
        before = (self.landing / 'SPEC.json').read_text()
        out = self.run_kit('carry_ordinary.sh', '1300', self.head, self.live, 'piece-carry')
        self.assertEqual(out.returncode, 4, out.stdout + out.stderr)
        self.assertIn('was refused', out.stdout)
        self.assertEqual((self.landing / 'SPEC.json').read_text(), before)


class Execution(Seat):
    def events(self, name, rows):
        path = self.root / name
        path.write_text(''.join(json.dumps({'file': row[0], 'names': row[1], 'occurrence': row[3] if len(row) > 3 else 1,
                                            'status': row[2]}) + '\n' for row in rows))
        return path

    def compare(self, carry_rows, named=None):
        live = self.events('live.jsonl', [('tests/a.test.mjs', 'one', 'pass'), ('tests/a.test.mjs', 'two', 'pass')])
        carry = self.events('carry.jsonl', carry_rows)
        if named is None:
            return self.run_kit('execution_compare.py', carry, live)
        spec = self.root / 'SPEC.json'
        spec.write_text(json.dumps({'execution_changes': named}))
        return self.run_kit('execution_compare.py', carry, live, spec)

    def test_a_case_that_still_runs_passes(self):
        self.assertEqual(self.compare([('tests/a.test.mjs', 'one', 'pass'), ('tests/a.test.mjs', 'two', 'fail')]).returncode, 0)

    def test_a_passing_case_turned_skip_without_a_failing_name_refuses(self):
        out = self.compare([('tests/a.test.mjs', 'one', 'pass'), ('tests/a.test.mjs', 'two', 'skip')])
        self.assertEqual(out.returncode, 5)
        self.assertIn('tests/a.test.mjs :: two -> skip', out.stdout)

    def test_a_passing_case_gone_from_the_carry_refuses(self):
        out = self.compare([('tests/a.test.mjs', 'one', 'pass')])
        self.assertEqual(out.returncode, 5)
        self.assertIn('two -> gone', out.stdout)

    def test_a_case_the_spec_names_with_its_reason_is_listed_and_passes(self):
        out = self.compare([('tests/a.test.mjs', 'one', 'pass')],
                           named=[{'file': 'tests/a.test.mjs', 'names': 'two', 'why': 'retired with the old menu'}])
        self.assertEqual(out.returncode, 0, out.stdout)
        self.assertIn('tests/a.test.mjs :: two -> gone (retired with the old menu)', out.stdout)

    def test_a_reason_covers_only_the_case_it_names(self):
        out = self.compare([('tests/a.test.mjs', 'one', 'skip'), ('tests/a.test.mjs', 'two', 'skip')],
                           named=[{'file': 'tests/a.test.mjs', 'names': 'two', 'why': 'retired with the old menu'}])
        self.assertEqual(out.returncode, 5)
        self.assertIn('tests/a.test.mjs :: one -> skip', out.stdout)

    def test_an_entry_naming_its_case_as_a_list_refuses_with_the_shape(self):
        out = self.compare([('tests/a.test.mjs', 'one', 'pass')], named=[{'file': 'tests/a.test.mjs', 'names': ['two'], 'why': 'on purpose'}])
        self.assertEqual(out.returncode, 2, out.stdout)
        self.assertIn('each one non-empty string', out.stdout)

    def test_an_entry_without_a_reason_refuses(self):
        out = self.compare([('tests/a.test.mjs', 'one', 'pass')], named=[{'file': 'tests/a.test.mjs', 'names': 'two', 'why': ' '}])
        self.assertEqual(out.returncode, 2)

    def test_a_reason_for_a_repeated_name_covers_only_the_occurrence_it_names(self):
        live = self.events('live.jsonl', [('tests/a.test.mjs', 'dup', 'pass', 1), ('tests/a.test.mjs', 'dup', 'pass', 2)])
        carry = self.events('carry.jsonl', [('tests/a.test.mjs', 'dup', 'pass', 1), ('tests/a.test.mjs', 'dup', 'skip', 2)])
        spec = self.root / 'SPEC.json'

        def with_entry(**fields):
            spec.write_text(json.dumps({'execution_changes': [dict({'file': 'tests/a.test.mjs', 'names': 'dup', 'why': 'on purpose'}, **fields)]}))
            return self.run_kit('execution_compare.py', carry, live, spec)
        ambiguous = with_entry()
        self.assertEqual(ambiguous.returncode, 2, ambiguous.stdout)
        self.assertIn('names no occurrence', ambiguous.stdout)
        other = with_entry(occurrence=1)
        self.assertEqual(other.returncode, 5, other.stdout)
        self.assertIn('tests/a.test.mjs :: dup #2 -> skip', other.stdout)
        exact = with_entry(occurrence=2)
        self.assertEqual(exact.returncode, 0, exact.stdout)
        self.assertIn('dup #2 -> skip (on purpose)', exact.stdout)

    def test_the_reporter_names_each_case_with_its_file_and_how_it_ended(self):
        tests = self.root / 'tree' / 'tests'
        tests.mkdir(parents=True)
        (tests / 'a.test.mjs').write_text("import test from 'node:test';\ntest('runs', () => {});\n"
                                          "test('skipped', { skip: true }, () => {});\n"
                                          "test('outer', async (t) => { await t.test('inner', () => {}); });\n")
        events = self.root / 'events.jsonl'
        subprocess.run(['node', '--test', '--test-reporter=' + str(self.kit / 'node_reporter.mjs'),
                        '--test-reporter-destination=' + str(events), 'tests/a.test.mjs'], cwd=self.root / 'tree', check=True)
        got = {(e['file'], e['names'], e['status']) for e in map(json.loads, events.read_text().splitlines())}
        self.assertEqual(got, {('tests/a.test.mjs', 'runs', 'pass'), ('tests/a.test.mjs', 'skipped', 'skip'),
                               ('tests/a.test.mjs', 'outer > inner', 'pass'), ('tests/a.test.mjs', 'outer', 'pass')})


class NodeSuite(Seat):
    """node_suite_check.sh on two trees of one repository: live, and a carry that changes lib/flag.mjs."""

    SUITE = ("import test from 'node:test';\nimport { ready } from '../lib/flag.mjs';\n"
             "for (let i = 0; i < 1000; i++) test('case ' + i, () => {});\n"
             "test('needs the flag', { skip: !ready }, () => {});\n")

    def trees(self, carry_flag, carry_suite=None):
        live = self.root / 'livetree'
        (live / 'tests').mkdir(parents=True)
        (live / 'lib').mkdir()
        (live / 'tests' / 'a.test.mjs').write_text(self.SUITE)
        (live / 'lib' / 'flag.mjs').write_text('export const ready = true;\n')
        subprocess.run(['git', 'init', '-q', str(live)], check=True)
        git(live, 'add', '.'); git(live, 'commit', '-q', '-m', 'live')
        carry = self.root / 'carrytree'
        git(live, 'worktree', 'add', '-q', '--detach', str(carry))
        (carry / 'lib' / 'flag.mjs').write_text('export const ready = %s; // as the carry has it\n' % carry_flag)
        if carry_suite:
            (carry / 'tests' / 'a.test.mjs').write_text(carry_suite)
        git(carry, 'commit', '-q', '-am', 'carry')
        return carry, live

    def check(self, carry, live, named=()):
        spec = self.root / 'SPEC.json'
        spec.write_text(json.dumps({'execution_changes': list(named)}))
        return self.run_kit('node_suite_check.sh', carry, live, self.root / 'out', spec)

    def test_a_case_the_carry_skips_from_outside_its_file_refuses(self):
        out = self.check(*self.trees('false'))
        self.assertEqual(out.returncode, 5, out.stdout + out.stderr)
        self.assertIn('tests/a.test.mjs :: needs the flag -> skip', out.stdout)

    def test_a_carry_that_keeps_every_case_running_passes(self):
        out = self.check(*self.trees('true'))
        self.assertEqual(out.returncode, 0, out.stdout + out.stderr)
        self.assertIn('every case that passed on live runs on the carry', out.stdout)

    def test_an_edit_to_the_test_file_does_not_excuse_a_skip(self):
        out = self.check(*self.trees('false', self.SUITE + '// the carry edits this file\n'))
        self.assertEqual(out.returncode, 5, out.stdout + out.stderr)
        self.assertIn('tests/a.test.mjs :: needs the flag -> skip', out.stdout)

    def test_a_skip_the_spec_names_with_its_reason_passes(self):
        out = self.check(*self.trees('false'), named=[{'file': 'tests/a.test.mjs', 'names': 'needs the flag', 'why': 'the flag is off until 1300'}])
        self.assertEqual(out.returncode, 0, out.stdout + out.stderr)
        self.assertIn('needs the flag -> skip (the flag is off until 1300)', out.stdout)


STUB_CLI = r"""
import json, os, sys
state = os.path.join(os.environ['STUB_DIR'], 'ledger.json')
ledger = json.load(open(state)) if os.path.exists(state) else {'posts': {}, 'messages': []}
args = [a for a in sys.argv[1:] if a not in ('--json',)]
args = args[2:] if args[:1] == ['--profile'] else args
if args[0] == 'releases':
    print('release 10  def5678  2026-11-24T09:41:05-08:00  shipped 1301')
    print('release 9  abc1234  2026-11-24T09:31:05-08:00  shipped 1300')
elif args[0] == 'post':
    operation = args[args.index('--operation') + 1] if '--operation' in args else 'fresh-%d' % len(ledger['posts'])
    body = sys.stdin.read()
    if operation not in ledger['posts']:
        seq = 1001 + len(ledger['messages'])
        ledger['messages'].append({'id': 'm-%032x' % seq, 'seq': seq, 'topic_id': args[1], 'author_id': os.environ.get('STUB_AUTHOR', 'tester'),
                                   'body': os.environ.get('STUB_STORED_BODY', body), 'withheld': bool(os.environ.get('STUB_WITHHELD'))})
        ledger['posts'][operation] = {'id': 'm-%032x' % seq, 'body': body}
        json.dump(ledger, open(state, 'w'))
        if os.environ.get('STUB_LOSE_ANSWER'):
            sys.exit(1)
    elif ledger['posts'][operation]['body'] != body:
        print('rejected OPERATION_PAYLOAD_MISMATCH'); sys.exit(1)
    print('posted %s in %s' % (ledger['posts'][operation]['id'], args[1]))
elif args[0] == 'read':
    after = int(args[args.index('--after') + 1]) if '--after' in args else 0
    limit = int(args[args.index('--limit') + 1]) if '--limit' in args else 50
    page = [m for m in ledger['messages'] if m['topic_id'] == args[1] and m['seq'] > after][:limit]
    print(json.dumps({'topic': {'id': args[1]}}))
    print(json.dumps({'items': [dict(m, preview=False, sent_ms=1) for m in page], 'next_cursor': page[-1]['seq'] if page else None}))
"""


class Publication(Seat):
    DOSSIER = 'Release NNN is live: a thing.\n\nEvidence: read.\n'

    def setUp(self):
        super().setUp()
        (Path(self.settings['live']) / 'bin' / 'aim-next').write_text(STUB_CLI)
        self.env['STUB_DIR'] = str(self.root)
        self.posts_dir = Path(self.settings['posts'])
        (self.posts_dir / 'dossier-1300.txt').write_text(self.DOSSIER)

    def ledger(self):
        return json.loads((self.root / 'ledger.json').read_text())

    def post(self, release='9', item='1300', **env):
        self.env.update(env)
        out = self.run_kit('post_dossier.sh', release, item)
        for key in env:
            del self.env[key]
        return out

    def test_a_post_whose_answer_was_lost_is_finished_without_a_second_post(self):
        first = self.post(STUB_LOSE_ANSWER='1')
        self.assertNotEqual(first.returncode, 0)
        self.assertEqual(len(self.ledger()['posts']), 1)
        self.assertFalse((self.posts_dir / 'release-9.id').exists())
        second = self.post()
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
        self.assertEqual(len(self.ledger()['messages']), 1)
        self.assertIn('seq 1001 in t-1, read back', (self.posts_dir / 'release-9.id').read_text())

    def test_an_older_release_recovers_after_a_later_one_published(self):
        (self.posts_dir / 'dossier-1301.txt').write_text('Release NNN is live: the next thing.\n\nEvidence: read.\n')
        self.assertNotEqual(self.post(STUB_LOSE_ANSWER='1').returncode, 0)
        later = self.post('10', '1301')
        self.assertEqual(later.returncode, 0, later.stdout + later.stderr)
        self.assertIn('seq 1002 in t-1, read back', (self.posts_dir / 'release-10.id').read_text())
        for attempt in ('recovery', 'rerun'):
            out = self.post()
            self.assertEqual(out.returncode, 0, attempt + ': ' + out.stdout + out.stderr)
            self.assertIn('seq 1001 in t-1, read back', (self.posts_dir / 'release-9.id').read_text(), attempt)
        self.assertEqual(len(self.ledger()['messages']), 2)

    def test_a_rerun_sends_the_saved_request_not_a_dossier_edited_since(self):
        self.assertEqual(self.post().returncode, 0)
        (self.posts_dir / 'dossier-1300.txt').write_text('Release NNN is live: another thing.\n')
        again = self.post()
        self.assertEqual(again.returncode, 0, again.stdout + again.stderr)
        self.assertEqual(len(self.ledger()['messages']), 1)
        self.assertEqual(self.ledger()['messages'][0]['body'], self.DOSSIER.replace('NNN', '9'))

    def test_a_different_request_under_the_same_operation_is_refused(self):
        self.post(STUB_LOSE_ANSWER='1')
        (self.posts_dir / 'release-9.post.txt').write_text('Release 9 is live: something else.\n')
        out = self.post()
        self.assertNotEqual(out.returncode, 0)
        self.assertEqual(len(self.ledger()['messages']), 1)
        self.assertFalse((self.posts_dir / 'release-9.id').exists())

    def test_a_post_beyond_the_first_page_of_the_topic_reads_back(self):
        others = [{'id': 'm-other%d' % i, 'seq': i + 1, 'topic_id': 't-1', 'author_id': 'fable', 'body': 'x', 'withheld': False} for i in range(120)]
        (self.root / 'ledger.json').write_text(json.dumps({'posts': {}, 'messages': others}))
        out = self.post()
        self.assertEqual(out.returncode, 0, out.stdout + out.stderr)
        self.assertIn('seq 1121 in t-1, read back', (self.posts_dir / 'release-9.id').read_text())

    def test_a_post_that_reads_back_with_another_body_author_or_withheld_refuses(self):
        for env, what in (({'STUB_STORED_BODY': 'Release 9 is live: a thing.\n\nEvidence: other.\n'}, 'body'),
                          ({'STUB_AUTHOR': 'fable'}, 'author'), ({'STUB_WITHHELD': '1'}, 'readable body')):
            (self.root / 'ledger.json').unlink(missing_ok=True)
            (self.posts_dir / 'release-9.post.txt').unlink(missing_ok=True)
            out = self.post(**env)
            self.assertNotEqual(out.returncode, 0, what)
            self.assertIn(what, out.stdout)
            self.assertFalse((self.posts_dir / 'release-9.id').exists(), what)

    def test_the_card_states_when_the_release_went_live_not_when_it_was_published(self):
        self.assertEqual(cards_add.live_time('release 9  abc1234  2026-11-24T09:31:05-08:00  shipped 1300', 9), '9:31 AM')
        with self.assertRaises(SystemExit):
            cards_add.live_time('release 8  abc1234  2026-11-24T09:31:05-08:00  shipped 1299', 9)


class MessageRead(unittest.TestCase):
    def test_a_short_message_is_read_from_its_row(self):
        rows = [{'topic': {}}, {'items': [{'id': 'm-1', 'topic_id': 't', 'seq': 7, 'author_id': 'fable', 'body': 'whole', 'sent_ms': 5,
                                           'preview': False}]}]
        self.assertEqual(decisions.message_from_read(rows, 'm-1'), {'id': 'm-1', 'topic_id': 't', 'seq': 7, 'author_id': 'fable',
                                                                    'sent_ms': 5, 'withheld': False, 'body': 'whole'})

    def test_a_previewed_message_is_read_whole_from_its_source(self):
        rows = [{'topic': {}}, {'items': [{'id': 'm-1', 'topic_id': 't', 'seq': 7, 'author_id': 'fable', 'body': 'cut', 'sent_ms': 5, 'preview': True}]},
                {'source_ref': {'kind': 'message', 'id': 'm-1'}, 'topic_id': 't', 'author': 'fable', 'body': 'cut and the rest ' + CARRY, 'sent_ms': 5}]
        message = decisions.message_from_read(rows, 'm-1')
        self.assertEqual((message['author_id'], message['seq'], message['body']), ('fable', 7, 'cut and the rest ' + CARRY))
        spec = dict(Proof.SPEC, carry_read={'topic': 't', 'seq': 5, 'id': 'm-1'})
        self.assertIn('the carry read by fable', decisions.proof(spec, {}, message))

    def test_a_preview_without_its_source_or_a_withheld_message_proves_nothing(self):
        rows = [{'items': [{'id': 'm-1', 'author_id': 'fable', 'body': 'cut', 'sent_ms': 5, 'preview': True}]}]
        self.assertIsNone(decisions.message_from_read(rows, 'm-1'))
        rows = [{'items': [{'id': 'm-1', 'author_id': 'fable', 'body': CARRY, 'sent_ms': 5, 'withheld': True}]}]
        message = decisions.message_from_read(rows, 'm-1')
        self.assertEqual((message['withheld'], message['body']), (True, ''))


TAP = """TAP version 13
not ok 1 - a test
  ---
  duration_ms: {ms}
  failureType: 'testCodeFailure'
  error: |-
    {message}
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  ...
1..1
"""


class CauseCompare(Seat):
    def compare(self, carry, live):
        (self.root / 'carry.tap').write_text(TAP.format(ms=1.5, message=carry))
        (self.root / 'live.tap').write_text(TAP.format(ms=9.25, message=live))
        return self.run_kit('cause_compare.py', self.root / 'carry.tap', self.root / 'live.tap').returncode

    def test_a_shared_failure_with_the_same_cause_passes(self):
        self.assertEqual(self.compare('expected 1 to equal 2', 'expected 1 to equal 2'), 0)

    def test_a_shared_failure_with_a_changed_cause_refuses(self):
        self.assertEqual(self.compare('expected 1 to equal 2', 'cannot read property x of undefined'), 4)


class Cards(unittest.TestCase):
    PAGE = '# Cards\n\n## Now\n\n### 1 · one\n\n## Done\n\n### 2 · two\n\n## TEAM SCRATCH\n\nnotes\n'

    def test_a_card_goes_at_the_top_of_done_and_the_scratch_is_untouched(self):
        new = cards_add.insert(self.PAGE, '### 3 · three\n')
        self.assertIn('## Done\n\n### 3 · three\n\n### 2 · two', new)
        self.assertEqual(cards_add.scratch(new), cards_add.scratch(self.PAGE))

    def test_a_page_without_done_refuses(self):
        with self.assertRaises(SystemExit):
            cards_add.insert('# Cards\n', '### 3 · three\n')


def answers(*pairs):
    calls = []

    def run(argv, **kwargs):
        calls.append(argv[-1])
        code, state = pairs[len(calls) - 1]
        return subprocess.CompletedProcess(argv, code, '{"state": "%s"}\n' % state if state else 'Traceback\n', '')
    return run, calls


class RunnerVisible(unittest.TestCase):
    def test_visible_passes_after_the_kits_own_check(self):
        run, calls = answers((0, 'VISIBLE'), (0, 'VISIBLE'))
        self.assertEqual(runner_visible.ensure('/x', run)['check'], 'VISIBLE')
        self.assertEqual(calls, [str(KIT / 'normalize_runner.py'), '--check'])

    def test_anything_but_a_visible_check_stops(self):
        for pairs in (((0, 'SWAPPED'), (3, 'RESUMED')), ((2, 'REFUSED'), (2, 'REFUSED')),
                      ((0, 'VISIBLE'), (2, 'VISIBLE')), ((0, 'VISIBLE'), (0, None))):
            run, _ = answers(*pairs)
            with self.assertRaises(runner_visible.NotVisible):
                runner_visible.ensure('/x', run)

    def test_the_hold_is_removed_after_and_on_error_and_an_existing_one_stays(self):
        with tempfile.TemporaryDirectory() as d:
            with runner_visible.hold(d):
                self.assertTrue((Path(d) / '.runner-hold').exists())
            self.assertFalse((Path(d) / '.runner-hold').exists())
            with self.assertRaises(ValueError):
                with runner_visible.hold(d):
                    raise ValueError
            self.assertFalse((Path(d) / '.runner-hold').exists())
            (Path(d) / '.runner-hold').touch()
            with runner_visible.hold(d):
                pass
            self.assertTrue((Path(d) / '.runner-hold').exists())


if __name__ == '__main__':
    unittest.main()
