export type InputAudit = {
  dropped: number;
  entries: ReadonlyArray<{ tick: number; input: Readonly<Record<string, unknown>> }>;
};

export type PulseEvidence = {
  status: 'pass' | 'pending' | 'fail';
  reason: string;
  startTick: number | null;
  endTick: number | null;
  durationTicks: number | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The audit records full-input signature changes at PRE-consumption ticks.
 * A row's input therefore persists until the next row, not just for that row's
 * tick. Only an explicit false boundary at start + 1 proves one consumed tick.
 * This checks the entire available run; a later pulse invalidates an earlier
 * pass. It cannot make claims about ticks after the supplied observation.
 */
export function oneTickPulseEvidence(audit: unknown, action: 'bomb' | 'loop'): PulseEvidence {
  let startTick: number | null = null;
  let endTick: number | null = null;
  const result = (status: PulseEvidence['status'], reason: string): PulseEvidence => ({
    status, reason, startTick, endTick,
    durationTicks: startTick !== null && endTick !== null ? endTick - startTick : null,
  });
  if (!isRecord(audit)) return result('fail', 'Input audit is missing or malformed');
  if (audit.dropped !== 0) return result('fail', 'Complete evidence requires dropped === 0');
  if (!Array.isArray(audit.entries)) return result('fail', 'Audit entries are missing or malformed');
  if (audit.entries.length === 0) return result('pending', 'No consumed input has been recorded yet');

  // Validate every row, including those after a seemingly valid pulse, before
  // interpreting transitions. Never sort, fill in missing values or mutate it.
  let previousTick = -1;
  for (const [index, entry] of audit.entries.entries()) {
    if (!isRecord(entry) || typeof entry.tick !== 'number'
      || !Number.isSafeInteger(entry.tick) || entry.tick < 0 || entry.tick <= previousTick) {
      return result('fail', `Audit row ${index} must have a strictly increasing nonnegative integer tick`);
    }
    if (index === 0 && entry.tick !== 0) return result('fail', 'Complete audit must begin at consumed tick 0');
    if (!isRecord(entry.input) || !Object.prototype.hasOwnProperty.call(entry.input, action)
      || typeof entry.input[action] !== 'boolean') {
      return result('fail', `Audit row ${index} must contain an explicit boolean ${action} input`);
    }
    previousTick = entry.tick;
  }

  for (const entry of audit.entries as InputAudit['entries']) {
    if (entry.input[action] === true) {
      if (endTick !== null) return result('fail', `A later ${action} pulse starts at tick ${entry.tick}`);
      if (startTick === null) startTick = entry.tick;
    } else if (startTick !== null && endTick === null) {
      endTick = entry.tick;
    }
  }
  if (startTick === null) return result('pending', `No true ${action} pulse has been recorded yet`);
  if (endTick === null) return result('pending', `The ${action} pulse has no explicit false closing boundary yet`);
  if (endTick - startTick !== 1) return result('fail', `The ${action} pulse persisted for ${endTick - startTick} consumed ticks`);
  return result('pass', `Exactly one ${action} pulse is closed after one consumed tick`);
}
