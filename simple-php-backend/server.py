"""Python replacement for the PHP backend of mung-studio-schenker.

Equivalent to `php -S localhost:8080` running index.php.
Run: python3 server.py [--port 8080] [--documents /path/to/documents]
"""

import os
import json
import re
import datetime
import traceback
from email.parser import BytesParser
from email.policy import default as email_policy
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from argparse import ArgumentParser
from io import BytesIO

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCUMENTS_PATH = os.environ.get("MUNG_DOCUMENTS_PATH", os.path.join(PROJECT_ROOT, "documents"))
AUDIT_LOG_PATH = os.path.join(DOCUMENTS_PATH, "audit_log.txt")
USERS = [{"name": "Root", "token": "123456789"}]


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
                documents.append({"name": item, "hasImage": has_image, "modifiedAt": modified})

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
        try:
            from yolo26_inference import list_detection_models

            self._send_json({"models": list_detection_models()})
        except Exception as exc:
            traceback.print_exc()
            self._send_json({"error": str(exc)}, status=500)

    def log_message(self, format, *args):
        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] {args[0]}")


if __name__ == "__main__":
    parser = ArgumentParser()
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--documents", default=DOCUMENTS_PATH)
    args = parser.parse_args()

    DOCUMENTS_PATH = args.documents
    AUDIT_LOG_PATH = os.path.join(DOCUMENTS_PATH, "audit_log.txt")
    os.makedirs(DOCUMENTS_PATH, exist_ok=True)

    print(f"Backend running at http://localhost:{args.port}")
    print(f"Documents: {DOCUMENTS_PATH}")
    HTTPServer(("0.0.0.0", args.port), Handler).serve_forever()
