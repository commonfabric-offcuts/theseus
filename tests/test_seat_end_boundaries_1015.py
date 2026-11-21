from __future__ import annotations

from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock

from aim_next.codex_host import Host


class EndBoundaries(unittest.TestCase):
    def host(self, *, active=None, status='idle', attached=True):
        host = Host.__new__(Host)
        config = NS(destination={'thread_id':'thread'}, profile=NS(actor_id='seat'))
        thread = NS(id='thread', actor='seat', config=config, home='home', attached=attached,
                    attaching=False, uncertain=False, active_turn=active, status=status, bridge=None)
        host.threads={'thread':thread};host.current=None
        host.log=NS(write=Mock());host.ensure_thread=Mock();host.add_seat=Mock()
        host._attach_failed=Mock();host.core=Mock(return_value={'turns':[]})
        return host, thread, config

    def test_active_or_unknown_context_is_never_abandoned(self):
        for active,status in [('turn','active'),(None,None),(None,'systemError'),(None,'notLoaded')]:
            host,thread,config=self.host(active=active,status=status)
            self.assertFalse(host.drain_seat(config))
            self.assertIs(host.threads['thread'],thread)
            host.core.assert_not_called()

    def test_idle_confirmation_keeps_context_until_retirement_then_detaches_only_itself(self):
        host,thread,config=self.host()
        peer=object();host.threads['peer']=peer
        thread.bridge=NS(close=Mock())
        self.assertTrue(host.drain_seat(config))
        self.assertIs(host.threads['thread'],thread);thread.bridge.close.assert_not_called()
        host.forget_seat(config);self.assertEqual(host.threads,{'peer':peer})
        thread.bridge.close.assert_called_once();host.core.assert_not_called()

    def test_restart_requires_reconciliation_before_idle_counts(self):
        host,thread,config=self.host(attached=False)
        self.assertFalse(host.drain_seat(config));host.ensure_thread.assert_called_once()
        self.assertIn('thread',host.threads)

    def test_an_unrouted_ending_context_keeps_its_fence_across_control_refresh(self):
        host,thread,config=self.host()
        thread.ending=True;thread.control_stopped=False
        host._interrupt_controlled=Mock();host.monotonic=lambda:0
        host.apply_controls({})
        self.assertTrue(thread.ending)
        host._interrupt_controlled.assert_not_called()

    def test_unknown_resume_last_turn_answer_preserves_open_core_turns(self):
        host,thread,config=self.host()
        thread.ending=True;host._last_turn=Mock(return_value=None)
        host._reconciled(None,thread,None,{'message':'unknown'})
        host._attach_failed.assert_called_once_with(thread,'end_native_unconfirmed')
        host.core.assert_not_called()

    def test_send_rechecks_end_after_a_claim_without_interrupting_active_turn(self):
        host,thread,config=self.host(active='old',status='active')
        host.core=Mock(return_value={'controls':{'seat':{'desired':'running','ending':True}}})
        host.apply_controls=Mock();host._settle=Mock();host._request=Mock()
        thread.control_stopped=False;thread.ending=False
        work=NS(thread=thread)
        host._send(work)
        host._settle.assert_called_once_with(work,'busy',None,'seat_ending')
        host._request.assert_not_called()

if __name__ == '__main__':
    unittest.main()
