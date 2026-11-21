from __future__ import annotations

"""The real CLI binder reads Git, publishes through Core and shares its record."""
import json
from pathlib import Path
import subprocess
import unittest

from aim_next.judgment import source_diff, guarded
from aim_next.profile import write_profile
from test_gauntlet_987 import Freeze987

ROOT = Path(__file__).resolve().parents[1]


class Binder987(Freeze987):
    def setUp(self):
        super().setUp()
        self.repo = Path(self.temp.name) / 'source'
        self.repo.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.email', 'scratch987@example.invalid')
        self.git('config', 'user.name', 'Scratch 987')
        (self.repo/'tools').mkdir()
        (self.repo/'tools/deploy.py').write_text('old source')
        self.base = self.commit()
        self.profile = Path(self.temp.name).resolve()/'binder.json'
        write_profile(self.profile,str(self.path.resolve()),'test-instance','agent-a',binding=self.binding)

    def git(self,*args):
        return subprocess.check_output(['git','-C',str(self.repo)]+list(args),text=True,stderr=subprocess.DEVNULL).strip()

    def commit(self):
        self.git('add','.');self.git('commit','-qm','Synthetic freeze source')
        return self.git('rev-parse','HEAD')

    def cli(self,piece,base,head):
        return subprocess.run(['/usr/bin/python3','-I','-B',str(ROOT/'bin/aim-next'),
            '--profile',str(self.profile),'--json','freeze',piece,'--repo',str(self.repo),
            '--base',base,'--head',head],capture_output=True,text=True)

    def test_987_binder_reads_renamed_guarded_old_path_and_publishes_same_record(self):
        (self.repo/'tools/deploy.py').rename(self.repo/'innocent.txt')
        head=self.commit()
        self.assertIn('tools/deploy.py',source_diff(self.repo,self.base,head))
        piece=self.piece([1])
        answer=self.cli(piece,self.base,head)
        self.assertEqual(answer.returncode,0,answer.stdout+answer.stderr)
        result=json.JSONDecoder().raw_decode(answer.stdout)[0]
        self.assertTrue(result['result']['freeze']['judged'])
        freeze=self.shown(piece)['freeze']
        self.assertEqual((freeze['base_commit'],freeze['head_commit'],freeze['by']), (self.base,head,'agent-a'))
        self.assertEqual(freeze['files'], ['innocent.txt','tools/deploy.py'])
        page=self.store.view('agent-b','pipeline',{'workspace_id':'w1'})
        self.assertEqual(next(p for p in page['pieces'] if p['id']==piece)['freeze'],freeze)

    def test_987_actual_deleted_path_and_classifier_dependency_are_guarded(self):
        (self.repo/'tools/deploy.py').unlink()
        head=self.commit()
        self.assertTrue(guarded(source_diff(self.repo,self.base,head)))
        self.assertEqual(guarded(['aim_next/judgment.py','tools/gauntlet_admission.py']),
                         ['aim_next/judgment.py','tools/gauntlet_admission.py'])
        self.assertFalse(guarded(['web/ordinary.mjs','docs/ordinary.md']))

    def test_987_foreign_commit_and_non_ancestor_refuse_without_a_record(self):
        piece=self.piece([1]);before=self.version(piece)
        rejected=self.cli(piece,self.base,'f'*40)
        self.assertNotEqual(rejected.returncode,0)
        self.assertEqual(self.version(piece),before)
        self.assertIsNone(self.shown(piece)['freeze'])
        (self.repo/'new').write_text('changed');head=self.commit()
        with self.assertRaises(ValueError):source_diff(self.repo,head,self.base)
        with self.assertRaises(ValueError):source_diff('relative',self.base,head)


def load_tests(loader,tests,pattern):
    return unittest.TestSuite(Binder987(name) for name in loader.getTestCaseNames(Binder987)
                              if name.startswith('test_987_') and name in Binder987.__dict__)
