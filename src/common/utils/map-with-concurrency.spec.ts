import { mapWithConcurrency } from './map-with-concurrency.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('mapWithConcurrency', () => {
  it('preserves the order of results', async () => {
    const results = await mapWithConcurrency([30, 10, 20], 2, async (value) => {
      await tick();
      return value * 2;
    });

    expect(results).toEqual([60, 20, 40]);
  });

  it('never runs more than the given number of calls at once', async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight--;
    });

    expect(peak).toBe(2);
  });

  it('rejects with the first error and starts no new calls after it', async () => {
    const started: number[] = [];

    const result = mapWithConcurrency([1, 2, 3, 4], 1, async (value) => {
      started.push(value);
      if (value === 2) throw new Error('boom');
    });

    await expect(result).rejects.toThrow('boom');
    expect(started).toEqual([1, 2]);
  });

  it('resolves an empty list without calling fn', async () => {
    const fn = vi.fn();

    await expect(mapWithConcurrency([], 3, fn)).resolves.toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});
