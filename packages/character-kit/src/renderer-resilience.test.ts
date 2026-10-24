import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  contextAllowsRender,
  contextCreationFailureReason,
  contextFallbackNotice,
  contextNeedsFallbackNotice,
  createContextRecovery,
  createResilientRenderer,
  defaultRendererFlavors,
  isContextCreationErrorEvent,
  isContextLostEvent,
  isContextRestoredEvent,
  type RendererContextParams,
} from "./renderer-resilience.ts";

type FakeCanvas = {
  listeners: Map<string, Function[]>;
  addEventListener: (type: string, fn: Function) => void;
  removeEventListener: (type: string, fn: Function) => void;
  emit: (type: string, payload?: Record<string, unknown>) => void;
};

function fakeCanvas(): FakeCanvas {
  const listeners = new Map<string, Function[]>();
  return {
    listeners,
    addEventListener(type, fn) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    removeEventListener(type, fn) {
      listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn));
    },
    emit(type, payload = {}) {
      for (const fn of listeners.get(type) ?? []) fn({ type, ...payload });
    },
  };
}

describe("defaultRendererFlavors", () => {
  it("degrades cost (antialias / power) but never alpha", () => {
    const flavors = defaultRendererFlavors();
    assert.equal(flavors[0]!.antialias, true);
    assert.equal(flavors.at(-1)!.antialias, false);
    const alphas = new Set(flavors.map((f) => f.alpha));
    assert.equal(alphas.size, 1, "alpha must be identical across flavours");
    // Every flavour id is unique so the attempt log is unambiguous.
    assert.equal(new Set(flavors.map((f) => f.id)).size, flavors.length);
  });

  it("honours an explicit alpha=false base", () => {
    assert.ok(defaultRendererFlavors({ alpha: false }).every((f) => f.alpha === false));
  });
});

describe("context event classification", () => {
  it("recognises WebGL1 + WebGL2 loss/restore names", () => {
    assert.equal(isContextLostEvent({ type: "webglcontextlost" }), true);
    assert.equal(isContextLostEvent({ type: "webgl2contextlost" }), true);
    assert.equal(isContextLostEvent({ type: "webglcontextrestored" }), false);
    assert.equal(isContextRestoredEvent({ type: "webglcontextrestored" }), true);
    assert.equal(isContextRestoredEvent({ type: "webgl2contextrestored" }), true);
    assert.equal(isContextCreationErrorEvent({ type: "webglcontextcreationerror" }), true);
    assert.equal(isContextCreationErrorEvent(null), false);
  });
});

describe("contextCreationFailureReason", () => {
  it("never returns an empty string", () => {
    assert.match(contextCreationFailureReason(null), /refused a WebGL context/);
    assert.match(contextCreationFailureReason({ statusMessage: "  " }), /refused a WebGL context/);
  });

  it("keeps the first line and caps the length", () => {
    const reason = contextCreationFailureReason({
      statusMessage: `${"x".repeat(300)}\nsecond line`,
    });
    assert.ok(reason.length <= 160);
    assert.ok(!reason.includes("\n"));
    assert.equal(contextCreationFailureReason({ statusMessage: "context lost\nmore" }), "context lost");
  });
});

describe("createContextRecovery", () => {
  it("tracks loss → restore and emits both", () => {
    const canvas = fakeCanvas();
    const seen: string[] = [];
    const recovery = createContextRecovery({
      canvas,
      onStateChange: (state) => seen.push(state),
    });
    recovery.attach();
    assert.equal(recovery.state(), "ready");

    canvas.emit("webglcontextlost");
    assert.equal(recovery.state(), "lost");
    canvas.emit("webglcontextrestored");
    assert.equal(recovery.state(), "ready");
    assert.deepEqual(seen, ["lost", "ready"]);
  });

  it("calls preventDefault on loss so the browser attempts a restore", () => {
    const canvas = fakeCanvas();
    const recovery = createContextRecovery({ canvas });
    recovery.attach();
    let prevented = false;
    canvas.emit("webglcontextlost", {
      preventDefault: () => {
        prevented = true;
      },
    });
    assert.equal(recovery.state(), "lost");
    assert.equal(prevented, true, "restore is only attempted if the loss is defaulted");
  });

  it("records an unavailable state from a creation-error event", () => {
    const canvas = fakeCanvas();
    const recovery = createContextRecovery({ canvas });
    recovery.attach();
    canvas.emit("webglcontextcreationerror", { statusMessage: "too many contexts" });
    assert.equal(recovery.state(), "unavailable");
  });

  it("detaches listeners on dispose and stops emitting", () => {
    const canvas = fakeCanvas();
    let calls = 0;
    const recovery = createContextRecovery({ canvas, onStateChange: () => calls++ });
    recovery.attach();
    canvas.emit("webglcontextlost");
    assert.equal(calls, 1);
    recovery.dispose();
    canvas.emit("webglcontextrestored");
    assert.equal(calls, 1, "a disposed tracker must ignore canvas events");
  });

  it("honours an initial unavailable state (creation already failed)", () => {
    const recovery = createContextRecovery({ canvas: fakeCanvas(), initial: "unavailable" });
    assert.equal(recovery.state(), "unavailable");
  });
});

