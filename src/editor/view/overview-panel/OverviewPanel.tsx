import Sheet from "@mui/joy/Sheet";
import { NodesAccordionPanel } from "./NodesAccordionPanel";
import {
  Accordion,
  AccordionDetails,
  AccordionGroup,
  AccordionSummary,
  Box,
  Divider,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/joy";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { MainMenu } from "./MainMenu";
import { AutosaveStatus } from "./AutosaveStatus";
import { DocumentAccordionPanel } from "./DocumentAccordionPanel";
import { ViewAccordionPanel } from "./ViewAccordionPanel";
import { SelectionAccordionPanel } from "./SelectionAccordionPanel";
import { RecognitionQuickAction } from "./RecognitionQuickAction";
import { BackupButton } from "./BackupButton";
import { useState } from "react";

export interface OverviewPanelProps {
  readonly onClose: () => void;
  readonly fileName: string;
}

/**
 * The left panel which contains an overview of all nodes in the scene
 * in a list-like view. This panel provides non-visual navigation
 * and orientation in the scene to the user. The whole panel can be
 * collapsed to a thin bar to give the canvas more room.
 */
export function OverviewPanel(props: OverviewPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Collapsed: a thin bar with only an "expand" button, so the canvas is wide.
  if (collapsed) {
    return (
      <Sheet
        variant="outlined"
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "44px",
          height: "100%",
          borderWidth: "0 1px 0 0",
          py: 1,
        }}
      >
        <Tooltip title="Expand panel" placement="right">
          <IconButton
            size="sm"
            variant="plain"
            onClick={() => setCollapsed(false)}
          >
            <ChevronRightIcon />
          </IconButton>
        </Tooltip>
      </Sheet>
    );
  }

  return (
    <Sheet
      variant="outlined"
      sx={{
        display: "flex",
        flexDirection: "column",
        width: "300px",
        height: "100%",
        borderWidth: "0 1px 0 0",
      }}
    >
      <Stack direction="row" sx={{ p: 1, pr: 1, alignItems: "center" }}>
        <MainMenu onClose={props.onClose} />
        <div style={{ flexGrow: 1 }}></div>
        <AutosaveStatus />
        <Tooltip title="Collapse panel" placement="bottom">
          <IconButton
            size="sm"
            variant="plain"
            onClick={() => setCollapsed(true)}
          >
            <ChevronLeftIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      <Typography level="title-md" sx={{ px: 1 }}>
        {props.fileName}
      </Typography>

      <Box sx={{ px: 1, py: 1 }}>
        <BackupButton />
      </Box>

      {/* Recognition (the symbol-detection model tools) — collapsible so it can
          be tucked away when the user is just annotating. */}
      <AccordionGroup>
        <Accordion defaultExpanded={true}>
          <AccordionSummary>
            <Typography level="title-sm">Recognition</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <RecognitionQuickAction />
          </AccordionDetails>
        </Accordion>
      </AccordionGroup>

      <Divider />

      <Box
        sx={{
          flexGrow: 1,
          overflowY: "scroll",
        }}
      >
        <AccordionGroup>
          <Accordion defaultExpanded={false}>
            <AccordionSummary>
              <Typography level="title-sm">Document</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <DocumentAccordionPanel />
            </AccordionDetails>
          </Accordion>

          <Accordion defaultExpanded={true}>
            <AccordionSummary>
              <Typography level="title-sm">View</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <ViewAccordionPanel />
            </AccordionDetails>
          </Accordion>

          <Accordion defaultExpanded={false}>
            <AccordionSummary>
              <Typography level="title-sm">Selection</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <SelectionAccordionPanel />
            </AccordionDetails>
          </Accordion>

          <Accordion defaultExpanded={true}>
            <AccordionSummary>
              <Typography level="title-sm">Nodes</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <NodesAccordionPanel />
            </AccordionDetails>
          </Accordion>
        </AccordionGroup>
      </Box>
    </Sheet>
  );
}
