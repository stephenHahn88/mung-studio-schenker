import { Alert, Box, Button, CircularProgress, Typography } from "@mui/joy";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import { useAtomValue } from "jotai";
import { simpleBackendConnectionAtom } from "./SimpleBackendConnection";
import { AuthenticationSection } from "./AuthenticationSection";
import { useEffect, useState } from "react";
import { Document, DocStatus, SimpleBackendApi } from "./SimpleBackendApi";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Link as RouterLink } from "react-router-dom";
import Link from "@mui/joy/Link";
import { DocumentsList } from "./DocumentsList";

export function DocumentsPage() {
  const connection = useAtomValue(simpleBackendConnectionAtom);

  const [documents, setDocuments] = useState<Document[] | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (connection.userToken === null) {
      setError(null);
      setIsLoading(false);
      return;
    }

    (async () => {
      setIsLoading(true);
      setDocuments(null);
      setUserName(null);
      setError(null);

      try {
        const api = new SimpleBackendApi(connection);
        const documents = await api.listDocuments();
        const whoamiResponse = await api.whoami();
        setDocuments(documents);
        setUserName(whoamiResponse.name);
        setIsLoading(false);
      } catch (e) {
        setError(String(e));
        setIsLoading(false);
      }
    })();
  }, [connection.userToken]);

  const handleStatusChange = (
    name: string,
    status: DocStatus,
    annotator: string,
  ) => {
    // optimistic local update, then persist
    setDocuments((prev) =>
      prev
        ? prev.map((d) => (d.name === name ? { ...d, status, annotator } : d))
        : prev,
    );
    const api = new SimpleBackendApi(connection);
    api.setDocumentStatus(name, status, annotator).catch((e) => {
      setError(String(e));
    });
  };

  const [backingUp, setBackingUp] = useState<boolean>(false);
  const [backupMsg, setBackupMsg] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const handleBackup = async () => {
    setBackingUp(true);
    setBackupMsg(null);
    try {
      const api = new SimpleBackendApi(connection);
      const r = await api.backupDocuments();
      setBackupMsg({
        ok: r.ok,
        text: r.ok
          ? "Backed up all documents to Google Drive."
          : "Backup failed: " + (r.error ?? r.log ?? "unknown error"),
      });
    } catch (e) {
      setBackupMsg({ ok: false, text: String(e) });
    } finally {
      setBackingUp(false);
    }
  };

  return (
    <Box
      sx={{
        maxWidth: "800px",
        margin: "80px auto",
      }}
    >
      <Typography level="h1" gutterBottom>
        Simple PHP Backend
      </Typography>
      <Link component={RouterLink} to="/" startDecorator={<ArrowBackIcon />}>
        Go Back Home
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
        {connection.userToken !== null && (
          <Button
            variant="outlined"
            color="neutral"
            size="sm"
            startDecorator={<CloudUploadIcon />}
            loading={backingUp}
            onClick={handleBackup}
          >
            Backup now
          </Button>
        )}
      </Box>
      {backupMsg !== null && (
        <Alert color={backupMsg.ok ? "success" : "danger"} sx={{ mt: 1 }}>
          {backupMsg.text}
        </Alert>
      )}
      {connection.userToken === null && (
        <Alert>
          You must authenticate (the form above) to get access to documents.
        </Alert>
      )}
      {documents !== null && (
        <DocumentsList
          documents={documents}
          userName={userName}
          onStatusChange={handleStatusChange}
        />
      )}
      {isLoading && <CircularProgress />}
      {error !== null && <Alert color="danger">{error}</Alert>}
    </Box>
  );
}
