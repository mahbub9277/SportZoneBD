/**
 * The shared presentation of the admin charts.
 *
 * One place defines how an axis, a grid, a tooltip and a legend look, so the revenue bars, the signup
 * line and any later chart read as one system on both themes. The values are the app's own theme
 * tokens — the same ones the cards use — rather than literals, and nothing here blurs, glows or
 * animates: a pair of charts on a slow admin connection should cost a paint, not a compositor layer.
 */
export const CHART_GRID_PROPS = {
  strokeDasharray: '3 3',
  stroke: 'var(--border)',
  vertical: false,
} as const

export const CHART_AXIS_PROPS = {
  fontSize: 12,
  tickLine: false,
  axisLine: false,
  stroke: 'var(--text-muted)',
} as const

export const CHART_TOOLTIP_PROPS = {
  cursor: { fill: 'var(--accent)', fillOpacity: 0.07 },
  contentStyle: {
    background: 'var(--surface-strong)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    fontSize: '12px',
    padding: '8px 12px',
  },
  labelStyle: { color: 'var(--text-muted)', fontWeight: 600 },
  itemStyle: { color: 'var(--text-primary)' },
} as const

export const CHART_LEGEND_PROPS = {
  wrapperStyle: { color: 'var(--text-muted)', paddingTop: '16px', fontSize: '12px' },
  iconType: 'circle',
  iconSize: 8,
} as const

/** Charts share one plot inset, so the two tabs never disagree about where the plot area starts. */
export const CHART_MARGIN = { top: 16, right: 8, left: -12, bottom: 0 } as const
export const CHART_HEIGHT = 320

export type ChartState = 'loading' | 'error' | 'empty' | 'ready'

