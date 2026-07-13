import ast
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import numpy as np

import edge_inference_learned as learned


class LearnedEdgeInferenceContractTest(unittest.TestCase):
    def make_bundle(self, root: Path) -> Path:
        artifacts = {}
        for name in learned.MODEL_FILES:
            payload = ("test:" + name).encode()
            (root / name).write_bytes(payload)
            artifacts[name] = {
                "path": name,
                "bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
            }
        manifest = {
            "schema_version": 1,
            "complete": True,
            "model_family": "learned-proposal-incidence-direction",
            "production_candidate": True,
            "smoke_nonproduction": False,
            "training_dataset": {"pages": [f"page-{i}" for i in range(9)]},
            "inference_contract": {
                "rules": False,
                "hard_graph_decoder": False,
                "rules_or_class_distance_gate": False,
                "proposal_universe": "all unordered node pairs",
            },
            "artifacts": artifacts,
        }
        (root / "bundle.json").write_text(json.dumps(manifest), encoding="utf-8")
        (root / "COMPLETE").write_text("test\n", encoding="utf-8")
        return root

    def test_bundle_hashes_are_verified_before_loading(self):
        with tempfile.TemporaryDirectory() as directory:
            bundle = self.make_bundle(Path(directory))
            _manifest, hashes = learned._verify_bundle(bundle)
            self.assertEqual(set(hashes), set(learned.MODEL_FILES))
            (bundle / "proposal.pth").write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "(size|SHA256) mismatch"):
                learned._verify_bundle(bundle)

    def test_rule_module_is_not_imported(self):
        source = Path(learned.__file__).read_text(encoding="utf-8")
        tree = ast.parse(source)
        imported = {
            alias.name
            for node in ast.walk(tree)
            if isinstance(node, ast.Import)
            for alias in node.names
        }
        imported.update(
            node.module or ""
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom)
        )
        self.assertNotIn("edge_rules", imported)

    def test_zero_ink_crop_contains_only_endpoint_masks(self):
        a = SimpleNamespace(left=10, top=20, right=30, bottom=50)
        b = SimpleNamespace(left=80, top=60, right=100, bottom=90)
        crop = learned._zero_ink_crop(a, b, width=200, height=150)
        self.assertEqual(crop.shape, (3, 128, 256))
        self.assertTrue(np.all(crop[0] == 0))
        self.assertGreater(float(crop[1].sum()), 0.0)
        self.assertGreater(float(crop[2].sum()), 0.0)

    def test_missing_bundle_health_is_fail_closed_and_read_only(self):
        info = learned.get_model_info(bundle_dir="/definitely/missing/edge-bundle")
        self.assertFalse(info["ok"])
        self.assertFalse(info["writesAnnotations"])


if __name__ == "__main__":
    unittest.main()
