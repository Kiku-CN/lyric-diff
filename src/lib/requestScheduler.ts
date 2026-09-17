export const PLAYLIST_MAX_CONCURRENCY = 2;
export const PLAYLIST_DELAY_RANGE_MS: readonly [number, number] = [800, 1800];

type SchedulerOptions = {
  maxConcurrency?: number;
  delayRangeMs?: readonly [number, number];
  random?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
};

const defaultWait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

function randomDelay(range: readonly [number, number], random: () => number): number {
  const [minimum, maximum] = range;
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

export async function runThrottled<T, R>(items: T[], worker: (item: T, index: number) => Promise<R>, options: SchedulerOptions = {}): Promise<R[]> {
  if (items.length === 0) return [];
  const maxConcurrency = Math.max(1, Math.floor(options.maxConcurrency ?? PLAYLIST_MAX_CONCURRENCY));
  const delayRangeMs = options.delayRangeMs ?? PLAYLIST_DELAY_RANGE_MS;
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
    if (hasStartedRequest) await wait(randomDelay(delayRangeMs, random));
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
