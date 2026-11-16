"""Persistent, shared custom symbol classes for MuNG Studio.

The registry is deliberately separate from per-document ``mung.xml`` files:
adding a class makes it available to annotators without rewriting any existing
annotation.  Writes are atomic and serialized because the Python backend is a
threaded HTTP server.
"""

from __future__ import annotations

import datetime
import json
import os
import re
import tempfile
import threading
from pathlib import Path
from typing import Any


CLASS_NAME_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")
CATALOG_CLASS_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
HEX_COLOR_PATTERN = re.compile(r"^#[0-9A-Fa-f]{6}$")
RESERVED_CLASS_NAMES = frozenset({"unknown"})


class InvalidCustomClassName(ValueError):
    """The proposed class name cannot safely be used as a MuNG identifier."""


class CustomClassNameConflict(ValueError):
    """A differently-cased spelling of the class is already registered."""


def normalize_custom_class_name(value: Any) -> str:
    if not isinstance(value, str):
        raise InvalidCustomClassName("Class name must be a string.")
    name = value.strip()
    if not name:
        raise InvalidCustomClassName("Class name cannot be empty.")
    if not CLASS_NAME_PATTERN.fullmatch(name):
        raise InvalidCustomClassName(
            "Use 1-64 letters, numbers, underscores, or hyphens, starting "
            "with a letter. Camel case is recommended (for example, "
            "prolongationBracket)."
        )
    if name.lower() in RESERVED_CLASS_NAMES:
        raise InvalidCustomClassName(f"{name!r} is reserved by MuNG Studio.")
    return name


def normalize_catalog_class_name(value: Any) -> str:
    if not isinstance(value, str):
        raise InvalidCustomClassName("Class name must be a string.")
    name = value.strip()
    if not CATALOG_CLASS_NAME_PATTERN.fullmatch(name):
        raise InvalidCustomClassName("Invalid class name.")
    return name


def normalize_hex_color(value: Any) -> str:
    if not isinstance(value, str) or not HEX_COLOR_PATTERN.fullmatch(value):
        raise InvalidCustomClassName("Color must use #RRGGBB format.")
    return value.upper()


class CustomClassRegistry:
    """Thread-safe JSON registry with idempotent exact-name insertion."""

    def __init__(self, path: str | os.PathLike[str]):
        self.path = Path(path)
        self._lock = threading.RLock()

    def list_classes(self) -> list[dict[str, str]]:
        with self._lock:
            rows, _ = self._read_unlocked()
            return [dict(row) for row in rows]

    def get_snapshot(self) -> dict[str, Any]:
        with self._lock:
            rows, colors = self._read_unlocked()
            return self._snapshot(rows, colors)

    def add_class(
        self,
        value: Any,
        added_by: str,
        *,
        added_at: str | None = None,
    ) -> tuple[dict[str, str], bool, list[dict[str, str]]]:
        name = normalize_custom_class_name(value)
        with self._lock:
            rows, colors = self._read_unlocked()
            exact = next((row for row in rows if row["name"] == name), None)
            if exact is not None:
                return dict(exact), False, [dict(row) for row in rows]

            case_match = next(
                (row for row in rows if row["name"].casefold() == name.casefold()),
                None,
            )
            if case_match is not None:
                raise CustomClassNameConflict(
                    f"Class {case_match['name']!r} already exists with different casing."
                )

            record = {
                "name": name,
                "addedBy": str(added_by)[:80],
                "addedAt": added_at
                or datetime.datetime.now(datetime.timezone.utc)
                .replace(microsecond=0)
                .isoformat()
                .replace("+00:00", "Z"),
            }
            rows.append(record)
            rows.sort(key=lambda row: (row["name"].casefold(), row["name"]))
            self._write_unlocked(rows, colors)
            return dict(record), True, [dict(row) for row in rows]

    def set_color(
        self,
        class_name: Any,
        color: Any,
        updated_by: str,
        *,
        updated_at: str | None = None,
    ) -> dict[str, Any]:
        name = normalize_catalog_class_name(class_name)
        normalized_color = normalize_hex_color(color)
        with self._lock:
            rows, colors = self._read_unlocked()
            colors[name] = {
                "color": normalized_color,
                "updatedBy": str(updated_by)[:80],
                "updatedAt": updated_at or self._utc_now(),
            }
            self._write_unlocked(rows, colors)
            return self._snapshot(rows, colors)

    def clear_color(self, class_name: Any) -> dict[str, Any]:
        name = normalize_catalog_class_name(class_name)
        with self._lock:
            rows, colors = self._read_unlocked()
            if name in colors:
                del colors[name]
                self._write_unlocked(rows, colors)
            return self._snapshot(rows, colors)

    @staticmethod
    def _utc_now() -> str:
        return (
            datetime.datetime.now(datetime.timezone.utc)
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z")
        )

    @staticmethod
    def _snapshot(
        rows: list[dict[str, str]], colors: dict[str, dict[str, str]]
    ) -> dict[str, Any]:
        return {
            "classes": [dict(row) for row in rows],
            "colorOverrides": {
                name: record["color"] for name, record in sorted(colors.items())
            },
        }

    def _read_unlocked(
        self,
    ) -> tuple[list[dict[str, str]], dict[str, dict[str, str]]]:
        if not self.path.is_file():
            return [], {}
        with self.path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict) or payload.get("schemaVersion") != 1:
            raise RuntimeError(f"Invalid custom-class registry: {self.path}")
        raw_rows = payload.get("classes")
        if not isinstance(raw_rows, list):
            raise RuntimeError(f"Invalid custom-class registry: {self.path}")

        rows: list[dict[str, str]] = []
        seen: set[str] = set()
        for source in raw_rows:
            if not isinstance(source, dict):
                raise RuntimeError(f"Invalid custom-class registry: {self.path}")
            try:
                name = normalize_custom_class_name(source.get("name"))
            except InvalidCustomClassName as exc:
                raise RuntimeError(
                    f"Invalid custom-class registry entry in {self.path}: {exc}"
                ) from exc
            folded = name.casefold()
            if folded in seen:
                raise RuntimeError(
                    f"Duplicate custom-class registry entry in {self.path}: {name}"
                )
            seen.add(folded)
            rows.append(
                {
                    "name": name,
                    "addedBy": str(source.get("addedBy", ""))[:80],
                    "addedAt": str(source.get("addedAt", ""))[:40],
                }
            )
        rows.sort(key=lambda row: (row["name"].casefold(), row["name"]))
        raw_colors = payload.get("colors", {})
        if not isinstance(raw_colors, dict):
            raise RuntimeError(f"Invalid custom-class colors: {self.path}")
        colors: dict[str, dict[str, str]] = {}
        for raw_name, source in raw_colors.items():
            try:
                name = normalize_catalog_class_name(raw_name)
                if not isinstance(source, dict):
                    raise InvalidCustomClassName("Invalid color record.")
                color = normalize_hex_color(source.get("color"))
            except InvalidCustomClassName as exc:
                raise RuntimeError(
                    f"Invalid custom-class color in {self.path}: {exc}"
                ) from exc
            colors[name] = {
                "color": color,
                "updatedBy": str(source.get("updatedBy", ""))[:80],
                "updatedAt": str(source.get("updatedAt", ""))[:40],
            }
        return rows, colors

    def _write_unlocked(
        self,
        rows: list[dict[str, str]],
        colors: dict[str, dict[str, str]],
    ) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"schemaVersion": 1, "classes": rows, "colors": colors}
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=self.path.parent,
            prefix=f".{self.path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
            temporary = Path(handle.name)
        os.replace(temporary, self.path)
