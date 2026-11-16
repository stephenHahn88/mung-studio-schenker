from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from custom_class_registry import (  # noqa: E402
    CustomClassNameConflict,
    CustomClassRegistry,
    InvalidCustomClassName,
    normalize_custom_class_name,
    normalize_hex_color,
)


class CustomClassRegistryTest(unittest.TestCase):
    def test_normalization_accepts_safe_identifiers_and_trims(self) -> None:
        self.assertEqual(
            normalize_custom_class_name("  prolongationBracket  "),
            "prolongationBracket",
        )
        self.assertEqual(normalize_custom_class_name("new-class_2"), "new-class_2")

    def test_normalization_rejects_unsafe_or_reserved_names(self) -> None:
        for value in ("", "two words", "../escape", "2startsWithNumber", "unknown"):
            with self.subTest(value=value):
                with self.assertRaises(InvalidCustomClassName):
                    normalize_custom_class_name(value)

    def test_add_is_atomic_sorted_and_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "custom_classes.json"
            registry = CustomClassRegistry(path)

            second, created, rows = registry.add_class(
                "secondClass", "Annotator B", added_at="2026-08-10T12:00:00Z"
            )
            self.assertTrue(created)
            self.assertEqual(second["name"], "secondClass")
            self.assertEqual(len(rows), 1)

            first, created, rows = registry.add_class(
                "firstClass", "Annotator A", added_at="2026-08-10T12:01:00Z"
            )
            self.assertTrue(created)
            self.assertEqual(first["addedBy"], "Annotator A")
            self.assertEqual([row["name"] for row in rows], ["firstClass", "secondClass"])

            duplicate, created, rows = registry.add_class("firstClass", "Other")
            self.assertFalse(created)
            self.assertEqual(duplicate, first)
            self.assertEqual(len(rows), 2)

            saved = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(saved["schemaVersion"], 1)
            self.assertEqual(saved["classes"], rows)

    def test_color_overrides_support_builtin_and_custom_classes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            registry = CustomClassRegistry(Path(tmp) / "custom_classes.json")
            registry.add_class("customArc", "Annotator B")
            snapshot = registry.set_color(
                "noteheadBlack",
                "#12abEF",
                "Reviewer",
                updated_at="2026-08-10T12:00:00Z",
            )
            snapshot = registry.set_color("customArc", "#FEDCBA", "Reviewer")

            self.assertEqual(snapshot["colorOverrides"]["noteheadBlack"], "#12ABEF")
            self.assertEqual(snapshot["colorOverrides"]["customArc"], "#FEDCBA")
            self.assertEqual(
                registry.get_snapshot()["colorOverrides"], snapshot["colorOverrides"]
            )

            reset = registry.clear_color("noteheadBlack")
            self.assertNotIn("noteheadBlack", reset["colorOverrides"])
            self.assertEqual(reset["colorOverrides"]["customArc"], "#FEDCBA")

    def test_color_validation_rejects_non_hex_values(self) -> None:
        self.assertEqual(normalize_hex_color("#abcdef"), "#ABCDEF")
        for value in ("red", "#123", "#12345678", "123456", "#GG0000"):
            with self.subTest(value=value):
                with self.assertRaises(InvalidCustomClassName):
                    normalize_hex_color(value)

    def test_case_only_duplicate_is_rejected_without_rewriting(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "custom_classes.json"
            registry = CustomClassRegistry(path)
            registry.add_class("newSymbol", "Annotator B")
            before = path.read_bytes()

            with self.assertRaises(CustomClassNameConflict):
                registry.add_class("NewSymbol", "Annotator A")

            self.assertEqual(path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
