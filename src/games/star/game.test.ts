import { createHash } from 'node:crypto';
import { createMatch, CreateGameReducer } from 'boardgame.io/internal';
import { describe, expect, it, vi } from 'vitest';
import { STAR_CARDS, STAR_CARD_LIST, STAR_COLORS, STAR_GUARDIANS, STAR_GUARDIAN_LIST, STAR_TIERS, STAR_TOKENS, starEmptyTokens, starTokenTotal,
  type StarColor, type StarTier, type StarTokenCounts } from './content';
import { StarGame, legalStarActions, legalStarTokenChoices, starDefaultPayment, starDiscountedCost, starEligibleGuardians, starObserverView, starPlayerView,
  type StarAction, type StarState } from './game';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const tokens = (values: Partial<StarTokenCounts> = {}): StarTokenCounts => ({ ...starEmptyTokens(), ...values });
function harness(ids = ['0', '2'], seed = 'star-rules', startImmediately = true) {
  const game = { ...StarGame, seed }, match = createMatch({ game, numPlayers: ids.length, setupData: { participantIDs: ids, startImmediately }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  const reducer = CreateGameReducer({ game, isClient: false }); let state = clone(match.initialState);
  const raw = () => state.G as StarState;
  function call(id: string, move: string, args: unknown[], valid = true) {
    const before = clone(state), spy = valid ? null : vi.spyOn(console, 'error').mockImplementation(() => {});
    try { state = clone(reducer(state, { type: 'MAKE_MOVE', payload: { type: move, args, playerID: id } })); } finally { spy?.mockRestore(); }
    expect(state._stateID, `${move} / ${id} / ${before.G.status}`).toBe(before._stateID + Number(valid));
    if (!valid) expect(raw()).toEqual(before.G);
  }
  const act = (id: string, move: string, ...args: unknown[]) => call(id, move, [...args, move === 'acknowledge' ? raw().phaseEpoch : raw().epoch]);
  const reject = (id: string, move: string, ...args: unknown[]) => call(id, move, [...args, move === 'acknowledge' ? raw().phaseEpoch : raw().epoch], false);
  const acknowledge = () => { for (const id of ids) act(id, 'acknowledge'); };
  const patch = (change: (G: StarState) => void) => { state = clone(state); change(state.G); };
  function removeCard(G: StarState, cardID: string) {
    const tier = STAR_CARDS[cardID].tier, slot = G.market[tier].indexOf(cardID), index = G.secret!.decks[tier].indexOf(cardID);
    if (slot >= 0) G.market[tier][slot] = G.secret!.decks[tier].shift() ?? null;
    else if (index >= 0) G.secret!.decks[tier].splice(index, 1);
    else throw new Error(`Fixture card unavailable: ${cardID}`);
    G.deckCounts[tier] = G.secret!.decks[tier].length;
  }
  function faceup(cardID: string) {
    patch(G => {
      const tier = STAR_CARDS[cardID].tier;
      if (G.market[tier].includes(cardID)) return;
      const index = G.secret!.decks[tier].indexOf(cardID); if (index < 0) throw new Error(`Missing market fixture ${cardID}`);
      const old = G.market[tier][0]; G.market[tier][0] = cardID;
      if (old) G.secret!.decks[tier][index] = old; else G.secret!.decks[tier].splice(index, 1);
      G.deckCounts[tier] = G.secret!.decks[tier].length;
    });
  }
  function giveTokens(id: string, wanted: Partial<StarTokenCounts>) {
    patch(G => {
      for (const color of STAR_TOKENS) {
        const amount = wanted[color] ?? 0, change = amount - G.players[id].tokens[color];
        if (change > G.bank[color]) throw new Error(`Fixture supply ${color}`);
        G.players[id].tokens[color] = amount; G.bank[color] -= change;
      }
    });
  }
  function purchased(id: string, cardIDs: string[]) {
    patch(G => {
      for (const cardID of cardIDs) { removeCard(G, cardID); G.players[id].purchased.push(cardID); G.players[id].bonuses[STAR_CARDS[cardID].bonus]++; G.players[id].prestige += STAR_CARDS[cardID].prestige; }
    });
  }
  function reserved(id: string, cardIDs: string[]) {
    patch(G => {
      for (const cardID of cardIDs) { removeCard(G, cardID); const reserveID = `reserve-${G.nextReservationID++}`;
        G.players[id].reserved.push({ id: reserveID, tier: STAR_CARDS[cardID].tier, knownCardID: null }); G.private[id].reserved.push({ id: reserveID, cardID }); }
    });
  }
  function market(tier: StarTier, cardIDs: string[]) {
    patch(G => {
      const pool = [...G.market[tier].filter((id): id is string => id !== null), ...G.secret!.decks[tier]];
      if (cardIDs.some(id => !pool.includes(id))) throw new Error('Missing market fixture');
      G.market[tier] = [...cardIDs]; G.secret!.decks[tier] = pool.filter(id => !cardIDs.includes(id)); G.deckCounts[tier] = G.secret!.decks[tier].length;
    });
  }
  function fund(id: string, cardID: string) {
    const cost = starDiscountedCost(raw(), id, cardID)!, payment = starEmptyTokens();
    for (const color of STAR_COLORS) { payment[color] = Math.min(cost[color], raw().bank[color] + raw().players[id].tokens[color]); payment.gold += cost[color] - payment[color]; }
    giveTokens(id, payment); return payment;
  }
  function guardians(guardianIDs: string[]) { patch(G => { G.guardians = [...guardianIDs]; G.secret!.unusedGuardians = STAR_GUARDIAN_LIST.map(guardian => guardian.id).filter(id => !guardianIDs.includes(id)); }); }
  function settle() { while (['return-tokens', 'choose-guardian'].includes(raw().status)) { const id = raw().activePlayer!, action = legalStarActions(starPlayerView({ G: raw(), playerID: id }), id)[0]; call(id, action.move, action.args); } }
  function advanceTo(id: string) {
    for (let guard = 0; raw().activePlayer !== id && guard < ids.length; guard++) {
      const actor = raw().activePlayer!, action = legalStarActions(starPlayerView({ G: raw(), playerID: actor }), actor).find(action => action.move === 'takeTokens')!;
      call(actor, action.move, action.args); settle();
    }
    expect(raw().activePlayer).toBe(id);
  }
  function conservation() {
    const G = raw(), all = [...STAR_TIERS.flatMap(tier => [...G.secret!.decks[tier], ...G.market[tier].filter((id): id is string => id !== null)]),
      ...Object.values(G.players).flatMap(player => player.purchased), ...Object.values(G.private).flatMap(info => info.reserved.map(reserve => reserve.cardID))];
    expect(all.sort()).toEqual(STAR_CARD_LIST.map(card => card.id).sort());
    const supply = ids.length === 2 ? 4 : ids.length === 3 ? 5 : 7;
    for (const color of STAR_TOKENS) expect(G.bank[color] + ids.reduce((sum, id) => sum + G.players[id].tokens[color], 0), color).toBe(color === 'gold' ? 5 : supply);
    for (const id of ids) {
      const player = G.players[id];
      expect(player.bonuses).toEqual(Object.fromEntries(STAR_COLORS.map(color => [color, player.purchased.filter(cardID => STAR_CARDS[cardID].bonus === color).length])));
      expect(player.prestige).toBe(player.purchased.reduce((sum, cardID) => sum + STAR_CARDS[cardID].prestige, 0) + player.guardians.length * 3);
      expect(player.reserved.map(entry => entry.id)).toEqual(G.private[id].reserved.map(entry => entry.id));
      for (const entry of player.reserved) expect(entry.knownCardID === null || G.private[id].reserved.find(reserve => reserve.id === entry.id)?.cardID === entry.knownCardID).toBe(true);
    }
    expect([...G.guardians, ...G.secret!.unusedGuardians, ...ids.flatMap(id => G.players[id].guardians)].sort()).toEqual(STAR_GUARDIAN_LIST.map(guardian => guardian.id).sort());
    for (const tier of STAR_TIERS) { expect(G.deckCounts[tier]).toBe(G.secret!.decks[tier].length); expect(G.market[tier]).toHaveLength(4); }
  }
  return { raw, call, act, reject, acknowledge, patch, faceup, giveTokens, purchased, reserved, market, fund, guardians, settle, advanceTo, conservation,
    snapshot: () => clone(state), restore: (saved: typeof state) => { state = clone(saved); },
    event: (type: string, args: unknown[]) => { state = clone(reducer(state, { type: 'GAME_EVENT', payload: { type, args, playerID: ids[0] } })); } };
}

describe('Star factual inventory and setup', () => {
  it('contains exactly the ninety independently verified numeric tuples and all ten guardian requirements', () => {
    const lines = STAR_CARD_LIST.map(card => JSON.stringify([card.tier, card.bonus, card.prestige, ...STAR_COLORS.map(color => card.cost[color])])).sort();
    expect(createHash('sha256').update(lines.join('\n')).digest('hex')).toBe('f115ff293c2abafb071c840e3bac02487c5435d7958b65aa66a7827208b5808b');
    expect(new Set(STAR_CARD_LIST.map(card => card.id)).size).toBe(90);
    for (const [tier, total, perColor, points] of [[1, 40, 8, 5], [2, 30, 6, 55], [3, 20, 4, 80]]) {
      const cards = STAR_CARD_LIST.filter(card => card.tier === tier); expect(cards).toHaveLength(total); expect(cards.reduce((sum, card) => sum + card.prestige, 0)).toBe(points);
      for (const color of STAR_COLORS) expect(cards.filter(card => card.bonus === color)).toHaveLength(perColor);
    }
    expect(STAR_GUARDIAN_LIST.map(guardian => STAR_COLORS.map(color => guardian.requirements[color]).join('')).sort())
      .toEqual(['00440','04400','44000','40004','00044','03330','33300','33003','30033','00333'].sort());
    expect(STAR_GUARDIAN_LIST.every(guardian => guardian.prestige === 3)).toBe(true);
  });
  it.each([2, 3, 4])('sets up all ninety cards and the %i-player resource and guardian counts', count => {
    const ids = Array.from({ length: count }, (_, index) => String(index * 2 + 1)), h = harness(ids), G = h.raw();
    expect(G).toMatchObject({ status: 'briefing', round: 1, activePlayer: null, deckCounts: { 1: 36, 2: 26, 3: 16 } });
    expect(G.turnOrder).toEqual(ids); expect(G.guardians).toHaveLength(count + 1); h.conservation();
    const token = G.phaseEpoch; for (const id of ids) h.call(id, 'acknowledge', [token]);
    expect(h.raw()).toMatchObject({ status: 'turn', activePlayer: ids[0] }); h.call(ids[0], 'acknowledge', [token], false);
  });
  it('rejects invalid setup, forged options and malformed seats, and requires ready seats before the starter begins', () => {
    for (const count of [1, 5]) expect(StarGame.validateSetupData?.({}, count)).toBeTypeOf('string');
    for (const data of [{ participantIDs: ['0', '0'] }, { participantIDs: ['0', '20'] }, { options: { target: 1 } }, { startImmediately: 'yes' }]) expect(StarGame.validateSetupData?.(data as never, 2)).toBeTypeOf('string');
    const h = harness(['0', '2'], 'star-lobby', false);
    h.call('0', 'setReady', ['true'], false); h.call('0', 'startGame', [], false);
    h.call('0', 'setReady', [true]); h.call('2', 'setReady', [true]); h.call('2', 'startGame', [], false); h.call('0', 'startGame', []);
    expect(h.raw().status).toBe('briefing'); h.call('0', 'startGame', [], false); h.call('0', 'setReady', [false], false);
  });
});

describe('Star taking, reservations and exact payment', () => {
  it('requires three available distinct colors, allows scarce one/two-color choices and checks double-take before removal', () => {
    const h = harness(); h.acknowledge();
    h.reject('0', 'takeTokens', ['white']); h.reject('0', 'takeTokens', ['white', 'blue']); h.reject('0', 'takeTokens', ['gold', 'blue', 'red']);
    h.act('0', 'takeTokens', ['white', 'white']); expect(h.raw().bank.white).toBe(2); h.advanceTo('0'); h.reject('0', 'takeTokens', ['white', 'white']);
    h.giveTokens('2', { green: 4, red: 4, black: 4 });
    const choices = legalStarTokenChoices(h.raw()); expect(choices).toContainEqual(['white']); expect(choices).toContainEqual(['blue']); expect(choices).toContainEqual(['white', 'blue']);
    h.act('0', 'takeTokens', ['white']); expect(h.raw().players['0'].tokens.white).toBe(3); h.conservation();
  });
  it('keeps face-up reservations known, blind reservations private, refills only removed market slots and never grants a fourth reserve', () => {
    const h = harness(); h.acknowledge(); const market = h.raw().market[1][0]!, top = h.raw().secret!.decks[1][0];
    h.act('0', 'reserveCard', { kind: 'market', cardID: market });
    expect(h.raw().players['0'].reserved[0]).toMatchObject({ knownCardID: market, tier: 1 }); expect(h.raw().market[1][0]).toBe(top); h.advanceTo('0');
    const visible = clone(h.raw().market[2]), blindCard = h.raw().secret!.decks[2][0]; h.act('0', 'reserveCard', { kind: 'deck', tier: 2 });
    expect(h.raw().market[2]).toEqual(visible); expect(h.raw().players['0'].reserved[1].knownCardID).toBeNull();
    expect(h.raw().private['0'].reserved[1].cardID).toBe(blindCard); expect(h.raw().log.at(-1)).not.toHaveProperty('cardID'); h.advanceTo('0');
    h.act('0', 'reserveCard', { kind: 'deck', tier: 3 }); h.advanceTo('0'); h.reject('0', 'reserveCard', { kind: 'deck', tier: 1 }); h.conservation();
  });
  it('permits reservation when gold is exhausted and buying own reserved cards without replacing a market slot', () => {
    const h = harness(); h.acknowledge(); h.giveTokens('2', { gold: 5 }); const cardID = 'star-1-black-5'; h.faceup(cardID);
    h.act('0', 'reserveCard', { kind: 'market', cardID }); expect(h.raw().players['0'].tokens.gold).toBe(0); h.advanceTo('0');
    h.giveTokens('0', { green: 2, red: 1 }); const market = clone(h.raw().market);
    h.act('0', 'buyCard', cardID, starDefaultPayment(h.raw(), '0', cardID));
    expect(h.raw().players['0'].reserved).toEqual([]); expect(h.raw().private['0'].reserved).toEqual([]);
    expect(h.raw().market).toEqual(market); expect(h.raw().players['0'].bonuses.black).toBe(1); h.conservation();
  });
  it('accepts voluntary gold even while holding the matching color and rejects overpayment, wrong colors or unsupported payment fields', () => {
    for (const useGold of [false, true]) {
      const h = harness(); h.acknowledge(); const cardID = 'star-1-black-5'; h.faceup(cardID); h.giveTokens('0', { green: 2, red: 1, gold: 1 });
      h.reject('0', 'buyCard', cardID, { ...tokens({ green: 2, red: 1 }), fake: 1 });
      h.reject('0', 'buyCard', cardID, tokens({ green: 2, red: 1, gold: 1 })); h.reject('0', 'buyCard', cardID, tokens({ green: 1, red: 1 }));
      const payment = useGold ? tokens({ green: 2, gold: 1 }) : tokens({ green: 2, red: 1 });
      h.act('0', 'buyCard', cardID, payment);
      expect(h.raw().players['0'].tokens.red).toBe(Number(useGold)); expect(h.raw().players['0'].tokens.gold).toBe(Number(!useGold)); h.conservation();
    }
  });
  it('applies purchased bonuses without consuming cards or yielding change and never counts reserved bonuses', () => {
    const h = harness(); h.acknowledge(); h.purchased('0', ['star-1-green-1', 'star-1-green-2', 'star-1-green-3', 'star-1-red-1']);
    const cardID = 'star-1-black-5'; h.faceup(cardID); expect(starDiscountedCost(h.raw(), '0', cardID)).toEqual({ white: 0, blue: 0, green: 0, red: 0, black: 0 });
    h.act('0', 'buyCard', cardID, starEmptyTokens()); expect(h.raw().players['0'].purchased).toHaveLength(5); expect(starTokenTotal(h.raw().players['0'].tokens)).toBe(0); h.conservation();
  });
  it('leaves exhausted market slots empty and refuses blind reservation from an empty tier', () => {
    const h = harness(); h.acknowledge();
    h.purchased('2', h.raw().secret!.decks[1].slice(1));
    const first = h.raw().market[1][0]!, last = h.raw().secret!.decks[1][0]; h.fund('0', first); h.act('0', 'buyCard', first, starDefaultPayment(h.raw(), '0', first));
    expect(h.raw().market[1][0]).toBe(last); expect(h.raw().deckCounts[1]).toBe(0); h.reject('2', 'reserveCard', { kind: 'deck', tier: 1 });
    const next = h.raw().market[1][0]!; h.act('2', 'buyCard', next, starDefaultPayment(h.raw(), '2', next));
    expect(h.raw().market[1][0]).toBeNull(); expect(h.raw().market[1].filter(Boolean)).toHaveLength(3); h.conservation();
  });
});

describe('Star end-of-turn pending choices', () => {
  it('allows taking above ten, waits for exactly the excess and lets the owner return just-taken resources', () => {
    const h = harness(); h.acknowledge(); h.giveTokens('0', { white: 3, blue: 3, green: 2, red: 2 });
    const beforeTurn = h.raw().turnNumber; h.act('0', 'takeTokens', ['white', 'blue', 'black']); const token = h.raw().epoch;
    expect(h.raw()).toMatchObject({ status: 'return-tokens', activePlayer: '0', pending: { playerID: '0', returnCount: 3 }, turnNumber: beforeTurn });
    h.reject('0', 'takeTokens', ['white', 'blue', 'green']); h.reject('2', 'returnTokens', tokens({ white: 1, blue: 1, black: 1 }));
    h.reject('0', 'returnTokens', tokens({ white: 1 })); h.reject('0', 'returnTokens', tokens({ gold: 3 }));
    h.call('0', 'returnTokens', [tokens({ white: 1, blue: 1, black: 1 }), token - 1], false);
    h.act('0', 'returnTokens', tokens({ white: 1, blue: 1, black: 1 })); expect(h.raw()).toMatchObject({ status: 'turn', activePlayer: '2', turnNumber: beforeTurn + 1 });
    expect(starTokenTotal(h.raw().players['0'].tokens)).toBe(10); h.call('0', 'returnTokens', [tokens({ white: 1, blue: 1, black: 1 }), token], false); h.conservation();
  });
  it('lets a ten-token reservation return its newly acquired gold', () => {
    const h = harness(); h.acknowledge(); h.giveTokens('0', { white: 4, blue: 4, green: 2 });
    h.act('0', 'reserveCard', { kind: 'deck', tier: 1 }); expect(h.raw()).toMatchObject({ status: 'return-tokens', pending: { returnCount: 1 } });
    h.act('0', 'returnTokens', tokens({ gold: 1 })); expect(h.raw().players['0'].reserved).toHaveLength(1); expect(h.raw().players['0'].tokens.gold).toBe(0); h.conservation();
  });
  it('never treats held materials or unpurchased reserved works as guardian qualifications', () => {
    const h = harness(); h.acknowledge(); h.guardians(['draco','orion','cygnus']); h.giveTokens('0', { white: 4, blue: 4 });
    expect(STAR_GUARDIANS.draco.requirements).toMatchObject({ white: 4, blue: 4 });
    h.act('0', 'reserveCard', { kind: 'deck', tier: 1 }); expect(starEligibleGuardians(h.raw(), '0')).toEqual([]);
    expect(h.raw().players['0'].guardians).toEqual([]); expect(h.raw().players['0'].prestige).toBe(0); h.conservation();
  });
  function nobleFixture() {
    const h = harness(); h.acknowledge(); h.guardians(['draco', 'orion', 'cygnus']);
    h.purchased('0', ['star-1-white-1','star-1-white-2','star-1-white-3', ...[1,2,3,4].map(number => `star-1-blue-${number}`), ...[1,2,3,4].map(number => `star-1-black-${number}`)]);
    h.faceup('star-1-white-4'); return h;
  }
  it('requires choosing exactly one eligible guardian, then checks remaining eligible guardians after a later non-purchase action', () => {
    const h = nobleFixture(); h.act('0', 'buyCard', 'star-1-white-4', starEmptyTokens());
    expect(h.raw()).toMatchObject({ status: 'choose-guardian', activePlayer: '0', pending: { guardianIDs: ['draco', 'orion'] }, turnNumber: 0 });
    h.reject('2', 'chooseGuardian', 'draco'); h.reject('0', 'chooseGuardian', 'cygnus'); h.reject('0', 'takeTokens', ['red', 'green', 'white']);
    const token = h.raw().epoch; h.act('0', 'chooseGuardian', 'orion'); expect(h.raw().players['0'].guardians).toEqual(['orion']); expect(h.raw().guardians).not.toContain('orion');
    h.call('0', 'chooseGuardian', ['draco', token], false); h.advanceTo('0');
    h.act('0', 'takeTokens', ['red', 'green', 'white']); expect(h.raw().players['0'].guardians).toEqual(['orion', 'draco']);
    expect(h.raw().players['0'].prestige).toBe(6); expect(h.raw().players['0'].purchased).toHaveLength(12); h.conservation();
  });
  it('resolves excess resources before guardians and survives serialization in both pending stages', () => {
    const h = nobleFixture(); h.purchased('0', ['star-1-white-4']); h.giveTokens('0', { white: 4, blue: 4, green: 2 });
    h.act('0', 'takeTokens', ['red', 'green', 'black']); const savedReturn = h.snapshot(); h.restore(savedReturn);
    expect(h.raw().status).toBe('return-tokens'); h.reject('0', 'chooseGuardian', 'draco');
    h.act('0', 'returnTokens', tokens({ red: 1, green: 1, black: 1 })); const savedGuardian = h.snapshot(); h.restore(savedGuardian);
    expect(h.raw().status).toBe('choose-guardian'); h.reject('0', 'returnTokens', tokens()); h.act('0', 'chooseGuardian', 'draco');
    expect(h.raw()).toMatchObject({ status: 'turn', activePlayer: '2', pending: null }); h.conservation();
  });
});

describe('Star privacy, authorization and helper contracts', () => {
  it('never exposes a blind reservation identity through public IDs, logs or view projections, and hides all future decks even from god view', () => {
    const h = harness(); h.acknowledge(); const blindCard = h.raw().secret!.decks[2][0]; h.act('0', 'reserveCard', { kind: 'deck', tier: 2 });
    const G = h.raw(), before = clone(G), own = starPlayerView({ G, playerID: '0' }), other = starPlayerView({ G, playerID: '2' }), blind = starObserverView(G, 'blind'), god = starObserverView(G, 'god');
    expect(JSON.stringify(other)).not.toContain(blindCard); expect(JSON.stringify(blind)).not.toContain(blindCard); expect(JSON.stringify(own)).toContain(blindCard);
    expect(own.players['0'].reserved[0].id).toMatch(/^reserve-\d+$/); expect(Object.keys(other.private)).toEqual(['2']); expect(blind.private).toEqual({});
    for (const view of [own, other, blind, god]) expect(view.secret).toBeUndefined(); expect(starObserverView(god, 'blind')).toEqual(blind);
    const changed = clone(G); changed.secret!.decks[1].reverse(); changed.secret!.unusedGuardians.reverse();
    const replacement = changed.secret!.decks[2][0]; changed.secret!.decks[2][0] = changed.private['0'].reserved[0].cardID; changed.private['0'].reserved[0].cardID = replacement;
    expect(starPlayerView({ G: changed, playerID: '2' })).toEqual(other); expect(starObserverView(changed, 'blind')).toEqual(blind);
    expect(legalStarActions(changed, '2')).toEqual(legalStarActions(other, '2')); expect(G).toEqual(before); h.conservation();
  });
  it('rejects unknown/non-active actors, old epochs, opponent reservations, malformed vectors and extra reservation fields', () => {
    const h = harness(); h.acknowledge(); const cardID = h.raw().market[1][0]!;
    h.reject('2', 'takeTokens', ['white', 'blue', 'green']); h.reject('11', 'takeTokens', ['white', 'blue', 'green']);
    h.call('0', 'takeTokens', [['white', 'blue', 'green'], h.raw().epoch - 1], false);
    h.reject('0', 'takeTokens', ['white', 'white', 'white']); h.reject('0', 'takeTokens', []);
    h.reject('0', 'reserveCard', { kind: 'deck', tier: 1, cardID }); h.reject('0', 'reserveCard', { kind: 'deck', tier: '1' });
    h.reject('0', 'buyCard', cardID, tokens({ white: -1 })); h.reject('0', 'buyCard', cardID, tokens({ white: 0.5 }));
    h.act('0', 'reserveCard', { kind: 'market', cardID }); h.reject('2', 'buyCard', cardID, starEmptyTokens()); h.conservation();
  });
  it('rejects every direct framework event and leaves game, turn flow and authoritative version unchanged', () => {
    const h = harness(); h.acknowledge(); const snapshot = h.snapshot(), spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const [type, args] of [['endTurn', []], ['endGame', [{ winner: 'prestige' }]], ['endPhase', []], ['setPhase', ['bad']], ['endStage', []], ['setStage', ['bad']], ['pass', []], ['setActivePlayers', [{ all: 'bad' }]]] as [string, unknown[]][]) {
        h.restore(snapshot); h.event(type, args); expect(h.raw()).toEqual(snapshot.G); expect(h.snapshot()._stateID).toBe(snapshot._stateID);
        expect({ ...h.snapshot().ctx, _activePlayersNumMoves: undefined }).toEqual({ ...snapshot.ctx, _activePlayersNumMoves: undefined });
      }
    } finally { spy.mockRestore(); }
  });
  it('executes every helper-suggested main action with own-projection equality, while keeping arbitrary legal gold payment possible', () => {
    const h = harness(); h.acknowledge(); h.faceup('star-1-black-5'); h.giveTokens('0', { green: 2, red: 1, gold: 1 });
    const saved = h.snapshot(), view = starPlayerView({ G: h.raw(), playerID: '0' }), actions = legalStarActions(view, '0');
    expect(actions).toEqual(legalStarActions(h.raw(), '0')); expect(new Set(actions.map(action => action.move))).toEqual(new Set(['takeTokens', 'reserveCard', 'buyCard']));
    for (const action of actions) { h.restore(saved); h.call('0', action.move, action.args); h.conservation(); }
  });
});

