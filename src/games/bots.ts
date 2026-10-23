import type { GameID } from './catalog';
import { stationPlayerView, type StationState } from './station/game';
import { getCardSlots, repairClaimMaximum } from './station/view-model';
import { cipherPlayerView, type CipherState } from './cipher/game';
import { fogAllowedQuestCards, fogPlayerView, type FogState } from './fog/game';
import { fogTeamSizes } from './fog/rules';
import { moonPlayerView, type MoonState } from './moon/game';
import { isTuringSharedTable, turingCards, turingTableOrder, turingPlayerView, type TuringState } from './turing/game';

export interface BotAction { move: string; args: unknown[] }
type Random = () => number;
type BotState = { G: any; ctx?: { gameover?: unknown } };
const action = (move: string, ...args: unknown[]): BotAction => ({ move, args });
const pick = <T>(items: readonly T[], random: Random): T => items[Math.floor(random() * items.length)];
function shuffled<T>(items: readonly T[], random: Random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function stationAction(G: StationState, id: string, random: Random): BotAction | null {
  const own = G.players[id];
  if (G.status === 'briefing' && !own.acknowledged) {
    return G.rulesVersion === 3 ? action('acknowledgeBriefing', G.round) : action('acknowledge');
  }
  if (G.status === 'claiming' && own.claim == null && !own.claimSubmitted) {
    const maximum = repairClaimMaximum(G, id);
    const truth = Math.min(maximum, G.private[id]?.composition.repair ?? 0);
    return action('declareRepairs', random() < 0.6 ? truth : Math.floor(random() * (maximum + 1)), G.round);
  }
  if (G.status === 'round-review' && !own.reviewAcknowledged) return action('acknowledgeRound', G.round);
  if (G.status !== 'playing' || G.activePlayer !== id) return null;
  if (G.pendingReveal?.actorID === id) {
    return action('reveal', G.pendingReveal.targetID, G.pendingReveal.slot, G.pendingReveal.selectionID);
  }
  const targets = Object.keys(G.players).filter(other => other !== id).flatMap(targetID =>
    getCardSlots(G, targetID).filter(card => card.kind === null).map(card => ({ targetID, slot: card.slot })));
  if (!targets.length) return null;
  const target = pick(targets, random);
  return action(G.rulesVersion === 2 || G.rulesVersion === 3 ? 'selectCard' : 'reveal', target.targetID, target.slot);
}

function cipherAction(G: CipherState, id: string, random: Random): BotAction | null {
  const own = G.players[id];
  if (G.status === 'syncing' && !own.acknowledged) return action('readySync', G.level, G.epoch);
  if (G.status === 'intermission' && !own.acknowledged) return action('acknowledgeLevel', G.level, G.epoch);
  if (G.status === 'pulse' && G.pulse?.votes[id] === null) return action('votePulse', true, G.level, G.epoch);
  const card = G.private[id]?.cards[0];
  if (G.status !== 'playing' || card === undefined) return null;
  // Never inspect another hand. A larger gap from public signals tends to wait
  // longer, leaving humans time to transmit; this remains a fallible random bot.
  if (G.pulses > 0 && random() < 0.025) return action('proposePulse', G.level, G.epoch);
  const previous = Math.max(0, ...G.transmitted, ...G.discarded.map(item => item.card));
  const chance = Math.max(0.06, Math.min(0.85, 3 / (Math.max(1, card - previous) + 2)));
  return random() < chance ? action('playCard', card, G.level, G.epoch) : null;
}

function fogAction(G: FogState, id: string, random: Random): BotAction | null {
  const own = G.players[id], info = G.private[id];
  if (['briefing', 'vote-review', 'quest-review'].includes(G.status) && !own.acknowledged) return action('acknowledge', G.epoch);
  if (G.status === 'nomination' && G.leaderID === id) {
    const size = fogTeamSizes(Object.keys(G.players).length)[G.quest - 1];
    return G.team.length === size ? action('confirmTeam', G.epoch)
      : action('selectTeam', shuffled(Object.keys(G.players), random).slice(0, size), G.epoch);
  }
  if (G.status === 'voting' && !own.voteSubmitted) return action('vote', random() < 0.75, G.epoch);
  if (G.status === 'quest' && G.team.includes(id) && !own.questSubmitted && info) {
    return action('submitQuest', pick(fogAllowedQuestCards(info, G.options), random), G.epoch);
  }
  if (G.status === 'assassination' && info?.role === 'assassin') {
    const others = Object.keys(G.players).filter(other => other !== id);
    const unknown = others.filter(other => !info.knownEvil.includes(other));
    return action('assassinate', pick(unknown.length ? unknown : others, random), G.epoch);
  }
  return null;
}

function moonAction(G: MoonState, id: string, random: Random): BotAction | null {
  const own = G.players[id], info = G.private[id];
  const living = Object.keys(G.players).filter(other => G.players[other].alive);
  const others = living.filter(other => other !== id);
  if (['briefing', 'dawn', 'vote-review'].includes(G.status) && own.alive && !own.acknowledged) return action('acknowledge', G.epoch);
  // Deadline advancement belongs exclusively to the shared server clock.
  if (G.deadline === null || Date.now() >= G.deadline) return null;
  if (G.status === 'hunter' && G.hunterID === id) {
    const targets = G.configuration?.forcedHunter && info?.role === 'hunter' && living.length ? living : [...living, null];
    return action('hunterShoot', pick(targets, random), G.epoch);
  }
  if (G.status === 'sheriff-transfer' && G.sheriffTransferID === id) {
    return action('transferBadge', pick([...living.filter(other => !G.players[other].voteDisabled), null], random), G.epoch);
  }
  if (!own.alive || !info) return null;
  if (G.status === 'night' && !info.nightSubmitted) {
    if (G.nightStep === 0 && info.role === 'guard') return action('guard', pick([...living.filter(other => other !== info.previousGuard), null], random), G.epoch);
    if (G.nightStep === 1 && info.faction === 'wolves' && !(G.configuration?.firstNightPeace && G.day === 1)) {
      // The authorized view supplies legal targets without inspecting another
      // seat's role. Legacy matches keep their non-wolf-only targeting rule.
      const targets = info.wolfTargets ?? others.filter(other => !info.knownWolves.includes(other));
      const teammateChoices = Object.values(info.wolfVotes).filter((other): other is string => other !== null && targets.includes(other));
      const target = teammateChoices.length && random() < 0.8 ? pick(teammateChoices, random) : pick([...targets, null], random);
      return action('wolfVote', target, G.epoch);
    }
    if (G.nightStep === 2 && info.role === 'seer') {
      const unchecked = others.filter(other => !info.checks.some(check => check.targetID === other));
      return action('inspect', pick(unchecked.length ? unchecked : [...others, null], random), G.epoch);
    }
    if (G.nightStep === 3 && info.role === 'witch') {
      if (info.antidote && info.attackedID && (info.attackedID !== id || G.day === 1) && random() < 0.75) {
        return action('witch', 'save', info.attackedID, G.epoch);
      }
      if (info.poison && others.length && random() < 0.2) return action('witch', 'poison', pick(others, random), G.epoch);
      return action('witch', 'skip', null, G.epoch);
    }
  }
  if (G.status === 'speaking' && G.configuration?.allowWolfExplosion && info.faction === 'wolves' && info.role !== 'ghost-rider' && random() < 0.03) {
    if (info.role === 'white-wolf-king' && others.length) return action('wolfExplode', pick(others, random), G.epoch);
    if (info.role === 'wolf' || info.role === 'wolf-king') return action('wolfExplode', null, G.epoch);
  }
  if (['speaking', 'sheriff-speech'].includes(G.status) && G.speakerID === id) return action('finishSpeech', G.epoch);
  if (G.status === 'voting' && !own.voteDisabled && !info.voteSubmitted) {
    const candidates = G.voteCandidates.filter(other => other !== id);
    return action('exileVote', pick([...candidates, null], random), G.epoch);
  }
  // Leave enough non-candidates to exercise an election, instead of eventually
  // signing every bot up as the scheduler revisits the same timed stage.
  if (G.status === 'sheriff-signup' && !own.voteDisabled && !G.sheriffCandidates.includes(id) && G.sheriffCandidates.length < 2 && random() < 0.4) {
    return action('standForSheriff', true, G.epoch);
  }
  if (G.status === 'sheriff-voting' && !own.voteDisabled && !G.sheriffCandidates.includes(id) && !info.voteSubmitted) {
    return action('sheriffVote', pick([...G.sheriffCandidates, null], random), G.epoch);
  }
  if (G.status === 'sheriff-order' && G.sheriffID === id) {
    return action('chooseOrder', pick(living, random), random() < 0.5 ? 'clockwise' : 'counterclockwise', G.epoch);
  }
  return null;
}

function turingAction(G: TuringState, id: string, random: Random): BotAction | null {
  const own = G.players[id];
  if (['briefing', 'round-review'].includes(G.status) && !own.acknowledged) return action('acknowledge', G.epoch);
  if (G.status === 'answering' && id !== G.examinerID && !own.answered && G.private[id]) {
    if (G.rulesVersion >= 2) {
      const pending = Object.entries(turingCards(G)).filter(([, card]) => card.playerID === id && !card.spoken);
      return pending.length ? action('confirmSpoken', pick(pending, random)[0], G.epoch) : null;
    }
    // Test players exercise the same text flow without encoding or publishing
    // their private number. They are intentionally not strategy assistants.
    const replies = ['我會先觀察一下，再慢慢回應。', '這讓我忍不住多想了一會。', '我大概會露出一個微妙的表情。', '我想先聽聽其他人的想法。', '我會認真想像自己在這個情境。'];
    return action('submitAnswer', pick(replies, random), G.epoch);
  }
  if (G.rulesVersion >= 4 && G.status === 'sorting' && (G.redrawApprovals?.length ?? 0) > 0) {
    // Bots join a human proposal but never initiate an endless redraw loop.
    return G.redrawApprovals!.includes(id) ? null : action('approveRedraw', G.epoch);
  }
  if (G.status === 'sorting' && isTuringSharedTable(G)) {
    const order = turingTableOrder(G);
    if (!(G.orderApprovals?.length) && random() < 0.35) {
      const index = Math.floor(random() * order.length);
      const target = (index + 1 + Math.floor(random() * (order.length - 1))) % order.length;
      return action('placeCard', order[index], target, G.epoch);
    }
    return G.orderApprovals?.includes(id) ? null : action('approveOrder', G.epoch);
  }
  if (G.status === 'sorting' && G.examinerID === id) {
    const remaining = Object.keys(turingCards(G)).filter(other => !G.revealed.some(entry => (entry.cardID ?? entry.playerID) === other));
    if (remaining.length) return action('revealAnswer', pick(remaining, random), G.epoch);
  }
  return null;
}

const adapters = {
  'space-station': (G: StationState, id: string, random: Random) => stationAction(stationPlayerView({ G, playerID: id }), id, random),
  'encrypted-call': (G: CipherState, id: string, random: Random) => cipherAction(cipherPlayerView({ G, playerID: id }), id, random),
  'black-fog': (G: FogState, id: string, random: Random) => fogAction(fogPlayerView({ G, playerID: id }), id, random),
  'silver-moon': (G: MoonState, id: string, random: Random) => moonAction(moonPlayerView({ G, playerID: id }), id, random),
  'turing-test': (G: TuringState, id: string, random: Random) => turingAction(turingPlayerView({ G, playerID: id }), id, random),
} satisfies Record<GameID, (G: any, id: string, random: Random) => BotAction | null>;
export const supportedBotGames = Object.keys(adapters) as GameID[];

/** Only suggests a normal move. The caller must authorize a persisted bot seat
 * and submit through the game's authoritative reducer under the room queue.
 * Never auto-start, change room settings, or use hidden opponents' information. */
export function chooseBotAction(gameID: string, state: BotState, playerID: string, random: Random = Math.random): BotAction | null {
  if (!Object.hasOwn(adapters, gameID) || !state.G?.players || !Object.hasOwn(state.G.players, playerID)
    || state.ctx?.gameover !== undefined || state.G.status === 'finished') return null;
  if (state.G.status === 'lobby') return state.G.players[playerID].ready ? null : action('setReady', true);
  return adapters[gameID as GameID](state.G, playerID, random);
}
