import { Alert, Box, CircularProgress, Typography } from "@mui/joy";
import { useAtomValue } from "jotai";
import { simpleBackendConnectionAtom } from "./SimpleBackendConnection";
import { AuthenticationSection } from "./AuthenticationSection";
import { useEffect, useRef, useState } from "react";
import { Document, SimpleBackendApi } from "./SimpleBackendApi";
import { DocumentStage, DocumentStagePatch } from "./DocumentWorkflow";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Link as RouterLink } from "react-router-dom";
import Link from "@mui/joy/Link";
import { DocumentsList } from "./DocumentsList";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import { ReviewCommentsDialog } from "./ReviewCommentsDialog";

export function DocumentsPage() {
  const connection = useAtomValue(simpleBackendConnectionAtom);

  const [documents, setDocuments] = useState<Document[] | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [commentsDocumentName, setCommentsDocumentName] = useState<
    string | null
  >(null);

  const [pendingDocuments, setPendingDocuments] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const pendingRequests = useRef(new Set<string>());
  const sessionGeneration = useRef(0);

  useEffect(() => {
    const generation = ++sessionGeneration.current;
    pendingRequests.current = new Set();
    setPendingDocuments(new Set());
    setSaveErrors({});
    setDocuments(null);
    setUserName(null);
    setError(null);
    if (connection.userToken === null) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    (async () => {
      try {
        const api = new SimpleBackendApi(connection);
        const documents = await api.listDocuments();
        const whoamiResponse = await api.whoami();
        if (generation !== sessionGeneration.current) return;
        setDocuments(documents);
        setUserName(whoamiResponse.name);
      } catch (e) {
        if (generation === sessionGeneration.current) setError(String(e));
      } finally {
        if (generation === sessionGeneration.current) setIsLoading(false);
      }
    })();
    return () => {
      ++sessionGeneration.current;
    };
  }, [connection.userToken, connection.backendUrl]);

  const handleStatusChange = async (
    name: string,
    stage: DocumentStage,
    patch: DocumentStagePatch,
  ) => {
    // one request per document at a time
    if (pendingRequests.current.has(name) || connection.userToken === null)
      return;
    const document = documents?.find((item) => item.name === name);
    if (!document || document.workflowStatusError) return;
    const generation = sessionGeneration.current;
    pendingRequests.current.add(name);
    setPendingDocuments(new Set(pendingRequests.current));
    setSaveErrors((previous) => {
      const next = { ...previous };
      delete next[name];
      return next;
    });
    try {
      const api = new SimpleBackendApi(connection);
      const stages = await api.setDocumentStatus(name, stage, patch);
      if (generation !== sessionGeneration.current) return;
      setDocuments(
        (previous) =>
          previous?.map((item) =>
            item.name === name
              ? {
                  ...item,
                  stages,
                  status: stages.recognition.status,
                  annotator: stages.recognition.annotator,
                }
              : item,
          ) ?? null,
      );
    } catch (e) {
      if (generation === sessionGeneration.current) {
        setSaveErrors((previous) => ({ ...previous, [name]: String(e) }));
      }
    } finally {
      if (generation === sessionGeneration.current) {
        pendingRequests.current.delete(name);
        setPendingDocuments(new Set(pendingRequests.current));
      }
    }
  };

  const updateCommentCounts = (
    documentName: string,
    commentCountDelta: number,
    unresolvedCountDelta: number,
  ) => {
    setDocuments((previous) =>
      previous
        ? previous.map((document) =>
            document.name === documentName
              ? {
                  ...document,
                  commentCount: Math.max(
                    0,
                    (document.commentCount ?? 0) + commentCountDelta,
                  ),
                  unresolvedCommentCount: Math.max(
                    0,
                    (document.unresolvedCommentCount ?? 0) +
                      unresolvedCountDelta,
                  ),
                }
              : document,
          )
        : previous,
    );
  };

  return (
    <Box
      sx={{
        maxWidth: "1100px",
        margin: "80px auto",
        px: { xs: 1.5, sm: 2 },
      }}
    >
      <Typography level="h1" gutterBottom>
        Simple PHP Backend
      </Typography>
      <Link component={RouterLink} to="/" startDecorator={<ArrowBackIcon />}>
        Go Back Home
      </Link>
      <Link
        component={RouterLink}
        to="/annotation-guide"
        target="_blank"
        startDecorator={<MenuBookIcon />}
        sx={{ ml: 2 }}
      >
        Annotation guide & shortcuts
      </Link>
      <Typography level="body-md" sx={{ mt: 2, mb: 2 }}>
        Server URL: <code>{connection.backendUrl}</code>
      </Typography>

      <Typography level="h2">Authentication</Typography>
      <AuthenticationSection userName={userName} />

      <Box
        sx={{
          mt: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Typography level="h2">Documents</Typography>
      </Box>
      {connection.userToken === null && (
        <Alert>
          You must authenticate (the form above) to get access to documents.
        </Alert>
      )}
      {documents !== null && (
        <DocumentsList
          documents={documents}
          pendingDocuments={pendingDocuments}
          saveErrors={saveErrors}
          onStatusChange={handleStatusChange}
          onOpenComments={setCommentsDocumentName}
        />
      )}
      {commentsDocumentName !== null && (
        <ReviewCommentsDialog
          open={true}
          documentName={commentsDocumentName}
          onClose={() => setCommentsDocumentName(null)}
          onLoad={() =>
            new SimpleBackendApi(connection).listReviewComments(
              commentsDocumentName,
            )
          }
          onAdd={async (text, parentId) => {
            const comment = await new SimpleBackendApi(
              connection,
            ).addReviewComment(commentsDocumentName, text, parentId);
            updateCommentCounts(commentsDocumentName, 1, 1);
            return comment;
          }}
          onSetResolved={async (id, resolved) => {
            const comment = await new SimpleBackendApi(
              connection,
            ).setReviewCommentResolved(commentsDocumentName, id, resolved);
            updateCommentCounts(commentsDocumentName, 0, resolved ? -1 : 1);
            return comment;
          }}
        />
      )}
      {isLoading && <CircularProgress />}
      {error !== null && <Alert color="danger">{error}</Alert>}
    </Box>
  );
}
