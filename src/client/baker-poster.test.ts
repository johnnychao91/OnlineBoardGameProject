import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { BakerGame, type BakerState } from '../games/baker/game';
import type { RoomInfo } from './api';
import { buildBakerPosterModel } from './baker-poster';

const info: RoomInfo = { roomId: 'private-room-id', matchID: 'private-match-id', gameName: 'baker-street', status: 'playing',
  numPlayers: 4, minPlayers: 4, maxPlayers: 12, spectatorCount: 0, godViewAllowed: true,
  players: ['甲', '乙', '丙', '丁'].map((name, i) => ({ id: String(i), name, ready: true, isConnected: true })) };
function fixture(): BakerState {
  const match = createMatch({ game: BakerGame, numPlayers: 4, setupData: { startImmediately: true, options: { era: 'modern', year: 2026, cardsPerType: 4, roleSet: 'basic', specialScenes: false, holmesID: '0' } }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  return structuredClone(match.initialState.G) as BakerState;
}

describe('Baker Street public case poster', () => {
  it('never reads private identities, the authoritative solution, future decks or pending special choices', () => {
    const G = fixture();
    for (const field of ['private', 'secret', 'special', 'nextScene', 'solution']) Object.defineProperty(G, field, { get() { throw new Error(`${field} must not be read in an unfinished public poster`); } });
    const model = buildBakerPosterModel({ G, info, step: 1, totalSteps: 8 });
    expect(model.year).toBe(2026); expect(model.players.map(player => player.name)).toEqual(['甲', '乙', '丙', '丁']);
    const text = JSON.stringify(model); expect(text).not.toContain(info.roomId); expect(text).not.toContain(info.matchID);
    expect(model.solution).toBeNull();
  });

  it('copies only final public case data and canonical public event descriptions', () => {
    const G = fixture(); G.status = 'finished'; G.winner = 'police';
    G.solution = { murdererID: '2', meansID: G.players['2'].means[0].id, clueID: G.players['2'].clues[0].id };
    G.log = [{ type: 'accusation', round: 2, actorID: '1', correct: true, message: 'injected-private-detail' }];
    const model = buildBakerPosterModel({ G, info, step: 9, totalSteps: 9 });
    expect(model.solution).toEqual({ murderer: '丙', means: G.players['2'].means[0].name, clue: G.players['2'].clues[0].name });
    expect(model.events[0]).toEqual({ round: 2, actor: '乙', action: '提交破案推論', detail: '推論成立' });
    expect(JSON.stringify(model)).not.toContain('injected-private-detail');
  });

  it('bounds counters and strips control characters and links from public names', () => {
    const G = fixture(); G.round = -3;
    const tainted = { ...info, players: [{ id: '0', name: '\u202e測試\nhttps://example.com/private-value', ready: true, isConnected: true }] };
    const model = buildBakerPosterModel({ G, info: tainted, step: Infinity, totalSteps: -3 });
    expect(model.round).toBe(0); expect(model.step).toBe(1); expect(model.totalSteps).toBe(1);
    expect(JSON.stringify(model)).not.toContain('https:'); expect(JSON.stringify(model)).not.toContain('\u202e');
  });
});
