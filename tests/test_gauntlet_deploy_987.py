from __future__ import annotations

"""Exercise the actual deploy's second admission, with isolated host effects."""
import json
import subprocess
import unittest
from unittest import mock

from tools import deploy
import test_tools_deploy as fixture


class DeployBoundary987(fixture.DeployCase):
    def test_987_blocker_arriving_after_runner_policy_stops_actual_deploy(self):
        self.config=self.config._replace(pipeline_outcome='w-scratch',pipeline_instance='scratch',
            pipeline_broker=self.instance/'scratch.sock')
        ordinary={'id':'p-42','items':[42],'freeze':None,'version':1,'stage':{'stage_id':'wait'}}
        state={'blocked':False,'reads':0}
        fake=fixture.FakeHost(self.config,changed=['tools/deploy.py'])
        def host(argv,**kw):
            if argv[0]=='git' and '--format=%(trailers:key=Pipeline,valueonly,separator=%x1d)' in argv:
                return subprocess.CompletedProcess(argv,0,'987\n','')
            if argv[-1:] == ['binding']:
                return subprocess.CompletedProcess(argv,0,json.dumps({'binding':{'instance_id':'scratch'}}),'')
            if argv[-2:] == ['view','-']:
                state['reads']+=1
                page={'instance_id':'scratch','workspace_id':'w-scratch','relevant_versions':{'pipeline':1},
                    'pipeline':{'enabled':True,'ships_in_releases':True},'items':[],
                    'pieces':[ordinary] if state['blocked'] else [],
                    'facts':{'approved_waiting':[42] if state['blocked'] else []},'next_cursor':None}
                return subprocess.CompletedProcess(argv,0,json.dumps(page),'')
            return fake(argv,**kw)
        def policy(*args):
            state['blocked']=True
            return {'kind':'restart','reason':'synthetic boundary'}
        with mock.patch.object(deploy,'runner_policy',side_effect=policy):
            with self.assertRaisesRegex(deploy.Refused,'p-42'):self.deploy(host,dry=True)
        self.assertEqual(state['reads'],2)
        self.assertEqual(self.kills,[])
        self.assertFalse(any(a[0]=='git' and 'merge' in a for a in fake.calls))
        self.assertEqual(fake.written,[])
        self.assertFalse((self.evidence/'02-checks.json').exists())


def load_tests(loader,tests,pattern):
    return unittest.TestSuite([DeployBoundary987('test_987_blocker_arriving_after_runner_policy_stops_actual_deploy')])
