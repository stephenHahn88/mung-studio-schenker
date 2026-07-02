import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Typography,
} from "@mui/joy";
import { useAtom, useAtomValue } from "jotai";
import { EditorTool } from "../../model/EditorTool";
import { useContext, useEffect, useRef } from "react";
import { EditorContext } from "../../EditorContext";
import { NodeTool } from "../../model/NodeTool";
import { ClassNameInput } from "./ClassNameInput";
import { NodeEditingController } from "../../controller/tools/NodeEditingController";

export function NodeEditingToolPanel() {
  const { toolbeltController, nodeEditingController } =
    useContext(EditorContext);

  const editorTool = useAtomValue(toolbeltController.currentToolAtom);
  const nodeTool = useAtomValue(nodeEditingController.currentNodeToolAtom);

  if (editorTool !== EditorTool.NodeEditing) {
    return null;
  }

  return (
    <Accordion defaultExpanded={true}>
      <AccordionSummary>
        <Typography level="title-sm">Node Editing Tool</Typography>
      </AccordionSummary>
      <AccordionDetails>
        {(nodeTool === NodeTool.PolygonFill ||
          nodeTool === NodeTool.PolygonErase ||
          nodeTool === NodeTool.PolygonBinarize ||
          nodeTool === NodeTool.StafflinesTool) && (
          <Alert color="primary">
            Start by clicking into the scene which starts drawing the polygon.
            Once done, press Enter/Return or N to commit the polygon. Or hold
            Ctrl and drag a box to quickly create a rectangular node.
          </Alert>
        )}
        <FocusableClassNameInput
          nodeEditingController={nodeEditingController}
        />
      </AccordionDetails>
    </Accordion>
  );
}

/**
 * The class-name input wired to the edited node's class. It also registers a
 * focuser with the controller so the quick-rectangle gesture can jump focus
 * straight into it. It is a separate component so the focuser is registered
 * exactly while the input is actually mounted (i.e. the node editing tool is
 * active).
 */
function FocusableClassNameInput(props: {
  readonly nodeEditingController: NodeEditingController;
}) {
  const { nodeEditingController } = props;
  const [className, setClassName] = useAtom(
    nodeEditingController.classNameAtom,
  );
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const focuser = () => {
      const input = wrapperRef.current?.querySelector("input");
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
    };
    nodeEditingController.registerClassInputFocuser(focuser);
    return () => {
      nodeEditingController.registerClassInputFocuser(null);
    };
  }, [nodeEditingController]);

  return (
    <div ref={wrapperRef}>
      <ClassNameInput
        value={className}
        onChange={(newValue: string) => setClassName(newValue)}
        sx={{ mt: 1 }}
      />
    </div>
  );
}
