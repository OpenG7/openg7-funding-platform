export const workCategories = [
  'diagnostic',
  'review',
  'preparation',
  'recovery'
] as const;
export type WorkCategory = (typeof workCategories)[number];

/** Voluntary foreground sample only. No persistence, identity, HTTP or passive tracking. */
export class HumanWorkSample {
  private started: number | null = null;
  private category: WorkCategory = 'diagnostic';
  private totals = Object.fromEntries(
    workCategories.map((key) => [key, 0])
  ) as Record<WorkCategory, number>;
  get running(): boolean {
    return this.started !== null;
  }
  start(category: WorkCategory, now: number): void {
    if (this.running || !Number.isFinite(now) || now < 0) return;
    this.category = category;
    this.started = now;
  }
  pause(now: number): void {
    if (this.started === null) return;
    this.totals[this.category] += Number.isFinite(now)
      ? Math.max(0, now - this.started)
      : 0;
    this.started = null;
  }
  seconds(now: number): Readonly<Record<WorkCategory, number>> {
    return Object.fromEntries(
      workCategories.map((key) => [
        key,
        Math.floor(
          (this.totals[key] +
            (key === this.category &&
            this.started !== null &&
            Number.isFinite(now)
              ? Math.max(0, now - this.started)
              : 0)) /
            1000
        )
      ])
    ) as Record<WorkCategory, number>;
  }
  clear(): void {
    this.started = null;
    this.totals = Object.fromEntries(
      workCategories.map((key) => [key, 0])
    ) as Record<WorkCategory, number>;
  }
}
