import { useContext } from "react";
import { useAtomValue } from "jotai";
import Box from "@mui/joy/Box";
import Tooltip from "@mui/joy/Tooltip";
import { EditorContext } from "../../EditorContext";

/** Initials for the little avatar circle. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Live "who's on this page" bar (top-right of the scene). Shows the local user
 * plus every other collaborator currently viewing/editing the document, each in
 * their assigned color.
 */
export function PresenceBar() {
  const { collabController } = useContext(EditorContext);
  const peers = useAtomValue(collabController!.peersAtom);

  const people = [
    { clientId: "self", name: "You", color: collabController!.selfColor, self: true },
    ...peers.map((p) => ({ ...p, self: false })),
  ];

  return (
    <Box
      sx={{
        position: "absolute",
        top: 8,
        right: 8,
        zIndex: 30,
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        px: 0.75,
        py: 0.5,
        borderRadius: "999px",
        backgroundColor: "rgba(255,255,255,0.82)",
        backdropFilter: "blur(4px)",
        boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
      }}
    >
      {people.map((p) => (
        <Tooltip
          key={p.clientId}
          title={p.self ? "You" : p.name}
          size="sm"
          variant="soft"
        >
          <Box
            sx={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              backgroundColor: p.color,
              color: "#fff",
              fontSize: 11,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: p.self ? "2px solid #fff" : "1px solid rgba(0,0,0,0.15)",
              boxShadow: p.self ? "0 0 0 1px rgba(0,0,0,0.15)" : "none",
              userSelect: "none",
            }}
          >
            {initials(p.name)}
          </Box>
        </Tooltip>
      ))}
      {peers.length === 0 && (
        <Box sx={{ fontSize: 11, color: "#666", pr: 0.5, userSelect: "none" }}>
          only you
        </Box>
      )}
    </Box>
  );
}
