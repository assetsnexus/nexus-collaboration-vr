import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  applyEmbodimentToSteps,
  applyGestureAliasesToText,
  parseEmbodimentProfile,
  restorePresenceMoods,
  resolveEmbodimentFace,
  resolveEmbodimentMood,
  resolveEmbodimentRoutine,
  seedPresenceMoodOverrides,
  snapshotPresenceMoods,
  HAS_EMBODIMENT_ROUTINES,
} from "../dist/embodiment-profile.js";
import { PRESENCE_MOODS, resolvePresenceMood } from "../dist/presence-moods.js";

describe("parseEmbodimentProfile", () => {
  it("returns null for absent / unusable payloads (fallback to current behaviour)", () => {
    assert.equal(parseEmbodimentProfile(null), null);
    assert.equal(parseEmbodimentProfile(undefined), null);
    assert.equal(parseEmbodimentProfile("nope"), null);
    assert.equal(parseEmbodimentProfile({}), null);
  });

  it("parses a full profile without throwing on junk fields", () => {
    const profile = parseEmbodimentProfile({
      vrmUrl: "https://cdn/x.vrm",
      gestureManifestUrl: "https://cdn/gestures.json",
      defaultMood: "calm",
      lipSyncEnabled: false,
      expressionMap: { happy: "Joy" },
      gestureAliases: { hi: "wave" },
      idle: { moodOverrides: { neutral: { tempo: 1.2, faceIntensity: 0.4 } } },
      routines: { greeting: ["[wave|happy=30]", { op: "play_gesture", id: "nod" }] },
      speaking: { emotionIntensityScale: 0.8, gestureIntensityScale: 0.5 },
      faces: { public: { mood: "focused", intensityCap: 40 }, owner: { intensityCap: 1 } },
      zen: { preferFaceOnly: true },
    });
    assert.ok(profile);
    assert.equal(profile!.vrmUrl, "https://cdn/x.vrm");
    assert.equal(profile!.faces!.public!.intensityCap, 40);
    assert.equal(profile!.gestureAliases!.hi, "wave");
    assert.equal(profile!.routines!.greeting!.length, 2);
    assert.equal(profile!.zen!.preferFaceOnly, true);
  });
});

describe("resolveEmbodimentFace", () => {
  it("caps public faces by default and leaves owner uncapped", () => {
    const profile = parseEmbodimentProfile({ faces: { public: { intensityCap: 40 } } })!;
    assert.equal(resolveEmbodimentFace(profile, "owner").cap, 1);
    assert.equal(resolveEmbodimentFace(profile, "public").cap, 0.4);
  });

  it("public default cap is quieter even without an explicit face block", () => {
    const profile = parseEmbodimentProfile({ defaultMood: "happy" })!;
    assert.equal(resolveEmbodimentFace(profile, "public").cap, 0.6);
  });

  it("honours zen preferFaceOnly globally", () => {
    const profile = parseEmbodimentProfile({ zen: { preferFaceOnly: true } })!;
    assert.equal(resolveEmbodimentFace(profile, "owner").preferFaceOnly, true);
  });
});

describe("resolveEmbodimentMood", () => {
  it("uses the face mood then the default mood and normalizes aliases", () => {
    const profile = parseEmbodimentProfile({
      defaultMood: "calm",
      faces: { public: { mood: "focused" } },
    })!;
    assert.equal(resolveEmbodimentMood(profile, "owner"), "relaxed");
    assert.equal(resolveEmbodimentMood(profile, "public"), "focused");
  });

  it("returns null when nothing resolves", () => {
    assert.equal(resolveEmbodimentMood(parseEmbodimentProfile({ vrmUrl: "x" })!, "owner"), null);
  });
});

describe("resolveEmbodimentRoutine", () => {
  it("parses inline-tag strings and passes structured steps through", () => {
    const profile = parseEmbodimentProfile({
      routines: { greeting: ["[wave|happy=30]", { op: "play_gesture", id: "nod" }] },
    })!;
    const steps = resolveEmbodimentRoutine(profile, "greeting");
    assert.ok(steps.length >= 2);
    assert.ok(steps.some((s) => s.op === "play_gesture"));
    assert.equal(HAS_EMBODIMENT_ROUTINES(profile), true);
  });

  it("returns [] with no profile", () => {
    assert.deepEqual(resolveEmbodimentRoutine(null, "greeting"), []);
  });
});

describe("applyEmbodimentToSteps", () => {
  it("scales and caps face weights", () => {
    const out = applyEmbodimentToSteps(
      [{ op: "set_emotion", emotion: "happy", intensity: 0.9 }],
      { emotionScale: 0.5, cap: 0.3 },
    );
    assert.equal(out.length, 1);
    assert.equal(out[0]!.intensity, 0.3);
  });

  it("drops gesture ops in Zen while keeping face ops", () => {
    const out = applyEmbodimentToSteps(
      [
        { op: "play_gesture", id: "wave" },
        { op: "set_mood", mood: "happy" },
      ],
      { dropGestures: true },
    );
    assert.equal(out.length, 1);
    assert.equal(out[0]!.op, "set_mood");
  });
});

describe("applyGestureAliasesToText", () => {
  it("rewrites bare and scored gesture tokens", () => {
    const aliases = { hi: "wave" };
    assert.equal(applyGestureAliasesToText("[hi]", aliases), "[wave]");
    assert.equal(applyGestureAliasesToText("[hi|happy=30]", aliases), "[wave|happy=30]");
    assert.equal(applyGestureAliasesToText("[hi, nod]", aliases), "[wave, nod]");
  });

  it("leaves namespaced tags and unknown tokens untouched", () => {
    const aliases = { hi: "wave" };
    assert.equal(applyGestureAliasesToText("[mood:hi]", aliases), "[mood:hi]");
    assert.equal(applyGestureAliasesToText("[nod]", aliases), "[nod]");
    assert.equal(applyGestureAliasesToText("plain text", aliases), "plain text");
  });
});

describe("seedPresenceMoodOverrides", () => {
  let snapshot: ReturnType<typeof snapshotPresenceMoods>;
  beforeEach(() => {
    snapshot = snapshotPresenceMoods();
  });
  afterEach(() => {
    restorePresenceMoods(snapshot);
  });

  it("seeds partial mood overrides into the shared catalog", () => {
    const changed = seedPresenceMoodOverrides({ neutral: { tempo: 3, faceIntensity: 0.9 } });
    assert.deepEqual(changed, ["neutral"]);
    assert.equal(PRESENCE_MOODS.neutral.tempo, 3);
    assert.equal(PRESENCE_MOODS.neutral.faceIntensity, 0.9);
  });

  it("ignores unknown mood ids", () => {
    assert.deepEqual(seedPresenceMoodOverrides({ grumpy: { tempo: 2 } }), []);
    assert.equal(resolvePresenceMood("grumpy"), null);
  });
});
