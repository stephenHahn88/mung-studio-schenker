import { useContext, useRef } from "react";
import { ForegroundLayer } from "./foreground-layer/ForegroundLayer";
import { SceneLayer_Canvas2D } from "./SceneLayer_Canvas2D";
import { SceneLayer_SVG } from "./scene-layer-svg/SceneLayer_SVG";
import { SceneLayer_WebGL } from "./scene-layer-webgl/SceneLayer_WebGL";
import { BackgroundLayer } from "./BackgroundLayer";
import { EditorContext } from "../../EditorContext";
import { useAtomValue } from "jotai";
import { SceneRenderingEngine } from "../../model/SettingsStore";
import { CollabOverlay } from "../collab/CollabOverlay";

/**
 * The central surface of the editor. Displays the scene and its
 * contents visually. It provides visual navigation and interaction
 * with the scene to the user.
 */
export function SceneView() {
  const { zoomController, settingsStore, collabController } =
    useContext(EditorContext);

  const sceneRenderingEngine = useAtomValue(
    settingsStore.sceneRenderingEngineAtom,
  );

  const containerRef = useRef<HTMLDivElement | null>(null);

  // update the CSS variable used to scale strokes to screen space
  zoomController.useOnTransformChange((transform: d3.ZoomTransform) => {
    if (containerRef.current === null) return;
    containerRef.current.style.setProperty(
      "--scene-screen-pixel",
      String(1.0 / transform.k),
    );
  }, []);

  // report the local cursor position (image-space) to collaborators
  function reportCursor(e: React.MouseEvent) {
    if (collabController === null || containerRef.current === null) return;
    const rect = containerRef.current.getBoundingClientRect();
    const [ix, iy] = zoomController.currentTransform.invert([
      e.clientX - rect.left,
      e.clientY - rect.top,
    ]);
    collabController.reportCursor(ix, iy);
  }

  return (
    <div
      ref={containerRef}
      onMouseMove={collabController !== null ? reportCursor : undefined}
      onMouseLeave={
        collabController !== null
          ? () => collabController.reportCursor(null, null)
          : undefined
      }
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
      }}
    >
      {/* The gray background and the scanned document image */}
      <BackgroundLayer />

      {/* Objects that are not being edited, but there is many of them,
      so tricks have to be made to render them fast */}
      {sceneRenderingEngine === SceneRenderingEngine.SVG && <SceneLayer_SVG />}
      {sceneRenderingEngine === SceneRenderingEngine.WebGL && (
        <SceneLayer_WebGL />
      )}
      {sceneRenderingEngine === SceneRenderingEngine.Canvas2D && (
        <SceneLayer_Canvas2D />
      )}

      {/* The editing overlay for the current object, consumes pointer events
      and contains the zoom controlling code */}
      <ForegroundLayer />

      {/* Live collaborator cursors + selection (click-through) */}
      {collabController !== null && <CollabOverlay />}
    </div>
  );
}
