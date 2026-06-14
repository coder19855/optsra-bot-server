import { withTimeout, yieldToEventLoop } from './promise-timeout';

describe('yieldToEventLoop', () => {
  it('resolves on the next event-loop turn', async () => {
    let ran = false;
    const p = yieldToEventLoop().then(() => {
      ran = true;
    });
    expect(ran).toBe(false);
    await p;
    expect(ran).toBe(true);
  });
});

describe('withTimeout', () => {
  it('resolves when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'test')).resolves.toBe(
      42,
    );
  });

  it('rejects when the promise exceeds the limit', async () => {
    const slow = new Promise<number>((resolve) => {
      setTimeout(() => resolve(1), 50);
    });
    await expect(withTimeout(slow, 10, 'slow op')).rejects.toThrow(
      'slow op timed out after 0s',
    );
  });
});