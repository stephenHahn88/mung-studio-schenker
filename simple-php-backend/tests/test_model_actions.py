"""Tests of the model actions with small stand-in components.

A temporary repository root holds stand-in versions of the inference modules
of experiments/ and of the conversion package. They record their arguments in
calls/<action>.json and return fixed outputs, so the tests check the model
processes, the calling conventions and the output checks without any model.
"""

from __future__ import annotations

import importlib.util
import io
import json
import os
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from model_actions import (  # noqa: E402
    DEFAULT_MODEL_FILES,
    InvalidModelOutput,
    InvalidModelRequest,
    ModelActions,
    ModelBusy,
    ModelConfig,
    ModelFailed,
    ModelUnavailable,
    convert_groups,
    convert_links,
    parse_nodes,
    parse_region,
)

SPEC = importlib.util.spec_from_file_location(
    "model_actions_server", BACKEND_DIR / "server.py"
)
server = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = server
SPEC.loader.exec_module(server)

RECORD = '''
import json, os, time
from pathlib import Path

def record(action, arguments):
    root = next(p for p in Path(__file__).resolve().parents if (p / "experiments").is_dir())
    folder = root / "calls"
    folder.mkdir(exist_ok=True)
    (folder / f"{action}.json").write_text(json.dumps(arguments))
    mode = os.environ.get("STUB_MODE", "")
    if mode == "crash":
        os._exit(3)
    if mode == "sleep":
        time.sleep(5)
    if mode == "missing":
        import package_that_is_not_installed  # noqa: F401
    if mode == "fail":
        raise RuntimeError("the weights do not match")
'''

SYMBOL_STUB = RECORD + '''
import common

def detect_symbols(image_path, yolo_weights, rfdetr_weights, class_names,
                   region=None, score_threshold=None, device="cpu"):
    record("symbols", dict(image_path=image_path, yolo_weights=yolo_weights,
                           rfdetr_weights=rfdetr_weights, class_names=class_names,
                           region=region, score_threshold=score_threshold,
                           device=device))
    print("library output on standard output")
    return [
        {"class_name": "noteheadBlack", "left": 10.5, "top": 10.0,
         "width": 10.0, "height": 8.25, "score": 0.9},
        {"class_name": "stemStructural", "left": 70.0, "top": 5.0,
         "width": 3.0, "height": 40.0, "score": common.SCORE},
    ]
'''

SYNTAX_STUB = RECORD + '''
import common

def predict_syntax_links(nodes, image_size, model_dir, device="cpu"):
    record("syntaxLinks", dict(nodes=nodes, image_size=image_size,
                               model_dir=model_dir, device=device))
    return [{"source_id": 2, "target_id": 1, "score": common.SCORE},
            {"source_id": 3, "target_id": 1, "score": 0.25}]
'''

TEMPORAL_STUB = RECORD + '''
try:
    import numpy
    SCORE = numpy.float32(0.75)
except ImportError:
    SCORE = 0.75

def predict_time_groups(nodes, image_size, model_path):
    record("timeGroups", dict(nodes=nodes, image_size=image_size, model_path=model_path))
    return [[1, 3], [4]]

def predict_precedence(nodes, image_size, model_path):
    record("precedence", dict(nodes=nodes, image_size=image_size, model_path=model_path))
    if os.environ.get("STUB_MODE") == "unknown-id":
        return [{"source_id": 1, "target_id": 99, "score": 0.5}]
    return [{"source_id": 1, "target_id": 4, "score": SCORE}]
'''

CONVERSION_STUB = RECORD + '''
def convert_page(mung_xml_path, image_path=None):
    record("conversion", dict(mung_xml_path=mung_xml_path, image_path=image_path))
    if "reject" in mung_xml_path:
        raise ValueError("Only single-system pages can be converted.")
    return {"schenkernote": {"trebleNotes": []}, "warnings": []}
'''


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(text), encoding="utf-8")


