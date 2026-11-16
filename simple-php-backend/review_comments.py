"""Thread-safe review comments stored beside each document.

The store deliberately never reads or writes ``mung.xml``. Each document's
review workflow lives in its own ``review_comments.json`` file so comments can
be backed up with the document without changing annotation data.
"""

from __future__ import annotations

import datetime
import json
import os
import tempfile
import threading
import uuid


MAX_COMMENT_LENGTH = 4000


class InvalidReviewComment(ValueError):
    pass


class ReviewCommentNotFound(LookupError):
    pass


class ReviewCommentStore:
    def __init__(self, documents_path: str):
        self.documents_path = documents_path
        self._lock = threading.RLock()

    def _path(self, document_name: str) -> str:
        return os.path.join(
            self.documents_path, document_name, "review_comments.json"
        )

    @staticmethod
    def _empty() -> dict:
        return {"schemaVersion": 1, "comments": []}

    def _read_unlocked(self, document_name: str) -> dict:
        path = self._path(document_name)
        if not os.path.isfile(path):
            return self._empty()
        with open(path, "r", encoding="utf-8") as stream:
            payload = json.load(stream)
        comments = payload.get("comments", [])
        if not isinstance(comments, list):
            raise ValueError("Review comment file has an invalid format.")
        return {"schemaVersion": 1, "comments": comments}

    def _write_unlocked(self, document_name: str, payload: dict) -> None:
        target = self._path(document_name)
        directory = os.path.dirname(target)
        os.makedirs(directory, exist_ok=True)
        fd, temporary = tempfile.mkstemp(
            prefix=".review_comments.", suffix=".tmp", dir=directory
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(payload, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def list_comments(self, document_name: str) -> list[dict]:
        with self._lock:
            return list(self._read_unlocked(document_name)["comments"])

    def summary(self, document_name: str) -> dict:
        comments = self.list_comments(document_name)
        return {
            "commentCount": len(comments),
            "unresolvedCommentCount": sum(
                1 for comment in comments if not bool(comment.get("resolved"))
            ),
        }

    def add_comment(
        self,
        document_name: str,
        text: object,
        author: str,
        parent_id: object = None,
    ) -> dict:
        if not isinstance(text, str):
            raise InvalidReviewComment("Comment text is required.")
        normalized = text.strip()
        if not normalized:
            raise InvalidReviewComment("Comment cannot be empty.")
        if len(normalized) > MAX_COMMENT_LENGTH:
            raise InvalidReviewComment(
                f"Comment cannot exceed {MAX_COMMENT_LENGTH} characters."
            )

        if parent_id is not None and (
            not isinstance(parent_id, str) or not parent_id
        ):
            raise InvalidReviewComment("Parent comment ID must be a string.")

        with self._lock:
            payload = self._read_unlocked(document_name)
            if parent_id is not None and not any(
                comment.get("id") == parent_id
                for comment in payload["comments"]
            ):
                raise ReviewCommentNotFound("Parent review comment not found.")
            now = datetime.datetime.now(datetime.timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            )
            comment = {
                "id": uuid.uuid4().hex,
                "parentId": parent_id,
                "author": str(author)[:80],
                "text": normalized,
                "createdAt": now,
                "resolved": False,
                "resolvedBy": "",
                "resolvedAt": None,
            }
            payload["comments"].append(comment)
            self._write_unlocked(document_name, payload)
        return comment

    def set_resolved(
        self, document_name: str, comment_id: object, resolved: object, user: str
    ) -> dict:
        if not isinstance(comment_id, str) or not comment_id:
            raise InvalidReviewComment("Comment ID is required.")
        if not isinstance(resolved, bool):
            raise InvalidReviewComment("Resolved must be true or false.")

        with self._lock:
            payload = self._read_unlocked(document_name)
            for comment in payload["comments"]:
                if comment.get("id") != comment_id:
                    continue
                comment["resolved"] = resolved
                comment["resolvedBy"] = str(user)[:80] if resolved else ""
                comment["resolvedAt"] = (
                    datetime.datetime.now(datetime.timezone.utc).strftime(
                        "%Y-%m-%dT%H:%M:%SZ"
                    )
                    if resolved
                    else None
                )
                self._write_unlocked(document_name, payload)
                return comment
        raise ReviewCommentNotFound("Review comment not found.")
