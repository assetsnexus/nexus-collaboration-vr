import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ASSET_TTL_MS,
  FETCHED_AT_HEADER,
  TTL_MS_HEADER,
  assetBodyLooksValid,
  assetFetchRetryDelayMs,
  assetLoadRatio,
  avatarAssetCacheKey,
  canonicalizePublicAssetUrl,
  fetchCachedArrayBuffer,
  isAvatarAssetCacheEntryFresh,
  isRetryableAssetFetchError,
  resourcePathForUrl,
  shouldPersistAssetUrl,
  shouldStoreAvatarAsset,
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

describe("avatarAssetCacheKey", () => {
  it("shares public URL keys across users (userId ignored)", () => {
    const url = "https://cdn.example/models/public.vrm";
    assert.equal(
      avatarAssetCacheKey({ url, userId: "alice" }),
      avatarAssetCacheKey({ url, userId: "bob" }),
    );
    assert.equal(avatarAssetCacheKey({ url, userId: "alice" }), canonicalizePublicAssetUrl(url));
  });

  it("prefers catalog asset id over URL and ignores userId", () => {
    const a = avatarAssetCacheKey({
      url: "https://cdn.example/a.vrm",
      assetId: "asset-123",
      userId: "alice",
    });
    const b = avatarAssetCacheKey({
      url: "https://cdn.example/other.vrm",
      assetId: "asset-123",
      userId: "bob",
    });
    assert.equal(a, b);
    assert.match(a, /asset-123/);
  });
});

describe("shouldPersistAssetUrl / shouldStoreAvatarAsset", () => {
  it("caches http and same-origin paths, not blobs", () => {
    assert.equal(shouldPersistAssetUrl("/dev-vrm-assets/vrm/tori.vrm"), true);
    assert.equal(shouldPersistAssetUrl("https://cdn.example/a.vrm"), true);
    assert.equal(shouldPersistAssetUrl("blob:http://localhost/abc"), false);
    assert.equal(shouldPersistAssetUrl("data:application/octet-stream;base64,aa"), false);
    assert.equal(shouldPersistAssetUrl(""), false);
  });

  it("skips blob and previewUnverified from shared store", () => {
    assert.equal(
      shouldStoreAvatarAsset({ url: "blob:http://localhost/abc" }),
      false,
    );
    assert.equal(
      shouldStoreAvatarAsset({
        url: "https://cdn.example/pending.vrm",
        previewUnverified: true,
      }),
      false,
    );
    assert.equal(
      shouldStoreAvatarAsset({
        url: "https://cdn.example/verified.vrm",
        validationStatus: "verified",
      }),
      true,
    );
  });
});

