import type { RenderQueueStatus } from './render-queue';

export const START_PREPARATION_TIMEOUT_MS = 15000;
export type StartPreparationFailure = 'timeout' | 'render-failed' | 'context-lost' | 'interrupted';
export type StartPreparationPhase = 'idle' | 'draining' | 'submitting' | 'waiting' | 'complete' | 'failed' | 'disposed';
export interface StartFrameReceipt {
  status: RenderQueueStatus;
  submittedCount: number;
  completedCount: number;
}
interface StartPreparationOperations<Selection> {
  now(): number;
  poll(): StartFrameReceipt;
  submit(selection: Selection): StartFrameReceipt | null;
  schedule(callback: () => void, delayMs: number): () => void;
  complete(selection: Selection): void;
  failed(reason: StartPreparationFailure): void;
}

/**
 * Owns rendering from an explicit Start until its exact initial frame completes.
 * The app must not submit home/game frames while ownsRendering is true. Each
 * step is nonblocking: drain old work, yield a paint, submit once, then poll its
 * receipt. Cancellation/timeouts never reset or discard the renderer's fence.
 */
export class CampaignStartPreparation<Selection> {
  private phase: StartPreparationPhase = 'idle';
  private failure: StartPreparationFailure | null = null;
  private selection: Selection | null = null;
  private generation = 0;
  private deadline = 0;
  private submittedFrame: number | null = null;
  private cancelTimeout: (() => void) | null = null;

  constructor(private readonly operations: StartPreparationOperations<Selection>) {}

  get active() { return this.phase === 'draining' || this.phase === 'submitting' || this.phase === 'waiting'; }
  get ownsRendering() { return this.active || this.phase === 'failed'; }
  snapshot() { return { phase: this.phase, failure: this.failure, generation: this.generation, submittedFrame: this.submittedFrame }; }

  begin(selection: Selection): boolean {
    if (this.active || this.phase === 'disposed') return false;
    this.cancel(); this.selection = selection; this.phase = 'draining';
    this.deadline = this.operations.now() + START_PREPARATION_TIMEOUT_MS;
    const generation = this.generation;
    this.cancelTimeout = this.operations.schedule(() => {
      if (generation === this.generation && this.active) this.interrupt('timeout');
    }, START_PREPARATION_TIMEOUT_MS);
    return true;
  }

  step(): void {
    if (!this.active || this.selection === null) return;
    if (this.operations.now() >= this.deadline) { this.interrupt('timeout'); return; }
    const generation = this.generation;
    try {
      const receipt = this.operations.poll();
      if (generation !== this.generation || !this.active) return;
      if (this.operations.now() >= this.deadline) { this.interrupt('timeout'); return; }
      if (receipt.status === 'failed') { this.interrupt('render-failed'); return; }
      if (this.phase === 'waiting') {
        // A foreign submission or reset cannot stand in for our exact frame.
        if (receipt.submittedCount !== this.submittedFrame
          || receipt.completedCount < this.submittedFrame! - 1
          || receipt.completedCount > this.submittedFrame!) { this.interrupt('render-failed'); return; }
        if (receipt.status !== 'ready') return;
        if (receipt.completedCount !== this.submittedFrame) { this.interrupt('render-failed'); return; }
        const selection = this.selection;
        this.phase = 'complete'; this.clearTimeout();
        this.operations.complete(selection);
        return;
      }
      if (receipt.status !== 'ready') return;
      if (receipt.completedCount !== receipt.submittedCount) { this.interrupt('render-failed'); return; }
      if (this.phase === 'draining') { this.phase = 'submitting'; return; }
      const submitted = this.operations.submit(this.selection);
      if (generation !== this.generation || !this.active) return;
      if (this.operations.now() >= this.deadline) { this.interrupt('timeout'); return; }
      if (!submitted || submitted.status === 'failed'
        || submitted.submittedCount !== receipt.submittedCount + 1
        || submitted.completedCount !== receipt.completedCount) { this.interrupt('render-failed'); return; }
      this.submittedFrame = submitted.submittedCount; this.phase = 'waiting';
    } catch {
      // Completion can fail while the app changes its screen/audio/HUD. Do not
      // swallow that failure just because the receipt was already acknowledged.
      if (generation === this.generation && (this.active || this.phase === 'complete')) this.fail('render-failed');
    }
  }

  interrupt(reason: StartPreparationFailure): void {
    if (!this.active && !(this.phase === 'failed' && reason === 'context-lost')) return;
    this.fail(reason);
  }

  private fail(reason: StartPreparationFailure): void {
    this.phase = 'failed'; this.failure = reason; this.generation++; this.clearTimeout();
    this.operations.failed(reason);
  }

  cancel(): void {
    if (this.phase === 'disposed') return;
    this.generation++; this.clearTimeout(); this.phase = 'idle'; this.failure = null;
    this.selection = null; this.submittedFrame = null;
  }

  dispose(): void { this.cancel(); this.phase = 'disposed'; }

  private clearTimeout() { this.cancelTimeout?.(); this.cancelTimeout = null; }
}
