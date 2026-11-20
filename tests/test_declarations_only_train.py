from __future__ import annotations
import json
import subprocess
from tools import train
import test_tools_train as trains

PATH = 'tools/ci-input-reads.json'
OLD = 'a' * 64
NEW = 'b' * 64
DECL = {'inputs': [], 'scope': 'generated/system/product'}

class DeclarationsOnly(trains.TrainCase):
    def setUp(self):
        super().setUp()
        self.before = {'tests/old.py': {OLD: DECL}}
        self.write(PATH, json.dumps(self.before, indent=2) + '\n')
        self.write('tests/old.py', '# existing fixture\n')
        self.L = self.commit('Existing declarations')
        self.git(self.work, 'push', '-q', 'origin', 'HEAD:refs/heads/' + trains.BRANCH)
        self.git(self.live, 'fetch', '-q', 'origin')
        self.git(self.live, 'merge', '-q', '--ff-only', self.L)

    def candidate(self, after, extra=()):
        raw = after if isinstance(after, str) else json.dumps(after, indent=2) + '\n'
        head = self.branch('candidate', self.L, [(PATH, raw), ('tests/new.py', '# new fixture\n')] + list(extra))
        merged = self.merge(head)
        return head, merged, self.train(merged, [head])

    def added(self):
        return dict(self.before, **{'tests/new.py': {NEW: DECL}})

    def test_additions_take_ordinary_path_and_keep_audit_in_release_record(self):
        head, merged, record = self.candidate(self.added())
        data = json.loads(record.read_text());data['items'][0]['review'] = 'm-warp-audit; exact carry own checks 471 Node and 61 Python passed'
        record.write_text(json.dumps(data))
        self.trained(self.host(), record, merged, self.hub())
        observed = self.evidence_of('00-train')
        self.assertEqual(observed['guarded_changes'], [])
        self.assertEqual(observed['input_declaration_additions'], [{'test': 'tests/new.py', 'signature': NEW, **DECL}])
        self.assertEqual(observed['items'][0]['review'], data['items'][0]['review'])
        self.assertEqual(observed['judgment'], 'pending')

    def test_modification_of_existing_declaration_stays_judged_first(self):
        after = self.added();after['tests/old.py'] = {OLD: {'inputs': ['README'], 'scope': 'repository'}}
        _, merged, record = self.candidate(after)
        self.refused_train(record, merged, self.hub(), 'an ordinary train cannot change ' + PATH)

    def test_removal_of_existing_declaration_stays_judged_first(self):
        _, merged, record = self.candidate({'tests/new.py': {NEW: DECL}})
        self.refused_train(record, merged, self.hub(), 'an ordinary train cannot change ' + PATH)

    def test_reformatted_old_lines_are_not_an_additive_change(self):
        _, merged, record = self.candidate(json.dumps(self.added(), indent=4) + '\n')
        self.refused_train(record, merged, self.hub(), 'an ordinary train cannot change ' + PATH)

    def test_duplicate_json_key_cannot_hide_an_existing_declaration_change(self):
        raw = json.dumps(self.before, indent=2)[:-2] + ',\n  "tests/old.py": {},\n  "tests/new.py": ' + json.dumps({NEW: DECL}) + '\n}\n'
        _, merged, record = self.candidate(raw)
        self.refused_train(record, merged, self.hub(), 'an ordinary train cannot change ' + PATH)

    def test_migration_beside_valid_additions_still_refuses(self):
        _, merged, record = self.candidate(self.added(), [('aim_next/migrations.py', '# migration\n')])
        self.refused_train(record, merged, self.hub(), 'an ordinary train cannot change aim_next/migrations.py')

    def test_guard_code_beside_valid_additions_still_refuses(self):
        _, merged, record = self.candidate(self.added(), [('tools/train.py', '# guard\n')])
        self.refused_train(record, merged, self.hub(), 'an ordinary train cannot change tools/train.py')

    def test_missing_declared_input_is_not_admitted(self):
        after = self.added();after['tests/new.py'][NEW] = {'inputs': ['not-tracked'], 'scope': 'repository'}
        _, merged, record = self.candidate(after)
        self.refused_train(record, merged, self.hub(), 'an ordinary train cannot change ' + PATH)

    def test_line_ending_rewrite_is_not_hidden_by_text_mode_git(self):
        raw = (json.dumps(self.added(), indent=2) + '\n').replace('\n', '\r\n')
        _, merged, record = self.candidate(raw)
        self.refused_train(record, merged, self.hub(), 'an ordinary train cannot change ' + PATH)

    def test_valid_addition_to_existing_test_keeps_prior_signature(self):
        after = {'tests/old.py': {OLD: DECL, NEW: DECL}}
        _, merged, record = self.candidate(after)
        self.trained(self.host(), record, merged, self.hub())
        self.assertEqual(self.evidence_of('00-train')['input_declaration_additions'][0]['signature'], NEW)

    def test_declaration_for_missing_test_is_not_admitted(self):
        after = dict(self.before, **{'tests/missing.py': {NEW: DECL}})
        _, merged, record = self.candidate(after)
        self.refused_train(record, merged, self.hub(), 'an ordinary train cannot change ' + PATH)

    def test_failed_declaration_read_never_grants_the_exception(self):
        _, merged, record = self.candidate(self.added())
        def git(*args):
            if args[0] == 'show':
                return subprocess.CompletedProcess(args, 128, '', 'unavailable')
            return subprocess.run(['git', '-C', str(self.live)] + list(args), capture_output=True, text=True)
        with self.assertRaisesRegex(train.Refused, 'an ordinary train cannot change ' + PATH):
            train.judge(record, merged, self.L, trains.BRANCH, trains.REPOSITORY, git, self.hub())