describe("isAvatarAssetCacheEntryFresh", () => {
  it("treats expired entries as a stale miss", () => {
    const fetchedAt = 1_000_000;
    const ttlMs = DEFAULT_ASSET_TTL_MS;
    assert.equal(isAvatarAssetCacheEntryFresh(fetchedAt, ttlMs, fetchedAt + 1), true);
    assert.equal(isAvatarAssetCacheEntryFresh(fetchedAt, ttlMs, fetchedAt + ttlMs - 1), true);
    assert.equal(isAvatarAssetCacheEntryFresh(fetchedAt, ttlMs, fetchedAt + ttlMs), false);
    assert.equal(isAvatarAssetCacheEntryFresh(fetchedAt, ttlMs, fetchedAt + ttlMs + 10_000), false);
    assert.equal(isAvatarAssetCacheEntryFresh(0, ttlMs, Date.now()), false);
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

  it("accepts a GLB magic header, JSON manifests, and pictures", () => {
    assert.equal(assetBodyLooksValid("/a.vrm", bytesOf("glTF....")), true);
    assert.equal(assetBodyLooksValid("/vrma/manifest.json", bytesOf('{"gestures":[]}')), true);
    assert.equal(assetBodyLooksValid("/portraits/a.png", bytesOf("PNG.....")), true);
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

/**
 * Minimal in-memory stand-in for the Cache Storage bucket. Only the surface
 * `fetchCachedArrayBuffer` touches is implemented (open/match/put/delete).
 */
function fakeCacheStorage(seed: Map<string, Response> = new Map()) {
  const store = seed;
  const puts: string[] = [];
  const deletes: string[] = [];
  const bucket = {
    async match(key: string) {
      return store.get(key) ?? undefined;
    },
    async put(key: string, value: Response) {
      store.set(key, value);
      puts.push(key);
    },
    async delete(key: string) {
      deletes.push(key);
      return store.delete(key);
    },
  };
  (globalThis as { caches?: unknown }).caches = {
    open: async () => bucket,
  };
  return { store, puts, deletes };
}

/** A valid GLB body: the `glTF` magic three's loader expects. */
function glbBytes(payload = "...."): ArrayBuffer {
  const u8 = new TextEncoder().encode(`glTF${payload}`);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

/** A cached entry whose headers make it fresh, with a caller-chosen body. */
function cachedEntry(body: ArrayBuffer, nowMs: number): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "model/gltf-binary",
      [FETCHED_AT_HEADER]: String(nowMs),
      [TTL_MS_HEADER]: String(DEFAULT_ASSET_TTL_MS),
    },
  });
}

describe("fetchCachedArrayBuffer concurrency safety", () => {
  it("refetches when the cached body is corrupt, returning valid bytes", async () => {
    const url = "https://cdn.example/avatar.vrm";
    const key = avatarAssetCacheKey({ url });
    const nowMs = 1_000_000;
    // A half-written entry from another window: right headers, garbage body.
    const { deletes } = fakeCacheStorage(
      new Map([[key, cachedEntry(bytesOf("<!doctype html>"), nowMs)]]),
    );

    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(glbBytes("BODY"), { status: 200 });
    }) as typeof fetch;
    try {
      const out = await fetchCachedArrayBuffer(url, { nowMs });
      const magic = new TextDecoder().decode(new Uint8Array(out, 0, 4));
      assert.equal(magic, "glTF", "must return the refetched valid body");
      assert.equal(fetchCalls, 1, "a corrupt entry must trigger exactly one refetch");
      assert.ok(deletes.includes(key), "the corrupt entry is deleted best-effort");
    } finally {
      globalThis.fetch = originalFetch;
      delete (globalThis as { caches?: unknown }).caches;
    }
  });

  it("serves a valid cached body without refetching", async () => {
    const url = "https://cdn.example/avatar.vrm";
    const key = avatarAssetCacheKey({ url });
    const nowMs = 1_000_000;
    fakeCacheStorage(new Map([[key, cachedEntry(glbBytes("CACHED"), nowMs)]]));

    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(glbBytes("NETWORK"), { status: 200 });
    }) as typeof fetch;
    try {
      const out = await fetchCachedArrayBuffer(url, { nowMs });
      assert.equal(new TextDecoder().decode(new Uint8Array(out, 0, 4)), "glTF");
      assert.equal(fetchCalls, 0, "a fresh valid entry is a cache hit");
    } finally {
      globalThis.fetch = originalFetch;
      delete (globalThis as { caches?: unknown }).caches;
    }
  });

  it("never writes an invalid body back to the cache", async () => {
    const url = "https://cdn.example/avatar.vrm";
    const key = avatarAssetCacheKey({ url });
    const nowMs = 1_000_000;
    const { puts } = fakeCacheStorage();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(bytesOf("<!doctype html>"), { status: 200 })) as typeof fetch;
    try {
      await assert.rejects(
        () => fetchCachedArrayBuffer(url, { nowMs }),
        /empty or invalid body/,
      );
      assert.equal(puts.length, 0, "an invalid body must never be cached");
      assert.equal(key && puts.includes(key), false);
    } finally {
      globalThis.fetch = originalFetch;
      delete (globalThis as { caches?: unknown }).caches;
    }
  });
});
