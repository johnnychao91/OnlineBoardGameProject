import { CreateGameReducer, createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { StarGame, legalStarActions, starObserverView, starPlayerView, starDiscountedCost, starValidPayment } from '../games/star/game';
import { STAR_CARDS, STAR_COLORS, STAR_TIERS, starTokenTotal } from '../games/star/content';
import type { StarState } from '../games/star/types';
import { buildStarPosterModel } from './star-poster';
import type { RoomInfo } from './api';

describe('Star Workshop poster over actual complete play', () => {
  it('exports identical public models from raw, own, god and blind data while blind designs stay private', () => {
    const ids = ['0', '3', '7'], game = { ...StarGame, seed: 'star-poster-real-engine' };
    const result = createMatch({ game, numPlayers: ids.length, setupData: { startImmediately: true, participantIDs: ids }, unlisted: true });
    if ('setupDataError' in result) throw new Error(result.setupDataError);
    let state = structuredClone(result.initialState), seed = 83;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }, reducer = CreateGameReducer({ game, isClient: false });
    const info: RoomInfo = { roomId: 'poster-room', matchID: 'poster-match', gameName: 'star-workshop', status: 'turn', numPlayers: ids.length, minPlayers: 2, maxPlayers: 4, spectatorCount: 1, godViewAllowed: true, players: ids.map(id => ({ id, name: `星匠 ${id}`, isConnected: true, ready: true })) };
    const poster = (G: StarState) => buildStarPosterModel({ G, info, step: 1, totalSteps: 1 });
    let frames = 0, blindReservations = 0, knownReservations = 0, goldSubstitutions = 0, purchases = 0;
    function check() {
      const G = state.G as StarState, before = structuredClone(G), blind = starObserverView(G, 'blind'), god = starObserverView(G, 'god'), expected = poster(blind);
      expect(blind.private).toEqual({}); expect(blind.secret).toBeUndefined(); expect(god.secret).toBeUndefined();
      expect(poster(G)).toEqual(expected); expect(poster(god)).toEqual(expected); expect(poster(starObserverView(god, 'blind'))).toEqual(expected);
      for (const id of ids) expect(poster(starPlayerView({ G, playerID: id }))).toEqual(expected);
      expect(expected.players.map(player => player.prestige)).toEqual(ids.map(id => G.players[id].prestige));
      expect(expected.market.flatMap(tier => tier.cards).filter(card => !!card)).toHaveLength(STAR_TIERS.flatMap(tier => G.market[tier]).filter(Boolean).length);
      for (const [index, id] of ids.entries()) expect(expected.players[index].reserved.map(reserve => reserve.name)).toEqual(G.players[id].reserved.map(reserve => reserve.knownCardID ? STAR_CARDS[reserve.knownCardID].name : null));
      if (G.status !== 'finished') expect(expected.winners).toEqual([]);
      expect(JSON.stringify(expected)).not.toMatch(/"(?:private|secret|cardID|knownCardID|unusedGuardians|decks|credentials)"\s*:/);
      expect(G).toEqual(before); frames++;
    }
    check();
    for (let step = 0; state.G.status !== 'finished' && step < 1200; step++) {
      const G = state.G as StarState, id = G.status === 'briefing' ? ids.find(id => !G.players[id].acknowledged)! : G.activePlayer!, view = starPlayerView({ G, playerID: id });
      const actions = legalStarActions(view, id), buys = actions.filter(action => action.move === 'buyCard');
      let action = actions[0];
      if (G.status === 'turn') {
        const flexibleBuy = buys.find(candidate => { const payment = candidate.args[1] as StarState['bank']; return payment.gold < G.players[id].tokens.gold && STAR_COLORS.some(color => payment[color] > 0); });
        if (buys.length && (goldSubstitutions > 0 || flexibleBuy || G.players[id].tokens.gold === 0)) {
          buys.sort((a, b) => STAR_CARDS[b.args[0] as string].prestige - STAR_CARDS[a.args[0] as string].prestige || STAR_COLORS.reduce((sum, color) => sum + (starDiscountedCost(G, id, a.args[0] as string)?.[color] ?? 0) - (starDiscountedCost(G, id, b.args[0] as string)?.[color] ?? 0), 0)); action = goldSubstitutions === 0 && flexibleBuy ? flexibleBuy : buys[0]; purchases++;
          const payment = { ...(action.args[1] as ReturnType<typeof import('../games/star/content').starEmptyTokens>) };
          const replace = STAR_COLORS.find(color => payment[color] > 0);
          if (replace && payment.gold < G.players[id].tokens.gold) { payment[replace]--; payment.gold++; expect(starValidPayment(G, id, action.args[0] as string, payment)).toBe(true); action = { ...action, args: [action.args[0], payment, G.epoch] }; goldSubstitutions++; }
        } else {
          const reserves = actions.filter(action => action.move === 'reserveCard'), take = actions.filter(action => action.move === 'takeTokens');
          if (reserves.length && G.players[id].reserved.length < 2 && G.bank.gold > 0 && (blindReservations === 0 || knownReservations === 0 || random() < .15)) {
            const kind = blindReservations === 0 ? 'deck' : 'market'; action = reserves.find(action => (action.args[0] as { kind: string }).kind === kind) ?? reserves[0]; if ((action.args[0] as { kind: string }).kind === 'deck') blindReservations++; else knownReservations++;
          } else action = take[Math.floor(random() * take.length)] ?? reserves[0] ?? actions[0];
        }
      }
      expect(action, `${G.status} must progress`).toBeTruthy(); const next = reducer(state, { type: 'MAKE_MOVE', payload: { type: action.move, args: action.args, playerID: id } }); expect(next._stateID).toBe(state._stateID + 1); state = structuredClone(next); check();
    }
    expect(state.G.status).toBe('finished'); expect(purchases, 'actual purchases').toBeGreaterThan(20); expect(blindReservations, 'blind reservations').toBeGreaterThan(0); expect(knownReservations, 'public reservations').toBeGreaterThan(0); expect(goldSubstitutions, 'voluntary gold payments').toBeGreaterThan(0); expect(frames).toBeGreaterThan(70);
    expect(poster(state.G).winners).toEqual(state.G.winnerIDs.map((id: string) => `星匠 ${id}`)); expect(Object.values(state.G.players).every(player => starTokenTotal((player as StarState['players'][string]).tokens) <= 10)).toBe(true);
  });
});
