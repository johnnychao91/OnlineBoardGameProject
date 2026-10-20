import type { FnContext, Game } from 'boardgame.io';
import { ActivePlayers, INVALID_MOVE } from 'boardgame.io/core';
import { stationRolePool } from './view-model';

export type Role = 'engineer' | 'saboteur';
export type CardKind = 'stable' | 'repair' | 'hazard';
export type Composition = Record<CardKind, number>;
export type GameStatus = 'lobby' | 'briefing' | 'claiming' | 'playing' | 'finished';
export type WinReason = 'all-repairs' | 'hazard' | 'round-limit';

export interface StationSetupData {
  /** The HTTP lobby has already authorized starting with these participants. */
  startImmediately?: boolean;
  /** Stable occupied seat IDs, provided only by the authorized server lobby. */
  participantIDs?: string[];
}

export interface StationPlayer {
  ready: boolean;
  acknowledged: boolean;
  cardCount: number;
  /** Public statement about this round's repair cards; players may bluff. */
  claim?: number | null;
  revealedRole?: Role;
}

export interface PrivatePlayerInfo {
  role: Role;
  composition: Composition;
}

export interface RevealRecord {
  round: number;
  actorID: string;
  targetID: string;
  /** V2: fixed round slot. Legacy: position in the remaining cards when revealed. */
  slot: number;
  kind: CardKind;
}

export interface PendingReveal {
  actorID: string;
  targetID: string;
  slot: number;
  round: number;
  /** Monotonically increasing per match, including across rounds. */
  selectionID: number;
}

export interface StationState {
  /** Absent in saved legacy matches; those keep their original move semantics. */
  rulesVersion?: 2;
  status: GameStatus;
  players: Record<string, StationPlayer>;
  /** V2 uses fixed slots throughout a round; null means still face down. */
  publicCards?: Record<string, (CardKind | null)[]>;
  pendingReveal?: PendingReveal | null;
  selectionSequence?: number;
  round: number;
  revealsThisRound: number;
  repairsFound: number;
  repairsRequired: number;
  activePlayer: string | null;
  winner: Role | null;
  winReason: WinReason | null;
  log: RevealRecord[];
  /** The server holds every entry. A client receives only its own entry. */
  private: Record<string, PrivatePlayerInfo>;
  /** Never included in playerView, including after the game ends. */
  secret?: {
    cards: Record<string, CardKind[]>;
    unusedRoles: Role[];
  };
}

/** A deliberately limited projection for observer and replay APIs. */
export type StationObserverState = Omit<StationState, 'secret'> & {
  secret?: { cards: Record<string, CardKind[]> };
};

export type G = StationState;
type MoveContext = FnContext<StationState> & { playerID: string };
type RandomAPI = FnContext<StationState>['random'];

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 8;
const MAX_ROUNDS = 4;

function isSeat(G: StationState, playerID: unknown): playerID is string {
  return typeof playerID === 'string'
    && Object.prototype.hasOwnProperty.call(G.players, playerID);
}

function compositionOf(cards: CardKind[]): Composition {
  const result: Composition = { stable: 0, repair: 0, hazard: 0 };
  for (const kind of cards) result[kind] += 1;
  return result;
}

function dealRound(G: StationState, deck: CardKind[], random: RandomAPI): void {
  const ids = Object.keys(G.players);
  const shuffled = random.Shuffle(deck);
  const perPlayer = shuffled.length / ids.length;
  if (!G.secret || !Number.isInteger(perPlayer)) {
    throw new Error('Cannot deal an invalid station state.');
  }
  if (G.rulesVersion === 2) {
    G.publicCards = {};
    G.pendingReveal = null;
  }
  ids.forEach((id, index) => {
    const cards = random.Shuffle(shuffled.slice(index * perPlayer, (index + 1) * perPlayer));
    G.secret!.cards[id] = cards;
    G.private[id].composition = compositionOf(cards);
    G.players[id].cardCount = cards.length;
    G.players[id].acknowledged = false;
    if (G.rulesVersion === 2) {
      G.publicCards![id] = cards.map(() => null);
      G.players[id].claim = null;
    }
  });
  G.revealsThisRound = 0;
  G.status = 'briefing';
}

function finish(G: StationState, winner: Role, reason: WinReason): void {
  G.status = 'finished';
  G.winner = winner;
  G.winReason = reason;
  G.activePlayer = null;
  if (G.rulesVersion === 2) G.pendingReveal = null;
  for (const id of Object.keys(G.players)) {
    G.players[id].revealedRole = G.private[id].role;
  }
}

