import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PRESENCE_MOODS,
  coercePresenceMoodId,
  resolvePresenceMood,
  type PresenceMoodId,
} from "./presence-moods.ts";

/** Every value `NativeEmotionEngine.moodToPresence` can emit. */
const ENGINE_MOODS = ["calm", "happy", "alert", "sad", "energetic", "neutral"] as const;

describe("resolvePresenceMood", () => {
  it("maps seed aliases onto catalog moods", () => {
    assert.equal(resolvePresenceMood("calm")?.id, "relaxed");
    assert.equal(resolvePresenceMood("warm")?.id, "happy");
    assert.equal(resolvePresenceMood("gentle")?.id, "relaxed");
    assert.equal(resolvePresenceMood("focused")?.id, "focused");
  });

  it("maps the native emotion engine vocabulary onto catalog moods", () => {
    // `alert` / `energetic` used to fall through to null, so setMood returned
    // false and the avatar kept its previous mood.
    assert.equal(resolvePresenceMood("alert")?.id, "focused");
    assert.equal(resolvePresenceMood("energetic")?.id, "excited");
  });

  it("is case and whitespace tolerant", () => {
    assert.equal(resolvePresenceMood("  HAPPY ")?.id, "happy");
    assert.equal(resolvePresenceMood("Neutral")?.id, "neutral");
  });

  it("returns null for unknown ids", () => {
    assert.equal(resolvePresenceMood("grumpy"), null);
  });
});

describe("coercePresenceMoodId", () => {
  it("round-trips every native engine mood to a real catalog id", () => {
    for (const mood of ENGINE_MOODS) {
      const id = coercePresenceMoodId(mood);
      assert.ok(id, `${mood} must coerce to a catalog id`);
      assert.ok(
        Object.prototype.hasOwnProperty.call(PRESENCE_MOODS, id as PresenceMoodId),
        `${mood} → ${id} must exist in PRESENCE_MOODS`,
      );
    }
  });

  it("accepts canonical ids unchanged", () => {
    for (const id of Object.keys(PRESENCE_MOODS) as PresenceMoodId[]) {
      assert.equal(coercePresenceMoodId(id), id);
    }
  });

  it("rejects blanks and non-strings", () => {
    assert.equal(coercePresenceMoodId("   "), null);
    assert.equal(coercePresenceMoodId(undefined), null);
    assert.equal(coercePresenceMoodId(null), null);
    assert.equal(coercePresenceMoodId("grumpy"), null);
  });
});
