import { Client } from 'boardgame.io/client';
import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it, vi } from 'vitest';
import { createFirewallDeck, createFirewallRoles, FIREWALL_ACTIONS, type FirewallActionID, type FirewallCard, type FirewallPathID, type FirewallRole } from './content';
import { FirewallGame, firewallObserverView, firewallPlayerView, legalFirewallActions, legalFirewallPlacements, type FirewallState, type FirewallTile } from './game';

// Persisted boardgame.io state is JSON data; a rejected local move can leave
// transient plugin APIs attached to the test client's store until its next sync.
const savedClone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function harness(ids = ['0', '2', '7'], seed = 'firewall-engine-tests') {
  const game = { ...FirewallGame, seed }, client = Client({ game, numPlayers: ids.length, playerID: ids[0], debug: false });
  const match = createMatch({ game, numPlayers: ids.length, setupData: { startImmediately: true, participantIDs: ids }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  client.store.dispatch({ type: 'UPDATE', state: match.initialState, deltalog: [], clientOnly: true });
  const raw = () => client.store.getState().G as FirewallState;
  function patch(change: (G: FirewallState) => void) {
    const state = savedClone(client.store.getState()); change(state.G);
    for (const id of ids) state.G.players[id].handCount = state.G.private[id].hand.length;
    state.G.deckCount = state.G.secret!.deck.length; state.G.discardCount = state.G.secret!.discard.length;
    client.store.dispatch({ type: 'UPDATE', state, deltalog: [], clientOnly: true });
  }
  function call(id: string, move: string, args: unknown[] = [], valid = true) {
    const before = client.store.getState()._stateID, old = structuredClone(raw()); client.updatePlayerID(id);
    const spy = valid ? null : vi.spyOn(console, 'error').mockImplementation(() => {});
    try { client.moves[move](...args); } finally { spy?.mockRestore(); }
    expect(client.store.getState()._stateID, `${move} by ${id}`).toBe(before + (valid ? 1 : 0));
    if (!valid) expect(raw()).toEqual(old);
  }
  function act(id: string, move: string, ...args: unknown[]) { call(id, move, [...args, move === 'acknowledge' ? raw().phaseEpoch : raw().epoch]); }
  function reject(id: string, move: string, ...args: unknown[]) { call(id, move, [...args, move === 'acknowledge' ? raw().phaseEpoch : raw().epoch], false); }
  function acknowledge() { for (const id of ids) act(id, 'acknowledge'); }
  function advanceTo(id: string) {
    for (let guard = 0; raw().activePlayer !== id && guard < ids.length; guard++) {
      const actor = raw().activePlayer!; act(actor, 'discard', [raw().private[actor].hand[0].id]);
    }
    expect(raw().activePlayer).toBe(id);
  }
  function give(id: string, ...names: (FirewallActionID | FirewallPathID)[]) {
    const result: string[] = [];
    patch(G => {
      for (let slot = 0; slot < names.length; slot++) {
        const wanted = names[slot], own = G.private[id].hand;
        const pools = [own, G.secret!.deck, G.secret!.removed, G.secret!.discard, ...ids.filter(other => other !== id).map(other => G.private[other].hand)];
        const matches = (card: FirewallCard) => (card.kind === 'path' ? card.pathID : card.action) === wanted && !result.includes(card.id);
        const pool = pools.find(cards => cards.some(matches)); if (!pool) throw new Error(`Missing fixture card ${wanted}`);
        const index = pool.findIndex(matches), card = pool[index];
        pool[index] = own[slot]; own[slot] = card; result.push(card.id);
      }
    });
    return result;
  }
  function setRoles(roles: FirewallRole[]) {
    patch(G => {
      const pool = [...Object.values(G.private).map(entry => entry.role), ...G.secret!.roleDeck];
      roles.forEach((role, index) => { const position = pool.indexOf(role); if (position < 0) throw new Error(`Missing role ${role}`); pool.splice(position, 1); G.private[ids[index]].role = role; });
      G.secret!.roleDeck = pool;
    });
  }
  function exhaust() {
    for (let guard = 0; raw().status === 'turn' && guard < 150; guard++) {
      const id = raw().activePlayer!; act(id, 'discard', raw().private[id].hand.slice(0, 3).map(card => card.id));
    }
    expect(raw().status).not.toBe('turn');
  }
  function conservation() {
    const G = raw(), cards = [...G.secret!.deck, ...G.secret!.removed, ...G.secret!.discard, ...Object.values(G.private).flatMap(entry => entry.hand),
      ...Object.values(G.secret!.effects).flatMap(effects => Object.values(effects) as FirewallCard[]),
      ...G.board.filter(tile => tile.kind === 'path').map(tile => ({ id: tile.id, kind: 'path', pathID: tile.pathID }))];
    expect(cards.map(card => card.id).sort()).toEqual(createFirewallDeck().map(card => card.id).sort());
    expect([...Object.values(G.private).map(entry => entry.role), ...G.secret!.roleDeck].sort()).toEqual(createFirewallRoles().sort());
    expect(G.deckCount).toBe(G.secret!.deck.length); expect(G.discardCount).toBe(G.secret!.discard.length);
    for (const id of ids) expect(G.players[id].handCount).toBe(G.private[id].hand.length);
  }
  function routeToMiddle() {
    patch(G => {
      for (let x = 1; x <= 6; x++) {
        const index = G.secret!.deck.findIndex(card => card.kind === 'path' && ['base_ew', 'base_new', 'base_nesw'].includes(card.pathID));
        if (index < 0) throw new Error('Missing connecting fixture card');
        const card = G.secret!.deck.splice(index, 1)[0]; if (card.kind !== 'path') throw new Error('Expected path');
        G.board.push({ id: card.id, kind: 'path', revealed: true, pathID: card.pathID, x, y: 0, rotation: 0 });
      }
    });
  }
  return { client, raw, patch, call, act, reject, acknowledge, advanceTo, give, setRoles, exhaust, conservation, routeToMiddle };
}

describe('Firewall setup, versions and authorization', () => {
  it.each([2, 12])('starts %i real participants with six cards, ten removed cards and all fifteen roles', count => {
    const ids = count === 2 ? ['2', '9'] : Array.from({ length: count }, (_, index) => String(index)), h = harness(ids);
    expect(h.raw()).toMatchObject({ round: 1, status: 'briefing', deckCount: 108 - count * 6, roleDeckCount: 15 - count });
    expect(h.raw().secret!.removed).toHaveLength(10); expect(h.raw().turnOrder).toEqual(ids); h.conservation();
    const token = h.raw().phaseEpoch;
    for (const id of ids) h.call(id, 'acknowledge', [token]);
    expect(h.raw().activePlayer).toBe(ids[0]); expect(h.raw().status).toBe('turn');
    const actions = legalFirewallActions(firewallPlayerView({ G: h.raw(), playerID: ids[0] }), ids[0]); expect(actions.length).toBeGreaterThan(0);
  });
  it('rejects unsupported player counts, duplicate/malformed seats and unsupported options', () => {
    for (const count of [1, 13]) expect(FirewallGame.validateSetupData?.({}, count)).toBeTypeOf('string');
    expect(FirewallGame.validateSetupData?.({ participantIDs: ['0', '0'] }, 2)).toBeTypeOf('string');
    expect(FirewallGame.validateSetupData?.({ participantIDs: ['0', '999'] }, 2)).toBeTypeOf('string');
    expect(FirewallGame.validateSetupData?.({ options: { rounds: 1 } as never }, 2)).toBeTypeOf('string');
  });
  it('rejects wrong seats, old epochs, malformed card groups, forged options and framework events without mutation', () => {
    const h = harness(); h.acknowledge(); const id = h.raw().activePlayer!, cardID = h.raw().private[id].hand[0].id;
    h.reject('2', 'discard', [cardID]); h.reject('11', 'discard', [cardID]); h.call(id, 'discard', [[cardID], h.raw().epoch - 1], false);
    h.reject(id, 'discard', []); h.reject(id, 'discard', [cardID, cardID]); h.reject(id, 'discard', ['forged']);
    h.reject(id, 'discard', h.raw().private[id].hand.slice(0, 4).map(card => card.id));
    const [theft] = h.give(id, 'theft'); h.reject(id, 'playAction', theft, { playerID: id });
    const before = savedClone(h.client.store.getState()); h.client.updatePlayerID(id);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const [type, args] of [['endTurn', []], ['endGame', [{ winner: 'wealth' }]], ['setActivePlayers', [{ all: 'forged' }]],
        ['endPhase', []], ['setPhase', ['forged']], ['endStage', []], ['setStage', ['forged']], ['pass', []]] as [string, unknown[]][]) {
        h.client.store.dispatch({ type: 'UPDATE', state: savedClone(before), deltalog: [], clientOnly: true });
        h.client.store.dispatch({ type: 'GAME_EVENT', payload: { type, args, playerID: id } });
        expect(h.client.store.getState().G).toEqual(before.G);
        expect(h.client.store.getState()._stateID).toBe(before._stateID);
        // Upstream updates this diagnostic counter before rejecting setStage.
        expect({ ...h.client.store.getState().ctx, _activePlayersNumMoves: undefined }).toEqual({ ...before.ctx, _activePlayersNumMoves: undefined });
      }
    } finally { spy.mockRestore(); }
    h.client.store.dispatch({ type: 'UPDATE', state: before, deltalog: [], clientOnly: true });
    h.act(id, 'playAction', theft, {}); h.advanceTo(id); const [second] = h.give(id, 'theft'); h.reject(id, 'playAction', second, {});
  });
  it('uses one shared phase token for concurrent confirmations while rejecting duplicates and prior-phase confirmations', () => {
    const h = harness(), token = h.raw().phaseEpoch;
    h.call('0', 'acknowledge', [token]); h.call('0', 'acknowledge', [token], false);
    h.call('2', 'acknowledge', [token]); h.call('7', 'acknowledge', [token]);
    expect(h.raw().status).toBe('turn'); h.call('7', 'acknowledge', [token], false);
    h.exhaust(); const reviewToken = h.raw().phaseEpoch;
    h.call('0', 'acknowledge', [token], false); h.call('0', 'acknowledge', [reviewToken]);
    h.call('2', 'acknowledge', [reviewToken]); h.call('7', 'acknowledge', [reviewToken]);
    expect(h.raw()).toMatchObject({ round: 2, status: 'briefing' });
    h.call('0', 'acknowledge', [reviewToken], false); h.conservation();
  });
  it('rejects malformed coordinates, orientations, extra target fields and someone else’s card IDs', () => {
    const h = harness(['0', '2']); h.acknowledge(); const [path, map] = h.give('0', 'base_ew', 'map');
    for (const [x, y, rotation] of [[NaN, 0, 0], [1, Infinity, 0], [1.5, 0, 0], [1, 0, 90], [1, 0, '0']]) h.reject('0', 'placePath', path, x, y, rotation);
    h.reject('0', 'playAction', map, { goalID: 'goal-middle', role: 'saboteur' });
    h.reject('0', 'playAction', map, ['goal-middle']); h.reject('0', 'playAction', map, null);
    h.reject('0', 'discard', [h.raw().private['2'].hand[0].id]); h.conservation();
  });
  it('keeps a waiting game private and starts only after all seats are ready and the first seat starts it', () => {
    const client = Client({ game: FirewallGame, numPlayers: 2, playerID: '0', debug: false });
    const raw = () => client.store.getState().G as FirewallState;
    expect(raw()).toMatchObject({ status: 'lobby', private: {}, board: [] });
    const attempt = (id: string, move: string, args: unknown[], valid: boolean) => {
      client.updatePlayerID(id); const version = client.store.getState()._stateID;
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try { client.moves[move](...args); } finally { spy.mockRestore(); }
      expect(client.store.getState()._stateID).toBe(version + Number(valid));
    };
    attempt('0', 'setReady', ['true'], false); attempt('0', 'startGame', [], false);
    attempt('0', 'setReady', [true], true); attempt('1', 'setReady', [true], true);
    attempt('1', 'startGame', [], false); attempt('0', 'startGame', [], true);
    expect(raw()).toMatchObject({ status: 'briefing', round: 1 });
    attempt('0', 'startGame', [], false); attempt('1', 'setReady', [false], false);
  });
});

