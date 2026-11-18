/**
 * BimKernel seam.
 *
 * The cluster model is IFC-shaped, but turning IFC bytes into that model needs a
 * parser. A browser uses `web-ifc` (WASM); a region-side `anx-bim` sidecar may
 * use something else later. Both implement the same small interface, so the
 * editor never imports a parser directly and the core stays dependency-free.
 *
 * Security: IFC files are untrusted input. The convenience helpers reject an
 * oversized payload **before** it reaches a kernel, and a kernel is expected to
 * validate its own parse. The cap is a guard rail, not a substitute for a
 * kernel's own limits.
 */
import type { ClusterModel } from './model.ts';
import { fromIfcModel, toIfcModel } from './ifc.ts';

/**
 * `TextEncoder`/`TextDecoder` are standard globals in Node and every browser,
 * but this package's `lib` is ES-only (no DOM types). Declare the two shapes it
 * uses rather than pulling the whole DOM lib in.
 */
declare const TextEncoder: { new (): { encode(input?: string): Uint8Array } };
declare const TextDecoder: {
  new (label?: string, options?: { fatal?: boolean }): { decode(input?: Uint8Array): string };
};

/** 64 MB. A federated model larger than this should be split or streamed. */
export const DEFAULT_BIM_MAX_BYTES = 64 * 1024 * 1024;

export type BimKernelErrorCode =
  | 'BIM_KERNEL_UNAVAILABLE'
  | 'BIM_INPUT_TOO_LARGE'
  | 'BIM_IMPORT_FAILED'
  | 'BIM_EXPORT_FAILED';

export class BimKernelError extends Error {
  readonly code: BimKernelErrorCode;

  constructor(code: BimKernelErrorCode, message: string) {
    super(message);
    this.name = 'BimKernelError';
    this.code = code;
  }
}

/**
 * A parser/serialiser for IFC.
 *
 * `importIfc` must return a model that satisfies `validateClusterModel`; a
 * kernel that cannot parse the bytes throws rather than returning a partial
 * model silently.
 */
export type BimKernel = {
  /** Stable name, e.g. `web-ifc` or `anx-bim`. */
  name: string;
  importIfc(bytes: Uint8Array): Promise<ClusterModel>;
  exportIfc(model: ClusterModel): Promise<Uint8Array>;
};

export type BimKernelRegistry = {
  register(kernel: BimKernel): void;
  /** The named kernel, or the first registered one when no name is given. */
  resolve(name?: string): BimKernel | null;
  list(): BimKernel[];
};

/** A registry so a host can swap the kernel without touching call sites. */
export function createBimKernelRegistry(): BimKernelRegistry {
  const kernels = new Map<string, BimKernel>();
  return {
    register(kernel) {
      const name = kernel.name?.trim();
      if (!name) throw new BimKernelError('BIM_KERNEL_UNAVAILABLE', 'a BIM kernel needs a name');
      kernels.set(name, kernel);
    },
    resolve(name) {
      if (name) return kernels.get(name) ?? null;
      const first = kernels.values().next();
      return first.done ? null : first.value;
    },
    list() {
      return [...kernels.values()];
    },
  };
}

/**
 * A reference kernel that speaks the pure entity graph as JSON.
 *
 * It is not an IFC STEP parser — it is the seam's contract in executable form,
 * useful for tests, for a sidecar that exchanges the graph, and as the shape a
 * real `web-ifc` adapter must match.
 */
export function createJsonBimKernel(): BimKernel {
  const encoder = new TextEncoder();
  return {
    name: 'entity-graph-json',
    async importIfc(bytes) {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { entities?: unknown }).entities)) {
        throw new BimKernelError('BIM_IMPORT_FAILED', 'the payload is not a cluster IFC entity graph');
      }
      return fromIfcModel(parsed as Parameters<typeof fromIfcModel>[0]);
    },
    async exportIfc(model) {
      return encoder.encode(JSON.stringify(toIfcModel(model)));
    },
  };
}

/**
 * Import IFC bytes through a kernel.
 *
 * Rejects an oversized payload before parsing, and wraps a kernel failure in a
 * typed error so a caller can show "this file could not be read" instead of a
 * stack trace.
 */
export async function importClusterFromBim(input: {
  registry: BimKernelRegistry;
  bytes: Uint8Array;
  kernel?: string;
  maxBytes?: number;
}): Promise<ClusterModel> {
  const maxBytes = input.maxBytes ?? DEFAULT_BIM_MAX_BYTES;
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0) {
    throw new BimKernelError('BIM_IMPORT_FAILED', 'the payload is empty');
  }
  if (input.bytes.byteLength > maxBytes) {
    throw new BimKernelError(
      'BIM_INPUT_TOO_LARGE',
      `the payload is ${input.bytes.byteLength} bytes; the limit is ${maxBytes}`,
    );
  }
  const kernel = input.registry.resolve(input.kernel);
  if (!kernel) {
    throw new BimKernelError(
      'BIM_KERNEL_UNAVAILABLE',
      input.kernel ? `no BIM kernel named ${input.kernel}` : 'no BIM kernel is registered',
    );
  }
  try {
    return await kernel.importIfc(input.bytes);
  } catch (error) {
    if (error instanceof BimKernelError) throw error;
    throw new BimKernelError(
      'BIM_IMPORT_FAILED',
      error instanceof Error ? error.message : 'the IFC file could not be read',
    );
  }
}

/** Export a cluster model through a kernel. */
export async function exportClusterToBim(input: {
  registry: BimKernelRegistry;
  model: ClusterModel;
  kernel?: string;
}): Promise<Uint8Array> {
  const kernel = input.registry.resolve(input.kernel);
  if (!kernel) {
    throw new BimKernelError(
      'BIM_KERNEL_UNAVAILABLE',
      input.kernel ? `no BIM kernel named ${input.kernel}` : 'no BIM kernel is registered',
    );
  }
  try {
    return await kernel.exportIfc(input.model);
  } catch (error) {
    if (error instanceof BimKernelError) throw error;
    throw new BimKernelError(
      'BIM_EXPORT_FAILED',
      error instanceof Error ? error.message : 'the model could not be exported',
    );
  }
}
