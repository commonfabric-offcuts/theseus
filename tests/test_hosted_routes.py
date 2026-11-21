from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from aim_next import initialize, Store
from aim_next import broker_routes, codex_host
from aim_next.profile import load_profile, write_profile
from aim_next.route_pins import RoutePinError


THREAD = "12345678-1234-4234-8234-123456789abc"
OTHER_THREAD = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
# A known trusted system executable stands in for bin/aim-next, so the
# executable policy does not depend on where this checkout lives.
CLI = "/bin/sh"


class HostedRouteCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="theseus-hosted-config-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.data = self.root / "data"
        self.data.mkdir()
        self.db = self.data / "data.sqlite3"
        self.binding = initialize(self.db, "hosted-fixture", [
            {"id": "agent-a", "kind": "agent"}, {"id": "agent-b", "kind": "agent"}],
            authority_path=self.root / "authority.json")["binding"]
        self.store = Store(self.db, "hosted-fixture", expected_binding=self.binding)
        self.home = self.root / "codex-home"
        self.home.mkdir(mode=0o700)
        self.work = self.root / "work"
        self.work.mkdir()
        self.agents = self.root / "agents"
        self.agents.mkdir()
        self.profiles = {}
        for actor in ("agent-a", "agent-b"):
            path = self.agents / (actor + ".json")
            write_profile(path, self.db, "hosted-fixture", actor, binding=self.binding)
            self.profiles[actor] = path
        self.outbox = self.agents / "agent-a.outbox"
        self.outbox.mkdir(mode=0o700)
        self.destination = dict(kind="codex-hosted-stdio", protocol_version=1, codex_home=str(self.home), thread_id=THREAD)
        self.provision("agent-a", self.destination)
        self.config = self.root / "hosted.json"
        self.value = {"v": 1, "kind": "codex-hosted-stdio", "actor_id": "agent-a", "profile": str(self.profiles["agent-a"]),
                      "cli": CLI, "codex_executable": "/usr/bin/python3", "codex_home": str(self.home),
                      "thread_id": THREAD, "cwd": str(self.work), "model": None,
                      "writable_roots": [str(self.data), str(self.outbox)]}
        self.save(self.value)
        self.expected = dict(instance_id="hosted-fixture", actor_id="agent-a", db_path=str(self.db),
                             authority_id=self.binding["authority_id"], authority_epoch=self.binding["authority_epoch"])

    def save(self, value):
        self.config.write_text(json.dumps(value))
        self.config.chmod(0o600)

    def provision(self, actor, destination):
        with self.store.runner_guard("provision") as guard:
            return self.store.provision_route_pin(guard, actor, destination)

    def refused(self, code, **changes):
        self.save(dict(self.value, **changes))
        with self.assertRaises(broker_routes.BrokerConfigError) as raised:
            broker_routes.load_hosted_config(self.config)
        self.assertEqual(raised.exception.args[0] if raised.exception.args else None, code)
        return raised.exception

    # Route pin ------------------------------------------------------------

    def test_a_hosted_pin_is_provisioned_and_compared_like_a_queue_pin(self):
        pin = self.store.read_route_pin("agent-a", self.destination)
        self.assertEqual(pin["destination"], self.destination)
        self.assertEqual(self.provision("agent-a", self.destination)["status"], "existing")
        with self.assertRaises(RoutePinError) as raised:
            self.store.read_route_pin("agent-a", dict(self.destination, thread_id=OTHER_THREAD))
        self.assertEqual(raised.exception.code, "ROUTE_PIN_MISMATCH")

    def test_an_explicit_owner_added_to_an_existing_pin_is_committed(self):
        self.store.register_actor('owner', 'human', 'Owner')
        with self.store.runner_guard('add-owner') as guard:
            self.store.provision_route_pin(guard, 'agent-a', self.destination, owner_id='owner')
        health = self.store.view('owner', 'health', {})
        state = next(a['execution'] for a in health['agents'] if a['actor_id']=='agent-a')
        self.assertTrue(state['can_control'])
        self.assertEqual(state['desired'], 'running')

    def test_an_actor_holds_one_pin_so_it_is_either_queued_or_hosted(self):
        before = self.db.read_bytes()
        with self.assertRaises(RoutePinError) as raised:
            self.provision("agent-a", dict(self.destination, kind="codex-queue-stdio"))
        self.assertEqual(raised.exception.code, "ROUTE_PIN_MISMATCH")
        self.assertEqual(self.db.read_bytes(), before)
        self.assertEqual(self.provision("agent-b", dict(self.destination, kind="codex-queue-stdio", thread_id=OTHER_THREAD))["status"], "provisioned")

    def test_other_destination_kinds_are_refused(self):
        for kind in ("codex-hosted", "codex-hosted-stdio ", "CODEX-HOSTED-STDIO", "", None):
            with self.subTest(kind=kind), self.assertRaises(RoutePinError) as raised:
                self.provision("agent-b", dict(self.destination, kind=kind))
            self.assertEqual(raised.exception.code, "INVALID_ROUTE_DESTINATION")

    # Hosted route config --------------------------------------------------

    def test_a_valid_config_returns_the_pins_destination_and_exact_roots(self):
        with mock.patch.object(Store, "provision_route_pin", side_effect=AssertionError("loading cannot provision")), \
                mock.patch("subprocess.Popen", side_effect=AssertionError("loading cannot spawn")):
            config = broker_routes.load_hosted_config(self.config, expected_binding=self.expected)
        self.assertEqual(config.destination, self.destination)
        self.assertEqual(config.writable_roots, (str(self.data), str(self.outbox)))
        self.assertEqual((config.profile.actor_id, config.cli, config.cwd, config.model), ("agent-a", CLI, str(self.work), None))
        # Either order names the same two roots; a model name is kept.
        self.save(dict(self.value, writable_roots=[str(self.outbox), str(self.data)], model="gpt-5.3-codex"))
        config = broker_routes.load_hosted_config(self.config)
        self.assertEqual((config.writable_roots, config.model), ((str(self.data), str(self.outbox)), "gpt-5.3-codex"))

    def test_writable_roots_must_be_exactly_the_database_and_outbox_directories(self):
        data, outbox = str(self.data), str(self.outbox)
        for roots in ([data], [outbox], [data, outbox, "/"], [data, data], [outbox, outbox], ["/", outbox],
                      [str(self.root), outbox], [data, str(self.agents)], [str(self.db), outbox],
                      [data, str(self.agents / "agent-b.outbox")], [data, outbox + "/"], None, "", {data: outbox},
                      [data, None]):
            with self.subTest(roots=roots):
                self.refused("invalid_writable_roots", writable_roots=roots)

    def test_full_permissions_and_role_are_explicit_and_reapplied_on_resume(self):
        self.save(dict(self.value, v=2, permission_mode='full', reasoning_effort='high', instructions='Check the blue ledger.'))
        config = broker_routes.load_hosted_config(self.config)
        settings = codex_host.thread_settings(config)
        self.assertEqual(settings['sandbox'], 'danger-full-access')
        self.assertEqual(settings['approvalPolicy'], 'never')
        self.assertEqual(settings['config']['model_reasoning_effort'], 'high')
        self.assertTrue(settings['config']['agents']['enabled'])
        self.assertIn('Check the blue ledger.', settings['developerInstructions'])
        self.assertEqual(codex_host.sandbox_policy(config), {'type': 'dangerFullAccess'})
        echoed = dict(cwd=config.cwd, approvalPolicy='never', sandbox={'type': 'dangerFullAccess'})
        self.assertTrue(codex_host.settings_applied(echoed, config.cwd, config.writable_roots, config.permission_mode))
        self.assertFalse(codex_host.settings_applied(echoed, config.cwd, config.writable_roots))
        echoed['sandbox'] = {'type': 'readOnly'}
        self.assertFalse(codex_host.settings_applied(echoed, config.cwd, config.writable_roots, config.permission_mode))

    def test_v1_routes_stay_restricted_and_v2_rejects_unknown_capabilities(self):
        config = broker_routes.load_hosted_config(self.config)
        self.assertEqual(config.permission_mode, 'workspace')
        settings = codex_host.thread_settings(config)
        self.assertNotIn('sandbox', settings)
        policy = settings['config']['permissions'][settings['permissions']]
        self.assertEqual(policy['extends'], ':workspace')
        self.assertEqual(policy['filesystem'][str(config.profile.db_path)], 'deny')
        self.assertEqual(policy['filesystem'][str(Path(config.profile_path).parent)], 'deny')
        for field, value, reason in [('permission_mode', 'anything', 'invalid_permission_mode'),
                                     ('reasoning_effort', 'whatever', 'invalid_reasoning_effort'),
                                     ('instructions', 'x' * 16385, 'invalid_instructions')]:
            selected = dict(self.value, v=2, permission_mode='full', reasoning_effort='high', instructions='')
            selected[field] = value
            self.save(selected)
            with self.assertRaises(broker_routes.BrokerConfigError) as raised:
                broker_routes.load_hosted_config(self.config)
            self.assertEqual(raised.exception.args[0], reason)

    def test_the_outbox_must_already_exist_as_a_directory(self):
        os.rmdir(str(self.outbox))
        self.refused("invalid_writable_roots")
        self.outbox.write_text("")
        self.refused("invalid_writable_roots")
        os.unlink(str(self.outbox))
        (self.root / "elsewhere").mkdir()
        os.symlink(str(self.root / "elsewhere"), str(self.outbox))
        self.refused("invalid_writable_roots")

    def test_shape_kind_and_field_refusals(self):
        for changes in ({"kind": "codex-queue-stdio"}, {"v": 2}, {"v": True}, {"extra": 1}):
            with self.subTest(changes=changes):
                self.refused("invalid_broker_config", **changes)
        for missing in sorted(self.value):
            with self.subTest(missing=missing):
                self.save({k: v for k, v in self.value.items() if k != missing})
                with self.assertRaises(broker_routes.BrokerConfigError):
                    broker_routes.load_hosted_config(self.config)
        self.refused("invalid_actor", actor_id="")
        self.refused("invalid_model", model="")
        self.refused("invalid_model", model=5)
        self.refused("invalid_model", model="gpt\n5")
        self.refused("invalid_cwd", cwd=str(self.config))
        self.refused("invalid_broker_config", cwd=str(self.root / "absent"))
        self.refused("invalid_broker_config", thread_id=THREAD.upper())
        self.refused("invalid_destination", codex_home="relative/home")
        self.refused("invalid_cli", cli=str(self.config))
        self.refused("invalid_executable", codex_executable=str(self.config))

    def test_the_profile_must_be_the_named_actor_and_the_expected_binding(self):
        self.save(dict(self.value, actor_id="agent-b"))
        with self.assertRaises(broker_routes.BrokerBindingError):
            broker_routes.load_hosted_config(self.config)
        self.save(self.value)
        with self.assertRaises(broker_routes.BrokerBindingError):
            broker_routes.load_hosted_config(self.config, expected_binding=dict(self.expected, actor_id="agent-b"))
        with self.assertRaises(broker_routes.BrokerBindingError):
            broker_routes.load_hosted_config(self.config, expected_binding=dict(self.expected, authority_epoch="other"))

    def test_the_destination_is_compared_with_cores_pin(self):
        self.save(dict(self.value, thread_id=OTHER_THREAD))
        with self.assertRaises(RoutePinError) as raised:
            broker_routes.load_hosted_config(self.config)
        self.assertEqual(raised.exception.code, "ROUTE_PIN_MISMATCH")
        # agent-b has a queue pin only: a hosted config for it is a mismatch, not a new route.
        self.provision("agent-b", dict(self.destination, kind="codex-queue-stdio", thread_id=OTHER_THREAD))
        (self.agents / "agent-b.outbox").mkdir()
        self.save(dict(self.value, actor_id="agent-b", profile=str(self.profiles["agent-b"]), thread_id=OTHER_THREAD,
                       writable_roots=[str(self.data), str(self.agents / "agent-b.outbox")]))
        with self.assertRaises(RoutePinError) as raised:
            broker_routes.load_hosted_config(self.config)
        self.assertEqual(raised.exception.code, "ROUTE_PIN_MISMATCH")

    def test_the_config_file_is_private(self):
        self.config.chmod(0o644)
        with self.assertRaises(broker_routes.BrokerConfigError):
            broker_routes.load_hosted_config(self.config)

    def test_queue_configs_still_refuse_the_hosted_kind(self):
        queue = self.root / "queue.json"
        queue.write_text(json.dumps({"v": 1, "profile": str(self.profiles["agent-a"]), "codex_executable": "/usr/bin/python3",
                                     "destination": self.destination}))
        queue.chmod(0o600)
        with self.assertRaises(broker_routes.BrokerConfigError):
            broker_routes.load_config(queue)

    # Route map -------------------------------------------------------------

    def route_map(self, routes):
        path = self.root / "routes.json"
        path.write_text(json.dumps({"v": 1, "routes": routes}))
        path.chmod(0o600)
        return path

    def test_a_route_map_names_hosted_configs_directly_and_needs_no_broker_executable(self):
        runner = load_profile(self.profiles["agent-b"])
        untrusted = self.root / "no-broker"
        untrusted.write_text("#!/bin/sh\n")
        untrusted.chmod(0o777)
        routes, hosted = broker_routes.load_route_table(self.route_map({"agent-a": str(self.config)}), runner,
                                                        selected_executable=str(self.root / "no-broker"))
        self.assertEqual((routes, hosted), ({"agent-a": str(self.config)}, frozenset({"agent-a"})))
        self.assertEqual(broker_routes.load_route_map(self.route_map({"agent-a": str(self.config)}), runner,
                                                      selected_executable=str(self.root / "no-broker")),
                         {"agent-a": str(self.config)})
        # A broker entry beside it still needs the trusted broker executable.
        route = self.root / "agent-b.route"
        route.write_text(json.dumps({"v": 1, "profile": str(self.profiles["agent-b"]),
                                     "argv": [str(self.root / "no-broker"), "--config", str(self.config)]}))
        route.chmod(0o600)
        with self.assertRaises(broker_routes.BrokerConfigError) as raised:
            broker_routes.load_route_table(self.route_map({"agent-a": str(self.config), "agent-b": str(route)}), runner,
                                           selected_executable=str(self.root / "no-broker"))
        self.assertEqual(raised.exception.code, "invalid_executable")

    def test_a_hosted_entry_must_be_the_configs_own_actor(self):
        runner = load_profile(self.profiles["agent-b"])
        with self.assertRaises(broker_routes.BrokerBindingError):
            broker_routes.load_route_table(self.route_map({"agent-b": str(self.config)}), runner, selected_executable=CLI)

    def test_one_home_runs_one_codex_executable(self):
        destination = dict(self.destination, thread_id=OTHER_THREAD)
        self.provision("agent-b", destination)
        (self.agents / "agent-b.outbox").mkdir()
        other = self.root / "hosted-b.json"
        other.write_text(json.dumps(dict(self.value, actor_id="agent-b", profile=str(self.profiles["agent-b"]), thread_id=OTHER_THREAD,
                                         writable_roots=[str(self.data), str(self.agents / "agent-b.outbox")], codex_executable="/bin/sh")))
        other.chmod(0o600)
        configs = {"agent-a": broker_routes.load_hosted_config(self.config), "agent-b": broker_routes.load_hosted_config(other)}
        with self.assertRaises(broker_routes.BrokerConfigError) as raised:
            codex_host.Host(configs, core=None, settle=None, watch=None, log=None, monotonic=None)
        self.assertEqual(raised.exception.code, "conflicting_codex_executable")
        other.write_text(json.dumps(dict(json.loads(other.read_text()), codex_executable="/usr/bin/python3")))
        configs["agent-b"] = broker_routes.load_hosted_config(other)
        host = codex_host.Host(configs, core=None, settle=None, watch=None, log=None, monotonic=None)
        self.assertEqual(sorted(thread.actor for thread in host.threads.values()), ["agent-a", "agent-b"])


if __name__ == "__main__":
    unittest.main()
