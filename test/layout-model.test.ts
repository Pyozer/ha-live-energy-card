import { describe, expect, it } from 'vitest';
import { computeLayout, type Layout, type Rect } from '../src/layout';
import { applyDeviceTree, buildModel, cleanName, sortWithHysteresis, UNTRACKED_ID } from '../src/model';
import { buildDeviceTree } from '../src/tree';
import { validateConfig } from '../src/config';
import type { HassEntity, HomeAssistant, PowerFlowCardConfig } from '../src/types';

const overlaps = (a: Rect, b: Rect, margin = 0) =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 + margin && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + margin;

function assertNoOverlap(layout: Layout) {
  const entries = Object.entries(layout.nodes);
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      expect(overlaps(entries[i][1], entries[j][1]), `${entries[i][0]} / ${entries[j][0]}`).toBe(false);
    }
  }
  for (const [id, r] of entries) {
    expect(r.x - r.w / 2, id).toBeGreaterThanOrEqual(-0.5);
    expect(r.x + r.w / 2, id).toBeLessThanOrEqual(layout.width + 0.5);
    expect(r.y - r.h / 2, id).toBeGreaterThanOrEqual(-0.5);
    expect(r.y + r.h / 2, id).toBeLessThanOrEqual(layout.height + 0.5);
  }
}

const devices = (n: number) => Array.from({ length: n }, (_, i) => `device:${i}`);

describe('computeLayout', () => {
  for (const width of [320, 380, 520, 700, 1000, 1400]) {
    for (const n of [0, 1, 4, 13]) {
      it(`no overlap (${width}px, ${n} devices)`, () => {
        assertNoOverlap(
          computeLayout({ width, solar: true, grid: true, battery: true, devices: devices(n) }),
        );
      });
    }
  }

  it('optional sources: the layout rearranges', () => {
    const layout = computeLayout({
      width: 700,
      solar: false,
      grid: true,
      battery: false,
      devices: devices(2),
    });
    expect(layout.nodes.solar).toBeUndefined();
    expect(layout.nodes.battery).toBeUndefined();
    expect(layout.nodes.grid.y).toBeCloseTo(layout.nodes.home.y);
    assertNoOverlap(layout);
  });

  it('many devices: switches to grid', () => {
    const layout = computeLayout({
      width: 900,
      solar: true,
      grid: true,
      battery: true,
      devices: devices(13),
    });
    expect(layout.devices.mode).toBe('grid');
    expect(layout.devices.columns.length).toBeGreaterThan(1);
    expect(layout.devices.columns.flat()).toHaveLength(13);
  });

  it('narrow screen: devices below the diagram', () => {
    const layout = computeLayout({ width: 340, solar: true, grid: true, battery: true, devices: devices(6) });
    expect(layout.devices.mode).toBe('stack');
    const lowest = Math.max(layout.nodes.home.y, layout.nodes.battery.y);
    for (const id of devices(6)) expect(layout.nodes[id].y).toBeGreaterThan(lowest);
  });

  it('forced column arrangement', () => {
    const layout = computeLayout({
      width: 900,
      solar: true,
      grid: true,
      battery: true,
      devices: devices(13),
      devicesLayout: 'column',
    });
    expect(layout.devices.mode).toBe('column');
  });

  it('each grid device has an end segment', () => {
    const layout = computeLayout({
      width: 900,
      solar: true,
      grid: true,
      battery: true,
      devices: devices(13),
    });
    const edges = buildDeviceTree(layout.devices);
    for (const id of devices(13)) {
      const leaf = edges.find((e) => e.leaf === id);
      expect(leaf).toBeDefined();
      expect(leaf!.geometry(layout.nodes)?.d).toMatch(/^M/);
    }
  });

  it('narrow screen: the bus turns into the first column with a rounded corner', () => {
    for (const n of [1, 6]) {
      const layout = computeLayout({
        width: 340,
        solar: true,
        grid: true,
        battery: true,
        devices: devices(n),
      });
      expect(layout.devices.mode).toBe('stack');
      const edges = buildDeviceTree(layout.devices);
      const end = edges.find((e) => e.id === 'tree:spine:0') ?? edges.find((e) => e.id === 'tree:trunk')!;
      expect(end.geometry(layout.nodes)?.d).toMatch(/Q[\d.,-]+ [\d.,-]+$/);
    }
  });
});

const state = (id: string, value: string | number, unit = 'W'): HassEntity => ({
  entity_id: id,
  state: String(value),
  attributes: { unit_of_measurement: unit, friendly_name: `${id} Puissance` },
});

const hassWith = (states: HassEntity[]): HomeAssistant => ({
  states: Object.fromEntries(states.map((s) => [s.entity_id, s])),
  language: 'fr',
  locale: { language: 'fr' },
});

