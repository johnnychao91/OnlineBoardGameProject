import { CreateGameReducer, createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { FirewallGame, firewallObserverView, firewallPlayerView, legalFirewallActions } from '../games/firewall/game';
import type { FirewallState } from '../games/firewall/types';
import type { RoomInfo } from './api';
import { buildFirewallPosterModel } from './firewall-poster';

describe('Firewall poster over real three-round events and authorized projections', () => {
  it('keeps actual hand, inspection, draw and wealth changes private until final public scores', () => {
    const ids = ['0', '3', '7'], game = { ...FirewallGame, seed: 'firewall-poster-complete-rounds' };
    const result = createMatch({ game, numPlayers: ids.length, setupData: { startImmediately: true, participantIDs: ids }, unlisted: true });
    if ('setupDataError' in result) throw new Error(result.setupDataError);
    let state = structuredClone(result.initialState);
    const reducer = CreateGameReducer({ game, isClient: false });
    const info: RoomInfo = { roomId: 'poster-room', matchID: 'poster-match', gameName: 'firewall-breach', status: 'turn', numPlayers: ids.length, minPlayers: 2, maxPlayers: 12, spectatorCount: 1, godViewAllowed: true, players: ids.map(id => ({ id, name: `節點 ${id}`, isConnected: true, ready: true })) };
    const poster = (G: FirewallState) => buildFirewallPosterModel({ G, info, step: 1, totalSteps: 1 });
    let frames = 0, roundReviews = 0, paths = 0, actions = 0, privateWealth = 0;
    function check() {
      const G = state.G as FirewallState, before = structuredClone(G), blind = firewallObserverView(G, 'blind'), god = firewallObserverView(G, 'god'), expected = poster(blind);
      expect(poster(G)).toEqual(expected); expect(poster(god)).toEqual(expected); expect(poster(firewallObserverView(god, 'blind'))).toEqual(expected);
      for (const id of ids) expect(poster(firewallPlayerView({ G, playerID: id }))).toEqual(expected);
      expect(expected.tiles.filter(tile => tile.hidden).every(tile => tile.topology === null && tile.asset === 'card-back')).toBe(true);
      expect(JSON.stringify(expected)).not.toMatch(/"(?:private|secret|goalMemory|roleMemory|hand|roleDeck|goals|credentials)"\s*:/);
      if (G.status !== 'finished') {
        expect(expected.players.every(player => player.score === null && !player.winner)).toBe(true); expect(expected.winners).toEqual([]);
        if (Object.values(G.private).some(player => player.gold > 0)) privateWealth++;
      } else expect(expected.players.map(player => player.score)).toEqual(ids.map(id => G.finalScores[id]));
      expect(G).toEqual(before); frames++;
    }
    check();
    for (let step = 0; state.G.status !== 'finished' && step < 650; step++) {
      const G = state.G as FirewallState;
      if (G.status === 'review' && !Object.values(G.players).some(player => player.acknowledged)) roundReviews++;
      const id = ['briefing', 'review'].includes(G.status) ? ids.find(id => !G.players[id].acknowledged)! : G.activePlayer!;
      const legal = legalFirewallActions(firewallPlayerView({ G, playerID: id }), id);
      const chosen = ['briefing', 'review', 'theft'].includes(G.status) ? legal[0]
        : step % 4 === 0 ? legal.find(action => action.move === 'placePath') ?? legal.find(action => action.move === 'playAction') ?? legal[0]
        : step % 4 === 1 ? legal.find(action => action.move === 'playAction') ?? legal.find(action => action.move === 'discard' && (action.args[0] as string[]).length === 3) ?? legal[0]
        : legal.find(action => action.move === 'discard' && (action.args[0] as string[]).length === 3) ?? legal[0];
      expect(chosen, `${G.status} ${id} must progress`).toBeTruthy();
      if (chosen.move === 'placePath') paths++; if (chosen.move === 'playAction') actions++;
      const next = reducer(state, { type: 'MAKE_MOVE', payload: { type: chosen.move, args: chosen.args, playerID: id } });
      expect(next._stateID).toBe(state._stateID + 1); state = structuredClone(next); check();
    }
    expect(state.G.status).toBe('finished'); expect(state.G.round).toBe(3); expect(roundReviews).toBe(3); expect(paths).toBeGreaterThan(0); expect(actions).toBeGreaterThan(0); expect(privateWealth).toBeGreaterThan(0); expect(frames).toBeGreaterThan(100);
  });
});
