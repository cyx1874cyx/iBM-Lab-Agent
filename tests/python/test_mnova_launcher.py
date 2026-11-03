"""Mnova startup failures must stop before processing and never fall back."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "vendor/mnova-mcp/src"))
from mnova_mcp import runner
from mnova_mcp.config import Settings


class FakeProcess:
    def __init__(self, code=None):
        self.code = code
        self.terminated = False
        self.closed = False

    def poll(self):
        return self.code

    def terminate(self):
        self.terminated = True

    def close(self):
        self.closed = True


class MnovaLauncherTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.probe = self.root / "probe.json"
        self.response = self.root / "response.json"

    def run_shell(self, process, operation="prepare_structure_1d", clock=None):
        with patch.object(runner, "_WindowsShellProcess", return_value=process), \
             patch.object(runner.time, "sleep"), \
             patch.object(runner.time, "monotonic", side_effect=clock or [0, 0]):
            return runner._run_windows_shell(
                [str(self.root / "MestReNova.exe"), "桥接 file.qs"],
                executable=self.root / "MestReNova.exe", response_path=self.response,
                probe_path=self.probe, operation=operation, timeout=90,
            )

    def test_success_does_not_require_a_new_process_handle(self):
        self.probe.write_text(json.dumps({"nmr_type": "object", "open_fid": True}))
        self.response.write_text(json.dumps({"status": "ok"}))
        process = FakeProcess()
        result = self.run_shell(process)
        self.assertEqual(result.returncode, 0)
        self.assertTrue(process.closed)
        self.assertFalse(process.terminated)

    def test_forwarder_exit_105_waits_for_host_response(self):
        self.probe.write_text(json.dumps({"nmr_type": "object", "open_fid": True}))
        process = FakeProcess(105)
        def finish_job(_):
            self.response.write_text(json.dumps({"status": "ok"}))
        with patch.object(runner, "_WindowsShellProcess", return_value=process), \
             patch.object(runner.time, "sleep", side_effect=finish_job), \
             patch.object(runner.time, "monotonic", side_effect=[0, 0, 0]):
            result = runner._run_windows_shell(["mnova"], executable=self.root / "MestReNova.exe", response_path=self.response, probe_path=self.probe, operation="prepare_structure_1d", timeout=90)
        self.assertEqual(result.returncode, 105)
        self.assertFalse(process.terminated)

    def test_missing_nmr_or_failed_open_stops_and_closes_owned_handle(self):
        for probe in ({"nmr_type": "undefined", "open_fid": False},
                      {"nmr_type": "object", "open_fid": False},
                      {"nmr_type": "object", "open_fid": 1}):
            with self.subTest(probe=probe):
                self.probe.write_text(json.dumps(probe))
                # A nominal response cannot override a failed startup probe.
                self.response.write_text(json.dumps({"status": "ok"}))
                process = FakeProcess()
                with self.assertRaisesRegex(runner.MnovaError, "启动探针失败"):
                    self.run_shell(process)
                self.assertTrue(process.terminated)
                self.assertTrue(process.closed)

    def test_probe_timeout_is_thirty_seconds(self):
        process = FakeProcess()
        with self.assertRaisesRegex(runner.MnovaError, "探针超时"):
            self.run_shell(process, clock=[0, 30])
        self.assertTrue(process.terminated)
        self.assertTrue(process.closed)

    def test_partial_probe_does_not_start_processing(self):
        self.probe.write_text('{"nmr_type":')
        process = FakeProcess()
        with self.assertRaisesRegex(runner.MnovaError, "探针超时"):
            self.run_shell(process, clock=[0, 30])
        self.assertTrue(process.closed)

    def test_apply_checks_the_prepared_document_without_claiming_fid_open(self):
        self.probe.write_text(json.dumps({"nmr_type": "object", "open_document": True}))
        self.response.write_text(json.dumps({"status": "ok"}))
        self.run_shell(FakeProcess(), operation="apply_assignments_1d")
        self.probe.write_text(json.dumps({"nmr_type": "object", "open_fid": True}))
        with self.assertRaisesRegex(runner.MnovaError, "open_document"):
            self.run_shell(FakeProcess(), operation="apply_assignments_1d")

    def test_job_timeout_releases_handle_and_stops_only_owned_process(self):
        self.probe.write_text(json.dumps({"nmr_type": "object", "open_fid": True}))
        process = FakeProcess()
        with self.assertRaisesRegex(runner.MnovaError, "超过 90 秒"):
            self.run_shell(process, clock=[0, 0, 90])
        self.assertTrue(process.terminated)
        self.assertTrue(process.closed)

    def test_existing_interactive_gui_is_reused_without_relaunch(self):
        with patch.object(runner, '_visible_mnova_window', return_value=True), \
             patch.object(runner, '_WindowsShellProcess') as launch:
            runner._ensure_windows_host_ready(self.root / 'MestReNova.exe')
        launch.assert_not_called()

    def test_cold_start_waits_for_a_normal_gui_before_the_probe(self):
        process = FakeProcess()
        with patch.object(runner, '_visible_mnova_window', side_effect=[False, False, True]), \
             patch.object(runner, '_WindowsShellProcess', return_value=process) as launch, \
             patch.object(runner.time, 'sleep'):
            runner._ensure_windows_host_ready(self.root / 'MestReNova.exe')
        launch.assert_called_once_with([str(self.root / 'MestReNova.exe')], self.root)
        self.assertTrue(process.closed)
        self.assertFalse(process.terminated)

    def test_gui_timeout_is_distinct_from_authorization_and_preserves_gui(self):
        process = FakeProcess()
        with patch.object(runner, '_visible_mnova_window', return_value=False), \
             patch.object(runner, '_WindowsShellProcess', return_value=process), \
             patch.object(runner.time, 'monotonic', side_effect=[0, 31]):
            with self.assertRaisesRegex(runner.MnovaError, '可交互状态'):
                runner._ensure_windows_host_ready(self.root / 'MestReNova.exe')
        self.assertTrue(process.closed)
        self.assertFalse(process.terminated)

    @unittest.skipUnless(os.name == "nt", "Windows launch routing")
    def test_windows_launch_failure_never_falls_back_to_subprocess(self):
        output = self.root / "output"
        output.mkdir()
        bridge = self.root / "bridge.qs"
        bridge.write_text("// bridge")
        settings = Settings(self.root, output, self.root / "MestReNova.exe", bridge)
        request = {"job_id": "test", "operation": "prepare_structure_1d"}
        with patch.dict(os.environ, {"MNOVA_MCP_RUNTIME_ROOT": str(self.root / "runtime")}), \
             patch.object(runner, '_ensure_windows_host_ready'), \
             patch.object(runner, "_run_windows_shell", side_effect=OSError("launch failed")), \
             patch.object(runner.subprocess, "run") as child_launch:
            with self.assertRaisesRegex(runner.MnovaError, "宿主启动失败"):
                runner._run_request(request=request, output=output, settings=settings,
                                    executable=settings.mnova_exe)
            child_launch.assert_not_called()
        diagnostic = json.loads((output / 'mnova.launch.json').read_text())
        self.assertEqual(diagnostic['window_mode'], 'normal-interactive')
        self.assertIn('launch failed', diagnostic['error'])


if __name__ == "__main__":
    unittest.main()
