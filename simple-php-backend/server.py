"""Python backend of MuNG Studio for Schenkerian analyses.

Serves the documents API of the original Simple PHP Backend (index.php) plus
the features used for Schenkerian annotation: four-stage document workflow,
shared custom classes, review comments, real-time collaboration, and the
model actions defined in model_actions.py.

Run: python3 server.py [--port 8080] [--documents documents] [--frontend dist]
"""

import os
import math
import json
import re
import queue
import datetime
import mimetypes
import posixpath
import tempfile
import traceback
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote
from argparse import ArgumentParser

from model_actions import (
    ACTIONS as MODEL_ACTION_IDS,
    InvalidModelOutput,
    InvalidModelRequest,
    ModelActions,
    ModelBusy,
    ModelFailed,
    ModelUnavailable,
)

from custom_class_registry import (
    CustomClassNameConflict,
    CustomClassRegistry,
    InvalidCustomClassName,
)
from review_comments import (
    InvalidReviewComment,
    ReviewCommentNotFound,
    ReviewCommentStore,
)

from document_workflow import (
    DOCUMENT_STATUSES,
    STAGES,
    InvalidStoredWorkflow,
    InvalidWorkflowPatch,
    patch_document_workflow,
    read_document_workflow,
)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCUMENTS_PATH = os.environ.get("MUNG_DOCUMENTS_PATH", os.path.join(PROJECT_ROOT, "documents"))
AUDIT_LOG_PATH = os.path.join(DOCUMENTS_PATH, "audit_log.txt")
CUSTOM_CLASSES_PATH = os.environ.get(
    "MUNG_CUSTOM_CLASSES_FILE",
    os.path.join(DOCUMENTS_PATH, "custom_classes.json"),
)
CUSTOM_CLASS_REGISTRY = CustomClassRegistry(CUSTOM_CLASSES_PATH)
REVIEW_COMMENT_STORE = ReviewCommentStore(DOCUMENTS_PATH)


# Absolute path to the built frontend (parcel `dist/`). When set, the server
# also serves the single-page app so the whole thing lives on one origin.
FRONTEND_PATH = os.environ.get("MUNG_FRONTEND_PATH") or None


MODELS = ModelActions()
MAX_MODEL_REQUEST_BYTES = 8 * 1024 * 1024


class ConversionRejected(ValueError):
    """The converter cannot convert this page (reported as HTTP 422)."""


