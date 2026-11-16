import assert from "node:assert/strict";
import test from "node:test";
import {
  layoutTimeGroupMemberMarkers,
  timeGroupMemberBounds,
} from "./TimeGroupMemberMarkers";
import type { TimeGroup } from "../../../../mung/TimeGroups";
import {
  layoutTimeGroupOverlays,
  wrapTimeGroupLabel,
  type TimeGroupOverlayInput,
} from "./TimeGroupOverlayGeometry";

function input(
  id: string,
  positions: readonly (readonly [number, number, number])[],
  label = id,
): TimeGroupOverlayInput {
  const members = positions.map(([nodeId, left, top]) => ({
    id: nodeId,
    left,
    top,
    width: 22,
    height: 14,
  }));
  return {
    group: {
      id,
      label,
      memberIds: members.map((member) => member.id),
    } as TimeGroup,
    members,
  };
}

test("long labels retain every character, including spaces and unicode", () => {
  for (const label of ["W".repeat(80), "Gleichzeitig α & <label> ".repeat(4)]) {
    const lines = wrapTimeGroupLabel(label);
    assert.equal(lines.join(""), label);
    assert(lines.length > 1);
    assert(lines.every((line) => Array.from(line).length <= 26));
  }
});

test("singleton gets a nonzero rail; display geometry does not alter music coordinates", () => {
  const original = input("one", [[4, 230, 200]]);
  const before = structuredClone(original);
  const [layout] = layoutTimeGroupOverlays([original], 1);
  assert.equal(layout.railX, 212);
  assert.equal(layout.railBottom, 207);
  assert.equal(layout.markerY, 187);
  assert.deepEqual(original, before);
  assert.deepEqual(layout.members, original.members);
});

test("spatially offset members remain offset; no common note x is manufactured", () => {
  const original = input("offset", [
    [1, 350, 200],
    [2, 420, 270],
    [3, 360, 340],
  ]);
  const [layout] = layoutTimeGroupOverlays([original], 1);
  assert.deepEqual(
    layout.members.map((member) => member.left),
    [350, 420, 360],
  );
  assert.equal(layout.railX, 332);
  assert.equal(layout.railBottom, 347);
});

test("shared-member groups have separate rails and nonoverlapping complete labels", () => {
  const first = input(
    "A",
    [
      [1, 350, 350],
      [2, 370, 420],
    ],
    "W".repeat(80),
  );
  const second = input(
    "B",
    [
      [1, 350, 350],
      [2, 370, 420],
    ],
    "Second overlapping time group",
  );
  const [a, b] = layoutTimeGroupOverlays([first, second], 1);
  assert(Math.abs(a.railX - b.railX) >= 12);
  assert(b.labelTop + b.labelHeight + 3 <= a.labelTop - 3);
  assert.equal(a.labelLines.join(""), first.group.label);
  assert.equal(b.labelLines.join(""), second.group.label);
  assert.equal(a.members[0].id, b.members[0].id);
});

test("annotation spacing and multiline label sizes are stable at 0.5, 1, and 2 zoom", () => {
  const original = input("one", [[0, 300, 400]], "W".repeat(80));
  for (const scale of [0.5, 1, 2]) {
    const [layout] = layoutTimeGroupOverlays([original], scale);
    assert.equal((300 - layout.railX) * scale, 18);
    assert.equal((407 - layout.markerY) * scale, 20);
    assert.equal((layout.labelX - layout.railX) * scale, 13);
    assert.equal(layout.labelWidth * scale, 286);
    assert.equal(layout.labelLines.join(""), original.group.label);
  }
});

test("deleted memberships with no remaining nodes have no phantom visual marker", () => {
  assert.deepEqual(layoutTimeGroupOverlays([input("empty", [])], 1), []);
});

test("invalid and tiny zoom values do not create nonfinite annotation coordinates", () => {
  for (const scale of [0, -1, NaN, Infinity]) {
    const [layout] = layoutTimeGroupOverlays(
      [input("one", [[0, 10, 20]])],
      scale,
    );
    for (const value of [
      layout.railX,
      layout.markerY,
      layout.labelTop,
      layout.labelWidth,
    ]) {
      assert(Number.isFinite(value));
    }
  }
});

function intersects(
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number },
) {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );
}

