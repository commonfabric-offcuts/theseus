from __future__ import annotations
import errno
import math


def _reading(value, boundary, admitted):
    if not isinstance(value, dict):
        return False
    load = value.get('load')
    if not isinstance(load, list) or len(load) != 3:
        return False
    if any(isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n)
           or n < 0 for n in load):
        return False
    qualified = load[0] < 12
    forced = value.get('forcedHold')
    return (value.get('boundary') == boundary and isinstance(value.get('UTC'), str)
            and bool(value['UTC']) and type(value.get('cpus')) is int and value['cpus'] > 0
            and value.get('measurementSource') == 'host-os'
            and type(forced) is bool and value.get('qualified') is qualified
            and value.get('admitted') is (qualified and not forced)
            and value.get('admitted') is admitted)


def classify_resource_phase(report, direct_exit, observed):
    """Validate retained instrument facts; this is not a native gesture proof."""
    cleanup = report.get('cleanup') or {}
    owned = report.get('owned') or {}
    profiles = observed.get('profiles')
    clear = (isinstance(profiles, list) and observed.get('remaining_owned') == []
             and observed.get('tmpRemaining') == []
             and all(p.get('absent') is True and p.get('matching_processes') == []
                     for p in profiles))
    readings = report.get('launchResources')
    readings = readings if isinstance(readings, list) else []
    no_browser = (report.get('browserStarted') is False and cleanup.get('browserStarted') is False
                  and report.get('browserClosed') is None
                  and report.get('browserDisconnected') is None
                  and cleanup.get('disconnected') is None
                  and cleanup.get('closeRequested') is False and cleanup.get('closeResolved') is False)
    fixture_started = report.get('fixtureStarted') is True and cleanup.get('fixtureStarted') is True
    tcp = cleanup.get('tcpOutcome') or {}
    port = observed.get('port') or {}
    teardown = report.get('fixtureTeardown') or {}
    records = teardown.get('records') or []
    stages = [r for r in records if r.get('event') == 'cleanup-stage']
    required_stages = {'controls-close', 'http-shutdown', 'http-close', 'http-join',
                       'http-thread', 'controls-health'}
    close = cleanup.get('fixtureClose') or {}
    fixture_clear = (fixture_started and report.get('fixtureEOFRequested') is True
                     and report.get('fixtureStdinFinished') is True
                     and type(report.get('fixtureExitCode')) is int and report['fixtureExitCode'] == 0
                     and report.get('fixtureStdioClosed') is True
                     and type(close.get('code')) is int and close['code'] == 0
                     and close.get('signal') is None
                     and report.get('fixtureErrors') == ''
                     and cleanup.get('fixtureAbsent') is True
                     and teardown.get('errors') == [] and bool(records)
                     and records[-1].get('event') == 'cleanup-complete'
                     and records[-1].get('errors') == []
                     and records[-1].get('fixtureBodyError') is None
                     and sum(r.get('event') == 'cleanup-complete' for r in records) == 1
                     and all(r.get('status') == 'ok' for r in stages)
                     and required_stages.issubset({r.get('stage') for r in stages})
                     and tcp.get('event') == 'error' and tcp.get('code') == 'ECONNREFUSED'
                     and bool(owned.get('origin')) and tcp.get('origin') == owned['origin']
                     and port.get('origin') == owned['origin']
                     and port.get('refused') is True and port.get('connect_ex') == errno.ECONNREFUSED
                     and port.get('errno_name') == 'ECONNREFUSED'
                     and bool(owned.get('profile')) and cleanup.get('profileAbsent') is True
                     and isinstance(profiles, list)
                     and any(p.get('path') == owned['profile'] for p in profiles))
    held = report.get('phaseState') == 'held'
    held_valid = False
    if held:
        held_record = report.get('held')
        common = (direct_exit == 75 and no_browser and report.get('nativePassed') is False
                  and report.get('results') == [] and report.get('failure') is None
                  and bool(readings) and held_record == readings[-1])
        prefixture = (len(readings) == 1 and _reading(readings[0], 'fixture', False)
                      and report.get('fixtureStarted') is False
                      and cleanup.get('fixtureStarted') is False
                      and report.get('fixtureEOFRequested') is False
                      and report.get('fixtureStdinFinished') is False
                      and report.get('fixtureExitCode') is None and report.get('fixtureErrors') is None
                      and report.get('fixtureStdioClosed') is False
                      and cleanup.get('fixtureClose') is None
                      and report.get('fixtureTeardown') is None and owned.get('fixturePid') is None
                      and owned.get('origin') is None and owned.get('profile') is None
                      and cleanup.get('tcpOutcome') is None and observed.get('port') is None
                      and profiles == [])
        prebrowser = (len(readings) == 2 and _reading(readings[0], 'fixture', True)
                      and _reading(readings[1], 'browser', False) and fixture_clear)
        held_valid = bool(common and (prefixture or prebrowser))
        clean = bool(clear and held_valid)
    else:
        launch_clear = (len(readings) == 2 and _reading(readings[0], 'fixture', True)
                        and _reading(readings[1], 'browser', True)
                        and all(r.get('measurementSource') == 'host-os' for r in readings))
        clean = bool(clear and launch_clear and fixture_clear
                     and report.get('browserStarted') is True
                     and cleanup.get('browserStarted') is True
                     and cleanup.get('closeRequested') is True
                     and cleanup.get('closeResolved') is True
                     and cleanup.get('disconnected') is True
                     and report.get('browserClosed') is True
                     and report.get('browserDisconnected') is True)
    native_passed = bool(not held and clean and direct_exit == 0
                         and report.get('nativePassed') is True
                         and report.get('phaseState') == 'completed'
                         and isinstance(report.get('results'), list) and bool(report['results'])
                         and all(r.get('passed') is True for r in report['results']))
    return {'held': held, 'heldReceiptValid': held_valid, 'cleanupClean': clean,
            'nativePassed': native_passed,
            'phaseState': 'held' if held and clean else 'completed' if native_passed else 'failed'}
