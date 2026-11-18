/**
 * Cluster editor state, as a pure reducer.
 *
 * The React hook is a thin wrapper over this, so the editing rules — including
 * undo and redo — are testable without a DOM. Every mutation goes through
 * `diffClusterModel`, so undo is exact and the history is a list of patches
 * rather than full model snapshots.
 */
import {
  applyClusterPatch,
  diffClusterModel,
  invertPatch,
  type ClusterAsset,
  type ClusterMaterial,
  type ClusterModel,
  type ClusterPatch,
  type ClusterSurface,
} from '@nexus/cluster-editor-core';

/** How many undo steps to keep. A patch is small; 100 is generous and bounded. */
export const MAX_HISTORY = 100;

export type ClusterEditorState = {
  model: ClusterModel;
  past: ClusterPatch[];
  future: ClusterPatch[];
};

export type ClusterEditorAction =
  | { type: 'replace'; model: ClusterModel }
  | { type: 'addAsset'; asset: ClusterAsset }
  | { type: 'updateAsset'; id: string; changes: Partial<ClusterAsset> }
  | { type: 'removeAsset'; id: string }
  | { type: 'addMaterial'; material: ClusterMaterial }
  | { type: 'paintSurface'; surface: ClusterSurface }
  | { type: 'undo' }
  | { type: 'redo' };

export function initialEditorState(model: ClusterModel): ClusterEditorState {
  return { model, past: [], future: [] };
}

function withHistory(state: ClusterEditorState, next: ClusterModel): ClusterEditorState {
  const patch = diffClusterModel(state.model, next);
  if (Object.keys(patch.changes).length === 0 && !patch.replaced) return state;
  const past = [...state.past, patch].slice(-MAX_HISTORY);
  return { model: next, past, future: [] };
}

function upsertAsset(model: ClusterModel, asset: ClusterAsset): ClusterModel {
  const exists = model.assets.some((entry) => entry.id === asset.id);
  return {
    ...model,
    assets: exists
      ? model.assets.map((entry) => (entry.id === asset.id ? asset : entry))
      : [...model.assets, asset],
  };
}

export function clusterEditorReducer(
  state: ClusterEditorState,
  action: ClusterEditorAction,
): ClusterEditorState {
  switch (action.type) {
    case 'replace':
      return withHistory(state, action.model);

    case 'addAsset':
      return withHistory(state, upsertAsset(state.model, action.asset));

    case 'updateAsset': {
      const existing = state.model.assets.find((entry) => entry.id === action.id);
      if (!existing) return state;
      return withHistory(state, upsertAsset(state.model, { ...existing, ...action.changes }));
    }

    case 'removeAsset': {
      if (!state.model.assets.some((entry) => entry.id === action.id)) return state;
      return withHistory(state, {
        ...state.model,
        assets: state.model.assets.filter((entry) => entry.id !== action.id),
      });
    }

    case 'addMaterial': {
      const materials = state.model.materials ?? [];
      const exists = materials.some((entry) => entry.id === action.material.id);
      return withHistory(state, {
        ...state.model,
        materials: exists
          ? materials.map((entry) => (entry.id === action.material.id ? action.material : entry))
          : [...materials, action.material],
      });
    }

    case 'paintSurface': {
      const surfaces = state.model.surfaces ?? [];
      const exists = surfaces.some((entry) => entry.id === action.surface.id);
      return withHistory(state, {
        ...state.model,
        surfaces: exists
          ? surfaces.map((entry) => (entry.id === action.surface.id ? action.surface : entry))
          : [...surfaces, action.surface],
      });
    }

    case 'undo': {
      const patch = state.past[state.past.length - 1];
      if (!patch) return state;
      return {
        model: applyClusterPatch(state.model, invertPatch(patch)),
        past: state.past.slice(0, -1),
        future: [patch, ...state.future].slice(0, MAX_HISTORY),
      };
    }

    case 'redo': {
      const patch = state.future[0];
      if (!patch) return state;
      return {
        model: applyClusterPatch(state.model, patch),
        past: [...state.past, patch].slice(-MAX_HISTORY),
        future: state.future.slice(1),
      };
    }

    default:
      return state;
  }
}
