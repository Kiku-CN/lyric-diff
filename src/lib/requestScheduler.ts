export const PLAYLIST_MAX_CONCURRENCY = 2;
export const PLAYLIST_DELAY_RANGE_MS: readonly [number, number] = [1200, 2500];
export const LARGE_PLAYLIST_THRESHOLD = 8;
export const LARGE_PLAYLIST_MAX_CONCURRENCY = 1;
export const LARGE_PLAYLIST_DELAY_RANGE_MS: readonly [number, number] = [2500, 5000];

export type SchedulerOptions = {
  maxConcurrency?: number;
  delayRangeMs?: readonly [number, number];
  delayFirst?: boolean;
  random?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
};

export function getPlaylistThrottleOptions(trackCount: number): Pick<SchedulerOptions, 'maxConcurrency' | 'delayRangeMs'> {
  return trackCount > LARGE_PLAYLIST_THRESHOLD
    ? { maxConcurrency: LARGE_PLAYLIST_MAX_CONCURRENCY, delayRangeMs: LARGE_PLAYLIST_DELAY_RANGE_MS }
    : { maxConcurrency: PLAYLIST_MAX_CONCURRENCY, delayRangeMs: PLAYLIST_DELAY_RANGE_MS };
}

const defaultWait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

function randomDelay(range: readonly [number, number], random: () => number): number {
  const [minimum, maximum] = range;
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

export async function runThrottled<T, R>(items: T[], worker: (item: T, index: number) => Promise<R>, options: SchedulerOptions = {}): Promise<R[]> {
  if (items.length === 0) return [];
  const maxConcurrency = Math.max(1, Math.floor(options.maxConcurrency ?? PLAYLIST_MAX_CONCURRENCY));
  const delayRangeMs = options.delayRangeMs ?? PLAYLIST_DELAY_RANGE_MS;
  const delayFirst = options.delayFirst ?? false;
  const random = options.random ?? Math.random;
  const wait = options.wait ?? defaultWait;
  const results = Array<R>(items.length);
  let nextIndex = 0;
  let hasStartedRequest = false;
  let startQueue = Promise.resolve();

  async function waitForStartSlot() {
    let release!: () => void;
    const previous = startQueue;
    startQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    if (hasStartedRequest || delayFirst) await wait(randomDelay(delayRangeMs, random));
    hasStartedRequest = true;
    release();
  }

  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      await waitForStartSlot();
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(maxConcurrency, items.length) }, () => runWorker()));
  return results;
}