describe('Star fifteen-prestige final table round and ranking', () => {
  const firstFourteen = ['star-3-black-4','star-3-blue-4','star-3-red-2'];
  const secondFourteen = ['star-3-white-2','star-3-green-2','star-3-black-1','star-3-blue-1'];
  it('a middle-seat trigger grants only later seats a turn and can be beaten before this same table round ends', () => {
    const h = harness(['0','2','7','11']); h.acknowledge(); h.guardians([]);
    h.purchased('2', firstFourteen); h.purchased('11', secondFourteen); h.faceup('star-1-white-8'); h.faceup('star-2-black-5');
    h.act('0', 'takeTokens', ['white','blue','green']); h.fund('2', 'star-1-white-8'); h.act('2', 'buyCard', 'star-1-white-8', starDefaultPayment(h.raw(), '2', 'star-1-white-8'));
    expect(h.raw()).toMatchObject({ status: 'turn', activePlayer: '7', endTriggeredBy: '2', round: 1, turnNumber: 2 });
    h.act('7', 'takeTokens', ['green','red','black']); h.fund('11', 'star-2-black-5'); h.act('11', 'buyCard', 'star-2-black-5', starDefaultPayment(h.raw(), '11', 'star-2-black-5'));
    expect(h.raw()).toMatchObject({ status: 'finished', winnerIDs: ['11'], round: 1, turnNumber: 4, finalScores: { '0': 0, '2': 15, '7': 0, '11': 16 } });
    expect(h.snapshot().ctx.gameover).toEqual({ winner: 'prestige', reason: 'completed-round' }); h.reject('0', 'takeTokens', ['white','blue','green']); h.conservation();
  });
  it('a last-seat trigger finishes immediately without starting another table round', () => {
    const h = harness(); h.acknowledge(); h.guardians([]); h.purchased('2', firstFourteen); h.faceup('star-1-white-8');
    h.act('0', 'takeTokens', ['white','blue','green']); h.fund('2', 'star-1-white-8'); h.act('2', 'buyCard', 'star-1-white-8', starDefaultPayment(h.raw(), '2', 'star-1-white-8'));
    expect(h.raw()).toMatchObject({ status: 'finished', endTriggeredBy: '2', round: 1, turnNumber: 2, winnerIDs: ['2'] }); h.conservation();
  });
  it('triggers only after the mandatory guardian supplies the last three points', () => {
    const h = harness(); h.acknowledge(); h.guardians(['draco','cygnus','lyra']);
    h.purchased('0', ['star-3-black-2','star-3-red-2','star-3-green-2', ...[1,2,3].map(number => `star-1-white-${number}`), ...[1,2,3,4].map(number => `star-1-blue-${number}`)]);
    h.faceup('star-1-white-4'); expect(h.raw().players['0'].prestige).toBe(12);
    h.act('0', 'buyCard', 'star-1-white-4', starEmptyTokens());
    expect(h.raw()).toMatchObject({ status: 'turn', activePlayer: '2', endTriggeredBy: '0' }); expect(h.raw().players['0'].prestige).toBe(15);
    expect(h.raw().log.slice(-2).map(entry => entry.type)).toEqual(['guardian','final-round']); h.act('2', 'takeTokens', ['white','blue','green']);
    expect(h.raw()).toMatchObject({ status: 'finished', winnerIDs: ['0'], round: 1 }); h.conservation();
  });
  it.each([false, true])('uses all purchased developments including zero-point cards for ties (extra zero card = %s)', extraZero => {
    const h = harness(); h.acknowledge(); h.guardians([]); h.purchased('0', firstFourteen); h.purchased('2', secondFourteen);
    if (extraZero) h.purchased('0', ['star-1-black-1']);
    h.faceup('star-1-white-8'); h.fund('0', 'star-1-white-8');
    h.act('0', 'buyCard', 'star-1-white-8', starDefaultPayment(h.raw(), '0', 'star-1-white-8')); h.faceup('star-1-green-8'); h.fund('2', 'star-1-green-8');
    h.act('2', 'buyCard', 'star-1-green-8', starDefaultPayment(h.raw(), '2', 'star-1-green-8'));
    expect(h.raw()).toMatchObject({ status: 'finished', finalScores: { '0': 15, '2': 15 }, winnerIDs: extraZero ? ['0','2'] : ['0'] }); h.conservation();
  });
  it('does not count unpurchased blind reservations against the development tie breaker', () => {
    const h = harness(); h.acknowledge(); h.guardians([]);
    for (let count = 0; count < 2; count++) { h.act('0', 'reserveCard', { kind: 'deck', tier: 1 }); h.advanceTo('0'); }
    h.purchased('0', firstFourteen); h.purchased('2', secondFourteen);
    const available = STAR_CARD_LIST.filter(card => card.tier === 1 && card.prestige === 1 && !h.raw().private['0'].reserved.some(reserve => reserve.cardID === card.id));
    const first = available[0].id, second = available[1].id; h.faceup(first); h.fund('0', first);
    h.act('0', 'buyCard', first, starDefaultPayment(h.raw(), '0', first)); h.faceup(second); h.fund('2', second); h.act('2', 'buyCard', second, starDefaultPayment(h.raw(), '2', second));
    expect(h.raw()).toMatchObject({ status: 'finished', winnerIDs: ['0'], finalScores: { '0': 15, '2': 15 } });
    expect(h.raw().players['0'].reserved).toHaveLength(2); expect(h.raw().players['0'].purchased).toHaveLength(4); expect(h.raw().players['2'].purchased).toHaveLength(5); h.conservation();
  });
});

