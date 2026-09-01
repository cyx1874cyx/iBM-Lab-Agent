import importlib.util
from pathlib import Path
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


ROOT = Path(__file__).resolve().parents[2]
HOST_PATH = ROOT / "browser-extension" / "ibm-literature-capture" / "native-bridge" / "host.py"
SPEC = importlib.util.spec_from_file_location("ibm_native_bridge", HOST_PATH)
HOST = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HOST)


class UploadHandler(BaseHTTPRequestHandler):
    received = None

    def do_PUT(self):
        length = int(self.headers.get("Content-Length", "0"))
        UploadHandler.received = {
            "path": self.path,
            "file_name": self.headers.get("X-File-Name"),
            "body": self.rfile.read(length),
        }
        body = b'{"ok":true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format, *_args):
        return


class NativeDownloadBridgeTests(unittest.TestCase):
    def test_only_accepts_loopback_capture_upload(self):
        valid = "http://127.0.0.1:3080/api/lab-capture-upload?token=once"
        self.assertEqual(HOST.validate_upload_url(valid), valid)
        for invalid in (
            "https://127.0.0.1/api/lab-capture-upload?token=x",
            "http://example.com/api/lab-capture-upload?token=x",
            "http://127.0.0.1/api/lab-artifacts?token=x",
            "http://127.0.0.1/api/lab-capture-upload",
            "http://127.0.0.1/api/lab-capture-upload?token=x&extra=1",
        ):
            with self.assertRaises(ValueError):
                HOST.validate_upload_url(invalid)

    def test_resolve_download_path_stays_in_approved_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            original = HOST.downloads_dirs
            HOST.downloads_dirs = lambda: [directory]
            try:
                file_path = Path(directory) / "paper.pdf"
                file_path.write_bytes(b"%PDF-1.7\n%%EOF")
                resolved, error = HOST.resolve_download_path(str(file_path))
                self.assertIsNone(error)
                self.assertEqual(Path(resolved), file_path)
                outside, error = HOST.resolve_download_path(str(Path(directory).parent / "outside.pdf"))
                self.assertIsNone(outside)
                self.assertIn("outside approved", error)
            finally:
                HOST.downloads_dirs = original

    def test_upload_puts_download_into_capture_endpoint(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), UploadHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                payload = b"%PDF-1.7\nbridge-test\n%%EOF"
                file_path = Path(directory) / "paper.pdf"
                file_path.write_bytes(payload)
                url = f"http://127.0.0.1:{server.server_port}/api/lab-capture-upload?token=test"
                result = HOST.upload(url, str(file_path), "paper.pdf")
                self.assertTrue(result["ok"])
                self.assertEqual(UploadHandler.received["body"], payload)
                self.assertEqual(UploadHandler.received["file_name"], "paper.pdf")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_office_artifact_api_removed(self):
        self.assertFalse(hasattr(HOST, "save_artifact"))
        self.assertFalse(hasattr(HOST, "validate_artifact_url"))


if __name__ == "__main__":
    unittest.main()
