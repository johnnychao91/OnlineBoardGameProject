import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AuthSession, RoomInfo } from './api';
import { RoomContext } from './room-context';
import { TuringQuestionFeedback } from './TuringQuestionFeedback';

const question = { id: 'standard-0001', category: '示範', prompt: '分享本輪情境的感想。', low: '極度期待', high: '完全不期待' };
const info: RoomInfo = { roomId: 'room-example', matchID: 'match-example', gameName: 'turing-test', status: 'sorting',
  numPlayers: 2, minPlayers: 2, maxPlayers: 9, players: [], spectatorCount: 1, godViewAllowed: true };
const player: AuthSession = { ...info, playerID: '0', credentials: 'private-player-credential' };
const spectator: AuthSession = { ...info, access: 'spectator', observerID: 'watch-example', credentials: 'private-observer-credential' };
const render = (seat?: AuthSession) => renderToStaticMarkup(createElement(RoomContext.Provider, {
  value: seat ? { seat, info, inviteUrl: 'private-invite', setInviteUrl() {} } : null,
}, createElement(TuringQuestionFeedback, { question, round: 1 })));

describe('Turing question rating control visibility', () => {
  it('only renders controls for live seated players, never detached replays or observers', () => {
    expect(render()).toBe('');
    expect(render(spectator)).toBe('');
    const html = render(player);
    expect(html).toContain('aria-label="讚題目主題"');
    expect(html).toContain('aria-label="倒讚題目主題"');
    expect(html).toContain('1 的敘述');
    expect(html).toContain('10 的敘述');
    expect(html).not.toContain(player.credentials);
    expect(html).not.toContain('private-invite');
  });
});
