/**
 * Runs `fn` over `items` with at most `concurrency` calls in flight, preserving result order.
 * Rejects with the first error; calls already in flight are awaited before rejecting, and no new
 * call starts after a failure.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  let failure: { error: unknown } | undefined;

  const worker = async () => {
    while (failure === undefined && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]!, index);
      } catch (error) {
        failure ??= { error };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(Math.max(concurrency, 1), items.length) }, worker));
  if (failure !== undefined) {
    throw failure.error;
  }
  return results;
}