test("dense labels stay clear of every full ring, badge, diamond and other label across zooms", () => {
  const dense = Array.from({ length: 12 }, (_, i) =>
    input(
      `group-${i}`,
      [
        [i * 4, 100 + i * 30, 100],
        [i * 4 + 1, 100 + i * 30, 125],
        [i * 4 + 2, 100 + i * 30, 150],
        [i * 4 + 3, 100 + i * 30, 240],
      ],
      `Group ${i + 1}`,
    ),
  );
  dense.push(
    input(
      "shared",
      [
        [0, 100, 100],
        [48, 95, 125],
      ],
      "Shared overlapping group",
    ),
  );
  const original = structuredClone(dense);
  for (const scale of [0.3, 1, 3, 6]) {
    const markers = layoutTimeGroupMemberMarkers(
      dense.map((item) => ({
        ...item,
        members: item.members.map((member) => ({
          ...member,
          className: "noteheadBlack",
        })),
      })),
      "shared",
      scale,
    );
    const layouts = layoutTimeGroupOverlays(dense, scale, {
      memberMarkers: markers,
    });
    const rectangles = layouts.map((item) => ({
      left: item.labelX - 4 / scale,
      right: item.labelX + item.labelWidth + 4 / scale,
      top: item.labelTop - 3 / scale,
      bottom: item.labelTop + item.labelHeight + 3 / scale,
    }));
    const diamonds = layouts.map((item) => ({
      left: item.railX - 9 / scale,
      right: item.railX + 9 / scale,
      top: item.markerY - 9 / scale,
      bottom: item.markerY + 9 / scale,
    }));
    rectangles.forEach((label, index) => {
      for (const marker of markers)
        assert(
          !intersects(label, timeGroupMemberBounds(marker)),
          `label ${index} vs member ${marker.nodeId} at ${scale}`,
        );
      for (const diamond of diamonds)
        assert(
          !intersects(label, diamond),
          `label ${index} hides diamond at ${scale}`,
        );
      rectangles
        .slice(index + 1)
        .forEach((other) => assert(!intersects(label, other)));
    });
    for (const diamond of diamonds)
      for (const marker of markers)
        assert(!intersects(diamond, timeGroupMemberBounds(marker)));
  }
  assert.deepEqual(dense, original);
});

test("default active-only labels reserve no hidden-label space and never move diamonds or rails", () => {
  const groups = [
    input("A", [[1, 350, 350]], "W".repeat(80)),
    input("B", [[1, 350, 350]], "W".repeat(80)),
  ];
  const all = layoutTimeGroupOverlays(groups, 1);
  const one = layoutTimeGroupOverlays(groups, 1, {
    visibleLabelIds: new Set(["B"]),
  });
  const none = layoutTimeGroupOverlays(groups, 1, {
    visibleLabelIds: new Set(),
  });
  assert.deepEqual(
    one.map((item) => item.labelVisible),
    [false, true],
  );
  assert(none.every((item) => !item.labelVisible));
  assert(
    one[1].labelTop > all[1].labelTop,
    "hidden A must not force B off the page",
  );
  const stable = (items: typeof all) =>
    items.map(({ railX, markerY, railBottom }) => ({
      railX,
      markerY,
      railBottom,
    }));
  assert.deepEqual(stable(all), stable(one));
  assert.deepEqual(stable(all), stable(none));
});

test("group activation controls avoid ungrouped notes and nearby text instead of intercepting their selection", () => {
  const group = input("A", [[1, 100, 100]], "Group 1");
  const markerInputs = [
    {
      ...group,
      members: group.members.map((node) => ({
        ...node,
        className: "noteheadBlack",
      })),
    },
  ];
  const ungrouped = { left: 120, top: 74, right: 135, bottom: 84 };
  const text = { left: 85, top: 45, right: 165, bottom: 65 };
  for (const scale of [0.5, 1, 2, 5]) {
    const memberMarkers = layoutTimeGroupMemberMarkers(
      markerInputs,
      "A",
      scale,
    );
    const [layout] = layoutTimeGroupOverlays([group], scale, {
      memberMarkers,
      extraObstacles: [ungrouped, text],
    });
    const label = {
      left: layout.labelX - 4 / scale,
      right: layout.labelX + layout.labelWidth + 4 / scale,
      top: layout.labelTop - 3 / scale,
      bottom: layout.labelTop + layout.labelHeight + 3 / scale,
    };
    const diamond = {
      left: layout.railX - 9 / scale,
      right: layout.railX + 9 / scale,
      top: layout.markerY - 9 / scale,
      bottom: layout.markerY + 9 / scale,
    };
    for (const node of [ungrouped, text]) {
      assert(
        !intersects(label, node),
        `label hides compact symbol at ${scale}`,
      );
      assert(
        !intersects(diamond, node),
        `diamond intercepts compact symbol at ${scale}`,
      );
    }
  }
});
