import type { LocalizeKey } from '../localize/localize';
import { groupCount } from '../model';
import type { BatteryConfig, HomeAssistant, LiveEnergyCardConfig, SolarConfig } from '../types';
import { entityIds } from '../units';
import type { Translate } from './schema';
import { unitsOf } from './unit-list';
import type { EditorSection } from './validation';

/** Group of uniform collapsible panels shown in the visual editor. */
export interface EditorGroup {
  title: LocalizeKey;
  sections: readonly { id: EditorSection; title: LocalizeKey }[];
}

/** Structure of the visual editor: sources, devices, then card settings. */
export const EDITOR_GROUPS: readonly EditorGroup[] = [
  {
    title: 'editor.group_sources',
    sections: [
      { id: 'solar', title: 'node.solar' },
      { id: 'grid', title: 'node.grid' },
      { id: 'battery', title: 'node.battery' },
      { id: 'home', title: 'node.home' },
    ],
  },
  {
    title: 'editor.group_devices',
    sections: [{ id: 'devices', title: 'editor.devices_panel' }],
  },
  {
    title: 'editor.group_settings',
    sections: [
      { id: 'display', title: 'editor.display' },
      { id: 'cost', title: 'editor.cost' },
      { id: 'carbon', title: 'editor.carbon' },
      { id: 'animation', title: 'editor.animation' },
      { id: 'advanced', title: 'editor.advanced' },
    ],
  },
];

/** Whether the "one bubble per unit" toggle should be offered for a solar or battery source. */
export function showSeparateToggle(source: SolarConfig | BatteryConfig | undefined): boolean {
  return unitsOf(source).length > 0 || Boolean(source?.separate);
}

/** Toggles a collapsible panel in the set of open panels without mutating it. */
export function toggleSection(open: ReadonlySet<EditorSection>, section: EditorSection): Set<EditorSection> {
  const next = new Set(open);
  if (next.has(section)) next.delete(section);
  else next.add(section);
  return next;
}

/** Readable label of a single entity: its friendly name when known, else its id. */
function entityLabel(hass: HomeAssistant | undefined, id: string): string {
  const friendly = hass?.states[id]?.attributes.friendly_name;
  return typeof friendly === 'string' && friendly ? friendly : id;
}

/** Short summary shown under a collapsed section header in the visual editor. */
export function sectionSummary(
  section: EditorSection,
  config: LiveEnergyCardConfig,
  hass: HomeAssistant | undefined,
  t: Translate,
): string {
  switch (section) {
    case 'solar':
    case 'battery': {
      const units = unitsOf(config[section]);
      if (units.length === 0) {
        return t(section === 'battery' ? 'editor.summary.not_configured_f' : 'editor.summary.not_configured');
      }
      const count =
        units.length === 1
          ? t(`editor.summary.unit_one_${section}`)
          : t(`editor.summary.unit_many_${section}`, { count: String(units.length) });
      return config[section]?.separate ? `${count} · ${t('editor.summary.separate')}` : count;
    }
    case 'grid': {
      const ids = [
        ...entityIds(config.grid?.entity),
        ...entityIds(config.grid?.import_entity),
        ...entityIds(config.grid?.export_entity),
      ];
      if (ids.length === 0) return t('editor.summary.not_configured');
      return ids.length === 1
        ? entityLabel(hass, ids[0])
        : t('editor.summary.sensors', { count: String(ids.length) });
    }
    case 'home': {
      const ids = entityIds(config.home?.entity);
      if (ids.length === 0) return t('editor.summary.calculated');
      return ids.length === 1
        ? entityLabel(hass, ids[0])
        : t('editor.summary.sensors', { count: String(ids.length) });
    }
    case 'devices': {
      const count = (config.devices ?? []).length;
      if (count === 0) return t('editor.summary.no_devices');
      const label = groupCount(t, count);
      return config.sort_devices ? `${label} · ${t('editor.summary.sorted')}` : label;
    }
    case 'cost': {
      const cost = config.cost;
      const active =
        cost !== undefined &&
        (typeof cost.price === 'number' ||
          typeof cost.export_price === 'number' ||
          Boolean(
            cost.price_entity ||
            cost.export_price_entity ||
            cost.cost_entity ||
            cost.earnings_entity ||
            cost.savings_entity,
          ));
      if (!active) return t('editor.summary.not_configured');
      return t(cost.period === 'day' ? 'editor.option.day' : 'editor.option.hour');
    }
    case 'carbon': {
      const id = config.carbon?.intensity_entity;
      return id ? entityLabel(hass, id) : t('editor.summary.not_configured');
    }
    case 'display':
    case 'animation':
    case 'advanced':
      return '';
  }
}