describe('Firewall actions and exact card economy', () => {
  it('handles every broken tool, matching single/dual repairs and two-card self recovery', () => {
    const h = harness(['0', '2']); h.acknowledge();
    for (const tool of ['pickaxe', 'lantern', 'cart'] as const) {
      const [breakID] = h.give('0', `break_${tool}`); h.reject('0', 'playAction', breakID, { playerID: '0' }); h.act('0', 'playAction', breakID, { playerID: '2' });
      expect(h.raw().players['2'].broken).toContain(tool); expect(h.raw().secret!.effects['2'][tool]?.id).toBe(breakID);
      const [path, repair] = h.give('2', 'base_ew', `repair_${tool}`); h.reject('2', 'placePath', path, 1, 0, 0);
      h.act('2', 'playAction', repair, { playerID: '2', tool }); expect(h.raw().players['2'].broken).toEqual([]); h.conservation();
    }
    let [breakID] = h.give('0', 'break_pickaxe'); h.act('0', 'playAction', breakID, { playerID: '2' }); h.advanceTo('0');
    [breakID] = h.give('0', 'break_cart'); h.act('0', 'playAction', breakID, { playerID: '2' });
    const [repair] = h.give('2', 'repair_pickaxe_or_cart'); h.reject('2', 'playAction', repair, { playerID: '2', tool: 'lantern' });
    h.act('2', 'playAction', repair, { playerID: '2', tool: 'pickaxe' }); expect(h.raw().players['2'].broken).toEqual(['cart']);
    h.advanceTo('2'); const before = h.raw().private['2'].hand.length, cards = h.raw().private['2'].hand.slice(0, 2).map(card => card.id);
    h.reject('2', 'clearEffect', [cards[0]], 'cart'); h.reject('2', 'clearEffect', cards, 'pickaxe');
    h.act('2', 'clearEffect', cards, 'cart'); expect(h.raw().private['2'].hand).toHaveLength(before - 1); expect(h.raw().players['2'].broken).toEqual([]); h.conservation();
  });
  it('supports theft, hands off, trap and freedom on allowed targets; trapping still permits action and self recovery', () => {
    const h = harness(['0', '2']); h.acknowledge();
    let [id] = h.give('0', 'theft'); h.act('0', 'playAction', id, {});
    [id] = h.give('2', 'hands_off'); h.act('2', 'playAction', id, { playerID: '0' }); expect(h.raw().players['0'].theftOrder).toBeNull();
    [id] = h.give('0', 'trapped'); h.reject('0', 'playAction', id, { playerID: '0' }); h.act('0', 'playAction', id, { playerID: '2' });
    const [path, freedom] = h.give('2', 'base_ew', 'freedom'); h.reject('2', 'placePath', path, 1, 0, 0);
    h.act('2', 'playAction', freedom, { playerID: '2' }); expect(h.raw().players['2'].trapped).toBe(false);
    [id] = h.give('0', 'trapped'); h.act('0', 'playAction', id, { playerID: '2' });
    h.act('2', 'clearEffect', h.raw().private['2'].hand.slice(0, 2).map(card => card.id), 'trapped'); expect(h.raw().players['2'].trapped).toBe(false); h.conservation();
    [id] = h.give('0', 'theft'); h.act('0', 'playAction', id, {}); h.advanceTo('0');
    h.act('0', 'clearEffect', h.raw().private['0'].hand.slice(0, 2).map(card => card.id), 'theft'); expect(h.raw().players['0'].theftOrder).toBeNull(); h.conservation();
  });
  it('keeps map/inspection historical, rotates roles from the unused deck, and swaps hands before only the target draws', () => {
    const h = harness(); h.acknowledge();
    const [map] = h.give('0', 'map'), goal = 'goal-middle'; h.act('0', 'playAction', map, { goalID: goal });
    expect(h.raw().private['0'].goalMemory.at(-1)).toMatchObject({ goalID: goal, pathID: h.raw().secret!.goals[goal], round: 1 });
    const [inspection] = h.give('2', 'inspection'), oldRole = h.raw().private['0'].role;
    h.reject('2', 'playAction', inspection, { playerID: '2' }); h.act('2', 'playAction', inspection, { playerID: '0' });
    const [change] = h.give('7', 'change_roles'), nextRole = h.raw().secret!.roleDeck[0]; h.act('7', 'playAction', change, { playerID: '0' });
    expect(h.raw().private['0'].role).toBe(nextRole); expect(h.raw().secret!.roleDeck.at(-1)).toBe(oldRole);
    expect(h.raw().private['2'].roleMemory.at(-1)?.role).toBe(oldRole);
    const [swap] = h.give('0', 'swap_hands'), beforeOther = structuredClone(h.raw().private['2'].hand), beforeOwn = h.raw().private['0'].hand.filter(card => card.id !== swap), drawCard = h.raw().secret!.deck[0];
    h.reject('0', 'playAction', swap, { playerID: '0' }); h.act('0', 'playAction', swap, { playerID: '2' });
    expect(h.raw().private['0'].hand).toEqual(beforeOther); expect(h.raw().private['2'].hand).toEqual([...beforeOwn, drawCard]);
    expect(h.raw().log.filter(entry => entry.action === 'map' || entry.action === 'inspection' || entry.action === 'change_roles').every(entry => !('pathID' in entry) && !('role' in entry))).toBe(true);
    h.conservation();
  });
  it('draws at most the remaining deck, never reshuffles, and allows an empty seat to regain cards through exchange', () => {
    const h = harness(['0', '2']); h.acknowledge();
    h.patch(G => { G.secret!.discard.push(...G.secret!.deck.splice(1)); });
    const before = h.raw().private['0'].hand.length; h.act('0', 'discard', h.raw().private['0'].hand.slice(0, 3).map(card => card.id));
    expect(h.raw().private['0'].hand).toHaveLength(before - 2); expect(h.raw().deckCount).toBe(0);
    const [swap] = h.give('2', 'swap_hands'); h.patch(G => { G.secret!.discard.push(...G.private['0'].hand); G.private['0'].hand = []; });
    h.act('2', 'playAction', swap, { playerID: '0' }); expect(h.raw().private['2'].hand).toHaveLength(0);
    expect(h.raw().private['0'].hand).toHaveLength(5); expect(h.raw().activePlayer).toBe('0'); expect(h.raw().deckCount).toBe(0); h.conservation();
  });
});