class Repo:
    """A temporary repository root with stand-in components and model files."""

    def __init__(self):
        self.temp = tempfile.TemporaryDirectory(prefix="mung-model-test-")
        self.root = Path(self.temp.name)
        symbol = self.root / "experiments/symbol_recognition"
        syntax = self.root / "experiments/syntax_links"
        write(symbol / "inference.py", SYMBOL_STUB)
        write(symbol / "common.py", "SCORE = 0.8\n")
        write(syntax / "inference.py", SYNTAX_STUB)
        write(syntax / "common.py", "SCORE = 0.5\n")
        write(self.root / "experiments/temporal_relations/inference.py", TEMPORAL_STUB)
        write(self.root / "conversion/__init__.py", CONVERSION_STUB)
        write(self.root / "experiments/symbol_recognition/data/categories.json", json.dumps(
            [{"id": 1, "name": "stemStructural"}, {"id": 0, "name": "noteheadBlack"}]))
        for name, relative in DEFAULT_MODEL_FILES.items():
            if name == "MUNG_SYNTAX_MODEL_DIR":
                (self.root / "models" / relative).mkdir(parents=True)
            else:
                write(self.root / "models" / relative, "weights")
        self.image = self.root / "page.png"
        Image.new("L", (120, 80), 255).save(self.image)

    def config(self, **extra) -> ModelConfig:
        return ModelConfig.from_env({"MUNG_REPO_ROOT": str(self.root), **extra})

    def actions(self, **extra) -> ModelActions:
        return ModelActions(self.config(**extra))

    def call(self, action: str) -> dict:
        return json.loads((self.root / "calls" / f"{action}.json").read_text())

    def cleanup(self):
        self.temp.cleanup()


NODES = [
    {"id": 3, "className": "noteheadBlack", "left": 10, "top": 40, "width": 8, "height": 6},
    {"id": 1, "className": "noteheadBlack", "left": 10, "top": 10, "width": 8, "height": 6},
    {"id": 2, "className": "stemStructural", "left": 17, "top": 0, "width": 2, "height": 14},
    {"id": 4, "className": "noteheadHalf", "left": 50, "top": 10, "width": 8, "height": 6.5},
]


class ModelActionsTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo()
        self.addCleanup(self.repo.cleanup)

    def stub_mode(self, mode: str):
        patch = mock.patch.dict(os.environ, {"STUB_MODE": mode})
        patch.start()
        self.addCleanup(patch.stop)

    def test_defaults_point_to_the_released_models(self):
        config = self.repo.config()
        models = self.repo.root / "models"
        self.assertEqual(config.yolo_weights,
                         models / "symbol_recognition/yolov8l/HandSchA_seed20261021.pt")
        self.assertEqual(config.rfdetr_weights,
                         models / "symbol_recognition/rfdetr_branch/HandSchA_seed43.pth")
        self.assertEqual(config.syntax_model_dir,
                         models / "syntax_links/incidence/handscha/heldout/seed_42")
        self.assertEqual(config.time_group_model, models /
                         "temporal_relations/hgb/time_groups_heldout_rachmaninov_seed42.joblib")
        self.assertEqual(config.precedence_model, models /
                         "temporal_relations/hgb/precedence_heldout_rachmaninov_seed43.joblib")
        self.assertEqual(config.symbol_categories,
                         self.repo.root / "experiments/symbol_recognition/data/categories.json")
        self.assertEqual(config.score_threshold, 0.6)
        self.assertEqual(set(config.python.values()), {sys.executable})
        self.assertTrue(all(item["available"]
                            for item in ModelActions(config).availability().values()))

    def test_paths_and_interpreters_from_the_environment(self):
        other = Path(self.repo.temp.name) / "elsewhere"
        config = self.repo.config(
            MUNG_MODELS_DIR=str(other),
            MUNG_TIME_GROUP_MODEL="t.joblib",
            MUNG_PRECEDENCE_MODEL="/abs/p.joblib",
            MUNG_MODEL_PYTHON="/env/a/python",
            MUNG_SYMBOL_PYTHON=".venv-symbols/bin/python",
            MUNG_CONVERSION_PYTHON="python3",
            MUNG_SYMBOL_SCORE_THRESHOLD="0",
        )
        self.assertEqual(config.time_group_model, other / "t.joblib")
        self.assertEqual(config.precedence_model, Path("/abs/p.joblib"))
        self.assertEqual(config.yolo_weights, other / DEFAULT_MODEL_FILES["MUNG_SYMBOL_YOLO_WEIGHTS"])
        self.assertEqual(config.python["symbols"],
                         str(self.repo.root / ".venv-symbols/bin/python"))
        self.assertEqual(config.python["timeGroups"], "/env/a/python")
        self.assertEqual(config.python["conversion"], "python3")
        self.assertEqual(config.score_threshold, 0.0)

    def test_missing_code_or_models_are_reported(self):
        actions = ModelActions(ModelConfig.from_env(
            {"MUNG_REPO_ROOT": self.repo.temp.name + "/none"}))
        availability = actions.availability()
        self.assertEqual(set(availability), {"symbols", "syntaxLinks", "timeGroups",
                                             "precedence", "conversion"})
        self.assertTrue(all(not item["available"] for item in availability.values()))
        self.assertIn("inference.py was not found", availability["symbols"]["reason"])
        (self.repo.root / "models" / DEFAULT_MODEL_FILES["MUNG_TIME_GROUP_MODEL"]).unlink()
        reason = self.repo.actions().availability()["timeGroups"]["reason"]
        self.assertIn("MUNG_TIME_GROUP_MODEL", reason)
        with self.assertRaises(ModelUnavailable):
            self.repo.actions().predict_time_groups(NODES, (120, 80))

    def test_disabled_inference_is_reported_as_unavailable(self):
        availability = self.repo.actions(MUNG_ENABLE_INFERENCE="0").availability()
        self.assertFalse(availability["symbols"]["available"])
        self.assertFalse(availability["precedence"]["available"])
        self.assertTrue(availability["conversion"]["available"])
        availability = self.repo.actions(MUNG_ENABLE_RELATION_INFERENCE="off").availability()
        self.assertTrue(availability["symbols"]["available"])
        self.assertFalse(availability["syntaxLinks"]["available"])

    def test_detect_symbols_passes_the_documented_arguments(self):
        actions = self.repo.actions(MUNG_MODEL_DEVICE="cuda:0")
        result = actions.detect_symbols(
            str(self.repo.image), (120, 80),
            region={"left": -5, "top": 0.5, "width": 60, "height": 30},
            score_threshold=0.25,
        )
        call = self.repo.call("symbols")
        models = self.repo.root / "models"
        self.assertEqual(call, {
            "image_path": str(self.repo.image),
            "yolo_weights": str(models / DEFAULT_MODEL_FILES["MUNG_SYMBOL_YOLO_WEIGHTS"]),
            "rfdetr_weights": str(models / DEFAULT_MODEL_FILES["MUNG_SYMBOL_RFDETR_WEIGHTS"]),
            "class_names": ["noteheadBlack", "stemStructural"],
            "region": [0, 0, 55, 31],
            "score_threshold": 0.25,
            "device": "cuda:0",
        })
        # The detections are passed on unchanged (also the stem outside the region).
        self.assertEqual(result["predictions"], [
            {"className": "noteheadBlack", "left": 10.5, "top": 10.0,
             "width": 10.0, "height": 8.25, "confidence": 0.9},
            {"className": "stemStructural", "left": 70.0, "top": 5.0,
             "width": 3.0, "height": 40.0, "confidence": 0.8},
        ])
        self.assertEqual(result["image"], {"width": 120, "height": 80})
        self.assertEqual(result["region"], {"left": 0, "top": 0, "width": 55, "height": 31})
        self.assertEqual(result["model"], "yolov8l/HandSchA_seed20261021.pt+"
                                          "rfdetr_branch/HandSchA_seed43.pth")

    def test_default_threshold_comes_from_the_configuration(self):
        result = self.repo.actions().detect_symbols(str(self.repo.image), (120, 80))
        self.assertEqual(result["scoreThreshold"], 0.6)
        self.assertEqual(self.repo.call("symbols")["region"], None)
        result = self.repo.actions(MUNG_SYMBOL_SCORE_THRESHOLD="0.4").detect_symbols(
            str(self.repo.image), (120, 80))
        self.assertEqual(self.repo.call("symbols")["score_threshold"], 0.4)
        with self.assertRaises(InvalidModelRequest):
            self.repo.actions().detect_symbols(str(self.repo.image), (120, 80),
                                               score_threshold=2)

    def test_relation_models_receive_sorted_nodes(self):
        actions = self.repo.actions()
        links = actions.predict_syntax_links(NODES, (120, 80))
        call = self.repo.call("syntaxLinks")
        self.assertEqual(call["image_size"], [120, 80])
        self.assertEqual(call["model_dir"], str(actions.config.syntax_model_dir))
        self.assertEqual(call["device"], "cpu")
        self.assertEqual([n["id"] for n in call["nodes"]], [1, 2, 3, 4])
        self.assertEqual(call["nodes"][3], {"id": 4, "class_name": "noteheadHalf",
                                            "left": 50, "top": 10, "width": 8, "height": 6.5})
        self.assertEqual(links, {
            "model": "syntax_links/incidence/handscha/heldout/seed_42",
            "links": [{"source": 2, "target": 1, "score": 0.5},
                      {"source": 3, "target": 1, "score": 0.25}],
        })
        groups = actions.predict_time_groups(NODES, (120, 80))
        self.assertEqual(groups["groups"], [[1, 3], [4]])
        self.assertEqual(self.repo.call("timeGroups")["model_path"],
                         str(actions.config.time_group_model))
        precedence = actions.predict_precedence(NODES, (120, 80))
        self.assertEqual(precedence["links"], [{"source": 1, "target": 4, "score": 0.75}])
        self.assertEqual(self.repo.call("precedence")["model_path"],
                         str(actions.config.precedence_model))

    def test_components_with_equal_module_names_stay_apart(self):
        # Both stand-in components import their own top-level module "common".
        actions = self.repo.actions()
        symbols = actions.detect_symbols(str(self.repo.image), (120, 80), score_threshold=0)
        links = actions.predict_syntax_links(NODES, (120, 80))
        again = actions.detect_symbols(str(self.repo.image), (120, 80), score_threshold=0)
        self.assertEqual(symbols["predictions"][1]["confidence"], 0.8)
        self.assertEqual(links["links"][0]["score"], 0.5)
        self.assertEqual(again, symbols)
        self.assertNotIn("common", sys.modules)

    def test_convert_page_calls_the_conversion_package(self):
        result = self.repo.actions().convert_page("page/mung.xml", image_path="page/image.jpg")
        self.assertEqual(result, {"schenkernote": {"trebleNotes": []}, "warnings": []})
        self.assertEqual(self.repo.call("conversion"),
                         {"mung_xml_path": "page/mung.xml", "image_path": "page/image.jpg"})
        with self.assertRaisesRegex(ValueError, "single-system"):
            self.repo.actions().convert_page("reject/mung.xml")

    def test_model_process_errors(self):
        actions = self.repo.actions()
        self.stub_mode("missing")
        with self.assertRaisesRegex(ModelUnavailable, "package_that_is_not_installed"):
            actions.predict_syntax_links(NODES, (120, 80))
        self.stub_mode("fail")
        with self.assertRaisesRegex(ModelFailed, "RuntimeError: the weights do not match"):
            actions.detect_symbols(str(self.repo.image), (120, 80))
        with self.assertRaises(ModelFailed):
            # A ValueError is a rejected page only for the conversion.
            actions.convert_page("page/mung.xml")
        self.stub_mode("crash")
        with self.assertRaisesRegex(ModelFailed, "exit code 3"):
            actions.predict_time_groups(NODES, (120, 80))
        self.stub_mode("unknown-id")
        with self.assertRaises(InvalidModelOutput):
            actions.predict_precedence(NODES, (120, 80))
        self.stub_mode("sleep")
        with self.assertRaisesRegex(ModelFailed, "did not finish"):
            self.repo.actions(MUNG_MODEL_TIMEOUT="1").predict_precedence(NODES, (120, 80))
        with self.assertRaisesRegex(ModelUnavailable, "MUNG_TEMPORAL_PYTHON"):
            self.repo.actions(MUNG_TEMPORAL_PYTHON="/no/such/python").predict_precedence(
                NODES, (120, 80))

    def test_one_action_at_a_time(self):
        actions = self.repo.actions()
        actions._semaphore.acquire()
        try:
            with self.assertRaises(ModelBusy):
                actions.predict_time_groups(NODES, (120, 80))
        finally:
            actions._semaphore.release()
        self.assertEqual(actions.predict_time_groups(NODES, (120, 80))["groups"], [[1, 3], [4]])

    def test_parsers_reject_invalid_requests_and_outputs(self):
        with self.assertRaises(InvalidModelRequest):
            parse_nodes([{"id": 1, "className": "x", "left": 0, "top": 0,
                          "width": 0, "height": 1}])
        with self.assertRaises(InvalidModelRequest):
            parse_nodes(NODES + [dict(NODES[0])])
        with self.assertRaises(InvalidModelRequest):
            parse_nodes([{"id": True, "className": "x", "left": 0, "top": 0,
                          "width": 1, "height": 1}])
        with self.assertRaises(InvalidModelRequest):
            parse_region({"left": 200, "top": 0, "width": 10, "height": 10}, (120, 80))
        self.assertIsNone(parse_region(None, (120, 80)))
        with self.assertRaises(InvalidModelOutput):
            convert_links([{"source_id": 1, "target_id": 2, "score": float("nan")}], {1, 2})
        with self.assertRaises(InvalidModelOutput):
            convert_links("not a list", {1})
        with self.assertRaises(InvalidModelOutput):
            convert_groups([[1, "2"]], {1, 2})
        self.assertEqual(convert_groups([[2, 1]], {1, 2}), [[2, 1]])


