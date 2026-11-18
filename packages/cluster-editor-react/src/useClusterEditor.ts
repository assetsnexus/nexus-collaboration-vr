/**
 * The React hook.
 *
 * A thin wrapper over the pure reducer: the hook owns React state, the reducer
 * owns the editing rules. A host that prefers its own store can use the reducer
 * directly.
 */
import { useCallback, useReducer } from 'react';
import type { ClusterModel } from '@nexus/cluster-editor-core';
import {
  clusterEditorReducer,
  initialEditorState,
  type ClusterEditorAction,
  type ClusterEditorState,
} from './editor-reducer.ts';

export type ClusterEditor = {
  model: ClusterModel;
  canUndo: boolean;
  canRedo: boolean;
  dispatch: (action: ClusterEditorAction) => void;
  undo: () => void;
  redo: () => void;
};

export function useClusterEditor(initial: ClusterModel): ClusterEditor {
  const [state, dispatch] = useReducer(
    clusterEditorReducer,
    initial,
    (model): ClusterEditorState => initialEditorState(model),
  );

  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);

  return {
    model: state.model,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    dispatch,
    undo,
    redo,
  };
}
