import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Sheet,
  Stack,
  Typography,
} from "@mui/joy";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DownloadIcon from "@mui/icons-material/Download";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { Link as RouterLink, useLocation, useParams } from "react-router-dom";
import {
  conversionDirectoryPath,
  conversionFileName,
  conversionJsonText,
  conversionNotationJson,
  DocumentConversionResult,
} from "./DocumentConversion";
import { SimpleBackendApi } from "./SimpleBackendApi";
import {
  SimpleBackendConnection,
  simpleBackendConnectionAtom,
} from "./SimpleBackendConnection";

function downloadJson(text: string, fileName: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** Converter output with downloads of the notation JSON and the full output. */
export function ConversionPreview({
  documentName,
  result,
}: {
  readonly documentName: string;
  readonly result: DocumentConversionResult;
}) {
  const notation = conversionNotationJson(result);
  const hasReport = notation !== result.result;
  const notationText = conversionJsonText(notation);
  const fullText = conversionJsonText(result.result);
  const [showFull, setShowFull] = useState(false);
  return (
    <Stack spacing={1} sx={{ p: { xs: 1.5, sm: 2 }, flex: 1, minHeight: 0 }}>
      <Stack
        direction="row"
        sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}
      >
        <Typography level="title-md" sx={{ flex: 1 }}>
          {showFull ? "Full converter output" : "JSON notation"}
        </Typography>
        {hasReport && (
          <Button
            size="sm"
            variant="outlined"
            color="neutral"
            onClick={() => setShowFull((value) => !value)}
          >
            {showFull ? "Show JSON notation" : "Show full output"}
          </Button>
        )}
        <Button
          size="sm"
          variant="solid"
          startDecorator={<DownloadIcon />}
          onClick={() =>
            downloadJson(notationText, conversionFileName(documentName))
          }
        >
          Download {conversionFileName(documentName)}
        </Button>
        {hasReport && (
          <Button
            size="sm"
            variant="soft"
            startDecorator={<DownloadIcon />}
            onClick={() =>
              downloadJson(
                fullText,
                conversionFileName(documentName, "_conversion"),
              )
            }
          >
            Download full output
          </Button>
        )}
      </Stack>
      <Typography level="body-sm">
        The JSON follows the Schenkerian analysis representation of Ni-Hahn et
        al. and can be typeset with their notation software, which is
        distributed separately under its own license.
      </Typography>
      <Sheet
        variant="outlined"
        data-testid="conversion-json"
        sx={{
          flex: 1,
          minHeight: "50vh",
          overflow: "auto",
          borderRadius: "sm",
          p: 1.5,
        }}
      >
        <Box
          component="pre"
          sx={{
            m: 0,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "0.8rem",
            whiteSpace: "pre",
          }}
        >
          {showFull ? fullText : notationText}
        </Box>
      </Sheet>
    </Stack>
  );
}

function ConversionSession({
  documentName,
  connection,
}: {
  readonly documentName: string;
  readonly connection: SimpleBackendConnection;
}) {
  const { search } = useLocation();
  const [request, setRequest] = useState(0);
  const [result, setResult] = useState<DocumentConversionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let timedOut = false;
    setResult(null);
    setError(null);
    if (!connection.userToken) {
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 120_000);
    new SimpleBackendApi(connection)
      .convertDocument(documentName, controller.signal)
      .then((next) => {
        if (active) setResult(next);
      })
      .catch((caught) => {
        if (!active) return;
        setError(
          timedOut
            ? "The conversion request timed out. Please try again."
            : caught instanceof Error
              ? caught.message
              : "Conversion failed. Please try again.",
        );
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [documentName, connection.backendUrl, connection.userToken, request]);

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        minHeight: "100vh",
      }}
    >
      <Box
        sx={{
          p: { xs: 1.5, sm: 2 },
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Stack
          direction="row"
          sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}
        >
          <Button
            component={RouterLink}
            to={conversionDirectoryPath(search)}
            variant="plain"
            color="neutral"
            size="sm"
            startDecorator={<ArrowBackIcon />}
          >
            Back to directory
          </Button>
          <Typography
            level="h3"
            sx={{ flex: "1 1 200px", overflowWrap: "anywhere" }}
          >
            Graph-to-JSON conversion
          </Typography>
          <Button
            component={RouterLink}
            to={`/simple-backend/${encodeURIComponent(documentName)}`}
            target="_blank"
            rel="noopener noreferrer"
            size="sm"
            variant="outlined"
            color="neutral"
          >
            Open annotations
          </Button>
          <Button
            size="sm"
            variant="soft"
            startDecorator={<RefreshIcon />}
            disabled={!connection.userToken || loading}
            onClick={() => setRequest((value) => value + 1)}
          >
            Convert again
          </Button>
        </Stack>
        <Typography level="body-sm" sx={{ mt: 0.75, overflowWrap: "anywhere" }}>
          {documentName} · converts the last saved annotations of this page.
        </Typography>
      </Box>
      {!connection.userToken && (
        <Alert color="warning" sx={{ m: 2 }}>
          Sign in from the directory to convert this page.
        </Alert>
      )}
      {loading && (
        <Stack alignItems="center" spacing={2} sx={{ py: 6 }} role="status">
          <CircularProgress />
          <Typography>Converting the saved annotations…</Typography>
        </Stack>
      )}
      {error && (
        <Alert color="danger" role="alert" sx={{ m: 2 }}>
          {error}
        </Alert>
      )}
      {result && (
        <ConversionPreview documentName={documentName} result={result} />
      )}
    </Box>
  );
}

export function DocumentConversionPage() {
  const documentName = useParams().documentName ?? "";
  const connection = useAtomValue(simpleBackendConnectionAtom);
  // remount on page or session change
  return (
    <ConversionSession
      key={JSON.stringify([
        documentName,
        connection.backendUrl,
        connection.userToken,
      ])}
      documentName={documentName}
      connection={connection}
    />
  );
}
