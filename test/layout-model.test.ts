import { describe, expect, it } from 'vitest';
import {
  computeLayout,
  deviceFlowPath,
  elbowBetween,
  sourceFlowPath,
  unitFlowPath,
  type Layout,
  type Rect,
} from '../src/layout';
import {
  applyDeviceTree,
  applyUnitPaths,
  buildModel,
  cleanName,
  sortWithHysteresis,
  TOGGLE_GROUP,
  UNTRACKED_ID,
} from '../src/model';
import { buildDeviceTree } from '../src/tree';
import { validateConfig, watchedEntities } from '../src/config';
import type { HassEntity, HomeAssistant, LiveEnergyCardConfig } from '../src/types';

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

describe('source flow paths', () => {
  const layout = computeLayout({ width: 900, solar: true, grid: true, battery: true, devices: [] });

  it('solar → home is a right angle with a rounded corner', () => {
    const geom = sourceFlowPath('solar_home', layout.nodes)!;
    expect(geom.d).toMatch(/^M[\d.,]+ L[\d.,]+ Q[\d.,]+ [\d.,]+ L[\d.,]+$/);
    // Leaves the solar node horizontally and enters the home vertically.
    expect(geom.from.y).toBeCloseTo(layout.nodes.solar.y);
    expect(geom.to.x).toBeCloseTo(layout.nodes.home.x);
  });

  it('every perpendicular source flow uses the same elbow shape', () => {
    for (const id of ['solar_grid', 'battery_home', 'battery_grid', 'grid_battery'] as const) {
      expect(sourceFlowPath(id, layout.nodes)!.d, id).toContain('Q');
    }
  });

  it('aligned nodes are joined by a straight line', () => {
    expect(sourceFlowPath('grid_home', layout.nodes)!.d).not.toMatch(/[QC]/);
    expect(sourceFlowPath('solar_battery', layout.nodes)!.d).not.toMatch(/[QC]/);
  });

  it('the corner radius never exceeds the segments', () => {
    const geom = elbowBetween({ x: 0, y: 0 }, 0, { x: 5, y: 40 }, -90, 20);
    expect(geom.d).toBe('M0,0 L0,0 Q5,0 5,5 L5,40');
  });
});

describe('line styles', () => {
  const layout = computeLayout({ width: 900, solar: true, grid: true, battery: true, devices: devices(3) });
  const solarHome = (style: Parameters<typeof sourceFlowPath>[2]) =>
    sourceFlowPath('solar_home', layout.nodes, style)!.d;

  it('each style draws the source flows with its own shape', () => {
    expect(solarHome('rounded')).toMatch(/ Q/);
    expect(solarHome('curved')).toMatch(/ C/);
    expect(solarHome('straight')).toMatch(/^M[\d.,]+ L[\d.,]+$/);
    // Square: the corner is degenerate (zero radius).
    const square = solarHome('square').match(/Q([\d.]+),([\d.]+) ([\d.]+),([\d.]+)/)!;
    expect(square[1]).toBe(square[3]);
    expect(square[2]).toBe(square[4]);
  });

  it('straight lines start on the circle edge, toward the other node', () => {
    const { solar, home } = layout.nodes;
    const geom = sourceFlowPath('solar_home', layout.nodes, 'straight')!;
    expect(Math.hypot(geom.from.x - solar.x, geom.from.y - solar.y)).toBeCloseTo(solar.w / 2 - 3);
    expect(Math.hypot(geom.to.x - home.x, geom.to.y - home.y)).toBeCloseTo(home.w / 2 - 3);
  });

  it('column devices: curves or direct lines without a bus', () => {
    const { home } = layout.nodes;
    const tile = layout.nodes['device:0'];
    expect(deviceFlowPath(home, tile, 'curved').d).toContain('C');
    expect(deviceFlowPath(home, tile, 'straight').d).not.toMatch(/[QC]/);
  });

  it('column devices: right-angle styles go through the bus', () => {
    const cfg = (line_style: LiveEnergyCardConfig['line_style']): LiveEnergyCardConfig => ({
      type: 'custom:live-energy-card',
      devices_layout: 'column',
      line_style,
      devices: [0, 1, 2].map((i) => ({ entity: `sensor.d${i}` })),
    });
    const hass = hassWith([0, 1, 2].map((i) => state(`sensor.d${i}`, 100)));
    for (const [style, bus] of [
      ['rounded', true],
      ['square', true],
      ['curved', false],
      ['straight', false],
    ] as const) {
      const model = buildModel(cfg(style), hass);
      const ids = applyDeviceTree(model, layout, cfg(style)).map((f) => f.id);
      expect(
        ids.some((id) => id.startsWith('tree:')),
        style,
      ).toBe(bus);
    }
    expect(layout.devices.above).toEqual([1]);
  });

  it('an unknown style falls back to the default', () => {
    const config = validateConfig({ type: 'x', line_style: 'zigzag', grid: { entity: 'sensor.g' } });
    expect(config.line_style).toBeUndefined();
  });
});

