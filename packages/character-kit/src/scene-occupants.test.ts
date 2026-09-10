import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isOccupantLoadCancelled,
  isStaleOccupantLoad,
  occupantPresentUrl,
  occupantRosterKey,
  occupantWorldPose,
  resolveOccupantSpawnPose,
  OCCUPANT_LOAD_CANCELLED,
} from "./scene-occupants.ts";

describe("scene-occupants", () => {
  it("uses vrmUrl only while the occupant is present", () => {
    assert.equal(occupantPresentUrl({ present: true, vrmUrl: "/a.vrm" }), "/a.vrm");
    assert.equal(occupantPresentUrl({ present: false, vrmUrl: "/a.vrm" }), "");
    assert.equal(occupantPresentUrl(undefined), "");
  });

  it("treats a finished load as stale when the roster URL moved on", () => {
    assert.equal(isStaleOccupantLoad("/b.vrm", "/a.vrm", false), true);
    assert.equal(isStaleOccupantLoad("/a.vrm", "/a.vrm", false), false);
    assert.equal(isStaleOccupantLoad("/a.vrm", "/a.vrm", true), true);
  });

  it("ignores presence-latency-only roster identity", () => {
    const row = {
      id: "gamma",
      slotIndex: 3,
      present: true,
      vrmUrl: "/tori.vrm",
      mood: "curious",
      statusColor: 0x3dd68c,
      label: "gamma",
    };
    assert.equal(occupantRosterKey([row]), occupantRosterKey([{ ...row }]));
  });

  it("changes roster identity when the VRM URL changes", () => {
    const a = {
      id: "gamma",
      slotIndex: 3,
      present: true,
      vrmUrl: "/sample.vrm",
      mood: "curious",
      statusColor: 1,
      label: "gamma",
    };
    const b = { ...a, vrmUrl: "/tori.vrm" };
    assert.notEqual(occupantRosterKey([a]), occupantRosterKey([b]));
  });

  it("ignores walked x/z/facing in roster identity so walks do not reload VRMs", () => {
    const row = {
      id: "gamma",
      slotIndex: 3,
      present: true,
      vrmUrl: "/tori.vrm",
      mood: "curious",
      statusColor: 1,
      label: "gamma",
    };
    const walked = { ...row, x: 2.4, z: -1.1, facing: 1.2 };
    assert.equal(occupantRosterKey([row]), occupantRosterKey([walked]));
  });

  it("restores a finite world pose and otherwise keeps the spawn slot", () => {
    assert.deepEqual(occupantWorldPose({ x: 1.5, z: -0.25, facing: 0.4 }), {
      x: 1.5,
      z: -0.25,
      yawRad: 0.4,
    });
    assert.equal(occupantWorldPose({ x: 1, z: 2 }), null);
    assert.deepEqual(
      resolveOccupantSpawnPose({ x: Number.NaN, z: 0, facing: 0 }, { x: 3, z: 0, yawRad: 1 }),
      { x: 3, z: 0, yawRad: 1 },
    );
  });

  it("ignores stored facing while the occupant is still on the spawn pad", () => {
    assert.deepEqual(
      resolveOccupantSpawnPose({ x: 1.25, z: 0, facing: Math.PI }, { x: 1.25, z: 0, yawRad: 0 }),
      { x: 1.25, z: 0, yawRad: 0 },
    );
    assert.deepEqual(
      resolveOccupantSpawnPose({ x: 4, z: -2, facing: 0.8 }, { x: 1.25, z: 0, yawRad: 0 }),
      { x: 4, z: -2, yawRad: 0.8 },
    );
  });

  it("recognizes cancelled occupant loads", () => {
    assert.equal(isOccupantLoadCancelled(new Error(OCCUPANT_LOAD_CANCELLED)), true);
    assert.equal(isOccupantLoadCancelled(new Error("SceneRoom disposed")), true);
    assert.equal(isOccupantLoadCancelled(new Error("HTTP 404")), false);
  });
});
