import assert from "node:assert/strict";
import test from "node:test";
import {
  layoutTimeGroupMemberMarkers,
  type TimeGroupMemberInput,
  timeGroupMemberBounds,
  TIME_GROUP_MEMBER_STROKES,
} from "./TimeGroupMemberMarkers";

function member(id: number, className = "noteheadBlack") {
  return { id, className, left: 200, top: 300, width: 22, height: 14 };
}

function input(
  id: string,
  members: TimeGroupMemberInput["members"],
): TimeGroupMemberInput {
  return { group: { id }, members };
}

test("shared notes get one indicator with a membership count, including without an active group", () => {
  const a = input("A", [member(1), member(2)]);
  const b = input("B", [member(2), member(3)]);
  const before = structuredClone([a, b]);
  const markers = layoutTimeGroupMemberMarkers([a, b], null, 1);
  assert.deepEqual(
    markers.map((item) => item.nodeId),
    [1, 2, 3],
  );
  assert.deepEqual(
    markers.map((item) => item.membershipCount),
    [1, 2, 1],
  );
  assert.deepEqual(
    markers.map((item) => item.badgeText),
    ["", "2", ""],
  );
  assert(markers.every((item) => !item.active));
  assert.deepEqual(markers[1].groupIds, ["A", "B"]);
  assert.deepEqual([a, b], before, "display layout never mutates source nodes");

  const active = layoutTimeGroupMemberMarkers([a, b], "B", 1);
  assert.deepEqual(
    active.map((item) => item.active),
    [false, true, true],
  );
  assert.deepEqual(
    active.map(({ active: _, ...geometry }) => geometry),
    markers.map(({ active: _, ...geometry }) => geometry),
    "changing active group must not move indicators or change their counts",
  );
});

test("deleting a group removes only its unique markers and updates shared-member counts immediately", () => {
  const a = input("A", [member(1), member(2)]);
  const b = input("B", [member(2), member(3)]);
  const before = layoutTimeGroupMemberMarkers([a, b], "A", 1);
  const after = layoutTimeGroupMemberMarkers([b], "A", 1);
  assert.deepEqual(
    after.map((item) => item.nodeId),
    [2, 3],
  );
  assert.deepEqual(
    after.map((item) => item.badgeText),
    ["", ""],
  );
  assert(after.every((item) => !item.active));
  assert.deepEqual(layoutTimeGroupMemberMarkers([a, b], "A", 1), before);
  assert.deepEqual(layoutTimeGroupMemberMarkers([], null, 1), []);
  assert.deepEqual(
    layoutTimeGroupMemberMarkers([input("gone", [])], null, 1),
    [],
  );
});

test("duplicate members or repeated input for the same group cannot inflate membership counts", () => {
  const a = input("A", [member(4), member(4)]);
  const [marker] = layoutTimeGroupMemberMarkers([a, a], null, 1);
  assert.equal(marker.membershipCount, 1);
  assert.equal(marker.badgeText, "");
});

test("full bbox and stroke clearance fit within the ellipse at every tested zoom", () => {
  for (const [width, height] of [
    [22, 14],
    [3, 2],
    [80, 12],
    [5, 150],
  ]) {
    const node = { ...member(1), width, height };
    for (const scale of [0.2, 0.5, 1, 2, 5]) {
      const [marker] = layoutTimeGroupMemberMarkers(
        [input("A", [node])],
        null,
        scale,
      );
      const haloRadius = TIME_GROUP_MEMBER_STROKES.lightHalo / 2 / scale;
      // All corners of a rectangle expanded by the halo radius must remain
      // strictly inside the ellipse, keeping even rectangular masks uncovered.
      for (const x of [
        node.left - haloRadius,
        node.left + width + haloRadius,
      ]) {
        for (const y of [
          node.top - haloRadius,
          node.top + height + haloRadius,
        ]) {
          const normalized =
            ((x - marker.cx) / marker.rx) ** 2 +
            ((y - marker.cy) / marker.ry) ** 2;
          assert(normalized < 1, `${width}x${height} bbox at zoom ${scale}`);
        }
      }
      const badgeBottomWithHalo = marker.badgeY + marker.badgeRy + 1 / scale;
      assert(badgeBottomWithHalo < node.top, "badge must remain above the ink");
      assert.equal(marker.cx, node.left + width / 2);
      assert.equal(marker.cy, node.top + height / 2);
    }
  }
});

test("only padding and badges keep their screen sizes; note geometry follows the page zoom", () => {
  const node = member(1);
  for (const scale of [0.5, 1, 2]) {
    const [marker] = layoutTimeGroupMemberMarkers(
      [input("A", [node])],
      null,
      scale,
    );
    assert(
      Math.abs((marker.rx / Math.SQRT2 - node.width / 2) * scale - 2.5) < 1e-10,
    );
    assert(
      Math.abs((marker.ry / Math.SQRT2 - node.height / 2) * scale - 2.5) <
        1e-10,
    );
    assert.equal(marker.badgeRy * scale, 6);
    assert.equal(marker.badgeRx * scale, 6);
    assert.equal((node.top - marker.badgeY) * scale, 8);
  }
});

test("reclassified members remain reviewable and never look like checked noteheads", () => {
  const node = member(2, "stem");
  const [single] = layoutTimeGroupMemberMarkers([input("A", [node])], null, 1);
  assert.equal(single.notehead, false);
  assert.equal(single.badgeText, "!");
  const [shared] = layoutTimeGroupMemberMarkers(
    [input("A", [node]), input("B", [node])],
    "B",
    1,
  );
  assert.equal(shared.badgeText, "!2");
  assert.equal(shared.membershipCount, 2);
  assert.equal(shared.active, true);
});

test("large membership counts have room in their single badge", () => {
  const inputs = Array.from({ length: 100 }, (_, index) =>
    input(`g${index}`, [member(1)]),
  );
  const [marker] = layoutTimeGroupMemberMarkers(inputs, null, 2);
  assert.equal(marker.membershipCount, 100);
  assert.equal(marker.badgeText, "100");
  assert(marker.badgeRx > marker.badgeRy);
});

test("invalid and tiny scales produce finite display coordinates", () => {
  for (const scale of [0, -1, NaN, Infinity]) {
    const [marker] = layoutTimeGroupMemberMarkers(
      [input("A", [member(1)])],
      null,
      scale,
    );
    for (const value of [
      marker.cx,
      marker.cy,
      marker.rx,
      marker.ry,
      marker.badgeX,
      marker.badgeY,
      marker.badgeRx,
      marker.badgeRy,
    ]) {
      assert(Number.isFinite(value));
    }
  }
});

test("label avoidance bounds include full count badges but reserve no invisible singleton badge", () => {
  const one = layoutTimeGroupMemberMarkers(
    [input("A", [member(1)])],
    "A",
    2,
  )[0];
  const shared = layoutTimeGroupMemberMarkers(
    [input("A", [member(1)]), input("B", [member(1)])],
    "A",
    2,
  )[0];
  const singleBounds = timeGroupMemberBounds(one);
  const sharedBounds = timeGroupMemberBounds(shared);
  assert.equal(one.badgeText, "");
  assert.equal(
    singleBounds.right,
    one.cx + one.rx + TIME_GROUP_MEMBER_STROKES.lightHalo / 4,
  );
  assert(sharedBounds.right >= shared.badgeX + shared.badgeRx + 0.5);
  assert(sharedBounds.top <= shared.badgeY - shared.badgeRy - 0.5);
  assert(sharedBounds.left <= shared.cx - shared.rx);
});
