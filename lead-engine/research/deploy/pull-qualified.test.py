import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('pull', Path(__file__).with_name('pull-qualified.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
SHA = 'a' * 40

class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.calls = []
        self.active = 'inactive'
        self.mode = 'run'
        self.fail = None
        for name, path in [('STATE', self.root), ('UNIT', self.root / 'worker.service'), ('DATA', self.root / 'data')]:
            p = patch.object(m, name, path); p.start(); self.addCleanup(p.stop)
        m.UNIT.write_text('previous configuration')
        p = patch.object(m, 'run', self.fake); p.start(); self.addCleanup(p.stop)
        p = patch.object(m.os, 'chown'); p.start(); self.addCleanup(p.stop)

    def fake(self, *args, check=True):
        self.calls.append(args)
        if self.fail and self.fail(args):
            raise subprocess.CalledProcessError(1, args)
        out, rc = '', 0
        if args[0] == 'git' and 'show' in args:
            out = json.dumps(dict(commit=SHA, mode=self.mode))
        if args[:2] == ('systemctl', 'show'): out = self.active
        if args[:2] in [('docker', 'inspect'), ('systemctl', 'is-active')]: rc = 1
        if '--entrypoint=id' in args: out = '1000'
        return subprocess.CompletedProcess(args, rc, out, '')

    def launches(self):
        return [c for c in self.calls if c[:2] == ('systemctl', 'start')]

    def test_one_launch_only_and_networkless_tests(self):
        m.deploy(); m.deploy()
        self.assertEqual(len(self.launches()), 1)
        tests = next(c for c in self.calls if '--test' in c)
        self.assertIn('--network=none', tests)
        self.assertFalse(any('--env-file' in c for c in self.calls))
        self.assertIn('Restart=on-failure', m.UNIT.read_text())
        self.assertIn('StartLimitBurst=3', m.UNIT.read_text())

    def test_active_worker_is_not_interrupted(self):
        self.active = 'activating'; m.deploy()
        self.assertFalse(self.launches())
        self.assertFalse(any('build' in c for c in self.calls))
        self.assertEqual(m.UNIT.read_text(), 'previous configuration')

    def test_test_failure_keeps_previous_unit(self):
        self.fail = lambda c: '--test' in c
        with self.assertRaises(SystemExit): m.deploy()
        self.assertFalse(self.launches())
        self.assertEqual(m.UNIT.read_text(), 'previous configuration')
        self.assertEqual(json.loads((m.STATE / 'status.json').read_text())['stage'], 'tests')

    def test_start_failure_restores_unit_and_does_not_repeat(self):
        self.fail = lambda c: c[:2] == ('systemctl', 'start')
        with self.assertRaises(SystemExit): m.deploy()
        self.assertEqual(m.UNIT.read_text(), 'previous configuration')
        self.fail = None; m.deploy()
        self.assertEqual(len(self.launches()), 1)

    def test_hold_does_not_launch(self):
        self.mode = 'hold'; m.deploy()
        self.assertFalse(self.launches())

if __name__ == '__main__': unittest.main()

