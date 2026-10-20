import { describe, expect, it } from 'vitest';
import type { CipherState } from '../games/cipher/game';
import { buildCipherPosterModel } from './cipher-poster';

function fixture(): CipherState {
  return {
    rulesVersion: 1, status: 'playing', level: 3, targetLevel: 12,
    cover: 2, pulses: 1, epoch: 8, winner: null, winReason: null, pulse: null,
    players: {
      '0': { ready: true, acknowledged: false, cardCount: 1 },
      '1': { ready: true, acknowledged: false, cardCount: 1 },
    },
    private: { '0': { cards: [97] }, '1': { cards: [99] } },
    transmitted: [12, 51], discarded: [{ playerID: '1', card: 34 }],
    log: [
      { type: 'transmit', level: 3, actorID: '0', card: 51 },
      { type: 'breach', level: 3, actorID: '0', card: 51, discarded: [{ playerID: '1', card: 34 }], cover: 2 },
    ],
  };
}

const players = [{ id: '0', name: '信鴿' }, { id: '1', name: '夜鷹' }];
const position = { step: 4, totalSteps: 12 };

describe('encrypted-call public poster projection', () => {
  it('renders identical public data from blind, player and god perspectives', () => {
    const god = fixture();
    const blind = { ...god, private: {} };
    const player = { ...god, private: { '0': god.private['0'] } };
    const expected = buildCipherPosterModel({ G: blind, players, ...position });
    expect(buildCipherPosterModel({ G: god, players, ...position })).toEqual(expected);
    expect(buildCipherPosterModel({ G: player, players, ...position })).toEqual(expected);
    const serialized = JSON.stringify(expected);
    expect(serialized).not.toContain('97');
    expect(serialized).not.toContain('99');
    expect(expected.latest).toMatchObject({
      type: 'breach', actor: '信鴿', card: 51,
      discarded: [{ owner: '夜鷹', card: 34 }],
    });
  });

  it('does not carry future secret fields from any nested input into the model', () => {
    const G = fixture();
    const secret = 'never-export-test-marker';
    const contaminated = {
      ...G, roomId: secret, credentials: secret, invite: secret, secretDeck: [secret],
      private: { ...G.private, secret },
      log: G.log.map(event => ({
        ...event, secret,
        discarded: event.discarded?.map(card => ({ ...card, secret })),
      })),
    } as unknown as CipherState;
    const namedPlayers = players.map(player => ({ ...player, credentials: secret, membershipID: secret }));
    const result = buildCipherPosterModel({ G: contaminated, players: namedPlayers, ...position });
    expect(result).toEqual(buildCipherPosterModel({ G, players, ...position }));
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result).not.toHaveProperty('private');
    expect(result).not.toHaveProperty('roomId');
  });

  it('sanitizes control characters and URLs and truncates Unicode names at code-point boundaries', () => {
    const G = fixture();
    const longName = '🕵️特務'.repeat(20);
    const result = buildCipherPosterModel({
      G,
      players: [
        { id: '0', name: `\u0000\u202e${longName}` },
        { id: '1', name: '夜鷹\u2066\nhttps://example.com/private?token=test\u0001' },
      ],
      ...position,
    });
    expect(Array.from(result.latest!.actor)).toHaveLength(28);
    expect(result.latest!.actor).toBe(Array.from(longName).slice(0, 28).join(''));
    expect(result.latest!.discarded[0].owner).toBe('夜鷹 …');
    expect(JSON.stringify(result)).not.toMatch(/https|token|\\u0000|\\u202e|\\u2066/);
  });

  it('keeps the last public operation when a level result follows it', () => {
    const G = fixture();
    G.log.push({ type: 'level-complete', level: 3, cover: 3, pulses: 1 });
    G.status = 'finished';
    G.winner = 'agents';
    const model = buildCipherPosterModel({ G, players, ...position });
    expect(model.latest?.type).toBe('breach');
    expect(model.outcome).toBe('success');
  });
});
