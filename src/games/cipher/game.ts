import type { FnContext, Game } from 'boardgame.io';
import { ActivePlayers, INVALID_MOVE } from 'boardgame.io/core';

export type CipherStatus = 'lobby' | 'syncing' | 'playing' | 'pulse' | 'intermission' | 'finished';
export interface CipherSetupData {
  startImmediately?: boolean;
  participantIDs?: string[];
}
export interface CipherPlayer {
  ready: boolean;
  acknowledged: boolean;
  cardCount: number;
}
export interface CipherDiscardedCard {
  playerID: string;
  card: number;
}
export interface CipherEvent {
  type: 'transmit' | 'breach' | 'pulse' | 'level-complete' | 'sync';
  level: number;
  actorID?: string;
  card?: number;
  discarded?: CipherDiscardedCard[];
  cover?: number;
  pulses?: number;
}
export interface CipherState {
  rulesVersion: 1;
  status: CipherStatus;
  players: Record<string, CipherPlayer>;
  /** Only the server and this seat may see these cards. No undealt deck is retained. */
  private: Record<string, { cards: number[] }>;
  level: number;
  targetLevel: number;
  cover: number;
  pulses: number;
  /** Changes at every interaction boundary; ordinary transmissions share an epoch. */
  epoch: number;
  transmitted: number[];
  discarded: CipherDiscardedCard[];
  pulse: null | { proposerID: string; votes: Record<string, boolean | null> };
  winner: 'agents' | 'intercepted' | null;
  winReason: 'all-levels' | 'cover-blown' | null;
  log: CipherEvent[];
}

type MoveContext = FnContext<CipherState> & { playerID: string };
type RandomAPI = FnContext<CipherState>['random'];
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
const MAX_COVER = 6;
const MAX_PULSES = 3;

function isSeat(G: CipherState, playerID: unknown): playerID is string {
  return typeof playerID === 'string' && Object.prototype.hasOwnProperty.call(G.players, playerID);
}

function validToken(G: CipherState, playerID: unknown, level: unknown, epoch: unknown): boolean {
  return isSeat(G, playerID) && Number.isInteger(level) && Number.isInteger(epoch)
    && level === G.level && epoch === G.epoch;
}

function transition(G: CipherState, status: CipherStatus): void {
  G.status = status;
  G.epoch += 1;
  G.pulse = null;
  for (const player of Object.values(G.players)) player.acknowledged = false;
}

function finish(G: CipherState, won: boolean): void {
  transition(G, 'finished');
  G.winner = won ? 'agents' : 'intercepted';
  G.winReason = won ? 'all-levels' : 'cover-blown';
}

function deal(G: CipherState, random: RandomAPI): void {
  const shuffled = random.Shuffle(Array.from({ length: 100 }, (_, index) => index + 1));
  for (const [index, id] of Object.keys(G.players).entries()) {
    const cards = shuffled.slice(index * G.level, (index + 1) * G.level).sort((a, b) => a - b);
    G.private[id] = { cards };
    G.players[id].cardCount = cards.length;
  }
  G.transmitted = [];
  G.discarded = [];
  transition(G, 'syncing');
}

function beginGame(G: CipherState, random: RandomAPI): void {
  G.level = 1;
  deal(G, random);
}

/** Rewards apply only after a surviving team has cleared the level. */
function completeLevel(G: CipherState): boolean {
  if (!Object.values(G.players).every((player) => player.cardCount === 0)) return false;
  if ([2, 5, 8].includes(G.level)) G.pulses = Math.min(MAX_PULSES, G.pulses + 1);
  if ([3, 6, 9].includes(G.level)) G.cover = Math.min(MAX_COVER, G.cover + 1);
  G.log.push({ type: 'level-complete', level: G.level, cover: G.cover, pulses: G.pulses });
  if (G.level === G.targetLevel) finish(G, true);
  else transition(G, 'intermission');
  return true;
}

function setReady({ G, playerID }: MoveContext, ready: unknown) {
  if (G.status !== 'lobby' || !isSeat(G, playerID) || typeof ready !== 'boolean') return INVALID_MOVE;
  G.players[playerID].ready = ready;
}

function startGame({ G, playerID, random }: MoveContext) {
  if (G.status !== 'lobby' || playerID !== Object.keys(G.players)[0]
    || !Object.values(G.players).every((player) => player.ready)) return INVALID_MOVE;
  beginGame(G, random);
}

function readySync({ G, playerID }: MoveContext, level: unknown, epoch: unknown) {
  if (G.status !== 'syncing' || !validToken(G, playerID, level, epoch)
    || G.players[playerID].acknowledged) return INVALID_MOVE;
  G.players[playerID].acknowledged = true;
  if (Object.values(G.players).every((player) => player.acknowledged)) transition(G, 'playing');
}

