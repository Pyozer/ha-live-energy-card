import { describe, expect, it } from 'vitest';
import { computeFlows } from '../src/compute';
import { modelContext } from '../src/model/context';
import { buildDevices } from '../src/model/devices';
import { sourceFlows } from '../src/model/flows';
import { readSources, sourceColors, sourceNodes } from '../src/model/sources';
import { UNTRACKED_ID } from '../src/model/types';
import type { HassEntity, HomeAssistant, LiveEnergyCardConfig } from '../src/types';

const state = (id: string, value: string | number, unit = 'W'): HassEntity => ({
  entity_id: id,
  state: String(value),
  attributes: { unit_of_measurement: unit },
});

const hassWith = (...states: HassEntity[]): HomeAssistant => ({
  states: Object.fromEntries(states.map((s) => [s.entity_id, s])),
  language: 'en',
});

const cfg = (c: Omit<LiveEnergyCardConfig, 'type'>): LiveEnergyCardConfig => ({ type: 'x', ...c });

describe('readSources', () => {
  it('splits a signed grid entity into import and export', () => {
    const src = readSources(cfg({ grid: { entity: 'sensor.g' } }), hassWith(state('sensor.g', -1.5, 'kW')));
    expect(src.inputs.gridImport).toBe(0);
    expect(src.inputs.gridExport).toBe(1500);
    expect(src.gridAvailable).toBe(true);
  });

  it('reads separate charge and discharge entities', () => {
    const src = readSources(
      cfg({ battery: { charge_entity: 'sensor.c', discharge_entity: 'sensor.d' } }),
      hassWith(state('sensor.c', 300), state('sensor.d', 0)),
    );
    expect(src.inputs.batteryCharge).toBe(300);
    expect(src.inputs.batteryDischarge).toBe(0);
  });

  it('leaves out a node without entities and flags an unavailable one', () => {
    const src = readSources(
      cfg({ solar: { name: 'Roof' }, grid: { entity: 'sensor.g' } }),
      hassWith(state('sensor.g', 'unavailable')),
    );
    expect(src.solar).toBeUndefined();
    expect(src.gridAvailable).toBe(false);
  });
});

describe('buildDevices', () => {
  const hass = hassWith(state('sensor.a', 100), state('sensor.b', 400), state('sensor.c', 50));

  it('subtracts tracked devices from the home, except excluded ones', () => {
    const config = cfg({
      show_untracked: true,
      devices: [{ entity: 'sensor.a' }, { entity: 'sensor.b', exclude_from_untracked: true }],
    });
    const { nodes, order } = buildDevices(modelContext(config, hass), 1000, new Set(), []);
    expect(nodes.find((n) => n.id === UNTRACKED_ID)?.watts).toBe(900);
    expect(order).toEqual(['device:0', 'device:1', UNTRACKED_ID]);
  });

  it('keeps group members after their group when sorting', () => {
    const config = cfg({
      sort_devices: true,
      devices: [
        { entity: 'sensor.c' },
        { name: 'G', devices: [{ entity: 'sensor.a' }, { entity: 'sensor.b' }] },
      ],
    });
    const { nodes, order } = buildDevices(modelContext(config, hass), 0, new Set(), []);
    expect(order).toEqual(['device:1', 'device:1:0', 'device:1:1', 'device:0']);
    expect(nodes.find((n) => n.id === 'device:1')?.watts).toBe(500);
  });
});

describe('sourceFlows', () => {
  it('only creates flows whose two ends are configured', () => {
    const config = cfg({ solar: { entity: 'sensor.s' } });
    const hass = hassWith(state('sensor.s', 800));
    const src = readSources(config, hass);
    const result = computeFlows(src.inputs);
    const flows = sourceFlows(config, src, result.flows, sourceColors(src), new Set(['solar', 'home']));
    expect(flows.map((f) => f.id)).toEqual(['solar_home']);
    expect(flows[0].active).toBe(true);
  });
});

describe('grid import alert', () => {
  const grid = (watts: number | string, max_import?: number) => {
    const config = cfg({ grid: { entity: 'sensor.g', max_import } });
    const hass = hassWith(state('sensor.g', watts));
    const src = readSources(config, hass);
    const result = computeFlows(src.inputs);
    return sourceNodes(modelContext(config, hass), src, result, sourceColors(src)).find(
      (n) => n.id === 'grid',
    )!;
  };

  it('turns on at the import limit, with its own status', () => {
    expect(grid(2999, 3000).alert).toBe(false);
    const over = grid(3000, 3000);
    expect(over.alert).toBe(true);
    expect(over.status).toBe('Over limit');
  });

  it('stays off without a limit, when exporting or when unavailable', () => {
    expect(grid(9000).alert).toBe(false);
    expect(grid(-5000, 3000).alert).toBe(false);
    expect(grid('unavailable', 3000).alert).toBe(false);
  });
});
