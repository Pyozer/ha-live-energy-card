import { describe, expect, it } from 'vitest';
import {
  configFromEnergyPrefs,
  fetchEnergyPrefs,
  guessConfig,
  importedCount,
  mergeEnergyImport,
  type EnergyPrefs,
} from '../src/energy';
import type { HomeAssistant } from '../src/types';

/** Shape returned by `energy/get_prefs`, with legacy grid entries (one per tariff). */
const prefs: EnergyPrefs = {
  energy_sources: [
    { type: 'gas', stat_energy_from: 'sensor.boiler_gas' },
    { type: 'solar', stat_energy_from: 'sensor.solar_energy', stat_rate: 'sensor.solar_power' },
    { type: 'grid', stat_energy_from: 'sensor.peak_index', stat_energy_to: null },
    {
      type: 'grid',
      stat_energy_from: null,
      stat_energy_to: 'sensor.returned',
      power_config: { stat_rate: 'sensor.grid_power' },
      stat_rate: 'sensor.grid_power',
    },
    {
      type: 'battery',
      name: 'Water heater',
      stat_energy_from: 'sensor.wh_out',
      stat_energy_to: 'sensor.wh_in',
    },
  ],
  device_consumption: [
    { stat_consumption: 'sensor.fridge_energy', name: 'Fridge', stat_rate: 'sensor.fridge_power' },
    { stat_consumption: 'sensor.office_energy', stat_rate: 'sensor.office_power' },
    {
      stat_consumption: 'sensor.pc_energy',
      stat_rate: 'sensor.pc_power',
      included_in_stat: 'sensor.office_energy',
    },
    { stat_consumption: 'sensor.old_energy' },
  ],
};

describe('Energy dashboard import', () => {
  it('maps sources and devices to their power sensors', () => {
    const imported = configFromEnergyPrefs(prefs);
    expect(imported.solar).toEqual({ entity: 'sensor.solar_power' });
    expect(imported.grid).toEqual({ entity: 'sensor.grid_power' });
    // No power sensor for the battery: skipped.
    expect(imported.battery).toBeUndefined();
    expect(imported.devices).toEqual([
      { entity: 'sensor.fridge_power', name: 'Fridge' },
      { entity: 'sensor.office_power' },
      { entity: 'sensor.pc_power', exclude_from_untracked: true },
    ]);
    expect(importedCount(imported)).toBe(5);
  });

  it('power_config variants: inverted and split sensors', () => {
    const imported = configFromEnergyPrefs({
      energy_sources: [
        { type: 'grid', power_config: { stat_rate_from: 'sensor.import', stat_rate_to: 'sensor.export' } },
        { type: 'battery', power_config: { stat_rate_inverted: 'sensor.bat' }, stat_soc: 'sensor.soc' },
      ],
    });
    expect(imported.grid).toEqual({ import_entity: 'sensor.import', export_entity: 'sensor.export' });
    expect(imported.battery).toEqual({ entity: 'sensor.bat', invert: true, soc_entity: 'sensor.soc' });
  });

  it('several solar arrays and batteries are added up', () => {
    const imported = configFromEnergyPrefs({
      energy_sources: [
        { type: 'solar', stat_rate: 'sensor.roof' },
        { type: 'solar', stat_rate: 'sensor.garage' },
        { type: 'grid', power_config: { stat_rate: 'sensor.grid' } },
        { type: 'grid', power_config: { stat_rate: 'sensor.grid' } },
        { type: 'battery', stat_rate: 'sensor.bat1', stat_soc: 'sensor.soc1' },
        { type: 'battery', stat_rate: 'sensor.bat2', stat_soc: 'sensor.soc2' },
      ],
    });
    expect(imported.solar).toEqual({ entity: ['sensor.roof', 'sensor.garage'] });
    // Same sensor on two tariff entries: imported once.
    expect(imported.grid).toEqual({ entity: 'sensor.grid' });
    expect(imported.battery).toEqual({
      entity: ['sensor.bat1', 'sensor.bat2'],
      soc_entity: ['sensor.soc1', 'sensor.soc2'],
    });
  });

  it('empty dashboard: nothing imported', () => {
    expect(importedCount(configFromEnergyPrefs({}))).toBe(0);
  });

  it('merge: sources replaced, display options kept, new devices appended', () => {
    const merged = mergeEnergyImport(
      {
        type: 'custom:live-energy-card',
        title: 'Energy',
        grid: { import_entity: 'sensor.old_import', name: 'Linky', color: 'blue' },
        devices: [{ entity: 'sensor.fridge_power', name: 'My fridge' }],
      },
      configFromEnergyPrefs(prefs),
    );
    expect(merged.title).toBe('Energy');
    expect(merged.grid).toEqual({ entity: 'sensor.grid_power', name: 'Linky', color: 'blue' });
    expect(merged.devices?.map((d) => d.entity)).toEqual([
      'sensor.fridge_power',
      'sensor.office_power',
      'sensor.pc_power',
    ]);
    expect(merged.devices?.[0].name).toBe('My fridge');
  });

  it('fetch: null without websocket access or on error', async () => {
    expect(await fetchEnergyPrefs(undefined)).toBeNull();
    const failing = { states: {}, callWS: () => Promise.reject(new Error('not configured')) };
    expect(await fetchEnergyPrefs(failing as unknown as HomeAssistant)).toBeNull();
    const ok = { states: {}, callWS: <T>() => Promise.resolve(prefs as T) };
    expect(await fetchEnergyPrefs(ok as HomeAssistant)).toBe(prefs);
  });

  it('guess fallback: power sensors recognized by name', () => {
    const st = (entity_id: string) => ({ entity_id, state: '1', attributes: { unit_of_measurement: 'W' } });
    const hass = {
      states: Object.fromEntries(
        ['sensor.solar_power', 'sensor.linky_power', 'sensor.prise_tv'].map((id) => [id, st(id)]),
      ),
    };
    expect(guessConfig(hass)).toEqual({
      solar: { entity: 'sensor.solar_power' },
      grid: { entity: 'sensor.linky_power' },
      devices: [{ entity: 'sensor.prise_tv' }],
    });
  });
});
