from __future__ import annotations

import signal
import time
from test_codex_host import HostCase, AGENT, INSTANCE


class StopDeadlineCase(HostCase):
    turns = [{"hold": "interrupt"}]
    script = {"deaf": True, "ignore_term_once": True}

    def test_one_stop_kills_an_unresponsive_child_without_new_work_or_another_signal(self):
        runner = self.runner()
        self.open_topic("A job whose child ignores interruption and TERM")
        runner.event("host_dispatch", outcome="handed", mode="start")
        started = time.monotonic()
        code, final = runner.stop()
        self.assertEqual((code, final['status']), (0, 'stopped'))
        self.assertLess(time.monotonic() - started, 20)
        self.assertEqual(self.sql("SELECT exit_status,cleanup FROM hosted_children"), [(-signal.SIGKILL, 'confirmed')])
        self.assertEqual(len(self.pending()), 1, 'stop preserves unresolved work')
        self.assertEqual(len(self.turn_rpcs()), 1, 'stopping starts no new turn')


class OperatorControlCase(HostCase):
    turns = [{"hold": "interrupt"}, {"reply": "Resumed the same context"}]

    def execution(self, actor='lead'):
        health = self.store.view(actor, 'health', {})
        return next(agent['execution'] for agent in health['agents'] if agent['actor_id'] == AGENT)

    def control_seat(self, desired, revision):
        return self.act('agent.execution', {'desired':desired}, {'actor_id':AGENT}, {'execution_revision':revision})

    def test_stop_and_continue_survive_restart_without_clearing_pending_work(self):
        runner = self.runner()
        self.open_topic('Keep this job until it is done')
        runner.event('host_dispatch', outcome='handed')
        self.assertEqual(self.execution()['state'], 'working')
        self.assertEqual(self.execution()['work']['topic_id'], self.sql("SELECT topic_id FROM messages LIMIT 1")[0][0])
        self.control_seat('stopped', 1)
        runner.event('host_control', desired='stopped')
        runner.event('host_turn_end', status='interrupted')
        self.assertEqual(self.execution()['state'], 'stopped')
        self.assertEqual(len(self.pending()), 1)
        self.assertEqual(self.store.runner_schedule([AGENT])['next_due_ms'], None)
        self.stopped_cleanly(runner)
        restarted = self.runner()
        restarted.event('host_resume')
        self.assertEqual(self.execution()['desired'], 'stopped')
        self.assertEqual(len(self.turn_rpcs()), 1, 'restart does not undo Stop')
        self.control_seat('running', 2)
        restarted.event('host_turn_end', status='completed')
        self.assertEqual(self.pending(), [])
        self.assertEqual(self.replies(), ['Resumed the same context'])
        self.assertEqual({row['thread_id'] for row in self.turns_rows()}, {self.thread})
        self.assertEqual(self.execution()['state'], 'idle')
        self.stopped_cleanly(restarted)

    def test_only_owner_controls_and_a_stale_command_cannot_reverse_stop(self):
        self.open_topic('A queued job')
        self.assertFalse(self.execution(AGENT)['can_control'])
        envelope = {'v':1,'instance_id':INSTANCE,'operation_id':'control-forbidden','kind':'agent.execution',
                    'target':{'actor_id':AGENT},'args':{'desired':'stopped'},
                    'expected':dict(execution_revision=1,authority=self.pin)}
        refused=self.store.command(AGENT,envelope)
        self.assertEqual(refused['status'],'rejected')
        self.assertEqual(refused['error']['code'],'FORBIDDEN')
        self.control_seat('stopped',1)
        envelope.update(operation_id='control-stale',args={'desired':'running'})
        refused=self.store.command('lead',envelope)
        self.assertEqual(refused['status'],'rejected')
        self.assertEqual(refused['error']['code'],'REVISION_CONFLICT')
        self.assertEqual(self.execution()['desired'],'stopped')
        self.assertEqual(len(self.pending()),1)
        runner=self.runner()
        runner.event('host_resume')
        self.assertEqual(self.turn_rpcs(),[], 'a stopped seat starts no model turn')
        self.stopped_cleanly(runner)


class OperatorStopDeadlineCase(HostCase):
    turns = [{"hold":"interrupt"}]
    script = {"deaf":True, "ignore_term_once":True, "ignore_eof":True}

    def test_stop_button_kills_an_unresponsive_seat_without_stopping_the_runner(self):
        runner=self.runner()
        self.open_topic('An unresponsive job')
        runner.event('host_dispatch',outcome='handed')
        started=time.monotonic()
        self.act('agent.execution',{'desired':'stopped'},{'actor_id':AGENT},{'execution_revision':1})
        runner.event('host_child_exit',status=-signal.SIGKILL)
        self.assertLess(time.monotonic()-started,20)
        self.assertIsNone(runner.process.poll())
        self.assertEqual(len(self.pending()),1)
        self.assertEqual(len(self.turn_rpcs()),1)
        self.stopped_cleanly(runner)


class DeploymentLaunchCase(HostCase):
    default_host_dir = True
    turns = [{"reply":"The default launch works"}]

    def test_ordinary_deploy_arguments_run_a_hosted_seat_and_keep_private_logs(self):
        runner=self.runner()
        self.open_topic('Work with the normal deploy arguments')
        runner.event('host_turn_end',status='completed')
        self.assertEqual(self.replies(),['The default launch works'])
        self.assertEqual(self.pending(),[])
        log=self.db.parent/'hosted-runner'
        self.assertEqual(log.stat().st_mode & 0o777,0o700)
        self.assertTrue((log/'events.jsonl').is_file())
        self.stopped_cleanly(runner)


class ControlVisibilityCase(HostCase):
    def test_a_work_link_does_not_grant_another_viewer_topic_access(self):
        self.open_topic('Only the participating people read this work')
        self.store.register_actor('outsider','human','Outside reader')
        def state(viewer):
            return next(a['execution'] for a in self.store.view(viewer,'health',{})['agents'] if a['actor_id']==AGENT)
        self.assertIsNotNone(state('lead')['work'])
        self.assertIsNone(state('outsider')['work'])
        self.assertFalse(state('outsider')['can_control'])

