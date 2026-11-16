"""Shared four-stage document progress, with legacy read/patch compatibility.

Reads never migrate data. Writes change one stage under the same path lock and
use the caller's atomic writer, preserving unrelated and unknown JSON fields.
"""

import copy
import datetime
import json
import os
import threading

# Keep the historical `assembly` storage key for the renamed Precedence Links
# category. Syntax Links is independent and is never inferred from old progress.
STAGES = ("recognition", "assembly", "syntax", "temporal")
DOCUMENT_STATUSES = frozenset({
    "not-started", "in-progress", "pending-review", "changes-requested", "done",
})
_LOCKS = {}
_LOCKS_GUARD = threading.Lock()


class InvalidWorkflowPatch(ValueError):
    pass


class InvalidStoredWorkflow(ValueError):
    pass


def _lock(path):
    key = os.path.realpath(path)
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(key, threading.RLock())


def _empty_stage():
    return {"status": "not-started", "annotator": ""}


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise InvalidStoredWorkflow("Stored workflow contains duplicate fields.")
        result[key] = value
    return result


def _invalid_constant(value):
    raise InvalidStoredWorkflow("Stored workflow contains invalid JSON values.")


def _read_raw(path):
    try:
        with open(path, encoding="utf-8") as source:
            data = json.load(source, object_pairs_hook=_unique_object,
                             parse_constant=_invalid_constant)
    except FileNotFoundError:
        return {}
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise InvalidStoredWorkflow("Stored workflow cannot be read safely.") from exc
    if not isinstance(data, dict):
        raise InvalidStoredWorkflow("Stored workflow must be an object.")
    # Unknown fields must survive the next atomic write too. JSON parsing alone
    # accepts overflowing floats and escaped lone surrogates, neither of which
    # can be emitted as finite UTF-8 JSON without changing the saved value.
    try:
        json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise InvalidStoredWorkflow("Stored workflow cannot be preserved safely.") from exc
    if "workflowVersion" in data and (type(data["workflowVersion"]) is not int
                                      or data["workflowVersion"] != 1):
        raise InvalidStoredWorkflow("Stored workflow version is unsupported.")
    return data


def _stage(value):
    if not isinstance(value, dict):
        raise InvalidStoredWorkflow("Stored stage must be an object.")
    status = value.get("status", "not-started")
    annotator = value.get("annotator", "")
    if not isinstance(status, str) or status not in DOCUMENT_STATUSES:
        raise InvalidStoredWorkflow("Stored workflow status is unsupported.")
    if not isinstance(annotator, str):
        raise InvalidStoredWorkflow("Stored workflow annotator must be text.")
    return {"status": status, "annotator": annotator}


def _snapshot(data):
    # Validate legacy fields as well: never silently overwrite unsupported data.
    legacy = _stage(data)
    staged = data.get("stages", {})
    if not isinstance(staged, dict):
        raise InvalidStoredWorkflow("Stored workflow stages must be an object.")
    stages = {
        key: _stage(staged[key]) if key in staged else
        (legacy.copy() if key == "recognition" else _empty_stage())
        for key in STAGES
    }
    return {**stages["recognition"], "stages": stages}


def read_document_workflow(doc_dir):
    """Return defaults for absent data and an explicit error for unsafe data."""
    path = os.path.join(doc_dir, "status.json")
    with _lock(path):
        try:
            return _snapshot(_read_raw(path))
        except (InvalidStoredWorkflow, OSError):
            return {**_snapshot({}), "workflowStatusError":
                    "Saved workflow status could not be read. Updates are blocked to preserve it."}


def _validate_patch(body):
    if not isinstance(body, dict):
        raise InvalidWorkflowPatch("Expected a JSON object.")
    if set(body) - {"stage", "status", "annotator"}:
        raise InvalidWorkflowPatch("Unknown workflow update field.")
    stage = body.get("stage", "recognition")
    if not isinstance(stage, str) or stage not in STAGES:
        raise InvalidWorkflowPatch("Invalid workflow stage.")
    if "status" not in body and "annotator" not in body:
        raise InvalidWorkflowPatch("Provide status and/or annotator.")
    if "status" in body and (not isinstance(body["status"], str)
                             or body["status"] not in DOCUMENT_STATUSES):
        raise InvalidWorkflowPatch("Invalid status.")
    if "annotator" in body and (not isinstance(body["annotator"], str)
                                or len(body["annotator"]) > 80):
        raise InvalidWorkflowPatch("Annotator must be text of at most 80 characters.")
    if "annotator" in body:
        try:
            body["annotator"].encode("utf-8")
        except UnicodeError as exc:
            raise InvalidWorkflowPatch("Annotator must be valid Unicode text.") from exc
    return stage


def patch_document_workflow(doc_dir, body, updated_by, atomic_write):
    """Apply one partial stage patch, atomically preserving all other fields."""
    stage = _validate_patch(body)
    path = os.path.join(doc_dir, "status.json")
    with _lock(path):
        data = _read_raw(path)
        snapshot = _snapshot(data)
        result = copy.deepcopy(data)
        stages = result.setdefault("stages", {})
        for key in STAGES:
            entry = stages.setdefault(key, {})
            entry.update(snapshot["stages"][key])
        target = stages[stage]
        for key in ("status", "annotator"):
            if key in body:
                target[key] = body[key]
        if ("status" not in body and body.get("annotator", "").strip()
                and target["status"] == "not-started"):
            target["status"] = "in-progress"
        now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        target.update(updatedAt=now, updatedBy=updated_by)
        result.update(status=stages["recognition"]["status"],
                      annotator=stages["recognition"]["annotator"],
                      updatedAt=now, updatedBy=updated_by)
        atomic_write(path, (json.dumps(result, indent=2, ensure_ascii=False,
                                      allow_nan=False) + "\n").encode("utf-8"))
        return {**_snapshot(result), "updatedAt": now, "updatedBy": updated_by}
