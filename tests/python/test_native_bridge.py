import hashlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.parse
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


ROOT = Path(__file__).resolve().parents[2]
HOST_PATH = ROOT / "browser-extension" / "ibm-literature-capture" / "native-bridge" / "host.py"
SPEC = importlib.util.spec_from_file_location("ibm_native_bridge", HOST_PATH)
HOST = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HOST)


def minimal_pptx():
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as package:
        package.writestr("[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>")
        package.writestr("ppt/presentation.xml", "<p:presentation xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"/>")
    return output.getvalue()


def minimal_docx():
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as package:
        package.writestr("[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>")
        package.writestr("word/document.xml", "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>")
    return output.getvalue()


class ArtifactHandler(BaseHTTPRequestHandler):
    payload = minimal_pptx()
    advertised_hash = hashlib.sha256(payload).hexdigest()
    content_type = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    file_name = "reviewed-deck.pptx"

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", self.content_type)
        self.send_header("Content-Length", str(len(self.payload)))
        self.send_header("X-Content-SHA256", self.advertised_hash)
        self.send_header("X-File-Name", urllib.parse.quote(self.file_name))
        self.end_headers()
        self.wfile.write(self.payload)

    def log_message(self, _format, *_args):
        return


class NativeBridgeArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_downloads_dirs = HOST.downloads_dirs
        HOST.downloads_dirs = lambda: [self.temp_dir.name]
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), ArtifactHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f"http://127.0.0.1:{self.server.server_port}"
        self.url = self.origin + "/api/lab-artifacts?kind=ppt&reportId=report-1"

    def tearDown(self):
        ArtifactHandler.payload = minimal_pptx()
        ArtifactHandler.advertised_hash = hashlib.sha256(ArtifactHandler.payload).hexdigest()
        ArtifactHandler.content_type = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        ArtifactHandler.file_name = "reviewed-deck.pptx"
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        HOST.downloads_dirs = self.original_downloads_dirs
        self.temp_dir.cleanup()

    def test_saves_verified_pptx_without_zone_identifier(self):
        result = HOST.save_artifact(self.url, self.origin)
        destination = Path(result["filePath"])
        self.assertTrue(result["ok"])
        self.assertEqual(destination.read_bytes(), ArtifactHandler.payload)
        self.assertFalse(os.path.exists(str(destination) + ":Zone.Identifier"))

    def test_uses_collision_safe_name(self):
        first = HOST.save_artifact(self.url, self.origin)
        second = HOST.save_artifact(self.url, self.origin)
        self.assertNotEqual(first["filePath"], second["filePath"])
        self.assertTrue(second["fileName"].endswith(" (1).pptx"))

    def test_saves_verified_docx(self):
        ArtifactHandler.payload = minimal_docx()
        ArtifactHandler.advertised_hash = hashlib.sha256(ArtifactHandler.payload).hexdigest()
        ArtifactHandler.content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ArtifactHandler.file_name = "reading-report.docx"
        url = self.origin + "/api/lab-artifacts?kind=report&format=docx&reportId=report-1"
        result = HOST.save_artifact(url, self.origin)
        self.assertEqual(Path(result["filePath"]).read_bytes(), ArtifactHandler.payload)
        self.assertEqual(result["fileName"], "reading-report.docx")

    def test_rejects_hash_mismatch_and_removes_temporary_file(self):
        ArtifactHandler.advertised_hash = "0" * 64
        with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
            HOST.save_artifact(self.url, self.origin)
        self.assertEqual(list(Path(self.temp_dir.name).iterdir()), [])

    def test_rejects_non_loopback_and_unapproved_parameters(self):
        with self.assertRaisesRegex(ValueError, "loopback"):
            HOST.validate_artifact_url(
                "https://example.com/api/lab-artifacts?kind=ppt&reportId=report-1",
                "https://example.com",
            )
        with self.assertRaisesRegex(ValueError, "unsupported"):
            HOST.validate_artifact_url(self.url + "&preview=1", self.origin)


if __name__ == "__main__":
    unittest.main()