class ModelHttpTest(unittest.TestCase):
    """Calls the real request handlers with a stand-in repository."""

    def setUp(self):
        self.repo = Repo()
        self.addCleanup(self.repo.cleanup)
        self.documents = Path(self.repo.temp.name) / "documents"
        for name in ("Synthetic page", "reject page"):
            page = self.documents / name
            page.mkdir(parents=True)
            Image.new("L", (120, 80), 255).save(page / "image.png")
            (page / "mung.xml").write_text("<Nodes/>", encoding="utf-8")
        patches = [
            mock.patch.object(server, "DOCUMENTS_PATH", str(self.documents)),
            mock.patch.object(server, "AUDIT_LOG_PATH", str(self.documents / "audit_log.txt")),
            mock.patch.object(server, "MODELS", self.repo.actions()),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def call(self, method, body=None, params=None):
        handler = object.__new__(server.Handler)
        raw = json.dumps(body).encode("utf-8") if body is not None else b""
        handler.headers = {"Content-Length": str(len(raw))}
        handler.rfile = io.BytesIO(raw)
        handler._authenticate = lambda: {"name": "Model Tester", "token": "t"}
        responses = []
        handler._send_json = lambda payload, status=200: responses.append((payload, status))
        if params is None:
            method(handler)
        else:
            method(handler, params)
        self.assertEqual(len(responses), 1)
        return responses[0]

    def test_detect_symbols_reads_the_page_image(self):
        payload, status = self.call(server.Handler._action_detect_symbols,
                                    {"document": "Synthetic page", "region": None,
                                     "scoreThreshold": None})
        self.assertEqual(status, 200)
        self.assertEqual(len(payload["predictions"]), 2)
        self.assertEqual(payload["image"], {"width": 120, "height": 80})
        self.assertEqual(self.repo.call("symbols")["image_path"],
                         str(self.documents / "Synthetic page" / "image.png"))

    def test_relation_actions_and_errors(self):
        payload, status = self.call(
            lambda h: server.Handler._action_predict_relations(h, "timeGroups"),
            {"document": "Synthetic page", "nodes": NODES})
        self.assertEqual((status, payload["groups"]), (200, [[1, 3], [4]]))
        payload, status = self.call(
            lambda h: server.Handler._action_predict_relations(h, "syntaxLinks"),
            {"document": "../outside", "nodes": NODES})
        self.assertEqual(status, 400)
        payload, status = self.call(
            lambda h: server.Handler._action_predict_relations(h, "precedence"),
            {"document": "Synthetic page", "nodes": "invalid"})
        self.assertEqual(status, 400)
        payload, status = self.call(
            lambda h: server.Handler._action_predict_relations(h, "precedence"),
            {"document": "Missing page", "nodes": NODES})
        self.assertEqual(status, 404)
        with mock.patch.dict(os.environ, {"STUB_MODE": "fail"}):
            payload, status = self.call(
                lambda h: server.Handler._action_predict_relations(h, "precedence"),
                {"document": "Synthetic page", "nodes": NODES})
        self.assertEqual(status, 500)
        self.assertIn("the weights do not match", payload["error"])

    def test_unconfigured_model_returns_503(self):
        with mock.patch.object(server, "MODELS", self.repo.actions(MUNG_ENABLE_INFERENCE="0")):
            payload, status = self.call(server.Handler._action_detect_symbols,
                                        {"document": "Synthetic page"})
        self.assertEqual(status, 503)
        self.assertIn("disabled", payload["error"])

    def test_convert_document_returns_json_or_a_rejection(self):
        payload, status = self.call(server.Handler._action_convert_document,
                                    params={"document": ["Synthetic page"]})
        self.assertEqual(status, 200)
        self.assertEqual(payload, {"document": "Synthetic page",
                                   "result": {"schenkernote": {"trebleNotes": []},
                                              "warnings": []}})
        self.assertEqual(self.repo.call("conversion"), {
            "mung_xml_path": str(self.documents / "Synthetic page" / "mung.xml"),
            "image_path": str(self.documents / "Synthetic page" / "image.png"),
        })
        payload, status = self.call(server.Handler._action_convert_document,
                                    params={"document": ["reject page"]})
        self.assertEqual(status, 422)
        self.assertIn("single-system", payload["error"])

    def test_list_models(self):
        payload, status = self.call(server.Handler._action_list_models)
        self.assertEqual(status, 200)
        self.assertTrue(payload["models"]["symbols"]["available"])


if __name__ == "__main__":
    unittest.main()
