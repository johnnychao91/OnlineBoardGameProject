import { describe, expect, it } from 'vitest';
import { fogObserverView, type FogState } from '../games/fog/game';
import { DEFAULT_FOG_OPTIONS } from '../games/fog/rules';
import { buildFogPosterModel } from './fog-poster';

function fixture(): FogState {
  return {
    rulesVersion: 1, status: 'quest-review', options: { ...DEFAULT_FOG_OPTIONS }, quest: 2, epoch: 9, leaderID: '0', team: ['0', '1', '2'], rejections: 0,
    players: Object.fromEntries(['0', '1', '2', '3', '4'].map(id => [id, { ready: true, acknowledged: false, voteSubmitted: true, questSubmitted: true }])),
    private: { '0': { role: 'merlin', faction: 'knights', knownEvil: ['1', '2'], merlinCandidates: [], ownVote: true, ownQuestCard: 'success' } },
    secret: { bellDeck: ['switch', 'quiet'], votes: { '0': true }, questCards: { '0': 'success', '1': 'fail' } },
    bellHistory: [{ quest: 1, card: 'quiet' }, { quest: 2, card: 'switch' }], bellForecast: [],
    lastVote: null, questResults: [{ quest: 2, team: ['0', '1', '2'], successes: 2, fails: 1, succeeded: false }],
    assassinationTarget: null, winner: null, winReason: null,
    log: [{ type: 'start', quest: 1 }, { type: 'quest', quest: 2, team: ['0', '1', '2'], successes: 2, fails: 1, succeeded: false }],
  };
}
const players = [{ id: '0', name: '提燈人' }, { id: '1', name: '夜巡' }, { id: '2', name: '北風' }];
const position = { step: 7, totalSteps: 11 };
describe('black-fog public poster projection', () => {
  it('is identical in all perspectives and retains only anonymous quest counts', () => {
    const G = fixture();
    const model = buildFogPosterModel({ G, players, ...position });
    expect(model).toEqual(buildFogPosterModel({ G: fogObserverView(G, 'blind'), players, ...position }));
    expect(model).toEqual(buildFogPosterModel({ G: fogObserverView(G, 'god'), players, ...position }));
    expect(model.latest).toMatchObject({ type: 'quest', team: ['提燈人', '夜巡', '北風'], successes: 2, fails: 1 });
    expect(JSON.stringify(model)).not.toMatch(/merlin|knownEvil|ownVote|ownQuestCard|bellDeck|questCards/);
  });
  it('never reads role, private vote, random deck or future forecast data', () => {
    const G = fixture();
    for (const key of ['private', 'secret', 'bellForecast', 'bellHistory']) Object.defineProperty(G, key, { get() { throw new Error(`secret field read: ${key}`); } });
    expect(() => buildFogPosterModel({ G, players, ...position })).not.toThrow();
  });
  it('does not carry contaminated nested fields, access identifiers or arbitrary metadata', () => {
    const G = fixture(); const marker = 'never-share-private-token';
    const dirty = { ...G, roomId: marker, credentials: marker, log: G.log.map(event => ({ ...event, role: marker, privateVote: marker })), questResults: G.questResults.map(result => ({ ...result, private: marker })) } as FogState;
    const result = buildFogPosterModel({ G: dirty, players: players.map(player => ({ ...player, credentials: marker })), ...position });
    expect(result).toEqual(buildFogPosterModel({ G, players, ...position }));
    expect(JSON.stringify(result)).not.toContain(marker);
  });
  it('cleans controls, URLs and long Unicode names at code point boundaries', () => {
    const G = fixture(); const longName = '🕯巡夜'.repeat(20);
    const result = buildFogPosterModel({ G, players: [{ id: '0', name: `\u202e${longName}` }, { id: '1', name: '夜巡\u2066 https://example.com/private?token=x' }], ...position });
    expect(result.latest?.team[0]).toBe(Array.from(longName).slice(0, 28).join(''));
    expect(result.latest?.team[1]).toBe('夜巡 …');
    expect(JSON.stringify(result)).not.toMatch(/https|token|\\u202e|\\u2066/);
  });
  it('shows the last public action after a finish event and never treats ongoing as won', () => {
    const G = fixture(); G.log.push({ type: 'finish', quest: 2, winner: 'apostles', reason: 'three-fails' });
    expect(buildFogPosterModel({ G, players, ...position }).outcome).toBe('ongoing');
    G.status = 'finished'; G.winner = 'apostles';
    const model = buildFogPosterModel({ G, players, ...position });
    expect(model.outcome).toBe('apostles'); expect(model.latest?.type).toBe('quest');
  });
});
