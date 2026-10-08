import type { DeviceConfig } from '../types';

/**
 * Immutable operations on the editor's device list, which has two levels: top-level devices and
 * the members of a group. A path is `[index]` for a top-level device and `[group, index]` for a
 * member.
 */
export type DevicePath = readonly number[];

export const pathKey = (path: DevicePath): string => path.join('.');

export const isGroup = (dev: DeviceConfig | undefined): boolean => Array.isArray(dev?.devices);

/** Device at a path, `undefined` when the path does not exist. */
export function deviceAt(devices: readonly DeviceConfig[], path: DevicePath): DeviceConfig | undefined {
  const [i, j] = path;
  const top = devices[i];
  return j === undefined ? top : top?.devices?.[j];
}

/** Applies `edit` to the list holding the device at `path` (the top level or a group's members). */
function editSiblings(
  devices: readonly DeviceConfig[],
  path: DevicePath,
  edit: (list: DeviceConfig[], index: number) => void,
): DeviceConfig[] {
  const next = [...devices];
  if (path.length === 1) {
    edit(next, path[0]);
    return next;
  }
  const [g, index] = path;
  const group = next[g];
  if (!group) return next;
  const members = [...(group.devices ?? [])];
  edit(members, index);
  next[g] = { ...group, devices: members };
  return next;
}

export function updateDevice(
  devices: readonly DeviceConfig[],
  path: DevicePath,
  value: DeviceConfig,
): DeviceConfig[] {
  return editSiblings(devices, path, (list, i) => {
    if (i >= 0 && i < list.length) list[i] = value;
  });
}

/** Moves a device within its list. Returns the new path (unchanged when it cannot move). */
export function moveDevice(
  devices: readonly DeviceConfig[],
  path: DevicePath,
  delta: number,
): { devices: DeviceConfig[]; path: DevicePath } {
  let moved = path;
  const next = editSiblings(devices, path, (list, i) => {
    const target = i + delta;
    if (target < 0 || target >= list.length) return;
    [list[i], list[target]] = [list[target], list[i]];
    moved = [...path.slice(0, -1), target];
  });
  return { devices: next, path: moved };
}

export function removeDevice(devices: readonly DeviceConfig[], path: DevicePath): DeviceConfig[] {
  return editSiblings(devices, path, (list, i) => {
    if (i >= 0 && i < list.length) list.splice(i, 1);
  });
}

/** Appends a device at the top level, or to a group's members. Returns the new device's path. */
export function addDevice(
  devices: readonly DeviceConfig[],
  device: DeviceConfig,
  group?: number,
): { devices: DeviceConfig[]; path: DevicePath } {
  if (group === undefined) return { devices: [...devices, device], path: [devices.length] };
  const next = [...devices];
  const members = [...(next[group]?.devices ?? []), device];
  next[group] = { ...next[group], devices: members };
  return { devices: next, path: [group, members.length - 1] };
}
