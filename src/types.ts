export interface ActionConfig {
  action: string;
  [key: string]: unknown;
}

/** Effets visuels liés à l'intensité d'un flux, activables séparément. */
export interface AnimationToggles {
  speed?: boolean;
  thickness?: boolean;
  density?: boolean;
  glow?: boolean;
}

export interface BaseNodeConfig {
  entity?: string;
  name?: string;
  icon?: string;
  /** Nom de couleur Home Assistant (amber, teal…) ou couleur CSS (#ffb300, rgb(), var()). */
  color?: string;
  hide_when_zero?: boolean;
  /** Inverse le signe de l'entité. */
  invert?: boolean;
  /** Entité affichée en complément (ex. énergie du jour). */
  secondary_entity?: string;
  animation?: AnimationToggles;
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
}

export type SolarConfig = BaseNodeConfig;

export interface GridConfig extends BaseNodeConfig {
  /** Alternative à `entity` (signée) : deux entités positives séparées. */
  import_entity?: string;
  export_entity?: string;
  export_color?: string;
}

export interface BatteryConfig extends BaseNodeConfig {
  charge_entity?: string;
  discharge_entity?: string;
  /** Niveau de charge en %. */
  soc_entity?: string;
  charge_color?: string;
}

export type HomeConfig = BaseNodeConfig;

export interface DeviceConfig extends BaseNodeConfig {
  entity: string;
}

export type PowerCurve = 'linear' | 'sqrt' | 'log';
export type InactiveFlows = 'hide' | 'dim';

export interface PowerFlowCardConfig {
  type: string;
  title?: string;
  min_power?: number;
  max_power?: number;
  threshold_w?: number;
  power_curve?: PowerCurve;
  animation?: AnimationToggles;
  hide_when_zero?: boolean;
  inactive_flows?: InactiveFlows;
  sort_devices?: boolean;
  /** Disposition des appareils : une colonne, une grille, ou automatique selon la place. */
  devices_layout?: 'auto' | 'column' | 'grid';
  /** Nombre de colonnes en mode grille (automatique si absent). */
  devices_columns?: number;
  show_untracked?: boolean;
  show_ratios?: boolean;
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
  callService?: (...args: unknown[]) => unknown;
}