function setReady({ G, playerID }: MoveContext, ready: unknown) {
  if (G.status !== 'lobby' || !isSeat(G, playerID) || typeof ready !== 'boolean') {
    return INVALID_MOVE;
  }
  G.players[playerID].ready = ready;
}

function beginGame(G: StationState, random: RandomAPI): void {
  const ids = Object.keys(G.players);
  const roles = random.Shuffle(stationRolePool(ids.length));
  G.secret = { cards: {}, unusedRoles: roles.slice(ids.length) };
  ids.forEach((id, index) => {
    G.private[id] = {
      role: roles[index],
      composition: { stable: 0, repair: 0, hazard: 0 },
    };
  });
  G.round = 1;
  G.activePlayer = ids[0];
  const deck: CardKind[] = [
    ...Array<CardKind>(4 * ids.length - 1).fill('stable'),
    ...Array<CardKind>(ids.length).fill('repair'),
    'hazard',
  ];
  dealRound(G, deck, random);
}

function startGame({ G, playerID, random }: MoveContext) {
  if (G.status !== 'lobby' || playerID !== '0'
    || !Object.values(G.players).every((player) => player.ready)) {
    return INVALID_MOVE;
  }
  beginGame(G, random);
}

function acknowledge({ G, playerID }: MoveContext) {
  if (G.status !== 'briefing' || !isSeat(G, playerID)
    || G.players[playerID].acknowledged || !G.private[playerID]) {
    return INVALID_MOVE;
  }
  G.players[playerID].acknowledged = true;
  if (Object.values(G.players).every((player) => player.acknowledged)) {
    G.status = G.rulesVersion === 2 ? 'claiming' : 'playing';
  }
}

function declareRepairs({ G, playerID }: MoveContext, count: unknown, round: unknown) {
  if (G.rulesVersion !== 2 || G.status !== 'claiming' || !isSeat(G, playerID)
    || typeof round !== 'number' || !Number.isInteger(round) || round !== G.round
    || G.players[playerID].claim !== null || typeof count !== 'number'
    || !Number.isInteger(count) || count < 0 || !G.publicCards?.[playerID]
    || count > G.publicCards[playerID].length) {
    return INVALID_MOVE;
  }
  G.players[playerID].claim = count;
  if (Object.values(G.players).every((player) => player.claim !== null && player.claim !== undefined)) {
    G.status = 'playing';
  }
}

function isLegalTarget(G: StationState, playerID: string, targetID: unknown, slot: unknown):
  targetID is string {
  if (G.status !== 'playing' || !isSeat(G, playerID)
    || G.activePlayer !== playerID || !isSeat(G, targetID)
    || targetID === playerID || typeof slot !== 'number'
    || !Number.isInteger(slot) || slot < 0 || !G.secret) {
    return false;
  }
  const cards = G.secret.cards[targetID];
  return !!cards && slot < cards.length
    && (G.rulesVersion !== 2 || G.publicCards?.[targetID]?.[slot] === null);
}

function selectCard({ G, playerID }: MoveContext, targetID: unknown, slot: unknown) {
  if (G.rulesVersion !== 2 || !isLegalTarget(G, playerID, targetID, slot)) return INVALID_MOVE;
  G.selectionSequence = (G.selectionSequence ?? 0) + 1;
  G.pendingReveal = {
    actorID: playerID, targetID, slot: slot as number, round: G.round,
    selectionID: G.selectionSequence,
  };
}

function clearSelection({ G, playerID }: MoveContext) {
  if (G.rulesVersion !== 2 || G.status !== 'playing' || !isSeat(G, playerID)
    || G.activePlayer !== playerID || !G.pendingReveal
    || G.pendingReveal.actorID !== playerID) {
    return INVALID_MOVE;
  }
  G.pendingReveal = null;
}

