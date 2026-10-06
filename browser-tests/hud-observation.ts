type Snapshot = Record<string, any>;
const record = (value: unknown): value is Snapshot => typeof value === 'object' && value !== null && !Array.isArray(value);
const queueOf = (value: unknown): Snapshot | null => record(value) && record(value.render) && record(value.render.queue) ? value.render.queue : null;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export type NativeConfirmation = {
  stage: 'after-native-raf' | 'timeout' | 'unavailable';
  observation?: unknown;
  error?: string;
};
export type HudObservationGate = {
  outcome: 'pass' | 'fail' | 'inconclusive';
  stage: 'original' | 'native-confirmation';
  originalProblems: string[];
  problems: string[];
  nativeConfirmation?: NativeConfirmation;
};

export function hudCaptureProblems(observed: unknown): string[] {
  if (!record(observed)) return ['final observation is unavailable'];
  const problems: string[] = [];
  if (observed.phase !== 'playing') problems.push(`phase is ${observed.phase}`);
  if (!Array.isArray(observed.pauseReasons) || observed.pauseReasons.length) problems.push('pause reasons are present or unavailable');
  if (observed.fatalLogicError !== null) problems.push('logic safety state is not clear');
  if (!['ready', 'pending'].includes(observed.renderStatus)) problems.push(`render state is ${observed.renderStatus}`);
  const queue = queueOf(observed);
  if (!queue || !['ready', 'pending'].includes(queue.status)) problems.push(`render queue is ${queue?.status}`);
  return problems;
}

/** Only the pure queue age disagrees with a still-live native application. */
export function needsNativeConfirmation(observed: unknown): boolean {
  const problems = hudCaptureProblems(observed), queue = queueOf(observed);
  return problems.length === 1 && problems[0] === 'render queue is stalled' && !!queue
    && record(observed) && typeof observed.runId === 'string' && observed.runId.length > 0
    && observed.performanceInterrupted === false && observed.lastInterruption === null
    && queue.failure === null
    && typeof queue.pendingMs === 'number' && Number.isFinite(queue.pendingMs) && queue.pendingMs > 0
    && count(queue.submittedCount) && count(queue.completedCount) && queue.submittedCount === queue.completedCount + 1;
}

/** Preserve the original result; request at most one read after the app's own rAF. */
export async function confirmHudObservation(original: unknown, observeNativeFrame: () => Promise<NativeConfirmation>): Promise<HudObservationGate> {
  const originalProblems = hudCaptureProblems(original);
  if (!needsNativeConfirmation(original)) return {
    outcome: originalProblems.length ? 'fail' : 'pass', stage: 'original', originalProblems, problems: originalProblems,
  };
  let nativeConfirmation: NativeConfirmation;
  try { nativeConfirmation = await observeNativeFrame(); }
  catch (error) { nativeConfirmation = { stage: 'unavailable', error: String(error) }; }
  const result = (outcome: HudObservationGate['outcome'], problems: string[]): HudObservationGate => ({
    outcome, stage: 'native-confirmation', originalProblems, problems, nativeConfirmation,
  });
  if (nativeConfirmation.stage !== 'after-native-raf') return result('inconclusive', [`native confirmation is ${nativeConfirmation.stage}`]);
  const problems = hudCaptureProblems(nativeConfirmation.observation);
  const observed = nativeConfirmation.observation;
  if (!record(observed) || observed.performanceInterrupted !== false || observed.lastInterruption !== null) problems.push('interruption history is present or unavailable');
  if (!record(observed) || !record(original) || observed.runId !== original.runId) problems.push('native confirmation belongs to a different or missing run');
  const before = queueOf(original)!, after = queueOf(observed);
  if (after?.failure !== null) problems.push('render queue failure is present or unavailable');
  if (problems.length || !after) return result('fail', problems);
  if (!count(after.submittedCount) || !count(after.completedCount) || after.completedCount > after.submittedCount
    || after.submittedCount < before.submittedCount || after.completedCount < before.submittedCount
    || after.submittedCount - after.completedCount !== (after.status === 'ready' ? 0 : 1)) {
    return result('inconclusive', ['the original submitted fence has not been proven complete by the native poll']);
  }
  return result('pass', []);
}

type FrameClock = {
  now(): number;
  requestFrame(callback: () => void): number;
  cancelFrame(id: number): void;
  setTimer(callback: () => void, delay: number): number;
  clearTimer(id: number): void;
};

/** Serializable for page.evaluate; does not read the app or touch its GL queue. */
export function waitForNativeFrame(timeoutMs: number, injectedClock?: FrameClock): Promise<'raf' | 'timeout'> {
  const clock = injectedClock ?? {
    now() { return performance.now(); }, requestFrame(callback: () => void) { return requestAnimationFrame(callback); },
    cancelFrame(id: number) { cancelAnimationFrame(id); },
    setTimer(callback: () => void, delay: number) { return window.setTimeout(callback, delay); },
    clearTimer(id: number) { window.clearTimeout(id); },
  };
  return new Promise(resolve => {
    const deadline = clock.now() + timeoutMs;
    let settled = false, frame = 0, timer = 0;
    timer = clock.setTimer(() => {
      if (settled) return;
      settled = true; clock.cancelFrame(frame); resolve('timeout');
    }, timeoutMs);
    frame = clock.requestFrame(() => {
      if (settled) return;
      settled = true; clock.clearTimer(timer); resolve(clock.now() >= deadline ? 'timeout' : 'raf');
    });
  });
}
