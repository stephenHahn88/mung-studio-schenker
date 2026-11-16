import {
  Box,
  Button,
  ButtonGroup,
  CircularProgress,
  FormControl,
  FormLabel,
  Input,
  Sheet,
  Stack,
  Tooltip,
  Typography,
} from "@mui/joy";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CropFreeIcon from "@mui/icons-material/CropFree";
import DataObjectIcon from "@mui/icons-material/DataObject";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import RedoIcon from "@mui/icons-material/Redo";
import UndoIcon from "@mui/icons-material/Undo";
import { useAtomValue } from "jotai";
import { useContext, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { EditorContext } from "../../EditorContext";
import {
  ModelApi,
  ModelAvailabilityMap,
  parseConfidence,
} from "../../controller/ModelApi";
import { ModelAction } from "../../controller/MainMenuController";
import {
  RELATION_INFERENCE_ENABLED,
  SYMBOL_INFERENCE_ENABLED,
} from "../../../utils/featureFlags";
import { documentConversionPath } from "../../../pages/simple-backend/DocumentConversion";

const ACTIONS: readonly {
  readonly action: ModelAction;
  readonly label: string;
  readonly tooltip: string;
}[] = [
  {
    action: "symbols",
    label: "Detect symbols",
    tooltip:
      "Symbol detector (YOLOv8L + RF-DETR). Replaces earlier predicted symbols in the page or area; manual symbols are kept.",
  },
  {
    action: "syntaxLinks",
    label: "Predict syntax links",
    tooltip:
      "Syntax-link model on the current symbols. Adds predicted links between symbols that are not linked yet.",
  },
  {
    action: "timeGroups",
    label: "Predict time groups",
    tooltip:
      "Time-group model on the current symbols. Groups only noteheads that are not in a group yet.",
  },
  {
    action: "precedence",
    label: "Predict precedence links",
    tooltip:
      "Precedence-link model on the current symbols. Adds predicted links between symbols that are not linked yet.",
  },
];

/** Model actions, each on the whole page or on a dragged area. */
export function ModelActionsPanel() {
  const { mainMenuController, recognitionRegionController, autosaveStore } =
    useContext(EditorContext);
  const controller = mainMenuController;
  const documentName = useParams().documentName || "";

  const canRunModels = useAtomValue(controller.canRunModelsAtom);
  const isModelRunning = useAtomValue(controller.isModelRunningAtom);
  const modelStatus = useAtomValue(controller.modelStatusAtom);
  const canClearPredictedSymbols = useAtomValue(
    controller.canClearPredictedSymbolsAtom,
  );
  const predictedSymbolCount = useAtomValue(
    controller.predictedSymbolCountAtom,
  );
  const syntaxEdgeCount = useAtomValue(controller.syntaxEdgeCountAtom);
  const canUndo = useAtomValue(controller.canUndoAtom);
  const canRedo = useAtomValue(controller.canRedoAtom);
  const isAreaSelecting = useAtomValue(
    recognitionRegionController.isRegionSelectionActiveAtom,
  );

  const [availability, setAvailability] = useState<ModelAvailabilityMap>({});
  const [thresholdText, setThresholdText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const scoreThreshold = parseConfidence(thresholdText);
  const validThreshold = thresholdText.trim() === "" || scoreThreshold !== null;

  useEffect(() => {
    if (!SYMBOL_INFERENCE_ENABLED && !RELATION_INFERENCE_ENABLED) return;
    let cancelled = false;
    let api: ModelApi;
    try {
      api = new ModelApi();
    } catch {
      return;
    }
    api
      .listModels()
      .then((models) => {
        if (!cancelled) setAvailability(models);
      })
      .catch(() => {
        // errors are reported when an action runs
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const busy = isModelRunning || isAreaSelecting || isSaving;

  function isEnabled(action: ModelAction): boolean {
    const flag =
      action === "symbols"
        ? SYMBOL_INFERENCE_ENABLED
        : RELATION_INFERENCE_ENABLED;
    return flag && availability[action]?.available !== false;
  }

  function options() {
    return { scoreThreshold: scoreThreshold };
  }

  async function saveIfNeeded(): Promise<void> {
    if (!autosaveStore.isDirty) return;
    if (!autosaveStore.saveCallback) {
      throw new Error("Save the page before converting it.");
    }
    const revision = autosaveStore.revision;
    await autosaveStore.saveCallback();
    autosaveStore.setClean(revision);
  }

  async function convertToJson() {
    setIsSaving(true);
    try {
      await saveIfNeeded();
      const url = new URL(window.location.href);
      url.hash = documentConversionPath(documentName);
      window.open(url.toString(), "_blank", "noopener,noreferrer");
    } catch (error) {
      controller.setModelStatus("Conversion could not start: " + String(error));
    } finally {
      setIsSaving(false);
    }
  }

  const unavailable = ACTIONS.filter(
    ({ action }) => availability[action]?.available === false,
  );

  return (
    <Sheet variant="soft" color="primary" sx={{ p: 1, borderRadius: 8 }}>
      <Stack spacing={0.75}>
        <FormControl size="sm" error={!validThreshold}>
          <Tooltip title="Score threshold of the symbol detector. Leave empty to use the threshold configured on the server.">
            <FormLabel>Symbol score threshold</FormLabel>
          </Tooltip>
          <Input
            type="number"
            value={thresholdText}
            placeholder="server default"
            disabled={busy}
            slotProps={{
              input: {
                "aria-label": "Symbol score threshold",
                step: 0.05,
                min: 0,
                max: 1,
              },
            }}
            onChange={(event) => setThresholdText(event.target.value)}
          />
        </FormControl>
        {!validThreshold && (
          <Typography level="body-xs" color="danger" role="alert">
            Enter a threshold from 0 to 1, or leave the field empty.
          </Typography>
        )}

        {ACTIONS.map(({ action, label, tooltip }) => (
          <Box
            key={action}
            sx={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              gap: 0.5,
            }}
          >
            <Tooltip title={tooltip} placement="right">
              <Button
                size="sm"
                variant={action === "symbols" ? "solid" : "soft"}
                color="primary"
                disabled={
                  !canRunModels ||
                  busy ||
                  !isEnabled(action) ||
                  (action === "symbols" && !validThreshold)
                }
                startDecorator={
                  isModelRunning ? (
                    <CircularProgress size="sm" color="neutral" />
                  ) : (
                    <AutoAwesomeIcon />
                  )
                }
                onClick={() =>
                  controller.runModel(action, documentName, null, options())
                }
                sx={{ justifyContent: "flex-start" }}
              >
                {label}
              </Button>
            </Tooltip>
            <Tooltip title="Run on an area: drag a rectangle on the page.">
              <Button
                size="sm"
                variant="soft"
                color="warning"
                aria-label={`${label} in an area`}
                disabled={
                  !canRunModels ||
                  busy ||
                  !isEnabled(action) ||
                  (action === "symbols" && !validThreshold)
                }
                startDecorator={<CropFreeIcon />}
                onClick={() =>
                  recognitionRegionController.startRegionSelection(
                    action,
                    documentName,
                    options(),
                  )
                }
              >
                Area
              </Button>
            </Tooltip>
          </Box>
        ))}
        {isAreaSelecting && (
          <Typography level="body-xs" color="warning">
            Drag an area on the page, or press Escape to cancel.
          </Typography>
        )}
        {unavailable.length > 0 && (
          <Typography level="body-xs" color="warning">
            Not configured on this server:{" "}
            {unavailable.map(({ label }) => label.toLowerCase()).join(", ")}.
          </Typography>
        )}

        <Tooltip title="Save the page and open the graph-to-JSON conversion in a new tab.">
          <Button
            size="sm"
            variant="soft"
            color="success"
            disabled={
              busy ||
              !documentName ||
              availability.conversion?.available === false
            }
            loading={isSaving}
            startDecorator={<DataObjectIcon />}
            onClick={() => void convertToJson()}
          >
            Convert to JSON
          </Button>
        </Tooltip>

        <Button
          size="sm"
          variant="soft"
          color="danger"
          fullWidth
          disabled={!canClearPredictedSymbols || busy}
          startDecorator={<DeleteSweepIcon />}
          onClick={() => {
            const confirmed = window.confirm(
              "Delete every symbol that is still tagged as a model prediction? Predictions that you resized or reclassified keep the tag and are also deleted.",
            );
            if (confirmed) controller.clearPredictedSymbols();
          }}
        >
          Clear predicted symbols
          {predictedSymbolCount > 0 ? ` (${predictedSymbolCount})` : ""}
        </Button>
        <Button
          size="sm"
          variant="soft"
          color="danger"
          fullWidth
          disabled={syntaxEdgeCount === 0 || busy}
          startDecorator={<DeleteSweepIcon />}
          onClick={() => {
            const confirmed = window.confirm(
              "Delete every syntax link on this page? This includes manually annotated links.",
            );
            if (confirmed) controller.clearAllEdges();
          }}
        >
          Clear all syntax links
          {syntaxEdgeCount > 0 ? ` (${syntaxEdgeCount})` : ""}
        </Button>
        <ButtonGroup size="sm" variant="soft" color="neutral">
          <Button
            fullWidth
            disabled={!canUndo || busy}
            startDecorator={<UndoIcon />}
            onClick={() => controller.undo()}
          >
            Undo
          </Button>
          <Button
            fullWidth
            disabled={!canRedo || busy}
            startDecorator={<RedoIcon />}
            onClick={() => controller.redo()}
          >
            Redo
          </Button>
        </ButtonGroup>
        <Typography
          level="body-xs"
          sx={{
            color: "var(--joy-palette-primary-plainColor)",
            overflowWrap: "anywhere",
          }}
        >
          {modelStatus ||
            "Run a model on the page or on an area, then correct its predictions."}
        </Typography>
      </Stack>
    </Sheet>
  );
}
