import { Button, Snackbar } from "@mui/joy";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import { useState } from "react";
import { Yolo26DetectionApi } from "../../controller/Yolo26DetectionApi";

/**
 * A "Backup now" button that triggers an off-site Google Drive backup of ALL
 * documents on the server (versioned: current mirror + daily snapshots +
 * archived old versions). Feedback is shown in a transient snackbar.
 */
export function BackupButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  async function handleBackup() {
    setBusy(true);
    setResult(null);
    try {
      const api = new Yolo26DetectionApi();
      const response = await api.backupDocuments();
      setResult({
        ok: response.ok,
        text: response.ok
          ? "All documents backed up to Google Drive."
          : "Backup failed: " +
            (response.error ?? response.log ?? "unknown error"),
      });
    } catch (error) {
      setResult({ ok: false, text: String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="soft"
        color="neutral"
        fullWidth
        loading={busy}
        startDecorator={<CloudUploadIcon />}
        onClick={handleBackup}
      >
        Backup now
      </Button>
      <Snackbar
        open={result !== null}
        autoHideDuration={5000}
        onClose={() => setResult(null)}
        variant="soft"
        color={result?.ok ? "success" : "danger"}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        {result?.text}
      </Snackbar>
    </>
  );
}
