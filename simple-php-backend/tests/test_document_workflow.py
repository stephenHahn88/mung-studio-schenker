"""Tests of the document workflow and its API."""
import concurrent.futures
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest import mock
import urllib.error
import urllib.request
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from document_workflow import (
    InvalidStoredWorkflow, InvalidWorkflowPatch, patch_document_workflow,
    read_document_workflow,
)

# import the server with a temporary documents folder and test users
_IMPORT_ROOT = tempfile.TemporaryDirectory(prefix="mung-workflow-import-")
_SYNTHETIC_AUTH = "workflow-test-identity"
with mock.patch.dict(os.environ, {
    "MUNG_DOCUMENTS_PATH": _IMPORT_ROOT.name,
    "MUNG_CUSTOM_CLASSES_FILE": str(Path(_IMPORT_ROOT.name) / "synthetic-classes.json"),
    "MUNG_USERS": "Synthetic Reviewer:" + _SYNTHETIC_AUTH,
    "MUNG_ENABLE_INFERENCE": "0",
}, clear=True):
    _spec = importlib.util.spec_from_file_location("workflow_test_server", BACKEND_DIR / "server.py")
    server = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(server)


class WorkflowStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="mung-workflow-unit-")
        self.addCleanup(self.temp.cleanup)
        self.doc = Path(self.temp.name) / "Synthetic Score"
        self.doc.mkdir()
        self.status_file = self.doc / "status.json"
        self.annotations = {"mung.xml": b"<synthetic annotation='untouched'/>",
                            "image.png": b"synthetic image", "original.png": b"synthetic original"}
        for name, data in self.annotations.items():
            (self.doc / name).write_bytes(data)

    def write(self, data):
        self.status_file.write_text(json.dumps(data), encoding="utf-8")

    def update(self, body, writer=None):
        return patch_document_workflow(str(self.doc), body, "Synthetic Reviewer", writer or server.atomic_write)

    def assert_annotations_unchanged(self):
        for name, data in self.annotations.items():
            self.assertEqual((self.doc / name).read_bytes(), data)

    def test_absent_read_returns_four_defaults_without_creating_files(self):
        before = sorted(self.doc.iterdir())
        result = read_document_workflow(str(self.doc))
        self.assertEqual(result["status"], "not-started")
        self.assertEqual(set(result["stages"]), {"recognition", "assembly", "syntax", "temporal"})
        self.assertTrue(all(s == {"status": "not-started", "annotator": ""} for s in result["stages"].values()))
        self.assertEqual(sorted(self.doc.iterdir()), before)

    def test_legacy_read_only_maps_existing_status_to_recognition(self):
        self.write({"status": "done", "annotator": "Reviewer A", "custom": [1, 2]})
        before = self.status_file.read_bytes()
        before_mtime = self.status_file.stat().st_mtime_ns
        result = read_document_workflow(str(self.doc))
        self.assertEqual(result["stages"]["recognition"], {"status": "done", "annotator": "Reviewer A"})
        self.assertEqual(result["stages"]["assembly"]["status"], "not-started")
        self.assertEqual(result["stages"]["temporal"]["status"], "not-started")
        self.assertEqual(self.status_file.read_bytes(), before)
        self.assertEqual(self.status_file.stat().st_mtime_ns, before_mtime)

    def test_three_stage_read_and_syntax_patch_preserve_historical_progress(self):
        original = {"workflowVersion": 1, "stages": {
            stage: {"status": "done", "annotator": stage, "detail": [stage]}
            for stage in ("recognition", "assembly", "temporal")}}
        self.write(original)
        before = self.status_file.read_bytes()
        normalized = read_document_workflow(str(self.doc))
        self.assertEqual(normalized["stages"]["syntax"], {"status": "not-started", "annotator": ""})
        self.assertEqual(normalized["stages"]["assembly"]["status"], "done")
        self.assertEqual(self.status_file.read_bytes(), before)
        self.update({"stage": "syntax", "status": "pending-review", "annotator": "Syntax reviewer"})
        stored = json.loads(self.status_file.read_text())
        for stage in ("recognition", "assembly", "temporal"):
            self.assertEqual(stored["stages"][stage], original["stages"][stage])
        self.assertEqual(stored["stages"]["syntax"]["status"], "pending-review")
        self.assert_annotations_unchanged()

    def test_temporal_patch_preserves_legacy_and_unknown_fields(self):
        self.write({"status": "done", "annotator": "Reviewer A", "custom": {"keep": True},
                    "stages": {"assembly": {"status": "pending-review", "annotator": "B", "detail": 42},
                               "future-stage": {"opaque": [2, 3]}}})
        result = self.update({"stage": "temporal", "status": "in-progress", "annotator": "C"})
        stored = json.loads(self.status_file.read_text())
        self.assertEqual(result["status"], "done")
        self.assertEqual(result["annotator"], "Reviewer A")
        self.assertEqual(stored["stages"]["assembly"], {"status": "pending-review", "annotator": "B", "detail": 42})
        self.assertEqual(stored["stages"]["future-stage"], {"opaque": [2, 3]})
        self.assertEqual(stored["custom"], {"keep": True})
        self.assertEqual(stored["stages"]["temporal"]["updatedBy"], "Synthetic Reviewer")
        self.assert_annotations_unchanged()

    def test_old_client_patch_updates_only_recognition_and_preserves_annotator(self):
        self.update({"stage": "assembly", "status": "done", "annotator": "Assembler"})
        self.update({"stage": "temporal", "status": "pending-review", "annotator": "Timing"})
        self.update({"annotator": "Detector"})
        before = json.loads(self.status_file.read_text())
        result = self.update({"status": "done"})
        after = json.loads(self.status_file.read_text())
        self.assertEqual(result["status"], "done")
        self.assertEqual(result["annotator"], "Detector")
        self.assertEqual(result["stages"]["recognition"], {"status": "done", "annotator": "Detector"})
        self.assertEqual(before["stages"]["assembly"], after["stages"]["assembly"])
        self.assertEqual(before["stages"]["temporal"], after["stages"]["temporal"])

    def test_name_only_update_autostarts_only_target_and_preserves_explicit_status(self):
        first = self.update({"stage": "assembly", "annotator": "First"})
        self.assertEqual(first["stages"]["assembly"]["status"], "in-progress")
        self.assertEqual(first["status"], "not-started")
        self.update({"stage": "assembly", "status": "done"})
        second = self.update({"stage": "assembly", "annotator": "Second"})
        self.assertEqual(second["stages"]["assembly"]["status"], "done")
        third = self.update({"stage": "temporal", "annotator": "Explicit", "status": "not-started"})
        self.assertEqual(third["stages"]["temporal"]["status"], "not-started")
        self.update({"stage": "recognition", "annotator": "  "})
        self.assertEqual(read_document_workflow(str(self.doc))["status"], "not-started")

    def test_explicit_clear_annotator_does_not_reset_status(self):
        self.update({"stage": "temporal", "status": "done", "annotator": "A"})
        result = self.update({"stage": "temporal", "annotator": ""})
        self.assertEqual(result["stages"]["temporal"], {"status": "done", "annotator": ""})

    def test_unsupported_requests_preserve_existing_bytes(self):
        self.write({"status": "done", "annotator": "Original"})
        before = self.status_file.read_bytes()
        for body in [[], None, {}, {"stage": "temporal"}, {"stage": "other", "status": "done"},
                     {"stage": None, "status": "done"}, {"status": []}, {"status": "future"},
                     {"annotator": None}, {"annotator": "x" * 81}, {"status": "done", "stages": {}}]:
            with self.subTest(body=body):
                with self.assertRaises(InvalidWorkflowPatch):
                    self.update(body)
                self.assertEqual(self.status_file.read_bytes(), before)

    def test_corrupt_and_unsupported_stored_data_block_writes_without_clobbering(self):
        for value in [b"{broken", b"[]", b'{"status":"future"}', b'{"annotator":123}',
                      b'{"stages":[]}', b'{"stages":{"assembly":null}}',
                      b'{"stages":{"temporal":{"status":"future"}}}',
                      b'{"workflowVersion":2}', b'{"workflowVersion":true}',
                      b'{"status":"done","status":"not-started"}', b'{"extra":NaN}']:
            with self.subTest(value=value):
                self.status_file.write_bytes(value)
                result = read_document_workflow(str(self.doc))
                self.assertIn("workflowStatusError", result)
                with self.assertRaises(InvalidStoredWorkflow):
                    self.update({"stage": "temporal", "status": "done"})
                self.assertEqual(self.status_file.read_bytes(), value)

    def test_unserializable_opaque_fields_block_reads_and_writes_without_changing_bytes(self):
        values = [b'{"status":"done","opaque":1e999}',
                  b'{"status":"done","opaque":-1e999}',
                  b'{"status":"done","opaque":"\\ud800"}',
                  b'{"status":"done","\\udfff":"opaque-key"}']
        for value in values:
            with self.subTest(value=value):
                self.status_file.write_bytes(value)
                self.assertIn("workflowStatusError", read_document_workflow(str(self.doc)))
                writer = mock.Mock()
                with self.assertRaises(InvalidStoredWorkflow):
                    self.update({"stage": "temporal", "status": "done"}, writer=writer)
                writer.assert_not_called()
                self.assertEqual(self.status_file.read_bytes(), value)
        self.assert_annotations_unchanged()

    def test_annotator_invalid_unicode_is_rejected_and_valid_unicode_round_trips(self):
        self.write({"status": "done", "annotator": "Original"})
        before = self.status_file.read_bytes()
        for annotator in ("\ud800", "\udfff"):
            with self.subTest(codepoint=ord(annotator)):
                with self.assertRaises(InvalidWorkflowPatch):
                    self.update({"stage": "assembly", "annotator": annotator})
                self.assertEqual(self.status_file.read_bytes(), before)
        result = self.update({"stage": "assembly", "annotator": "Analyst Ä 🎵"})
        self.assertEqual(result["stages"]["assembly"]["annotator"], "Analyst Ä 🎵")
        self.assertEqual(read_document_workflow(str(self.doc))["stages"], result["stages"])

    def test_atomic_replace_failure_preserves_original_and_cleans_temporary_file(self):
        self.write({"status": "done", "annotator": "Original"})
        before = self.status_file.read_bytes()
        with mock.patch.object(server.os, "replace", side_effect=OSError("synthetic replace failure")):
            with self.assertRaises(OSError):
                self.update({"stage": "temporal", "status": "done"})
        self.assertEqual(self.status_file.read_bytes(), before)
        self.assertFalse(list(self.doc.glob(".mung-write-*")))
        self.assert_annotations_unchanged()

    def test_concurrent_different_stages_and_fields_never_lose_updates(self):
        for iteration in range(12):
            if self.status_file.exists():
                self.status_file.unlink()
            patches = [
                {"stage": "recognition", "status": "done"},
                {"stage": "recognition", "annotator": "Reader"},
                {"stage": "assembly", "status": "pending-review"},
                {"stage": "assembly", "annotator": "Assembler"},
                {"stage": "temporal", "status": "changes-requested"},
                {"stage": "temporal", "annotator": "Timer"},
                {"stage": "syntax", "status": "done"},
                {"stage": "syntax", "annotator": "Syntax reviewer"},
            ]
            barrier = threading.Barrier(len(patches))
            def perform(body):
                barrier.wait(timeout=5)
                return self.update(body)
            with concurrent.futures.ThreadPoolExecutor(max_workers=len(patches)) as pool:
                list(pool.map(perform, patches))
            result = read_document_workflow(str(self.doc))
            self.assertEqual(result["stages"], {
                "recognition": {"status": "done", "annotator": "Reader"},
                "assembly": {"status": "pending-review", "annotator": "Assembler"},
                "temporal": {"status": "changes-requested", "annotator": "Timer"},
                "syntax": {"status": "done", "annotator": "Syntax reviewer"}})
        self.assert_annotations_unchanged()

    def test_reloaded_store_round_trips_all_stages(self):
        for stage, status in (("recognition", "done"), ("assembly", "pending-review"), ("syntax", "done"), ("temporal", "in-progress")):
            self.update({"stage": stage, "status": status, "annotator": stage.title()})
        source = BACKEND_DIR / "document_workflow.py"
        spec = importlib.util.spec_from_file_location("fresh_workflow", source)
        fresh = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fresh)
        self.assertEqual(fresh.read_document_workflow(str(self.doc)), read_document_workflow(str(self.doc)))


class WorkflowHandlerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="mung-workflow-http-")
        cls.root = Path(cls.temp.name)
        server.DOCUMENTS_PATH = str(cls.root)
        server.AUDIT_LOG_PATH = str(cls.root / "synthetic-audit.log")
        server.REVIEW_COMMENT_STORE = server.ReviewCommentStore(str(cls.root))
        class SilentHandler(server.Handler):
            def log_message(self, *args):
                pass
        cls.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), SilentHandler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = "http://127.0.0.1:%d/" % cls.httpd.server_port

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=5)
        cls.temp.cleanup()

    def setUp(self):
        self.name = self._testMethodName
        self.doc = self.root / self.name
        self.doc.mkdir()
        (self.doc / "mung.xml").write_bytes(b"<synthetic/>")
        (self.doc / "image.png").write_bytes(b"image")
        self.status_file = self.doc / "status.json"

    def request(self, body=None, *, raw=None, action="set-doc-status", document=None, authenticated=True):
        query = "?action=" + action
        if action == "set-doc-status":
            query += "&document=" + (document or self.name)
        headers = {"Content-Type": "application/json"}
        if authenticated:
            headers["Authorization"] = "Bearer " + _SYNTHETIC_AUTH
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        request = urllib.request.Request(self.url + query, data=data, headers=headers,
                                         method="GET" if action in {"list-documents", "version"} else "POST")
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as exc:
            try:
                content = exc.read()
            finally:
                exc.close()
            try:
                result = json.loads(content)
            except ValueError:
                result = {"error": "HTTP error"}
            return exc.code, result

    def listed(self):
        code, result = self.request(action="list-documents")
        self.assertEqual(code, 200)
        return next(d for d in result["documents"] if d["name"] == self.name)

    def test_real_list_handler_legacy_read_is_not_a_migration(self):
        self.status_file.write_text('{"status":"done","annotator":"Legacy","keep":true}')
        before = self.status_file.read_bytes()
        before_mtime = self.status_file.stat().st_mtime_ns
        result = self.listed()
        self.assertEqual(result["status"], "done")
        self.assertEqual(result["stages"]["recognition"], {"status": "done", "annotator": "Legacy"})
        self.assertEqual(result["stages"]["assembly"]["status"], "not-started")
        self.assertEqual(result["stages"]["temporal"]["status"], "not-started")
        self.assertEqual(self.status_file.read_bytes(), before)
        self.assertEqual(self.status_file.stat().st_mtime_ns, before_mtime)

    def test_real_handler_stage_updates_persist_and_old_client_preserves_other_stages(self):
        code, first = self.request({"stage": "temporal", "status": "done", "annotator": "T"})
        self.assertEqual(code, 200)
        self.assertTrue(first["ok"])
        self.assertEqual(first["status"], "not-started")
        self.assertEqual(first["stages"]["temporal"], {"status": "done", "annotator": "T"})
        self.assertEqual(self.request({"stage": "assembly", "annotator": "A"})[0], 200)
        code, old_client = self.request({"status": "pending-review", "annotator": "R"})
        self.assertEqual(code, 200)
        listed = self.listed()
        self.assertEqual(listed["status"], "pending-review")
        self.assertEqual(listed["stages"], old_client["stages"])
        self.assertEqual(listed["stages"]["assembly"], {"status": "in-progress", "annotator": "A"})
        self.assertEqual(listed["stages"]["temporal"], {"status": "done", "annotator": "T"})
        self.assertEqual((self.doc / "mung.xml").read_bytes(), b"<synthetic/>")
        self.assertEqual((self.doc / "image.png").read_bytes(), b"image")

    def test_real_handler_partial_status_and_name_updates_preserve_other_field(self):
        self.request({"stage": "assembly", "status": "done", "annotator": "A"})
        self.request({"stage": "assembly", "annotator": "B"})
        self.request({"stage": "assembly", "status": "pending-review"})
        self.assertEqual(self.listed()["stages"]["assembly"], {"status": "pending-review", "annotator": "B"})

    def test_real_handler_concurrent_cross_stage_updates(self):
        patches = [{"stage": "recognition", "status": "done", "annotator": "R"},
                   {"stage": "assembly", "status": "pending-review", "annotator": "A"},
                   {"stage": "temporal", "status": "changes-requested", "annotator": "T"},
                   {"stage": "syntax", "status": "done", "annotator": "S"}]
        barrier = threading.Barrier(len(patches))
        def send(body):
            barrier.wait(timeout=5)
            return self.request(body)
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(patches)) as pool:
            results = list(pool.map(send, patches))
        self.assertTrue(all(code == 200 for code, _ in results))
        result = self.listed()
        self.assertEqual(result["stages"], {p["stage"]: {"status": p["status"], "annotator": p["annotator"]} for p in patches})

    def test_real_handler_invalid_body_never_creates_status(self):
        for raw in (b"{", b"[]", b"null", b"{}", b'{"stage":"bad","status":"done"}',
                    b'{"annotator":42}', b'{"status":"bad"}', b" " * 17000):
            with self.subTest(raw=raw[:50]):
                self.assertEqual(self.request(raw=raw)[0], 400)
                self.assertFalse(self.status_file.exists())

    def test_real_handler_corrupt_storage_returns_conflict_and_list_warning(self):
        self.status_file.write_bytes(b"{broken")
        code, result = self.request({"stage": "temporal", "status": "done"})
        self.assertEqual(code, 409)
        self.assertIn("not changed", result["error"])
        self.assertIn("workflowStatusError", self.listed())
        self.assertEqual(self.status_file.read_bytes(), b"{broken")

    def test_real_handler_unsafe_stored_values_return_conflict_and_list_warning(self):
        for original in (b'{"status":"done","opaque":1e999}',
                         b'{"status":"done","opaque":"\\ud800"}'):
            with self.subTest(original=original):
                self.status_file.write_bytes(original)
                code, result = self.request({"stage": "temporal", "status": "done"})
                self.assertEqual(code, 409)
                self.assertIn("not changed", result["error"])
                self.assertIn("workflowStatusError", self.listed())
                self.assertEqual(self.status_file.read_bytes(), original)

    def test_real_handler_invalid_unicode_annotator_returns_bad_request_without_write(self):
        original = b'{"status":"done","annotator":"Original"}'
        self.status_file.write_bytes(original)
        code, result = self.request(raw=b'{"stage":"temporal","annotator":"\\ud800"}')
        self.assertEqual(code, 400)
        self.assertIn("Unicode", result["error"])
        self.assertEqual(self.status_file.read_bytes(), original)

    def test_real_handler_write_failure_returns_error_preserving_original(self):
        original = b'{"status":"done","annotator":"A"}'
        self.status_file.write_bytes(original)
        with mock.patch.object(server, "atomic_write", side_effect=OSError("synthetic failure")), contextlib.redirect_stderr(io.StringIO()):
            code, result = self.request({"stage": "temporal", "status": "done"})
        self.assertEqual(code, 500)
        self.assertIn("Could not save", result["error"])
        self.assertEqual(self.status_file.read_bytes(), original)

    def test_real_handler_audit_failure_does_not_report_committed_save_as_failed(self):
        with mock.patch.object(server, "log_to_file", side_effect=OSError("synthetic audit failure")), contextlib.redirect_stderr(io.StringIO()):
            code, result = self.request({"stage": "temporal", "status": "done"})
        self.assertEqual(code, 200)
        self.assertEqual(self.listed()["stages"]["temporal"]["status"], "done")

    def test_actual_auth_rejects_missing_identity_without_write(self):
        self.assertEqual(self.request({"status": "done"}, authenticated=False)[0], 401)
        self.assertEqual(self.request(action="list-documents", authenticated=False)[0], 401)
        self.assertFalse(self.status_file.exists())

    def test_version_exposes_fixed_workflow_capability_without_auth_or_document_writes(self):
        before = sorted(self.doc.iterdir())
        with mock.patch("subprocess.run", return_value=SimpleNamespace(stdout="synthetic-revision")):
            code, result = self.request(action="version", authenticated=False)
        self.assertEqual(code, 200)
        self.assertEqual(result, {"commit": "synthetic-revision", "frontendBuiltAt": None,
                                  "workflowStages": ["recognition", "assembly", "syntax", "temporal"],
                                  "modelActions": ["symbols", "syntaxLinks", "timeGroups",
                                                   "precedence", "conversion"]})
        self.assertEqual(sorted(self.doc.iterdir()), before)

    def test_invalid_or_missing_document_is_rejected_without_write(self):
        self.assertEqual(self.request({"status": "done"}, document="../outside")[0], 400)
        self.assertEqual(self.request({"status": "done"}, document="NoSuchSyntheticDoc")[0], 404)
        self.assertFalse(self.status_file.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
