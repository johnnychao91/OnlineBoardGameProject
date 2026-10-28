import { heistRoundIncome } from '../games/heist/scoring';
import type { HeistState } from '../games/heist/game';
import { gameDefinitions } from '../games/registry';
import type { FileStorage } from './storage';
import { matchGameID, roomMatchIDs, type RoomStore } from './rooms';

/** Derive each completed match once, so reconnects and restarts cannot double-count wins. */
export async function collectStatistics(db: FileStorage, rooms: RoomStore) {
  const byGame = gameDefinitions.map((definition) => ({
    gameId: definition.id, name: definition.name, completed: 0, rankedCompleted: 0, draws: 0,
    wins: {} as Record<string, number>, reasons: {} as Record<string, number>,
    byPlayerCount: [] as { numPlayers: number; completed: number; draws: number; wins: Record<string, number> }[],
    challenges: [] as { mode: string; numPlayers: number; startingLives: number; runs: number; bestCompletedRounds: number; totalCompletedRounds: number; averageCompletedRounds: number }[],
    competitions: [] as { mode: string; numPlayers: number; runs: number; totalRounds: number; averageRounds: number; highScores?: { name: string; total: number }[]; roundHighScores?: { name: string; total: number; round: number }[] }[],
  }));
  let totalPlayerParticipations = 0;
  for (const room of rooms.rooms.values()) {
    // All matches in a test room stay excluded, even after switching games or removing bots.
    if (room.testRoom) continue;
    for (const matchID of roomMatchIDs(room)) {
      const gameId = matchGameID(room, matchID);
      const definition = gameDefinitions.find((game) => game.id === gameId);
      if (!definition) continue;
      const { state, metadata } = await db.fetch(matchID, { state: true, ...(gameId === 'curtain-heist' ? { metadata: true } : {}) });
      if (!state) continue;
      const outcome = definition.getOutcome(state.G);
      if (!outcome) continue;
      const summary = byGame.find((game) => game.gameId === gameId)!;
      const numPlayers = state.ctx.numPlayers;
      summary.completed += 1;
      totalPlayerParticipations += numPlayers;
      // Record challenge progress separately, including voluntary settlement,
      // without treating it as a ranked win or loss.
      if (outcome.challenge) {
        const challenge = outcome.challenge;
        let group = summary.challenges.find(entry => entry.mode === challenge.mode
          && entry.numPlayers === numPlayers && entry.startingLives === challenge.startingLives);
        if (!group) {
          group = { mode: challenge.mode, numPlayers, startingLives: challenge.startingLives, runs: 0,
            bestCompletedRounds: 0, totalCompletedRounds: 0, averageCompletedRounds: 0 };
          summary.challenges.push(group);
        }
        group.runs += 1;
        group.bestCompletedRounds = Math.max(group.bestCompletedRounds, challenge.completedRounds);
        group.totalCompletedRounds += challenge.completedRounds;
        group.averageCompletedRounds = Math.round(group.totalCompletedRounds / group.runs * 100) / 100;
        continue;
      }
      if (outcome.competition) {
        const competition = outcome.competition;
        let group = summary.competitions.find(entry => entry.mode === competition.mode && entry.numPlayers === numPlayers);
        if (!group) {
          group = { mode: competition.mode, numPlayers, runs: 0, totalRounds: 0, averageRounds: 0 };
          summary.competitions.push(group);
        }
        if (gameId === 'curtain-heist') {
          const G = state.G as HeistState;
          const scores = (G.turnOrder ?? Object.keys(G.players)).flatMap(id => {
            const total = G.finalScores?.[id]?.total;
            if (!Number.isSafeInteger(total) || total < 0) return [];
            const name = metadata?.players[Number(id)]?.name;
            return [{ name: typeof name === 'string' && name.trim() ? name : '未命名成員', total }];
          });
          const rounds = [...new Set((G.log ?? []).filter(entry => entry.type === 'round-end').map(entry => entry.round))];
          const actScores = rounds.flatMap(round => (G.turnOrder ?? Object.keys(G.players)).map(id => {
            const name = metadata?.players[Number(id)]?.name;
            return { name: typeof name === 'string' && name.trim() ? name : '未命名成員', round, total: heistRoundIncome(G, id, round) };
          }));
          group.roundHighScores = [...(group.roundHighScores ?? []), ...actScores].sort((a, b) => b.total - a.total).slice(0, 10);
          group.highScores = [...(group.highScores ?? []), ...scores].sort((a, b) => b.total - a.total).slice(0, 10);
        }
        group.runs += 1;
        group.totalRounds += competition.rounds;
        group.averageRounds = Math.round(group.totalRounds / group.runs * 100) / 100;
        continue;
      }
      summary.rankedCompleted += 1;
      if (outcome.winner === 'draw') summary.draws += 1;
      else summary.wins[outcome.winner] = (summary.wins[outcome.winner] || 0) + 1;
      summary.reasons[outcome.reason] = (summary.reasons[outcome.reason] || 0) + 1;
      let group = summary.byPlayerCount.find((entry) => entry.numPlayers === numPlayers);
      if (!group) { group = { numPlayers, completed: 0, draws: 0, wins: {} }; summary.byPlayerCount.push(group); }
      group.completed += 1;
      if (outcome.winner === 'draw') group.draws += 1;
      else group.wins[outcome.winner] = (group.wins[outcome.winner] || 0) + 1;
    }
  }
  byGame.forEach((game) => {
    game.byPlayerCount.sort((a, b) => a.numPlayers - b.numPlayers);
    game.competitions.sort((a, b) => a.mode.localeCompare(b.mode) || a.numPlayers - b.numPlayers);
    game.challenges.sort((a, b) => a.mode.localeCompare(b.mode) || a.numPlayers - b.numPlayers || a.startingLives - b.startingLives);
  });
  return { completedGames: byGame.reduce((sum, game) => sum + game.completed, 0), totalPlayerParticipations, byGame };
}
