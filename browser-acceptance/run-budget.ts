/** External runner wall time; independent of the page's controlled clock. */
export class RunBudget {
  readonly deadline: number;
  steps = 0;
  constructor(readonly wallMs = 45000, readonly maxSteps = 120, private readonly now = () => Date.now()) {
    this.deadline = now() + wallMs;
  }
  remaining(label: string): number {
    const remaining = this.deadline - this.now();
    if (remaining <= 0) throw new Error(`Driver wall-clock budget exceeded: ${label}`);
    return remaining;
  }
  step(): void {
    this.remaining('animation step');
    if (++this.steps > this.maxSteps) throw new Error('Driver animation-step budget exceeded');
  }
}
