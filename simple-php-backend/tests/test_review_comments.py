import json
import os
import sys

import pytest


BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from review_comments import (  # noqa: E402
    InvalidReviewComment,
    ReviewCommentNotFound,
    ReviewCommentStore,
)


def test_comments_are_separate_from_annotation_and_can_be_resolved(tmp_path):
    document_dir = tmp_path / "page 001"
    document_dir.mkdir()
    mung_path = document_dir / "mung.xml"
    original_mung = b"<CropObjectList><CropObjects /></CropObjectList>"
    mung_path.write_bytes(original_mung)

    store = ReviewCommentStore(str(tmp_path))
    created = store.add_comment("page 001", "  Please fix this area.  ", "Reviewer")

    assert created["text"] == "Please fix this area."
    assert created["author"] == "Reviewer"
    assert created["parentId"] is None
    assert created["resolved"] is False
    assert store.summary("page 001") == {
        "commentCount": 1,
        "unresolvedCommentCount": 1,
    }
    assert mung_path.read_bytes() == original_mung

    resolved = store.set_resolved("page 001", created["id"], True, "Annotator")
    assert resolved["resolved"] is True
    assert resolved["resolvedBy"] == "Annotator"
    assert resolved["resolvedAt"] is not None
    assert store.summary("page 001")["unresolvedCommentCount"] == 0
    assert mung_path.read_bytes() == original_mung

    payload = json.loads((document_dir / "review_comments.json").read_text())
    assert payload["schemaVersion"] == 1
    assert payload["comments"][0]["id"] == created["id"]


def test_reply_references_an_existing_message_without_rewriting_it(tmp_path):
    store = ReviewCommentStore(str(tmp_path))
    root = store.add_comment("page", "Please fix this.", "Reviewer")
    reply = store.add_comment(
        "page", "Fixed now.", "Annotator", parent_id=root["id"]
    )

    comments = store.list_comments("page")
    assert comments == [root, reply]
    assert reply["parentId"] == root["id"]
    assert comments[0]["text"] == "Please fix this."


def test_reply_parent_must_exist(tmp_path):
    store = ReviewCommentStore(str(tmp_path))
    with pytest.raises(ReviewCommentNotFound):
        store.add_comment("page", "Reply", "Annotator", parent_id="missing")


def test_existing_flat_comments_remain_valid_thread_roots(tmp_path):
    document_dir = tmp_path / "page"
    document_dir.mkdir()
    old_comment = {
        "id": "old-id",
        "author": "Reviewer",
        "text": "Created before replies existed.",
        "createdAt": "2026-08-18T00:00:00Z",
        "resolved": False,
        "resolvedBy": "",
        "resolvedAt": None,
    }
    (document_dir / "review_comments.json").write_text(
        json.dumps({"schemaVersion": 1, "comments": [old_comment]})
    )

    store = ReviewCommentStore(str(tmp_path))
    reply = store.add_comment("page", "A reply.", "Annotator", "old-id")

    assert store.list_comments("page")[0] == old_comment
    assert reply["parentId"] == "old-id"


@pytest.mark.parametrize("text", [None, "", "   ", "x" * 4001])
def test_invalid_comments_are_rejected(tmp_path, text):
    store = ReviewCommentStore(str(tmp_path))
    with pytest.raises(InvalidReviewComment):
        store.add_comment("page", text, "Reviewer")


def test_missing_comment_cannot_be_resolved(tmp_path):
    store = ReviewCommentStore(str(tmp_path))
    with pytest.raises(ReviewCommentNotFound):
        store.set_resolved("page", "missing", True, "Reviewer")