describe('buildModel', () => {
  const config: LiveEnergyCardConfig = {
    type: 'custom:live-energy-card',
    solar: { units: [{ entity: 'sensor.solar' }] },
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

  it('a device excluded from untracked is not subtracted from Other', () => {
    const devices = [{ entity: 'sensor.frigo' }, { entity: 'sensor.tv', exclude_from_untracked: true }];
    const model = buildModel(
      { ...config, devices, show_untracked: true },
      hassWith([
        state('sensor.solar', 0),
        state('sensor.grid', 500),
        state('sensor.frigo', 100),
        state('sensor.tv', 150),
      ]),
    );
    expect(model.nodes.find((n) => n.id === UNTRACKED_ID)?.watts).toBe(400);
    // The device itself is still displayed with its power.
    expect(model.nodes.find((n) => n.id === 'device:1')?.watts).toBe(150);
  });

  it('several entities on a node are added up', () => {
    const model = buildModel(
      {
        type: 'custom:live-energy-card',
        solar: { units: [{ entity: 'sensor.roof' }, { entity: 'sensor.garage' }] },
        grid: { entity: ['sensor.l1', 'sensor.l2', 'sensor.l3'] },
        battery: {
          units: [
            { entity: 'sensor.b1', soc_entity: 'sensor.s1' },
            { entity: 'sensor.b2', soc_entity: 'sensor.s2' },
          ],
        },
        devices: [{ entity: ['sensor.oven', 'sensor.hob'], name: 'Kitchen' }],
      },
      hassWith([
        state('sensor.roof', 1000),
        state('sensor.garage', 0.5, 'kW'),
        state('sensor.l1', 100),
        state('sensor.l2', -50),
        state('sensor.l3', 50),
        state('sensor.b1', 300),
        state('sensor.b2', -100),
        state('sensor.s1', 40, '%'),
        state('sensor.s2', 60, '%'),
        state('sensor.oven', 900),
        state('sensor.hob', 600),
      ]),
    );
    const byId = Object.fromEntries(model.nodes.map((n) => [n.id, n]));
    expect(byId.solar.watts).toBe(1500);
    expect(byId.grid.watts).toBe(100);
    expect(byId.battery.watts).toBe(200);
    expect(byId.battery.soc).toBe(50);
    expect(byId['device:0'].watts).toBe(1500);
    // More-info opens the first entity.
    expect(byId.solar.actions.entity).toBe('sensor.roof');
  });

  it('a node is unavailable when one of its entities is', () => {
    const model = buildModel(
      { type: 'x', solar: { units: [{ entity: 'sensor.roof' }, { entity: 'sensor.garage' }] } },
      hassWith([state('sensor.roof', 1000), state('sensor.garage', 'unavailable')]),
    );
    expect(model.nodes.find((n) => n.id === 'solar')?.available).toBe(false);
  });

  describe('device groups', () => {
    const groupConfig: LiveEnergyCardConfig = {
      type: 'custom:live-energy-card',
      grid: { entity: 'sensor.grid' },
      show_untracked: true,
      devices: [
        { entity: 'sensor.fridge' },
        { name: 'Kitchen', devices: [{ entity: 'sensor.oven' }, { entity: 'sensor.hob' }] },
      ],
    };
    const groupHass = hassWith([
      state('sensor.grid', 2000),
      state('sensor.fridge', 100),
      state('sensor.oven', 900),
      state('sensor.hob', 600),
    ]);

    it('collapsed: one pill with the members total, members hidden', () => {
      const model = buildModel(groupConfig, groupHass);
      const byId = Object.fromEntries(model.nodes.map((n) => [n.id, n]));
      expect(byId['device:1'].watts).toBe(1500);
      expect(byId['device:1'].group).toEqual({ expanded: false, count: 2 });
      expect(byId['device:1'].secondary).toBe('2 appareils');
      expect(byId['device:1:0'].visible).toBe(false);
      expect(model.devicesOrder).toEqual(['device:0', 'device:1', 'device:1:0', 'device:1:1', UNTRACKED_ID]);
      // Members are counted once in the untracked consumption.
      expect(byId[UNTRACKED_ID].watts).toBe(400);
      expect(model.flows.find((f) => f.id === 'flow:device:1')?.watts).toBe(1500);
    });

    it('expanded: the members carry the flows, the group only heads them', () => {
      const model = buildModel(groupConfig, groupHass, { expanded: new Set(['device:1']) });
      const byId = Object.fromEntries(model.nodes.map((n) => [n.id, n]));
      expect(byId['device:1:0'].visible).toBe(true);
      expect(byId['device:1:0'].parent).toBe('device:1');
      const flows = Object.fromEntries(model.flows.map((f) => [f.id, f]));
      expect(flows['flow:device:1'].active).toBe(false);
      expect(flows['flow:device:1:0'].watts).toBe(900);
      // The bus never counts the group and its members twice.
      const layout = computeLayout({
        width: 900,
        solar: false,
        grid: true,
        battery: false,
        devices: model.devicesOrder.filter((id) => byId[id].visible),
        devicesLayout: 'grid',
      });
      const tree = applyDeviceTree(model, layout, groupConfig);
      const trunk = tree.find((f) => f.id === 'tree:spine:0')!;
      expect(trunk.watts).toBe(100 + 900 + 600 + 400);
    });

    it('tapping a group toggles it unless an action is configured', () => {
      const model = buildModel(groupConfig, groupHass);
      expect(model.nodes.find((n) => n.id === 'device:1')?.actions.tap_action).toEqual({
        action: TOGGLE_GROUP,
      });
      const custom = buildModel(
        {
          ...groupConfig,
          devices: [
            { ...groupConfig.devices![1], tap_action: { action: 'navigate', navigation_path: '/x' } },
          ],
        },
        groupHass,
      );
      expect(custom.nodes.find((n) => n.id === 'device:0')?.actions.tap_action?.action).toBe('navigate');
    });

    it('a group with its own meter shows the meter', () => {
      const model = buildModel(
        {
          ...groupConfig,
          devices: [{ entity: 'sensor.grid', name: 'Circuit', devices: [{ entity: 'sensor.oven' }] }],
        },
        groupHass,
      );
      expect(model.nodes.find((n) => n.id === 'device:0')?.watts).toBe(2000);
    });

    it('a config made only of groups is valid and watches the members', () => {
      const config = { type: 'x', devices: [{ name: 'G', devices: [{ entity: 'sensor.a' }] }] };
      expect(() => validateConfig(config)).not.toThrow();
      expect(watchedEntities(config)).toEqual(['sensor.a']);
    });
  });

  it('applyDeviceTree: shared segments carry the downstream sum', () => {
    const many: LiveEnergyCardConfig = {
      type: 'custom:live-energy-card',
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

  it('watched entities include every entity of a list', () => {
    expect(
      watchedEntities({
        type: 'x',
        grid: { entity: ['sensor.l1', 'sensor.l2'] },
        devices: [{ entity: ['sensor.a', 'sensor.b'] }],
      }).sort(),
    ).toEqual(['sensor.a', 'sensor.b', 'sensor.l1', 'sensor.l2']);
    expect(() => validateConfig({ type: 'x', solar: { units: [] } })).toThrow();
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

describe('sources shown unit by unit', () => {
  const solarCfg: LiveEnergyCardConfig = {
    type: 'x',
    max_power: 4000,
    solar: {
      separate: true,
      color: 'amber',
      units: [
        { entity: 'sensor.roof', name: 'Roof' },
        { entity: 'sensor.garage' },
        { entity: 'sensor.shed' },
      ],
    },
    battery: {
      separate: true,
      units: [
        { entity: 'sensor.b1', soc_entity: 'sensor.s1', name: 'A' },
        { entity: 'sensor.b2', soc_entity: 'sensor.s2', name: 'B' },
      ],
    },
    grid: { entity: 'sensor.grid' },
  };
  const hass = hassWith([
    state('sensor.roof', 1500),
    state('sensor.garage', 500),
    state('sensor.shed', 0),
    state('sensor.b1', -300),
    state('sensor.b2', -100),
    state('sensor.s1', 40, '%'),
    state('sensor.s2', 60, '%'),
    state('sensor.grid', -1000),
  ]);
  const byId = <T extends { id: string }>(list: T[]) => Object.fromEntries(list.map((x) => [x.id, x]));

  it('has a hub for the source and one node per unit', () => {
    const nodes = byId(buildModel(solarCfg, hass).nodes);
    expect(nodes.solar).toMatchObject({ hub: true, watts: 2000, kind: 'solar' });
    expect(nodes['solar:0']).toMatchObject({ unit: 'solar', name: 'Roof', watts: 1500 });
    expect(nodes['solar:1']).toMatchObject({ unit: 'solar', watts: 500 });
    expect(nodes.battery).toMatchObject({ hub: true, watts: 400 });
    expect(nodes['battery:0']).toMatchObject({ unit: 'battery', name: 'A', watts: 300, soc: 40 });
    expect(nodes['battery:0'].status).toBe('En charge');
    // A single bubble stays as before.
    expect(nodes.grid.hub).toBeUndefined();
  });

  it('names a unit after its entity, then after its position', () => {
    const nodes = byId(
      buildModel(
        {
          ...solarCfg,
          solar: { separate: true, units: [{ entity: 'sensor.garage' }, {}, { entity: 'sensor.gone' }] },
        },
        hass,
      ).nodes,
    );
    // The entity's friendly name, cleaned of its "Puissance" suffix.
    expect(nodes['solar:0'].name).toBe('sensor.garage');
    expect(nodes['solar:2'].name).toBe('Solaire 3');
  });

  it('hides a unit at zero, and the hub with its last unit', () => {
    const nodes = byId(buildModel(solarCfg, hass).nodes);
    expect(nodes['solar:2'].visible).toBe(false);
    expect(nodes.solar.visible).toBe(true);
    const night = hassWith(
      ['roof', 'garage', 'shed'].map((n) => state(`sensor.${n}`, 0)).concat(state('sensor.grid', 300)),
    );
    const dark = byId(buildModel(solarCfg, night).nodes);
    expect(dark.solar.visible).toBe(false);
    expect(dark['solar:0'].visible).toBe(false);
  });

  it('flows from the hub are those of a single node with the same total', () => {
    const single = buildModel(
      {
        type: 'x',
        max_power: 4000,
        solar: { units: [{ entity: 'sensor.total' }] },
        grid: { entity: 'sensor.grid' },
      },
      hassWith([state('sensor.total', 2000), state('sensor.grid', -1000)]),
    );
    const split = buildModel({ ...solarCfg, battery: undefined }, hass);
    for (const flow of single.flows) {
      expect(byId(split.flows)[flow.id], flow.id).toMatchObject({
        from: flow.from,
        to: flow.to,
        watts: flow.watts,
      });
    }
  });

  it('feeds the hub with the power of each solar unit', () => {
    const feeders = buildModel(solarCfg, hass).flows.filter((f) => f.feeds === 'solar');
    expect(feeders.map((f) => [f.id, f.from, f.to, f.watts, f.active])).toEqual([
      ['feed:solar:0', 'solar:0', 'solar', 1500, true],
      ['feed:solar:1', 'solar:1', 'solar', 500, true],
      // A hidden unit has no flow to show.
      ['feed:solar:2', 'solar:2', 'solar', 0, false],
    ]);
    expect(feeders.reduce((acc, f) => acc + f.watts, 0)).toBe(2000);
    expect(feeders.every((f) => f.source === null)).toBe(true);
  });

  it('feeds the battery units in both directions, and their sum is the net of the node', () => {
    const model = buildModel(solarCfg, hass);
    const flows = byId(model.flows);
    expect(flows['feed:battery:0:charge']).toMatchObject({ from: 'battery', to: 'battery:0', watts: 300 });
    expect(flows['feed:battery:0:discharge']).toMatchObject({ from: 'battery:0', to: 'battery', watts: 0 });
    expect(model.result.batteryCharge).toBe(400);
  });

  it('a battery unit charging while another discharges shows both, the node the net', () => {
    const mixed = hassWith([
      state('sensor.b1', -500),
      state('sensor.b2', 200),
      state('sensor.grid', 0),
      state('sensor.roof', 0),
    ]);
    const model = buildModel(solarCfg, mixed);
    const flows = byId(model.flows);
    expect(flows['feed:battery:0:charge'].watts).toBe(500);
    expect(flows['feed:battery:1:discharge'].watts).toBe(200);
    expect(model.result.batteryCharge).toBe(300);
    expect(model.result.batteryDischarge).toBe(0);
  });

  it('a unit below the threshold shows 0 but still counts in the total, so micro-inverters add up', () => {
    const noisy = hassWith([state('sensor.roof', 3), state('sensor.garage', 4), state('sensor.shed', 2)]);
    const model = buildModel({ ...solarCfg, battery: undefined, grid: undefined }, noisy);
    const nodes = byId(model.nodes);
    expect(model.result.solar).toBe(9);
    expect(nodes.solar.watts).toBe(9);
    expect(nodes['solar:0'].watts).toBe(0);
    expect(byId(model.flows)['feed:solar:0'].watts).toBe(0);
  });

  it('an unavailable unit counts as 0 and is flagged alone', () => {
    const broken = hassWith([state('sensor.roof', 'unavailable'), state('sensor.garage', 500)]);
    const nodes = byId(buildModel({ ...solarCfg, battery: undefined, grid: undefined }, broken).nodes);
    expect(nodes['solar:0'].available).toBe(false);
    expect(nodes['solar:1'].available).toBe(true);
    expect(nodes.solar).toMatchObject({ available: true, watts: 500 });
  });

  it('the distribution bus leaves the feeders alone', () => {
    const config = { ...solarCfg, devices: [{ entity: 'sensor.tv' }, { entity: 'sensor.fridge' }] };
    const model = buildModel(config, hassWith([...Object.values(hass.states), state('sensor.tv', 100)]));
    const layout = computeLayout({
      width: 700,
      solar: true,
      grid: true,
      battery: true,
      devices: ['device:0', 'device:1'],
      solarUnits: ['solar:0', 'solar:1'],
      batteryUnits: ['battery:0', 'battery:1'],
    });
    const ids = applyDeviceTree(model, layout, config).map((f) => f.id);
    expect(ids).toContain('feed:solar:0');
    expect(ids).toContain('feed:battery:1:charge');
  });

  it('watches the entities of the units', () => {
    expect(new Set(watchedEntities(solarCfg))).toEqual(
      new Set([
        'sensor.roof',
        'sensor.garage',
        'sensor.shed',
        'sensor.b1',
        'sensor.b2',
        'sensor.s1',
        'sensor.s2',
        'sensor.grid',
      ]),
    );
  });
});

describe('sources with several units, as a single bubble', () => {
  const byId = <T extends { id: string }>(list: T[]) => Object.fromEntries(list.map((x) => [x.id, x]));
  const config: LiveEnergyCardConfig = {
    type: 'x',
    solar: {
      name: 'PV',
      color: 'teal',
      units: [
        { entity: 'sensor.roof', name: 'Roof', color: 'red' },
        { entity: 'sensor.garage', name: 'Garage' },
      ],
    },
    battery: {
      units: [
        { entity: 'sensor.b1', soc_entity: 'sensor.s1', capacity: 10, min_soc: 10 },
        { entity: 'sensor.b2', soc_entity: 'sensor.s2', capacity: 5 },
      ],
    },
    grid: { entity: 'sensor.grid' },
  };
  const hass = (b1: number, b2: number, roof: number | string = 1000) =>
    hassWith([
      state('sensor.roof', roof),
      state('sensor.garage', 500),
      state('sensor.b1', b1),
      state('sensor.b2', b2),
      state('sensor.s1', 80, '%'),
      state('sensor.s2', 20, '%'),
      state('sensor.grid', 0),
    ]);

  it('is one node with the total, named and colored by the node, not by its units', () => {
    const model = buildModel(config, hass(0, 0));
    const nodes = byId(model.nodes);
    expect(nodes.solar).toMatchObject({ name: 'PV', watts: 1500, color: expect.stringContaining('') });
    expect(nodes.solar.hub).toBeUndefined();
    expect(nodes['solar:0']).toBeUndefined();
    expect(model.nodes.filter((n) => n.unit)).toEqual([]);
    expect(model.flows.filter((f) => f.feeds)).toEqual([]);
    // More-info opens the first unit's entity.
    expect(nodes.solar.actions.entity).toBe('sensor.roof');
  });

  it('is unavailable as soon as one unit is: a partial total would mislead', () => {
    const model = buildModel(config, hass(0, 0, 'unavailable'));
    expect(byId(model.nodes).solar).toMatchObject({ available: false, watts: null });
    expect(model.result.solar).toBe(0);
  });

  it('weights the charge level by the capacities, and estimates the time on their sum', () => {
    // 80 % of 10 kWh and 20 % of 5 kWh: 9 kWh of 15, i.e. 60 %.
    const model = buildModel(config, hass(-2000, -1000));
    const battery = byId(model.nodes).battery;
    expect(battery.soc).toBeCloseTo(60);
    expect(battery.watts).toBe(3000);
    // 6 kWh left to charge at 3 kW.
    expect(battery.status).toContain('2 h');
  });

  it('adds the units, even when one charges while another discharges', () => {
    const model = buildModel(config, hass(-500, 200));
    expect(byId(model.nodes).battery.watts).toBe(300);
    expect(model.result.batteryCharge).toBe(300);
  });

  it('drops the charge level when a unit has none', () => {
    const partial: LiveEnergyCardConfig = {
      ...config,
      battery: {
        units: [{ entity: 'sensor.b1', soc_entity: 'sensor.s1', capacity: 10 }, { entity: 'sensor.b2' }],
      },
    };
    const battery = byId(buildModel(partial, hass(-2000, -1000)).nodes).battery;
    // The level of the unit that has one, but no estimate on part of the batteries.
    expect(battery.soc).toBeCloseTo(80);
    expect(battery.status).toBe('En charge');
  });
});

describe('layout with units', () => {
  const ids = (group: string, n: number) => Array.from({ length: n }, (_, i) => `${group}:${i}`);

  for (const width of [320, 380, 520, 700, 1000]) {
    for (const [solar, battery] of [
      [3, 0],
      [0, 2],
      [2, 3],
      [8, 6],
      [13, 13],
    ]) {
      for (const n of [0, 5]) {
        it(`no overlap (${width}px, ${solar} solar units, ${battery} battery units, ${n} devices)`, () => {
          const layout = computeLayout({
            width,
            solar: solar > 0,
            grid: true,
            battery: battery > 0,
            devices: devices(n),
            solarUnits: solar ? ids('solar', solar) : undefined,
            batteryUnits: battery ? ids('battery', battery) : undefined,
          });
          assertNoOverlap(layout);
        });
      }
    }
  }

  const input = {
    width: 700,
    solar: true,
    grid: true,
    battery: true,
    devices: devices(3),
    solarUnits: ids('solar', 3),
    batteryUnits: ids('battery', 2),
  };

  it('puts a hub where the node was, the units above it for solar and below it for the battery', () => {
    const layout = computeLayout(input);
    const plain = computeLayout({ ...input, solarUnits: undefined, batteryUnits: undefined });
    for (const group of ['solar', 'battery'] as const) {
      const hub = layout.nodes[group];
      expect(hub.w).toBe(6);
      expect(hub.x).toBeCloseTo(plain.nodes[group].x);
      const side = group === 'solar' ? -1 : 1;
      for (const id of input[`${group}Units`]) {
        expect(Math.sign(layout.nodes[id].y - hub.y)).toBe(side);
      }
    }
    // The nodes around keep their place relative to each other: only the vertical room grows.
    expect(layout.nodes.grid.x).toBeCloseTo(plain.nodes.grid.x);
    expect(layout.height).toBeGreaterThan(plain.height);
  });

  it('reports the size of the units and the height of the segment their feeders share', () => {
    const layout = computeLayout(input);
    expect(layout.units.solar!.size).toBe(layout.nodes['solar:0'].w);
    const hub = layout.nodes.solar;
    expect(layout.units.solar!.trunk).toBeLessThan(hub.y);
    expect(layout.units.solar!.trunk).toBeGreaterThan(layout.nodes['solar:0'].y);
    expect(layout.units.battery!.trunk).toBeGreaterThan(layout.nodes.battery.y);
    expect(computeLayout({ ...input, solarUnits: undefined }).units.solar).toBeUndefined();
  });

  it('keeps the units inside the diagram, whatever the width', () => {
    for (const width of [320, 700, 1400]) {
      const layout = computeLayout({ ...input, width, solarUnits: ids('solar', 8) });
      const left = Math.min(...ids('solar', 8).map((id) => layout.nodes[id].x - layout.nodes[id].w / 2));
      const right = Math.max(...ids('solar', 8).map((id) => layout.nodes[id].x + layout.nodes[id].w / 2));
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(layout.width);
    }
  });
});

describe('unit flow paths', () => {
  const unit: Rect = { x: 40, y: 20, w: 60, h: 60 };
  const hub: Rect = { x: 120, y: 100, w: 6, h: 6 };

  it('runs from the side of the unit facing the hub to the hub itself', () => {
    const path = unitFlowPath(unit, hub, 90, 'rounded', 74, true);
    expect(path.from).toEqual({ x: 40, y: 20 + 30 - 3 });
    expect(path.to).toEqual({ x: 120, y: 100 });
    expect(path.d).toContain('Q');
  });

  it('runs the other way for a unit that receives power', () => {
    const path = unitFlowPath(unit, hub, 90, 'rounded', 74, false);
    expect(path.from).toEqual({ x: 120, y: 100 });
    expect(path.to).toEqual({ x: 40, y: 47 });
  });

  it('goes straight down when the unit is above the hub', () => {
    const path = unitFlowPath({ ...unit, x: 120 }, hub, 90, 'rounded', 74, true);
    expect(path.d).not.toContain('Q');
  });

  it('turns on the shared segment, with a corner that never exceeds the segments', () => {
    const square = unitFlowPath(unit, hub, 90, 'square', 74, true);
    expect(square.d).toContain('L40,90 Q40,90 40,90 L120,90');
    // Squeezed between the unit and the segment: a small radius.
    const tight = unitFlowPath(unit, hub, 49, 'rounded', 74, true);
    expect(tight.d).toMatch(/Q40,49 \d+(\.\d)?,49/);
  });

  it('a unit below the hub (battery) faces up', () => {
    const below: Rect = { x: 40, y: 200, w: 60, h: 60 };
    const path = unitFlowPath(below, hub, 130, 'rounded', 74, true);
    expect(path.from.y).toBe(200 - 30 + 3);
  });

  it('follows the line style', () => {
    expect(unitFlowPath(unit, hub, 90, 'curved', 74, true).d).toContain('C');
    const straight = unitFlowPath(unit, hub, 90, 'straight', 74, true);
    expect(straight.d).toMatch(/^M[\d.]+,[\d.]+ L[\d.]+,[\d.]+$/);
  });

  it('applyUnitPaths gives the feeders a path, and only them', () => {
    const config: LiveEnergyCardConfig = {
      type: 'x',
      solar: { separate: true, units: [{ entity: 'sensor.a' }, { entity: 'sensor.b' }] },
      grid: { entity: 'sensor.g' },
    };
    const model = buildModel(
      config,
      hassWith([state('sensor.a', 800), state('sensor.b', 400), state('sensor.g', 0)]),
    );
    const layout = computeLayout({
      width: 700,
      solar: true,
      grid: true,
      battery: false,
      devices: [],
      solarUnits: ['solar:0', 'solar:1'],
    });
    const flows = applyUnitPaths(model.flows, layout, config);
    const feeder = flows.find((f) => f.id === 'feed:solar:0')!;
    expect(feeder.geometry?.(layout.nodes)?.d).toMatch(/^M/);
    expect(flows.find((f) => f.id === 'solar_home')!.geometry).toBeUndefined();
    // Without the unit on screen, no path.
    expect(feeder.geometry?.({ solar: layout.nodes.solar })).toBeNull();
  });
});
