import { describe, expect, it } from 'vitest';
import {
  addDevice,
  deviceAt,
  dropDevice,
  findDevice,
  isGroup,
  moveDevice,
  pathKey,
  removeDevice,
  updateDevice,
} from '../src/editor/device-list';
import { dropTargetAt, type DragBlock } from '../src/editor/drag';
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

describe('dropping a device', () => {
  const tree: DeviceConfig[] = [
    { entity: 'a' },
    { name: 'Kitchen', devices: [{ entity: 'oven' }, { entity: 'hob' }] },
    { entity: 'b' },
    { name: 'IT', devices: [] },
  ];
  const ids = (devices: DeviceConfig[]) => devices.map((d) => d.entity ?? d.name);
  const members = (devices: DeviceConfig[], g: number) => devices[g].devices?.map((d) => d.entity);

  it('reorders at the top level, whichever way it goes', () => {
    const down = dropDevice(tree, [0], { path: [2], position: 'after' })!;
    expect(ids(down.devices)).toEqual(['Kitchen', 'b', 'a', 'IT']);
    expect(down.path).toEqual([2]);
    const up = dropDevice(tree, [2], { path: [0], position: 'before' })!;
    expect(ids(up.devices)).toEqual(['b', 'a', 'Kitchen', 'IT']);
    expect(up.path).toEqual([0]);
  });

  it('moves a device into a group, as its last member', () => {
    const r = dropDevice(tree, [0], { path: [1], position: 'into' })!;
    expect(ids(r.devices)).toEqual(['Kitchen', 'b', 'IT']);
    // The group moved up by one: the indices are those of the list after the removal.
    expect(members(r.devices, 0)).toEqual(['oven', 'hob', 'a']);
    expect(r.path).toEqual([0, 2]);
    expect(members(dropDevice(tree, [2], { path: [3], position: 'into' })!.devices, 2)).toEqual(['b']);
  });

  it('moves a device next to a member of another group', () => {
    const r = dropDevice(tree, [2], { path: [1, 1], position: 'before' })!;
    expect(members(r.devices, 1)).toEqual(['oven', 'b', 'hob']);
    expect(r.path).toEqual([1, 1]);
    expect(ids(r.devices)).toEqual(['a', 'Kitchen', 'IT']);
  });

  it('takes a member out of its group, or into another one', () => {
    const out = dropDevice(tree, [1, 0], { path: [2], position: 'before' })!;
    expect(ids(out.devices)).toEqual(['a', 'Kitchen', 'oven', 'b', 'IT']);
    expect(members(out.devices, 1)).toEqual(['hob']);
    expect(out.path).toEqual([2]);
    const across = dropDevice(tree, [1, 1], { path: [3], position: 'into' })!;
    expect(members(across.devices, 1)).toEqual(['oven']);
    expect(members(across.devices, 3)).toEqual(['hob']);
    expect(across.path).toEqual([3, 0]);
  });

  it('reorders the members of a group, indices shifting after the removal', () => {
    const r = dropDevice(tree, [1, 0], { path: [1, 1], position: 'after' })!;
    expect(members(r.devices, 1)).toEqual(['hob', 'oven']);
    expect(r.path).toEqual([1, 1]);
    // Into its own group: to the end.
    expect(members(dropDevice(tree, [1, 0], { path: [1], position: 'into' })!.devices, 1)).toEqual([
      'hob',
      'oven',
    ]);
  });

  it('moves a group among the top-level devices, but never inside another group', () => {
    const r = dropDevice(tree, [1], { path: [3], position: 'after' })!;
    expect(ids(r.devices)).toEqual(['a', 'b', 'IT', 'Kitchen']);
    expect(r.path).toEqual([3]);
    expect(dropDevice(tree, [1], { path: [3], position: 'into' })).toBeNull();
    expect(dropDevice(tree, [3], { path: [1, 0], position: 'before' })).toBeNull();
  });

  it('only drops into a group, and refuses a drop that changes nothing', () => {
    expect(dropDevice(tree, [0], { path: [2], position: 'into' })).toBeNull();
    expect(dropDevice(tree, [0], { path: [1, 0], position: 'into' })).toBeNull();
    expect(dropDevice(tree, [0], { path: [0], position: 'after' })).toBeNull();
    expect(dropDevice(tree, [0], { path: [1], position: 'before' })).toBeNull();
    expect(dropDevice(tree, [1, 1], { path: [1], position: 'into' })).toBeNull();
    expect(dropDevice(tree, [9], { path: [0], position: 'before' })).toBeNull();
  });

  it('never mutates the original list and keeps the devices themselves', () => {
    const before = structuredClone(tree);
    const r = dropDevice(tree, [1, 0], { path: [0], position: 'before' })!;
    expect(tree).toEqual(before);
    expect(findDevice(r.devices, tree[1].devices![0])).toEqual([0]);
    expect(findDevice(r.devices, { entity: 'other' })).toBeUndefined();
    expect(findDevice(tree, tree[1].devices![1])).toEqual([1, 1]);
  });
});