describe('buildModel', () => {
  const config: PowerFlowCardConfig = {
    type: 'custom:powerflow-card',
    solar: { entity: 'sensor.solar' },
    grid: { entity: 'sensor.grid' },
    devices: [
      { entity: 'sensor.frigo' },
      { entity: 'sensor.tv', hide_when_zero: false },
      { entity: 'sensor.off' },
    ],
  };

  it('hides zero nodes according to the config', () => {
    const model = buildModel(
      config,
      hassWith([
        state('sensor.solar', 0),
        state('sensor.grid', 300),
        state('sensor.frigo', 80),
        state('sensor.tv', 0),
        state('sensor.off', 0),
      ]),
    );
    const byId = Object.fromEntries(model.nodes.map((n) => [n.id, n]));
    expect(byId.solar.visible).toBe(false);
    expect(byId['device:0'].visible).toBe(true);
    expect(byId['device:1'].visible).toBe(true);
    expect(byId['device:2'].visible).toBe(false);
  });

  it('unavailable entity: node flagged without NaN', () => {
    const model = buildModel(
      config,
      hassWith([state('sensor.solar', 'unavailable'), state('sensor.grid', 'unknown')]),
    );
    const solar = model.nodes.find((n) => n.id === 'solar')!;
    expect(solar.available).toBe(false);
    expect(solar.visible).toBe(true);
    for (const f of model.flows) expect(Number.isFinite(f.watts)).toBe(true);
  });

  it('grid direction: export when the value is negative', () => {
    const model = buildModel(config, hassWith([state('sensor.solar', 3000), state('sensor.grid', -2000)]));
    const flows = Object.fromEntries(model.flows.map((f) => [f.id, f]));
    expect(flows.solar_grid.active).toBe(true);
    expect(flows.solar_grid.watts).toBe(2000);
    expect(flows.grid_home.active).toBe(false);
  });

  it('untracked consumption', () => {
    const model = buildModel(
      { ...config, show_untracked: true },
      hassWith([
        state('sensor.solar', 0),
        state('sensor.grid', 500),
        state('sensor.frigo', 100),
        state('sensor.tv', 150),
      ]),
    );
    expect(model.nodes.find((n) => n.id === UNTRACKED_ID)?.watts).toBe(250);
  });

  it('applyDeviceTree: shared segments carry the downstream sum', () => {
    const many: PowerFlowCardConfig = {
      type: 'custom:powerflow-card',
      grid: { entity: 'sensor.grid' },
      devices: Array.from({ length: 10 }, (_, i) => ({ entity: `sensor.d${i}`, hide_when_zero: false })),
    };
    const hass = hassWith([
      state('sensor.grid', 1000),
      ...Array.from({ length: 10 }, (_, i) => state(`sensor.d${i}`, 100)),
    ]);
    const model = buildModel(many, hass);
    const layout = computeLayout({
      width: 900,
      solar: false,
      grid: true,
      battery: false,
      devices: model.devicesOrder,
    });
    expect(layout.devices.mode).toBe('grid');
    const flows = applyDeviceTree(model, layout, many);
    const spine = flows.find((f) => f.id === 'tree:spine:0')!;
    expect(spine.watts).toBe(1000);
  });
});

describe('utilities', () => {
  it('cleanName strips power suffixes', () => {
    expect(cleanName('Prise frigo Puissance', 'x')).toBe('Prise frigo');
    expect(cleanName('VMC Power', 'x')).toBe('VMC');
    expect(cleanName(undefined, 'fallback')).toBe('fallback');
  });

  it('hysteresis sort: no swap for a small difference', () => {
    const prev = ['a', 'b'];
    expect(
      sortWithHysteresis(
        [
          { id: 'a', watts: 100 },
          { id: 'b', watts: 104 },
        ],
        prev,
      ),
    ).toEqual(['a', 'b']);
    expect(
      sortWithHysteresis(
        [
          { id: 'a', watts: 100 },
          { id: 'b', watts: 400 },
        ],
        prev,
      ),
    ).toEqual(['b', 'a']);
  });

  it('validateConfig', () => {
    expect(() => validateConfig({ type: 'x' })).toThrow();
    expect(() =>
      validateConfig({ type: 'x', grid: { entity: 'sensor.g' }, max_power: 0, min_power: 10 }),
    ).toThrow();
    expect(() => validateConfig({ type: 'x', grid: { entity: 'sensor.g' }, max_power: 'abc' })).toThrow();
    const ok = validateConfig({ type: 'x', grid: { entity: 'sensor.g' }, max_power: '3000' });
    expect(ok.max_power).toBe(3000);
  });
});
