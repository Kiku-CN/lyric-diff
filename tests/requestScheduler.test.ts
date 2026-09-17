import { describe, expect, it } from 'vitest';
import { runThrottled } from '../src/lib/requestScheduler';

describe('throttled request scheduler', () => {
  it('limits active work to two requests and preserves input order', async () => {
    const resolvers: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    const resultPromise = runThrottled(['a', 'b', 'c', 'd'], async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => resolvers.push(resolve));
      active -= 1;
      return value.toUpperCase();
    }, { maxConcurrency: 2, delayRangeMs: [0, 0], wait: async () => {} });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(peak).toBe(2);
    resolvers.splice(0).forEach((resolve) => resolve());
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    resolvers.splice(0).forEach((resolve) => resolve());

    await expect(resultPromise).resolves.toEqual(['A', 'B', 'C', 'D']);
  });

  it('waits a randomized delay before each request after the first', async () => {
    const waits: number[] = [];
    await runThrottled([1, 2, 3], async (value) => value, {
      maxConcurrency: 1,
      delayRangeMs: [800, 1800],
      random: () => 0.5,
      wait: async (milliseconds) => { waits.push(milliseconds); },
    });

    expect(waits).toEqual([1300, 1300]);
  });
});
