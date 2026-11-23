import { withTimeout } from './with-timeout.js';

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1_000, 'ping')).resolves.toBe('ok');
  });

  it('rejects with a labelled error when the promise is too slow', async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => {});

    const result = withTimeout(never, 1_000, 'ping');
    vi.advanceTimersByTime(1_000);

    await expect(result).rejects.toThrow('ping timed out after 1000 ms');
  });

  it('propagates the original rejection', async () => {
    const failure = new Error('connection refused');

    await expect(withTimeout(Promise.reject(failure), 1_000, 'ping')).rejects.toBe(failure);
  });
});
