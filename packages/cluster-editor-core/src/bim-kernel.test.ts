import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BimKernelError,
  createBimKernelRegistry,
  createJsonBimKernel,
  exportClusterToBim,
  importClusterFromBim,
} from './bim-kernel.ts';
import { baseModel } from './model.test.ts';
import type { ClusterModel } from './model.ts';

function model(): ClusterModel {
  return baseModel({
    buildings: [{ id: 'b1', name: 'House', storeyIds: ['s1'] }],
    storeys: [{ id: 's1', buildingId: 'b1', name: 'Ground', elevation: 0, height: 2.8 }],
    assets: [
      {
        id: 'a1',
        name: 'Chair',
        position: { x: 1, y: 1, z: 0 },
        productRef: 'chair-oak',
        modelRef: { modelId: 'chair-oak-v2', format: 'glb' },
      },
    ],
    materials: [{ id: 'm1', name: 'Paint', kind: 'paint', color: '#ffffff' }],
    surfaces: [{ id: 's1', ownerId: 'b1', ownerKind: 'building', kind: 'floor', materialId: 'm1' }],
  });
}

test('the registry resolves a named kernel and the first one by default', () => {
  const registry = createBimKernelRegistry();
  const kernel = createJsonBimKernel();
  registry.register(kernel);
  assert.equal(registry.resolve('entity-graph-json'), kernel);
  assert.equal(registry.resolve(), kernel);
  assert.deepEqual(registry.list().map((entry) => entry.name), ['entity-graph-json']);
});

test('an unknown kernel name resolves to null', () => {
  const registry = createBimKernelRegistry();
  registry.register(createJsonBimKernel());
  assert.equal(registry.resolve('web-ifc'), null);
});

test('a kernel without a name is rejected', () => {
  const registry = createBimKernelRegistry();
  assert.throws(
    () => registry.register({ name: '  ', importIfc: async () => model(), exportIfc: async () => new Uint8Array() }),
    (error: unknown) => error instanceof BimKernelError && error.code === 'BIM_KERNEL_UNAVAILABLE',
  );
});

test('the JSON kernel round-trips a model through bytes', async () => {
  const registry = createBimKernelRegistry();
  registry.register(createJsonBimKernel());
  const original = model();
  const bytes = await exportClusterToBim({ registry, model: original });
  assert.ok(bytes.byteLength > 0);
  const back = await importClusterFromBim({ registry, bytes });
  assert.deepEqual(back, original);
});

test('import rejects an empty payload', async () => {
  const registry = createBimKernelRegistry();
  registry.register(createJsonBimKernel());
  await assert.rejects(
    () => importClusterFromBim({ registry, bytes: new Uint8Array() }),
    (error: unknown) => error instanceof BimKernelError && error.code === 'BIM_IMPORT_FAILED',
  );
});

test('import rejects an oversized payload before parsing', async () => {
  const registry = createBimKernelRegistry();
  registry.register(createJsonBimKernel());
  const bytes = new Uint8Array(2048);
  await assert.rejects(
    () => importClusterFromBim({ registry, bytes, maxBytes: 1024 }),
    (error: unknown) => error instanceof BimKernelError && error.code === 'BIM_INPUT_TOO_LARGE',
  );
});

test('import reports a missing kernel', async () => {
  const registry = createBimKernelRegistry();
  await assert.rejects(
    () => importClusterFromBim({ registry, bytes: new Uint8Array([1]) }),
    (error: unknown) => error instanceof BimKernelError && error.code === 'BIM_KERNEL_UNAVAILABLE',
  );
});

test('a kernel failure becomes a typed import error', async () => {
  const registry = createBimKernelRegistry();
  registry.register({
    name: 'broken',
    importIfc: async () => {
      throw new Error('parse exploded');
    },
    exportIfc: async () => new Uint8Array(),
  });
  await assert.rejects(
    () => importClusterFromBim({ registry, bytes: new Uint8Array([1]) }),
    (error: unknown) =>
      error instanceof BimKernelError &&
      error.code === 'BIM_IMPORT_FAILED' &&
      /parse exploded/.test(error.message),
  );
});

test('a kernel failure becomes a typed export error', async () => {
  const registry = createBimKernelRegistry();
  registry.register({
    name: 'broken',
    importIfc: async () => model(),
    exportIfc: async () => {
      throw new Error('write exploded');
    },
  });
  await assert.rejects(
    () => exportClusterToBim({ registry, model: model() }),
    (error: unknown) => error instanceof BimKernelError && error.code === 'BIM_EXPORT_FAILED',
  );
});

test('the JSON kernel rejects a payload that is not an entity graph', async () => {
  const registry = createBimKernelRegistry();
  registry.register(createJsonBimKernel());
  const bytes = new TextEncoder().encode('{"hello":"world"}');
  await assert.rejects(
    () => importClusterFromBim({ registry, bytes }),
    (error: unknown) => error instanceof BimKernelError && error.code === 'BIM_IMPORT_FAILED',
  );
});
