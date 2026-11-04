from __future__ import annotations

import importlib
import importlib.util
import os
import json
import select
import threading
import time
from pathlib import Path
import signal
import tempfile
import unittest

from aim_next import initialize, Store


class EffectsWatchCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='theseus-watch-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.path = self.root/'data.sqlite3'
        self.binding = initialize(self.path, 'watch-instance', [{'id':'agent-a','kind':'agent'}],
                                  authority_path=self.root/'authority.json')['binding']
        self.store = Store(self.path, 'watch-instance', expected_binding=self.binding)

    def api(self):
        self.assertIsNotNone(importlib.util.find_spec('aim_next.effects_watch'),
                             'native retained-descriptor watch must exist')
        return importlib.import_module('aim_next.effects_watch')

    def test_real_commit_sets_hint_on_retained_noninherited_descriptor(self):
        api = self.api()
        with api.NativeWatch(self.path) as watch:
            fd = watch.fd
            self.assertFalse(os.get_inheritable(fd))
            self.assertEqual((os.fstat(fd).st_dev, os.fstat(fd).st_ino),
                             (self.path.stat().st_dev, self.path.stat().st_ino))
            self.assertEqual(watch.wait(0), dict(dirty=False, stop=False))
            result = self.store.command('agent-a', dict(v=1, instance_id='watch-instance',
                operation_id='workspace-one', kind='workspace.create', target={},
                expected=dict(authority={key:self.binding[key] for key in ('authority_id','authority_epoch')}),
                args=dict(id='workspace', title='Native commit', team=[])))
            self.assertEqual(result['status'], 'committed')
            event = watch.wait(1)
            self.assertTrue(event['dirty'], 'native committed write must produce a vnode hint')
            self.assertFalse(event['stop'])
            self.assertEqual(watch.fd, fd, 'descriptor is retained rather than reopened')
        with self.assertRaises(OSError):
            os.fstat(fd)

    def test_sigint_and_sigterm_use_the_same_wait_and_restore_handlers(self):
        api = self.api()
        for number in (signal.SIGINT, signal.SIGTERM):
            with self.subTest(number=number):
                original = signal.getsignal(number)
                with api.NativeWatch(self.path) as watch:
                    os.kill(os.getpid(), number)
                    self.assertTrue(watch.wait(1)['stop'], 'native stop signal wakes the event wait')
                self.assertIs(signal.getsignal(number), original)

    def test_renamed_replaced_database_refuses_without_closing_watch_early(self):
        api = self.api()
        with api.NativeWatch(self.path) as watch:
            fd = watch.fd
            moved = self.root/'original.sqlite3'
            self.path.rename(moved)
            self.path.write_bytes(moved.read_bytes())
            self.assertNotEqual(self.path.stat().st_ino, os.fstat(fd).st_ino)
            with self.assertRaises(api.WatchError):
                watch.wait(1)
            self.assertEqual(os.fstat(fd).st_ino, moved.stat().st_ino,
                             'failure flags identity loss; caller closes after storage cleanup')
        with self.assertRaises(OSError):
            os.fstat(fd)

    def test_symlink_and_missing_database_have_no_generic_open_fallback(self):
        api = self.api()
        alias = self.root/'alias.sqlite3'
        alias.symlink_to(self.path)
        for path in (alias, self.root/'missing.sqlite3'):
            with self.subTest(path=path):
                original = {n:signal.getsignal(n) for n in (signal.SIGINT,signal.SIGTERM)}
                with self.assertRaises(api.WatchError):
                    api.NativeWatch(path)
                self.assertEqual({n:signal.getsignal(n) for n in original}, original)

    def test_wait_does_not_close_or_reopen_database_descriptor(self):
        api = self.api()
        with api.NativeWatch(self.path) as watch:
            fd = watch.fd
            for _ in range(3):
                self.assertEqual(watch.wait(0), dict(dirty=False, stop=False))
                self.assertEqual(watch.fd, fd)
                self.assertEqual(os.fstat(fd).st_ino, self.path.stat().st_ino)


    def test_signal_arriving_after_wait_selection_interrupts_native_kevent(self):
        api=self.api()
        for number in (signal.SIGINT,signal.SIGTERM):
            with self.subTest(number=number):
                ready=threading.Event();observed=[];sent=[];markers=[]
                original=signal.getsignal(number)
                with api.NativeWatch(self.path) as watch:
                    queue=watch.queue
                    class Queue:
                        def control(inner,changes,count,timeout):
                            self.assertGreaterEqual(timeout,2,'signal must not precede stopped timeout selection')
                            markers.append(time.monotonic());ready.set()
                            events=queue.control(changes,count,timeout)
                            observed.extend(dict(filter=e.filter,ident=e.ident) for e in events)
                            return events
                        def close(inner):queue.close()
                    watch.queue=Queue()
                    def send():
                        if ready.wait(2):
                            # The marker proves timeout selection already happened;
                            # the extra gap normally lets the native call block.
                            time.sleep(0.05);sent.append(time.monotonic());os.kill(os.getpid(),number)
                    sender=threading.Thread(target=send);sender.start()
                    try:
                        event=watch.wait(2)
                        end=time.monotonic()
                    finally:sender.join(3)
                    self.assertFalse(sender.is_alive())
                    self.assertEqual(len(sent),1)
                    self.assertGreater(sent[0],markers[0])
                    delay=end-sent[0]
                    print(json.dumps(dict(native_blocked_signal=int(number),wait_start=markers[0],
                        sent=sent[0],wait_end=end,signal_to_return=delay,events=observed)))
                    self.assertLess(delay,0.75,'native signal filter must wake a blocked wait promptly')
                    self.assertIn(dict(filter=select.KQ_FILTER_SIGNAL,ident=number),observed,
                                  'the actual kevent, not only the Python flag, must be observed')
                    self.assertTrue(event['stop']);self.assertTrue(watch.stopped)
                self.assertIs(signal.getsignal(number),original)
