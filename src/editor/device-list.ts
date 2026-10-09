import type { DeviceConfig } from '../types';

/**
 * Immutable operations on the editor's device list, which has two levels: top-level devices and
 * the members of a group. A path is `[index]` for a top-level device and `[group, index]` for a
 * member.
 */
export type DevicePath = readonly number[];

export const pathKey = (path: DevicePath): string => path.join('.');
export const parsePathKey = (key: string): DevicePath => key.split('.').map(Number);

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

export type DropPosition = 'before' | 'after' | 'into';

/** Where a dragged device lands: next to the device at `path`, or at the end of a group. */
export interface DropTarget {
  path: DevicePath;
  position: DropPosition;
}

/** Path of a device (by identity), `undefined` when it is not in the list. */
export function findDevice(devices: readonly DeviceConfig[], device: DeviceConfig): DevicePath | undefined {
  for (let i = 0; i < devices.length; i++) {
    if (devices[i] === device) return [i];
    const j = (devices[i].devices ?? []).indexOf(device);
    if (j >= 0) return [i, j];
  }
  return undefined;
}

/**
 * Drops a device next to another one (`before` / `after`, at the top level or among a group's
 * members) or at the end of a group (`into`). Returns the new list and the device's new path, or
 * `null` when the drop is not allowed or would change nothing. A group stays at the top level (the
 * list has two levels), and only a group takes members.
 */
export function dropDevice(
  devices: readonly DeviceConfig[],
  source: DevicePath,
  target: DropTarget,
): { devices: DeviceConfig[]; path: DevicePath } | null {
  const dragged = deviceAt(devices, source);
  const destination = deviceAt(devices, target.path);
  if (!dragged || !destination || pathKey(source) === pathKey(target.path)) return null;
  if (target.position === 'into') {
    if (target.path.length !== 1 || !isGroup(destination) || isGroup(dragged)) return null;
  } else if (isGroup(dragged) && target.path.length !== 1) {
    return null;
  }

  // The target's indices are those of the list before the removal: shift them when the removed
  // device was ahead of it in the same list.
  const next = removeDevice(devices, source);
  const to = [...target.path];
  if (source.length === 1 && to[0] > source[0]) to[0]--;
  else if (source.length === 2 && to.length === 2 && to[0] === source[0] && to[1] > source[1]) to[1]--;

  let path: DevicePath;
  if (target.position === 'into') {
    const members = [...(next[to[0]].devices ?? []), dragged];
    next[to[0]] = { ...next[to[0]], devices: members };
    path = [to[0], members.length - 1];
  } else {
    const index = to[to.length - 1] + (target.position === 'after' ? 1 : 0);
    if (to.length === 1) {
      next.splice(index, 0, dragged);
      path = [index];
    } else {
      const members = [...(next[to[0]].devices ?? [])];
      members.splice(index, 0, dragged);
      next[to[0]] = { ...next[to[0]], devices: members };
      path = [to[0], index];
    }
  }
  return pathKey(path) === pathKey(source) ? null : { devices: next, path };
}
