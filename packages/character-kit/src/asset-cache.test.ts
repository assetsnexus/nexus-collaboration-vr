import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assetBodyLooksValid,
  assetFetchRetryDelayMs,
  assetLoadRatio,
  isRetryableAssetFetchError,
  resourcePathForUrl,
  shouldPersistAssetUrl,
  withAssetFetchRetries,
} from "./asset-cache.ts";

describe("resourcePathForUrl", () => {
  it("keeps the directory for relative glTF buffers", () => {
    assert.equal(resourcePathForUrl("/dev-vrm-assets/vrm/sample.vrm"), "/dev-vrm-assets/vrm/");
    assert.equal(
      resourcePathForUrl("https://cdn.example/models/a.vrm?v=1"),
      "https://cdn.example/models/",
    );
  });
});

describe("shouldPersistAssetUrl", () => {
  it("caches http and same-origin paths, not blobs", () => {
    assert.equal(shouldPersistAssetUrl("/dev-vrm-assets/vrm/tori.vrm"), true);
    assert.equal(shouldPersistAssetUrl("https://cdn.example/a.vrm"), true);
    assert.equal(shouldPersistAssetUrl("blob:http://localhost/abc"), false);
    assert.equal(shouldPersistAssetUrl("data:application/octet-stream;base64,aa"), false);
    assert.equal(shouldPersistAssetUrl(""), false);
  });
});

function bytesOf(text: string): ArrayBuffer {
  const u8 = new TextEncoder().encode(text);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

describe("assetBodyLooksValid", () => {
  it("rejects empty buffers and HTML served as a VRM", () => {
    assert.equal(assetBodyLooksValid("/a.vrm", new ArrayBuffer(0)), false);
    assert.equal(assetBodyLooksValid("/a.vrm", bytesOf("<!doctype html>")), false);
  });

  it('accepts a GLB magic header and JSON manifests', () => {
    assert.equal(assetBodyLooksValid("/a.vrm", bytesOf("glTF....")), true);
    assert.equal(assetBodyLooksValid("/vrma/manifest.json", bytesOf('{"gestures":[]}')), true);
  });
});

describe("assetLoadRatio", () => {
  it("is determinate when total is known and -1 otherwise", () => {
    assert.equal(assetLoadRatio(50, 100), 0.5);
    assert.equal(assetLoadRatio(0, 0), -1);
    assert.equal(assetLoadRatio(10, Number.NaN), -1);
  });
});

describe("assetFetchRetryDelayMs", () => {
  it("doubles from 300ms", () => {
    assert.equal(assetFetchRetryDelayMs(0), 300);
    assert.equal(assetFetchRetryDelayMs(1), 600);
    assert.equal(assetFetchRetryDelayMs(2), 1200);
    assert.equal(assetFetchRetryDelayMs(3), 2400);
  });
});

describe("isRetryableAssetFetchError", () => {
  it("retries network and 5xx, not 404 or invalid body", () => {
    assert.equal(isRetryableAssetFetchError(new TypeError("Failed to fetch")), true);
    assert.equal(isRetryableAssetFetchError(new Error("Failed to fetch /x: HTTP 503")), true);
    assert.equal(isRetryableAssetFetchError(new Error("Failed to fetch /x: HTTP 429")), true);
    assert.equal(isRetryableAssetFetchError(new Error("Failed to fetch /x: HTTP 404")), false);
    assert.equal(
      isRetryableAssetFetchError(new Error("Failed to fetch /x: empty or invalid body (0 bytes)")),
      false,
    );
  });
});

describe("withAssetFetchRetries", () => {
  it("succeeds after transient failures within 5 attempts", async () => {
    let n = 0;
    const value = await withAssetFetchRetries("/dev-vrm-assets/vrma/v_sign.vrma", async () => {
      n += 1;
      if (n < 3) throw new TypeError("Failed to fetch");
      return "ok";
    });
    assert.equal(value, "ok");
    assert.equal(n, 3);
  });

  it("does not retry 404", async () => {
    let n = 0;
    await assert.rejects(
      () =>
        withAssetFetchRetries("/missing.vrma", async () => {
          n += 1;
          throw new Error("Failed to fetch /missing.vrma: HTTP 404");
        }),
      /HTTP 404/,
    );
    assert.equal(n, 1);
  });
});