function requestSync({ G, playerID }: MoveContext, level: unknown, epoch: unknown) {
  if (G.status !== 'playing' || !validToken(G, playerID, level, epoch)) return INVALID_MOVE;
  G.log.push({ type: 'sync', level: G.level, actorID: playerID });
  transition(G, 'syncing');
}

function playCard(
  { G, playerID }: MoveContext,
  expectedCard: unknown,
  level: unknown,
  epoch: unknown,
) {
  if (G.status !== 'playing' || !validToken(G, playerID, level, epoch)
    || !Number.isInteger(expectedCard) || typeof expectedCard !== 'number'
    || expectedCard < 1 || expectedCard > 100
    || G.private[playerID]?.cards[0] !== expectedCard) return INVALID_MOVE;

  G.private[playerID].cards.shift();
  G.players[playerID].cardCount -= 1;
  G.transmitted.push(expectedCard);
  G.log.push({ type: 'transmit', level: G.level, actorID: playerID, card: expectedCard });

  const discarded: CipherDiscardedCard[] = [];
  for (const id of Object.keys(G.players)) {
    const cards = G.private[id].cards;
    while (cards.length && cards[0] < expectedCard) {
      discarded.push({ playerID: id, card: cards.shift()! });
      G.players[id].cardCount -= 1;
    }
  }
  if (discarded.length) {
    G.cover -= 1;
    discarded.sort((a, b) => a.card - b.card);
    G.discarded.push(...discarded);
    G.log.push({ type: 'breach', level: G.level, actorID: playerID, card: expectedCard, discarded, cover: G.cover });
    // An exhausted cover reserve cannot be rescued by a reward from this level.
    if (G.cover === 0) {
      finish(G, false);
      return;
    }
    if (!completeLevel(G)) transition(G, 'syncing');
    return;
  }
  completeLevel(G);
}

function proposePulse({ G, playerID }: MoveContext, level: unknown, epoch: unknown) {
  if (G.status !== 'playing' || !validToken(G, playerID, level, epoch) || G.pulses < 1) return INVALID_MOVE;
  transition(G, 'pulse');
  G.pulse = {
    proposerID: playerID,
    votes: Object.fromEntries(Object.keys(G.players).map((id) => [id, id === playerID ? true : null])),
  };
}

function votePulse({ G, playerID }: MoveContext, accept: unknown, level: unknown, epoch: unknown) {
  if (G.status !== 'pulse' || !validToken(G, playerID, level, epoch) || typeof accept !== 'boolean'
    || !G.pulse || G.pulse.votes[playerID] !== null) return INVALID_MOVE;
  G.pulse.votes[playerID] = accept;
  if (!accept) {
    transition(G, 'syncing');
    return;
  }
  if (!Object.values(G.pulse.votes).every((vote) => vote === true)) return;
  const proposerID = G.pulse.proposerID;
  const discarded: CipherDiscardedCard[] = [];
  for (const id of Object.keys(G.players)) {
    const card = G.private[id].cards.shift();
    if (card !== undefined) {
      discarded.push({ playerID: id, card });
      G.players[id].cardCount -= 1;
    }
  }
  discarded.sort((a, b) => a.card - b.card);
  G.pulses -= 1;
  G.discarded.push(...discarded);
  G.log.push({ type: 'pulse', level: G.level, actorID: proposerID, discarded, pulses: G.pulses });
  if (!completeLevel(G)) transition(G, 'syncing');
}

function acknowledgeLevel({ G, playerID, random }: MoveContext, level: unknown, epoch: unknown) {
  if (G.status !== 'intermission' || !validToken(G, playerID, level, epoch)
    || G.players[playerID].acknowledged) return INVALID_MOVE;
  G.players[playerID].acknowledged = true;
  if (Object.values(G.players).every((player) => player.acknowledged)) {
    G.level += 1;
    deal(G, random);
  }
}