describe('Star forced no-action boundary', () => {
  function blockedFixture() {
    const h = harness(); h.acknowledge();
    h.giveTokens('0', { white: 4, blue: 4, green: 2 }); h.giveTokens('2', { green: 2, red: 4, black: 4 });
    h.reserved('0', ['star-3-red-2','star-3-red-3','star-3-red-4']); h.reserved('2', ['star-3-blue-1','star-3-blue-3','star-3-blue-4']);
    h.market(1, ['star-1-black-1','star-1-blue-1','star-1-white-1','star-1-green-1']);
    h.market(2, ['star-2-black-5','star-2-blue-5','star-2-green-5','star-2-red-5']);
    h.market(3, ['star-3-black-2','star-3-white-2','star-3-green-2','star-3-white-3']);
    return h;
  }
  it('rejects free passing while any take, reserve or purchase remains available', () => {
    const h = harness(); h.acknowledge(); h.reject('0', 'forcedPass');
    const blocked = blockedFixture(); blocked.giveTokens('2', { red: 4, black: 4 });
    expect(legalStarActions(blocked.raw(), '0').some(action => action.move === 'takeTokens')).toBe(true); blocked.reject('0', 'forcedPass');
    const purchasable = blockedFixture(); purchasable.faceup('star-1-white-7'); expect(legalStarActions(purchasable.raw(), '0').some(action => action.move === 'buyCard')).toBe(true); purchasable.reject('0', 'forcedPass');
  });
  it('reaches a blocked seat through actual legal moves, offers one forced pass and clears its streak after the next ordinary action', () => {
    const h = harness(['0','1','2','3'], 'no-action-1'); h.acknowledge();
    const targets = [tokens({ white: 7, blue: 3 }), tokens({ green: 7, red: 3 }), tokens({ red: 4, black: 5, gold: 1 }), tokens({ blue: 4, black: 2, gold: 4 })];
    let random = 1, reached = false;
    const rng = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random / 4294967296; };
    for (let step = 0; step < 150; step++) {
      const G = h.raw(), id = G.activePlayer!, own = G.players[id], target = targets[Number(id)], actions = legalStarActions(starPlayerView({ G, playerID: id }), id);
      if (actions[0]?.move === 'forcedPass') {
        const before = clone(G), token = G.epoch; expect(actions).toEqual([{ move: 'forcedPass', args: [token] }]);
        h.reject(id === '0' ? '1' : '0', 'forcedPass'); h.call(id, 'forcedPass', [token - 1], false); h.act(id, 'forcedPass');
        expect(h.raw().private).toEqual(before.private); expect(h.raw().bank).toEqual(before.bank); expect(h.raw().market).toEqual(before.market);
        expect(h.raw().forcedPasses).toEqual([id]); expect(h.raw().log.at(-1)).toMatchObject({ type: 'forced-pass', actor: id });
        let changed = false;
        for (let next = 0; next < G.turnOrder.length && !changed; next++) {
          const actor = h.raw().activePlayer!, suggested = legalStarActions(starPlayerView({ G: h.raw(), playerID: actor }), actor)[0];
          h.call(actor, suggested.move, suggested.args); changed = suggested.move !== 'forcedPass';
        }
        expect(changed).toBe(true); expect(h.raw().forcedPasses).toEqual([]); reached = true; break;
      }
      if (G.status === 'return-tokens') {
        const returned = starEmptyTokens(), held = { ...own.tokens }; let remaining = G.pending!.returnCount;
        while (remaining-- > 0) { const color = [...STAR_TOKENS].filter(color => held[color] > 0).sort((a, b) => (held[b] - target[b]) - (held[a] - target[a]))[0]; returned[color]++; held[color]--; }
        h.act(id, 'returnTokens', returned); continue;
      }
      if (G.status === 'choose-guardian') { h.call(id, actions[0].move, actions[0].args); continue; }
      let choice: StarAction | undefined;
      if (own.reserved.length < 3 && (id !== '0' || G.bank.gold === 0)) choice = actions.find(action => action.move === 'reserveCard' && (action.args[0] as { kind: string; tier: number }).kind === 'deck' && (action.args[0] as { tier: number }).tier === 3) ?? actions.find(action => action.move === 'reserveCard');
      if (!choice) {
        const takes = actions.filter(action => action.move === 'takeTokens');
        takes.sort((a, b) => { const score = (action: StarAction) => (action.args[0] as StarColor[]).reduce((sum, color) => sum + (target[color] - own.tokens[color]) * 2 + rng(), 0); return score(b) - score(a); });
        choice = takes[0];
      }
      choice ??= actions.find(action => action.move === 'buyCard'); expect(choice).toBeTruthy(); h.call(id, choice!.move, choice!.args); h.conservation();
    }
    expect(reached).toBe(true); h.conservation();
  });
  it.each([false, true])('finishes only after a whole consecutive unchanged pass cycle and ranks current prestige (one-point advantage=%s)', advantage => {
    const h = blockedFixture(); if (advantage) h.purchased('0', ['star-1-black-8']);
    expect(legalStarActions(h.raw(), '0')).toEqual([{ move: 'forcedPass', args: [h.raw().epoch] }]); h.act('0', 'forcedPass');
    expect(h.raw()).toMatchObject({ status: 'turn', activePlayer: '2', forcedPasses: ['0'], winner: null }); const saved = h.snapshot(); h.restore(saved);
    const ownView = starPlayerView({ G: h.raw(), playerID: '2' }); expect(legalStarActions(ownView, '2')).toEqual([{ move: 'forcedPass', args: [h.raw().epoch] }]);
    const changedPrivate = clone(h.raw()); changedPrivate.private['0'].reserved.reverse(); expect(legalStarActions(changedPrivate, '2')).toEqual(legalStarActions(ownView, '2'));
    h.act('2', 'forcedPass'); expect(h.raw()).toMatchObject({ status: 'finished', winReason: 'stalemate', winner: 'prestige', winnerIDs: advantage ? ['0'] : ['0','2'] });
    expect(h.raw().finalScores).toEqual({ '0': Number(advantage), '2': 0 }); h.conservation();
  });
  it.each([false, true])('still resolves mandatory guardians before any stalemate or fifteen-point trigger (several=%s)', several => {
    const h = blockedFixture();
    h.market(2, ['star-2-black-3','star-2-white-3','star-2-white-4','star-2-green-1']);
    h.market(3, ['star-3-black-1','star-3-white-1','star-3-green-1','star-3-green-4']);
    h.purchased('0', [...[1,2,3,4].map(number => `star-1-white-${number}`), ...[1,2,3,4].map(number => `star-1-blue-${number}`), ...(several ? [1,2,3,4].map(number => `star-1-black-${number}`) : [])]);
    h.guardians(several ? ['draco','orion','cygnus'] : ['draco','cygnus','lyra']);
    if (several) h.purchased('0', ['star-3-black-2','star-3-white-3','star-3-blue-2']);
    h.market(1, ['star-1-green-3','star-1-green-6','star-1-green-7','star-1-red-4']);
    h.patch(G => { G.forcedPasses = ['2']; });
    expect(legalStarActions(h.raw(), '0')).toEqual([{ move: 'forcedPass', args: [h.raw().epoch] }]); h.act('0', 'forcedPass');
    if (several) { expect(h.raw()).toMatchObject({ status: 'choose-guardian', pending: { forcedPass: true }, winner: null }); h.act('0', 'chooseGuardian', 'orion'); }
    expect(h.raw()).toMatchObject({ status: 'turn', activePlayer: '2', forcedPasses: [], winner: null });
    expect(h.raw().players['0'].prestige).toBe(several ? 15 : 3); expect(h.raw().endTriggeredBy).toBe(several ? '0' : null); h.conservation();
  });
});
