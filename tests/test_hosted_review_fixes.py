from __future__ import annotations

import json
import sqlite3
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from test_codex_host import HostCase, AGENT, INSTANCE
from aim_next.codex_host import Host, HostedThread, Dispatch
from aim_next.contract import Refusal


class SendRecheckCase(unittest.TestCase):
    def test_stop_between_claim_and_send_prevents_the_native_request(self):
        config = SimpleNamespace(destination={'thread_id':'thread','codex_home':'home'},
                                 permission_mode='full', reasoning_effort=None)
        thread = HostedThread(AGENT, config)
        thread.status = 'idle'
        host = Host.__new__(Host)
        host.core = Mock(return_value={'controls':{AGENT:{'desired':'stopped'}}})
        host.threads = {'thread':thread}
        host.children = {}
        host.monotonic = lambda: 1
        host.log = SimpleNamespace(write=Mock())
        host.settle = Mock()
        host._request = Mock()
        work = Dispatch({'attempt_id':'claimed'},thread,{'input':[],'additionalContext':None},0)
        host.current = work
        host._send(work)
        host.core.assert_called_once_with('hosted_controls',[AGENT])
        host._request.assert_not_called()
        host.settle.assert_called_once_with('busy',None,'operator_stopped',None)


class BadControlCase(HostCase):
    def test_a_malformed_or_misbound_control_blocks_only_its_seat(self):
        self.open_topic('Pending hosted work')
        self.store.register_actor('bridge','agent','Bridge agent')
        revision=self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]
        self.act('workspace.member_set',{'actor_id':'bridge','present':True},{'workspace_id':'w1'},{'workspace_revision':revision})
        self.act('message.post',{'body':'Independent bridge work','addressees':['bridge'],'intent':'tell'},{'topic_id':'t1'})
        pending=self.pending()
        with sqlite3.connect(str(self.db)) as db:
            original=db.execute("SELECT value FROM metadata WHERE key=?",('hosted_control.v1:'+AGENT,)).fetchone()[0]
        wrong=json.loads(original);wrong['binding']['authority_epoch']='a-different-authority'
        for raw in ['{broken', '{}', json.dumps(wrong)]:
            with self.subTest(raw=raw[:12]):
                with sqlite3.connect(str(self.db)) as db:
                    db.execute("UPDATE metadata SET value=? WHERE key=?",(raw,'hosted_control.v1:'+AGENT))
                try:
                    schedule=self.store.runner_schedule([AGENT,'bridge'])
                except Refusal as error:
                    self.fail('One malformed seat faulted the shared scheduler: '+error.code)
                self.assertEqual(schedule['hosted_controls'][AGENT]['desired'],'stopped')
                self.assertIn('fault',schedule['hosted_controls'][AGENT])
                self.assertIsNone(schedule['hosted_controls']['bridge'])
                self.assertIsNotNone(schedule['next_due_ms'],'the bridge remains eligible')
                try:
                    health=self.store.view('lead','health',{})
                except Refusal as error:
                    self.fail('One malformed seat faulted the complete Health view: '+error.code)
                seat=next(a['execution'] for a in health['agents'] if a['actor_id']==AGENT)
                self.assertEqual(seat['state'],'unavailable');self.assertFalse(seat['can_control'])
                self.assertEqual(self.pending(),pending)
        with self.store.runner_guard('fault-scope') as guard:
            acquired=self.store.acquire_runner(guard)
            token=acquired['runner_token']
            claims=self.store.claim_wakes(guard,token,[AGENT,'bridge'])['claims']
            self.assertEqual([c['recipient_id'] for c in claims],['bridge'])
            controls=self.store.hosted_controls(guard,token,[AGENT,'bridge'])['controls']
            self.assertIn('fault',controls[AGENT]);self.assertIsNone(controls['bridge'])

    def test_provisioning_refuses_an_agent_owner(self):
        self.store.register_actor('new-seat','agent','New seat')
        dest={'kind':'codex-hosted-stdio','protocol_version':1,'codex_home':str(self.home),
              'thread_id':'12345678-1234-4234-8234-123456789abc'}
        with self.store.runner_guard('owner-test') as guard:
            with self.assertRaises(Refusal) as rejected:
                self.store.provision_route_pin(guard,'new-seat',dest,owner_id=AGENT)
        self.assertEqual(rejected.exception.code,'INVALID_OWNER')
        self.assertEqual(self.sql("SELECT count(*) FROM metadata WHERE key='hosted_control.v1:new-seat'"),[(0,)])


class WorkVisibilityCase(HostCase):
    def state(self, viewer):
        return next(a['execution'] for a in self.store.view(viewer,'health',{})['agents'] if a['actor_id']==AGENT)

    def test_a_waiting_question_is_not_disclosed_to_an_outside_viewer(self):
        self.open_topic('Private workspace')
        self.store.register_actor('outsider','human','Outside viewer')
        result=self.store.command(AGENT,{'v':1,'instance_id':INSTANCE,'operation_id':'ask-owner','kind':'message.post',
           'target':{'topic_id':'t1'},'expected':{'authority':self.pin},
           'args':{'body':'Which direction?','addressees':['lead'],'intent':'ask'}})
        self.assertEqual(result['status'],'committed',result)
        self.assertEqual(self.state('lead')['state'],'waiting')
        self.assertEqual(self.state('outsider')['state'],'idle')
        self.assertIsNone(self.state('outsider')['work'])

    def test_an_unreadable_first_delivery_does_not_hide_later_visible_work(self):
        self.open_topic('Shared workspace')
        for (identity,) in self.pending():
            result=self.store.command(AGENT,{'v':1,'instance_id':INSTANCE,'operation_id':'ack-'+identity,'kind':'delivery.ack',
                'target':{'delivery_id':identity},'args':{},'expected':{'authority':self.pin}})
            self.assertEqual(result['status'],'committed')
        self.store.register_actor('reader','human','Reader')
        revision=self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]
        self.act('workspace.member_set',{'actor_id':'reader','present':True},{'workspace_id':'w1'},{'workspace_revision':revision})
        hidden=self.act('message.post',{'body':'Only the pair','addressees':[AGENT],'whisper':True},{'topic_id':'t1'})['message_id']
        public=self.open_topic('Visible pending work','t2')['message_id']
        first=self.sql("SELECT d.message_id FROM delivery_groups g INDEXED BY eligible_groups "
                       "CROSS JOIN deliveries d INDEXED BY pending_group_deliveries ON d.group_id=g.id AND d.state='pending' "
                       "WHERE g.recipient_id=? AND g.active=1 AND g.pending_count>0 LIMIT 1",(AGENT,))[0][0]
        self.assertEqual(first,hidden,'the regression must really see the unreadable delivery first')
        self.assertEqual(self.state('reader')['work'],{'topic_id':'t2','message_id':public})
