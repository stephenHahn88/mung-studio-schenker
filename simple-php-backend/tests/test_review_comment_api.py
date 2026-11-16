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
sys.path.insert(0, str(BACKEND_DIR))
SPEC = importlib.util.spec_from_file_location("review_comment_api_server", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Could not load {MODULE_PATH}")
server = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = server
SPEC.loader.exec_module(server)


class ReviewCommentApiTest(unittest.TestCase):
    def _handler(self, body: dict[str, str] | None = None):
        handler = object.__new__(server.Handler)
        raw_body = json.dumps(body or {}).encode("utf-8")
        handler.headers = {"Content-Length": str(len(raw_body))}
        handler.rfile = io.BytesIO(raw_body)
        handler._authenticate = lambda: {"name": "Review Tester"}
        responses: list[tuple[dict[str, object], int]] = []
        handler._send_json = lambda payload, status=200: responses.append(
            (payload, status)
        )
        return handler, responses

    def test_add_and_list_comment_leave_mung_and_image_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            doc_dir = Path(tmp) / "score-page"
            doc_dir.mkdir()
            mung_path = doc_dir / "mung.xml"
            image_path = doc_dir / "image.png"
            original_path = doc_dir / "original.jpg"
            mung_bytes = b"<mung-document>annotation</mung-document>"
            image_bytes = b"processed image bytes"
            original_bytes = b"original image bytes"
            mung_path.write_bytes(mung_bytes)
            image_path.write_bytes(image_bytes)
            original_path.write_bytes(original_bytes)
            store = server.ReviewCommentStore(tmp)
            add_handler, add_responses = self._handler(
                {"text": "Please check note 42."}
            )

            with (
                mock.patch.object(server, "DOCUMENTS_PATH", tmp),
                mock.patch.object(server, "REVIEW_COMMENT_STORE", store),
                mock.patch.object(server, "log_to_file"),
            ):
                add_handler._action_add_review_comment(
                    {"document": ["score-page"]}
                )

                list_handler, list_responses = self._handler()
                list_handler._action_list_review_comments(
                    {"document": ["score-page"]}
                )

            self.assertEqual(add_responses[0][1], 201)
            self.assertEqual(
                add_responses[0][0]["comment"]["author"], "Review Tester"
            )
            self.assertEqual(list_responses[0][1], 200)
            self.assertEqual(len(list_responses[0][0]["comments"]), 1)
            self.assertEqual(mung_path.read_bytes(), mung_bytes)
            self.assertEqual(image_path.read_bytes(), image_bytes)
            self.assertEqual(original_path.read_bytes(), original_bytes)

    def test_unknown_document_is_rejected_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = server.ReviewCommentStore(tmp)
            handler, responses = self._handler({"text": "Comment"})
            with (
                mock.patch.object(server, "DOCUMENTS_PATH", tmp),
                mock.patch.object(server, "REVIEW_COMMENT_STORE", store),
            ):
                handler._action_add_review_comment({"document": ["missing"]})
            self.assertEqual(responses, [({"error": "Document not found."}, 404)])
            self.assertEqual(list(Path(tmp).rglob("review_comments.json")), [])


if __name__ == "__main__":
    unittest.main()
