export interface ActionConfig {
  action: string;
  [key: string]: unknown;
}

/** Visual effects tied to flow intensity, each one can be toggled. */
export interface AnimationToggles {
  speed?: boolean;
  thickness?: boolean;
  density?: boolean;
  glow?: boolean;
}

/** One entity, or several whose values are added up (several inverters, phases, batteries…). */
export type EntityRef = string | string[];

export interface BaseNodeConfig {
  entity?: EntityRef;
  name?: string;
  icon?: string;
  /** Home Assistant color name (amber, teal…) or CSS color (#ffb300, rgb(), var()). */
  color?: string;
  hide_when_zero?: boolean;
  /** Inverts the entity's sign. */
  invert?: boolean;
  /** Additional entity shown in the node (e.g. today's energy). */
  secondary_entity?: string;
  animation?: AnimationToggles;
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
}

export type SolarConfig = BaseNodeConfig;

export interface GridConfig extends BaseNodeConfig {
  /** Alternative to the signed `entity`: two separate positive entities. */
  import_entity?: EntityRef;
  export_entity?: EntityRef;
  export_color?: string;
}

export interface BatteryConfig extends BaseNodeConfig {
  charge_entity?: EntityRef;
  discharge_entity?: EntityRef;
  /** State of charge in %. Several entities are averaged. */
  soc_entity?: EntityRef;
  charge_color?: string;
}

export type HomeConfig = BaseNodeConfig;

export interface DeviceConfig extends BaseNodeConfig {
  /** Optional for a group: its power is then the sum of its members. */
  entity?: EntityRef;
  /** Members of a device group, shown when the group is expanded. */
  devices?: DeviceConfig[];
  /** Group initially expanded. */
  expanded?: boolean;
  /**
   * The device is not part of the home consumption (separate circuit, or already measured by
   * another device): it is not subtracted when computing the "Other" node.
   */
  exclude_from_untracked?: boolean;
}

/** Electricity prices, per kWh: a fixed value or an entity. */
export interface CostConfig {
  price?: number;
  price_entity?: string;
  export_price?: number;
  export_price_entity?: string;
  /** ISO code (EUR) or symbol. Defaults to the price entity's unit, then the Home Assistant currency. */
  currency?: string;
}

export interface CarbonConfig {
  /** Carbon intensity of the grid (gCO2eq/kWh), e.g. from the Electricity Maps integration. */
  intensity_entity?: string;
}

export type PowerCurve = 'linear' | 'sqrt' | 'log';
export type InactiveFlows = 'hide' | 'dim';
export type LineStyle = 'rounded' | 'square' | 'curved' | 'straight';

export interface LiveEnergyCardConfig {
  type: string;
  title?: string;
  min_power?: number;
  max_power?: number;
  threshold_w?: number;
  power_curve?: PowerCurve;
  animation?: AnimationToggles;
  hide_when_zero?: boolean;
  inactive_flows?: InactiveFlows;
  /** Shape of every flow line. */
  line_style?: LineStyle;
  /** Lighter animation for low-power devices: 30 frames per second, no glow. */
  eco_mode?: boolean;
  /** No card background, border or shadow: the diagram sits directly on the dashboard. */
  transparent?: boolean;
  sort_devices?: boolean;
  /** Device arrangement: a column, a grid, or automatic depending on available space. */
  devices_layout?: 'auto' | 'column' | 'grid';
  /** Number of columns in grid mode (automatic when missing). */
  devices_columns?: number;
  show_untracked?: boolean;
  show_ratios?: boolean;
  /** Live cost and solar savings, shown under the diagram. */
  cost?: CostConfig;
  /** Live grid emissions, shown under the diagram. */
  carbon?: CarbonConfig;
  /** Label language: `auto` (Home Assistant user language, default) or a language code. */
  language?: string;
  kilo_threshold?: number;
  decimals?: number;
  kilo_decimals?: number;
  solar?: SolarConfig;
  grid?: GridConfig;
  battery?: BatteryConfig;
  home?: HomeConfig;
  devices?: DeviceConfig[];
}

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown> & {
    friendly_name?: string;
    unit_of_measurement?: string;
    icon?: string;
  };
  last_changed?: string;
  last_updated?: string;
}

export interface HomeAssistant {
  states: Record<string, HassEntity>;
  language?: string;
  locale?: { language: string; number_format?: string };
  themes?: { darkMode?: boolean };
  config?: { currency?: string };
  callService?: (...args: unknown[]) => unknown;
  callWS?: <T>(msg: Record<string, unknown>) => Promise<T>;
}
