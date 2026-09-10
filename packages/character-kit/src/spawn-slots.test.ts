import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { facingYawRad, layoutSpawnSlots, SPAWN_LOOK_AT_Z } from "./spawn-slots.ts";

describe("layoutSpawnSlots", () => {
  it("keeps ordered slots and does not compact a hole in the middle", () => {
    const slots = layoutSpawnSlots(5, 1.2);
    assert.equal(slots.length, 5);
    assert.deepEqual(
      slots.map((s) => s.index),
      [0, 1, 2, 3, 4],
    );
    assert.ok(slots[0]!.x < slots[2]!.x);
    assert.ok(slots[4]!.x > slots[2]!.x);
    assert.equal(slots[2]!.x, 0);
  });

  it("faces the camera (+Z) with a slight inward toe-in", () => {
    const slots = layoutSpawnSlots(3, 1.2);
    const left = slots[0]!;
    const center = slots[1]!;
    const right = slots[2]!;
    assert.ok(left.x < 0);
    assert.ok(right.x > 0);
    assert.ok(Math.abs(center.yawRad) < 0.05, `center yaw ${center.yawRad} should face +Z`);
    assert.ok(left.yawRad > 0.05, "left slot turns inward toward the camera");
    assert.ok(right.yawRad < -0.05, "right slot turns inward toward the camera");
    assert.ok(Math.abs(left.yawRad - facingYawRad(left.x, left.z, 0, SPAWN_LOOK_AT_Z)) < 1e-9);
    assert.ok(Math.abs(Math.abs(center.yawRad) - Math.PI) > 1, "must not use the old +π VRM compensation");
  });
});
