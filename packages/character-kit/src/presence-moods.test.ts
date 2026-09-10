import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePresenceMood } from "./presence-moods.ts";

describe("resolvePresenceMood", () => {
  it("maps seed aliases onto catalog moods", () => {
    assert.equal(resolvePresenceMood("calm")?.id, "relaxed");
    assert.equal(resolvePresenceMood("warm")?.id, "happy");
    assert.equal(resolvePresenceMood("gentle")?.id, "relaxed");
    assert.equal(resolvePresenceMood("focused")?.id, "focused");
  });

  it("returns null for unknown ids", () => {
    assert.equal(resolvePresenceMood("grumpy"), null);
  });
});
