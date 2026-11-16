import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import {
  FormControl,
  FormHelperText,
  FormLabel,
  Option,
  Select,
  Stack,
} from "@mui/joy";
import { useAtom } from "jotai";
import { useContext } from "react";
import { EditorContext } from "../../EditorContext";
import { PageImageMode } from "../../model/EditorStateStore";

/** Selects the page image shown in the canvas. */
export function PageImagePanel() {
  const { editorStateStore, backgroundImageStore } = useContext(EditorContext);
  const [pageImageMode, setPageImageMode] = useAtom(
    editorStateStore.pageImageModeAtom,
  );
  const hasOriginalImage = backgroundImageStore.originalImageUrl !== null;

  return (
    <FormControl size="sm">
      <FormLabel>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <ImageOutlinedIcon fontSize="small" />
          <span>Page image</span>
        </Stack>
      </FormLabel>
      <Select
        value={pageImageMode}
        color="primary"
        variant="outlined"
        onChange={(_event, value) => {
          if (value !== null) setPageImageMode(value);
        }}
      >
        <Option value={PageImageMode.ProcessedWithAnnotations}>
          Processed + annotations
        </Option>
        <Option value={PageImageMode.OriginalOnly} disabled={!hasOriginalImage}>
          Original only
        </Option>
        <Option
          value={PageImageMode.OriginalWithAnnotations}
          disabled={!hasOriginalImage}
        >
          Original + annotations
        </Option>
      </Select>
      <FormHelperText>
        Display only. Saved annotations are never changed.
      </FormHelperText>
    </FormControl>
  );
}
