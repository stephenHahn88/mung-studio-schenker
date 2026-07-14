import ast
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import numpy as np

import edge_inference_learned as learned


class LearnedEdgeInferenceContractTest(unittest.TestCase):
    @staticmethod
    def fake_state() -> dict:
        return {
            "incidence_threshold": 0.5,
            "proposal_threshold": 0.25,
            "class_dict": {"otherText": 0},
            "manifest": {"model_family": "test-learned-edge"},
            "bundle_id": "test-bundle",
        }

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

    def test_classified_node_partition_skips_only_invalid_class_names(self):
        known = SimpleNamespace(id=1, class_name="noteheadFull", outlinks=[10])
        unknown = SimpleNamespace(
            id=2, class_name="brandNewRelationshipSymbol", outlinks=[11]
        )
        padded_unknown = SimpleNamespace(
            id=3, class_name="  anotherNewClass  ", outlinks=[]
        )
        invalid = [
            SimpleNamespace(id=4, class_name=None, outlinks=[]),
            SimpleNamespace(id=5, class_name="", outlinks=[]),
            SimpleNamespace(id=6, class_name=" \t\n", outlinks=[]),
            SimpleNamespace(id=7, class_name=123, outlinks=[]),
        ]
        nodes = [known, unknown, *invalid, padded_unknown]
        before = copy.deepcopy([vars(node) for node in nodes])

        eligible, skipped_ids = learned._partition_classified_nodes(nodes)

        self.assertEqual(eligible, [known, unknown, padded_unknown])
        self.assertIs(eligible[0], known)
        self.assertIs(eligible[1], unknown)
        self.assertIs(eligible[2], padded_unknown)
        self.assertEqual(skipped_ids, [4, 5, 6, 7])
        self.assertEqual([vars(node) for node in nodes], before)

    def test_predict_edges_filters_invalid_nodes_without_mutating_xml_or_nodes(self):
        known = SimpleNamespace(id=20, class_name="noteheadFull", outlinks=[21])
        unknown = SimpleNamespace(
            id=21, class_name="newNonEmptyClass", outlinks=[20]
        )
        missing = SimpleNamespace(id=22, class_name=None, outlinks=[])
        nodes = [known, missing, unknown]
        nodes_before = copy.deepcopy([vars(node) for node in nodes])
        fake_page = SimpleNamespace(pair_count=1, n=2)

        with tempfile.TemporaryDirectory() as directory:
            mung_path = Path(directory) / "mung.xml"
            image_path = Path(directory) / "image.png"
            xml_bytes = (
                b'<?xml version="1.0" encoding="UTF-8"?>\n'
                b"<Nodes><Node><Id>22</Id><ClassName/></Node></Nodes>\n"
            )
            mung_path.write_bytes(xml_bytes)
            image_path.write_bytes(b"not-read-by-this-unit-test")

            with (
                mock.patch.object(learned, "_get_state", return_value=self.fake_state()),
                mock.patch.object(
                    learned,
                    "_read_page",
                    return_value=("test-page", nodes, 100, 80),
                ),
                mock.patch.object(
                    learned, "_make_page_data", return_value=fake_page
                ) as make_page,
                mock.patch.object(
                    learned,
                    "_learned_proposals",
                    return_value=(
                        np.empty((0, 2), dtype=np.int64),
                        np.empty((0,), dtype=np.float32),
                    ),
                ),
            ):
                result = learned.predict_edges(mung_path, image_path)

            self.assertEqual(mung_path.read_bytes(), xml_bytes)

        self.assertEqual([vars(node) for node in nodes], nodes_before)
        passed_nodes = make_page.call_args.args[1]
        self.assertEqual(passed_nodes, [known, unknown])
        self.assertIs(passed_nodes[0], known)
        self.assertIs(passed_nodes[1], unknown)
        self.assertEqual(result["nodeCount"], 3)
        self.assertEqual(result["eligibleNodeCount"], 2)
        self.assertEqual(result["smallCount"], 2)
        self.assertEqual(result["skippedInvalidNodeCount"], 1)
        self.assertEqual(result["skippedInvalidNodeIds"], [22])
        self.assertEqual(result["pairCount"], 1)
        self.assertEqual(result["edges"], [])

    def test_real_mung_read_and_partition_leave_source_xml_byte_identical(self):
        from PIL import Image

        xml_bytes = b"""<?xml version="1.0" encoding="utf-8"?>
<Nodes dataset="test" document="test">
<Node><Id>1</Id><ClassName></ClassName><Top>1</Top><Left>2</Left><Width>3</Width><Height>4</Height></Node>
<Node><Id>2</Id><ClassName>brandNewClass</ClassName><Top>5</Top><Left>6</Left><Width>7</Width><Height>8</Height></Node>
</Nodes>
"""
        with tempfile.TemporaryDirectory() as directory:
            mung_path = Path(directory) / "mung.xml"
            image_path = Path(directory) / "image.png"
            mung_path.write_bytes(xml_bytes)
            Image.new("RGB", (100, 80), "white").save(image_path)

            _name, nodes, _width, _height = learned._read_page(mung_path, image_path)
            eligible, skipped_ids = learned._partition_classified_nodes(nodes)

            self.assertEqual(mung_path.read_bytes(), xml_bytes)

        self.assertEqual([node.class_name for node in nodes], [None, "brandNewClass"])
        self.assertEqual(eligible, [nodes[1]])
        self.assertEqual(skipped_ids, [1])

    def test_fewer_than_two_eligible_nodes_returns_diagnostics_before_model_stages(self):
        valid = SimpleNamespace(id=30, class_name="unknownButUsable", outlinks=[])
        invalid = [
            SimpleNamespace(id=31, class_name=None, outlinks=[]),
            SimpleNamespace(id=32, class_name="   ", outlinks=[]),
            SimpleNamespace(id=33, class_name={"not": "a string"}, outlinks=[]),
        ]
        nodes = [invalid[0], valid, invalid[1], invalid[2]]
        before = copy.deepcopy([vars(node) for node in nodes])

        with (
            mock.patch.object(learned, "_make_page_data") as make_page,
            mock.patch.object(learned, "_learned_proposals") as proposals,
            mock.patch.object(learned, "_build_incidence_graph") as incidence_graph,
            mock.patch.object(learned, "_attach_zero_ink_visual") as visual,
            mock.patch.object(learned, "_direct_edges") as direction,
        ):
            result = learned._predict_page(
                self.fake_state(), "test-page", nodes, 100, 80, threshold=None
            )

        make_page.assert_not_called()
        proposals.assert_not_called()
        incidence_graph.assert_not_called()
        visual.assert_not_called()
        direction.assert_not_called()
        self.assertEqual([vars(node) for node in nodes], before)
        self.assertEqual(result["edges"], [])
        self.assertEqual(result["nodeCount"], 4)
        self.assertEqual(result["eligibleNodeCount"], 1)
        self.assertEqual(result["smallCount"], 1)
        self.assertEqual(result["skippedInvalidNodeCount"], 3)
        self.assertEqual(result["skippedInvalidNodeIds"], [31, 32, 33])
        self.assertEqual(result["pairCount"], 0)
        self.assertEqual(result["proposalCount"], 0)
        self.assertEqual(result["edgeCount"], 0)


if __name__ == "__main__":
    unittest.main()
