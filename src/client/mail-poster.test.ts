import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { MailGame, type MailState } from '../games/post/game';
import type { RoomInfo } from './api';
import { buildMailPosterModel } from './mail-poster';

function fixture() {
  const match = createMatch({ game: MailGame, numPlayers: 3, setupData: { startImmediately: true, options: { mode: 'classic', directorID: 'random' } }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  return structuredClone(match.initialState.G) as MailState;
}
const info: RoomInfo = { roomId: 'private-room-id', matchID: 'private-match-id', gameName: 'midnight-post', status: 'playing', numPlayers: 3,
  minPlayers: 2, maxPlayers: 8, spectatorCount: 0, godViewAllowed: true,
  players: ['信使甲', '信使乙', '信使丙'].map((name, index) => ({ id: String(index), name, isConnected: true, ready: true })) };

describe('Midnight Post public poster model', () => {
  it('never reads hands, intel, future draws, room identifiers or pending choices', () => {
    const G = fixture();
    Object.defineProperty(G, 'private', { get() { throw new Error('private must never be read'); } });
    Object.defineProperty(G, 'secret', { get() { throw new Error('future draws must never be read'); } });
    Object.defineProperty(G, 'pending', { get() { throw new Error('pending choices must never be read'); } });
    const model = buildMailPosterModel({ G, info, step: 1, totalSteps: 9 });
    expect(model.players.map(player => player.name)).toEqual(['信使甲', '信使乙', '信使丙']);
    const text = JSON.stringify(model);
    expect(text).not.toContain(info.roomId); expect(text).not.toContain(info.matchID);
    expect(text).not.toContain('private'); expect(text).not.toContain('directorID');
  });

  it('uses explicit public events and final individual winners, without copying arbitrary log text', () => {
    const G = fixture();
    G.status = 'finished'; G.winner = 'delivery'; G.winnerIDs = ['1'];
    G.log = [{ type: 'play', round: 2, actorID: '0', targetID: '1', card: { id: 'public-card-id', role: 'guard' }, message: 'private-injected-text' }];
    const model = buildMailPosterModel({ G, info, step: 5, totalSteps: 5 });
    expect(model.champions).toEqual(['信使乙']); expect(model.outcome).toBe('投遞競賽結束');
    expect(model.events[0]).toEqual({ round: 2, actor: '信使甲', target: '信使乙', action: '打出一張密函', card: { name: '巡街郵差', value: 1 } });
    expect(JSON.stringify(model)).not.toContain('private-injected-text'); expect(JSON.stringify(model)).not.toContain('public-card-id');
  });

  it('cleans names, bounds counters, and keeps unfinished winners out of the model', () => {
    const G = fixture(); G.round = -1; G.deckCount = Infinity; G.winnerIDs = ['0'];
    const tainted = { ...info, players: [{ id: '0', name: '\u202e名字\nhttps://example.com/private-path', isConnected: true, ready: true }] };
    const model = buildMailPosterModel({ G, info: tainted, step: Infinity, totalSteps: -3 });
    expect(model.round).toBe(0); expect(model.deckCount).toBe(0); expect(model.step).toBe(1); expect(model.totalSteps).toBe(1);
    expect(model.champions).toEqual([]); expect(JSON.stringify(model)).not.toContain('https:'); expect(JSON.stringify(model)).not.toContain('\u202e');
  });
});
