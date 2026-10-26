import { describe, expect, it } from 'vitest';
import { collectStatistics } from './statistics';
import type { FileStorage } from './storage';
import type { RoomRecord, RoomStore } from './rooms';

describe('Challenge score aggregation', () => {
  it('groups individual competitions by rules and player count without treating a champion as a public faction', async () => {
    const finished = (mode: string, count: number, rounds: number) => ({ ctx: { numPlayers: count }, G: {
      status: 'finished', mode, round: rounds, winner: mode === 'black-letter' ? 'couriers' : 'delivery',
      winReason: mode === 'black-letter' ? 'director-defeated' : 'delivery-champion', directorID: '7',
      players: Object.fromEntries(Array.from({ length: count }, (_, i) => [String(7 + i), {}])),
    } });
    const states = new Map([
      ['a', finished('classic', 3, 8)], ['b', finished('classic', 3, 9)], ['c', finished('classic', 4, 12)],
      ['d', finished('premium', 8, 15)], ['e', finished('black-letter', 3, 1)], ['test', finished('premium', 8, 90)],
    ]);
    const room = (ids: string[], testRoom = false) => ({ roomId: ids[0], gameId: 'midnight-post', testRoom,
      currentMatchID: ids.at(-1), history: ids.map(matchID => ({ matchID, gameName: 'midnight-post', ending: 'completed' })),
    } as RoomRecord);
    const rooms = { rooms: new Map([['main', room(['a', 'b', 'c', 'd', 'e'])], ['test', room(['test'], true)]]) } as RoomStore;
    const db = { fetch: async (id: string) => ({ state: states.get(id) }) } as unknown as FileStorage;
    const result = await collectStatistics(db, rooms), summary = result.byGame.find(game => game.gameId === 'midnight-post')!;
    expect(result).toMatchObject({ completedGames: 5, totalPlayerParticipations: 21 });
    expect(summary).toMatchObject({ completed: 5, rankedCompleted: 1, wins: { couriers: 1 },
      byPlayerCount: [{ numPlayers: 3, completed: 1, draws: 0, wins: { couriers: 1 } }],
      competitions: [
        { mode: 'classic', numPlayers: 3, runs: 2, totalRounds: 17, averageRounds: 8.5 },
        { mode: 'classic', numPlayers: 4, runs: 1, totalRounds: 12, averageRounds: 12 },
        { mode: 'premium', numPlayers: 8, runs: 1, totalRounds: 15, averageRounds: 15 },
      ],
    });
    expect(summary.wins).not.toHaveProperty('delivery');
    expect(summary.reasons).toEqual({ 'director-defeated': 1 });
    expect(await collectStatistics(db, rooms)).toEqual(result);
  });
  it('separates life and player-count groups from ranked wins, includes zero scores and counts each stored match only once', async () => {
    const state = (count: number, rounds: number, lives: number, endless = true, rulesVersion = 2) => ({
      ctx: { numPlayers: count }, G: { rulesVersion, status: 'finished', players: Object.fromEntries(Array.from({ length: count }, (_, id) => [id, {}])),
        winner: endless ? 'system' : 'humans', winReason: endless ? 'endless-exhausted' : 'calibrated',
        options: { mode: endless ? 'endless' : 'standard' }, completedRounds: rounds, maxIntegrity: lives },
    });
    const states = new Map<string, unknown>([
      ['normal', state(2, 5, 3, false)], ['zero', state(2, 0, 1)], ['six', state(2, 6, 1)],
      ['eight', state(2, 8, 1)], ['more-lives', state(2, 12, 5)], ['three-players', state(3, 7, 1)],
      ['table', state(2, 4, 1, true, 3)],
      ['test', state(2, 99, 1)], ['ongoing', { ...state(2, 5, 1), G: { status: 'round-review' } }],
    ]);
    const room = (id: string, matchIDs: string[], testRoom = false) => ({
      roomId: id, gameId: 'turing-test', testRoom, currentMatchID: matchIDs.at(-1),
      history: matchIDs.map(matchID => ({ matchID, gameName: 'turing-test', ending: 'completed' })),
    } as RoomRecord);
    const rooms = { rooms: new Map([
      ['main', room('main', ['normal', 'zero', 'six', 'eight', 'more-lives', 'three-players', 'table'])],
      ['test', room('test', ['test'], true)], ['ongoing', room('ongoing', ['ongoing'])],
    ]) } as RoomStore;
    const db = { fetch: async (id: string) => ({ state: states.get(id) }) } as unknown as FileStorage;
    const result = await collectStatistics(db, rooms);
    expect(result).toMatchObject({ completedGames: 7, totalPlayerParticipations: 15 });
    const summary = result.byGame.find(game => game.gameId === 'turing-test')!;
    expect(summary).toMatchObject({ completed: 7, rankedCompleted: 1, wins: { humans: 1 }, reasons: { calibrated: 1 },
      byPlayerCount: [{ numPlayers: 2, completed: 1, draws: 0, wins: { humans: 1 } }],
      challenges: [
        { mode: 'endless', numPlayers: 2, startingLives: 1, runs: 3, bestCompletedRounds: 8, totalCompletedRounds: 14, averageCompletedRounds: 4.67 },
        { mode: 'endless', numPlayers: 2, startingLives: 5, runs: 1, bestCompletedRounds: 12, averageCompletedRounds: 12 },
        { mode: 'endless', numPlayers: 3, startingLives: 1, runs: 1, bestCompletedRounds: 7, averageCompletedRounds: 7 },
        { mode: 'endless-table', numPlayers: 2, startingLives: 1, runs: 1, bestCompletedRounds: 4, averageCompletedRounds: 4 },
      ] });
    expect(await collectStatistics(db, rooms)).toEqual(result);
  });
});
