"""Lane runs and landings share flocks on one Mac (1195), driven through the real command."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / 'tools' / 'lane_lock.py'
WAIT = 10.0


def held_command(marker, release, code=0):
    """A child that marks that it started, then holds until the release file exists."""
    return [sys.executable, '-c',
            'import os,sys,time\n'
            'open(sys.argv[1],"w").write(str(os.getpid()))\n'
            'while not os.path.exists(sys.argv[2]): time.sleep(0.02)\n'
            'sys.exit(int(sys.argv[3]))', str(marker), str(release), str(code)]


class LaneLockTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.env = dict(os.environ, THESEUS_LOCK_DIR=str(self.dir / 'locks'))
        self.procs = []

    def tearDown(self):
        for proc in self.procs:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
            if proc.stderr:
                proc.stderr.close()
        # A held child outlives a wrapper killed with SIGKILL; end it by the pid it wrote.
        for marker in self.dir.glob('*.started'):
            try:
                os.kill(int(marker.read_text() or 0), signal.SIGKILL)
            except (ValueError, ProcessLookupError):
                pass
        self.tmp.cleanup()

    def start(self, action, label, name, code=0):
        marker, release = self.dir / (name + '.started'), self.dir / (name + '.release')
        proc = subprocess.Popen([sys.executable, str(TOOL), action, '--label', label, '--'] + held_command(marker, release, code),
                                env=self.env, stderr=subprocess.PIPE, text=True)
        self.procs.append(proc)
        return proc, marker, release

    def until(self, condition, what):
        deadline = time.monotonic() + WAIT
        while time.monotonic() < deadline:
            if condition():
                return
            time.sleep(0.02)
        self.fail('timed out waiting until ' + what)

    def stays(self, condition, what, seconds=0.6):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self.assertTrue(condition(), what)
            time.sleep(0.02)

    def stderr_so_far(self, proc):
        """What a wrapper has said so far, read from its still-open stderr without blocking."""
        fd = proc.stderr.fileno()
        os.set_blocking(fd, False)
        try:
            chunk = os.read(fd, 65536).decode(errors='replace')
        except BlockingIOError:
            chunk = ''
        proc.said = getattr(proc, 'said', '') + chunk
        return proc.said

    def status(self):
        return subprocess.run([sys.executable, str(TOOL), 'status'], env=self.env, capture_output=True, text=True, check=True).stdout

    def test_a_run_returns_its_command_exit_code_and_shows_in_status_while_it_runs(self):
        proc, marker, release = self.start('run', '1174 green', 'one', code=3)
        self.until(marker.exists, 'the run starts')
        self.assertIn('1174 green', self.status())
        release.touch()
        self.assertEqual(proc.wait(WAIT), 3)
        self.assertNotIn('1174 green', self.status())

    def test_a_fourth_run_waits_for_one_of_three_slots(self):
        runs = [self.start('run', 'lane {}'.format(i), 'run{}'.format(i)) for i in range(3)]
        for _, marker, _ in runs:
            self.until(marker.exists, 'three runs start')
        fourth, marker4, release4 = self.start('run', 'lane 3', 'run3')
        self.stays(lambda: not marker4.exists(), 'a fourth run does not start while three hold the slots')
        runs[1][2].touch()
        self.until(marker4.exists, 'the fourth run starts once a slot frees')
        for _, _, release in runs:
            release.touch()
        release4.touch()
        self.assertEqual(fourth.wait(WAIT), 0)

    def test_a_landing_waits_for_open_runs_and_holds_new_runs_until_it_ends(self):
        run, run_marker, run_release = self.start('run', '1190 consumers', 'open')
        self.until(run_marker.exists, 'the open run starts')
        land, land_marker, land_release = self.start('landing', '398 1160', 'land')
        self.until(lambda: '398 1160' in self.status(), 'the landing is pending')
        late, late_marker, late_release = self.start('run', '1194 repair', 'late')
        self.stays(lambda: not land_marker.exists(), 'the landing does not start while a run is open')
        self.stays(lambda: not late_marker.exists(), 'a run started after the landing does not start before it')
        run_release.touch()
        self.until(land_marker.exists, 'the landing starts once the open run ends')
        self.stays(lambda: not late_marker.exists(), 'the late run still waits while the landing runs')
        land_release.touch()
        self.assertEqual(land.wait(WAIT), 0)
        self.until(late_marker.exists, 'the late run starts once the landing ends')
        late_release.touch()
        self.assertEqual(late.wait(WAIT), 0)

    def test_a_run_waiting_for_a_slot_does_not_start_while_a_landing_is_pending(self):
        runs = [self.start('run', 'lane {}'.format(i), 'w{}'.format(i)) for i in range(3)]
        for _, marker, _ in runs:
            self.until(marker.exists, 'three runs start')
        fourth, marker4, release4 = self.start('run', 'lane 3', 'w3')
        self.until(lambda: 'all 3 run slots are in use' in self.stderr_so_far(fourth), 'the fourth run waits for a slot')
        land, land_marker, land_release = self.start('landing', '403 1197', 'wland')
        self.until(lambda: '403 1197' in self.status(), 'the landing is pending')
        runs[0][2].touch()
        # A run retries the slots once a second, so the window outlasts a retry.
        self.stays(lambda: not marker4.exists(), 'a run that was waiting for capacity does not take a freed slot while a landing is pending', seconds=2.5)
        runs[1][2].touch()
        runs[2][2].touch()
        self.until(land_marker.exists, 'the landing starts once the open runs end')
        self.stays(lambda: not marker4.exists(), 'the waiting run still waits while the landing runs')
        land_release.touch()
        self.assertEqual(land.wait(WAIT), 0)
        self.until(marker4.exists, 'the waiting run starts once the landing ends')
        release4.touch()
        self.assertEqual(fourth.wait(WAIT), 0)

    def test_a_killed_wrapper_keeps_its_slot_until_its_command_dies(self):
        runs = [self.start('run', 'lane {}'.format(i), 'k{}'.format(i)) for i in range(3)]
        for _, marker, _ in runs:
            self.until(marker.exists, 'three runs start')
        os.kill(runs[0][0].pid, signal.SIGKILL)
        runs[0][0].wait(WAIT)
        fourth, marker4, release4 = self.start('run', 'after kill', 'k3')
        self.stays(lambda: not marker4.exists(), 'a run whose wrapper was killed still holds its slot while its command runs')
        os.kill(int(runs[0][1].read_text()), signal.SIGKILL)
        self.until(marker4.exists, 'the slot is free once the orphaned command dies too')
        for _, _, release in runs:
            release.touch()
        release4.touch()
        self.assertEqual(fourth.wait(WAIT), 0)

    def test_a_killed_landing_wrapper_keeps_runs_out_until_its_command_ends(self):
        land, land_marker, land_release = self.start('landing', '399 1190', 'kland')
        self.until(land_marker.exists, 'the landing starts')
        os.kill(land.pid, signal.SIGKILL)
        land.wait(WAIT)
        run, run_marker, run_release = self.start('run', '1174 green', 'krun')
        self.stays(lambda: not run_marker.exists(), 'no run starts while the orphaned landing command runs')
        land_release.touch()
        self.until(run_marker.exists, 'the run starts once the landing command ends')
        run_release.touch()
        self.assertEqual(run.wait(WAIT), 0)

    def test_a_landing_with_no_open_runs_starts_at_once(self):
        land, marker, release = self.start('landing', '399 1174', 'alone')
        self.until(marker.exists, 'the landing starts')
        self.assertIn('landing-running: 399 1174', self.status())
        release.touch()
        self.assertEqual(land.wait(WAIT), 0)
        self.assertIn('landing-running: free', self.status())


if __name__ == '__main__':
    unittest.main()
