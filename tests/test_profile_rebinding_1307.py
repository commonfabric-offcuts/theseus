from __future__ import annotations

import copy
import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import uuid

from aim_next import initialize, Store
from aim_next.profile import load_profile, write_profile
from aim_next.profile_rebinding import stage
from aim_next.recovery_io import RecoveryError


class RebindingCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='rebind1307-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.db = self.root/'data.sqlite3'
        self.binding = initialize(self.db, 'rebind-fixture', [
            {'id':'runner','kind':'human'}, {'id':'agent','kind':'agent'},
            {'id':'other','kind':'agent'}], authority_path=self.root/'authority.json')['binding']
        self.profiles = {}
        for actor in ('runner','agent','other'):
            p = self.root/(actor+'.json')
            write_profile(p, self.db, 'rebind-fixture', actor, binding=self.binding)
            self.profiles[actor] = str(p)
        self.home = self.root/'codex-home'
        self.home.mkdir(mode=0o700)
        self.destination = dict(kind='codex-queue-stdio',protocol_version=1,
            codex_home=str(self.home),thread_id=str(uuid.uuid4()))
        self.store = Store(self.db, 'rebind-fixture', expected_binding=self.binding)
        with self.store.runner_guard('fixture-provision') as guard:
            self.store.provision_route_pin(guard, 'agent', self.destination)
        self.config = self.save('broker.json', dict(v=1,profile=self.profiles['agent'],
            codex_executable='/usr/bin/python3',destination=self.destination))
        self.route = self.save('route.json', dict(v=1,profile=self.profiles['agent'],
            argv=['/usr/bin/python3','--config',str(self.config)]))
        self.mapping = self.save('map.json', dict(v=1,routes={'agent':str(self.route)}))
        self.activation = dict(activation_id=str(uuid.uuid4()), opaque_request={'fixture':True})
        self.activation_path = self.save('activation.json', self.activation)
        self.handoff = self.save('handoff.json', {'fixture':'durable-retirement'})
        self.result = dict(v=1,status='activated',durability_confirmed=True,
            activation_id=self.activation['activation_id'],request_digest='1'*64,
            handoff_id=str(uuid.uuid4()),
            source_handoff_digest=hashlib.sha256(self.handoff.read_bytes()).hexdigest(),
            bundle_digest='2'*64,destination_identity_digest='3'*64,
            source_commit={'commit_seq':0,'commit_id':'fixture-exact-commit'},
            history_complete=False,
            binding=dict(self.binding,instance_id='rebind-fixture',db_path=str(self.db)))
        self.result_path = self.save('confirmed.json', self.result)
        self.request = dict(v=1,staging_id=str(uuid.uuid4()),control_path=str(self.root/'control'),
            activation_request_path=str(self.activation_path),confirmed_result_path=str(self.result_path),
            source_handoff_path=str(self.handoff),profiles=self.profiles,runner_actor='runner',
            route_map_path=str(self.mapping),broker_executable='/usr/bin/python3',
            states={a:dict(enabled=True,stopped=False,blocked=None) for a in self.profiles})
        outbox = self.root/'agent.outbox'
        outbox.mkdir(mode=0o700)
        self.old_request = self.save('agent.outbox/old.request.json', {'binding':'old','operation_id':'retained'})
        self.before = {p:str(hashlib.sha256(Path(p).read_bytes()).hexdigest())
                      for p in self.profiles.values()}
        self.calls = []

    def save(self, name, value):
        p = self.root/name
        p.write_text(json.dumps(value))
        p.chmod(0o600)
        return p

    def confirm(self, request):
        self.assertEqual(request, self.activation)
        self.calls.append(copy.deepcopy(request))
        return copy.deepcopy(self.result)

    def run_stage(self, **kwargs):
        return stage(self.request, confirm=kwargs.pop('confirm',self.confirm), **kwargs)

    def target(self, path):
        return Path(str(path)+'.rebind-'+self.request['staging_id'])

    def test_real_profiles_routes_and_outbox_survive_without_database_write_or_spawn(self):
        before_db = self.db.read_bytes()
        old = self.old_request.read_bytes()
        with mock.patch('subprocess.Popen',side_effect=AssertionError('no consumer start')):
            answer = self.run_stage()
        self.assertEqual(answer['status'],'staged')
        self.assertTrue(answer['routes_ready'])
        profile = load_profile(self.target(self.profiles['agent']))
        self.assertEqual(profile.actor_id,'agent')
        self.assertEqual(profile.binding,self.binding)
        self.assertEqual(profile.db_path,self.db)
        self.assertEqual(self.target(self.profiles['agent']).parent,self.root)
        route = json.loads(self.target(self.route).read_text())
        self.assertEqual(route['profile'],str(self.target(self.profiles['agent'])))
        self.assertEqual(route['argv'][2],str(self.target(self.config)))
        mapping = json.loads(self.target(self.mapping).read_text())
        self.assertEqual(mapping['routes']['agent'],str(self.target(self.route)))
        self.assertEqual(self.old_request.read_bytes(),old)
        self.assertEqual(self.db.read_bytes(),before_db)
        self.assertEqual(self.calls,[self.activation])
        self.assertFalse(answer['history_complete'])
        for p,sha in self.before.items():
            self.assertEqual(hashlib.sha256(Path(p).read_bytes()).hexdigest(),sha)

    def test_each_confirmation_field_mismatch_stops_before_profile_creation(self):
        for key in self.result:
            with self.subTest(key=key):
                bad = copy.deepcopy(self.result)
                bad[key] = None
                with self.assertRaises(RecoveryError):
                    self.run_stage(confirm=lambda request:bad)
                self.assertFalse(self.target(self.profiles['agent']).exists())

    def test_expected_observation_or_false_durability_is_not_authority(self):
        for patch in ({'durability_confirmed':False},{'v':True},{'status':'published_observed'}):
            self.save('confirmed.json',dict(self.result,**patch))
            with self.assertRaises(RecoveryError):self.run_stage()
        self.assertEqual(self.calls,[])

    def test_readback_with_observed_binding_is_refused(self):
        bad = dict(self.result)
        bad['observed_binding'] = bad.pop('binding')
        with self.assertRaises(RecoveryError):self.run_stage(confirm=lambda request:bad)
        self.assertFalse(self.target(self.profiles['agent']).exists())

    def test_well_formed_but_different_activation_pins_refuse(self):
        values=[dict(self.result,**{key:'4'*64}) for key in
                ('request_digest','source_handoff_digest','bundle_digest','destination_identity_digest')]
        values.extend([dict(self.result,activation_id=str(uuid.uuid4())),
                       dict(self.result,handoff_id=str(uuid.uuid4())),
                       dict(self.result,source_commit={'commit_seq':1,'commit_id':'other-commit'}),
                       dict(self.result,history_complete=True)])
        for value in values:
            with self.subTest(value=value):
                with self.assertRaises(RecoveryError):
                    self.run_stage(confirm=lambda request,v=value:v)
                self.assertFalse(self.target(self.profiles['agent']).exists())

    def test_same_request_retry_reconfirms_and_keeps_file_identities(self):
        first = self.run_stage()
        p = self.target(self.profiles['agent'])
        inode = p.stat().st_ino
        second = self.run_stage()
        self.assertEqual(first,second)
        self.assertEqual(p.stat().st_ino,inode)
        self.assertEqual(len(self.calls),2)

    def test_interruption_after_file_creation_resumes_under_same_intent(self):
        def stop(phase):
            if phase=='profiles':raise InterruptedError('fixture interruption')
        with self.assertRaises(InterruptedError):self.run_stage(checkpoint=stop)
        self.assertTrue(self.target(self.profiles['agent']).exists())
        self.assertFalse((self.root/'control'/'manifest.json').exists())
        self.assertEqual(self.run_stage()['status'],'staged')
        self.assertEqual(len(self.calls),2)

    def test_interruption_after_manifest_and_lost_result_reconciles(self):
        def stop(phase):
            if phase=='manifest':raise InterruptedError('lost response')
        with self.assertRaises(InterruptedError):self.run_stage(checkpoint=stop)
        self.assertTrue((self.root/'control'/'manifest.json').is_file())
        self.assertEqual(self.run_stage()['status'],'staged')

    def test_stale_confirmation_on_retry_never_uses_saved_success(self):
        self.run_stage()
        with self.assertRaises(RecoveryError):
            self.run_stage(confirm=lambda request:dict(self.result,status='stale'))

    def test_changed_input_under_same_staging_id_refuses(self):
        self.run_stage()
        self.save('activation.json',dict(self.activation,changed=True))
        with self.assertRaises(RecoveryError):self.run_stage()
        self.assertEqual(len(self.calls),1)

    def test_changed_request_under_same_staging_id_refuses(self):
        self.run_stage()
        self.request['states']['agent']['stopped']=True
        with self.assertRaises(RecoveryError):self.run_stage()

    def test_preexisting_equal_target_is_not_adopted_without_intent(self):
        p = self.target(self.profiles['agent'])
        p.write_bytes(Path(self.profiles['agent']).read_bytes());p.chmod(0o600)
        with self.assertRaises(RecoveryError):self.run_stage()
        self.assertEqual(self.calls,[])

    def test_partial_or_modified_output_is_retained_and_refused(self):
        def stop(phase):
            if phase=='profiles':raise InterruptedError()
        with self.assertRaises(InterruptedError):self.run_stage(checkpoint=stop)
        p = self.target(self.profiles['agent']);p.write_bytes(b'partial')
        with self.assertRaises(RecoveryError):self.run_stage()
        self.assertEqual(p.read_bytes(),b'partial')

    def test_unavailable_or_failed_confirmation_creates_no_profiles(self):
        def fail(request):raise RecoveryError('RECOVERY_UNCONFIRMED')
        with self.assertRaises(RecoveryError):self.run_stage(confirm=fail)
        self.assertFalse(self.target(self.profiles['agent']).exists())

    def test_wrong_actor_instance_or_missing_profile_refuses(self):
        self.request['profiles']['agent'] = self.profiles['other']
        with self.assertRaises(RecoveryError):self.run_stage()
        self.assertEqual(self.calls,[])

    def test_private_modes_symlink_and_hardlink_refuse(self):
        p=Path(self.profiles['agent']);original=p.read_bytes()
        p.chmod(0o644)
        with self.assertRaises(RecoveryError):self.run_stage()
        p.chmod(0o600)
        link=self.root/'alias.json';link.symlink_to(p)
        self.request['profiles']['agent']=str(link)
        with self.assertRaises(RecoveryError):self.run_stage()
        self.request['profiles']['agent']=str(p)
        link.unlink();os.link(p,link)
        with self.assertRaises(RecoveryError):self.run_stage()
        self.assertEqual(p.read_bytes(),original)

    def test_known_blocked_stopped_and_disabled_states_are_preserved(self):
        self.request['states']['agent']=dict(enabled=True,stopped=True,blocked='native pin pending')
        self.request['states']['other']['enabled']=False
        answer=self.run_stage()
        self.assertFalse(answer['routes_ready'])
        self.assertEqual(answer['actors']['agent']['state'],self.request['states']['agent'])
        self.assertEqual(answer['actors']['agent']['route_status'],'held')
        self.assertFalse(answer['actors']['other']['state']['enabled'])

    def test_actual_copied_route_pin_refusal_remains_blocked_not_adopted(self):
        value=json.loads(self.config.read_text());value['destination']['thread_id']=str(uuid.uuid4())
        self.save('broker.json',value)
        answer=self.run_stage()
        self.assertFalse(answer['routes_ready'])
        self.assertEqual(answer['actors']['agent']['route_status'],'blocked')
        self.assertIn('ROUTE_PIN',answer['actors']['agent']['route_code'])

    def test_source_handoff_bytes_must_match_pinned_digest(self):
        self.save('handoff.json',{'not':'the pinned handoff'})
        with self.assertRaises(RecoveryError):self.run_stage()
        self.assertEqual(self.calls,[])

    def test_unexpected_request_fields_and_uncovered_states_refuse(self):
        self.request['unexpected']=True
        with self.assertRaises(RecoveryError):self.run_stage()
        del self.request['unexpected'];del self.request['states']['agent']
        with self.assertRaises(RecoveryError):self.run_stage()

    def test_original_input_change_during_confirmation_refuses_publication(self):
        def mutate(request):
            value=self.confirm(request)
            self.config.write_bytes(self.config.read_bytes()+b' ')
            return value
        with self.assertRaises(RecoveryError):self.run_stage(confirm=mutate)
        self.assertFalse((self.root/'control'/'manifest.json').exists())

    def test_duplicate_physical_destinations_refuse_before_manifest(self):
        with self.store.runner_guard('fixture-other') as guard:
            self.store.provision_route_pin(guard,'other',self.destination)
        cfg=self.save('other-broker.json',dict(v=1,profile=self.profiles['other'],
            codex_executable='/usr/bin/python3',destination=self.destination))
        route=self.save('other-route.json',dict(v=1,profile=self.profiles['other'],
            argv=['/usr/bin/python3','--config',str(cfg)]))
        self.save('map.json',dict(v=1,routes={'agent':str(self.route),'other':str(route)}))
        with self.assertRaises(RecoveryError) as caught:self.run_stage()
        self.assertEqual(caught.exception.code,'REBIND_DUPLICATE_DESTINATION')
        self.assertFalse((self.root/'control'/'manifest.json').exists())

    def test_hosted_config_keeps_roots_options_and_compares_real_pin(self):
        destination=dict(self.destination,kind='codex-hosted-stdio')
        with self.store.runner_guard('fixture-hosted') as guard:
            self.store.provision_route_pin(guard,'other',destination,owner_id='runner')
        (self.root/'other.outbox').mkdir(mode=0o700)
        config=self.save('hosted.json',dict(v=2,kind='codex-hosted-stdio',actor_id='other',
            profile=self.profiles['other'],cli='/usr/bin/python3',codex_executable='/usr/bin/python3',
            codex_home=str(self.home),thread_id=destination['thread_id'],cwd=str(self.root),
            model=None,writable_roots=[str(self.root),str(self.root/'other.outbox')],
            permission_mode='full',reasoning_effort=None,instructions='fixture exact instructions'))
        self.save('map.json',dict(v=1,routes={'other':str(config)}))
        answer=self.run_stage()
        self.assertTrue(answer['routes_ready'])
        value=json.loads(self.target(config).read_text())
        self.assertEqual(value['profile'],str(self.target(self.profiles['other'])))
        self.assertEqual(value['instructions'],'fixture exact instructions')
        self.assertEqual(value['writable_roots'],[str(self.root),str(self.root/'other.outbox')])

    def test_real_local_lock_refuses_second_stager_without_confirmation(self):
        control=self.root/'control';control.mkdir(mode=0o700)
        lock=control/'lock'
        fd=os.open(str(lock),os.O_RDWR|os.O_CREAT,0o600)
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with self.assertRaises(RecoveryError) as caught:self.run_stage()
            self.assertEqual(caught.exception.code,'REBIND_BUSY')
            self.assertEqual(self.calls,[])
        finally:
            os.close(fd)
        self.assertEqual(self.run_stage()['status'],'staged')

    def test_cli_receipt_omits_profile_and_private_manifest_contents(self):
        path=Path(__file__).resolve().parents[1]/'tools'/'rebind_profiles.py'
        spec=importlib.util.spec_from_file_location('rebind_profiles_fixture',path)
        tool=importlib.util.module_from_spec(spec);spec.loader.exec_module(tool)
        request=self.save('request.json',self.request)
        stdout=io.StringIO()
        with mock.patch.object(tool,'stage',side_effect=lambda value:stage(value,confirm=self.confirm)), \
                mock.patch('sys.stdout',stdout):
            self.assertEqual(tool.main([str(request)]),0)
        answer=json.loads(stdout.getvalue())
        self.assertEqual(set(answer),{'v','status','staging_id','activation_id','handoff_id','routes_ready'})
        self.assertNotIn(str(self.root),stdout.getvalue())

    def test_cli_default_requires_implemented_transfer_and_never_creates_profiles(self):
        path=Path(__file__).resolve().parents[1]/'tools'/'rebind_profiles.py'
        spec=importlib.util.spec_from_file_location('rebind_profiles_unavailable',path)
        tool=importlib.util.module_from_spec(spec);spec.loader.exec_module(tool)
        request=self.save('request.json',self.request)
        stderr=io.StringIO()
        with mock.patch('sys.stderr',stderr):
            self.assertEqual(tool.main([str(request)]),2)
        self.assertEqual(json.loads(stderr.getvalue())['code'],'TRANSFER_UNAVAILABLE')
        self.assertFalse(self.target(self.profiles['agent']).exists())


if __name__=='__main__':
    unittest.main()
