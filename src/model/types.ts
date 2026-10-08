import type { FlowResult, Ratios } from '../compute';
import type { Stats } from '../cost';
import type { PathGeometry, Rect, SourceFlowId } from '../layout';
import type { ActionConfig, AnimationToggles } from '../types';

export type NodeKind = 'solar' | 'grid' | 'battery' | 'home' | 'device';

export const UNTRACKED_ID = 'device:untracked';

/** Card-internal action: expands or collapses a device group. */
export const TOGGLE_GROUP = 'toggle-group';

export interface NodeActions {
  entity?: string;
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
}

export interface MixSegment {
  color: string;
  fraction: number;
}

export interface NodeModel {
  id: string;
  kind: NodeKind;
  name: string;
  icon: string;
  color: string;
  /** Displayed power (W, absolute value), `null` when unavailable. */
  watts: number | null;
  available: boolean;
  visible: boolean;
  active: boolean;
  /** State label (Exporting, Charging…). */
  status?: string;
  secondary?: string;
  soc?: number | null;
  /** Home source mix, for the ring. */
  mix?: MixSegment[];
  /** Device group: expanded state and number of members. */
  group?: { expanded: boolean; count: number };
  /** Group the device belongs to. */
  parent?: string;
  actions: NodeActions;
}

export interface FlowModel {
  id: string;
  from: string;
  to: string;
  watts: number;
  /** Normalized intensity (0..1). */
  intensity: number;
  active: boolean;
  /** Show the dimmed path when the flow is zero. */
  idle: boolean;
  colorFrom: string;
  colorTo: string;
  toggles: Required<AnimationToggles>;
  source: SourceFlowId | null;
  /** Custom path (distribution bus in grid mode). */
  geometry?: (rects: Record<string, Rect>) => PathGeometry | null;
}

export interface CardModel {
  nodes: NodeModel[];
  flows: FlowModel[];
  ratios: Ratios | null;
  /** Live cost and carbon, `null` when not configured. */
  stats: Stats | null;
  result: FlowResult;
  devicesOrder: string[];
}