function reveal(
  { G, playerID, random }: MoveContext,
  targetID: unknown,
  slot: unknown,
  selectionID?: unknown,
) {
  if (!isLegalTarget(G, playerID, targetID, slot)) return INVALID_MOVE;
  const position = slot as number;
  if (G.rulesVersion === 2) {
    const pending = G.pendingReveal;
    if (!pending || typeof selectionID !== 'number' || !Number.isSafeInteger(selectionID)
      || pending.actorID !== playerID || pending.targetID !== targetID
      || pending.slot !== position || pending.round !== G.round
      || pending.selectionID !== selectionID) {
      return INVALID_MOVE;
    }
  }

  const cards = G.secret!.cards[targetID];
  const kind = G.rulesVersion === 2 ? cards[position] : cards.splice(position, 1)[0];
  if (G.rulesVersion === 2) {
    G.publicCards![targetID][position] = kind;
    G.pendingReveal = null;
    G.players[targetID].cardCount -= 1;
  } else {
    G.players[targetID].cardCount = cards.length;
  }
  G.private[targetID].composition[kind] -= 1;
  G.revealsThisRound += 1;
  G.log.push({ round: G.round, actorID: playerID, targetID, slot: position, kind });
  G.activePlayer = targetID;

  if (kind === 'hazard') {
    finish(G, 'saboteur', 'hazard');
    return;
  }
  if (kind === 'repair') G.repairsFound += 1;
  // Immediate card results take precedence over the round's time limit.
  if (G.repairsFound === G.repairsRequired) {
    finish(G, 'engineer', 'all-repairs');
    return;
  }
  if (G.revealsThisRound === Object.keys(G.players).length) {
    if (G.round === MAX_ROUNDS) {
      finish(G, 'saboteur', 'round-limit');
      return;
    }
    const remaining = Object.entries(G.secret!.cards).flatMap(([id, hand]) =>
      G.rulesVersion === 2 ? hand.filter((_, index) => G.publicCards![id][index] === null) : hand);
    G.round += 1;
    dealRound(G, remaining, random);
  }
}

function copyPrivateInfo(info: PrivatePlayerInfo): PrivatePlayerInfo {
  return {
    role: info.role,
    composition: {
      stable: info.composition.stable,
      repair: info.composition.repair,
      hazard: info.composition.hazard,
    },
  };
}

/** Keep client state deliberately explicit so newly added server fields cannot leak. */
export function stationPlayerView({ G, playerID }: {
  G: StationState;
  playerID: string | null;
}): StationState {
  const ownInfo = playerID !== null && isSeat(G, playerID) ? G.private[playerID] : undefined;
  return {
    ...(G.rulesVersion === undefined ? {} : { rulesVersion: G.rulesVersion }),
    status: G.status,
    players: Object.fromEntries(Object.entries(G.players).map(([id, player]) => [id, {
      ready: player.ready,
      acknowledged: player.acknowledged,
      cardCount: player.cardCount,
      ...(player.claim === undefined ? {} : { claim: player.claim }),
      ...(player.revealedRole === undefined ? {} : { revealedRole: player.revealedRole }),
    }])),
    ...(G.publicCards === undefined ? {} : {
      publicCards: Object.fromEntries(Object.keys(G.players).filter((id) =>
        Object.prototype.hasOwnProperty.call(G.publicCards, id))
        .map((id) => [id, [...G.publicCards![id]]])),
    }),
    ...(G.pendingReveal === undefined ? {} : {
      pendingReveal: G.pendingReveal === null ? null : {
        actorID: G.pendingReveal.actorID,
        targetID: G.pendingReveal.targetID,
        slot: G.pendingReveal.slot,
        round: G.pendingReveal.round,
        selectionID: G.pendingReveal.selectionID,
      },
    }),
    ...(G.selectionSequence === undefined ? {} : { selectionSequence: G.selectionSequence }),
    round: G.round,
    revealsThisRound: G.revealsThisRound,
    repairsFound: G.repairsFound,
    repairsRequired: G.repairsRequired,
    activePlayer: G.activePlayer,
    winner: G.winner,
    winReason: G.winReason,
    log: G.log.map((entry) => ({
      round: entry.round, actorID: entry.actorID, targetID: entry.targetID,
      slot: entry.slot, kind: entry.kind,
    })),
    private: ownInfo && playerID !== null
      ? { [playerID]: copyPrivateInfo(ownInfo) }
      : {},
  };
}

/** Authorization belongs to the API; unknown runtime perspectives fail closed. */
export function stationObserverView(
  G: StationState,
  perspective: 'blind' | 'god',
): StationObserverState {
  const view: StationObserverState = stationPlayerView({ G, playerID: null });
  if (perspective !== 'god') return view;

  for (const id of Object.keys(G.players)) {
    if (G.private[id]) view.private[id] = copyPrivateInfo(G.private[id]);
  }
  if (G.secret) {
    view.secret = { cards: {} };
    for (const id of Object.keys(G.players)) {
      const cards = G.secret.cards[id];
      if (cards) view.secret.cards[id] = [...cards];
    }
  }
  return view;
}