/** A whitelist keeps any future server-only fields out of all browser projections. */
export function cipherPlayerView({ G, playerID }: { G: CipherState; playerID: string | null }): CipherState {
  const ownInfo = isSeat(G, playerID) ? G.private[playerID] : undefined;
  return {
    rulesVersion: 1,
    status: G.status,
    players: Object.fromEntries(Object.entries(G.players).map(([id, player]) => [
      id, { ready: player.ready, acknowledged: player.acknowledged, cardCount: player.cardCount },
    ])),
    private: ownInfo && playerID !== null ? { [playerID]: { cards: [...ownInfo.cards] } } : {},
    level: G.level,
    targetLevel: G.targetLevel,
    cover: G.cover,
    pulses: G.pulses,
    epoch: G.epoch,
    transmitted: [...G.transmitted],
    discarded: G.discarded.map(({ playerID, card }) => ({ playerID, card })),
    pulse: G.pulse ? {
      proposerID: G.pulse.proposerID,
      votes: Object.fromEntries(Object.keys(G.players).map((id) => [id, G.pulse!.votes[id]])),
    } : null,
    winner: G.winner,
    winReason: G.winReason,
    log: G.log.map((entry) => ({
      type: entry.type,
      level: entry.level,
      ...(entry.actorID === undefined ? {} : { actorID: entry.actorID }),
      ...(entry.card === undefined ? {} : { card: entry.card }),
      ...(entry.discarded === undefined ? {} : {
        discarded: entry.discarded.map(({ playerID, card }) => ({ playerID, card })),
      }),
      ...(entry.cover === undefined ? {} : { cover: entry.cover }),
      ...(entry.pulses === undefined ? {} : { pulses: entry.pulses }),
    })),
  };
}

export function cipherObserverView(G: CipherState, perspective: 'blind' | 'god'): CipherState {
  const view = cipherPlayerView({ G, playerID: null });
  if (perspective === 'god') {
    for (const id of Object.keys(G.players)) {
      if (G.private[id]) view.private[id] = { cards: [...G.private[id].cards] };
    }
  }
  return view;
}

// Every accepted move has explicit phase/seat/epoch/card guards. Unrelated
// simultaneous moves therefore survive boardgame.io's state-ID check.
const simultaneousMove = {
  ignoreStaleStateID: true, client: false, undoable: false, redact: true,
} as const;

export const CipherGame: Game<CipherState, Record<string, unknown>, CipherSetupData> = {
  name: 'encrypted-call',
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  validateSetupData: (setupData, numPlayers) => {
    if (!Number.isInteger(numPlayers) || numPlayers < MIN_PLAYERS || numPlayers > MAX_PLAYERS) {
      return '加密通話需要 2～4 位玩家。';
    }
    if (setupData !== undefined && (!setupData || typeof setupData !== 'object'
      || Array.isArray(setupData)
      || (setupData.startImmediately !== undefined && typeof setupData.startImmediately !== 'boolean'))) {
      return '遊戲開始設定不正確。';
    }
    if (setupData?.participantIDs !== undefined && (!Array.isArray(setupData.participantIDs)
      || setupData.participantIDs.length !== numPlayers
      || setupData.participantIDs.some((id: unknown) => typeof id !== 'string' || !/^[0-7]$/.test(id))
      || new Set(setupData.participantIDs).size !== numPlayers)) return '參與玩家席位不正確。';
    return undefined;
  },
  setup: ({ ctx, random }, setupData) => {
    if (!Number.isInteger(ctx.numPlayers) || ctx.numPlayers < MIN_PLAYERS || ctx.numPlayers > MAX_PLAYERS) {
      throw new RangeError('加密通話需要 2～4 位玩家。');
    }
    const ids = setupData?.participantIDs ?? Array.from({ length: ctx.numPlayers }, (_, index) => String(index));
    const G: CipherState = {
      rulesVersion: 1,
      status: 'lobby',
      players: Object.fromEntries(ids.map((id) => [
        id, { ready: setupData?.startImmediately === true, acknowledged: false, cardCount: 0 },
      ])),
      private: {},
      level: 0,
      targetLevel: ctx.numPlayers === 2 ? 12 : ctx.numPlayers === 3 ? 10 : 8,
      cover: ctx.numPlayers,
      pulses: 1,
      epoch: 0,
      transmitted: [],
      discarded: [],
      pulse: null,
      winner: null,
      winReason: null,
      log: [],
    };
    if (setupData?.startImmediately) beginGame(G, random);
    return G;
  },
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
    readySync: { move: readySync, ...simultaneousMove },
    requestSync: { move: requestSync, ...simultaneousMove },
    playCard: { move: playCard, ...simultaneousMove },
    proposePulse: { move: proposePulse, ...simultaneousMove },
    votePulse: { move: votePulse, ...simultaneousMove },
    acknowledgeLevel: { move: acknowledgeLevel, ...simultaneousMove },
  },
  disableUndo: true,
  plugins: [{
    name: 'cipher-flow-guard',
    setup: () => ({}),
    isInvalid: ({ G, ctx }) => {
      if (G.status === 'finished') {
        return ctx.gameover?.winner === G.winner && ctx.gameover?.reason === G.winReason
          ? false : 'Game completion must follow the cipher rules.';
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
    endGame: false, endPhase: false, endTurn: false, setPhase: false,
    endStage: false, setStage: false, pass: false, setActivePlayers: false,
  },
  playerView: cipherPlayerView,
  endIf: ({ G }) => G.status === 'finished' ? { winner: G.winner, reason: G.winReason } : undefined,
};
