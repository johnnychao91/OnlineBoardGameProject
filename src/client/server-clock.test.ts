import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });
describe('server clock display', () => {
  it('uses elapsed monotonic time even when the device clock is wrong or changes', async () => {
    const { sampleServerClock, serverNow } = await import('./server-clock');
    vi.spyOn(Date, 'now').mockReturnValue(123);
    const clock = vi.spyOn(performance, 'now').mockReturnValue(100);
    sampleServerClock('1800000000000', 60, 100);
    expect(serverNow()).toBe(1800000000020);
    clock.mockReturnValue(2100);
    expect(serverNow()).toBe(1800000002020);
  });
  it('ignores absent, invalid and severely delayed samples', async () => {
    const { sampleServerClock, serverNow } = await import('./server-clock');
    vi.spyOn(Date, 'now').mockReturnValue(456);
    vi.spyOn(performance, 'now').mockReturnValue(100);
    for (const value of [null, 'NaN', '-1', '123abc', 'Infinity']) sampleServerClock(value, 0, 100);
    sampleServerClock('1800000000000', 0, 6000);
    expect(serverNow()).toBe(456);
  });
});