export const StationGame: Game<StationState, Record<string, unknown>, StationSetupData> = {
  name: 'space-station',
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  validateSetupData: (setupData, numPlayers) => {
    if (!Number.isInteger(numPlayers) || numPlayers < MIN_PLAYERS || numPlayers > MAX_PLAYERS) {
      return '太空維修站需要 4～8 位玩家。';
    }
    if (setupData !== undefined && (!setupData || typeof setupData !== 'object'
      || Array.isArray(setupData)
      || (setupData.startImmediately !== undefined && typeof setupData.startImmediately !== 'boolean'))) {
      return '遊戲開始設定不正確。';
    }
    if (setupData?.participantIDs !== undefined && (!Array.isArray(setupData.participantIDs)
      || setupData.participantIDs.length !== numPlayers
      || setupData.participantIDs.some((id: unknown) => typeof id !== 'string' || !/^[0-7]$/.test(id))
      || new Set(setupData.participantIDs).size !== numPlayers)) {
      return '參與玩家席位不正確。';
    }
    return undefined;
  },
  setup: ({ ctx, random }, setupData) => {
    if (!Number.isInteger(ctx.numPlayers)
      || ctx.numPlayers < MIN_PLAYERS || ctx.numPlayers > MAX_PLAYERS) {
      throw new RangeError('太空維修站需要 4～8 位玩家。');
    }
    const G: StationState = {
      rulesVersion: 2,
      status: 'lobby',
      players: Object.fromEntries((setupData?.participantIDs ?? Array.from({ length: ctx.numPlayers }, (_, index) => String(index))).map((id: string) => [
        id, { ready: setupData?.startImmediately === true, acknowledged: false, cardCount: 0, claim: null },
      ])),
      publicCards: {},
      pendingReveal: null,
      selectionSequence: 0,
      round: 0,
      revealsThisRound: 0,
      repairsFound: 0,
      repairsRequired: ctx.numPlayers,
      activePlayer: null,
      winner: null,
      winReason: null,
      log: [],
      private: {},
    };
    if (setupData?.startImmediately === true) beginGame(G, random);
    return G;
  },
  // Everyone must be able to ready/acknowledge. Each move independently enforces
  // its status and actor restrictions; G.activePlayer is the actual turn owner.
  turn: {
    order: {
      first: () => 0,
      next: ({ ctx }) => (ctx.playOrderPos + 1) % ctx.playOrder.length,
      playOrder: ({ G }) => Object.keys(G.players),
    },
    activePlayers: ActivePlayers.ALL,
  },
  moves: {
    setReady: { move: setReady, client: false, undoable: false, redact: true },
    startGame: { move: startGame, client: false, undoable: false, redact: true },
    acknowledge: { move: acknowledge, client: false, undoable: false, redact: true },
    // Each seat can declare once in this round. Other seats' concurrent
    // declarations must not invalidate its state ID; the explicit round token
    // rejects a delayed statement from an earlier round.
    declareRepairs: {
      move: declareRepairs, ignoreStaleStateID: true, client: false, undoable: false, redact: true,
    },
    selectCard: { move: selectCard, client: false, undoable: false, redact: true },
    clearSelection: { move: clearSelection, client: false, undoable: false, redact: true },
    reveal: { move: reveal, client: false, undoable: false, redact: true },
  },
  disableUndo: true,
  // In boardgame.io 0.50.2, disabling event dispatchers alone does not reject a
  // hand-crafted GAME_EVENT. The server also whitelists packets; this guard
  // independently rolls back changes to the fixed framework turn/stage setup.
  plugins: [{
    name: 'station-flow-guard',
    setup: () => ({}),
    isInvalid: ({ G, ctx }) => {
      if (G.status === 'finished') {
        return ctx.gameover?.winner === G.winner && ctx.gameover?.reason === G.winReason
          ? false : 'Game completion must follow the station rules.';
      }
      if (ctx.gameover !== undefined || ctx.turn !== 1 || ctx.currentPlayer !== Object.keys(G.players)[0]
        || ctx.phase !== null || !ctx.activePlayers
        || Object.keys(ctx.activePlayers).length !== Object.keys(G.players).length
        || Object.keys(G.players).some((id) => ctx.activePlayers![id] !== null)
        || Object.keys(ctx._activePlayersMinMoves ?? {}).length > 0
        || Object.keys(ctx._activePlayersMaxMoves ?? {}).length > 0
        || ctx._nextActivePlayers != null || (ctx._prevActivePlayers?.length ?? 0) > 0) {
        return 'Direct framework events are disabled for this game.';
      }
      return false;
    },
  }],
  events: {
    endGame: false,
    endPhase: false,
    endTurn: false,
    setPhase: false,
    endStage: false,
    setStage: false,
    pass: false,
    setActivePlayers: false,
  },
  playerView: stationPlayerView,
  endIf: ({ G }) => G.status === 'finished'
    ? { winner: G.winner, reason: G.winReason }
    : undefined,
};
