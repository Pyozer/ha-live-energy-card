import { describe, expect, it } from 'vitest';
import { batteryUnits, solarUnits, unitId, unitPowerEntities } from '../src/source-units';
import { blockHeight, planUnits, UNIT_GAP, UNIT_ROW_GAP, unitOffsets } from '../src/unit-layout';

describe('solar units', () => {
  it('has none without a list', () => {
    expect(solarUnits(undefined)).toEqual([]);
    expect(solarUnits({})).toEqual([]);
    expect(solarUnits({ separate: true })).toEqual([]);
  });

  it('numbers the units by their position in the list, whatever is left out', () => {
    const units = solarUnits({
      units: [{ entity: 'sensor.a' }, {}, { entity: 'sensor.c', name: 'Garage' }],
    });
    expect(units.map((u) => [u.id, u.index, u.config.entity])).toEqual([
      ['solar:0', 0, 'sensor.a'],
      ['solar:2', 2, 'sensor.c'],
    ]);
    expect(unitId('battery', 3)).toBe('battery:3');
  });

  it('leaves out rows that are not units', () => {
    const units = solarUnits({ units: [null, 'sensor.a', { entity: 'sensor.b' }] as never });
    expect(units.map((u) => u.id)).toEqual(['solar:2']);
  });

  it('does not depend on how the source is shown', () => {
    const units = [{ entity: 'sensor.a' }];
    expect(solarUnits({ units }).map((u) => u.id)).toEqual(
      solarUnits({ separate: true, units }).map((u) => u.id),
    );
  });
});

describe('battery units', () => {
  it('counts a unit made of a charge and a discharge entity', () => {
    const units = batteryUnits({
      units: [
        { charge_entity: 'sensor.c', discharge_entity: 'sensor.d' },
        { name: 'empty' },
        { entity: 'sensor.e' },
      ],
    });
    expect(units.map((u) => u.id)).toEqual(['battery:0', 'battery:2']);
  });

  it('lists the entities that carry the power of a unit', () => {
    expect(unitPowerEntities({ entity: 'sensor.a', soc_entity: 'sensor.s' })).toEqual(['sensor.a']);
    expect(unitPowerEntities({ charge_entity: 'sensor.c', discharge_entity: 'sensor.d' })).toEqual(
      ['sensor.d', 'sensor.c'].reverse(),
    );
    expect(unitPowerEntities({})).toEqual([]);
  });
});

describe('planUnits', () => {
  it('keeps the units on one row, at full size when there is room', () => {
    const plan = planUnits(3, 400, 74);
    expect(plan.rows).toEqual([3]);
    expect(plan.size).toBe(74);
  });

  it('shrinks the units to keep them on one row', () => {
    const plan = planUnits(5, 300, 80);
    expect(plan.rows).toEqual([5]);
    expect(plan.size).toBeCloseTo((300 - 4 * UNIT_GAP) / 5);
  });

  it('wraps on a second, staggered row when the units would get too small', () => {
    const plan = planUnits(8, 300, 80);
    expect(plan.rows).toEqual([4, 4]);
    expect(plan.shifted).toBe(true);
    expect(plan.width).toBeLessThanOrEqual(300 + 1e-6);
    // Rows of different lengths stagger by themselves.
    expect(planUnits(7, 300, 80).shifted).toBe(false);
  });

  it('lists the units from the farthest row when asked to', () => {
    const plan = planUnits(7, 300, 80);
    expect(unitOffsets(plan).map((o) => o.row)).toEqual([0, 0, 0, 0, 1, 1, 1]);
    expect(unitOffsets(plan, true).map((o) => o.row)).toEqual([1, 1, 1, 0, 0, 0, 0]);
  });

  it('takes the height of its rows, and of what hangs under them', () => {
    const plan = planUnits(8, 300, 80);
    expect(blockHeight(plan)).toBe(2 * plan.size + UNIT_ROW_GAP);
    expect(blockHeight(plan, 20)).toBe(2 * (plan.size + 20) + UNIT_ROW_GAP);
    expect(blockHeight(planUnits(2, 300, 80))).toBe(planUnits(2, 300, 80).size);
  });

  for (const span of [200, 300, 450, 700]) {
    for (let count = 1; count <= 14; count++) {
      it(`fits ${count} units in ${span}px: inside, apart, and staggered between rows`, () => {
        const plan = planUnits(count, span, 80);
        const offsets = unitOffsets(plan);
        expect(offsets).toHaveLength(count);
        expect(plan.rows.reduce((a, b) => a + b, 0)).toBe(count);
        for (const { x } of offsets) {
          expect(x - plan.size / 2).toBeGreaterThanOrEqual(-plan.width / 2 - 1e-6);
          expect(x + plan.size / 2).toBeLessThanOrEqual(plan.width / 2 + 1e-6);
        }
        expect(plan.width).toBeLessThanOrEqual(span + 1e-6);
        for (let i = 0; i < count; i++) {
          for (let j = i + 1; j < count; j++) {
            const dx = Math.abs(offsets[i].x - offsets[j].x);
            // Same row: apart. Other rows: the vertical of a unit goes between the units below it.
            const needed = offsets[i].row === offsets[j].row ? plan.size : plan.size / 2 + 1;
            expect(dx, `${i}/${j}`).toBeGreaterThanOrEqual(needed - 1e-6);
          }
        }
      });
    }
  }
});