describe('Firewall goal reveal, rockfall and private projections', () => {
  it('does not reveal a goal through an adjacent dead-end port; a replacement connection reveals the stone in a matching orientation', () => {
    const h = harness(['0', '2']); h.acknowledge(); h.routeToMiddle();
    h.patch(G => { const other = Object.keys(G.secret!.goals).find(id => G.secret!.goals[id] === 'goal_stone_ne')!; [G.secret!.goals['goal-middle'], G.secret!.goals[other]] = [G.secret!.goals[other], G.secret!.goals['goal-middle']]; });
    const [dead] = h.give('0', 'base_dead_ew'); h.act('0', 'placePath', dead, 7, 0, 0);
    expect(h.raw().board.find(tile => tile.id === 'goal-middle')).toEqual({ id: 'goal-middle', kind: 'goal', x: 8, y: 0, revealed: false });
    const [rock] = h.give('2', 'rockfall'); h.reject('2', 'playAction', rock, { tileID: 'start' }); h.reject('2', 'playAction', rock, { tileID: 'goal-middle' });
    h.act('2', 'playAction', rock, { tileID: dead }); expect(h.raw().board.some(tile => tile.id === dead)).toBe(false);
    const [path] = h.give('0', 'base_ew'); h.act('0', 'placePath', path, 7, 0, 0);
    expect(h.raw().status).toBe('turn'); expect(h.raw().board.find(tile => tile.id === 'goal-middle')).toMatchObject({ revealed: true, pathID: 'goal_stone_ne', rotation: 180 });
    const [map] = h.give('2', 'map'); h.reject('2', 'playAction', map, { goalID: 'goal-middle' }); h.conservation();
  });
  it('immediately ends a completed route, exposes only the reached goal and does not draw after the winning placement', () => {
    const h = harness(['0', '2']); h.acknowledge(); h.routeToMiddle(); h.setRoles(['blue', 'green']);
    h.patch(G => { const other = Object.keys(G.secret!.goals).find(id => G.secret!.goals[id] === 'goal_gold')!; [G.secret!.goals['goal-middle'], G.secret!.goals[other]] = [G.secret!.goals[other], G.secret!.goals['goal-middle']]; });
    const [path] = h.give('0', 'base_ew'), beforeDeck = h.raw().deckCount; h.act('0', 'placePath', path, 7, 0, 0);
    expect(h.raw().status).toBe('review'); expect(h.raw().deckCount).toBe(beforeDeck); expect(h.raw().roundResult).toMatchObject({ reason: 'connected', completedBy: '0', winningIDs: ['0'], awards: { '0': 5, '2': 0 } });
    expect(h.raw().board.filter(tile => tile.kind === 'goal' && tile.revealed)).toHaveLength(1); h.conservation();
  });
  it('reveals simultaneously reached goals top to bottom and stops as soon as the true core is found', () => {
    const h = harness(['0', '2']); h.acknowledge();
    h.patch(G => {
      const deploy = (pathIDs: FirewallPathID[], x: number, y: number, rotation: 0 | 180 = 0) => {
        const pools = [G.secret!.deck, G.secret!.removed, ...Object.values(G.private).map(entry => entry.hand)];
        const pool = pools.find(cards => cards.some(card => card.kind === 'path' && pathIDs.includes(card.pathID)))!;
        const index = pool.findIndex(card => card.kind === 'path' && pathIDs.includes(card.pathID)), card = pool.splice(index, 1)[0];
        if (card.kind !== 'path') throw new Error('Expected a path fixture');
        G.board.push({ id: card.id, kind: 'path', revealed: true, pathID: card.pathID, x, y, rotation });
      };
      deploy(['base_ns'], 0, -1); deploy(['base_es'], 0, -2);
      for (let x = 1; x <= 6; x++) deploy(['base_ew', 'base_new', 'base_nesw'], x, -2);
      deploy(['base_sw'], 7, -2); deploy(['base_sw'], 7, -1, 180);
      G.secret!.goals = { 'goal-top': 'goal_stone_ne', 'goal-middle': 'goal_gold', 'goal-bottom': 'goal_stone_es' };
    });
    const [path] = h.give('0', 'base_nsw'); h.act('0', 'placePath', path, 8, -1, 0);
    expect(h.raw().status).toBe('review');
    expect(h.raw().log.filter(entry => entry.type === 'goal-reveal').map(entry => entry.tile?.id)).toEqual(['goal-top', 'goal-middle']);
    expect(h.raw().board.find(tile => tile.id === 'goal-top')).toMatchObject({ revealed: true, rotation: 180 });
    expect(h.raw().board.find(tile => tile.id === 'goal-bottom')?.revealed).toBe(false); h.conservation();
  });
  it('projects only authorized records and produces the same legal actions despite a changed hidden deck, role deck and goal assignment', () => {
    const h = harness(); h.acknowledge(); const [map] = h.give('0', 'map'); h.act('0', 'playAction', map, { goalID: 'goal-top' });
    const G = h.raw(), original = structuredClone(G), player = firewallPlayerView({ G, playerID: '0' }), god = firewallObserverView(G, 'god'), blind = firewallObserverView(G, 'blind');
    expect(Object.keys(player.private)).toEqual(['0']); expect(Object.keys(god.private)).toEqual(G.turnOrder); expect(blind.private).toEqual({});
    for (const view of [player, god, blind]) {
      expect(view.secret).toBeUndefined(); expect(view.board.filter(tile => tile.kind === 'goal').every(tile => Object.keys(tile).sort().join(',') === 'id,kind,revealed,x,y')).toBe(true);
    }
    expect(firewallObserverView(god, 'blind')).toEqual(blind);
    const changed = structuredClone(G); changed.secret!.deck.reverse(); changed.secret!.roleDeck.reverse();
    [changed.secret!.goals['goal-middle'], changed.secret!.goals['goal-bottom']] = [changed.secret!.goals['goal-bottom'], changed.secret!.goals['goal-middle']];
    expect(firewallPlayerView({ G: changed, playerID: '2' })).toEqual(firewallPlayerView({ G, playerID: '2' }));
    expect(firewallObserverView(changed, 'god')).toEqual(god); expect(firewallObserverView(changed, 'blind')).toEqual(blind);
    expect(legalFirewallActions(changed, '2')).toEqual(legalFirewallActions(firewallPlayerView({ G, playerID: '2' }), '2'));
    for (const card of G.private['2'].hand) expect(legalFirewallPlacements(changed, '2', card.id)).toEqual(legalFirewallPlacements(G, '2', card.id));
    expect(G).toEqual(original);
  });
});

