/** Persisted challenge modes must remain distinct when their rules change. */
export function challengeModeLabel(mode: string): string {
  return mode === 'endless-table' ? '群體校準' : mode === 'endless' ? '檢測員' : mode;
}
