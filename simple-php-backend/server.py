"""Python replacement for the PHP backend of mung-studio-schenker.

Equivalent to `php -S localhost:8080` running index.php.
Run: python3 server.py [--port 8080] [--documents /path/to/documents]
"""

import os
import json
import re
import queue
import datetime
import mimetypes
import posixpath
import traceback
from email.parser import BytesParser
from email.policy import default as email_policy
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote
from argparse import ArgumentParser
from io import BytesIO

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCUMENTS_PATH = os.environ.get("MUNG_DOCUMENTS_PATH", os.path.join(PROJECT_ROOT, "documents"))
AUDIT_LOG_PATH = os.path.join(DOCUMENTS_PATH, "audit_log.txt")

# Absolute path to the built frontend (parcel `dist/`). When set, the server
# also serves the single-page app so the whole thing lives on one origin.
FRONTEND_PATH = os.environ.get("MUNG_FRONTEND_PATH") or None


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
    return bool(re.match(r'^[a-zA-Z0-9\s_-]+$', name))


def log_to_file(message, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    timestamp = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(path, 'a') as f:
        f.write(f"[{timestamp}]: {message}\n")


def find_image(doc_name):
    for ext in ['jpg', 'jpeg', 'png']:
        p = os.path.join(DOCUMENTS_PATH, doc_name, f"image.{ext}")
        if os.path.isfile(p):
            return p
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
        elif action == "get-document-thumbnail":
            self._action_get_document_thumbnail(params)
        elif action == "list-detection-models":
            self._action_list_detection_models()
        elif action == "assemble-edges":
            self._action_assemble_edges(params)
        elif action == "collab-stream":
            self._action_collab_stream(params)
        elif action is None and FRONTEND_PATH is not None:
            self._serve_static(parsed.path)
        else:
            self.send_error(400, "Missing or unknown action.")

    def do_POST(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        action = params.get("action", [None])[0]

        if action in {"detect-yolo26-combined", "detect-symbols"}:
            self._action_detect_yolo26_combined()
        elif action == "whoami":
            self._action_whoami()
        elif action == "list-documents":
            self._action_list_documents()
        elif action == "get-document-mung":
            self._action_get_document_mung(params)
        elif action == "get-document-image":
            self._action_get_document_image(params)
        elif action == "get-document-thumbnail":
            self._action_get_document_thumbnail(params)
        elif action == "upload-document-mung":
            self._action_upload_document_mung(params)
        elif action == "set-doc-status":
            self._action_set_doc_status(params)
        elif action == "backup-documents":
            self._action_backup_documents()
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
        """Per-document annotation status, stored at {doc}/status.json. Defaults if absent."""
        path = os.path.join(DOCUMENTS_PATH, doc_name, "status.json")
        if os.path.isfile(path):
            try:
                with open(path) as f:
                    d = json.load(f)
                return {"status": str(d.get("status", "not-started")),
                        "annotator": str(d.get("annotator", ""))}
            except Exception:
                pass
        return {"status": "not-started", "annotator": ""}

    def _action_set_doc_status(self, params):
        """Set a document's annotation status + annotator (shared across all users)."""
        user = self._authenticate()
        if not user: return
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
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            body = {}
        status = str(body.get("status", "not-started"))
        if status not in {"not-started", "in-progress", "done"}:
            self._send_json({"error": "Invalid status."}, status=400)
            return
        annotator = str(body.get("annotator", ""))[:80]
        payload = {"status": status, "annotator": annotator,
                   "updatedAt": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "updatedBy": user["name"]}
        with open(os.path.join(doc_dir, "status.json"), "w") as f:
            json.dump(payload, f, indent=2)
        log_to_file(f"{user['name']} set status of {doc_name} -> {status} (annotator={annotator}).", AUDIT_LOG_PATH)
        self._send_json({"ok": True, **payload})

    def _action_backup_documents(self):
        """Run the off-site Google Drive backup on demand (the 'Backup now' button)."""
        user = self._authenticate()
        if not user: return
        import subprocess
        script = "/home/users/yh477/lab/mung-studio-schenker/backup_documents.sh"
        log_path = "/home/users/yh477/lab/mung-studio-schenker/logs/backup.log"
        try:
            proc = subprocess.run(["bash", script], capture_output=True, text=True, timeout=600)
            tail = ""
            try:
                with open(log_path) as f:
                    tail = "".join(f.readlines()[-6:])
            except Exception:
                pass
            log_to_file(f"{user['name']} triggered manual backup (rc={proc.returncode}).", AUDIT_LOG_PATH)
            self._send_json({"ok": proc.returncode == 0, "returncode": proc.returncode, "log": tail})
        except subprocess.TimeoutExpired:
            self._send_json({"ok": False, "error": "backup timed out (>600s)"}, status=500)
        except Exception as exc:
            self._send_json({"ok": False, "error": str(exc)}, status=500)

    def _action_assemble_edges(self, params):
        """Predict syntax edges among the small symbols of a saved document."""
        user = self._authenticate()
        if not user: return
        doc_name = params.get("document", [None])[0]
        if not doc_name or not is_valid_name(doc_name):
            self._send_json({"error": "Missing or invalid document name."}, status=400)
            return
        doc_dir = os.path.join(DOCUMENTS_PATH, doc_name)
        mung_path = os.path.join(doc_dir, "mung.xml")
        image_path = None
        for ext in ("png", "jpg", "jpeg"):
            p = os.path.join(doc_dir, f"image.{ext}")
            if os.path.isfile(p):
                image_path = p
                break
        if not os.path.isfile(mung_path) or image_path is None:
            self._send_json({"error": "Document or image not found."}, status=404)
            return
        raw_thr = params.get("threshold", [None])[0]
        try:
            threshold = float(raw_thr) if raw_thr is not None else None
        except ValueError:
            threshold = None
        try:
            import edge_inference
            result = edge_inference.predict_edges(mung_path, image_path, threshold=threshold)
        except Exception as exc:
            traceback.print_exc()
            self._send_json({"error": f"edge inference failed: {exc}"}, status=500)
            return
        log_to_file(
            f"{user['name']} predicted {result.get('edgeCount', 0)} edges in {doc_name}.",
            AUDIT_LOG_PATH,
        )
        self._send_json(result)

    def _action_list_documents(self):
        user = self._authenticate()
        if not user: return
        documents = []
        for item in sorted(os.listdir(DOCUMENTS_PATH)):
            doc_dir = os.path.join(DOCUMENTS_PATH, item)
            mung_path = os.path.join(doc_dir, "mung.xml")
            if os.path.isdir(doc_dir) and os.path.isfile(mung_path):
                has_image = find_image(item) is not None
                mtime = os.path.getmtime(mung_path)
                modified = datetime.datetime.utcfromtimestamp(mtime).strftime("%Y-%m-%dT%H:%M:%SZ")
                st = self._read_doc_status(item)
                documents.append({"name": item, "hasImage": has_image, "modifiedAt": modified,
                                  "status": st["status"], "annotator": st["annotator"]})

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

        log_to_file(f"{user['name']} has written {doc_name} document.", AUDIT_LOG_PATH)
        log_to_file(f"{user['name']} has written this document.",
                    os.path.join(DOCUMENTS_PATH, doc_name, "access_log.txt"))
        log_to_file(f"{user['name']} has written this document.",
                    os.path.join(DOCUMENTS_PATH, doc_name, "write_log.txt"))

        with open(mung_path, 'wb') as f:
            f.write(body)

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
        with open(os.path.join(backup_dir, f"{today}.xml"), 'wb') as f:
            f.write(body)

        self.send_response(200)
        self._cors()
        self.end_headers()

    def _read_multipart_form(self, content_type):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)
        message = BytesParser(policy=email_policy).parsebytes(
            b"Content-Type: "
            + content_type.encode("utf-8")
            + b"\r\nMIME-Version: 1.0\r\n\r\n"
            + body
        )

        fields = {}
        if not message.is_multipart():
            return fields

        for part in message.iter_parts():
            field_name = part.get_param("name", header="content-disposition")
            if field_name:
                fields[field_name] = part.get_payload(decode=True) or b""
        return fields

    def _action_detect_yolo26_combined(self):
        user = self._authenticate()
        if not user: return
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            self._send_json({"error": "Expected multipart/form-data with an image field."}, status=400)
            return

        try:
            form = self._read_multipart_form(content_type)
            if "image" not in form:
                self._send_json({"error": "Missing image field."}, status=400)
                return

            image_bytes = form["image"]
            if not image_bytes:
                self._send_json({"error": "Uploaded image is empty."}, status=400)
                return

            from PIL import Image
            from yolo26_inference import detect_image

            detection_options = {
                key: value.decode("utf-8")
                for key, value in form.items()
                if key != "image" and isinstance(value, bytes)
            }

            with Image.open(BytesIO(image_bytes)) as image:
                result = detect_image(image, detection_options)

            self._send_json(result)
        except Exception as exc:
            traceback.print_exc()
            self._send_json({"error": str(exc)}, status=500)

    def _action_list_detection_models(self):
        user = self._authenticate()
        if not user: return
        try:
            from yolo26_inference import list_detection_models

            self._send_json({"models": list_detection_models()})
        except Exception as exc:
            traceback.print_exc()
            self._send_json({"error": str(exc)}, status=500)

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
    os.makedirs(DOCUMENTS_PATH, exist_ok=True)

    if args.frontend:
        FRONTEND_PATH = os.path.realpath(args.frontend)

    print(f"Backend running at http://localhost:{args.port}")
    print(f"Documents: {DOCUMENTS_PATH}")
    print(f"Users: {', '.join(u['name'] for u in USERS)}")
    if FRONTEND_PATH:
        print(f"Serving frontend from: {FRONTEND_PATH}")
    # ThreadingHTTPServer so a slow GPU inference does not block document
    # reads/saves from other annotators sharing this server.
    ThreadingHTTPServer(("0.0.0.0", args.port), Handler).serve_forever()
