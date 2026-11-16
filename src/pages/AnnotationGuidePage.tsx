import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import {
  Alert,
  Box,
  Card,
  Chip,
  Divider,
  Link,
  Sheet,
  Stack,
  Table,
  Typography,
} from "@mui/joy";
import { PropsWithChildren, ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  RELATION_INFERENCE_ENABLED,
  SYMBOL_INFERENCE_ENABLED,
} from "../utils/featureFlags";

const ANNOTATION_SCHEME_URL =
  "https://github.com/stephenHahn88/mung-studio-schenker/blob/main/dataset/ANNOTATION_SCHEME.md";

/** Default model files of the backend (simple-php-backend/model_actions.py). */
const modelFiles: readonly (readonly [string, string])[] = [
  [
    "Symbol detector (score threshold 0.6)",
    "symbol_recognition/yolov8l/HandSchA_seed20261021.pt + symbol_recognition/rfdetr_branch/HandSchA_seed43.pth",
  ],
  ["Syntax-link model", "syntax_links/incidence/handscha/heldout/seed_42/"],
  [
    "Time-group model",
    "temporal_relations/hgb/time_groups_heldout_rachmaninov_seed42.joblib",
  ],
  [
    "Precedence-link model",
    "temporal_relations/hgb/precedence_heldout_rachmaninov_seed43.joblib",
  ],
];

const MOD_KEY = /Mac|iPhone|iPad|iPod/.test(navigator.platform)
  ? "Command (⌘)"
  : "Ctrl";

interface GuideSectionProps extends PropsWithChildren {
  readonly id: string;
  readonly title: string;
  readonly eyebrow?: string;
}

function GuideSection(props: GuideSectionProps) {
  return (
    <Box component="section" id={props.id} sx={{ scrollMarginTop: 24, my: 5 }}>
      {props.eyebrow && (
        <Typography level="body-xs" color="primary" sx={{ fontWeight: 700 }}>
          {props.eyebrow}
        </Typography>
      )}
      <Typography level="h2" sx={{ mb: 1.5 }}>
        {props.title}
      </Typography>
      {props.children}
    </Box>
  );
}

function Kbd(props: PropsWithChildren) {
  return (
    <Box
      component="kbd"
      sx={{
        display: "inline-block",
        px: 0.65,
        py: 0.15,
        mx: 0.15,
        border: "1px solid",
        borderColor: "neutral.outlinedBorder",
        borderBottomWidth: 2,
        borderRadius: "sm",
        bgcolor: "background.surface",
        color: "text.primary",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "0.82em",
        lineHeight: 1.35,
        whiteSpace: "nowrap",
      }}
    >
      {props.children}
    </Box>
  );
}

function NumberedSteps(props: { readonly children: ReactNode }) {
  return (
    <Box
      component="ol"
      sx={{
        mt: 1,
        mb: 2,
        pl: 3,
        "& li": { mb: 0.9, pl: 0.5 },
      }}
    >
      {props.children}
    </Box>
  );
}