def load_users():
    """Load the list of {name, token} users for token authentication.

    Resolution order:
      1. MUNG_USERS_FILE  -> path to a JSON file: [{"name": ..., "token": ...}, ...]
      2. MUNG_USERS       -> inline "name:token,name2:token2"
      3. default single Root token (development only)
    """
    users_file = os.environ.get("MUNG_USERS_FILE")
    if users_file and os.path.isfile(users_file):
        with open(users_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        users = [
            {"name": str(u["name"]), "token": str(u["token"])}
            for u in data
            if u.get("name") and u.get("token")
        ]
        if users:
            return users

    inline = os.environ.get("MUNG_USERS")
    if inline:
        users = []
        for pair in inline.split(","):
            pair = pair.strip()
            if not pair or ":" not in pair:
                continue
            name, token = pair.split(":", 1)
            name, token = name.strip(), token.strip()
            if name and token:
                users.append({"name": name, "token": token})
        if users:
            return users

    return [{"name": "Root", "token": "123456789"}]


USERS = load_users()


def is_valid_name(name):
    """Document names may contain dots (e.g. figure numbers like "3.19b") but
    must stay path-safe: no "..", no leading dot, no separators."""
    if ".." in name or name.startswith("."):
        return False
    return bool(re.match(r'^[a-zA-Z0-9\s._-]+$', name))


def log_to_file(message, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    timestamp = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(path, 'a') as f:
        f.write(f"[{timestamp}]: {message}\n")


def atomic_write(path, data, mode=0o600):
    """Replace a file atomically after its complete contents reach disk."""
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    fd, temporary_path = tempfile.mkstemp(prefix=".mung-write-", dir=directory)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(temporary_path, mode)
        os.replace(temporary_path, path)
    except Exception:
        try:
            os.unlink(temporary_path)
        except FileNotFoundError:
            pass
        raise


def find_image(doc_name):
    for ext in ['jpg', 'jpeg', 'png']:
        p = os.path.join(DOCUMENTS_PATH, doc_name, f"image.{ext}")
        if os.path.isfile(p):
            return p
    return None


def page_image_size(image_path):
    """(width, height) of a page image, read from its header only."""
    from PIL import Image

    with Image.open(image_path) as image:
        return image.size


def find_original_image(doc_name):
    """Return a pre-processing source image, never the annotation canvas."""
    for filename in [
        "original.jpg",
        "original.jpeg",
        "original.png",
        "raw_scan_backup.jpg",
        "raw_scan_backup.jpeg",
        "raw_scan_backup.png",
    ]:
        path = os.path.join(DOCUMENTS_PATH, doc_name, filename)
        if os.path.isfile(path):
            return path
    return None


class Handler(BaseHTTPRequestHandler):

    def _authenticate(self):
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            self.send_error(401, "Unauthenticated.")
            return None
        token = auth[7:].strip()
        for u in USERS:
            if u["token"] == token:
                return u
        self.send_error(401, "Unauthenticated.")
        return None

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        action = params.get("action", [None])[0]

        if action == "whoami":
            self._action_whoami()
        elif action == "list-documents":
            self._action_list_documents()
        elif action == "get-document-mung":
            self._action_get_document_mung(params)
        elif action == "get-document-image":
            self._action_get_document_image(params)
        elif action == "get-document-original":
            self._action_get_document_original(params)
        elif action == "get-document-thumbnail":
            self._action_get_document_thumbnail(params)
        elif action == "list-models":
            self._action_list_models()
        elif action == "list-custom-classes":
            self._action_list_custom_classes()
        elif action == "list-review-comments":
            self._action_list_review_comments(params)
        elif action == "collab-stream":
            self._action_collab_stream(params)
        elif action == "version":
            self._action_version()
        elif action is None and FRONTEND_PATH is not None:
            self._serve_static(parsed.path)
        else:
            self.send_error(400, "Missing or unknown action.")

    def do_POST(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        action = params.get("action", [None])[0]

        if action == "detect-symbols":
            self._action_detect_symbols()
        elif action == "predict-syntax-links":
            self._action_predict_relations("syntaxLinks")
        elif action == "predict-time-groups":
            self._action_predict_relations("timeGroups")
        elif action == "predict-precedence":
            self._action_predict_relations("precedence")
        elif action == "list-models":
            self._action_list_models()
        elif action == "whoami":
            self._action_whoami()
        elif action == "list-documents":
            self._action_list_documents()
        elif action == "list-custom-classes":
            self._action_list_custom_classes()
        elif action == "add-custom-class":
            self._action_add_custom_class()
        elif action == "set-class-color":
            self._action_set_class_color()
        elif action == "clear-class-color":
            self._action_clear_class_color()
        elif action == "get-document-mung":
            self._action_get_document_mung(params)
        elif action == "get-document-image":
            self._action_get_document_image(params)
        elif action == "get-document-original":
            self._action_get_document_original(params)
        elif action == "get-document-thumbnail":
            self._action_get_document_thumbnail(params)
        elif action == "upload-document-mung":
            self._action_upload_document_mung(params)
        elif action == "set-doc-status":
            self._action_set_doc_status(params)
        elif action == "convert-document":
            self._action_convert_document(params)
        elif action == "list-review-comments":
            self._action_list_review_comments(params)
        elif action == "add-review-comment":
            self._action_add_review_comment(params)
        elif action == "set-review-comment-resolved":
            self._action_set_review_comment_resolved(params)
        elif action == "collab-op":
            self._action_collab_op(params)
        elif action == "collab-presence":
            self._action_collab_presence(params)
        else:
            self.send_error(400, "Missing or unknown action.")

    def _send_json(self, data, status=200):
        body = json.dumps(data, indent=2).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _action_whoami(self):
        user = self._authenticate()
        if not user: return
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._cors()
        self.end_headers()
        self.wfile.write(json.dumps({"name": user["name"]}, indent=2).encode())

    def _action_version(self):
        """Code version and fixed API capabilities (unauthenticated: exposes
        only code/build identifiers)."""
        import subprocess
        try:
            sha = subprocess.run(
                ["git", "rev-parse", "--short", "HEAD"], cwd=PROJECT_ROOT,
                capture_output=True, text=True, timeout=5).stdout.strip() or "unknown"
        except Exception:
            sha = "unknown"
        dist_index = os.path.join(FRONTEND_PATH or "", "index.html")
        built = None
        if FRONTEND_PATH and os.path.isfile(dist_index):
            built = datetime.datetime.utcfromtimestamp(
                os.path.getmtime(dist_index)).strftime("%Y-%m-%dT%H:%M:%SZ")
        self._send_json({"commit": sha, "frontendBuiltAt": built,
                         "workflowStages": list(STAGES),
                         "modelActions": list(MODEL_ACTION_IDS)})

    # ==================== model actions ====================
    def _model_document(self, doc_name):
        """Return (document directory, page image path) or send an error."""
        if not isinstance(doc_name, str) or not is_valid_name(doc_name):
            self._send_json({"error": "Missing or invalid document name.",
                             "code": "invalid_document"}, status=400)
            return None
        root = os.path.realpath(DOCUMENTS_PATH)
        doc_dir = os.path.realpath(os.path.join(root, doc_name))
        if os.path.dirname(doc_dir) != root or not os.path.isdir(doc_dir):
            self._send_json({"error": "Document not found.",
                             "code": "document_not_found"}, status=404)
            return None
        image_path = find_image(doc_name)
        if image_path is None:
            self._send_json({"error": "The document has no page image.",
                             "code": "image_not_found"}, status=404)
            return None
        return doc_dir, image_path

    def _read_model_request(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length <= 0 or length > MAX_MODEL_REQUEST_BYTES:
            raise InvalidModelRequest("Invalid request body size.")
        body = json.loads(self.rfile.read(length))
        if not isinstance(body, dict):
            raise InvalidModelRequest("The request body must be a JSON object.")
        return body

    def _run_model_action(self, run):
        """Run one model call and translate its errors into HTTP responses."""
        try:
            self._send_json(run())
        except InvalidModelRequest as exc:
            self._send_json({"error": str(exc)}, status=400)
        except ConversionRejected as exc:
            self._send_json({"error": str(exc), "code": "conversion_rejected"},
                            status=422)
        except ModelBusy as exc:
            self._send_json({"error": str(exc), "retryAfterMs": 2000}, status=429)
        except ModelUnavailable as exc:
            self._send_json({"error": str(exc), "code": "model_unavailable"},
                            status=503)
        except InvalidModelOutput as exc:
            traceback.print_exc()
            self._send_json({"error": str(exc)}, status=502)
        except ModelFailed as exc:
            self._send_json({"error": f"The model action failed: {exc}"},
                            status=500)
        except Exception as exc:
            traceback.print_exc()
            self._send_json({"error": f"The model action failed: {exc}"},
                            status=500)

    def _action_list_models(self):
        user = self._authenticate()
        if not user:
            return
        self._send_json({"models": MODELS.availability()})

    def _action_detect_symbols(self):
        """Run the symbol detector on the page image (or a region of it).
        Returns detections only; the editor decides what to insert."""
        user = self._authenticate()
        if not user:
            return
        try:
            body = self._read_model_request()
        except (InvalidModelRequest, ValueError, UnicodeError) as exc:
            self._send_json({"error": str(exc) or "Bad JSON."}, status=400)
            return
        found = self._model_document(body.get("document"))
        if found is None:
            return
        _, image_path = found

        def run():
            result = MODELS.detect_symbols(
                image_path, page_image_size(image_path),
                region=body.get("region"),
                score_threshold=body.get("scoreThreshold"),
            )
            log_to_file(
                f"{user['name']} detected {len(result['predictions'])} symbols "
                f"in {body['document']}.", AUDIT_LOG_PATH)
            return result

        self._run_model_action(run)

    def _action_predict_relations(self, kind):
        """Run a relation model on the nodes sent by the editor.
        Returns links or groups only; the editor decides what to insert."""
        user = self._authenticate()
        if not user:
            return
        try:
            body = self._read_model_request()
        except (InvalidModelRequest, ValueError, UnicodeError) as exc:
            self._send_json({"error": str(exc) or "Bad JSON."}, status=400)
            return
        found = self._model_document(body.get("document"))
        if found is None:
            return
        _, image_path = found
        method = {
            "syntaxLinks": MODELS.predict_syntax_links,
            "timeGroups": MODELS.predict_time_groups,
            "precedence": MODELS.predict_precedence,
        }[kind]

        def run():
            result = method(body.get("nodes"), page_image_size(image_path))
            count = len(result.get("links", result.get("groups", [])))
            log_to_file(
                f"{user['name']} ran {kind} prediction on {body['document']} "
                f"({count} results).", AUDIT_LOG_PATH)
            return result

        self._run_model_action(run)

    def _action_convert_document(self, params):
        """Convert the saved MuNG graph of a page to JSON (conversion/)."""
        user = self._authenticate()
        if not user:
            return
        found = self._model_document(params.get("document", [None])[0])
        if found is None:
            return
        doc_dir, image_path = found
        mung_path = os.path.join(doc_dir, "mung.xml")
        if not os.path.isfile(mung_path):
            self._send_json({"error": "The document has no mung.xml.",
                             "code": "document_not_found"}, status=404)
            return
        doc_name = os.path.basename(doc_dir)

        def run():
            try:
                result = MODELS.convert_page(mung_path, image_path=image_path)
            except ValueError as exc:
                raise ConversionRejected(str(exc)) from exc
            # The result must be valid JSON before it is sent.
            json.dumps(result, allow_nan=False)
            log_to_file(f"{user['name']} converted {doc_name} to JSON.",
                        AUDIT_LOG_PATH)
            return {"document": doc_name, "result": result}

        self._run_model_action(run)

    # ==================== real-time collaboration ====================
    def _auth_query_or_header(self, params):
        """Auth that also accepts ?token= (EventSource/curl cannot set headers)."""
        auth = self.headers.get("Authorization", "")
        token = (auth[7:].strip() if auth.startswith("Bearer ")
                 else (params.get("token", [None])[0]))
        if token:
            for u in USERS:
                if u["token"] == token:
                    return u
        self.send_error(401, "Unauthenticated.")
        return None

    def _sse(self, obj):
        self.wfile.write(("data: " + json.dumps(obj) + "\n\n").encode())
        self.wfile.flush()

    def _action_collab_stream(self, params):
        """Long-lived SSE stream: replays ops since last save, then live ops +
        presence for one document. Held open on its own thread per client."""
        user = self._auth_query_or_header(params)
        if not user:
            return
        doc = params.get("document", [None])[0]
        client_id = params.get("clientId", [None])[0]
        if not doc or not is_valid_name(doc) or not client_id:
            self.send_error(400, "Missing document/clientId.")
            return
        name = (params.get("name", [None])[0] or user["name"])[:60]
        color = (params.get("color", [None])[0] or "#888888")[:16]
        from collab import HUB, PING_INTERVAL
        sid, q = HUB.subscribe(doc)
        HUB.presence(doc, client_id, {"name": name, "color": color})
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self._cors()
            self.end_headers()
            seq, oplog, users = HUB.snapshot(doc)
            self._sse({"type": "init", "seq": seq, "oplog": oplog, "users": users})
            while True:
                try:
                    self._sse(q.get(timeout=PING_INTERVAL))
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            HUB.unsubscribe(doc, sid, client_id)

    def _action_collab_op(self, params):
        user = self._authenticate()
        if not user:
            return
        doc = params.get("document", [None])[0]
        if not doc or not is_valid_name(doc):
            self._send_json({"error": "Missing or invalid document name."}, status=400)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            self._send_json({"error": "Bad JSON."}, status=400)
            return
        client_id, op = body.get("clientId"), body.get("op")
        if not client_id or op is None:
            self._send_json({"error": "Missing clientId/op."}, status=400)
            return
        from collab import HUB
        seq = HUB.push_op(doc, op, client_id)
        self._send_json({"ok": True, "seq": seq})

    def _action_collab_presence(self, params):
        user = self._authenticate()
        if not user:
            return
        doc = params.get("document", [None])[0]
        if not doc or not is_valid_name(doc):
            self._send_json({"error": "Missing or invalid document name."}, status=400)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            body = {}
        client_id = body.get("clientId")
        if not client_id:
            self._send_json({"error": "Missing clientId."}, status=400)
            return
        from collab import HUB
        HUB.presence(doc, client_id, {
            "name": str(body.get("name", user["name"]))[:60],
            "color": str(body.get("color", "#888888"))[:16],
            "cursor": body.get("cursor"),
            "selection": body.get("selection"),
        })
        self._send_json({"ok": True})

    def _read_doc_status(self, doc_name):
        """Read shared stage progress without migrating existing status files."""
        return read_document_workflow(os.path.join(DOCUMENTS_PATH, doc_name))

    def _action_set_doc_status(self, params):
        """Patch one workflow stage; old clients still patch recognition only."""
        user = self._authenticate()
        if not user:
            return
        doc_name = params.get("document", [None])[0]
        if not doc_name or not is_valid_name(doc_name):
            self._send_json({"error": "Missing or invalid document name."}, status=400)
            return
        doc_dir = os.path.join(DOCUMENTS_PATH, doc_name)
        if not os.path.isdir(doc_dir):
            self._send_json({"error": "Document not found."}, status=404)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length < 1 or length > 16384:
                raise ValueError("Invalid workflow request size.")
            body = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeError):
            self._send_json({"error": "Invalid workflow JSON request."}, status=400)
            return
        try:
            payload = patch_document_workflow(doc_dir, body, user["name"], atomic_write)
        except InvalidWorkflowPatch as exc:
            self._send_json({"error": str(exc)}, status=400)
            return
        except InvalidStoredWorkflow as exc:
            self._send_json({"error": str(exc) + " Existing status was not changed."}, status=409)
            return
        except OSError:
            traceback.print_exc()
            self._send_json({"error": "Could not save workflow status."}, status=500)
            return
        # Audit logging is best-effort after the atomic commit: a logging failure
        # must not tell the client that an already committed update failed.
        stage = body.get("stage", "recognition")
        try:
            log_to_file(
                f"{user['name']} set {stage} status of {doc_name} -> "
                f"{payload['stages'][stage]['status']}.", AUDIT_LOG_PATH)
        except OSError:
            traceback.print_exc()
        self._send_json({"ok": True, **payload})

    def _action_list_custom_classes(self):
        """Return the shared add-on vocabulary without touching annotations."""
        user = self._authenticate()
        if not user:
            return
        try:
            snapshot = CUSTOM_CLASS_REGISTRY.get_snapshot()
        except Exception as exc:
            traceback.print_exc()
            self._send_json(
                {"error": f"Could not read the custom class registry: {exc}"},
                status=500,
            )
            return
        self._send_json(snapshot)

    def _action_add_custom_class(self):
        """Add one shared class definition; existing mung.xml files are unchanged."""
        user = self._authenticate()
        if not user:
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length < 0 or length > 4096:
                self._send_json({"error": "Request body is too large."}, status=413)
                return
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            self._send_json({"error": "Bad JSON."}, status=400)
            return

        try:
            record, created, classes = CUSTOM_CLASS_REGISTRY.add_class(
                body.get("name"), user["name"]
            )
        except InvalidCustomClassName as exc:
            self._send_json({"error": str(exc)}, status=400)
            return
        except CustomClassNameConflict as exc:
            self._send_json({"error": str(exc)}, status=409)
            return
        except Exception as exc:
            traceback.print_exc()
            self._send_json(
                {"error": f"Could not update the custom class registry: {exc}"},
                status=500,
            )
            return

        if created:
            log_to_file(
                f"{user['name']} added custom class {record['name']}.",
                AUDIT_LOG_PATH,
            )
        self._send_json(
            {"ok": True, "created": created, "class": record, "classes": classes}
        )

    def _read_small_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length < 0 or length > 4096:
            raise ValueError("Request body is too large.")
        return json.loads(self.rfile.read(length) or b"{}")

    def _action_set_class_color(self):
        user = self._authenticate()
        if not user:
            return
        try:
            body = self._read_small_json_body()
            snapshot = CUSTOM_CLASS_REGISTRY.set_color(
                body.get("className"), body.get("color"), user["name"]
            )
        except (InvalidCustomClassName, ValueError) as exc:
            self._send_json({"error": str(exc)}, status=400)
            return
        except Exception as exc:
            traceback.print_exc()
            self._send_json({"error": f"Could not set class color: {exc}"}, status=500)
            return
        log_to_file(
            f"{user['name']} set display color for {body.get('className')} to {body.get('color')}.",
            AUDIT_LOG_PATH,
        )
        self._send_json({"ok": True, **snapshot})

    def _action_clear_class_color(self):
        user = self._authenticate()
        if not user:
            return
        try:
            body = self._read_small_json_body()
            snapshot = CUSTOM_CLASS_REGISTRY.clear_color(body.get("className"))
        except (InvalidCustomClassName, ValueError) as exc:
            self._send_json({"error": str(exc)}, status=400)
            return
        except Exception as exc:
            traceback.print_exc()
            self._send_json(
                {"error": f"Could not reset class color: {exc}"}, status=500
            )
            return
        log_to_file(
            f"{user['name']} reset display color for {body.get('className')}.",
            AUDIT_LOG_PATH,
        )
        self._send_json({"ok": True, **snapshot})

    def _action_list_documents(self):
        user = self._authenticate()
        if not user: return
        documents = []
        for item in sorted(os.listdir(DOCUMENTS_PATH)):
            doc_dir = os.path.join(DOCUMENTS_PATH, item)
            mung_path = os.path.join(doc_dir, "mung.xml")
            if os.path.isdir(doc_dir) and os.path.isfile(mung_path):
                has_image = find_image(item) is not None
                has_original = find_original_image(item) is not None
                mtime = os.path.getmtime(mung_path)
                modified = datetime.datetime.utcfromtimestamp(mtime).strftime("%Y-%m-%dT%H:%M:%SZ")
                st = self._read_doc_status(item)
                try:
                    review_summary = REVIEW_COMMENT_STORE.summary(item)
                except Exception:
                    traceback.print_exc()
                    review_summary = {
                        "commentCount": 0,
                        "unresolvedCommentCount": 0,
                    }
                documents.append({"name": item, "hasImage": has_image,
                                  "hasOriginalImage": has_original,
                                  **review_summary,
                                  "modifiedAt": modified,
                                  **st})

        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._cors()
        self.end_headers()
        self.wfile.write(json.dumps({"documents": documents}, indent=2).encode())

    def _action_get_document_mung(self, params):
        user = self._authenticate()
        if not user: return
        doc_name = params.get("document", [None])[0]
        if not doc_name or not is_valid_name(doc_name):
            self.send_error(400, "Missing or invalid document name.")
            return
        mung_path = os.path.join(DOCUMENTS_PATH, doc_name, "mung.xml")
        if not os.path.isfile(mung_path):
            self.send_error(404)
            return

        log_to_file(f"{user['name']} opened {doc_name} document.", AUDIT_LOG_PATH)
        log_to_file(f"{user['name']} opened this document.",
                    os.path.join(DOCUMENTS_PATH, doc_name, "access_log.txt"))

        with open(mung_path, 'rb') as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "application/mung+xml")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def _action_get_document_image(self, params):
        user = self._authenticate()
        if not user: return
        doc_name = params.get("document", [None])[0]
        if not doc_name or not is_valid_name(doc_name):
            self.send_error(400, "Missing or invalid document name.")
            return
        image_path = find_image(doc_name)
        if not image_path:
            self.send_error(404)
            return

        ext = image_path.rsplit('.', 1)[-1].lower()
        ct = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png"}.get(ext, "application/octet-stream")

        with open(image_path, 'rb') as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ct)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def _action_get_document_original(self, params):
        """Serve the original scan without changing it or the annotation image."""
        user = self._authenticate()
        if not user:
            return
        doc_name = params.get("document", [None])[0]
        if not doc_name or not is_valid_name(doc_name):
            self.send_error(400, "Missing or invalid document name.")
            return
        original_path = find_original_image(doc_name)
        if not original_path:
            self.send_error(404, "Original image not found.")
            return

        content_type = mimetypes.guess_type(original_path)[0] or "application/octet-stream"
        with open(original_path, "rb") as handle:
            data = handle.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Content-Disposition", "inline")
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def _review_document_name(self, params):
        doc_name = params.get("document", [None])[0]
        if not doc_name or not is_valid_name(doc_name):
            self._send_json({"error": "Missing or invalid document name."}, status=400)
            return None
        if not os.path.isfile(os.path.join(DOCUMENTS_PATH, doc_name, "mung.xml")):
            self._send_json({"error": "Document not found."}, status=404)
            return None
        return doc_name

    def _action_list_review_comments(self, params):
        user = self._authenticate()
        if not user:
            return
        doc_name = self._review_document_name(params)
        if doc_name is None:
            return
        try:
            comments = REVIEW_COMMENT_STORE.list_comments(doc_name)
        except Exception as exc:
            traceback.print_exc()
            self._send_json({"error": f"Could not read review comments: {exc}"}, status=500)
            return
        self._send_json({"comments": comments})

    def _action_add_review_comment(self, params):
        user = self._authenticate()
        if not user:
            return
        doc_name = self._review_document_name(params)
        if doc_name is None:
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length < 0 or length > 16384:
                self._send_json({"error": "Request body is too large."}, status=413)
                return
            body = json.loads(self.rfile.read(length) or b"{}")
            comment = REVIEW_COMMENT_STORE.add_comment(
                doc_name,
                body.get("text"),
                user["name"],
                body.get("parentId"),
            )
        except InvalidReviewComment as exc:
            self._send_json({"error": str(exc)}, status=400)
            return
        except ReviewCommentNotFound as exc:
            self._send_json({"error": str(exc)}, status=404)
            return
        except Exception as exc:
            traceback.print_exc()
            self._send_json({"error": f"Could not save review comment: {exc}"}, status=500)
            return
        log_to_file(
            f"{user['name']} added a review comment to {doc_name}.", AUDIT_LOG_PATH
        )
        self._send_json({"ok": True, "comment": comment}, status=201)

    def _action_set_review_comment_resolved(self, params):
        user = self._authenticate()
        if not user:
            return
        doc_name = self._review_document_name(params)
        if doc_name is None:
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length < 0 or length > 16384:
                self._send_json({"error": "Request body is too large."}, status=413)
                return
            body = json.loads(self.rfile.read(length) or b"{}")
            comment = REVIEW_COMMENT_STORE.set_resolved(
                doc_name,
                body.get("id"),
                body.get("resolved"),
                user["name"],
            )
        except InvalidReviewComment as exc:
            self._send_json({"error": str(exc)}, status=400)
            return
        except ReviewCommentNotFound as exc:
            self._send_json({"error": str(exc)}, status=404)
            return
        except Exception as exc:
            traceback.print_exc()
            self._send_json({"error": f"Could not update review comment: {exc}"}, status=500)
            return
        log_to_file(
            f"{user['name']} set review comment {comment['id']} on {doc_name} "
            f"resolved={comment['resolved']}.",
            AUDIT_LOG_PATH,
        )
        self._send_json({"ok": True, "comment": comment})

    def _action_get_document_thumbnail(self, params):
        user = self._authenticate()
        if not user: return
        doc_name = params.get("document", [None])[0]
        if not doc_name or not is_valid_name(doc_name):
            self.send_error(400, "Missing or invalid document name.")
            return
        thumb_path = os.path.join(DOCUMENTS_PATH, doc_name, "thumbnail.jpg")
        if not os.path.isfile(thumb_path):
            # Generate thumbnail
            image_path = find_image(doc_name)
            if not image_path:
                self.send_error(404)
                return
            try:
                from PIL import Image
                img = Image.open(image_path)
                w, h = img.size
                tw = 260
                th = int(h * (tw / w))
                img = img.resize((tw, th))
                img.save(thumb_path, "JPEG")
            except Exception:
                self.send_error(500, "Cannot generate thumbnail.")
                return

        with open(thumb_path, 'rb') as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "max-age=604800")
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def _action_upload_document_mung(self, params):
        user = self._authenticate()
        if not user: return
        doc_name = params.get("document", [None])[0]
        if not doc_name or not is_valid_name(doc_name):
            self.send_error(400, "Missing or invalid document name.")
            return
        mung_path = os.path.join(DOCUMENTS_PATH, doc_name, "mung.xml")
        if not os.path.isdir(os.path.join(DOCUMENTS_PATH, doc_name)):
            self.send_error(404)
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        atomic_write(mung_path, body)

        log_to_file(f"{user['name']} has written {doc_name} document.", AUDIT_LOG_PATH)
        log_to_file(f"{user['name']} has written this document.",
                    os.path.join(DOCUMENTS_PATH, doc_name, "access_log.txt"))
        log_to_file(f"{user['name']} has written this document.",
                    os.path.join(DOCUMENTS_PATH, doc_name, "write_log.txt"))

        # Collab: this full-document save is now the durable snapshot, so the
        # per-op replay log can be compacted (joiners will load this mung.xml).
        try:
            from collab import HUB
            HUB.clear_oplog(doc_name)
        except Exception:
            pass

        # Backup
        today = datetime.datetime.utcnow().strftime("%Y-%m-%d")
        backup_dir = os.path.join(DOCUMENTS_PATH, doc_name, "backups")
        os.makedirs(backup_dir, exist_ok=True)
        atomic_write(os.path.join(backup_dir, f"{today}.xml"), body)

        self.send_response(200)
        self._cors()
        self.end_headers()

    def _serve_static(self, url_path):
        """Serve the built single-page app from FRONTEND_PATH.

        Maps the request path to a file under FRONTEND_PATH (guarding against
        path traversal) and falls back to index.html for unknown paths, which
        is what a hash-routed SPA needs.
        """
        root = os.path.realpath(FRONTEND_PATH)

        # Normalize the request path into a safe relative filesystem path.
        rel = unquote(url_path).lstrip("/")
        rel = posixpath.normpath(rel) if rel else ""
        if rel in (".", ""):
            rel = "index.html"

        candidate = os.path.realpath(os.path.join(root, rel))
        # Reject anything that escapes the frontend root.
        if candidate != root and not candidate.startswith(root + os.sep):
            self.send_error(403, "Forbidden.")
            return

        # SPA fallback: unknown path with no file extension -> index.html.
        if not os.path.isfile(candidate):
            if os.path.splitext(rel)[1] == "":
                candidate = os.path.join(root, "index.html")
            if not os.path.isfile(candidate):
                self.send_error(404)
                return

        ctype, _ = mimetypes.guess_type(candidate)
        ctype = ctype or "application/octet-stream"
        with open(candidate, "rb") as f:
            data = f.read()

        is_index = os.path.basename(candidate) == "index.html"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        # Hashed asset filenames are immutable; index.html must never be cached.
        if is_index:
            self.send_header("Cache-Control", "no-store")
        else:
            self.send_header("Cache-Control", "max-age=604800")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] {args[0]}")


