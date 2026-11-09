import type { FlowResult, Ratios } from '../compute';
import type { Stats } from '../cost';
import type { PathGeometry, Rect, SourceFlowId } from '../layout';
import type { UnitGroup } from '../source-units';
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
  /** Displayed power (W), `null` when unavailable. Absolute, except the grid: negative when exporting. */
  watts: number | null;
  available: boolean;
  visible: boolean;
  active: boolean;
  /** State label (Exporting, Charging…). */
  status?: string;
  secondary?: string;
  soc?: number | null;
  /**
   * Solar bubble with a known maximum power: the share of it produced (0 to 1), `null` when
   * unavailable. Drives the ring, like the charge of a battery.
   */
  powerRatio?: number | null;
  /** Above a configured limit (grid import over `max_import`). */
  alert?: boolean;
  /** Home source mix, for the ring. */
  mix?: MixSegment[];
  /** Device group: expanded state and number of members. */
  group?: { expanded: boolean; count: number };
  /** Group the device belongs to. */
  parent?: string;
  /** Source node shown unit by unit: this node is one of its units. */
  unit?: UnitGroup;
  /**
   * Source node shown unit by unit: this node is where its units meet. It is not drawn, the flows
   * to the home, the grid and the other source start from it.
   */
  hub?: boolean;
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
  /** Flow between a unit and the hub of the source node it belongs to. */
  feeds?: UnitGroup;
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
