from __future__ import annotations

import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


BACKEND_DIR = Path(__file__).resolve().parents[1]
MODULE_PATH = BACKEND_DIR / "server.py"
SPEC = importlib.util.spec_from_file_location("document_status_server", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Could not load {MODULE_PATH}")
server = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = server
SPEC.loader.exec_module(server)


class DocumentStatusTest(unittest.TestCase):
    def _handler(self, body: dict[str, str] | None = None):
        handler = object.__new__(server.Handler)
        raw_body = json.dumps(body or {}).encode("utf-8")
        handler.headers = {"Content-Length": str(len(raw_body))}
        handler.rfile = io.BytesIO(raw_body)
        handler._authenticate = lambda: {"name": "Status Tester"}
        responses: list[tuple[dict[str, object], int]] = []
        handler._send_json = lambda payload, status=200: responses.append(
            (payload, status)
        )
        return handler, responses

    def test_pending_review_is_a_supported_status(self) -> None:
        self.assertIn("pending-review", server.DOCUMENT_STATUSES)

    def test_set_pending_review_only_writes_status_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            doc_dir = Path(tmp) / "score-page"
            doc_dir.mkdir()
            mung_path = doc_dir / "mung.xml"
            mung_contents = "<mung-document>existing annotation</mung-document>"
            mung_path.write_text(mung_contents, encoding="utf-8")
            handler, responses = self._handler(
                {"status": "pending-review", "annotator": "Alice"}
            )

            with (
                mock.patch.object(server, "DOCUMENTS_PATH", tmp),
                mock.patch.object(server, "log_to_file"),
            ):
                handler._action_set_doc_status({"document": ["score-page"]})

            self.assertEqual(responses[0][1], 200)
            self.assertEqual(responses[0][0]["status"], "pending-review")
            self.assertEqual(mung_path.read_text(encoding="utf-8"), mung_contents)
            status_data = json.loads(
                (doc_dir / "status.json").read_text(encoding="utf-8")
            )
            self.assertEqual(status_data["status"], "pending-review")
            self.assertEqual(status_data["annotator"], "Alice")

    def test_invalid_status_does_not_overwrite_existing_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            doc_dir = Path(tmp) / "score-page"
            doc_dir.mkdir()
            status_path = doc_dir / "status.json"
            original = '{"status":"done","annotator":"Alice"}\n'
            status_path.write_text(original, encoding="utf-8")
            handler, responses = self._handler(
                {"status": "needs-review-someday", "annotator": "Bob"}
            )

            with mock.patch.object(server, "DOCUMENTS_PATH", tmp):
                handler._action_set_doc_status({"document": ["score-page"]})

            self.assertEqual(responses, [({"error": "Invalid status."}, 400)])
            self.assertEqual(status_path.read_text(encoding="utf-8"), original)

    def test_read_pending_review_does_not_rewrite_status_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            doc_dir = Path(tmp) / "score-page"
            doc_dir.mkdir()
            status_path = doc_dir / "status.json"
            original = '{"status":"pending-review","annotator":"Alice"}\n'
            status_path.write_text(original, encoding="utf-8")
            handler = object.__new__(server.Handler)

            with mock.patch.object(server, "DOCUMENTS_PATH", tmp):
                result = handler._read_doc_status("score-page")

            self.assertEqual(
                result, {"status": "pending-review", "annotator": "Alice"}
            )
            self.assertEqual(status_path.read_text(encoding="utf-8"), original)


if __name__ == "__main__":
    unittest.main()
