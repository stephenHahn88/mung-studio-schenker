import { Document, DocStatus } from "./SimpleBackendApi";
import { Link as RouterLink } from "react-router-dom";
import Link from "@mui/joy/Link";
import {
  Box,
  Card,
  CardOverflow,
  Chip,
  Input,
  Option,
  Select,
  Sheet,
  Stack,
  Typography,
} from "@mui/joy";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import PersonIcon from "@mui/icons-material/Person";
import { classNameToHue } from "../../mung/classNameToHue";

const STATUS_META: Record<
  DocStatus,
  { label: string; color: "neutral" | "warning" | "success" }
> = {
  "not-started": { label: "Not started", color: "neutral" },
  "in-progress": { label: "In progress", color: "warning" },
  done: { label: "Done", color: "success" },
};

export interface DocumentsListProps {
  readonly documents: Document[];
  readonly userName?: string | null;
  readonly onStatusChange: (
    name: string,
    status: DocStatus,
    annotator: string,
  ) => void;
}

export function DocumentsList(props: DocumentsListProps) {
  const { documents, onStatusChange } = props;

  return (
    <>
      <Typography level="body-md" sx={{ mt: 2, mb: 2 }}>
        You can use <code>Ctrl + F</code> to find the document you're looking
        for. Set a status and type your name so others know who is annotating a
        page.
      </Typography>

      {documents.map((document) => {
        const status: DocStatus = document.status ?? "not-started";
        const annotator = document.annotator ?? "";
        const meta = STATUS_META[status];
        const claimed = status === "in-progress" && annotator !== "";

        return (
          <Card
            orientation="horizontal"
            key={document.name}
            variant={claimed ? "soft" : "outlined"}
            color={claimed ? "warning" : "neutral"}
            sx={{ mb: 1, alignItems: "center" }}
          >
            <CardOverflow>
              <Sheet
                sx={{
                  fontSize: 30,
                  display: "flex",
                  alignContent: "center",
                  alignItems: "center",
                  ml: 2,
                  px: 1,
                  background: `hsl(${classNameToHue(document.name)}, 100%, 80%)`,
                  borderRadius: 5,
                }}
              >
                <MusicNoteIcon
                  sx={{
                    color: `hsl(${classNameToHue(document.name)}, 100%, 50%)`,
                  }}
                />
              </Sheet>
            </CardOverflow>

            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Link
                component={RouterLink}
                to={`/simple-backend/${document.name}`}
                target="_blank"
              >
                {document.name}
              </Link>
              <Typography level="body-sm">
                Last modified: {new Date(document.modifiedAt).toString()}
              </Typography>
              <Stack
                direction="row"
                spacing={1}
                sx={{ mt: 0.5, alignItems: "center", flexWrap: "wrap" }}
              >
                <Chip size="sm" color={meta.color} variant="solid">
                  {meta.label}
                </Chip>
                {claimed && (
                  <Chip
                    size="sm"
                    variant="soft"
                    color="warning"
                    startDecorator={<PersonIcon />}
                  >
                    being annotated by {annotator}
                  </Chip>
                )}
              </Stack>
            </Box>

            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Select
                size="sm"
                value={status}
                onChange={(_e, value) => {
                  if (value) onStatusChange(document.name, value, annotator);
                }}
                sx={{ minWidth: 130 }}
              >
                <Option value="not-started">Not started</Option>
                <Option value="in-progress">In progress</Option>
                <Option value="done">Done</Option>
              </Select>
              <Input
                size="sm"
                placeholder="who's annotating?"
                defaultValue={annotator}
                startDecorator={<PersonIcon />}
                sx={{ width: 190 }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
                onBlur={(e) => {
                  const v = e.currentTarget.value.trim();
                  if (v !== annotator) {
                    // typing a name while "not-started" auto-flips to "in-progress"
                    const next: DocStatus =
                      v !== "" && status === "not-started"
                        ? "in-progress"
                        : status;
                    onStatusChange(document.name, next, v);
                  }
                }}
              />
            </Stack>
          </Card>
        );
      })}
    </>
  );
}
