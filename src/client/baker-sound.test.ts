import { Client } from 'boardgame.io/client';
import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { BakerGame, bakerObserverView, bakerPlayerView, type BakerState } from '../games/baker/game';
import { BAKER_SCENES } from '../games/baker/content';
import { normalizeBakerOptions } from '../games/baker/rules';
import { clientGames } from './game-registry';
import { GameSoundTracker } from './sound-cues';

const ids = ['0', '2', '5', '7', '9', '11'];
const adapter = clientGames['baker-street'].soundAdapter;
function fixture() {
  const game = { ...BakerGame, seed: 'baker-private-audio' };
  const client = Client({ game, numPlayers: ids.length, playerID: ids[0], debug: false });
  const match = createMatch({ game, numPlayers: ids.length, unlisted: true,
    setupData: { startImmediately: true, participantIDs: ids, options: normalizeBakerOptions({ holmesID: '0', roleSet: 'all' }) } });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  client.store.dispatch({ type: 'UPDATE', state: match.initialState, deltalog: [], clientOnly: true });
  const state = () => client.store.getState().G as BakerState;
  const act = (id: string, move: string, ...args: unknown[]) => {
    client.updatePlayerID(id); client.moves[move](...args, state().epoch);
  };
  const acknowledge = () => ids.forEach(id => act(id, 'acknowledge'));
  const choose = (cardIndex = 0) => {
    const G = state(), murderer = ids.find(id => G.private[id].role === 'murderer')!;
    act(murderer, 'chooseCrime', G.players[murderer].means[cardIndex].id, G.players[murderer].clues[cardIndex].id);
  };
  return { state, act, acknowledge, choose };
}
const sound = (G: BakerState, id: string) => adapter(bakerPlayerView({ G, playerID: id }), id)!;
const input = (G: BakerState, id: string) => ({ G: sound(G, id), matchID: 'baker-sound-case', playerID: id });

describe('Baker Street audio preserves private case information', () => {
  it('gives every participant the same audible prompt when secret case selection begins', () => {
    const f = fixture();
    ids.slice(0, -1).forEach(id => f.act(id, 'acknowledge'));
    const trackers = ids.map(id => { const tracker = new GameSoundTracker(); tracker.update(input(f.state(), id)); return tracker; });
    f.act(ids.at(-1)!, 'acknowledge');
    const G = f.state();
    expect(G.status).toBe('crime');
    expect(new Set(ids.map(id => G.private[id].role)).size).toBe(5);
    for (const [index, id] of ids.entries()) {
      expect(sound(G, id).attention, G.private[id].role!).toBeDefined();
      expect(trackers[index].update(input(G, id)), G.private[id].role!).toEqual({ reveals: 0, ownTurn: true });
    }
    expect(adapter(bakerObserverView(G, 'god'))?.attention).toBeUndefined();
    expect(adapter(bakerPlayerView({ G, playerID: null }), '3')?.attention).toBeUndefined();
  });

  it('does not turn either private card choice into a public sound event', () => {
    const completedEvents: string[][] = [];
    for (const cardIndex of [0, 1]) {
      const f = fixture(); f.acknowledge();
      const before = f.state(), publicEvents = adapter(bakerObserverView(before, 'blind'))!.events;
      const trackers = ids.map(id => { const tracker = new GameSoundTracker(); tracker.update(input(before, id)); return tracker; });
      f.choose(cardIndex);
      const after = f.state();
      expect(after.status).toBe('scene-setup');
      for (const [index, id] of ids.entries()) {
        expect(sound(after, id).events).toEqual(publicEvents);
        expect(trackers[index].update(input(after, id)).reveals).toBe(0);
      }
      const blindEvents = adapter(bakerObserverView(after, 'blind'))!.events;
      expect(blindEvents).toEqual(publicEvents);
      expect(adapter(bakerObserverView(after, 'god'))!.events).toEqual(blindEvents);
      completedEvents.push(blindEvents);
    }
    expect(completedEvents[0]).toEqual(completedEvents[1]);
  });

  it('allows an executor-only prompt after a correct accusation has publicly revealed that role', () => {
    const f = fixture(); f.acknowledge(); f.choose();
    f.act('0', 'chooseLocation', BAKER_SCENES.find(tile => tile.kind === 'location')!.id);
    f.act('0', 'markScene', f.state().scenes[0].tile.id, 0);
    const before = f.state(), answer = before.secret!.solution!;
    const investigator = ids.find(id => before.private[id].role === 'investigator')!;
    const trackers = ids.map(id => { const tracker = new GameSoundTracker(); tracker.update(input(before, id)); return tracker; });
    f.act(investigator, 'accuse', answer.murdererID, answer.meansID, answer.clueID);
    const G = f.state();
    expect(G.status).toBe('witness-hunt');
    expect(bakerObserverView(G, 'blind').players[answer.murdererID].revealedRole).toBe('murderer');
    for (const [index, id] of ids.entries()) {
      expect(!!sound(G, id).attention).toBe(id === answer.murdererID);
      expect(trackers[index].update(input(G, id))).toEqual({ reveals: 1, ownTurn: id === answer.murdererID });
    }
    expect(adapter(bakerObserverView(G, 'god'))?.attention).toBeUndefined();
  });
});
