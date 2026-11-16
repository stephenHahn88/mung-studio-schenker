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
SPEC = importlib.util.spec_from_file_location("custom_class_api_server", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Could not load {MODULE_PATH}")
server = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = server
SPEC.loader.exec_module(server)


class CustomClassApiTest(unittest.TestCase):
    def _handler(self, body: dict[str, str] | None = None):
        handler = object.__new__(server.Handler)
        raw_body = json.dumps(body or {}).encode("utf-8")
        handler.headers = {"Content-Length": str(len(raw_body))}
        handler.rfile = io.BytesIO(raw_body)
        handler._authenticate = lambda: {"name": "Class Tester"}
        responses: list[tuple[dict[str, object], int]] = []
        handler._send_json = lambda payload, status=200: responses.append(
            (payload, status)
        )
        return handler, responses

    def test_add_class_writes_only_the_shared_registry(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            doc_dir = Path(tmp) / "page-one"
            doc_dir.mkdir()
            mung_path = doc_dir / "mung.xml"
            mung_contents = "<mung-document>existing annotation</mung-document>"
            mung_path.write_text(mung_contents, encoding="utf-8")
            registry = server.CustomClassRegistry(Path(tmp) / "custom_classes.json")
            handler, responses = self._handler({"name": "prolongationBracket"})

            with (
                mock.patch.object(server, "CUSTOM_CLASS_REGISTRY", registry),
                mock.patch.object(server, "log_to_file"),
            ):
                handler._action_add_custom_class()

            self.assertEqual(responses[0][1], 200)
            self.assertTrue(responses[0][0]["created"])
            self.assertEqual(
                responses[0][0]["class"]["name"], "prolongationBracket"
            )
            self.assertEqual(mung_path.read_text(encoding="utf-8"), mung_contents)
            self.assertEqual(registry.list_classes()[0]["name"], "prolongationBracket")

    def test_invalid_class_does_not_create_registry(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            registry_path = Path(tmp) / "custom_classes.json"
            registry = server.CustomClassRegistry(registry_path)
            handler, responses = self._handler({"name": "two words"})

            with mock.patch.object(server, "CUSTOM_CLASS_REGISTRY", registry):
                handler._action_add_custom_class()

            self.assertEqual(responses[0][1], 400)
            self.assertFalse(registry_path.exists())

    def test_set_and_clear_color_do_not_touch_mung(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            doc_dir = Path(tmp) / "page-one"
            doc_dir.mkdir()
            mung_path = doc_dir / "mung.xml"
            original = b"<mung-document>keep me unchanged</mung-document>"
            mung_path.write_bytes(original)
            registry = server.CustomClassRegistry(Path(tmp) / "custom_classes.json")

            set_handler, set_responses = self._handler(
                {"className": "noteheadBlack", "color": "#123456"}
            )
            with (
                mock.patch.object(server, "CUSTOM_CLASS_REGISTRY", registry),
                mock.patch.object(server, "log_to_file"),
            ):
                set_handler._action_set_class_color()

            self.assertEqual(set_responses[0][1], 200)
            self.assertEqual(
                set_responses[0][0]["colorOverrides"]["noteheadBlack"],
                "#123456",
            )
            self.assertEqual(mung_path.read_bytes(), original)

            clear_handler, clear_responses = self._handler(
                {"className": "noteheadBlack"}
            )
            with (
                mock.patch.object(server, "CUSTOM_CLASS_REGISTRY", registry),
                mock.patch.object(server, "log_to_file"),
            ):
                clear_handler._action_clear_class_color()

            self.assertEqual(clear_responses[0][1], 200)
            self.assertEqual(clear_responses[0][0]["colorOverrides"], {})
            self.assertEqual(mung_path.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