if __name__ == "__main__":
    parser = ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--documents", default=DOCUMENTS_PATH)
    parser.add_argument(
        "--frontend",
        default=FRONTEND_PATH,
        help="Path to the built frontend (parcel dist/). When set, the SPA is "
        "served from the same origin as the API.",
    )
    args = parser.parse_args()

    DOCUMENTS_PATH = args.documents
    AUDIT_LOG_PATH = os.path.join(DOCUMENTS_PATH, "audit_log.txt")
    if "MUNG_CUSTOM_CLASSES_FILE" not in os.environ:
        CUSTOM_CLASSES_PATH = os.path.join(DOCUMENTS_PATH, "custom_classes.json")
    CUSTOM_CLASS_REGISTRY = CustomClassRegistry(CUSTOM_CLASSES_PATH)
    REVIEW_COMMENT_STORE = ReviewCommentStore(DOCUMENTS_PATH)
    os.makedirs(DOCUMENTS_PATH, exist_ok=True)

    if args.frontend:
        FRONTEND_PATH = os.path.realpath(args.frontend)

    print(f"Backend running at http://{args.host}:{args.port}")
    print(f"Documents: {DOCUMENTS_PATH}")
    print(f"Users: {', '.join(u['name'] for u in USERS)}")
    if FRONTEND_PATH:
        print(f"Serving frontend from: {FRONTEND_PATH}")
    for action, info in MODELS.availability().items():
        state = "available" if info["available"] else info.get("reason", "unavailable")
        print(f"Model action {action}: {state}")
    # ThreadingHTTPServer so a slow model action does not block document
    # reads and saves from other annotators sharing this server.
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
