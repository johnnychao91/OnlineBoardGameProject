// Estimate the server clock from same-origin HTTP responses. Only display uses
// this clock; rules and deadlines are always enforced by the server itself.
let sample: { server: number; monotonic: number } | undefined;
export function sampleServerClock(value: string | null, sent: number, received: number): void {
  if (!value || !/^\d{10,16}$/.test(value)) return;
  const timestamp = Number(value), elapsed = received - sent;
  if (!Number.isSafeInteger(timestamp) || elapsed < 0 || elapsed > 5000) return;
  sample = { server: timestamp + elapsed / 2, monotonic: received };
}
export function serverNow(): number {
  return sample ? sample.server + performance.now() - sample.monotonic : Date.now();
}
