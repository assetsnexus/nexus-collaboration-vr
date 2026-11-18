/**
 * Cluster diff and patch.
 *
 * The editor needs undo, and a versioned store needs to know what changed
 * without serialising the whole model. Both are the same primitive: a patch that
 * carries the before and after of every changed entity, so it can be applied
 * forward and inverted for undo.
 *
 * Pure and framework-free. Collections are compared by `id`; `geoReference` and
 * `terrain` are compared as whole objects because they are small and rarely
 * change.
 */
import type { ClusterModel } from './model.ts';

export type ClusterCollection =
  | 'buildings'
  | 'storeys'
  | 'zones'
  | 'networks'
  | 'assets'
  | 'alignments'
  | 'materials'
  | 'surfaces';

export type ClusterReplacedKey = 'name' | 'geoReference' | 'terrain';

export type ClusterCollectionChange = {
  added: Array<{ id: string; value: unknown }>;
  removed: Array<{ id: string; value: unknown }>;
  updated: Array<{ id: string; before: unknown; after: unknown }>;
};

export type ClusterPatch = {
  changes: Partial<Record<ClusterCollection, ClusterCollectionChange>>;
  replaced?: Partial<Record<ClusterReplacedKey, { before: unknown; after: unknown }>>;
};

const COLLECTIONS: readonly ClusterCollection[] = [
  'buildings',
  'storeys',
  'zones',
  'networks',
  'assets',
  'alignments',
  'materials',
  'surfaces',
];

function itemsOf(model: ClusterModel, collection: ClusterCollection): Array<{ id: string }> {
  const value = (model as unknown as Record<string, unknown>)[collection];
  return Array.isArray(value) ? (value as Array<{ id: string }>) : [];
}

function byId(items: Array<{ id: string }>): Map<string, { id: string }> {
  const map = new Map<string, { id: string }>();
  for (const item of items) map.set(item.id, item);
  return map;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function isEmptyChange(change: ClusterCollectionChange): boolean {
  return change.added.length === 0 && change.removed.length === 0 && change.updated.length === 0;
}

/**
 * The patch that turns `before` into `after`.
 *
 * An unchanged model produces an empty patch (`changes: {}`), so a caller can
 * skip a write.
 */
export function diffClusterModel(before: ClusterModel, after: ClusterModel): ClusterPatch {
  const changes: Partial<Record<ClusterCollection, ClusterCollectionChange>> = {};

  for (const collection of COLLECTIONS) {
    const beforeMap = byId(itemsOf(before, collection));
    const afterMap = byId(itemsOf(after, collection));
    const change: ClusterCollectionChange = { added: [], removed: [], updated: [] };

    for (const [id, value] of afterMap) {
      const previous = beforeMap.get(id);
      if (!previous) change.added.push({ id, value });
      else if (!same(previous, value)) change.updated.push({ id, before: previous, after: value });
    }
    for (const [id, value] of beforeMap) {
      if (!afterMap.has(id)) change.removed.push({ id, value });
    }

    if (!isEmptyChange(change)) changes[collection] = change;
  }

  const replaced: ClusterPatch['replaced'] = {};
  if (before.name !== after.name) {
    replaced.name = { before: before.name, after: after.name };
  }
  if (!same(before.geoReference, after.geoReference)) {
    replaced.geoReference = { before: before.geoReference, after: after.geoReference };
  }
  if (!same(before.terrain, after.terrain)) {
    replaced.terrain = { before: before.terrain, after: after.terrain };
  }

  return {
    changes,
    ...(Object.keys(replaced).length ? { replaced } : {}),
  };
}

/** True when the patch changes nothing. */
export function isPatchEmpty(patch: ClusterPatch): boolean {
  return Object.keys(patch.changes).length === 0 && !patch.replaced;
}

/**
 * Applies a patch, returning a new model. The input is never mutated, so a
 * caller can keep the previous version for undo without cloning first.
 */
export function applyClusterPatch(model: ClusterModel, patch: ClusterPatch): ClusterModel {
  const next = { ...model } as ClusterModel & Record<string, unknown>;

  for (const collection of COLLECTIONS) {
    const change = patch.changes[collection];
    if (!change) continue;
    const current = itemsOf(model, collection) as Array<{ id: string }>;
    const removed = new Set(change.removed.map((entry) => entry.id));
    const updated = new Map(change.updated.map((entry) => [entry.id, entry.after]));
    const kept = current
      .filter((item) => !removed.has(item.id))
      .map((item) => (updated.has(item.id) ? (updated.get(item.id) as { id: string }) : item));
    const added = change.added.map((entry) => entry.value as { id: string });
    (next as Record<string, unknown>)[collection] = [...kept, ...added];
  }

  if (patch.replaced?.name) {
    next.name = patch.replaced.name.after as string;
  }
  if (patch.replaced?.geoReference) {
    next.geoReference = patch.replaced.geoReference.after as ClusterModel['geoReference'];
  }
  if (patch.replaced?.terrain) {
    next.terrain = patch.replaced.terrain.after as ClusterModel['terrain'];
  }

  return next as ClusterModel;
}

/**
 * The inverse patch, for undo.
 *
 * Added becomes removed, removed becomes added, and every update swaps its
 * before/after. Applying the inverse to the patched model restores the original.
 */
export function invertPatch(patch: ClusterPatch): ClusterPatch {
  const changes: Partial<Record<ClusterCollection, ClusterCollectionChange>> = {};
  for (const collection of COLLECTIONS) {
    const change = patch.changes[collection];
    if (!change) continue;
    changes[collection] = {
      added: change.removed,
      removed: change.added,
      updated: change.updated.map((entry) => ({
        id: entry.id,
        before: entry.after,
        after: entry.before,
      })),
    };
  }

  const replaced: ClusterPatch['replaced'] = {};
  if (patch.replaced?.name) {
    replaced.name = { before: patch.replaced.name.after, after: patch.replaced.name.before };
  }
  if (patch.replaced?.geoReference) {
    replaced.geoReference = {
      before: patch.replaced.geoReference.after,
      after: patch.replaced.geoReference.before,
    };
  }
  if (patch.replaced?.terrain) {
    replaced.terrain = {
      before: patch.replaced.terrain.after,
      after: patch.replaced.terrain.before,
    };
  }

  return {
    changes,
    ...(Object.keys(replaced).length ? { replaced } : {}),
  };
}
