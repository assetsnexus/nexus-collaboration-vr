import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cameraPoseFacingAvatar,
  cameraYawTowardTarget,
  DEFAULT_FRAME_DISTANCE_M,
} from "./scene-camera.ts";

describe("cameraPoseFacingAvatar", () => {
  it("places the camera in front of a character facing +Z", () => {
    const pose = cameraPoseFacingAvatar({ x: 0, z: 0, facingRad: 0, headY: 1.5 });
    assert.equal(pose.target.x, 0);
    assert.equal(pose.target.z, 0);
    assert.equal(pose.target.y, 1.5);
    assert.ok(Math.abs(pose.camera.x) < 1e-9);
    assert.ok(Math.abs(pose.camera.z - DEFAULT_FRAME_DISTANCE_M) < 1e-9);
  });

  it("offsets along yaw so the character faces the lens", () => {
    const pose = cameraPoseFacingAvatar({
      x: 1,
      z: 2,
      facingRad: Math.PI / 2,
      headY: 1.4,
      distance: 2,
    });
    assert.ok(Math.abs(pose.camera.x - 3) < 1e-9);
    assert.ok(Math.abs(pose.camera.z - 2) < 1e-9);
  });
});

describe("cameraYawTowardTarget", () => {
  it("is π when the camera looks from +Z toward the origin", () => {
    assert.ok(Math.abs(cameraYawTowardTarget(0, 4, 0, 0) - Math.PI) < 1e-9);
  });

  it("points toward +X", () => {
    const yaw = cameraYawTowardTarget(0, 0, 2, 0);
    assert.ok(Math.abs(yaw - Math.PI / 2) < 1e-9);
  });
});
