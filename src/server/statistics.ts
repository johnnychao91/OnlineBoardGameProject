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
  }));
  let totalPlayerParticipations = 0;
  for (const room of rooms.rooms.values()) {
    // All matches in a test room stay excluded, even after switching games or removing bots.
    if (room.testRoom) continue;
    for (const matchID of roomMatchIDs(room)) {
      const gameId = matchGameID(room, matchID);
      const definition = gameDefinitions.find((game) => game.id === gameId);
      if (!definition) continue;
      const { state } = await db.fetch(matchID, { state: true });
      if (!state) continue;
      const outcome = definition.getOutcome(state.G);
      if (!outcome) continue;
      const summary = byGame.find((game) => game.gameId === gameId)!;
      const numPlayers = state.ctx.numPlayers;
      summary.completed += 1;
      totalPlayerParticipations += numPlayers;
      // A survival challenge always ends when its lives run out. Record its
      // progress independently instead of turning every run into a ranked loss.
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
    game.challenges.sort((a, b) => a.mode.localeCompare(b.mode) || a.numPlayers - b.numPlayers || a.startingLives - b.startingLives);
  });
  return { completedGames: byGame.reduce((sum, game) => sum + game.completed, 0), totalPlayerParticipations, byGame };
}
