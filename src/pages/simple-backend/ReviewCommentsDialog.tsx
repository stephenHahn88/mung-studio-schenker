import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CommentOutlinedIcon from "@mui/icons-material/CommentOutlined";
import ReplayIcon from "@mui/icons-material/Replay";
import ReplyIcon from "@mui/icons-material/Reply";
import SendIcon from "@mui/icons-material/Send";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Modal,
  ModalClose,
  Sheet,
  Stack,
  Textarea,
  Typography,
} from "@mui/joy";
import { FormEvent, useEffect, useState } from "react";
import { ReviewComment } from "./SimpleBackendApi";

export interface ReviewCommentsDialogProps {
  readonly open: boolean;
  readonly documentName: string;
  readonly onClose: () => void;
  readonly onLoad: () => Promise<ReviewComment[]>;
  readonly onAdd: (
    text: string,
    parentId: string | null,
  ) => Promise<ReviewComment>;
  readonly onSetResolved: (
    id: string,
    resolved: boolean,
  ) => Promise<ReviewComment>;
}

export function ReviewCommentsDialog(props: ReviewCommentsDialogProps) {
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ReviewComment | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    let active = true;
    setLoading(true);
    setError(null);
    props
      .onLoad()
      .then((loaded) => {
        if (active) setComments(loaded);
      })
      .catch((caught) => {
        if (active)
          setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [props.open, props.documentName]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const comment = await props.onAdd(draft, null);
      setComments((current) => [...current, comment]);
      setDraft("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const submitReply = async (event: FormEvent) => {
    event.preventDefault();
    if (replyingTo === null || !replyDraft.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const comment = await props.onAdd(replyDraft, replyingTo.id);
      setComments((current) => [...current, comment]);
      setReplyDraft("");
      setReplyingTo(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const setResolved = async (comment: ReviewComment, resolved: boolean) => {
    setUpdatingId(comment.id);
    setError(null);
    try {
      const updated = await props.onSetResolved(comment.id, resolved);
      setComments((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <Modal
      open={props.open}
      onClose={saving ? undefined : props.onClose}
      aria-labelledby="review-comments-title"
      sx={{ display: "flex", justifyContent: "center", alignItems: "center" }}
    >
      <Sheet
        variant="outlined"
        sx={{
          width: 680,
          maxWidth: "94vw",
          maxHeight: "88vh",
          borderRadius: "md",
          p: 3,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <ModalClose disabled={saving} />
        <Box>
          <Typography
            id="review-comments-title"
            level="h3"
            startDecorator={<CommentOutlinedIcon />}
          >
            Page comments
          </Typography>
          <Typography level="body-sm" sx={{ overflowWrap: "anywhere" }}>
            {props.documentName}
          </Typography>
        </Box>

        {error !== null && <Alert color="danger">{error}</Alert>}

        <Stack spacing={1.5} sx={{ overflowY: "auto", minHeight: 100 }}>
          {loading && <CircularProgress size="sm" />}
          {!loading && comments.length === 0 && (
            <Typography level="body-sm" textColor="text.tertiary">
              No comments yet. Reviewers can leave page-level feedback below.
            </Typography>
          )}
          {buildCommentTree(comments).map((node) => (
            <CommentThread
              key={node.comment.id}
              node={node}
              depth={0}
              updatingId={updatingId}
              replyingToId={replyingTo?.id ?? null}
              replyDraft={replyDraft}
              saving={saving}
              onSetResolved={setResolved}
              onStartReply={(comment) => {
                setReplyingTo(comment);
                setReplyDraft("");
              }}
              onCancelReply={() => {
                setReplyingTo(null);
                setReplyDraft("");
              }}
              onReplyDraftChange={setReplyDraft}
              onSubmitReply={submitReply}
            />
          ))}
        </Stack>

        <Divider />
        <Box component="form" onSubmit={submit}>
          <Typography level="title-sm" sx={{ mb: 0.75 }}>
            Add a comment
          </Typography>
          <Textarea
            minRows={3}
            maxRows={7}
            value={draft}
            disabled={saving}
            placeholder="Describe what should be reviewed or corrected on this page."
            onChange={(event) => setDraft(event.target.value)}
          />
          <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
            <Button
              type="submit"
              loading={saving}
              disabled={!draft.trim()}
              endDecorator={<SendIcon />}
            >
              Post comment
            </Button>
          </Stack>
        </Box>
      </Sheet>
    </Modal>
  );
}

interface CommentTreeNode {
  readonly comment: ReviewComment;
  readonly children: CommentTreeNode[];
}

function buildCommentTree(comments: ReviewComment[]): CommentTreeNode[] {
  const nodes = new Map<string, CommentTreeNode>();
  comments.forEach((comment) =>
    nodes.set(comment.id, { comment, children: [] }),
  );
  const roots: CommentTreeNode[] = [];
  comments.forEach((comment) => {
    const node = nodes.get(comment.id)!;
    const parentId = comment.parentId ?? null;
    const parent = parentId === null ? undefined : nodes.get(parentId);
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  });
  return roots;
}

function CommentThread(props: {
  readonly node: CommentTreeNode;
  readonly depth: number;
  readonly updatingId: string | null;
  readonly replyingToId: string | null;
  readonly replyDraft: string;
  readonly saving: boolean;
  readonly onSetResolved: (
    comment: ReviewComment,
    resolved: boolean,
  ) => Promise<void>;
  readonly onStartReply: (comment: ReviewComment) => void;
  readonly onCancelReply: () => void;
  readonly onReplyDraftChange: (text: string) => void;
  readonly onSubmitReply: (event: FormEvent) => Promise<void>;
}) {
  const { comment } = props.node;
  return (
    <Box
      sx={{
        ml: props.depth === 0 ? 0 : { xs: 1.5, sm: 3 },
        borderLeft:
          props.depth === 0 ? "none" : "2px solid var(--joy-palette-divider)",
        pl: props.depth === 0 ? 0 : 1.5,
      }}
    >
      <Sheet
        variant="soft"
        color={comment.resolved ? "neutral" : "warning"}
        sx={{ p: 1.5, borderRadius: "sm" }}
      >
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", mb: 0.75, flexWrap: "wrap" }}
        >
          <Typography level="title-sm">{comment.author}</Typography>
          <Typography level="body-xs">
            {new Date(comment.createdAt).toLocaleString()}
          </Typography>
          <Chip
            size="sm"
            color={comment.resolved ? "success" : "warning"}
            variant="soft"
          >
            {comment.resolved ? "Resolved" : "Needs attention"}
          </Chip>
        </Stack>
        <Typography
          level="body-md"
          sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
        >
          {comment.text}
        </Typography>
        <Stack direction="row" spacing={0.5} sx={{ mt: 0.75 }}>
          <Button
            size="sm"
            variant="plain"
            color={comment.resolved ? "neutral" : "success"}
            loading={props.updatingId === comment.id}
            startDecorator={
              comment.resolved ? <ReplayIcon /> : <CheckCircleOutlineIcon />
            }
            onClick={() => props.onSetResolved(comment, !comment.resolved)}
          >
            {comment.resolved ? "Reopen" : "Mark resolved"}
          </Button>
          <Button
            size="sm"
            variant="plain"
            color="neutral"
            startDecorator={<ReplyIcon />}
            onClick={() => props.onStartReply(comment)}
          >
            Reply
          </Button>
        </Stack>
        {props.replyingToId === comment.id && (
          <Box component="form" onSubmit={props.onSubmitReply} sx={{ mt: 1 }}>
            <Textarea
              autoFocus
              minRows={2}
              maxRows={5}
              value={props.replyDraft}
              disabled={props.saving}
              placeholder={`Reply to ${comment.author}`}
              onChange={(event) => props.onReplyDraftChange(event.target.value)}
            />
            <Stack
              direction="row"
              spacing={0.5}
              justifyContent="flex-end"
              sx={{ mt: 0.75 }}
            >
              <Button
                size="sm"
                variant="plain"
                color="neutral"
                onClick={props.onCancelReply}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                type="submit"
                loading={props.saving}
                disabled={!props.replyDraft.trim()}
              >
                Post reply
              </Button>
            </Stack>
          </Box>
        )}
      </Sheet>
      {props.node.children.length > 0 && (
        <Stack spacing={1} sx={{ mt: 1 }}>
          {props.node.children.map((child) => (
            <CommentThread
              key={child.comment.id}
              {...props}
              node={child}
              depth={props.depth + 1}
            />
          ))}
        </Stack>
      )}
    </Box>
  );
}
