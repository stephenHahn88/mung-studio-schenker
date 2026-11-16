import AddIcon from "@mui/icons-material/Add";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import SearchIcon from "@mui/icons-material/Search";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  FormHelperText,
  FormLabel,
  IconButton,
  Input,
  Modal,
  ModalClose,
  Sheet,
  Stack,
  Tooltip,
  Typography,
} from "@mui/joy";
import { useAtomValue } from "jotai";
import { FormEvent, useContext, useMemo, useState } from "react";
import { EditorContext } from "../../EditorContext";
import { ClassCatalogStore } from "../../model/ClassCatalogStore";
import {
  classNameToColor,
  ClassColorOverrides,
} from "../../../mung/classNameToColor";
import { classNameToDisplayName } from "../../../mung/classNameToDisplayName";

/** Shared custom classes and class colors. */
export function SymbolClassesPanel() {
  const { classCatalogStore } = useContext(EditorContext);
  const canAdd = useAtomValue(classCatalogStore.canAddClassesAtom);
  const canSetColors = useAtomValue(classCatalogStore.canSetClassColorsAtom);
  const customClassNames = useAtomValue(classCatalogStore.customClassNamesAtom);
  const allClassNames = useAtomValue(classCatalogStore.allClassNamesAtom);
  const colorOverrides = useAtomValue(
    classCatalogStore.classColorOverridesAtom,
  );
  const [search, setSearch] = useState("");
  const [isOpen, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setSaving] = useState(false);

  const customNames = useMemo(
    () => new Set(customClassNames),
    [customClassNames],
  );
  const filteredNames = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return allClassNames;
    return allClassNames.filter(
      (name) =>
        name.toLowerCase().includes(query) ||
        classNameToDisplayName(name).toLowerCase().includes(query),
    );
  }, [allClassNames, search]);

  const close = () => {
    if (isSaving) return;
    setOpen(false);
    setDraft("");
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await classCatalogStore.addCustomClass(draft);
      setOpen(false);
      setDraft("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Accordion defaultExpanded={true}>
        <AccordionSummary>
          <Typography level="title-sm">Manage Classes</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography level="body-xs" sx={{ mb: 1 }}>
            {allClassNames.length} classes, including {customClassNames.length}
            {" custom"}. Colors are shared and affect display only.
          </Typography>
          <Button
            size="sm"
            variant="soft"
            color="neutral"
            fullWidth
            startDecorator={<AddIcon />}
            disabled={!canAdd}
            onClick={() => setOpen(true)}
            sx={{ mb: 1 }}
          >
            Add class
          </Button>
          <Input
            size="sm"
            value={search}
            startDecorator={<SearchIcon />}
            placeholder="Search classes"
            onChange={(event) => setSearch(event.target.value)}
            sx={{ mb: 1 }}
          />
          <Stack
            spacing={0.5}
            sx={{ maxHeight: 360, overflowY: "auto", pr: 0.5 }}
          >
            {filteredNames.map((className) => (
              <ClassColorRow
                key={className}
                className={className}
                isCustom={customNames.has(className)}
                colorOverrides={colorOverrides}
                canSetColors={canSetColors}
                classCatalogStore={classCatalogStore}
              />
            ))}
            {filteredNames.length === 0 && (
              <Typography level="body-xs">No matching classes.</Typography>
            )}
          </Stack>
        </AccordionDetails>
      </Accordion>
      <Modal
        open={isOpen}
        onClose={close}
        aria-labelledby="add-class-title"
        sx={{ display: "flex", justifyContent: "center", alignItems: "center" }}
      >
        <Sheet
          component="form"
          onSubmit={submit}
          variant="outlined"
          sx={{ width: 460, maxWidth: "90vw", borderRadius: "md", p: 3 }}
        >
          <ModalClose disabled={isSaving} />
          <Typography id="add-class-title" level="h4" sx={{ mb: 2 }}>
            Add a shared symbol class
          </Typography>
          <Stack spacing={2}>
            <FormControl error={error !== null}>
              <FormLabel>Class name</FormLabel>
              <Input
                autoFocus
                value={draft}
                disabled={isSaving}
                placeholder="e.g. prolongationBracket"
                onChange={(event) => setDraft(event.target.value)}
              />
              <FormHelperText>
                Use a stable camelCase identifier. Add a class only when the
                symbol type is genuinely new; use Uncertain if you are unsure.
              </FormHelperText>
            </FormControl>
            {error !== null && <Alert color="danger">{error}</Alert>}
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button variant="plain" color="neutral" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" loading={isSaving} disabled={!draft.trim()}>
                Add class
              </Button>
            </Stack>
          </Stack>
        </Sheet>
      </Modal>
    </>
  );
}

function ClassColorRow(props: {
  readonly className: string;
  readonly isCustom: boolean;
  readonly colorOverrides: ClassColorOverrides;
  readonly canSetColors: boolean;
  readonly classCatalogStore: ClassCatalogStore;
}) {
  const [pendingColor, setPendingColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const override = props.colorOverrides[props.className];
  const color =
    pendingColor ?? classNameToColor(props.className, props.colorOverrides);

  const updateColor = async (newColor: string | null) => {
    setPendingColor(newColor);
    setError(null);
    try {
      await props.classCatalogStore.setClassColor(props.className, newColor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPendingColor(null);
    }
  };

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "30px minmax(0, 1fr) 30px",
        gap: 0.5,
        alignItems: "center",
        p: 0.5,
        borderRadius: "sm",
        bgcolor: "background.level1",
      }}
    >
      <Tooltip
        title={props.canSetColors ? "Choose display color" : "Unavailable"}
      >
        <Box
          component="input"
          type="color"
          value={color}
          disabled={!props.canSetColors}
          onChange={(event) => updateColor(event.target.value)}
          sx={{
            width: 28,
            height: 28,
            p: 0,
            border: 0,
            bgcolor: "transparent",
          }}
        />
      </Tooltip>
      <Box sx={{ minWidth: 0 }}>
        <Typography level="body-xs" noWrap title={props.className}>
          {classNameToDisplayName(props.className)}
        </Typography>
        {props.isCustom && <Chip size="sm">custom</Chip>}
        {error !== null && (
          <Typography level="body-xs" color="danger" title={error} noWrap>
            {error}
          </Typography>
        )}
      </Box>
      <Tooltip
        title={override ? "Restore default color" : "Using default color"}
      >
        <span>
          <IconButton
            size="sm"
            variant="plain"
            disabled={!props.canSetColors || override === undefined}
            onClick={() => updateColor(null)}
          >
            <RestartAltIcon />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
}
