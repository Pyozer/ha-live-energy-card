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

/**
 * What a bubble shows and does. It is set on the node when it is shown as a single bubble, and on
 * each unit when a source is shown one bubble per unit (`separate`).
 */
export interface BubbleConfig {
  name?: string;
  icon?: string;
  /** Home Assistant color name (amber, teal…) or CSS color (#ffb300, rgb(), var()). */
  color?: string;
  hide_when_zero?: boolean;
  /** Additional entity shown in the bubble (e.g. today's energy). */
  secondary_entity?: string;
  animation?: AnimationToggles;
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
}

export interface BaseNodeConfig extends BubbleConfig {
  entity?: EntityRef;
  /** Inverts the entity's sign. */
  invert?: boolean;
  /**
   * Cumulative energy counter(s) in kWh, as used by the Energy dashboard: the node shows today's
   * energy from the statistics (unless `secondary_entity` is set).
   */
  energy_entity?: EntityRef;
}

/**
 * One unit of the solar source (an inverter, a string of panels…): what it reads, and, when the
 * source is `separate`, its own bubble.
 */
export interface SolarUnitConfig extends BubbleConfig {
  entity?: string;
  invert?: boolean;
  /** Cumulative energy counter in kWh (today's energy of the unit). */
  energy_entity?: string;
}

/**
 * The solar source is made of one or several units, which a single bubble adds up. With `separate`,
 * each unit has its own bubble instead (set on the unit), and the source itself is not drawn: its
 * flows start where the units meet. The bubble options of the source are those of the single bubble.
 */
export interface SolarConfig extends BubbleConfig {
  separate?: boolean;
  units?: SolarUnitConfig[];
}

export interface GridConfig extends BaseNodeConfig {
  /** Alternative to the signed `entity`: two separate positive entities. */
  import_entity?: EntityRef;
  export_entity?: EntityRef;
  export_color?: string;
  /** Energy counter(s) in kWh of the energy sent to the grid, for the daily cost (`cost.period: day`). */
  export_energy_entity?: EntityRef;
  /** Import limit in W (e.g. the subscribed power): above it, the grid node turns to the alert color. */
  max_import?: number;
}

/** One unit of the battery source (a battery pack): like a solar unit, with a charge level. */
export interface BatteryUnitConfig extends BubbleConfig {
  /** Signed power (positive = discharge), or `charge_entity` and `discharge_entity`. */
  entity?: string;
  charge_entity?: string;
  discharge_entity?: string;
  invert?: boolean;
  /** State of charge in %. */
  soc_entity?: string;
  /** Cumulative energy counter in kWh (today's energy of the unit). */
  energy_entity?: string;
  charge_color?: string;
  /** Usable capacity in kWh: with `soc_entity`, shows the time to full or to the reserve. */
  capacity?: number;
  /** Reserve kept by the battery (%), the discharge estimate stops there. */
  min_soc?: number;
}

/** The battery source: one or several units, like the solar source. */
export interface BatteryConfig extends BubbleConfig {
  separate?: boolean;
  charge_color?: string;
  units?: BatteryUnitConfig[];
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
  /**
   * Ready-made cost of the grid import (replaces the price): a rate (€/h) in `hour` mode, a cost in
   * € for the day in `day` mode (cumulative or reset daily). For tariffs computed elsewhere.
   */
  cost_entity?: string;
  /** Ready-made earnings of the grid export, same units as `cost_entity`. */
  earnings_entity?: string;
  /**
   * Ready-made solar savings (the cost avoided by consuming the solar production on site), instead of
   * computing them from the import price: a rate (€/h) in `hour` mode, an amount in € for the day in
   * `day` mode (cumulative or reset daily). Independent of the import cost.
   */
  savings_entity?: string;
  /**
   * `hour` (default): live rate per hour from the current power. `day`: total of the day from
   * today's energy counters (grid import and export, solar production).
   */
  period?: 'hour' | 'day';
  /** Actions of the cost (or earnings) indicator. */
  cost_actions?: StatActionsConfig;
  /** Actions of the solar savings indicator. */
  savings_actions?: StatActionsConfig;
  /** ISO code (EUR) or symbol. Defaults to the price entity's unit, then the Home Assistant currency. */
  currency?: string;
}

/** What tapping an indicator does. More-info of its entity by default, when it has one. */
export interface StatActionsConfig {
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
}

export interface CarbonConfig {
  /** Carbon intensity of the grid (gCO2eq/kWh), e.g. from the Electricity Maps integration. */
  intensity_entity?: string;
  /** Actions of the grid CO₂ indicator. */
  actions?: StatActionsConfig;
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
