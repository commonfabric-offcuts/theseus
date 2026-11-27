"""Scratch browser fixture for a retained Tell and a terminated hosted seat."""

import json
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT), str(ROOT / 'tests')]

from aim_next.health import FAILING_AFTER, report_lines
from aim_next.profile import write_profile
from aim_next.serve import server_for_profile
from aim_next.wake_health import PARKED_AFTER
from test_seat_end_1015 import SeatEnd
from test_store import StoreCase


def ready(case, guard, token, name, number):
    case.added(name=name)
    seat = case.claim(guard, token)
    seat = case.step(guard, token, seat, 'profile', {'plan': case.plan()})
    for stage in ('thread', 'starting', 'persist', 'persisting', 'pin', 'route', 'delivery', 'ready'):
        detail = {'thread_id': f'12345678-1234-4234-8234-{number:012}'} if stage == 'persist' else None
        seat = case.step(guard, token, seat, stage, detail)
    return seat


def facts(case):
    health = case.store.view('owner', 'health', {})
    pending = case.store.view('researcher', 'deliveries', {})['items']
    return {'red': health['red'], 'waiting': {agent['actor_id']: agent['waiting'] for agent in health['agents']},
            'routes': {agent['actor_id']: agent['route'] for agent in health['agents']},
            'pending': [item['message_id'] for item in pending],
            'needs': report_lines(health, str)[0],
            'wakes': case.store.view('owner', 'wakes', {})['quiet']}


def main():
    case = SeatEnd('runTest')
    case.setUp()
    try:
        profile = case.path.parent / 'owner.json'
        write_profile(profile, case.path, case.store.instance_id, 'owner', binding=case.binding)
        with case.store.runner_guard('fixture') as guard:
            token = case.store.acquire_runner(guard, lease_ms=120000)['runner_token']
            researcher = ready(case, guard, token, 'Researcher', 1)
            ready(case, guard, token, 'Ready hosted', 2)
            pin = case.store.provision_route_pin(guard, 'agent-a', {'kind': 'codex-queue-stdio', 'protocol_version': 1,
                'codex_home': str(case.path.parent), 'thread_id': '12345678-1234-4234-8234-000000000003'})
            assert pin['status'] == 'provisioned', pin
            source = {'kind': 'new_topic', 'id': 'opening', 'workspace_id': 'w1'}
            saved = StoreCase.save_draft(case, 'opening', source, 'seat-check', 'Topic opening',
                opening={'workspace_id': 'w1', 'title': 'Seat check', 'participants': ['researcher', 'ready-hosted', 'agent-a']})
            assert saved['status'] == 'committed', saved
            prepared = StoreCase.prepare(case, 'opening', 'seat-check', submission='opening', send_op='open-topic')
            assert prepared['status'] == 'committed', prepared
            opened = case.command('topic.create_and_send', {'submission_id': 'opening'}, {'topic_id': 'seat-check'}, op='open-topic')
            assert opened['status'] == 'committed', opened

            # A retained health failure from earlier wake attempts is the regression input.
            case.sql("INSERT INTO wake_facts(recipient_id,failed_wakes,failed_outcome,failed_reason) "
                     "VALUES ('researcher',?,'unavailable','route_unavailable') "
                     "ON CONFLICT(recipient_id) DO UPDATE SET failed_wakes=excluded.failed_wakes, "
                     "failed_outcome=excluded.failed_outcome,failed_reason=excluded.failed_reason", (FAILING_AFTER,))
            case.sql("UPDATE recipient_schedule SET unanswered_wakes=? WHERE recipient_id='researcher'", (PARKED_AFTER,))
            before = facts(case)
            assert 'failing:researcher' in before['red'], before
            assert any(wake['actor_id'] == 'researcher' for wake in before['wakes']), before
            ending = case.ended_intent(researcher)
            assert 'failing:researcher' in facts(case)['red']
            retired = case.store.hosted_seat_retire(guard, token, ending['id'], ending['version'])
            assert retired['retired'], retired
            tell = case.command('message.post', {'body': 'A Tell retained for the ended researcher.',
                'intent': 'tell', 'addressees': ['researcher']}, {'topic_id': 'seat-check'})
            assert tell['status'] == 'committed', tell

            server = server_for_profile(profile, 0, ROOT / 'web')
            thread = threading.Thread(target=server.serve_forever)
            thread.start()
            try:
                for line in sys.stdin:
                    request = json.loads(line)
                    answer = {'origin': server.origin, 'before': before, 'after': facts(case),
                              'tell': tell['result']['message_id']}
                    print(json.dumps({'id': request['id'], 'answer': answer}), flush=True)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()
                case.store.stop_runner(guard, token)
    finally:
        case.doCleanups()


if __name__ == '__main__':
    main()
