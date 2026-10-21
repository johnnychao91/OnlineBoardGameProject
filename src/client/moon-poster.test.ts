import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { MoonGame, moonObserverView, type MoonState } from '../games/moon/game';
import { buildMoonPosterModel } from './moon-poster';

function fixture(): MoonState {
  const match = createMatch({ game: MoonGame, numPlayers: 6, setupData: { startImmediately: true }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  const G = structuredClone(match.initialState.G) as MoonState;
  G.status = 'vote-review'; G.sheriffID = '0'; G.players['3'].alive = false;
  G.log.push({ type: 'vote', day: 1, targetID: '3', votes: { '0': '3', '1': '3', '2': null }, weights: { '0': 3, '1': 2, '2': 2 } });
  return G;
}
const players = [{ id: '0', name: '提燈人' }, { id: '1', name: '旅人' }, { id: '2', name: '紅座椅' }, { id: '3', name: '月光' }];
const position = { step: 7, totalSteps: 12 };
describe('Silver Moon public poster allowlist', () => {
  it('produces the same model from server, blind and god frames', () => {
    const G = fixture(), model = buildMoonPosterModel({ G, players, ...position });
    expect(model).toEqual(buildMoonPosterModel({ G: moonObserverView(G, 'blind'), players, ...position }));
    expect(model).toEqual(buildMoonPosterModel({ G: moonObserverView(G, 'god'), players, ...position }));
    expect(model.latest?.ballots[0]).toEqual({ voter: '提燈人', target: '月光', weight: 1.5 });
    expect(JSON.stringify(model)).not.toMatch(/knownWolves|nightChoice|attackedID|antidote|secret|checks/);
  });
  it('never reads private roles, current choices or secret state', () => {
    const G = fixture();
    for (const key of ['private', 'secret', 'lastVote']) Object.defineProperty(G, key, { get() { throw new Error(`Forbidden field ${key}`); } });
    for (const player of Object.values(G.players)) Object.defineProperty(player, 'revealedRole', { get() { throw new Error('Role read'); } });
    expect(() => buildMoonPosterModel({ G, players, ...position })).not.toThrow();
  });
  it('ignores arbitrary metadata and nested private fields', () => {
    const G = fixture(), marker = 'never-share-private-token';
    const dirty = { ...G, credentials: marker, log: G.log.map(entry => ({ ...entry, private: marker })) } as MoonState;
    const model = buildMoonPosterModel({ G: dirty, players: players.map(player => ({ ...player, credentials: marker })), ...position });
    expect(model).toEqual(buildMoonPosterModel({ G, players, ...position }));
    expect(JSON.stringify(model)).not.toContain(marker);
  });
  it('cleans control characters, URLs and long Unicode names', () => {
    const G = fixture(); const longName = '🚂旅人'.repeat(20);
    const model = buildMoonPosterModel({ G, players: [{ id: '0', name: `\u202e${longName}` }, { id: '3', name: '月光 https://example.com/private?token=x' }], ...position });
    expect(model.sheriff).toBe(Array.from(longName).slice(0, 24).join(''));
    expect(model.latest?.target).toBe('月光 …'); expect(JSON.stringify(model)).not.toMatch(/https|token|\\u202e/);
  });
  it('never declares an ongoing game won and keeps the last public event after finish', () => {
    const G = fixture(); G.winner = 'town';
    expect(buildMoonPosterModel({ G, players, ...position }).outcome).toBe('ongoing');
    G.status = 'finished'; G.log.push({ type: 'finish', day: 1, winner: 'town' });
    const model = buildMoonPosterModel({ G, players, ...position });
    expect(model.outcome).toBe('town'); expect(model.latest?.type).toBe('vote');
  });
});
