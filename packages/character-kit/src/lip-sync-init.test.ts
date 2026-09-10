import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enqueueAudioWorkletInit } from "./lip-sync-init.ts";

describe("enqueueAudioWorkletInit", () => {
  it("runs overlapping inits one at a time in call order", async () => {
    const started: number[] = [];
    const finished: number[] = [];
    const jobs = [0, 1, 2].map((id) =>
      enqueueAudioWorkletInit(async () => {
        started.push(id);
        await new Promise((resolve) => setTimeout(resolve, 15));
        finished.push(id);
        return id;
      }),
    );
    const results = await Promise.all(jobs);
    assert.deepEqual(results, [0, 1, 2]);
    assert.deepEqual(started, [0, 1, 2]);
    assert.deepEqual(finished, [0, 1, 2]);
  });

  it("keeps the queue moving after a rejected init", async () => {
    const failed = enqueueAudioWorkletInit(async () => {
      throw new Error("boom");
    });
    await assert.rejects(failed, /boom/);
    const next = await enqueueAudioWorkletInit(async () => "ok");
    assert.equal(next, "ok");
  });
});
