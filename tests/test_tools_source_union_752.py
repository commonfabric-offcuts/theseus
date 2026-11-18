from __future__ import annotations

"""Focused genuine-record controls; no source workload or independent approval."""
import copy
import json
import io
import zipfile
import os
from pathlib import Path
import tempfile
import unittest
from tools import train, base_move

E = Path(os.environ.get('SOURCE_UNION_752_EVIDENCE', '/Users/commonfabric/.local/share/theseus/fable-tools/checks/752-union9074'))


@unittest.skipUnless((E / 'AUDITOR-COMPLETE-UNION.json').is_file(), 'requires the retained exact auditor9067 bytes')
class SourceUnion752(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reference = {'path': str(E / 'AUDITOR-COMPLETE-UNION.json'), 'sha256': train.CARRY_752_UNION}
        cls.union, cls.records = train.carry_complete_union(cls.reference)
        cls.rows = cls.records['compose']['results']

    def tampered(self, value):
        tmp = tempfile.TemporaryDirectory(prefix='752-union-negative-')
        self.addCleanup(tmp.cleanup)
        p = Path(tmp.name) / 'changed.json';p.write_bytes(train.carry_canonical(value))
        return {'path': str(p), 'sha256': train.digest(p.read_bytes())}

    def test_exact_authorized_placing_preserves_two_reds_and_unexecuted_branches(self):
        result = train.carry_compose_authority(self.rows, self.reference)
        self.assertEqual(result['raw_reds'], self.records['compose']['failed'])
        self.assertEqual(len(result['unexecuted_branches']), 2)
        self.assertEqual(result['finding_owner_item'], 750)
        self.assertEqual(result['release_line_item'], 648)
        self.assertIn('unexecuted', result['qualification'])
        self.assertEqual(sum(r['passed'] for r in self.rows), 1508)

    def test_missing_placement_refuses(self):
        with self.assertRaisesRegex(train.Refused, 'separate independent placement'):
            train.carry_compose_authority(self.rows)

    def test_entire_independent_record_is_fixed_not_a_reviewer_label(self):
        changed = copy.deepcopy(self.union); changed['recorded_at'] += ' altered'
        with self.assertRaisesRegex(train.Refused, 'independent complete union differs'):
            train.carry_compose_authority(self.rows, self.tampered(changed))

    def test_wrong_seat_is_not_placement(self):
        changed = copy.deepcopy(self.union); changed['reviewer'] = 'fable'
        with self.assertRaisesRegex(train.Refused, 'independent complete union differs'):
            train.carry_compose_authority(self.rows, self.tampered(changed))

    def test_wrong_record_hash_refuses(self):
        with self.assertRaisesRegex(base_move.Refused, 'artifact digest'):
            train.carry_compose_authority(self.rows, dict(self.reference, sha256='0' * 64))

    def test_changed_base_refuses_even_with_correct_caller_digest(self):
        changed = copy.deepcopy(self.union);changed['target_head'] = train.CARRY_752_BASE
        with self.assertRaisesRegex(train.Refused, 'independent complete union differs'):
            train.carry_compose_authority(self.rows, self.tampered(changed))

    def test_changed_failure_body_refuses(self):
        rows = copy.deepcopy(self.rows);next(r for r in rows if r['passed'] is False)['error'] += '\na new failure'
        with self.assertRaisesRegex(train.Refused, 'cases/failure bodies differ'):
            train.carry_compose_authority(rows, self.reference)

    def test_omitted_raw_red_refuses(self):
        rows = [r for r in self.rows if r != self.records['compose']['failed'][0]]
        with self.assertRaisesRegex(train.Refused, 'cases/failure bodies differ'):
            train.carry_compose_authority(rows, self.reference)

    def test_extra_raw_red_refuses(self):
        with self.assertRaisesRegex(train.Refused, 'cases/failure bodies differ'):
            train.carry_compose_authority(self.rows + [{'name': 'new red', 'passed': False}], self.reference)

    def test_false_afterstate_claim_refuses(self):
        for key, value in [('passed', True), ('passed', 0), ('afterStateExecuted', True), ('expectedFailure', True)]:
            rows = copy.deepcopy(self.rows);next(r for r in rows if r['passed'] is False)[key] = value
            with self.subTest(key=key), self.assertRaisesRegex(train.Refused, 'cases/failure bodies differ'):
                train.carry_compose_authority(rows, self.reference)

    def test_replaced_base_reference_refuses(self):
        changed = copy.deepcopy(self.union)
        changed['references']['live97_raw_measurement']['sha256'] = 'a' * 64
        with self.assertRaisesRegex(train.Refused, 'independent complete union differs'):
            train.carry_compose_authority(self.rows, self.tampered(changed))

    def own(self, case=None):
        raw = train.carry_canonical({'results': self.rows})
        case = copy.deepcopy(case or next(r for r in self.rows if r['passed'] is True))
        receipt = {'compose_union': {'archive': 'new/native-compose', 'report_sha256': train.digest(raw), 'raw_case': case}}
        executions = {'native-compose': {'archive': 'new/native-compose'}}
        archives = {'new/native-compose': {'native/compose/native.json': raw}}
        engine, name = case['name'].split(' ', 1)
        expected = [('native-compose', name, case.get('phase'), engine)]
        return receipt, executions, archives, expected

    def test_genuine_own_row_requires_exact_raw_source_and_obligation(self):
        args = self.own();self.assertEqual(train.carry_compose_own(*args), args[3])
        for change in ('hash', 'archive', 'case', 'obligation'):
            receipt, executions, archives, expected = copy.deepcopy(args)
            if change == 'hash':receipt['compose_union']['report_sha256'] = 'a' * 64
            elif change == 'archive':receipt['compose_union']['archive'] = 'original/check-3'
            elif change == 'case':receipt['compose_union']['raw_case']['afterStateExecuted'] = True
            else:expected = []
            with self.subTest(change=change), self.assertRaises(train.Refused):
                train.carry_compose_own(receipt, executions, archives, expected)

    def test_qualified_false_rows_cannot_fulfill_own_obligations(self):
        for case in self.records['compose']['failed']:
            with self.subTest(case=case['name']), self.assertRaisesRegex(train.Refused, 'did not pass'):
                train.carry_compose_own(*self.own(case))

    def test_controller_member_inventory_includes_original_failure_and_publication(self):
        if not (E / 'COMPLETE-ENVELOPE.json').is_file():
            self.skipTest('requires assembled original controller artifacts')
        body = json.loads((E / 'COMPLETE-ENVELOPE.json').read_bytes())
        inventory = train.carry_controller_inventory(body['controller'])
        self.assertIn('check-run.json', inventory['verdict_artifact'])
        self.assertIn('producer.json', inventory['verdict_artifact'])
        self.assertEqual(set(inventory['published_artifact']), {'published.json'})
        with zipfile.ZipFile(body['controller']['verdict_artifact']['archive']['path']) as archive:
            raw = archive.read('check-run.json')
            self.assertEqual(inventory['verdict_artifact']['check-run.json'], train.digest(raw))
            self.assertEqual(json.loads(raw)['conclusion'], 'failure')

    def test_controller_member_path_and_duplicate_refuse(self):
        for names in [('../escape',), ('same', 'same')]:
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, 'w') as archive:
                for name in names:
                    archive.writestr(name, b'explicit negative control')
            reference = self.tampered({})
            p = Path(reference['path']);p.write_bytes(stream.getvalue())
            reference['sha256'] = train.digest(p.read_bytes())
            controller = {key: {'archive': reference} for key in ('verdict_artifact', 'published_artifact')}
            with self.subTest(names=names), self.assertRaises((base_move.Refused, train.Refused)):
                train.carry_controller_inventory(controller)

    def test_complete_body_is_still_not_independent_final_approval(self):
        data = {'review': None}
        with self.assertRaisesRegex(train.Refused, 'independent final source/body review pending'):
            train.carry_review(data, {'audit': 'builder'})


if __name__ == '__main__':
    unittest.main()
