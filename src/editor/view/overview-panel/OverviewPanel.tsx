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
import { ModelActionsPanel } from "./ModelActionsPanel";
import { TimeGroupsPanel } from "./TimeGroupsPanel";
import { PageImagePanel } from "./PageImagePanel";
import { useState } from "react";

export interface OverviewPanelProps {
  readonly onClose: () => void;
  readonly fileName: string;
}

/**
 * The left panel which contains an overview of all nodes in the scene
 * in a list-like view. This panel provides non-visual navigation
 * and orientation in the scene to the user. The panel can be collapsed.
 */
export function OverviewPanel(props: OverviewPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  // collapsed: a thin bar with an expand button
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
        minHeight: 0,
        flexShrink: 0,
        overflowX: "hidden",
        overflowY: "auto",
        overscrollBehavior: "contain",
        scrollbarGutter: "stable",
        scrollbarWidth: "thin",
        scrollbarColor: "var(--joy-palette-neutral-500) transparent",
        "&::-webkit-scrollbar": { width: "10px" },
        "&::-webkit-scrollbar-thumb": {
          backgroundColor: "var(--joy-palette-neutral-500)",
          borderRadius: "8px",
          border: "2px solid transparent",
          backgroundClip: "padding-box",
        },
        touchAction: "pan-y",
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

      <Sheet
        color="primary"
        variant="soft"
        sx={{ mx: 1, my: 1, p: 1.25, borderRadius: "sm" }}
      >
        <PageImagePanel />
      </Sheet>

      {/* Model actions */}
      <AccordionGroup>
        <Accordion defaultExpanded={true}>
          <AccordionSummary>
            <Typography level="title-sm">Model predictions</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <ModelActionsPanel />
          </AccordionDetails>
        </Accordion>
        <Accordion defaultExpanded={true}>
          <AccordionSummary>
            <Typography level="title-sm">Time groups</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <TimeGroupsPanel />
          </AccordionDetails>
        </Accordion>
      </AccordionGroup>

      <Divider />

      <Box
        sx={{
          flexShrink: 0,
          overflow: "visible",
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
