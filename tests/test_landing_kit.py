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