describe('drop target under the pointer', () => {
  // Layout (px): a 0-40, Kitchen 50-190 (header 50-90, members 100-130 and 140-170), b 200-240.
  const blocks: DragBlock[] = [
    { index: 0, block: { top: 0, bottom: 40 }, head: { top: 0, bottom: 40 }, group: false, members: [] },
    {
      index: 1,
      block: { top: 50, bottom: 190 },
      head: { top: 50, bottom: 90 },
      group: true,
      members: [
        { index: 0, top: 100, bottom: 130 },
        { index: 1, top: 140, bottom: 170 },
      ],
    },
    {
      index: 2,
      block: { top: 200, bottom: 240 },
      head: { top: 200, bottom: 240 },
      group: false,
      members: [],
    },
  ];
  const at = (y: number, group = false) => dropTargetAt(blocks, y, group);

  it('drops before or after a plain device, by half', () => {
    expect(at(10)).toEqual({ path: [0], position: 'before' });
    expect(at(30)).toEqual({ path: [0], position: 'after' });
    expect(at(-20)).toEqual({ path: [0], position: 'before' });
    expect(at(300)).toEqual({ path: [2], position: 'after' });
  });

  it('drops into a group by its header, before it by its top edge and after it by its bottom edge', () => {
    expect(at(55)).toEqual({ path: [1], position: 'before' });
    expect(at(70)).toEqual({ path: [1], position: 'into' });
    expect(at(88)).toEqual({ path: [1], position: 'into' });
    expect(at(185)).toEqual({ path: [1], position: 'after' });
  });

  it('drops among the members of a group', () => {
    expect(at(105)).toEqual({ path: [1, 0], position: 'before' });
    expect(at(125)).toEqual({ path: [1, 0], position: 'after' });
    expect(at(138)).toEqual({ path: [1, 1], position: 'before' });
    expect(at(165)).toEqual({ path: [1, 1], position: 'after' });
  });

  it('an empty group takes the device into it', () => {
    const empty: DragBlock[] = [
      { index: 0, block: { top: 0, bottom: 80 }, head: { top: 0, bottom: 40 }, group: true, members: [] },
    ];
    expect(dropTargetAt(empty, 60, false)).toEqual({ path: [0], position: 'into' });
    expect(dropTargetAt([], 10, false)).toBeUndefined();
  });

  it('answers with the data indices, so the lifted block can be left out of the measure', () => {
    // The dragged device (index 1) is out of the layout: the next one is measured where it now is.
    const without: DragBlock[] = [
      { index: 0, block: { top: 0, bottom: 40 }, head: { top: 0, bottom: 40 }, group: false, members: [] },
      { index: 2, block: { top: 50, bottom: 90 }, head: { top: 50, bottom: 90 }, group: false, members: [] },
    ];
    expect(dropTargetAt(without, 80, false)).toEqual({ path: [2], position: 'after' });
    const group: DragBlock[] = [
      {
        index: 3,
        block: { top: 0, bottom: 140 },
        head: { top: 0, bottom: 40 },
        group: true,
        members: [
          { index: 0, top: 50, bottom: 80 },
          { index: 2, top: 90, bottom: 120 },
        ],
      },
    ];
    expect(dropTargetAt(group, 115, false)).toEqual({ path: [3, 2], position: 'after' });
  });

  it('a dragged group only sees the top-level blocks', () => {
    expect(at(70, true)).toEqual({ path: [1], position: 'before' });
    expect(at(110, true)).toEqual({ path: [1], position: 'before' });
    expect(at(150, true)).toEqual({ path: [1], position: 'after' });
  });
});
