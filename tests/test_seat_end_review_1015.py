from __future__ import annotations

import unittest
from types import SimpleNamespace as NS
from unittest.mock import Mock

from aim_next.codex_host import Host, HostFault
from aim_next.runner import RunnerError
from aim_next.seat_host import SeatHost
import test_hosted_seat_1002 as base
import test_seat_end_1015 as end_cases
import test_seat_end_boundaries_1015 as boundary_cases


class ReviewCore(base.HostedSeatCore):
    end = end_cases.SeatEnd.end
    ended_intent = end_cases.SeatEnd.ended_intent

    def human(self):
        self.sql("INSERT INTO actors(id,kind,name) VALUES ('new-owner','human','New owner')")
        self.sql("INSERT INTO workspace_members VALUES ('w1','new-owner')")

    def test_owner_change_before_pin_retires_legitimate_control_and_keeps_original_audit(self):
        self.added();self.human()
        with self.store.runner_guard('host') as guard:
            token=self.store.acquire_runner(guard)['runner_token']
            seat=self.to_stage(guard,token,'pin')
            revision=self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]
            moved=self.command('workspace.owner_set',{'owner_id':'new-owner'},{'workspace_id':'w1'},{'workspace_revision':revision})
            self.assertEqual(moved['status'],'committed',moved)
            for stage in ('route','delivery','ready'):
                seat=self.step(guard,token,seat,stage)
            ended=self.end(seat,actor='new-owner');self.assertEqual(ended['status'],'committed',ended)
            retired=self.store.hosted_seat_retire(guard,token,seat['id'],ended['result']['seat']['version'])
            self.assertTrue(retired['retired'],retired)
        self.assertEqual(self.sql('SELECT owner_id,inviter_id,end_by FROM hosted_seats'),[('owner','owner','new-owner')])

    def test_stop_is_available_for_an_ending_runaway_but_continue_is_refused(self):
        self.added()
        with self.store.runner_guard('host') as guard:
            token=self.store.acquire_runner(guard)['runner_token'];seat=self.to_stage(guard,token,'ready')
            self.ended_intent(seat)
            stopped=self.command('agent.execution',{'desired':'stopped'},{'actor_id':seat['agent_id']},{'execution_revision':1})
            self.assertEqual(stopped['status'],'committed',stopped)
            continued=self.command('agent.execution',{'desired':'running'},{'actor_id':seat['agent_id']},{'execution_revision':2})
            self.assertEqual(continued['error']['code'],'SEAT_ENDED')

    def test_human_coordinator_cannot_end_another_humans_seat(self):
        seat=self.added()['seat'];self.human()
        self.sql("UPDATE workspaces SET coordinator_id='new-owner' WHERE id='w1'")
        self.assertEqual(self.end(seat,actor='new-owner')['error']['code'],'FORBIDDEN')

    def test_late_uncertain_creation_after_end_keeps_native_audit_id(self):
        self.added()
        with self.store.runner_guard('host') as guard:
            token=self.store.acquire_runner(guard)['runner_token'];sent=self.to_stage(guard,token,'starting')
            refused=self.step(guard,token,sent,'refused',{'reason':'thread_start_uncertain'})
            ending=self.ended_intent(refused)
            self.store.hosted_seat_retire(guard,token,ending['id'],ending['version'])
            late=self.store.hosted_seat_late_thread(guard,token,sent['id'],sent['version'],'12345678-1234-4234-8234-000000000009')['seat']
            self.assertEqual((late['state'],late['thread_id']),('ended','12345678-1234-4234-8234-000000000009'))
            self.assertEqual(self.sql('SELECT count(*) FROM messages'),[(0,)])

    def test_duplicate_end_has_no_affected_change(self):
        seat=self.added()['seat'];self.ended_intent(seat)
        self.assertEqual(self.end(seat)['affected'],[])

    def test_host_end_arguments_are_typed_before_the_effect(self):
        seat=self.added()['seat']
        with self.store.runner_guard('host') as guard:
            token=self.store.acquire_runner(guard)['runner_token']
            for after in (None,1,True,[], 'x'*201):
                with self.subTest(after=after):
                    with self.assertRaises(RunnerError) as caught:
                        self.store.hosted_seat_endings(guard,token,after)
                    self.assertEqual(caught.exception.code,'INVALID_ARGUMENT')
            for identity,version in [([],1),(seat['id'],True),(seat['id'],-1)]:
                with self.subTest(identity=identity,version=version):
                    with self.assertRaises(RunnerError) as caught:
                        self.store.hosted_seat_retire(guard,token,identity,version)
                    self.assertEqual(caught.exception.code,'INVALID_ARGUMENT')


class ReviewHost(unittest.TestCase):
    host = boundary_cases.EndBoundaries.host

    def test_resume_refusal_for_an_ending_context_does_not_pause_the_host(self):
        for error in ({'message':'No rollout found for thread id thread'},
                      {'message':'mismatch','data':{'type':'modelProviderMismatch'}}):
            host,thread,config=self.host(attached=False);thread.ending=True
            host._resumed(None,thread,None,error,(config,None,None,False))
            host._attach_failed.assert_called_once_with(thread,'end_native_unconfirmed')

    def test_current_uncertain_turn_is_not_resumed_under_itself(self):
        host,thread,config=self.host(active='turn',status='active');thread.uncertain=True
        self.assertFalse(host.drain_seat(config));host.ensure_thread.assert_not_called()

    def loop(self):
        now=[0.0]
        loop=NS(watch=NS(stopped=False),clock=NS(monotonic=lambda:now[0]),host=NS(lifecycle_version=0),
                _core=Mock(return_value={'status':'ok','seats':[]}),_event=Mock(),routes={},hosted=frozenset(),routed=[],read_needed=False)
        return loop,now

    def test_unrelated_loop_wakes_do_not_retry_ending_work_and_host_event_wakes_it(self):
        loop,now=self.loop();seats=SeatHost(loop,directory='/scratch/end-review')
        hint={'ending':True,'pending':False,'ready_seq':0};seats.read(hint)
        for _ in range(1000):seats.tick();seats.read(hint)
        self.assertEqual(loop._core.call_count,1)
        now[0]=0.99;seats.tick();self.assertEqual(loop._core.call_count,1)
        now[0]=1.0;seats.tick();self.assertEqual(loop._core.call_count,2)
        self.assertEqual(seats.next_deadline(),3.0)
        loop.host.lifecycle_version+=1;seats.tick();self.assertEqual(loop._core.call_count,3)
        for _ in range(100):seats.tick()
        self.assertEqual(loop._core.call_count,3)

    def test_ownership_loss_stops_the_batch_before_a_second_seat(self):
        loop,now=self.loop()
        rows=[{'id':name,'agent_id':name,'version':2,'first_message_id':None} for name in ('one','two')]
        loop._core=Mock(side_effect=[{'status':'ok','seats':rows},{'status':'paused'},{'status':'ok','retired':True}])
        seats=SeatHost(loop,directory='/scratch/end-review')
        with self.assertRaises(HostFault) as caught:seats._endings()
        self.assertEqual(caught.exception.reason,'seat_runner_paused');self.assertEqual(loop._core.call_count,2)

for _name in base.HostedSeatCore.__dict__:
    if _name.startswith('test_'):setattr(ReviewCore,_name,None)

if __name__ == '__main__':unittest.main()
