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
  const [customClassNames, setCustomClassNames] = useState<string[]>([]);
  const [classColorOverrides, setClassColorOverrides] = useState<
    Readonly<Record<string, string>>
  >({});
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (imageUrl !== null) URL.revokeObjectURL(imageUrl);
      if (originalImageUrl !== null) URL.revokeObjectURL(originalImageUrl);
    };
  }, [imageUrl, originalImageUrl]);

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
      setOriginalImageUrl(null);
      setCustomClassNames([]);
      setClassColorOverrides({});
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

        // The class registry is global and intentionally separate from the
        // document annotation file.
        const [mungXmlString, imageBlob, originalImageBlob, classCatalog] =
          await Promise.all([
            api.getDocumentMung(documentName),
            api.getDocumentImage(documentName),
            api.getDocumentOriginalImage(documentName).catch(() => null),
            api.getClassCatalog(),
          ]);
        const parsedMung = readMungXmlString(mungXmlString);

        const downloadedImageUrl =
          imageBlob === null ? null : URL.createObjectURL(imageBlob);
        const downloadedOriginalImageUrl =
          originalImageBlob === null
            ? null
            : URL.createObjectURL(originalImageBlob);

        setMung(parsedMung);
        setImageUrl(downloadedImageUrl);
        setOriginalImageUrl(downloadedOriginalImageUrl);
        setCustomClassNames(classCatalog.classes.map((item) => item.name));
        setClassColorOverrides(classCatalog.colorOverrides);
        setIsLoading(false);
      } catch (e) {
        setError(String(e));
        setIsLoading(false);
      }
    })();
  }, [connection.backendUrl, connection.userToken, documentName]);

  // Keep already-open annotation tabs in sync when another annotator adds a
  // class. The registry is tiny, so a low-frequency refresh is sufficient.
  useEffect(() => {
    if (connection.userToken === null) return;
    let isActive = true;
    const refreshClasses = async () => {
      try {
        const catalog = await new SimpleBackendApi(
          connection,
        ).getClassCatalog();
        if (!isActive) return;
        const names = catalog.classes.map((item) => item.name);
        setCustomClassNames((previous) =>
          previous.length === names.length &&
          previous.every((name, index) => name === names[index])
            ? previous
            : names,
        );
        setClassColorOverrides((previous) =>
          JSON.stringify(previous) === JSON.stringify(catalog.colorOverrides)
            ? previous
            : catalog.colorOverrides,
        );
      } catch (caught) {
        console.warn("Could not refresh shared symbol classes.", caught);
      }
    };
    const intervalId = window.setInterval(refreshClasses, 30_000);
    window.addEventListener("focus", refreshClasses);
    return () => {
      isActive = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshClasses);
    };
  }, [connection.backendUrl, connection.userToken]);

  async function onSave(mung: MungFile): Promise<void> {
    const mungXmlString = writeMungXmlString(mung);
    const api = new SimpleBackendApi(connection);
    await api.uploadDocumentMung(documentName, mungXmlString);
  }

  function onClose() {
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
          originalBackgroundImageUrl={originalImageUrl}
          onSave={onSave}
          onClose={onClose}
          fileName={documentName}
          initialCustomClassNames={customClassNames}
          initialClassColorOverrides={classColorOverrides}
          onAddCustomClass={async (className: string) => {
            const result = await new SimpleBackendApi(
              connection,
            ).addCustomClass(className);
            setCustomClassNames(result.classes.map((item) => item.name));
            return result.class.name;
          }}
          onSetClassColor={async (className: string, color: string | null) => {
            const result = await new SimpleBackendApi(connection).setClassColor(
              className,
              color,
            );
            setClassColorOverrides(result.colorOverrides);
            return result.colorOverrides;
          }}
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
