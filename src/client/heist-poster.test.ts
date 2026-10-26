import { Client } from 'boardgame.io/client';
import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { HEIST_ARTIFACTS } from '../games/heist/content';
import { HeistGame, heistObserverView, heistPlayerView, type HeistChoice, type HeistLogEntry, type HeistState } from '../games/heist/game';
import type { RoomInfo } from './api';
import { buildHeistPosterModel } from './heist-poster';

describe('Curtain Heist poster from actual engine events and authorized projections', () => {
  it('keeps every real five-act snapshot public across raw, player, god and blind sources', () => {
    const participantIDs = ['0', '2', '7'];
    const game = { ...HeistGame, seed: 'heist-poster-real-actions' };
    const client = Client({ game, numPlayers: participantIDs.length, playerID: participantIDs[0], debug: false });
    const match = createMatch({ game, numPlayers: participantIDs.length, setupData: {
      startImmediately: true, participantIDs, options: {},
    }, unlisted: true });
    if ('setupDataError' in match) throw new Error(match.setupDataError);
    client.store.dispatch({ type: 'UPDATE', state: match.initialState, deltalog: [], clientOnly: true });
    const info: RoomInfo = {
      roomId: 'poster-room', matchID: 'poster-match', gameName: 'curtain-heist', status: 'playing',
      numPlayers: participantIDs.length, minPlayers: 3, maxPlayers: 8, spectatorCount: 1, godViewAllowed: true,
      players: participantIDs.map(id => ({ id, name: `成員 ${id}`, isConnected: true, ready: true })),
    };
    const actions: Record<HeistLogEntry['type'], string> = {
      'round-start': '新一幕開場，珍藏加入牌堆', reveal: '下一段路線揭曉', decision: '密封決策同時公開',
      exit: '撤離成員已安全入庫', disaster: '同種警戒重複，路線封鎖',
      'round-end': '本幕落下，等待全員確認', finish: '五幕結束，財富總帳公開',
    };
    const raw = () => client.store.getState().G as HeistState;
    // Hold replay coordinates fixed so a pending submission cannot hide a model change behind a new frame number.
    const poster = (G: HeistState) => buildHeistPosterModel({ G, info, step: 1, totalSteps: 1 });
    const observedEvents = new Set<string>(), revealedKinds = new Set<string>();
    let snapshots = 0, pendingDecisions = 0, privateBankSnapshots = 0, publicArtifactSnapshots = 0;

    function assertPublicPoster() {
      const G = raw(), before = structuredClone(G);
      const blind = heistObserverView(G, 'blind'), god = heistObserverView(G, 'god');
      expect(blind.private).toEqual({}); expect(blind.secret).toBeUndefined();
      expect(Object.keys(god.private)).toEqual(participantIDs); expect(god.secret).toBeUndefined();
      expect(Object.values(god.private).every(entry => entry.choice === null)).toBe(true);
      const expected = poster(blind);
      expect(poster(G)).toEqual(expected); expect(poster(god)).toEqual(expected);
      expect(poster(heistObserverView(god, 'blind'))).toEqual(expected);
      for (const playerID of participantIDs) {
        const view = heistPlayerView({ G, playerID });
        expect(Object.keys(view.private)).toEqual([playerID]); expect(view.secret).toBeUndefined();
        expect(poster(view)).toEqual(expected);
      }
      expect(expected.events.map(event => event.action)).toEqual(G.log.slice(-5).map(event => actions[event.type]));
      expect(expected.players.map(player => player.carried)).toEqual(G.turnOrder.map(id => G.players[id].carried));
      expect(expected.players.map(player => player.artifacts)).toEqual(G.turnOrder.map(id => G.players[id].artifacts.map(artifact => ({
        name: HEIST_ARTIFACTS[artifact].name, value: HEIST_ARTIFACTS[artifact].value,
      }))));
      if (G.status !== 'finished') {
        expect(expected.players.every(player => player.banked === null && player.total === null && !player.winner)).toBe(true);
        expect(expected.winners).toEqual([]);
        if (Object.values(G.private).some(entry => entry.banked > 0)) privateBankSnapshots++;
      } else {
        expect(expected.players.map(player => player.banked)).toEqual(G.turnOrder.map(id => G.finalScores[id].banked));
        expect(expected.players.map(player => player.total)).toEqual(G.turnOrder.map(id => G.finalScores[id].total));
        expect(expected.winners).toEqual(G.winnerIDs.map(id => `成員 ${id}`));
      }
      if (Object.values(G.players).some(player => player.artifacts.length > 0)) publicArtifactSnapshots++;
      for (const event of G.log) {
        observedEvents.add(event.type);
        if (event.card) revealedKinds.add(event.card.kind);
      }
      expect(JSON.stringify(expected)).not.toMatch(/"(?:secret|private|choice|choices|recycle|lastDecision|credentials)"\s*:/);
      expect(G).toEqual(before); snapshots++;
      return expected;
    }
    function act(id: string, move: 'acknowledge' | 'decide', choice?: HeistChoice) {
      const G = raw(), before = client.store.getState()._stateID, phaseEpoch = G.phaseEpoch;
      const beforePoster = poster(G), beforeLog = structuredClone(G.log);
      client.updatePlayerID(id);
      client.moves[move](...(move === 'decide' ? [choice, phaseEpoch] : [phaseEpoch]));
      expect(client.store.getState()._stateID, `${move} by ${id}`).toBe(before + 1);
      const afterPoster = assertPublicPoster();
      if (move === 'decide' && raw().phaseEpoch === phaseEpoch) {
        expect(raw().private[id].choice).toBe(choice);
        expect(raw().players[id].submitted).toBe(true);
        expect(raw().log).toEqual(beforeLog);
        expect(afterPoster).toEqual(beforePoster);
        pendingDecisions++;
      }
    }

    assertPublicPoster();
    // All changes come from valid moves against the original seeded deck; no hand-authored events or private state.
    // One member banks the first loot; another claims a revealed artifact. Keep one explorer for the real repeat hazard.
    for (let guard = 0; raw().status !== 'finished' && guard < 300; guard++) {
      const G = raw();
      if (G.status === 'briefing' || G.status === 'review') {
        for (const id of participantIDs) act(id, 'acknowledge');
      } else {
        expect(G.status).toBe('decision');
        const active = G.turnOrder.filter(id => G.players[id].exploring);
        const exiting = G.availableArtifacts.length > 0 && active.length > 1 ? active[0]
          : G.players[participantIDs[0]].exploring && G.players[participantIDs[0]].carried > 0 ? participantIDs[0] : undefined;
        for (const id of active) act(id, 'decide', id === exiting ? 'exit' : 'explore');
      }
    }

    expect(raw().status).toBe('finished'); expect(raw().round).toBe(5);
    expect([...observedEvents].sort()).toEqual(Object.keys(actions).sort());
    expect([...revealedKinds].sort()).toEqual(['artifact', 'hazard', 'loot']);
    expect(pendingDecisions).toBeGreaterThan(5);
    expect(privateBankSnapshots).toBeGreaterThan(5);
    expect(publicArtifactSnapshots).toBeGreaterThan(0);
    expect(snapshots).toBeGreaterThan(30);
  });
});
