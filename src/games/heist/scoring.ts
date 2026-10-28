import { HEIST_ARTIFACTS } from './content';
import type { HeistState } from './game';

/** Public act income includes banked loot and the value of collected artifacts. */
export function heistRoundIncome(G: HeistState, id: string, round: number): number {
  return G.log.filter(entry => entry.round === round && entry.type === 'exit').reduce((sum, entry) =>
    sum + (entry.returns ?? []).filter(result => result.playerID === id).reduce((total, result) =>
      total + result.bankedDelta + result.artifacts.reduce((value, artifact) => value + HEIST_ARTIFACTS[artifact].value, 0), 0), 0);
}