describe("createResilientRenderer", () => {
  it("uses the first flavour when it works", () => {
    const canvas = fakeCanvas();
    const created: RendererContextParams[] = [];
    const result = createResilientRenderer({
      canvas,
      create: (params) => {
        created.push(params);
        return { kind: "renderer" };
      },
    });
    assert.ok(result.renderer);
    assert.equal(result.flavor?.id, "aa");
    assert.equal(created.length, 1);
    assert.deepEqual(result.attempts, [{ id: "aa", ok: true, reason: null }]);
  });

  it("degrades to a cheaper flavour instead of crashing the window", () => {
    const canvas = fakeCanvas();
    const degradations: string[] = [];
    const result = createResilientRenderer({
      canvas,
      create: (params) => {
        if (params.antialias) throw new Error("context refused");
        return { antialias: params.antialias };
      },
      onDegrade: ({ id }) => degradations.push(id),
    });
    assert.ok(result.renderer);
    assert.equal(result.flavor?.id, "no-aa");
    assert.deepEqual(degradations, ["aa", "aa-low-power"]);
    assert.equal(result.attempts.at(-1)?.ok, true);
  });

  it("returns null renderer + full attempt log when every flavour fails", () => {
    const canvas = fakeCanvas();
    const result = createResilientRenderer({
      canvas,
      create: () => {
        throw new Error("no GPU");
      },
    });
    assert.equal(result.renderer, null);
    assert.equal(result.flavor, null);
    assert.equal(result.attempts.length, defaultRendererFlavors().length);
    assert.ok(result.attempts.every((a) => !a.ok));
  });

  it("exposes a shared context tracker bound to the canvas", () => {
    const canvas = fakeCanvas();
    const result = createResilientRenderer({ canvas, create: () => ({}) });
    canvas.emit("webglcontextlost");
    assert.equal(result.context.state(), "lost");
  });
});

describe("context render gating", () => {
  it("only renders when ready", () => {
    assert.equal(contextAllowsRender("ready"), true);
    assert.equal(contextAllowsRender("lost"), false);
    assert.equal(contextAllowsRender("unavailable"), false);
  });

  it("only nags when genuinely unavailable", () => {
    assert.equal(contextNeedsFallbackNotice("unavailable"), true);
    assert.equal(contextNeedsFallbackNotice("lost"), false);
    assert.equal(contextNeedsFallbackNotice("ready"), false);
  });

  it("produces honest, non-empty copy", () => {
    assert.equal(contextFallbackNotice("ready", null), "");
    assert.match(contextFallbackNotice("lost", null), /restoring/);
    assert.match(contextFallbackNotice("unavailable", "no GPU"), /no GPU/);
    assert.match(contextFallbackNotice("unavailable", null), /unavailable/);
  });
});

describe("renderer status surface", () => {
  it("reports lost then restored (not ok) across a loss cycle", () => {
    const canvas = fakeCanvas();
    const recovery = createContextRecovery({ canvas });
    recovery.attach();
    const seen: string[] = [];
    recovery.onStatus((status) => seen.push(status.state));

    assert.deepEqual(seen, ["ok"], "replays the current status on subscribe");
    canvas.emit("webglcontextlost");
    canvas.emit("webglcontextrestored");
    assert.deepEqual(seen, ["ok", "lost", "restored"]);
    assert.equal(recovery.status().state, "restored");
  });

  it("reports failed with the reason when no context was ever granted", () => {
    const canvas = fakeCanvas();
    const recovery = createContextRecovery({ canvas });
    recovery.attach();
    canvas.emit("webglcontextcreationerror", { statusMessage: "too many contexts" });
    const status = recovery.status();
    assert.equal(status.state, "failed");
    assert.match(status.message ?? "", /too many contexts/);
  });

  it("a late listener still learns the current status", () => {
    const canvas = fakeCanvas();
    const recovery = createContextRecovery({ canvas });
    recovery.attach();
    canvas.emit("webglcontextlost");
    const seen: string[] = [];
    recovery.onStatus((status) => seen.push(status.state));
    assert.deepEqual(seen, ["lost"]);
  });

  it("marks unavailable when acquisition failed without a canvas event", () => {
    const recovery = createResilientRenderer({
      canvas: fakeCanvas(),
      create: () => {
        throw new Error("no GPU");
      },
    });
    assert.equal(recovery.renderer, null);
    assert.equal(recovery.context.status().state, "failed");
    assert.match(recovery.context.status().message ?? "", /no GPU/);
  });

  it("unsubscribing stops further status callbacks", () => {
    const canvas = fakeCanvas();
    const recovery = createContextRecovery({ canvas });
    recovery.attach();
    let calls = 0;
    const off = recovery.onStatus(() => calls++);
    assert.equal(calls, 1, "initial replay counts");
    off();
    canvas.emit("webglcontextlost");
    assert.equal(calls, 1);
  });
});
