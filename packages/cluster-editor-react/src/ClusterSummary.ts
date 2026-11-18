/**
 * A small read-only summary of a cluster.
 *
 * This is the binding's proof of life, not the editor: it renders counts and the
 * derived product quantities from the shared core, so a host can drop it in
 * before the 3D view exists. The 3D editor is a later binding over the same
 * model and the same reducer.
 *
 * Written with `createElement` rather than JSX so the package needs no JSX
 * transform to build or test. A consumer still renders it as `<ClusterSummary />`.
 */
import { createElement } from 'react';
import { computeProductQuantities, type ClusterModel } from '@nexus/cluster-editor-core';

export type ClusterSummaryProps = {
  model: ClusterModel;
  /** Optional class name for the host's layout. */
  className?: string;
};

export function ClusterSummary({ model, className }: ClusterSummaryProps) {
  const quantities = computeProductQuantities(model);
  const counts = [
    { label: 'Buildings', value: model.buildings.length },
    { label: 'Storeys', value: model.storeys.length },
    { label: 'Zones', value: model.zones.length },
    { label: 'Assets', value: model.assets.length },
    { label: 'Materials', value: (model.materials ?? []).length },
    { label: 'Surfaces', value: (model.surfaces ?? []).length },
  ];

  return createElement(
    'section',
    { className, 'data-testid': 'cluster-summary' },
    createElement('h3', null, model.name),
    createElement(
      'ul',
      null,
      counts.map((entry) =>
        createElement(
          'li',
          { key: entry.label, 'data-testid': `cluster-count-${entry.label.toLowerCase()}` },
          `${entry.label}: ${entry.value}`,
        ),
      ),
    ),
    quantities.length
      ? createElement(
          'table',
          { 'data-testid': 'cluster-quantities' },
          createElement(
            'thead',
            null,
            createElement(
              'tr',
              null,
              createElement('th', null, 'Product'),
              createElement('th', null, 'Units'),
            ),
          ),
          createElement(
            'tbody',
            null,
            quantities.map((row) =>
              createElement(
                'tr',
                { key: row.productId, 'data-testid': `cluster-quantity-${row.productId}` },
                createElement('td', null, row.productId),
                createElement('td', null, `${row.units} ${row.unit}`),
              ),
            ),
          ),
        )
      : null,
  );
}
