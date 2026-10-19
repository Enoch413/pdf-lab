import http.client
import json
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import local_server


class ServerBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.log_patch = patch.object(local_server.PdfLabRequestHandler, "log_message", lambda *args: None)
        self.log_patch.start()
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        for name in ["index.html", "app/index.html", "app/workspace_ui.js", ".git/HEAD", "tmp/private.js"]:
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("test", encoding="utf-8")
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), partial(local_server.PdfLabRequestHandler, directory=str(root)))
        self.errors = []
        self.server.handle_error = lambda *_: self.errors.append("Unhandled server error")
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()
        self.log_patch.stop()
        self.assertEqual(self.errors, [])

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()

    def test_static_paths_and_host(self):
        for path in ["/", "/app/index.html", "/app/workspace_ui.js"]:
            self.assertEqual(self.request("GET", path)[0], 200)
        for path in ["/.git/HEAD", "/tmp/private.js", "/app/", "/app/../tmp/private.js"]:
            self.assertIn(self.request("GET", path)[0], (403, 404))
            self.assertIn(self.request("HEAD", path)[0], (403, 404))
        self.assertEqual(self.request("GET", "/", headers={"Host": "evil.example"})[0], 403)

    def test_single_listener_owns_port(self):
        first = local_server.PdfLabHTTPServer(("127.0.0.1", 0), local_server.PdfLabRequestHandler)
        try:
            with self.assertRaises(OSError):
                second = local_server.PdfLabHTTPServer(first.server_address, local_server.PdfLabRequestHandler)
                second.server_close()
        finally:
            first.server_close()

    @patch.object(local_server, "get_ocr_status", return_value={"available": True})
    @patch.object(local_server, "run_ocr_for_data_url", return_value="text")
    def test_ocr_schema_and_success(self, *_):
        for payload in [None, [], {"items": [None]}, {"items": [{"images": "bad"}]}]:
            self.assertEqual(self.request("POST", "/api/ocr-answer-blocks", json.dumps(payload))[0], 400)
        self.assertEqual(self.request("POST", "/api/ocr-answer-blocks", "", {"Content-Length": "invalid"})[0], 400)
        self.assertEqual(self.request("POST", "/api/ocr-answer-blocks", "", {"Content-Length": str(100 * 1024 * 1024)})[0], 413)
        payload = json.dumps({"items": [{"problemId": "one", "images": ["data:image/png;base64,AA=="]}]})
        status, data = self.request("POST", "/api/ocr-answer-blocks", payload)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data)["results"][0]["texts"], ["text"])
        self.assertEqual(self.request("POST", "/api/ocr-answer-blocks", payload, {"Origin": "https://evil.example"})[0], 403)


if __name__ == "__main__":
    unittest.main()