const shortcutGroups: readonly {
  readonly title: string;
  readonly rows: readonly (readonly [string, string])[];
}[] = [
  {
    title: "Tools",
    rows: [
      ["V", "Pointer tool"],
      ["H", "Hand tool"],
      ["N", "Enter node editing; while drawing, commit the polygon"],
      ["L", "Syntax-link tool"],
      ["P", "Precedence-link tool"],
    ],
  },
  {
    title: "Nodes and masks",
    rows: [
      [`${MOD_KEY} + drag`, "Create a quick rectangular node"],
      ["Delete", "Delete selected nodes and their incident links"],
      [
        `${MOD_KEY} + C / V`,
        "Copy / paste selected nodes (links are not copied)",
      ],
      [
        `${MOD_KEY} + U / D`,
        "Switch selected classes to an existing Up / Down counterpart",
      ],
      ["F", "Zoom to one selected node; in node editing, choose polygon fill"],
      ["T", "Toggle polygon erase / fill"],
      ["B", "Toggle polygon binarize / fill"],
      ["S", "Toggle staff-line extraction / fill"],
      ["Backspace or right-click", "Remove the last polygon point"],
      ["Enter", "Commit a polygon"],
      ["Escape", "Cancel a polygon; press again to leave node editing"],
    ],
  },
  {
    title: "Edges",
    rows: [
      ["E", "Toggle a syntax edge between exactly two selected nodes"],
      ["Q", "Toggle a precedence edge between exactly two selected nodes"],
      [
        `${MOD_KEY} + Shift + click`,
        "Toggle syntax edges from all selected sources to the clicked target",
      ],
      [
        "Shift + Delete",
        "Bulk-delete visible edges touching any selected node (use carefully)",
      ],
    ],
  },
  {
    title: "History and navigation",
    rows: [
      [`${MOD_KEY} + Z`, "Undo"],
      [`${MOD_KEY} + Shift + Z or ${MOD_KEY} + Y`, "Redo"],
      ["Escape", "Clear the current selection"],
      ["← / →", "Previous / next node of the selected node's class"],
      [`${MOD_KEY} + ← / →`, "First / last node of that class"],
      [
        "Shift + S",
        "Build a staff graph from exactly five selected staffLine nodes",
      ],
      ["Shift + N", "Snap nodes to detected staves"],
    ],
  },
];

