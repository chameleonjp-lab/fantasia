import type { CampaignResult } from './campaign-types';

export const CAMPAIGN_RECORDS_KEY = 'fantasia-records-v1';
export interface RecordGroup {
  mode: 'easy' | 'normal'; rulesVersion: string; mapVersion: string;
  seed: number; startHeading: number;
}
export interface CampaignRecord extends RecordGroup {
  recordTicks: number; activeTicks: number; respawnPenaltyTicks: number;
  score: number; pauseCount: number;
}
type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;
type Store = { version: 1; records: CampaignRecord[] };
export type RecordSaveStatus = 'saved' | 'unchanged' | 'ineligible' | 'unavailable' | 'future-version' | 'session-only';

export function recordGroupKey(group: RecordGroup): string {
  return JSON.stringify([group.mode, group.rulesVersion, group.mapVersion, group.seed, group.startHeading]);
}
function isGroup(value: unknown): value is RecordGroup {
  if (typeof value !== 'object' || value === null) return false;
  const group = value as RecordGroup;
  return (group.mode === 'easy' || group.mode === 'normal')
    && typeof group.rulesVersion === 'string' && group.rulesVersion.length > 0
    && typeof group.mapVersion === 'string' && group.mapVersion.length > 0
    && Number.isInteger(group.seed) && group.seed >= 0 && group.seed <= 0xffffffff
    && Number.isInteger(group.startHeading) && group.startHeading >= 0 && group.startHeading < 7;
}
function isRecord(value: unknown): value is CampaignRecord {
  if (!isGroup(value)) return false;
  const record = value as CampaignRecord;
  return Number.isInteger(record.recordTicks) && record.recordTicks >= 0
    && Number.isInteger(record.activeTicks) && record.activeTicks >= 0
    && Number.isInteger(record.respawnPenaltyTicks) && record.respawnPenaltyTicks >= 0
    && record.recordTicks === record.activeTicks + record.respawnPenaltyTicks
    && Number.isInteger(record.score) && record.score >= 0 && record.score <= 26100
    && Number.isInteger(record.pauseCount) && record.pauseCount >= 0;
}
function isBetter(next: CampaignRecord, current: CampaignRecord | null): boolean {
  return !current || next.recordTicks < current.recordTicks
    || (next.recordTicks === current.recordTicks && next.score > current.score);
}
function candidate(result: CampaignResult, pauseCount: number, interrupted: boolean): CampaignRecord | null {
  if (result.status !== 'victory' || interrupted) return null;
  const record: CampaignRecord = {
    mode: result.mode, rulesVersion: result.rulesVersion, mapVersion: result.mapVersion,
    seed: result.seed, startHeading: result.startHeading,
    recordTicks: result.recordTicks, activeTicks: result.activeTicks,
    respawnPenaltyTicks: result.respawnPenaltyTicks, score: result.score, pauseCount,
  };
  return isRecord(record) ? record : null;
}

/** A failed persistent write leaves the active record untouched until explicit session-only use. */
export class CampaignRecords {
  private readonly session = new Map<string, CampaignRecord>();
  private readStatus: 'ready' | 'unavailable' | 'future-version' = 'ready';
  constructor(private readonly access: StorageAccess | (() => StorageAccess) = () => localStorage) {}
  get status() { return this.readStatus; }
  private storage(): StorageAccess { return typeof this.access === 'function' ? this.access() : this.access; }
  private read(): Store | null {
    try {
      const raw = this.storage().getItem(CAMPAIGN_RECORDS_KEY);
      if (raw === null) { this.readStatus = 'ready'; return { version: 1, records: [] }; }
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid records');
      const store = parsed as { version?: unknown; records?: unknown };
      if (typeof store.version === 'number' && store.version > 1) { this.readStatus = 'future-version'; return null; }
      if (store.version !== 1 || !Array.isArray(store.records) || !store.records.every(isRecord)) throw new Error('Invalid records');
      this.readStatus = 'ready';
      return { version: 1, records: store.records };
    } catch {
      this.readStatus = 'unavailable';
      return null;
    }
  }
  best(group: RecordGroup): CampaignRecord | null {
    const key = recordGroupKey(group), store = this.read();
    let best = this.session.get(key) ?? null;
    for (const record of store?.records ?? []) {
      if (recordGroupKey(record) === key && isBetter(record, best)) best = record;
    }
    return best ? { ...best } : null;
  }
  save(result: CampaignResult, pauseCount: number, interrupted = false): RecordSaveStatus {
    const record = candidate(result, pauseCount, interrupted);
    if (!record) return 'ineligible';
    // Re-read immediately before writing so a newer tab's format is preserved.
    const store = this.read();
    if (!store) return this.readStatus === 'future-version' ? 'future-version' : 'unavailable';
    const key = recordGroupKey(record);
    const previous = store.records.filter(item => recordGroupKey(item) === key)
      .reduce<CampaignRecord | null>((best, item) => isBetter(item, best) ? item : best, null);
    if (!isBetter(record, previous)) return 'unchanged';
    const records = store.records.filter(item => recordGroupKey(item) !== key);
    records.push(record);
    try {
      this.storage().setItem(CAMPAIGN_RECORDS_KEY, JSON.stringify({ version: 1, records }));
      this.readStatus = 'ready';
      return 'saved';
    } catch {
      this.readStatus = 'unavailable';
      return 'unavailable';
    }
  }
  useSessionOnly(result: CampaignResult, pauseCount: number, interrupted = false): RecordSaveStatus {
    const record = candidate(result, pauseCount, interrupted);
    if (!record) return 'ineligible';
    const key = recordGroupKey(record), previous = this.session.get(key) ?? null;
    if (isBetter(record, previous)) this.session.set(key, record);
    return 'session-only';
  }
}
