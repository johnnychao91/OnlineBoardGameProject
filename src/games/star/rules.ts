export type StarOptions = Record<string, never>;
export function normalizeStarOptions(value?: unknown): StarOptions { return {}; }
export function validateStarOptions(value: unknown, count?: number): string | undefined {
  if (count !== undefined && (!Number.isInteger(count) || count < 2 || count > 4)) return '星匠工坊需要 2 至 4 位玩家。';
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 0)) return '星匠工坊採固定基本玩法。';
  return undefined;
}
