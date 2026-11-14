from __future__ import annotations

import importlib
import importlib.util
import grp
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest import mock

from aim_next import initialize, Store
from aim_next.profile import load_profile, write_profile
from aim_next.route_pins import RoutePinError


class BrokerRouteCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='theseus-broker-config-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.db = self.root/'data.sqlite3'
        self.binding = initialize(self.db, 'broker-fixture', [
            {'id':'agent-a','kind':'agent'}, {'id':'agent-b','kind':'agent'}],
            authority_path=self.root/'authority.json')['binding']
        self.store = Store(self.db, 'broker-fixture', expected_binding=self.binding)
        self.home = self.root/'codex-root'
        self.home.mkdir(mode=0o700)
        # Known trusted system executable; the installed Codex app's directory
        # policy is a separate selected-runtime check, not this fixture.
        self.executable = '/usr/bin/python3'
        self.destination = dict(kind='codex-queue-stdio',protocol_version=1,
            codex_home=str(self.home),thread_id='12345678-1234-4234-8234-123456789abc')
        self.profiles = {}
        for actor in ('agent-a','agent-b'):
            path = self.root/(actor+'.profile.json')
            write_profile(path, self.db, 'broker-fixture', actor, binding=self.binding)
            self.profiles[actor] = path
        self.runner_profile = load_profile(self.profiles['agent-a'])
        self.config = self.root/'config.json'
        self.route = self.root/'route.json'
        self.mapping = self.root/'mapping.json'
        self.config_value = dict(v=1,profile=str(self.profiles['agent-a']),
            codex_executable=self.executable,destination=dict(self.destination))
        self.route_value = dict(v=1,profile=str(self.profiles['agent-a']),
            argv=[self.executable,'--config',str(self.config)])
        self.save(self.config,self.config_value)
        self.save(self.route,self.route_value)
        self.save(self.mapping,dict(v=1,routes={'agent-a':str(self.route)}))
        self.expected = dict(instance_id='broker-fixture',actor_id='agent-a',db_path=str(self.db),
            authority_id=self.binding['authority_id'],authority_epoch=self.binding['authority_epoch'])
        self.claim = dict(attempt_id='attempt-a',claim_token='test-private-token',recipient_id='agent-a',
            wake_generation=1,captured_seq=1,lease_until_ms=20000,route_binding=dict(self.expected))
        self.provision('agent-a',self.destination)

    def api(self):
        self.assertIsNotNone(importlib.util.find_spec('aim_next.broker_routes'),
                             'selected broker configuration boundary must exist')
        return importlib.import_module('aim_next.broker_routes')

    def save(self,path,value):
        path.write_text(json.dumps(value))
        path.chmod(0o600)

    def provision(self,actor,destination):
        with self.store.runner_guard('config-provision') as guard:
            return self.store.provision_route_pin(guard,actor,destination)

    def preflight(self,**kwargs):
        return self.api().preflight_route(self.route,'agent-a',self.runner_profile,
            selected_executable=self.executable,**kwargs)

    def test_valid_mapping_and_claim_use_compared_pin_without_writes_or_spawn(self):
        api = self.api()
        before = self.db.read_bytes()
        with mock.patch.object(Store,'provision_route_pin',side_effect=AssertionError('dispatch cannot provision')), \
                mock.patch('subprocess.Popen',side_effect=AssertionError('preflight cannot spawn')):
            mapping = api.load_route_map(self.mapping,self.runner_profile,selected_executable=self.executable)
            config = self.preflight(claim=self.claim)
        self.assertEqual(mapping,{'agent-a':str(self.route)})
        self.assertEqual(config.destination,self.destination)
        self.assertEqual(config.profile.actor_id,'agent-a')
        self.assertEqual(config.profile_path,str(self.profiles['agent-a']))
        self.assertEqual(config.codex_executable,self.executable)
        self.assertEqual(self.db.read_bytes(),before)

    def test_every_claim_binding_field_and_recipient_are_compared_before_pin_read(self):
        api = self.api()
        for key in self.expected:
            with self.subTest(field=key):
                value=str(self.root/'other.sqlite3') if key=='db_path' else ('agent-b' if key=='actor_id' else 'wrong')
                changed = dict(self.claim,route_binding=dict(self.expected,**{key:value}))
                if key=='actor_id':changed['recipient_id']='agent-b'
                with mock.patch.object(Store,'read_route_pin',side_effect=AssertionError('pin read after foreign binding')):
                    with self.assertRaises(api.BrokerBindingError):
                        self.preflight(claim=changed)
        with self.assertRaises(api.BrokerBindingError):
            self.preflight(claim=dict(self.claim,recipient_id='agent-b'))

    def test_mapping_route_and_config_profile_actor_equalities(self):
        api = self.api()
        with self.assertRaises(api.BrokerBindingError):
            api.preflight_route(self.route,'agent-b',self.runner_profile,selected_executable=self.executable)
        self.save(self.config,dict(self.config_value,profile=str(self.profiles['agent-b'])))
        with self.assertRaises(api.BrokerBindingError):
            self.preflight()

    def test_startup_compares_the_runner_instance_and_authority_without_a_claim(self):
        api=self.api()
        other_db=self.root/'other.sqlite3'
        binding=initialize(other_db,'other-instance',[{'id':'agent-a','kind':'agent'}],
            authority_path=self.root/'other-authority.json')['binding']
        profile_path=self.root/'other.profile.json'
        write_profile(profile_path,other_db,'other-instance','agent-a',binding=binding)
        other=load_profile(profile_path)
        with self.assertRaises(api.BrokerBindingError):
            api.load_route_map(self.mapping,other,selected_executable=self.executable)

    def test_missing_mismatched_and_invalid_pins_preserve_core_refusal(self):
        api = self.api()
        self.save(self.config,dict(self.config_value,destination=dict(self.destination,
            thread_id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')))
        with self.assertRaises(RoutePinError) as caught:
            api.load_config(self.config,expected_binding=self.expected)
        self.assertEqual(caught.exception.code,'ROUTE_PIN_MISMATCH')
        self.save(self.config,dict(self.config_value,profile=str(self.profiles['agent-b'])))
        with self.assertRaises(RoutePinError) as caught:
            api.load_config(self.config)
        self.assertEqual(caught.exception.code,'ROUTE_PIN_MISSING')
        self.save(self.config,self.config_value)
        for code in ('ROUTE_PIN_INVALID','INVALID_ACTOR','INVALID_ROUTE_DESTINATION'):
            refusal=RoutePinError(code,'fixed refusal')
            with self.subTest(code=code),mock.patch.object(Store,'read_route_pin',side_effect=refusal):
                with self.assertRaises(RoutePinError) as caught:
                    api.load_config(self.config)
                self.assertIs(caught.exception,refusal)

    def test_busy_and_storage_uncertainty_are_not_route_absence(self):
        api = self.api()
        for code,retryable in (('DATABASE_BUSY',True),('ROUTE_PIN_STORAGE_ERROR',False)):
            error=RoutePinError(code,'fixed failure',retryable=retryable)
            with self.subTest(code=code),mock.patch.object(Store,'read_route_pin',side_effect=error):
                with self.assertRaises(RoutePinError) as caught:
                    self.preflight(claim=self.claim)
                self.assertIs(caught.exception,error)
                self.assertIs(caught.exception.retryable,retryable)

    def test_returned_pin_destination_is_captured_without_config_reread(self):
        api = self.api()
        original=Store.read_route_pin
        compared=[]
        def changed(store,actor,destination):
            value=original(store,actor,destination)
            compared.append(value['destination'])
            self.save(self.config,dict(self.config_value,destination=dict(self.destination,
                thread_id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')))
            return value
        with mock.patch.object(Store,'read_route_pin',changed):
            config=api.load_config(self.config,expected_binding=self.expected)
        self.assertEqual(len(compared),1)
        self.assertEqual(config.destination,compared[0])
        self.assertEqual(config.destination,self.destination)
        self.assertNotEqual(json.loads(self.config.read_text())['destination'],config.destination)

    def test_two_separately_pinned_actors_cannot_share_destination(self):
        api=self.api()
        self.provision('agent-b',self.destination)
        second_config=self.root/'config-b.json';second_route=self.root/'route-b.json'
        self.save(second_config,dict(self.config_value,profile=str(self.profiles['agent-b'])))
        self.save(second_route,dict(self.route_value,profile=str(self.profiles['agent-b']),
            argv=[self.executable,'--config',str(second_config)]))
        self.save(self.mapping,dict(v=1,routes={'agent-a':str(self.route),'agent-b':str(second_route)}))
        with self.assertRaises(api.BrokerConfigError) as caught:
            api.load_route_map(self.mapping,self.runner_profile,selected_executable=self.executable)
        self.assertEqual(caught.exception.code,'duplicate_destination')

    def test_root_loss_keeps_typed_pin_refusal_at_startup_and_preflight(self):
        api=self.api()
        moved=self.root/'moved-root'
        for mode,code in [('missing','INVALID_ROUTE_DESTINATION'),
                          ('symlink','ROUTE_PIN_MISMATCH')]:
            with self.subTest(mode=mode):
                self.home.rename(moved)
                if mode=='symlink':self.home.symlink_to(moved,target_is_directory=True)
                before=self.db.read_bytes()
                try:
                    for stage,call in [('startup',lambda:api.load_route_map(self.mapping,
                            self.runner_profile,selected_executable=self.executable)),
                            ('parent-preflight',lambda:self.preflight(claim=self.claim))]:
                        with self.subTest(stage=stage),mock.patch('subprocess.Popen',
                                side_effect=AssertionError('root refusal cannot spawn')):
                            error=None
                            try:call()
                            except Exception as caught:error=caught
                            self.assertIs(type(error),RoutePinError,'preserve Core pin refusal type')
                            self.assertEqual(error.code,code)
                    self.assertEqual(self.db.read_bytes(),before,'refusal cannot write records')
                finally:
                    if self.home.is_symlink():self.home.unlink()
                    moved.rename(self.home)

    def _physical_alias(self,kind):
        alias=(self.home.with_name(self.home.name.upper()) if kind=='case'
               else Path('/System/Volumes/Data'+str(self.home)))
        self.assertNotEqual(str(alias.resolve(strict=True)),str(self.home))
        self.assertTrue(os.path.samefile(alias,self.home),'actual alias prerequisite')
        destination=dict(self.destination,codex_home=str(alias))
        pin=self.provision('agent-b',destination)['pin']['destination']
        self.assertNotEqual(pin['codex_home'],self.destination['codex_home'])
        self.assertEqual((Path(pin['codex_home']).stat().st_dev,Path(pin['codex_home']).stat().st_ino),
                         (self.home.stat().st_dev,self.home.stat().st_ino))
        config=self.root/'config-b.json';route=self.root/'route-b.json'
        self.save(config,dict(self.config_value,profile=str(self.profiles['agent-b']),destination=destination))
        self.save(route,dict(self.route_value,profile=str(self.profiles['agent-b']),
                            argv=[self.executable,'--config',str(config)]))
        self.save(self.mapping,dict(v=1,routes={'agent-a':str(self.route),'agent-b':str(route)}))
        before=self.db.read_bytes()
        with self.assertRaises(self.api().BrokerConfigError) as caught:
            self.api().load_route_map(self.mapping,self.runner_profile,selected_executable=self.executable)
        self.assertEqual(caught.exception.code,'duplicate_destination')
        self.assertEqual(self.db.read_bytes(),before)

    def test_case_alias_same_physical_root_is_duplicate(self):
        self._physical_alias('case')

    def test_firmlink_alias_same_physical_root_is_duplicate(self):
        self._physical_alias('firmlink')

    def test_distinct_physical_roots_with_same_thread_remain_distinct(self):
        other=self.root/'other-root';other.mkdir()
        destination=dict(self.destination,codex_home=str(other))
        self.provision('agent-b',destination)
        config=self.root/'config-b.json';route=self.root/'route-b.json'
        self.save(config,dict(self.config_value,profile=str(self.profiles['agent-b']),destination=destination))
        self.save(route,dict(self.route_value,profile=str(self.profiles['agent-b']),
                            argv=[self.executable,'--config',str(config)]))
        mapping={'agent-a':str(self.route),'agent-b':str(route)}
        self.save(self.mapping,dict(v=1,routes=mapping))
        before=self.db.read_bytes()
        self.assertEqual(self.api().load_route_map(self.mapping,self.runner_profile,
                         selected_executable=self.executable),mapping)
        self.assertEqual(self.db.read_bytes(),before)

    def test_root_stat_loss_after_pin_is_visible_startup_binding_refusal(self):
        api=self.api();original=api.preflight_route
        def removed(*args,**kwargs):
            result=original(*args,**kwargs)
            self.home.rmdir()
            return result
        before=self.db.read_bytes()
        try:
            with mock.patch.object(api,'preflight_route',side_effect=removed):
                with self.assertRaises(api.BrokerBindingError) as caught:
                    api.load_route_map(self.mapping,self.runner_profile,selected_executable=self.executable)
            self.assertEqual(caught.exception.code,'route_binding_changed')
            self.assertEqual(self.db.read_bytes(),before)
        finally:self.home.mkdir(exist_ok=True)

    def test_mapping_rejects_duplicate_route_and_config_paths(self):
        api=self.api()
        destination_b=dict(self.destination,thread_id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
        self.provision('agent-b',destination_b)
        second_route=self.root/'route-b.json';second_config=self.root/'config-b.json'
        config_b=dict(self.config_value,profile=str(self.profiles['agent-b']),destination=destination_b)
        self.save(second_config,config_b)
        original=api.preflight_route
        for case,path in [('route',self.route),('config',second_route)]:
            with self.subTest(case=case):
                self.save(self.config,self.config_value)
                self.save(self.route,self.route_value)
                self.save(second_route,dict(self.route_value,profile=str(self.profiles['agent-b'])))
                self.save(self.mapping,dict(v=1,routes={'agent-a':str(self.route),'agent-b':str(path)}))
                def change_after_first(*args,**kwargs):
                    result=original(*args,**kwargs)
                    if args[1]=='agent-a':
                        if case=='route':
                            self.save(self.route,dict(self.route_value,profile=str(self.profiles['agent-b']),
                                argv=[self.executable,'--config',str(second_config)]))
                        else:
                            self.save(self.config,config_b)
                    return result
                # The second entry now has a separately pinned valid actor and
                # destination. Actor mismatch cannot mask a missing path guard.
                with mock.patch.object(api,'preflight_route',side_effect=change_after_first):
                    with self.assertRaises(api.BrokerConfigError) as caught:
                        api.load_route_map(self.mapping,self.runner_profile,selected_executable=self.executable)
                self.assertEqual(caught.exception.code,'duplicate_'+case)

    def test_protected_json_rejects_duplicate_extra_oversize_mode_and_symlink(self):
        api=self.api()
        valid=self.config.read_bytes()
        bad=[b'{"v":1,"v":1}',json.dumps(dict(self.config_value,extra=True)).encode(),b' '*65537]
        for raw in bad:
            with self.subTest(raw_length=len(raw)):
                self.config.write_bytes(raw)
                with self.assertRaises(api.BrokerConfigError):api.load_config(self.config)
        self.config.write_bytes(valid);self.config.chmod(0o644)
        with self.assertRaises(api.BrokerConfigError):api.load_config(self.config)
        self.config.chmod(0o600)
        alias=self.root/'config-alias.json';alias.symlink_to(self.config)
        with self.assertRaises(api.BrokerConfigError):api.load_config(alias)

    def test_selected_executable_and_exact_argv_are_required(self):
        api=self.api()
        alias=self.root/'executable-link';alias.symlink_to(self.executable)
        self.save(self.config,dict(self.config_value,codex_executable=str(alias)))
        with self.assertRaises(api.BrokerConfigError):api.load_config(self.config)
        self.save(self.config,self.config_value)
        other_executable='/usr/bin/true'
        self.assertEqual(api._executable(other_executable),other_executable)
        for argv in ([self.executable,str(self.config)],
                     [str(alias),'--config',str(self.config)],
                     [self.executable,'--config',str(self.config),'extra'],
                     [other_executable,'--config',str(self.config)],
                     [self.executable,'--wrong',str(self.config)],
                     [self.executable,'--config',str(self.root)+'/./config.json']):
            with self.subTest(argv=argv):
                self.save(self.route,dict(self.route_value,argv=argv))
                with self.assertRaises(api.BrokerConfigError):self.preflight()

    def test_startup_missing_route_refuses_and_dispatch_absence_stays_unavailable(self):
        api=self.api()
        api.load_route_map(self.mapping,self.runner_profile,selected_executable=self.executable)
        self.route.unlink()
        with self.assertRaises(api.BrokerConfigError) as caught:
            api.load_route_map(self.mapping,self.runner_profile,selected_executable=self.executable)
        self.assertIs(type(caught.exception),api.BrokerConfigError)
        self.assertEqual(caught.exception.code,'invalid_broker_config')
        with self.assertRaises(api.BrokerConfigError) as caught:self.preflight(claim=self.claim)
        self.assertIs(type(caught.exception),api.BrokerConfigError)
        self.assertEqual(caught.exception.code,'invalid_broker_config')
        self.save(self.route,self.route_value)
        api.load_route_map(self.mapping,self.runner_profile,selected_executable=self.executable)
        self.config.unlink()
        with self.assertRaises(api.BrokerConfigError) as caught:self.preflight(claim=self.claim)
        self.assertIs(type(caught.exception),api.BrokerConfigError)
        self.assertEqual(caught.exception.code,'invalid_broker_config')

    def installed_codex(self):
        # The installed layout in a temporary folder that stands for
        # /Applications: group-writable 040775, every folder below it 0755.
        # Running the fake leaves a mark, so acceptance is shown to read metadata only.
        applications=self.root/'Applications'
        executable=applications/'ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
        executable.parent.mkdir(parents=True)
        for folder in [*executable.relative_to(applications).parents][:-1]:(applications/folder).chmod(0o755)
        applications.chmod(0o775)
        mark=self.root/'executed'
        executable.write_text('#!/bin/sh\n: > %s\n'%mark)
        executable.chmod(0o755)
        info=applications.stat()
        return str(executable),(str(applications),info.st_uid,info.st_gid),mark

    def test_selected_installed_codex_metadata_is_accepted_without_execution(self):
        api=self.api()
        executable,applications,mark=self.installed_codex()
        self.save(self.config,dict(self.config_value,codex_executable=executable))
        try:result=api.load_config(self.config,expected_binding=self.expected,applications=applications)
        except api.BrokerConfigError as error:self.fail('installed layout refused: %s'%error.code)
        self.assertEqual(result.codex_executable,executable)
        self.assertFalse(mark.exists(),'metadata check cannot execute')
        with self.assertRaises(api.BrokerConfigError):
            api._executable(executable)  # Generic broker policy stays strict.
        # A group-writable folder that is not the reviewed one is refused.
        with self.assertRaises(api.BrokerConfigError):api.load_config(self.config,expected_binding=self.expected)
        Path(executable).unlink()
        with self.assertRaises(api.BrokerConfigError):
            api.load_config(self.config,expected_binding=self.expected,applications=applications)
        self.assertFalse(mark.exists(),'metadata check cannot execute')

    def test_applications_exception_has_no_other_writable_path_or_identity(self):
        api=self.api()
        selected=getattr(api,'_codex_executable',None)
        self.assertTrue(callable(selected),'selected Codex child needs its separately reviewed policy')
        executable='/Applications/Fixture.app/bin/codex'
        admin=grp.getgrnam('admin').gr_gid
        uid=os.getuid()
        def info(mode,owner=0,group=0):
            return os.stat_result((mode,123,1,1,owner,group,1,0,0,0))
        def check(path=executable,alter=None,executable_ok=True):
            # Exact stat interposition, not a filesystem permission change.
            overrides=dict(alter or {})
            def metadata(value,*args,**kwargs):
                key=os.fspath(value)
                if key in overrides:return overrides[key]
                if key==path:return info(stat.S_IFREG|0o755,uid)
                if key in ('/Applications','/System/Volumes/Data/Applications'):
                    return info(stat.S_IFDIR|0o775,0,admin)
                return info(stat.S_IFDIR|0o755)
            with mock.patch.object(api,'_path',side_effect=lambda value:value), \
                    mock.patch.object(Path,'stat',metadata), \
                    mock.patch('os.lstat',side_effect=metadata), \
                    mock.patch('os.access',return_value=executable_ok):
                return selected(path)
        self.assertEqual(check(),executable)
        cases=[('/Applications',info(stat.S_IFDIR|0o777,0,admin)),
               ('/Applications',info(stat.S_IFDIR|0o1775,0,admin)),
               ('/Applications',info(stat.S_IFDIR|0o2775,0,admin)),
               ('/Applications',info(stat.S_IFDIR|0o775,uid,admin)),
               ('/Applications',info(stat.S_IFDIR|0o775,0,admin+1000)),
               ('/Applications/Fixture.app',info(stat.S_IFDIR|0o775,uid,admin)),
               ('/Applications/Fixture.app/bin',info(stat.S_IFDIR|0o777,uid)),
               ('/Applications/Fixture.app/bin',info(stat.S_IFDIR|0o757,uid)),
               ('/Applications/Fixture.app/bin',info(stat.S_IFDIR|0o755,uid+1000)),
               (executable,info(stat.S_IFREG|0o775,uid)),
               (executable,info(stat.S_IFREG|0o757,uid)),
               (executable,info(stat.S_IFDIR|0o755,uid)),
               (executable,info(stat.S_IFLNK|0o755,uid)),
               (executable,info(stat.S_IFREG|0o755,uid+1000))]
        for path,value in cases:
            with self.subTest(path=path,mode=value.st_mode,uid=value.st_uid,gid=value.st_gid):
                with self.assertRaises(api.BrokerConfigError):check(alter={path:value})
        with self.assertRaises(api.BrokerConfigError):check(executable_ok=False)
        with self.assertRaises(api.BrokerConfigError):
            check(path='/System/Volumes/Data/Applications/Fixture.app/bin/codex')
