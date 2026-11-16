import assert from "node:assert/strict";
import test from "node:test";
import { atom, createStore } from "jotai";
import { RecognitionRegionController } from "./RecognitionRegionController";
import { EditorTool } from "../model/EditorTool";
import {
  RELATION_INFERENCE_ENABLED,
  SYMBOL_INFERENCE_ENABLED,
} from "../../utils/featureFlags";

function fixture(ready = true) {
  const store = createStore();
  const currentToolAtom = atom(EditorTool.Pointer);
  const statuses: (string | null)[] = [];
  const alerts: string[] = [];
  const runs: unknown[][] = [];
  const toolbelt = {
    currentToolAtom,
    get currentTool() {
      return store.get(currentToolAtom);
    },
    setCurrentTool(tool: EditorTool) {
      store.set(currentToolAtom, tool);
    },
  };
  const main = {
    canRunModelsAtom: atom(ready),
    setModelStatus(message: string | null) {
      statuses.push(message);
    },
    async runModel(...args: unknown[]) {
      runs.push(args);
    },
  };
  const zoom = {
    currentTransform: {
      invertX: (x: number) => x,
      invertY: (y: number) => y,
    },
  };
  const controller = new RecognitionRegionController(
    store,
    zoom as any,
    toolbelt as any,
    main as any,
  );
  const previousWindow = globalThis.window;
  const previousRect = globalThis.DOMRect;
  globalThis.window = {
    alert(message: string) {
      alerts.push(message);
    },
  } as any;
  globalThis.DOMRect = class {
    constructor(
      public x: number,
      public y: number,
      public width: number,
      public height: number,
    ) {}
  } as any;
  return {
    store,
    controller,
    statuses,
    alerts,
    runs,
    toolbelt,
    restore() {
      globalThis.window = previousWindow;
      globalThis.DOMRect = previousRect;
    },
  };
}

test("area selection respects the symbol flag", () => {
  const f = fixture();
  try {
    f.controller.startRegionSelection("symbols", "Synthetic page");
    assert.equal(f.controller.isEnabled, SYMBOL_INFERENCE_ENABLED);
    assert.equal(f.alerts.length, SYMBOL_INFERENCE_ENABLED ? 0 : 1);
    if (SYMBOL_INFERENCE_ENABLED) {
      assert.equal(f.toolbelt.currentTool, EditorTool.RecognitionRegion);
      f.controller.cancelRegionSelection();
      assert.equal(f.controller.isEnabled, false);
      assert.equal(f.toolbelt.currentTool, EditorTool.Pointer);
    } else {
      assert.match(f.alerts[0], /Symbol detection is not enabled/);
      assert.equal(f.toolbelt.currentTool, EditorTool.Pointer);
    }
  } finally {
    f.restore();
  }
});

test("unready page never enters area selection", () => {
  const f = fixture(false);
  try {
    f.controller.startRegionSelection("syntaxLinks", "Synthetic page");
    assert.equal(f.controller.isEnabled, false);
    assert.equal(f.toolbelt.currentTool, EditorTool.Pointer);
    assert.match(
      f.statuses.at(-1) ?? "",
      RELATION_INFERENCE_ENABLED ? /cannot run/ : /not enabled/,
    );
  } finally {
    f.restore();
  }
});

test("a dragged area runs the chosen model action on that region", () => {
  const f = fixture();
  try {
    f.controller.startRegionSelection("timeGroups", "Synthetic page");
    if (!RELATION_INFERENCE_ENABLED) return;
    f.controller.onMouseDown({ button: 0, offsetX: 40, offsetY: 10 } as any);
    f.controller.onMouseMove({ button: 0, offsetX: 10, offsetY: 60 } as any);
    f.controller.onMouseUp({ button: 0, offsetX: 10, offsetY: 60 } as any);
    assert.equal(f.runs.length, 1);
    const [action, documentName, region] = f.runs[0] as [
      string,
      string,
      { x: number; y: number; width: number; height: number },
    ];
    assert.equal(action, "timeGroups");
    assert.equal(documentName, "Synthetic page");
    assert.deepEqual(
      [region.x, region.y, region.width, region.height],
      [10, 10, 30, 50],
    );
    assert.equal(f.toolbelt.currentTool, EditorTool.Pointer);
  } finally {
    f.restore();
  }
});
