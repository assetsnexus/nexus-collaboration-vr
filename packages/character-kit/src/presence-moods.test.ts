import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PRESENCE_MOODS,
  coercePresenceMoodId,
  resolvePresenceMood,
  type PresenceMoodId,
} from "./presence-moods.ts";
import { GESTURE_CATALOG } from "./gesture-catalog.ts";

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
    assert.equal(resolvePresenceMood("flabbergasted"), null);
  });

  it("maps the P6c negative-valence families onto the new real moods", () => {
    // Before P6c these aliased onto `focused`/`neutral`, so a worried or
    // impatient agent read as calm.
    for (const alias of ["anxious", "concerned", "nervous", "uneasy"]) {
      assert.equal(resolvePresenceMood(alias)?.id, "worried", alias);
    }
    for (const alias of ["impatient", "irritated", "frustrated", "pissed", "grumpy", "exasperated"]) {
      assert.equal(resolvePresenceMood(alias)?.id, "annoyed", alias);
    }
    for (const alias of ["amused", "cheeky", "smug"]) {
      assert.equal(resolvePresenceMood(alias)?.id, "playful", alias);
    }
  });
});

describe("P6c worried / annoyed mood definitions", () => {
  it("defines both with a low-intensity rest face and real fidget pools", () => {
    const worried = PRESENCE_MOODS.worried;
    assert.ok(worried);
    assert.equal(worried.faceEmotion, "surprised");
    assert.ok(worried.faceIntensity! <= 0.5, "worried must read as concern, not a startle");
    assert.ok(worried.microGestures.length > 0);
    assert.ok(worried.mediumGestures.length > 0);

    const annoyed = PRESENCE_MOODS.annoyed;
    assert.ok(annoyed);
    assert.equal(annoyed.faceEmotion, "angry");
    assert.ok(annoyed.faceIntensity! <= 0.5, "annoyed must stay comedic, not hostile");
    assert.ok(annoyed.microGestures.includes("disagree"));
    assert.ok(annoyed.mediumGestures.includes("angry"));
  });

  it("uses only gestures the catalog actually ships", () => {
    // A mood that names a missing clip silently plays nothing.
    const known = new Set(GESTURE_CATALOG.map((entry) => entry.id));
    for (const mood of [PRESENCE_MOODS.worried, PRESENCE_MOODS.annoyed]) {
      for (const id of [...mood.microGestures, ...mood.mediumGestures, ...mood.longGestures]) {
        assert.ok(known.has(id), `${mood.id} references unknown gesture ${id}`);
      }
    }
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
    // P6c promoted the impatience family from "unknown" to a real `annoyed` mood.
    assert.equal(coercePresenceMoodId("grumpy"), "annoyed");
    assert.equal(coercePresenceMoodId("flabbergasted"), null);
  });
});
