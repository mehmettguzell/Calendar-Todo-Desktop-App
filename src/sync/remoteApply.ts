// How many cloud-originated writes are being applied right now. A depth counter,
// not a boolean: a realtime event landing mid-pass runs its own apply, and a
// boolean would clear the guard while the pass's merge commit was still to come.

let depth = 0;

export function beginRemoteApply(): void {
  depth += 1;
}

export function endRemoteApply(): void {
  depth = Math.max(0, depth - 1);
}

/** True while any cloud-originated write (a pass, a realtime event) is applying. */
export function isApplyingRemoteUpdate(): boolean {
  return depth > 0;
}