describe('Firewall three rounds, theft ordering and completion', () => {
  it('shares victory on equal zero totals when all three genuine rounds end without any eligible scoring role', () => {
    const h = harness(['0', '2']);
    for (let round = 1; round <= 3; round++) {
      expect(h.raw()).toMatchObject({ status: 'briefing', round }); h.setRoles(['blue', 'green']); h.acknowledge(); h.exhaust();
      expect(h.raw().roundResult!.awards).toEqual({ '0': 0, '2': 0 }); h.acknowledge(); h.conservation();
    }
    expect(h.raw()).toMatchObject({ status: 'finished', finalScores: { '0': 0, '2': 0 }, winnerIDs: ['0', '2'] });
    expect(h.client.store.getState().ctx.gameover).toEqual({ winner: 'wealth', reason: 'three-rounds' });
  });
  it('pays first, steals from the latest thief clockwise, preserves the last card actor for next-round starter, then reveals totals after three rounds', () => {
    const h = harness(); h.acknowledge(); h.setRoles(['saboteur', 'profiteer', 'blue']);
    let [id] = h.give('0', 'theft'); h.act('0', 'playAction', id, {}); [id] = h.give('2', 'theft'); h.act('2', 'playAction', id, {});
    h.exhaust(); expect(h.raw().status).toBe('theft'); expect(h.raw().secret!.theftQueue).toEqual(['2', '0']);
    expect(h.raw().private['0'].gold).toBe(4); expect(h.raw().private['2'].gold).toBe(2); expect(h.raw().finalScores).toEqual({});
    const lastActor = h.raw().lastActor!, nextStarter = h.raw().turnOrder[(h.raw().turnOrder.indexOf(lastActor) + 1) % 3];
    h.reject('0', 'steal', '2'); h.reject('2', 'steal', '2'); h.act('2', 'steal', '0'); expect(h.raw().private['2'].gold).toBe(3);
    h.act('0', 'steal', '2'); expect(h.raw().status).toBe('review'); expect(h.raw().lastActor).toBe(lastActor);
    const totals = h.raw().turnOrder.map(playerID => h.raw().private[playerID].gold); h.acknowledge();
    expect(h.raw()).toMatchObject({ status: 'briefing', round: 2, starter: nextStarter, deckCount: 90 });
    expect(h.raw().turnOrder.map(playerID => h.raw().private[playerID].gold)).toEqual(totals); expect(h.raw().players['0'].theftOrder).toBeNull(); h.conservation();
    h.acknowledge(); expect(h.raw().activePlayer).toBe(nextStarter); h.exhaust(); h.acknowledge(); h.acknowledge(); h.exhaust();
    expect(h.raw().round).toBe(3); expect(h.raw().status).toBe('review'); expect(h.raw().finalScores).toEqual({});
    h.acknowledge(); expect(h.raw().status).toBe('finished'); expect(h.raw().winner).toBe('wealth'); expect(h.raw().winReason).toBe('three-rounds');
    expect(h.raw().finalScores).toEqual(Object.fromEntries(h.raw().turnOrder.map(playerID => [playerID, h.raw().private[playerID].gold])));
    expect(h.raw().winnerIDs).toEqual(h.raw().turnOrder.filter(playerID => h.raw().finalScores[playerID] === Math.max(...Object.values(h.raw().finalScores))));
    h.reject('0', 'discard', []); h.conservation();
  });
  it('excludes trapped thieves and offers every other theft target without consulting their hidden gold', () => {
    const h = harness(); h.acknowledge(); h.setRoles(['saboteur', 'blue', 'green']);
    let [id] = h.give('0', 'theft'); h.act('0', 'playAction', id, {}); [id] = h.give('2', 'theft'); h.act('2', 'playAction', id, {});
    [id] = h.give('7', 'trapped'); h.act('7', 'playAction', id, { playerID: '0' }); h.exhaust();
    expect(h.raw().secret!.theftQueue).toEqual(['2']); expect(h.raw().roundResult!.awards).toEqual({ '0': 0, '2': 0, '7': 0 });
    const view = firewallPlayerView({ G: h.raw(), playerID: '2' }); expect(legalFirewallActions(view, '2')).toEqual([{ move: 'steal', args: ['0', view.epoch] }, { move: 'steal', args: ['7', view.epoch] }]);
    h.act('2', 'steal', '0'); expect(h.raw().roundResult!.thefts).toEqual([{ playerID: '2', targetID: '0', amount: 0 }]); expect(h.raw().status).toBe('review'); h.conservation();
  });
  it('executes every helper-suggested action against its actual state with the same outcome from an own-only view', () => {
    const h = harness(['0', '2']); h.acknowledge(); h.give('0', 'base_ew', 'map', 'break_pickaxe', 'swap_hands', 'change_roles', 'theft');
    const state = savedClone(h.client.store.getState()), G = h.raw(), view = firewallPlayerView({ G, playerID: '0' });
    const actions = legalFirewallActions(view, '0'); expect(actions).toEqual(legalFirewallActions(G, '0'));
    expect(new Set(actions.map(action => action.move))).toEqual(new Set(['placePath', 'playAction', 'discard']));
    for (const action of actions) {
      h.client.store.dispatch({ type: 'UPDATE', state: structuredClone(state), deltalog: [], clientOnly: true }); h.call('0', action.move, action.args); h.conservation();
    }
  });
});
