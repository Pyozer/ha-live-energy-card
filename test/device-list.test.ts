import { describe, expect, it } from 'vitest';
import {
  addDevice,
  deviceAt,
  isGroup,
  moveDevice,
  pathKey,
  removeDevice,
  updateDevice,
} from '../src/editor/device-list';
import type { DeviceConfig } from '../src/types';

const list: DeviceConfig[] = [
  { entity: 'sensor.a' },
  { name: 'Kitchen', devices: [{ entity: 'sensor.oven' }, { entity: 'sensor.hob' }] },
];

describe('editor device list', () => {
  it('reads top-level devices and group members', () => {
    expect(deviceAt(list, [0])?.entity).toBe('sensor.a');
    expect(deviceAt(list, [1, 1])?.entity).toBe('sensor.hob');
    expect(deviceAt(list, [3])).toBeUndefined();
    expect(isGroup(list[1])).toBe(true);
    expect(isGroup(list[0])).toBe(false);
    expect(pathKey([1, 0])).toBe('1.0');
  });

  it('updates a member without touching the original list', () => {
    const next = updateDevice(list, [1, 0], { entity: 'sensor.microwave' });
    expect(deviceAt(next, [1, 0])?.entity).toBe('sensor.microwave');
    expect(deviceAt(list, [1, 0])?.entity).toBe('sensor.oven');
    expect(next[1].name).toBe('Kitchen');
  });

  it('moves within its own list and returns the new path', () => {
    const { devices, path } = moveDevice(list, [1, 0], 1);
    expect(path).toEqual([1, 1]);
    expect(devices[1].devices?.map((d) => d.entity)).toEqual(['sensor.hob', 'sensor.oven']);
    // Out of bounds: unchanged.
    expect(moveDevice(list, [0], -1).path).toEqual([0]);
  });

  it('removes and adds devices at both levels', () => {
    expect(removeDevice(list, [1, 0])[1].devices).toHaveLength(1);
    expect(removeDevice(list, [0])).toHaveLength(1);
    const top = addDevice(list, { entity: '' });
    expect(top.path).toEqual([2]);
    const member = addDevice(list, { entity: '' }, 1);
    expect(member.path).toEqual([1, 2]);
    expect(member.devices[1].devices).toHaveLength(3);
    expect(list[1].devices).toHaveLength(2);
  });
});
