from __future__ import annotations

import json
import unittest

from aim_next.route_pins import RoutePinError
import test_hosted_seat_1002 as base


class SeatEnd(base.HostedSeatCore):
    # Reuse only setup helpers; predecessor behavior remains in its own suite.
    def end(self, seat, actor='owner', op=None, revision=None):
        return self.command('workspace.hosted_seat_end', {},
            {'workspace_id': 'w1', 'seat_request_id': seat['id']},
            {'seat_revision': seat['version'] if revision is None else revision}, actor, op)

    def ended_intent(self, seat):
        answer = self.end(seat)
        self.assertEqual(answer.get('status'), 'committed', answer)
        self.assertEqual(answer['result']['seat']['state'], 'ending')
        return answer['result']['seat']

    def test_end_owner_revision_and_duplicate_exact_receipt(self):
        seat = self.added()['seat']
        self.assertEqual(self.end(seat, actor='agent-a')['error']['code'], 'FORBIDDEN')
        self.assertEqual(self.end(seat, revision=0)['error']['code'], 'REVISION_CONFLICT')
        first = self.end(seat, op='end-exact')
        self.assertEqual(first.get('status'), 'committed', first)
        self.assertEqual(self.end(seat, op='end-exact'), first)
        self.assertEqual(self.store.view('owner', 'operation', {'operation_id': 'end-exact'}), first)
        duplicate = self.end(seat)
        self.assertEqual(duplicate['result']['seat']['version'], first['result']['seat']['version'])
        self.assertEqual(self.sql("SELECT count(*) FROM hosted_seat_events WHERE state='ending'"), [(1,)])

    def test_end_fences_setup_and_preserves_identity_events_and_late_thread(self):
        self.added()
        with self.store.runner_guard('host') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            sent = self.to_stage(guard, token, 'starting')
            ending = self.ended_intent(sent)
            stopped = self.store.hosted_seat_step(guard, token, sent['id'], sent['version'], 'persist',
                {'thread_id': '12345678-1234-4234-8234-000000000001'})['seat']
            self.assertEqual(stopped['state'], 'ending')
            self.assertEqual(stopped['thread_id'], '12345678-1234-4234-8234-000000000001')
            self.assertIsNone(self.store.hosted_seat_claim(guard, token)['seat'])
            final = self.store.hosted_seat_retire(guard, token, stopped['id'], stopped['version'])
            self.assertEqual(final['seat']['state'], 'ended')
        self.assertEqual(self.sql('SELECT inviter_id,owner_id,role FROM hosted_seats'), [('owner', 'owner', sent['role'])])
        self.assertEqual(self.sql('SELECT count(*) FROM messages'), [(0,)])
        self.assertEqual(self.store.view('owner', 'hosted_seat', {'workspace_id':'w1', 'seat_request_id':sent['id']})['seat']['state'], 'ended')
        self.assertFalse(ending['retryable'])

    def test_ready_end_fences_operator_claims_retires_pin_and_never_readds(self):
        self.added()
        with self.store.runner_guard('host') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            ready = self.to_stage(guard, token, 'ready')
            pin = json.loads(self.sql("SELECT value FROM metadata WHERE key LIKE 'route_pin.v1:%'")[0][0])
            ending = self.ended_intent(ready)
            self.assertIsNone(self.store.hosted_seat_route(guard, token, 0)['seat'])
            claim = self.store.claim_wakes(guard, token, ['release-scribe'])
            self.assertFalse(claim.get('claims'), claim)
            retired = self.store.hosted_seat_retire(guard, token, ending['id'], ending['version'])
            self.assertEqual(retired['seat']['state'], 'ended', retired)
            self.assertEqual(self.sql("SELECT count(*) FROM metadata WHERE key LIKE 'route_pin.v1:%' OR key LIKE 'hosted_control.v1:%'"), [(0,)])
            with self.assertRaises(RoutePinError):
                self.store.provision_route_pin(guard, 'release-scribe', pin['destination'], owner_id='owner')
        self.assertEqual(self.add()['error']['code'], 'SEAT_ENDED')
        retry = self.command('workspace.hosted_seat_retry', {}, {'workspace_id':'w1', 'seat_request_id':ready['id']}, {'seat_revision':retired['seat']['version']})
        self.assertEqual(retry['error']['code'], 'SEAT_ENDED')
        self.assertEqual(self.sql('SELECT count(*) FROM messages'), [(1,)])
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE recipient_id='release-scribe' AND state='pending'"), [(1,)])

    def test_end_disabled_departed_route_keeps_exact_history_and_cap_reuse(self):
        seats = [self.added(name='Seat %s' % n)['seat'] for n in range(8)]
        self.assertEqual(self.add(name='No slot')['error']['code'], 'SEAT_LIMIT')
        self.sql("UPDATE actors SET enabled=0 WHERE id=?", (seats[0]['agent_id'],))
        self.sql("DELETE FROM workspace_members WHERE actor_id=?", (seats[0]['agent_id'],))
        ending = self.ended_intent(seats[0])
        self.assertEqual(self.add(name='Still occupied')['error']['code'], 'SEAT_LIMIT')
        with self.store.runner_guard('host') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            batch = self.store.hosted_seat_endings(guard, token)['seats']
            self.assertEqual([s['id'] for s in batch], [ending['id']])
            self.store.hosted_seat_retire(guard, token, ending['id'], ending['version'])
        self.assertEqual(self.add(name='New slot')['status'], 'committed')
        self.assertEqual(self.sql('SELECT count(*) FROM hosted_seats'), [(9,)])

    def test_end_waits_for_an_admitted_claim_and_stale_route_refusal_is_harmless(self):
        self.added()
        with self.store.runner_guard('host') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            ready = self.to_stage(guard, token, 'ready')
            claims = self.store.claim_wakes(guard, token, ['release-scribe'])
            self.assertTrue(claims['claims'], claims)
            ending = self.ended_intent(ready)
            refusal = self.store.hosted_seat_route_refuse(guard, token, ready['id'], ready['version'])
            self.assertEqual(refusal['seat']['state'], 'ending')
            retired = self.store.hosted_seat_retire(guard, token, ending['id'], ending['version'])
            self.assertFalse(retired['retired']); self.assertEqual(retired['reason'], 'turn_active')
            controls = self.store.hosted_controls(guard, token, ['release-scribe'])
            self.assertTrue(controls['controls']['release-scribe']['ending'])
            self.assertEqual(controls['controls']['release-scribe']['desired'], 'running')

    def test_late_creation_after_retirement_keeps_audit_without_reopening(self):
        self.added()
        with self.store.runner_guard('host') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            sent = self.to_stage(guard, token, 'starting')
            ending = self.ended_intent(sent)
            self.store.hosted_seat_retire(guard, token, ending['id'], ending['version'])
            late = self.store.hosted_seat_late_thread(guard, token, sent['id'], sent['version'], '12345678-1234-4234-8234-000000000005')['seat']
            self.assertEqual((late['state'], late['thread_id']), ('ended', '12345678-1234-4234-8234-000000000005'))
            self.assertIsNone(self.store.hosted_seat_route(guard, token, 0)['seat'])
            self.assertEqual(self.sql('SELECT count(*) FROM messages'), [(0,)])

    def test_retirement_refuses_a_changed_pin_without_deleting_it(self):
        self.added()
        with self.store.runner_guard('host') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            ready = self.to_stage(guard, token, 'ready')
            ending = self.ended_intent(ready)
            key, raw = self.sql("SELECT key,value FROM metadata WHERE key LIKE 'route_pin.v1:%'")[0]
            altered = json.loads(raw); altered['destination']['thread_id'] = '12345678-1234-4234-8234-000000000099'
            changed = json.dumps(altered)
            self.sql('UPDATE metadata SET value=? WHERE key=?', (changed, key))
            refused = self.store.hosted_seat_retire(guard, token, ending['id'], ending['version'])
            self.assertEqual(refused.get('retired'), False, refused)
            self.assertEqual(self.sql('SELECT value FROM metadata WHERE key=?', (key,)), [(changed,)])
            self.sql('UPDATE metadata SET value=? WHERE key=?', (raw, key))
            final = self.store.hosted_seat_retire(guard, token, ending['id'], ending['version'])
            self.assertTrue(final['retired'], final)


# Do not inherit/re-run the predecessor's tests in this suite.
for _name in list(base.HostedSeatCore.__dict__):
    if _name.startswith('test_'):
        setattr(SeatEnd, _name, None)

if __name__ == '__main__':
    unittest.main()
