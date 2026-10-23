import { describe, expect, it } from 'vitest';
import type { TuringState } from '../games/turing/game';
import type { RoomInfo } from './api';
import { buildTuringPosterModel } from './turing-poster';

const info: RoomInfo = { roomId: 'test-room', matchID: 'test-match', gameName: 'turing-test', status: 'sorting', numPlayers: 4, minPlayers: 4, maxPlayers: 9, spectatorCount: 0, godViewAllowed: true,
  players: ['0', '1', '2', '3'].map(id => ({ id, name: `成員 ${id}`, isConnected: true, ready: true })) };
function fixture(): TuringState {
  return { rulesVersion: 1, status: 'sorting', players: Object.fromEntries(info.players.map(p => [p.id, { ready: true, acknowledged: false, answered: true }])),
    private: { '1': { number: 2, answer: '已公開的回答' }, '2': { number: 6, answer: 'sealed-private-marker' }, '3': { number: 8 } },
    round: 2, targetRounds: 5, integrity: 3, maxIntegrity: 4, examinerID: '0',
    question: { id: 'custom-0001', category: '自訂', prompt: '替機器人設計一句登場台詞。', low: '低調', high: '張揚' },
    answers: { '1': '已公開的回答' }, revealed: [{ playerID: '1', number: 2, error: false }], epoch: 9,
    options: { deck: 'custom', customQuestions: [{ prompt: 'future-question-marker', low: '私', high: '密' }] },
    winner: null, winReason: null, log: [], secretQuestionQueue: [{ id: 'secret', category: 'future', prompt: 'future-queue-marker', low: '私', high: '密' }] };
}
describe('Turing public poster projection', () => {
  it('produces the same public model from blind, player and god frames, excluding future questions and sealed answers', () => {
    const G = fixture(), args = { info, step: 4, totalSteps: 15 };
    const expected = buildTuringPosterModel({ ...args, G: { ...G, private: {}, secretQuestionQueue: undefined } });
    expect(buildTuringPosterModel({ ...args, G })).toEqual(expected);
    expect(buildTuringPosterModel({ ...args, G: { ...G, private: { '2': G.private['2'] } } })).toEqual(expected);
    expect(expected.latest).toEqual({ name: '成員 1', number: 2, error: false, answer: '已公開的回答' });
    expect(JSON.stringify(expected)).not.toMatch(/private|future|secret|test-room|test-match/);
  });
  it('does not use private fallback answers before a reveal, and cleans URLs and controls from public writing', () => {
    const G = fixture(); G.answers['1'] = '\u202e一句話 https://example.com/?token=hidden\u0000';
    const model = buildTuringPosterModel({ G, info, step: 1, totalSteps: 2 });
    expect(model.latest?.answer).toBe('一句話 …');
    G.revealed = []; G.answers = {};
    expect(buildTuringPosterModel({ G, info, step: 1, totalSteps: 2 }).latest).toBeNull();
  });
  it('labels voice cards independently and reports completed endless levels without inventing a transcript', () => {
    const G = fixture(); G.rulesVersion = 2; G.targetRounds = null; G.completedRounds = 8; G.round = 9;
    G.status = 'finished'; G.winner = 'system'; G.integrity = 0; G.maxIntegrity = 5;
    delete G.players['3'];
    G.revealed = [{ playerID: '1', cardID: '1-b', slot: 'B', number: 2, error: true }];
    G.answers['1'] = 'unrecorded-voice-marker';
    const args = { G, info, step: 1, totalSteps: 2 };
    const model = buildTuringPosterModel(args);
    expect(model.roundLabel).toBe('無盡 · 第 9 關');
    expect(model.result).toBe('挑戰結束 · 已完成 8 關');
    expect(model.latest?.name).toBe('成員 1 · B');
    expect(model.latest?.answer).toContain('不錄音');
    expect(JSON.stringify(model)).not.toMatch(/unrecorded-voice-marker|private|future|secret/);
    expect(buildTuringPosterModel({ ...args, G: { ...G, private: {}, secretQuestionQueue: undefined } })).toEqual(model);
  });
  it('shows the shared table order and consent without disclosing anyone’s unrevealed number', () => {
    const G = fixture(); G.rulesVersion = 3; delete G.players['3']; G.examinerID = '';
    G.tableOrder = ['2', '0', '1']; G.orderApprovals = ['0']; G.revealed = [];
    const args = { G, info, step: 2, totalSteps: 8 };
    const model = buildTuringPosterModel(args);
    expect(model.voice).toBe(true); expect(model.shared).toBe(true);
    expect(model.examiner).toBe('全員共同排序');
    expect(model.table).toEqual({ order: ['成員 2', '成員 0', '成員 1'], approved: 1, total: 3 });
    expect(model.latest).toBeNull(); expect(model.sequence).toEqual([]);
    expect(buildTuringPosterModel({ ...args, G: { ...G, private: {}, secretQuestionQueue: undefined } })).toEqual(model);
    expect(JSON.stringify(model)).not.toMatch(/sealed-private|future|secret|test-room|test-match/);
    G.revealed = [{ playerID: '2', cardID: '2', slot: 'A', number: 6, error: false }];
    expect(buildTuringPosterModel(args).latest?.name).toBe('成員 2');
  });
});
