import { Stack, Switch, Typography } from "@mui/joy";
import { useAtom } from "jotai";
import { useContext } from "react";
import { EditorContext } from "../../EditorContext";
import { DisplayModeButtons } from "./DisplayModeButtons";

export function ViewAccordionPanel() {
  const { editorStateStore } = useContext(EditorContext);
  const [hideAllEdges, setHideAllEdges] = useAtom(
    editorStateStore.hideAllEdgesAtom,
  );

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={2} alignItems="center">
        <DisplayModeButtons />
      </Stack>
      <Switch
        size="sm"
        endDecorator="Hide all edges"
        checked={hideAllEdges}
        onChange={(event) => setHideAllEdges(event.target.checked)}
        sx={{ alignSelf: "start" }}
      />
      <Typography level="body-xs" sx={{ color: "text.tertiary" }}>
        Temporarily hides edges so bounding boxes are easier to inspect. No
        annotations are deleted.
      </Typography>
    </Stack>
  );
}
