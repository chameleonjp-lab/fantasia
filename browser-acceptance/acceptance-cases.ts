/** Exact discovery contract shared by the suite and fail-closed report. */
export const CASES = [
  ['start', 1, 'Start preparation, cancellation, selected modes and tick-zero commit'],
  ['controls-normal', 2, 'Normal continuous keyboard and drag controls release'],
  ['controls-easy', 2, 'Easy steering and prohibited manual controls'],
  ['edges-normal', 3, 'Normal single-action bomb and loop edges with cancellation'],
  ['edges-easy', 3, 'Easy single-action bomb and loop edges with cancellation'],
  ['lifecycle', 4, 'Pause Resume Home Restart freeze and clear stale input'],
  ['settings', 5, 'Settings tabs Save Discard duplicate keys and focus'],
  ['storage-failure', 5, 'Explicit storage failure preserves active bindings'],
  ['storage-session', 5, 'Storage failure session-only approval and reload loss'],
  ['storage-future-rollback', 5, 'Future-version protection and partial-write rollback'],
  ['resize-context', 6, 'Actual resize and native WebGL context loss recovery'],
  ['frame-gap', 7, 'Explicit controlled frame gap stops safely without catch-up'],
  ['render-fault', 7, 'Explicit render fault injection stops safely without paused draws'],
  ...['desktop-dpr1', 'portrait-dpr3', 'landscape-dpr3', 'small-portrait-dpr2', 'small-landscape-dpr2'].flatMap(size =>
    ['normal', 'easy'].map(mode => [`hud-${size}-${mode}`, 8, `Live full-size HUD ${size} ${mode}`])),
  ...['desktop-dpr1', 'portrait-dpr3', 'landscape-dpr3', 'small-portrait-dpr2', 'small-landscape-dpr2'].flatMap(size =>
    ['normal', 'easy'].map(mode => [`text-200-${size}-${mode}`, 9, `Actual 200 percent text ${size} ${mode}, fresh geometry and reachable controls`])),
  ['native-capability', 10, 'Ordinary-wall-clock renderer capability with explicit safety recovery'],
] as const;
export const titleFor = (id: string) => {
  const row = CASES.find(row => row[0] === id);
  if (!row) throw new Error(`Unknown acceptance case ${id}`);
  return `[${row[0]}] ${row[2]}`;
};
