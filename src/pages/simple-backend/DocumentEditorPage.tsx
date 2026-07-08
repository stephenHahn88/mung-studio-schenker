import { useNavigate, useParams } from "react-router-dom";
import { Alert, Box, CircularProgress } from "@mui/joy";
import { Editor } from "../../editor/Editor";
import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { simpleBackendConnectionAtom } from "./SimpleBackendConnection";
import { SimpleBackendApi } from "./SimpleBackendApi";
import { readMungXmlString } from "../../mung/readMungXmlString";
import { MungFile } from "../../mung/MungFile";
import { writeMungXmlString } from "../../mung/writeMungXmlString";

export function DocumentEditorPage() {
  const navigate = useNavigate();
  const documentName: string = useParams().documentName || "";
  const connection = useAtomValue(simpleBackendConnectionAtom);

  const [mung, setMung] = useState<MungFile | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>("");

  useEffect(() => {
    if (connection.userToken === null) {
      setError(null);
      setIsLoading(false);
      return;
    }

    (async () => {
      setIsLoading(true);
      setMung(null);
      setImageUrl(null);
      setError(null);

      try {
        const api = new SimpleBackendApi(connection);

        // who am I (for collaboration presence)
        try {
          const who = await api.whoami();
          setUserName(who.name);
        } catch {
          /* non-fatal: presence just shows a generic name */
        }

        // download MuNG and parse into nodes
        const mungXmlString = await api.getDocumentMung(documentName);
        const parsedMung = readMungXmlString(mungXmlString);

        // download background image
        const imageBlob = await api.getDocumentImage(documentName);
        const downloadedImageUrl =
          imageBlob === null ? null : URL.createObjectURL(imageBlob);

        setMung(parsedMung);
        setImageUrl(downloadedImageUrl);
        setIsLoading(false);
      } catch (e) {
        setError(String(e));
        setIsLoading(false);
      }
    })();
  }, [connection.userToken]);

  async function onSave(mung: MungFile): Promise<void> {
    const mungXmlString = writeMungXmlString(mung);
    const api = new SimpleBackendApi(connection);
    await api.uploadDocumentMung(documentName, mungXmlString);
  }

  function onClose() {
    if (imageUrl !== null) {
      URL.revokeObjectURL(imageUrl);
    }

    navigate("/simple-backend");
  }

  return (
    <Box
      sx={{
        position: "relative",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      {isLoading && <CircularProgress />}
      {mung !== null && (
        <Editor
          initialMungFileMetadata={mung.metadata}
          initialNodes={mung.nodes}
          backgroundImageUrl={imageUrl}
          onSave={onSave}
          onClose={onClose}
          fileName={documentName}
          collabConfig={
            connection.userToken !== null
              ? {
                  backendUrl: connection.backendUrl,
                  token: connection.userToken,
                  documentName,
                  userName: userName || "Anonymous",
                }
              : null
          }
        />
      )}
      {error !== null && <Alert color="danger">{error}</Alert>}
    </Box>
  );
}
