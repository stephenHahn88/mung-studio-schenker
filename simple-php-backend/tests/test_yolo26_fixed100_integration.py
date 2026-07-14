from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest import mock

import numpy as np
from PIL import Image


BACKEND_DIR = Path(__file__).resolve().parents[1]
MODULE_PATH = BACKEND_DIR / "yolo26_inference.py"
FRONTEND_MODULE_PATH = (
    BACKEND_DIR.parent / "src" / "editor" / "controller" / "Yolo26DetectionApi.ts"
)
SPEC = importlib.util.spec_from_file_location("staging_yolo26_inference", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Could not load {MODULE_PATH}")
yolo26 = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = yolo26
SPEC.loader.exec_module(yolo26)


class FakeCenterOwnedAdapter:
    def __init__(self) -> None:
        self.spec = yolo26.DetectionModelSpec(
            key=yolo26.YOLO26_ALL9_FIXED_EP100_TILED_KEY,
            label="fixed100 test adapter",
            role="small",
            backend="yolo",
            path=Path("/unused"),
            tile_ownership=yolo26.TILE_OWNERSHIP_CENTER_VORONOI,
        )
        self.names = {0: "noteheadFull"}
        self.calls = 0

    def predict_boxes(self, image, imgsz, conf, device):
        # The same global box is predicted by two horizontally overlapping tiles.
        # Its center is exactly their Voronoi boundary at global x=1088.
        boxes = (
            np.array([[1078.0, 100.0, 1098.0, 120.0]])
            if self.calls == 0
            else np.array([[118.0, 100.0, 138.0, 120.0]])
        )
        score = 0.9 if self.calls == 0 else 0.8
        self.calls += 1
        return boxes, np.array([score]), np.array([0], dtype=int)

    def get_raw_class_name(self, class_id: int) -> str:
        return self.names[int(class_id)]


class FakeLegacyOwnedAdapter(FakeCenterOwnedAdapter):
    def __init__(self) -> None:
        super().__init__()
        self.spec = yolo26.DETECTION_MODEL_SPECS_BY_KEY[
            yolo26.YOLO26_TILED_9PAGES_EP200_LEGACY_KEY
        ]


class FakeEp200CenterOwnedAdapter(FakeCenterOwnedAdapter):
    def __init__(self) -> None:
        super().__init__()
        self.spec = yolo26.DETECTION_MODEL_SPECS_BY_KEY[
            yolo26.YOLO26_TILED_9PAGES_EP200_CENTER_KEY
        ]

    def predict_boxes(self, image, imgsz, conf, device):
        self.calls += 1
        return (
            np.array([[300.0, 100.0, 320.0, 120.0]]),
            np.array([0.9]),
            np.array([0], dtype=int),
        )


class Fixed100DetectorIntegrationTest(unittest.TestCase):
    def test_registry_defaults_and_paths(self) -> None:
        tiled = yolo26.DETECTION_MODEL_SPECS_BY_KEY[
            yolo26.YOLO26_ALL9_FIXED_EP100_TILED_KEY
        ]

        self.assertEqual(
            yolo26.DEFAULT_LARGE_MODEL_KEY,
            yolo26.MUSVIT_LARGE_ENSEMBLE_KEY,
        )
        self.assertEqual(
            yolo26.DEFAULT_SMALL_MODEL_KEY,
            yolo26.YOLO26_ALL9_FIXED_EP100_TILED_KEY,
        )
        self.assertNotIn(
            "yolo26l_all9_fixed_ep100_large",
            yolo26.DETECTION_MODEL_SPECS_BY_KEY,
        )
        self.assertEqual(tiled.role, "small")
        self.assertEqual(
            tiled.tile_ownership,
            yolo26.TILE_OWNERSHIP_CENTER_VORONOI,
        )
        self.assertEqual(
            tiled.path.name,
            "yolo26l_all9_fixed_ep100_tiled_ep100.pt",
        )
        self.assertEqual(yolo26.FIXED100_MODELS_DIR, yolo26.MODELS_DIR)
        self.assertEqual(tiled.path.parent, yolo26.MODELS_DIR)

    def test_ep200_center_recipe_shares_checkpoint_but_not_ownership(self) -> None:
        legacy = yolo26.DETECTION_MODEL_SPECS_BY_KEY[
            yolo26.YOLO26_TILED_9PAGES_EP200_LEGACY_KEY
        ]
        center = yolo26.DETECTION_MODEL_SPECS_BY_KEY[
            yolo26.YOLO26_TILED_9PAGES_EP200_CENTER_KEY
        ]

        self.assertEqual(
            yolo26.YOLO26_TILED_9PAGES_EP200_CENTER_KEY,
            "yolo26l_tiled_9pages_ep200_center_voronoi",
        )
        self.assertEqual(center.path, legacy.path)
        self.assertEqual(center.fallback_paths, legacy.fallback_paths)
        self.assertEqual(center.backend, legacy.backend)
        self.assertEqual(center.role, legacy.role)
        self.assertIsNone(legacy.tile_ownership)
        self.assertEqual(
            center.tile_ownership,
            yolo26.TILE_OWNERSHIP_CENTER_VORONOI,
        )
        self.assertNotEqual(
            yolo26.DEFAULT_SMALL_MODEL_KEY,
            yolo26.YOLO26_TILED_9PAGES_EP200_CENTER_KEY,
        )

    def test_retired_yolo_recipes_are_not_registered(self) -> None:
        retired_keys = {
            "yolo26l_large_fullwidth_7pages_pre",
            "yolo26l_tiled_7pages_pre",
            "yolo26l_large_fullwidth_9pages_ep300",
            "yolo26l_tiled_9pages_ep300",
        }

        self.assertTrue(retired_keys.isdisjoint(yolo26.DETECTION_MODEL_SPECS_BY_KEY))
        self.assertTrue(
            retired_keys.isdisjoint(
                model["key"] for model in yolo26.list_detection_models()
            )
        )

    def test_frontend_offers_center_recipe_without_changing_defaults(self) -> None:
        frontend = FRONTEND_MODULE_PATH.read_text(encoding="utf-8")
        center_key = "yolo26l_tiled_9pages_ep200_center_voronoi"
        retired_keys = {
            "yolo26l_large_fullwidth_7pages_pre",
            "yolo26l_tiled_7pages_pre",
            "yolo26l_large_fullwidth_9pages_ep300",
            "yolo26l_tiled_9pages_ep300",
        }

        self.assertEqual(frontend.count(f'key: "{center_key}"'), 1)
        for retired_key in retired_keys:
            self.assertNotIn(retired_key, frontend)
        self.assertRegex(
            frontend,
            r'DEFAULT_LARGE_DETECTION_MODEL_KEY\s*=\s*"musvit_large_ensemble"',
        )
        self.assertRegex(
            frontend,
            r'DEFAULT_SMALL_DETECTION_MODEL_KEY\s*=\s*'
            r'"yolo26l_all9_fixed_ep100_tiled"',
        )

    def test_voronoi_boundary_has_exactly_one_owner(self) -> None:
        positions = yolo26._tile_positions(2176, 1216, 960)
        bounds = yolo26._responsibility_bounds(positions, 1216, 2176)
        self.assertEqual(positions, [0, 960])
        self.assertEqual(bounds, [(0.0, 1088.0), (1088.0, 2176.0)])
        self.assertFalse(yolo26._center_owned_by_interval(1088.0, bounds, 0))
        self.assertTrue(yolo26._center_owned_by_interval(1088.0, bounds, 1))

    def test_fixed100_tiled_run_enforces_center_ownership(self) -> None:
        adapter = FakeCenterOwnedAdapter()
        detector = object.__new__(yolo26.Yolo26CombinedDetector)
        detector.device = "cpu"
        detector.explicit_allowed_class_ids = None
        detector.explicit_allowed_class_names = None
        detector.use_allowed_classes = False
        detector.get_model = lambda model_key, role: adapter
        options = yolo26.Yolo26Options(
            large_model_key=yolo26.MUSVIT_LARGE_ENSEMBLE_KEY,
            small_model_key=yolo26.YOLO26_ALL9_FIXED_EP100_TILED_KEY,
            run_large=False,
            run_small=True,
            deduplicate=False,
            tile_patch=1216,
            tile_step=960,
            tile_margin=128,
        )

        detections = detector.run_tiled(
            Image.new("RGB", (2176, 1216), "white"),
            yolo26.YOLO26_ALL9_FIXED_EP100_TILED_KEY,
            options,
        )

        self.assertEqual(adapter.calls, 2)
        self.assertEqual(len(detections), 1)
        self.assertEqual(detections[0].left, 1078)
        # Half-open ownership assigns the exact boundary to the second tile.
        self.assertAlmostEqual(detections[0].confidence, 0.8)

    def test_tiled_run_uses_selected_recipe_not_cached_adapter_ownership(self) -> None:
        # The shared adapter remembers the legacy spec because that recipe loaded
        # the checkpoint first. Selecting the center recipe must nevertheless use
        # center ownership from the registry entry named by model_key.
        adapter = FakeLegacyOwnedAdapter()
        detector = object.__new__(yolo26.Yolo26CombinedDetector)
        detector.device = "cpu"
        detector.explicit_allowed_class_ids = None
        detector.explicit_allowed_class_names = None
        detector.use_allowed_classes = False
        detector.get_model = lambda model_key, role: adapter
        options = yolo26.Yolo26Options(
            large_model_key=yolo26.MUSVIT_LARGE_ENSEMBLE_KEY,
            small_model_key=yolo26.YOLO26_TILED_9PAGES_EP200_CENTER_KEY,
            run_large=False,
            run_small=True,
            deduplicate=False,
            tile_patch=1216,
            tile_step=960,
            tile_margin=128,
        )

        detections = detector.run_tiled(
            Image.new("RGB", (2176, 1216), "white"),
            yolo26.YOLO26_TILED_9PAGES_EP200_CENTER_KEY,
            options,
        )

        self.assertEqual(adapter.calls, 2)
        self.assertEqual(len(detections), 1)
        self.assertEqual(detections[0].left, 1078)
        self.assertAlmostEqual(detections[0].confidence, 0.8)
        self.assertEqual(
            detections[0].model_key,
            yolo26.YOLO26_TILED_9PAGES_EP200_CENTER_KEY,
        )
        self.assertEqual(
            detections[0].model_label,
            yolo26.DETECTION_MODEL_SPECS_BY_KEY[
                yolo26.YOLO26_TILED_9PAGES_EP200_CENTER_KEY
            ].label,
        )

    def test_tiled_legacy_provenance_survives_center_adapter_reuse(self) -> None:
        adapter = FakeEp200CenterOwnedAdapter()
        detector = object.__new__(yolo26.Yolo26CombinedDetector)
        detector.device = "cpu"
        detector.explicit_allowed_class_ids = None
        detector.explicit_allowed_class_names = None
        detector.use_allowed_classes = False
        detector.get_model = lambda model_key, role: adapter
        options = yolo26.Yolo26Options(
            large_model_key=yolo26.MUSVIT_LARGE_ENSEMBLE_KEY,
            small_model_key=yolo26.YOLO26_TILED_9PAGES_EP200_LEGACY_KEY,
            run_large=False,
            run_small=True,
            deduplicate=False,
            tile_patch=1216,
            tile_step=960,
            tile_margin=128,
        )

        detections = detector.run_tiled(
            Image.new("RGB", (2176, 1216), "white"),
            yolo26.YOLO26_TILED_9PAGES_EP200_LEGACY_KEY,
            options,
        )

        self.assertEqual(adapter.calls, 2)
        self.assertEqual(len(detections), 2)
        self.assertTrue(
            all(
                detection.model_key
                == yolo26.YOLO26_TILED_9PAGES_EP200_LEGACY_KEY
                for detection in detections
            )
        )
        self.assertTrue(
            all(
                detection.model_label
                == yolo26.DETECTION_MODEL_SPECS_BY_KEY[
                    yolo26.YOLO26_TILED_9PAGES_EP200_LEGACY_KEY
                ].label
                for detection in detections
            )
        )

    def test_ep200_recipes_reuse_one_loaded_adapter(self) -> None:
        class FakeYoloModelAdapter:
            def __init__(self, spec, path) -> None:
                self.spec = spec
                self.path = path

        with tempfile.TemporaryDirectory() as temporary:
            shared_checkpoint = Path(temporary) / "shared-ep200.pt"
            shared_checkpoint.touch()
            legacy = yolo26.DetectionModelSpec(
                key=yolo26.YOLO26_TILED_9PAGES_EP200_LEGACY_KEY,
                label="test ep200 legacy",
                role="small",
                backend="yolo",
                path=shared_checkpoint,
            )
            center = replace(
                legacy,
                key=yolo26.YOLO26_TILED_9PAGES_EP200_CENTER_KEY,
                label="test ep200 center",
                tile_ownership=yolo26.TILE_OWNERSHIP_CENTER_VORONOI,
            )
            registry = {legacy.key: legacy, center.key: center}
            detector = object.__new__(yolo26.Yolo26CombinedDetector)
            detector.model_cache = {}

            with mock.patch.dict(
                yolo26.DETECTION_MODEL_SPECS_BY_KEY,
                registry,
                clear=True,
            ), mock.patch.object(
                yolo26,
                "YoloModelAdapter",
                side_effect=FakeYoloModelAdapter,
            ) as adapter_constructor:
                legacy_adapter = detector.get_model(legacy.key, "small")
                center_adapter = detector.get_model(center.key, "small")

            self.assertIs(center_adapter, legacy_adapter)
            self.assertIs(detector.model_cache[legacy.key], legacy_adapter)
            self.assertIs(detector.model_cache[center.key], legacy_adapter)
            adapter_constructor.assert_called_once_with(legacy, shared_checkpoint)

    def test_missing_artifact_is_listed_but_loading_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            missing_path = Path(temporary) / "not-produced.pt"
            original = yolo26.DETECTION_MODEL_SPECS_BY_KEY[
                yolo26.YOLO26_ALL9_FIXED_EP100_TILED_KEY
            ]
            missing = replace(original, path=missing_path, fallback_paths=())
            registry = {missing.key: missing}
            detector = object.__new__(yolo26.Yolo26CombinedDetector)
            detector.model_cache = {}

            with mock.patch.object(yolo26, "DETECTION_MODEL_SPECS", [missing]), mock.patch.dict(
                yolo26.DETECTION_MODEL_SPECS_BY_KEY,
                registry,
                clear=True,
            ):
                listed = yolo26.list_detection_models()
                self.assertEqual(len(listed), 1)
                self.assertEqual(listed[0]["key"], missing.key)
                self.assertFalse(listed[0]["available"])
                self.assertEqual(
                    listed[0]["tileOwnership"],
                    yolo26.TILE_OWNERSHIP_CENTER_VORONOI,
                )
                with self.assertRaisesRegex(FileNotFoundError, "Missing .* model"):
                    detector.get_model(missing.key, "small")


if __name__ == "__main__":
    unittest.main()