export function AnnotationGuidePage() {
  return (
    <Box sx={{ maxWidth: 1040, mx: "auto", px: { xs: 2, md: 4 }, py: 6 }}>
      <Link
        component={RouterLink}
        to="/simple-backend"
        startDecorator={<ArrowBackIcon />}
      >
        Back to documents
      </Link>

      <Typography level="h1" sx={{ mt: 2 }}>
        Schenkerian Annotation Guide
      </Typography>
      <Typography level="body-lg" sx={{ mt: 1, maxWidth: 820 }}>
        A practical guide to annotating symbols, correcting bounding boxes,
        creating directed graph edges, and grouping simultaneous notes in MuNG
        Studio. The class list and the linking conventions of the Schenkerian
        annotation scheme are documented in{" "}
        <Link href={ANNOTATION_SCHEME_URL} target="_blank" rel="noopener">
          dataset/ANNOTATION_SCHEME.md
        </Link>
        .
      </Typography>

      <Alert
        color="warning"
        variant="soft"
        startDecorator={<WarningAmberIcon />}
        sx={{ mt: 3 }}
      >
        Work only on your assigned page. MuNG Studio saves real edits
        automatically, so practice on a designated test copy rather than on an
        active annotation.
      </Alert>

      <Card variant="soft" sx={{ mt: 3 }}>
        <Typography level="title-lg">Quick start</Typography>
        <NumberedSteps>
          <li>
            On the document list, enter your name under the stage you are
            working on and set it to <strong>In progress</strong>.
          </li>
          <li>Check symbol coverage, then correct boxes and classes.</li>
          <li>Annotate directed edges only after the nodes are stable.</li>
          <li>
            Wait until the top-left status reads <strong>Saved.</strong>
          </li>
          <li>
            Set that stage to <strong>Pending review</strong>. After an
            independent check, a reviewer changes it to <strong>Done</strong>
            or <strong>Changes requested</strong>.
          </li>
        </NumberedSteps>
      </Card>

      <Sheet variant="outlined" sx={{ mt: 3, p: 2, borderRadius: "md" }}>
        <Typography level="title-md" sx={{ mb: 1 }}>
          On this page
        </Typography>
        <Stack direction="row" flexWrap="wrap" gap={1.5}>
          {[
            ["workflow", "Safe workflow"],
            ["workspace", "Workspace"],
            ["select", "Move and select"],
            ["nodes", "Annotate symbols"],
            ["edges", "Annotate edges"],
            ["time-groups", "Annotate time groups"],
            ["save", "Save and review"],
            ["recognition", "Model predictions"],
            ["shortcuts", "Shortcut reference"],
            ["troubleshooting", "Troubleshooting"],
          ].map(([id, label]) => (
            <Link key={id} href={`#${id}`}>
              {label}
            </Link>
          ))}
        </Stack>
      </Sheet>

      <GuideSection
        id="workflow"
        title="Use the document workflow safely"
        eyebrow="1 · START HERE"
      >
        <Typography>
          Each page tracks four stages independently:{" "}
          <strong>Symbol Recognition</strong>, <strong>Precedence Links</strong>
          , <strong>Syntax Links</strong>, and{" "}
          <strong>Temporal Structure</strong> (Time Groups). Each has its own
          annotator and the five states below. Running recognition does not mark
          a stage as done. Status changes do not change the page's MuNG
          annotation.
        </Typography>
        <Table variant="outlined" size="sm" sx={{ mt: 2 }}>
          <thead>
            <tr>
              <th style={{ width: "22%" }}>Status</th>
              <th>When to use it</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Not started</td>
              <td>No annotator has claimed this stage.</td>
            </tr>
            <tr>
              <td>In progress</td>
              <td>An annotator is actively working on this stage.</td>
            </tr>
            <tr>
              <td>Pending review</td>
              <td>
                The first pass is complete and ready for another person to
                check.
              </td>
            </tr>
            <tr>
              <td>Changes requested</td>
              <td>
                A reviewer has checked the page and asked the annotator to make
                corrections, usually described in the page comments.
              </td>
            </tr>
            <tr>
              <td>Done</td>
              <td>This stage has passed review.</td>
            </tr>
          </tbody>
        </Table>
        <Alert sx={{ mt: 2 }}>
          Live presence and cursors help coordination, but two people should
          still avoid editing the same object at the same time.
        </Alert>
      </GuideSection>

      <Divider />

      <GuideSection
        id="workspace"
        title="Know the workspace"
        eyebrow="2 · ORIENTATION"
      >
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" },
            gap: 2,
          }}
        >
          <Card variant="outlined">
            <Typography level="title-md">Left: Overview</Typography>
            <Typography level="body-sm">
              Save status, model predictions, time groups, display controls,
              class visibility, and the node list.
            </Typography>
          </Card>
          <Card variant="outlined">
            <Typography level="title-md">Center: Scene</Typography>
            <Typography level="body-sm">
              The scanned page, annotations, edges, selection, and the toolbelt
              along the bottom.
            </Typography>
          </Card>
          <Card variant="outlined">
            <Typography level="title-md">Right: Inspector</Typography>
            <Typography level="body-sm">
              Class, text, selected-node details, and instructions for the
              active editing or link tool.
            </Typography>
          </Card>
        </Box>
        <Typography sx={{ mt: 2 }}>
          In <strong>View</strong>, use boxes for speed, masks for detailed
          checking, and the red/green link controls to show or hide syntax and
          precedence edges. Turn on <strong>Hide all edges</strong> to inspect
          bounding boxes without edge lines; this changes only the view and
          never deletes annotations. The <strong>Nodes</strong> section can
          show, hide, or isolate a class. Reviewers can use the orange
          <strong> Uncertain only</strong> button there to temporarily hide
          every other symbol class; pressing it again restores the previous
          class visibility exactly.
        </Typography>
      </GuideSection>

      <Divider />

      <GuideSection
        id="select"
        title="Move around and select objects"
        eyebrow="3 · NAVIGATION"
      >
        <Table variant="outlined" size="sm">
          <tbody>
            <tr>
              <td style={{ width: "34%" }}>Pan</td>
              <td>
                Scroll/two-finger gesture, middle-button drag, or press{" "}
                <Kbd>H</Kbd> and left-drag.
              </td>
            </tr>
            <tr>
              <td>Horizontal pan</td>
              <td>
                <Kbd>Shift</Kbd> + scroll.
              </td>
            </tr>
            <tr>
              <td>Zoom</td>
              <td>
                <Kbd>{MOD_KEY}</Kbd> + scroll.
              </td>
            </tr>
            <tr>
              <td>Return to pointer</td>
              <td>
                Press <Kbd>V</Kbd>.
              </td>
            </tr>
          </tbody>
        </Table>

        <Typography level="title-md" sx={{ mt: 3 }}>
          Selection
        </Typography>
        <Box component="ul" sx={{ pl: 3, "& li": { mb: 0.8 } }}>
          <li>Click a node to select it; click it again to deselect it.</li>
          <li>
            <Kbd>Shift</Kbd> + click adds another node to the selection.
          </li>
          <li>
            Drag on empty background to box-select; hold <Kbd>Shift</Kbd> to add
            the result.
          </li>
          <li>
            <Kbd>Escape</Kbd> clears the selection.
          </li>
          <li>
            In the left <strong>Selection</strong> section, Lazy selection
            requires full containment; Eager selection accepts any overlap.
          </li>
        </Box>

        <Typography level="title-md" sx={{ mt: 3 }}>
          Move or resize an existing box
        </Typography>
        <NumberedSteps>
          <li>
            Press <Kbd>V</Kbd> and select exactly one node.
          </li>
          <li>Drag inside the box to move it.</li>
          <li>Drag an edge or corner handle to resize it.</li>
        </NumberedSteps>
        <Alert color="warning" variant="soft">
          Resizing a pixel mask crops ink outside the new box; newly expanded
          areas are empty. If that was unintended, undo immediately.
        </Alert>
      </GuideSection>

      <Divider />

      <GuideSection
        id="nodes"
        title="Annotate and correct symbols"
        eyebrow="4 · NODES"
      >
        <Typography level="h3">
          Method A: quick rectangle (recommended for most boxes)
        </Typography>
        <NumberedSteps>
          <li>Use the Pointer or Node Editing tool.</li>
          <li>
            Hold <Kbd>{MOD_KEY}</Kbd> and drag tightly around the symbol.
          </li>
          <li>
            Release the mouse. MuNG Studio creates the node and focuses the
            class field.
          </li>
          <li>Select a valid class from the autocomplete list.</li>
        </NumberedSteps>
        <Typography>
          Cover the complete target symbol while excluding neighboring ink as
          much as possible. Real overlapping symbols should remain separate
          nodes. If you can locate a symbol but cannot decide its final class,
          choose <strong>Uncertain</strong> instead of guessing. This is the
          standard MuNG <code>unclassified</code> value presented with a clearer
          workflow label. If you are certain that the symbol type is genuinely
          missing from the vocabulary, open <strong>Manage Classes</strong> in
          the right Inspector Panel, click <strong>Add class</strong>, and give
          it a stable camelCase name. This panel also lists every available
          class: use its color control when two classes are difficult to
          distinguish, or the reset button to restore the default color. Class
          names and color settings are shared with other annotators, but colors
          affect display only. Do not create alternate spellings for an existing
          class.
        </Typography>
        <Alert color="warning" variant="soft" sx={{ mt: 2 }}>
          Uncertain is a temporary review label, not a training class. A
          reviewer should turn on <strong>Uncertain only</strong>, inspect each
          highlighted symbol, and replace it with the final class before the
          page is marked Done.
        </Alert>

        <Typography level="h3" sx={{ mt: 4 }}>
          Method B: edit a pixel mask with a temporary polygon
        </Typography>
        <NumberedSteps>
          <li>
            Press <Kbd>N</Kbd>.
          </li>
          <li>Left-click around the region to add polygon vertices.</li>
          <li>
            Right-click or press <Kbd>Backspace</Kbd> to remove the last vertex.
          </li>
          <li>
            Press <Kbd>Enter</Kbd> or <Kbd>N</Kbd> to apply the polygon.
          </li>
          <li>
            Press <Kbd>Escape</Kbd> to cancel an unfinished polygon; press it
            again to leave Node Editing.
          </li>
        </NumberedSteps>
        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
          <Chip>
            <Kbd>F</Kbd> Fill
          </Chip>
          <Chip>
            <Kbd>T</Kbd> Erase
          </Chip>
          <Chip>
            <Kbd>B</Kbd> Binarize image region
          </Chip>
          <Chip>
            <Kbd>S</Kbd> Extract staff lines
          </Chip>
        </Stack>
        <Alert variant="soft">
          The polygon is only a temporary editing gesture. MuNG Studio stores
          the resulting raster mask and bounding box, not the polygon vertices.
          For this Schenkerian project, use a rectangle unless a detailed mask
          is specifically required.
        </Alert>

        <Typography level="h3" sx={{ mt: 4 }}>
          Common node corrections
        </Typography>
        <Table variant="outlined" size="sm">
          <thead>
            <tr>
              <th>Task</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Change class or text</td>
              <td>
                Select the node, press <Kbd>N</Kbd>, then edit the right
                Inspector.
              </td>
            </tr>
            <tr>
              <td>Delete</td>
              <td>
                Select nodes and press <Kbd>Delete</Kbd>. Their incident edges
                are also deleted.
              </td>
            </tr>
            <tr>
              <td>Duplicate</td>
              <td>
                <Kbd>{MOD_KEY} + C</Kbd>, then <Kbd>{MOD_KEY} + V</Kbd>; drag
                the offset copy into place. Edges are not copied.
              </td>
            </tr>
            <tr>
              <td>Flip Up/Down class</td>
              <td>
                <Kbd>{MOD_KEY} + U</Kbd> or <Kbd>{MOD_KEY} + D</Kbd>, when that
                counterpart exists.
              </td>
            </tr>
          </tbody>
        </Table>
      </GuideSection>

      <Divider />

      <GuideSection
        id="edges"
        title="Annotate directed edges"
        eyebrow="5 · GRAPH RELATIONS"
      >
        <Typography>
          Edge direction matters: select the source first and the target second.
          Use the project's annotation rules to decide whether a syntax or
          precedence relation belongs between the symbols.
        </Typography>

        <Typography level="h3" sx={{ mt: 3 }}>
          Method A: precise single-edge toggle
        </Typography>
        <NumberedSteps>
          <li>Click the source node.</li>
          <li>
            Hold <Kbd>Shift</Kbd> and click the target node.
          </li>
          <li>
            Press <Kbd>E</Kbd> for syntax or <Kbd>Q</Kbd> for precedence.
          </li>
          <li>
            Repeat the same source/target order and key to remove that edge.
          </li>
        </NumberedSteps>

        <Typography level="h3" sx={{ mt: 3 }}>
          Method B: continuous link tools
        </Typography>
        <Table variant="outlined" size="sm">
          <thead>
            <tr>
              <th style={{ width: "20%" }}>Tool</th>
              <th>Workflow</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <Kbd>L</Kbd> Syntax
              </td>
              <td>
                Select source node(s), then hold <Kbd>{MOD_KEY}</Kbd> and click
                target nodes. Sources remain selected for one-to-many links.
              </td>
            </tr>
            <tr>
              <td>
                <Kbd>P</Kbd> Precedence
              </td>
              <td>
                Select the source, then hold <Kbd>{MOD_KEY}</Kbd> and click the
                next target. The target becomes the next source, making a chain.
              </td>
            </tr>
          </tbody>
        </Table>
        <Typography sx={{ mt: 2 }}>
          A fast syntax-only alternative is to select source node(s), then use
          <Kbd>{MOD_KEY} + Shift + click</Kbd> on each target. This always
          toggles <strong>syntax</strong>, even if the Precedence tool is
          active.
        </Typography>

        <Alert
          color="danger"
          variant="soft"
          startDecorator={<WarningAmberIcon />}
          sx={{ mt: 3 }}
        >
          <strong>Do not use Shift + Delete to remove one edge.</strong> It
          bulk-deletes every currently eligible visible edge touching any
          selected node. For one edge, toggle the exact source-target pair with
          <Kbd>E</Kbd> or <Kbd>Q</Kbd>.
        </Alert>
      </GuideSection>

      <Divider />

      <GuideSection
        id="time-groups"
        title="Annotate time groups"
        eyebrow="6 · TEMPORAL STRUCTURE"
      >
        <Typography>
          A time group collects the noteheads that sound at the same musical
          moment, including noteheads in different staves. Groups are stored on
          their member noteheads as MuNG DataItems, so they are saved with the
          page like any other annotation. Precedence links then order the groups
          from left to right.
        </Typography>
        <NumberedSteps>
          <li>
            Open the <strong>Time groups</strong> section in the left panel and
            turn on <strong>Noteheads only</strong> to make selection easier.
          </li>
          <li>
            Select the noteheads of one time position (drag a box or{" "}
            <Kbd>Shift</Kbd> + click) and create a group. Selecting noteheads
            that already form a group opens that group instead of creating a
            duplicate.
          </li>
          <li>
            To edit a group, select it in the list, then add or remove selected
            members, split selected members into a new group, or merge checked
            groups. Deleting a group keeps its notes.
          </li>
          <li>
            Use the coverage check to find noteheads that are not in any group
            yet and step through them one by one.
          </li>
        </NumberedSteps>
        <Alert variant="soft">
          Groups created by the time-group model are marked{" "}
          <strong>predicted</strong> in the list. Review them like any other
          prediction; the model never changes groups that already exist.
        </Alert>
      </GuideSection>

      <Divider />

      <GuideSection
        id="save"
        title="Save, review, and recover"
        eyebrow="7 · FINISHING A PAGE"
      >
        <Box component="ul" sx={{ pl: 3, "& li": { mb: 0.8 } }}>
          <li>
            After a graph change, autosave runs after about five seconds without
            another edit.
          </li>
          <li>
            Wait for <strong>Saved.</strong> before closing the tab or
            converting the page to JSON.
          </li>
          <li>
            <strong>Retrying...</strong> means the latest save failed and is
            being retried.
          </li>
          <li>
            Undo/redo stores up to 100 in-memory graph states and resets when
            the page reloads.
          </li>
          <li>
            Each save also keeps a dated copy of the page in the document's
            <code> backups/</code> folder on the server.
          </li>
          <li>
            Before marking a page Done, use <strong>Uncertain only</strong> and
            resolve every remaining Uncertain symbol.
          </li>
        </Box>
        <Alert
          color="success"
          variant="soft"
          startDecorator={<CheckCircleOutlineIcon />}
        >
          Before Pending review: check missing/duplicate symbols, box geometry,
          fine-grained classes, local and long-range edges, direction, isolated
          nodes, unresolved questions, and the Saved status.
        </Alert>
      </GuideSection>

      <Divider />

      <GuideSection
        id="recognition"
        title="Use model predictions"
        eyebrow="8 · OPTIONAL"
      >
        <Typography>
          The <strong>Model predictions</strong> section runs the models of the
          paper on the open page: the symbol detector, the syntax-link model,
          the time-group model, and the precedence-link model. Each action runs
          either on the whole page or, with its <strong>Area</strong> button, on
          a rectangle that you drag on the page. Predictions are proposals:
          inspect every box, class, link, and group before marking a stage for
          review.
        </Typography>
        <Box component="ul" sx={{ pl: 3, "& li": { mb: 0.8 } }}>
          {SYMBOL_INFERENCE_ENABLED ? (
            <li>
              <strong>Detect symbols</strong> replaces earlier predicted symbols
              in the page or area and keeps every manual symbol. Predicted
              symbols carry the DataItem <code>symbol_detector_prediction</code>{" "}
              and the detector files in <code>symbol_detector_model_key</code>;
              edited predictions keep them, so a later{" "}
              <strong>Clear predicted symbols</strong> or rerun also removes
              them. Leave the score threshold empty to use the server default.
            </li>
          ) : (
            <li>Symbol detection is not enabled in this build.</li>
          )}
          {RELATION_INFERENCE_ENABLED ? (
            <li>
              <strong>Predict syntax links</strong>,{" "}
              <strong>Predict time groups</strong>, and{" "}
              <strong>Predict precedence links</strong> read the symbols that
              are currently on the page (or in the area). Correct the symbols
              first, then run the relation models. Existing links and groups are
              never removed or changed: a predicted link is added only between
              two symbols that are not linked yet, and predicted time groups
              (marked <strong>predicted</strong>) take only noteheads that are
              not in a group yet. Predicted links are ordinary MuNG links;
              review them right after the run, and use <strong>Undo</strong> to
              remove the whole run.
            </li>
          ) : (
            <li>
              Relation prediction is not enabled in this build; add links and
              time groups manually.
            </li>
          )}
          <li>
            <strong>Convert to JSON</strong> saves the page and opens the
            graph-to-JSON conversion of the saved annotations in a new tab.
          </li>
        </Box>
        <Typography level="body-sm" sx={{ mt: 1 }}>
          The symbol detector was trained on the split in
          experiments/symbol_recognition/data/split.json, the relation models on
          the held-out-work split (training pages without The Bells). Unless the
          server is configured otherwise, the actions use these files of the
          downloaded models folder:
        </Typography>
        <Table size="sm" variant="outlined" sx={{ mt: 1, mb: 1 }}>
          <tbody>
            {modelFiles.map(([model, files]) => (
              <tr key={model}>
                <td style={{ width: "30%" }}>{model}</td>
                <td>
                  <code>{files}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Alert color="danger" variant="soft" sx={{ mt: 1 }}>
          <strong>Clear all syntax links</strong> removes every syntax link,
          including manually annotated links. Use it only when you intend to
          reset all syntax-link work on that page.
        </Alert>
      </GuideSection>

      <Divider />

      <GuideSection
        id="shortcuts"
        title="Shortcut reference"
        eyebrow="9 · CHEAT SHEET"
      >
        <Alert sx={{ mb: 2 }}>
          Most shortcuts are disabled while an input field is focused. Click the
          canvas first if a shortcut does not respond.
        </Alert>
        {shortcutGroups.map((group) => (
          <Box key={group.title} sx={{ mb: 3 }}>
            <Typography level="title-lg" sx={{ mb: 1 }}>
              {group.title}
            </Typography>
            <Table variant="outlined" size="sm">
              <thead>
                <tr>
                  <th style={{ width: "38%" }}>Key or gesture</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map(([shortcut, action]) => (
                  <tr key={`${group.title}-${shortcut}`}>
                    <td>
                      <Kbd>{shortcut}</Kbd>
                    </td>
                    <td>{action}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Box>
        ))}
      </GuideSection>

      <Divider />

      <GuideSection
        id="troubleshooting"
        title="Troubleshooting"
        eyebrow="10 · WHEN SOMETHING LOOKS WRONG"
      >
        <Table variant="outlined" size="sm">
          <tbody>
            <tr>
              <td style={{ width: "34%" }}>Wrong class</td>
              <td>
                Select the node, press <Kbd>N</Kbd>, and choose the correct
                class.
              </td>
            </tr>
            <tr>
              <td>Wrong box</td>
              <td>
                Press <Kbd>V</Kbd>, select one node, then move or resize it.
              </td>
            </tr>
            <tr>
              <td>Wrong single edge</td>
              <td>
                Select source then target in the same direction and toggle it
                with <Kbd>E</Kbd> or <Kbd>Q</Kbd>.
              </td>
            </tr>
            <tr>
              <td>Accidental edit</td>
              <td>
                Immediately use <Kbd>{MOD_KEY} + Z</Kbd>.
              </td>
            </tr>
            <tr>
              <td>Cannot select a node</td>
              <td>
                Press <Kbd>V</Kbd>, show its class in Nodes, and make sure
                annotations are not hidden.
              </td>
            </tr>
            <tr>
              <td>Shortcut does nothing</td>
              <td>
                Click the canvas so no text field is focused, then try again.
              </td>
            </tr>
          </tbody>
        </Table>
        <Typography sx={{ mt: 2 }}>
          If you are unsure how to repair a page, stop editing and add a review
          comment with the approximate location from the document list. Do not
          experiment with bulk-delete controls on real data.
        </Typography>
      </GuideSection>
    </Box>
  );
}
