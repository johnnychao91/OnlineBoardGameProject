import { Client } from 'boardgame.io/client';
import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { BanquetGame, banquetObserverView, banquetPlayerView, type BanquetRole, type BanquetState } from '../games/banquet/game';
import type { RoomInfo } from './api';
import { buildBanquetPosterModel } from './banquet-poster';

describe('Hundred Ghosts poster from actual engine events and authorized projections', () => {
  it('exports claim responses, private inspections and public seat changes identically from every perspective', () => {
    const participantIDs = ['0', '2', '4', '6', '8', '10'];
    const customRoles: BanquetRole[] = ['judge', 'king', 'empress', 'spy', 'puppeteer', 'princess', 'widow', 'fool'];
    const game = { ...BanquetGame, seed: 'banquet-poster-real-actions' };
    const client = Client({ game, numPlayers: participantIDs.length, playerID: participantIDs[0], debug: false });
    const match = createMatch({ game, numPlayers: participantIDs.length, setupData: {
      startImmediately: true, participantIDs, options: { scenario: 'custom', customRoles },
    }, unlisted: true });
    if ('setupDataError' in match) throw new Error(match.setupDataError);
    client.store.dispatch({ type: 'UPDATE', state: match.initialState, deltalog: [], clientOnly: true });
    const info: RoomInfo = {
      roomId: 'poster-room', matchID: 'poster-match', gameName: 'hundred-ghosts', status: 'playing',
      numPlayers: participantIDs.length, minPlayers: 4, maxPlayers: 12, spectatorCount: 1, godViewAllowed: true,
      players: participantIDs.map(id => ({ id, name: `賓客 ${id}`, isConnected: true, ready: true })),
    };
    const raw = () => client.store.getState().G as BanquetState;
    function act(id: string, move: string, ...args: unknown[]) {
      const before = client.store.getState()._stateID;
      client.updatePlayerID(id); client.moves[move](...args, raw().epoch);
      expect(client.store.getState()._stateID, `${move} by ${id}`).toBe(before + 1);
    }
    function finishResponses() {
      while (raw().claim && raw().claim!.responseIndex < raw().claim!.responderIDs.length) {
        act(raw().claim!.responderIDs[raw().claim!.responseIndex], 'respondClaim', false);
      }
    }
    function assertPublicPoster(eventType: string, action: string) {
      const G = raw(), before = structuredClone(G);
      expect(G.log.at(-1)?.type).toBe(eventType);
      const options = { info, step: G.epoch, totalSteps: G.epoch };
      const publicState = banquetObserverView(G, 'blind');
      const godState = banquetObserverView(G, 'god');
      expect(publicState.private).toEqual({}); expect(publicState.currentMasks).toBeUndefined();
      expect(Object.keys(godState.private)).toEqual(participantIDs);
      expect(godState.currentMasks?.players).toHaveProperty(participantIDs[0]);
      const expected = buildBanquetPosterModel({ ...options, G: publicState });
      expect(expected.events.at(-1)?.action).toBe(action);
      expect(expected.events.some(event => event.action === '夜宴公開事件')).toBe(false);
      expect(buildBanquetPosterModel({ ...options, G })).toEqual(expected);
      expect(buildBanquetPosterModel({ ...options, G: godState })).toEqual(expected);
      for (const playerID of participantIDs) {
        const playerState = banquetPlayerView({ G, playerID });
        expect(Object.keys(playerState.private)).toEqual([playerID]);
        expect(buildBanquetPosterModel({ ...options, G: playerState })).toEqual(expected);
      }
      expect(JSON.stringify(expected)).not.toMatch(/"(?:secret|private|currentMasks|observerMemory|initialLayout|pending|claim|role|location|choices|credentials)"\s*:|\.webp|\.png/);
      expect(G).toEqual(before);
      return expected;
    }

    for (const id of participantIDs) act(id, 'acknowledge');
    for (let index = 0; index < 4; index++) act(raw().activePlayer!, 'exchange', `center:${index % 2}`, index % 2 === 0);
    expect(raw().initialTurnsRemaining).toBe(0);

    const spy = raw().activePlayer!;
    act(spy, 'announce', 'spy');
    const responder = raw().claim!.responderIDs[0];
    act(responder, 'respondClaim', false);
    const responsePoster = assertPublicPoster('claim-response', '回應面具認領');
    expect(responsePoster.events.at(-1)?.actor).toBe(`賓客 ${responder}`);
    finishResponses();
    expect(raw().pending?.kind).toBe('spy-target');
    const target = participantIDs.find(id => id !== spy)!;
    act(spy, 'choose', [target]);
    expect(raw().pending?.kind).toBe('swap');
    expect(raw().private[spy].memory.slice(-2).every(entry => entry.source === 'spy')).toBe(true);
    expect(raw().secret!.observerMemory.some(entry => entry.source === 'spy')).toBe(false);
    assertPublicPoster('inspect', '百目鬼私下查驗');
    act(spy, 'choose', ['swap']);
    assertPublicPoster('exchange', '進行一次盲換');

    const puppeteer = raw().activePlayer!;
    act(puppeteer, 'announce', 'puppeteer'); finishResponses();
    expect(raw().pending?.kind).toBe('puppeteer-targets');
    const targets = participantIDs.filter(id => id !== puppeteer).slice(0, 2);
    act(puppeteer, 'choose', targets);
    expect(raw().turnOrder).not.toEqual(participantIDs);
    const seatsPoster = assertPublicPoster('seats', '絡新婦交換座次');
    expect(seatsPoster.players.map(player => player.name)).toEqual(raw().turnOrder.map(id => `賓客 ${id}`));
    expect(seatsPoster.players.map(player => player.coins)).toEqual(raw().turnOrder.map(id => raw().players[id].coins));
  });
});
