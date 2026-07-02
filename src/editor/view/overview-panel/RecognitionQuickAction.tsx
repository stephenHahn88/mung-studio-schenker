import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  ButtonGroup,
  CircularProgress,
  FormControl,
  FormHelperText,
  FormLabel,
  Input,
  Option,
  Select,
  Sheet,
  Stack,
  Typography,
} from "@mui/joy";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import RedoIcon from "@mui/icons-material/Redo";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import UndoIcon from "@mui/icons-material/Undo";
import { useAtomValue } from "jotai";
import { useContext, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { EditorContext } from "../../EditorContext";
import {
  DEFAULT_LARGE_DETECTION_MODEL_KEY,
  DEFAULT_SMALL_DETECTION_MODEL_KEY,
  DEFAULT_YOLO26_DETECTION_OPTIONS,
  DetectionModelMetadata,
  DETECTION_MODEL_OPTIONS,
  SymbolDetectionRunOptions,
  SymbolDetectionSource,
  Yolo26DetectionApi,
  Yolo26DetectionOptions,
} from "../../controller/Yolo26DetectionApi";
import CropFreeIcon from "@mui/icons-material/CropFree";

type DetectionParameterKey = keyof Yolo26DetectionOptions;
type DetectionParameterValues = Record<DetectionParameterKey, string>;

const PARAMETER_DEFS: {
  readonly key: DetectionParameterKey;
  readonly label: string;
  readonly step: string;
  readonly helper: string;
}[] = [
  {
    key: "largeConf",
    label: "Large confidence threshold",
    step: "0.01",
    helper:
      "Confidence threshold for the large-symbol model; higher means fewer false positives but more missed symbols.",
  },
  {
    key: "tileConf",
    label: "Small confidence threshold",
    step: "0.01",
    helper:
      "Confidence threshold for the tiled small-symbol model; lower can find more small symbols.",
  },
  {
    key: "largeImgsz",
    label: "Large image size",
    step: "64",
    helper:
      "Input size for the large-symbol model; larger can be more accurate but slower.",
  },
  {
    key: "stripWidth",
    label: "Strip width",
    step: "128",
    helper:
      "Horizontal strip width for the large model; 0 uses the full page width.",
  },
  {
    key: "stripHeight",
    label: "Strip height",
    step: "64",
    helper:
      "Vertical strip height for the large model; controls how much page context is visible.",
  },
  {
    key: "stripStepX",
    label: "Strip step X",
    step: "1",
    helper:
      "Horizontal step between strips; usually keep this at 1 when using full-width strips.",
  },
  {
    key: "stripStepY",
    label: "Strip step Y",
    step: "32",
    helper:
      "Vertical step between strips; smaller gives more overlap and slower detection.",
  },
  {
    key: "tilePatch",
    label: "Tile patch",
    step: "64",
    helper:
      "Tile size for the small-symbol model; larger gives more context and slower detection.",
  },
  {
    key: "tileStep",
    label: "Tile step",
    step: "32",
    helper:
      "Step between small-symbol tiles; smaller gives more overlap and slower detection.",
  },
  {
    key: "tileMargin",
    label: "Tile margin",
    step: "16",
    helper:
      "Ignore predictions near tile edges to reduce duplicate border boxes.",
  },
  {
    key: "sameClassIou",
    label: "Same-class IoU",
    step: "0.01",
    helper:
      "Overlap threshold for merging boxes of the same class; lower merges more aggressively.",
  },
  {
    key: "sameClassAreaRatio",
    label: "Same-class area",
    step: "0.01",
    helper:
      "Area-similarity threshold for same-class deduplication; lower removes more boxes.",
  },
  {
    key: "xclassIou",
    label: "Cross-class IoU",
    step: "0.01",
    helper:
      "Overlap threshold for conflicting boxes of different classes; lower removes more conflicts.",
  },
  {
    key: "xclassAreaRatio",
    label: "Cross-class area",
    step: "0.01",
    helper:
      "Area-similarity threshold for cross-class deduplication; lower removes more conflicts.",
  },
];

const LARGE_MODEL_OPTIONS = DETECTION_MODEL_OPTIONS.filter(
  (option) => option.role === "large",
);

const SMALL_MODEL_OPTIONS = DETECTION_MODEL_OPTIONS.filter(
  (option) => option.role === "small",
);

function buildDefaultParameterValues(): DetectionParameterValues {
  const values = {} as DetectionParameterValues;
  for (const definition of PARAMETER_DEFS) {
    values[definition.key] = String(
      DEFAULT_YOLO26_DETECTION_OPTIONS[definition.key],
    );
  }
  return values;
}

function resolveOptions(
  values: DetectionParameterValues,
): Yolo26DetectionOptions {
  const options = {} as Yolo26DetectionOptions;
  for (const definition of PARAMETER_DEFS) {
    const key = definition.key;
    const parsedValue = Number(values[key]);
    options[key] = Number.isFinite(parsedValue)
      ? parsedValue
      : DEFAULT_YOLO26_DETECTION_OPTIONS[key];
  }
  return options;
}

function buildAvailabilityMap(
  models: readonly DetectionModelMetadata[],
): Record<string, boolean | undefined> {
  const availability: Record<string, boolean | undefined> = {};
  for (const model of models) {
    availability[model.key] = model.available;
  }
  return availability;
}

function findFirstAvailableModelKey(
  models: readonly DetectionModelMetadata[],
  role: "large" | "small",
): string | null {
  return (
    models.find((model) => model.role === role && model.available)?.key ?? null
  );
}

export function RecognitionQuickAction() {
  const { mainMenuController, recognitionRegionController } =
    useContext(EditorContext);
  const controller = mainMenuController;
  const documentName = useParams().documentName || "";

  const canRunYolo26Combined = useAtomValue(
    controller.canRunYolo26CombinedAtom,
  );
  const canClearYolo26Predictions = useAtomValue(
    controller.canClearYolo26PredictionsAtom,
  );
  const yolo26PredictionCount = useAtomValue(
    controller.yolo26PredictionCountAtom,
  );
  const isYolo26Running = useAtomValue(controller.isYolo26RunningAtom);
  const yolo26Status = useAtomValue(controller.yolo26StatusAtom);
  const canUndo = useAtomValue(controller.canUndoAtom);
  const canRedo = useAtomValue(controller.canRedoAtom);
  const isRecognitionRegionSelecting = useAtomValue(
    recognitionRegionController.isRegionSelectionActiveAtom,
  );
  const [parameterValues, setParameterValues] =
    useState<DetectionParameterValues>(() => buildDefaultParameterValues());
  const [largeModelKey, setLargeModelKey] = useState(
    DEFAULT_LARGE_DETECTION_MODEL_KEY,
  );
  const [smallModelKey, setSmallModelKey] = useState(
    DEFAULT_SMALL_DETECTION_MODEL_KEY,
  );
  const [modelAvailability, setModelAvailability] = useState<
    Record<string, boolean | undefined>
  >({});

  useEffect(() => {
    let cancelled = false;
    let api: Yolo26DetectionApi;
    try {
      api = new Yolo26DetectionApi();
    } catch {
      return () => {
        cancelled = true;
      };
    }

    api
      .listDetectionModels()
      .then((models) => {
        if (cancelled) {
          return;
        }
        const availability = buildAvailabilityMap(models);
        setModelAvailability(availability);
        const fallbackLarge = findFirstAvailableModelKey(models, "large");
        const fallbackSmall = findFirstAvailableModelKey(models, "small");
        setLargeModelKey((current) =>
          availability[current] === false && fallbackLarge !== null
            ? fallbackLarge
            : current,
        );
        setSmallModelKey((current) =>
          availability[current] === false && fallbackSmall !== null
            ? fallbackSmall
            : current,
        );
      })
      .catch(() => {
        // The detection buttons still surface backend connection errors.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function updateParameter(key: DetectionParameterKey, value: string) {
    setParameterValues((oldValues) => ({
      ...oldValues,
      [key]: value,
    }));
  }

  function buildRunOptions(
    source: SymbolDetectionSource | "both",
  ): SymbolDetectionRunOptions {
    return {
      ...resolveOptions(parameterValues),
      largeModelKey,
      smallModelKey,
      runLarge: source === "large" || source === "both",
      runSmall: source === "small" || source === "both",
      deduplicate: true,
    };
  }

  function modelAvailabilitySuffix(key: string): string {
    const available = modelAvailability[key];
    if (available === true) {
      return " (available)";
    }
    if (available === false) {
      return " (missing)";
    }
    return "";
  }

  const isLargeModelMissing = modelAvailability[largeModelKey] === false;
  const isSmallModelMissing = modelAvailability[smallModelKey] === false;
  const canRunLarge = canRunYolo26Combined && !isLargeModelMissing;
  const canRunSmall = canRunYolo26Combined && !isSmallModelMissing;
  const canRunBoth = canRunLarge && canRunSmall;

  return (
    <Sheet
      variant="soft"
      color="primary"
      sx={{
        p: 1,
        borderRadius: 8,
      }}
    >
      <Stack spacing={0.75}>
        <FormControl size="sm">
          <FormLabel>Large-symbol model</FormLabel>
          <Select
            size="sm"
            value={largeModelKey}
            disabled={isYolo26Running || isRecognitionRegionSelecting}
            onChange={(_, value) => {
              if (value !== null) {
                setLargeModelKey(value);
              }
            }}
          >
            {LARGE_MODEL_OPTIONS.map((option) => (
              <Option key={option.key} value={option.key}>
                {option.label}
                {modelAvailabilitySuffix(option.key)}
              </Option>
            ))}
          </Select>
        </FormControl>
        <FormControl size="sm">
          <FormLabel>Small-symbol model</FormLabel>
          <Select
            size="sm"
            value={smallModelKey}
            disabled={isYolo26Running || isRecognitionRegionSelecting}
            onChange={(_, value) => {
              if (value !== null) {
                setSmallModelKey(value);
              }
            }}
          >
            {SMALL_MODEL_OPTIONS.map((option) => (
              <Option key={option.key} value={option.key}>
                {option.label}
                {modelAvailabilitySuffix(option.key)}
              </Option>
            ))}
          </Select>
        </FormControl>
        <ButtonGroup size="sm" variant="solid" color="primary">
          <Button
            fullWidth
            disabled={!canRunLarge || isRecognitionRegionSelecting}
            startDecorator={
              isYolo26Running ? (
                <CircularProgress size="sm" color="neutral" />
              ) : (
                <AutoAwesomeIcon />
              )
            }
            onClick={() =>
              controller.runYolo26Combined(buildRunOptions("large"))
            }
          >
            Run large
          </Button>
          <Button
            fullWidth
            disabled={!canRunSmall || isRecognitionRegionSelecting}
            onClick={() =>
              controller.runYolo26Combined(buildRunOptions("small"))
            }
          >
            Run small
          </Button>
        </ButtonGroup>
        <Button
          size="sm"
          variant="solid"
          color="primary"
          fullWidth
          disabled={!canRunBoth || isRecognitionRegionSelecting}
          startDecorator={
            isYolo26Running ? (
              <CircularProgress size="sm" color="neutral" />
            ) : (
              <AutoAwesomeIcon />
            )
          }
          onClick={() => controller.runYolo26Combined(buildRunOptions("both"))}
        >
          {isYolo26Running ? "Running detector..." : "Run both"}
        </Button>
        <Button
          size="sm"
          variant="soft"
          color="success"
          fullWidth
          disabled={isRecognitionRegionSelecting}
          onClick={() => controller.predictEdges(documentName)}
        >
          Predict edges (small)
        </Button>
        <ButtonGroup size="sm" variant="soft" color="warning">
          <Button
            fullWidth
            disabled={!canRunLarge || isRecognitionRegionSelecting}
            startDecorator={<CropFreeIcon />}
            onClick={() =>
              recognitionRegionController.startRegionSelection(
                buildRunOptions("large"),
              )
            }
          >
            Area large
          </Button>
          <Button
            fullWidth
            disabled={!canRunSmall || isRecognitionRegionSelecting}
            onClick={() =>
              recognitionRegionController.startRegionSelection(
                buildRunOptions("small"),
              )
            }
          >
            Area small
          </Button>
        </ButtonGroup>
        <Button
          size="sm"
          variant="soft"
          color="warning"
          fullWidth
          disabled={!canRunBoth || isRecognitionRegionSelecting}
          startDecorator={<CropFreeIcon />}
          onClick={() =>
            recognitionRegionController.startRegionSelection(
              buildRunOptions("both"),
            )
          }
        >
          Area both
        </Button>
        {isRecognitionRegionSelecting && (
          <Typography level="body-xs" color="warning">
            Drag a recognition area on the page, or press Escape to cancel.
          </Typography>
        )}
        {(isLargeModelMissing || isSmallModelMissing) && (
          <Typography level="body-xs" color="warning">
            The selected model is missing on the backend.
          </Typography>
        )}
        <Accordion>
          <AccordionSummary sx={{ px: 0 }}>
            <Typography level="body-sm">Detection parameters</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 0 }}>
            <Stack spacing={1}>
              <Button
                size="sm"
                variant="plain"
                color="neutral"
                startDecorator={<RestartAltIcon />}
                disabled={isYolo26Running || isRecognitionRegionSelecting}
                onClick={() =>
                  setParameterValues(buildDefaultParameterValues())
                }
              >
                Reset defaults
              </Button>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "1fr",
                  gap: 1,
                  maxHeight: 320,
                  overflowY: "auto",
                  overscrollBehavior: "contain",
                  pr: 0.5,
                }}
              >
                {PARAMETER_DEFS.map((definition) => (
                  <FormControl key={definition.key} size="sm">
                    <FormLabel>
                      {definition.label}
                      <Typography
                        level="body-xs"
                        sx={{ ml: 0.75, color: "text.tertiary" }}
                      >
                        default{" "}
                        {DEFAULT_YOLO26_DETECTION_OPTIONS[definition.key]}
                      </Typography>
                    </FormLabel>
                    <Input
                      type="number"
                      value={parameterValues[definition.key]}
                      disabled={isYolo26Running || isRecognitionRegionSelecting}
                      slotProps={{
                        input: {
                          step: definition.step,
                        },
                      }}
                      onChange={(event) =>
                        updateParameter(definition.key, event.target.value)
                      }
                    />
                    <FormHelperText>{definition.helper}</FormHelperText>
                  </FormControl>
                ))}
              </Box>
            </Stack>
          </AccordionDetails>
        </Accordion>
        <Button
          size="sm"
          variant="soft"
          color="danger"
          fullWidth
          disabled={
            !canClearYolo26Predictions ||
            isYolo26Running ||
            isRecognitionRegionSelecting
          }
          startDecorator={<DeleteSweepIcon />}
          onClick={() => controller.clearYolo26Predictions()}
        >
          Clear predictions
          {yolo26PredictionCount > 0 ? ` (${yolo26PredictionCount})` : ""}
        </Button>
        <ButtonGroup size="sm" variant="soft" color="neutral">
          <Button
            fullWidth
            disabled={
              !canUndo || isYolo26Running || isRecognitionRegionSelecting
            }
            startDecorator={<UndoIcon />}
            onClick={() => controller.undo()}
          >
            Undo
          </Button>
          <Button
            fullWidth
            disabled={
              !canRedo || isYolo26Running || isRecognitionRegionSelecting
            }
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
          {yolo26Status || "Run selected symbol detectors on the current page."}
        </Typography>
      </Stack>
    </Sheet>
  );
}
