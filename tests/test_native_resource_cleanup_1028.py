from __future__ import annotations
import copy
import errno
import unittest
from native_resource_cleanup_1028 import classify_resource_phase


def reading(boundary, qualified, source='host-os', forced=False):
    return {'boundary': boundary, 'UTC': '2026-11-23T00:00:00.000Z',
            'load': [11 if qualified else 12, 9, 8], 'cpus': 18,
            'qualified': qualified, 'forcedHold': forced, 'admitted': qualified and not forced,
            'measurementSource': source}


def prefixture():
    # Declared receipt fixtures validate the classifier, not real OS cleanup.
    resource = reading('fixture', False)
    report = {'phaseState': 'held', 'nativePassed': False, 'held': resource,
              'launchResources': [resource], 'results': [], 'failure': None,
              'fixtureStarted': False, 'browserStarted': False,
              'browserClosed': None, 'browserDisconnected': None,
              'fixtureEOFRequested': False, 'fixtureStdinFinished': False,
              'fixtureExitCode': None, 'fixtureStdioClosed': False,
              'fixtureErrors': None, 'fixtureTeardown': None,
              'owned': {'profile': None, 'origin': None, 'fixturePid': None},
              'cleanup': {'fixtureStarted': False, 'browserStarted': False,
                          'closeRequested': False, 'closeResolved': False,
                          'disconnected': None, 'tcpOutcome': None, 'fixtureClose': None}}
    observed = {'profiles': [], 'port': None, 'remaining_owned': [], 'tmpRemaining': []}
    return report, observed


def prebrowser():
    report, observed = prefixture()
    resource = reading('browser', False)
    origin, profile = 'http://127.0.0.1:1', '/declared-checker-profile'
    report.update(held=resource, launchResources=[reading('fixture', True), resource],
                  fixtureStarted=True, fixtureEOFRequested=True, fixtureStdinFinished=True,
                  fixtureExitCode=0, fixtureStdioClosed=True, fixtureErrors='',
                  fixtureTeardown={'records': [
                      {'event': 'cleanup-stage', 'stage': stage, 'status': 'ok'} for stage in
                      ['controls-close', 'http-shutdown', 'http-close', 'http-join', 'http-thread', 'controls-health']
                  ] + [{'event': 'cleanup-complete', 'errors': [], 'fixtureBodyError': None}], 'errors': []},
                  owned={'profile': profile, 'origin': origin, 'fixturePid': 12345})
    report['cleanup'].update(fixtureStarted=True, fixtureAbsent=True, profileAbsent=True,
                             fixtureClose={'code': 0, 'signal': None},
                             tcpOutcome={'origin': origin, 'event': 'error', 'code': 'ECONNREFUSED'})
    observed.update(profiles=[{'path': profile, 'absent': True, 'matching_processes': []}],
                    port={'origin': origin, 'connect_ex': errno.ECONNREFUSED,
                          'errno_name': 'ECONNREFUSED', 'refused': True})
    return report, observed


class NativeResourceCleanup1028(unittest.TestCase):
    def test_checker_provenance_cannot_clear_either_held_host_boundary(self):
        for make_report in [prefixture, prebrowser]:
            report, observed = make_report()
            self.assertTrue(classify_resource_phase(report, 75, observed)['cleanupClean'])
            for resource in report['launchResources']:
                resource['measurementSource'] = 'checker-control'
            result = classify_resource_phase(report, 75, observed)
            self.assertFalse(result['heldReceiptValid'])
            self.assertFalse(result['cleanupClean'])
            self.assertFalse(result['nativePassed'])

    def test_prefixture_is_held_and_never_native_green(self):
        report, observed = prefixture()
        result = classify_resource_phase(report, 75, observed)
        self.assertTrue(result['cleanupClean'])
        self.assertTrue(result['heldReceiptValid'])
        self.assertEqual(result['phaseState'], 'held')
        self.assertFalse(result['nativePassed'])
        for field, value in [('browserClosed', True), ('fixtureStarted', True), ('nativePassed', True)]:
            changed = copy.deepcopy(report)
            changed[field] = value
            self.assertFalse(classify_resource_phase(changed, 75, observed)['cleanupClean'], field)

    def test_prebrowser_requires_actual_cleanup_facts_and_exact_same_origin_refusal(self):
        report, observed = prebrowser()
        self.assertTrue(classify_resource_phase(report, 75, observed)['cleanupClean'])
        for field, value in [('fixtureEOFRequested', False), ('fixtureStdinFinished', False),
                             ('fixtureExitCode', 1), ('fixtureStdioClosed', False), ('fixtureErrors', 'not empty')]:
            changed = copy.deepcopy(report)
            changed[field] = value
            self.assertFalse(classify_resource_phase(changed, 75, observed)['cleanupClean'], field)
        for key, value in [('connect_ex', errno.ETIMEDOUT), ('errno_name', 'ETIMEDOUT'),
                           ('origin', 'http://127.0.0.1:2')]:
            changed = copy.deepcopy(observed)
            changed['port'][key] = value
            self.assertFalse(classify_resource_phase(report, 75, changed)['cleanupClean'], key)
        changed = copy.deepcopy(observed)
        changed['remaining_owned'] = [{'pid': 12345}]
        self.assertFalse(classify_resource_phase(report, 75, changed)['cleanupClean'])
        changed = copy.deepcopy(report)
        changed['fixtureTeardown']['records'].pop(0)
        self.assertFalse(classify_resource_phase(changed, 75, observed)['cleanupClean'])

    def test_load_and_exit_receipts_cannot_turn_a_hold_into_native_green(self):
        report, observed = prebrowser()
        for exit_code in [0, 1, 2]:
            result = classify_resource_phase(report, exit_code, observed)
            self.assertFalse(result['cleanupClean'])
            self.assertFalse(result['nativePassed'])
        report['launchResources'][0]['qualified'] = False
        self.assertFalse(classify_resource_phase(report, 75, observed)['cleanupClean'])

    def test_forced_refusal_preserves_raw_qualified_load_but_never_qualifies_native(self):
        report, observed = prefixture()
        resource = reading('fixture', True, forced=True)
        report.update(held=resource, launchResources=[resource])
        result = classify_resource_phase(report, 75, observed)
        self.assertTrue(result['cleanupClean'])
        self.assertFalse(result['nativePassed'])
        self.assertTrue(resource['qualified'])
        self.assertFalse(resource['admitted'])
        resource['admitted'] = True
        self.assertFalse(classify_resource_phase(report, 75, observed)['cleanupClean'])

    def test_native_success_requires_both_host_readings_and_browser_close(self):
        report, observed = prebrowser()
        report.update(phaseState='completed', held=None, nativePassed=True,
                      launchResources=[reading('fixture', True), reading('browser', True)],
                      results=[{'passed': True}], browserStarted=True,
                      browserClosed=True, browserDisconnected=True)
        report['cleanup'].update(browserStarted=True, closeRequested=True,
                                 closeResolved=True, disconnected=True)
        self.assertTrue(classify_resource_phase(report, 0, observed)['nativePassed'])
        report['launchResources'][1]['measurementSource'] = 'checker-control'
        self.assertFalse(classify_resource_phase(report, 0, observed)['nativePassed'])
        report['launchResources'][1]['measurementSource'] = 'host-os'
        report['browserClosed'] = None
        self.assertFalse(classify_resource_phase(report, 0, observed)['nativePassed'])


if __name__ == '__main__':
    unittest.main()
