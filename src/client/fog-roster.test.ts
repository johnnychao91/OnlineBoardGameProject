import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { FogGame, fogPlayerView, type FogState } from '../games/fog/game';
import { fogRosterMarks } from './fog-roster';
import { FogParticipants, FogPrivatePanel, FogTrack } from './FogBoard';
import { fogSnapshotState } from './FogSnapshot';

function fixture(): FogState {
  const match = createMatch({ game: FogGame, numPlayers: 7, setupData: { startImmediately: true }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  const G = structuredClone(match.initialState.G) as FogState;
  G.status = 'nomination'; G.options.lancelotMode = 'random';
  G.private['0'] = { role: 'merlin', faction: 'knights', knownEvil: ['1', '2'], merlinCandidates: [], ownVote: null, ownQuestCard: null };
  G.private['1'] = { role: 'evil-lancelot', faction: 'apostles', knownEvil: [], merlinCandidates: [], ownVote: null, ownQuestCard: null };
  G.private['2'] = { role: 'assassin', faction: 'apostles', knownEvil: ['1'], merlinCandidates: [], ownVote: null, ownQuestCard: null };
  return G;
}
const nameOf = (id: string) => `巡夜者 ${id}`;

describe('Fog roster respects the viewer’s knowledge and secret visibility', () => {
  it('only uses the viewer’s granted knowledge; never colors unknown players from other private records', () => {
    const G = fixture(), projected = fogPlayerView({ G, playerID: '0' });
    const marks = fogRosterMarks(G, '0', true);
    expect(marks).toEqual(fogRosterMarks(projected, '0', true));
    expect(marks).toEqual({
      '0': { kind: 'knights', label: '守夜騎士' },
      '1': { kind: 'apostles', label: '黑霧使徒' },
      '2': { kind: 'apostles', label: '黑霧使徒' },
    });
    expect(fogRosterMarks(G, undefined, true)).toEqual({});
  });

  it('after an odd number of actual switches, marks opening knowledge as uncertain without finding the Lancelot', () => {
    const G = fixture(); G.bellHistory = [{ quest: 1, card: 'switch' }]; G.private['1'].faction = 'knights';
    const marks = fogRosterMarks(G, '0', true);
    expect(marks['1']).toEqual({ kind: 'initial-apostles', label: '開局黑霧使徒・現效忠未明' });
    expect(marks['2']).toEqual(marks['1']);
    expect(marks['0'].kind).toBe('knights');
    G.bellHistory.push({ quest: 2, card: 'switch' });
    expect(fogRosterMarks(G, '0', true)['1'].kind).toBe('apostles');
  });

  it('does not treat a future forecast as an already changed allegiance', () => {
    const G = fixture(); G.options.lancelotMode = 'forecast'; G.bellForecast = ['switch', 'switch'];
    expect(fogRosterMarks(G, '0', true)['1'].kind).toBe('apostles');
  });

  it('does not call ambiguous Merlin candidates good; a sole candidate without Morgana is known good', () => {
    const G = fixture(); G.private['0'].role = 'percival'; G.private['0'].knownEvil = [];
    G.private['0'].merlinCandidates = ['1', '2']; G.options.morgana = true;
    expect(fogRosterMarks(G, '0', true)['1'].kind).toBe('candidate');
    G.private['0'].merlinCandidates = ['1'];
    expect(fogRosterMarks(G, '0', true)['1'].kind).toBe('candidate');
    G.options.morgana = false;
    expect(fogRosterMarks(G, '0', true)['1'].kind).toBe('knights');
  });

  it('shows authorized current factions in god view and removes a stale god payload immediately in blind view', () => {
    const G = fixture(); G.bellHistory = [{ quest: 1, card: 'switch' }]; G.private['1'].faction = 'knights';
    expect(fogRosterMarks(fogSnapshotState(G, 'god'), undefined, true, true)['1'].kind).toBe('knights');
    expect(fogRosterMarks(fogSnapshotState(G, 'blind'), undefined, true)).toEqual({});
  });

  it.each([false, true])('concealing removes all faction classes, labels and role names, including final public reveals (finished=%s)', finished => {
    const G = fixture();
    if (finished) { G.status = 'finished'; for (const [id, player] of Object.entries(G.players)) {
      player.revealedFaction = G.private[id].faction; player.revealedRole = G.private[id].role;
    } }
    const html = renderToStaticMarkup(createElement(FogParticipants, { G, nameOf, ownID: '0', secretsVisible: false, godView: true }));
    expect(fogRosterMarks(G, '0', false, true)).toEqual({});
    expect(html).not.toMatch(/fog-known-|fog-public-role|黑霧使徒|守夜騎士|梅林候選/);
    expect(html).toContain('巡夜者 0');
    expect(renderToStaticMarkup(createElement(FogPrivatePanel, { G, nameOf, playerID: '0', expanded: false }))).not.toContain('data-fog-role');
  });

  it('keeps each faction count together in its own nowrap group', () => {
    const html = renderToStaticMarkup(createElement(FogPrivatePanel, { G: fixture(), nameOf, playerID: '0' }));
    expect(html).toContain('<b class="mint">守夜騎士 4 位</b>');
    expect(html).toContain('<b class="fog-apostles-text">黑霧使徒 3 位</b>');
  });

  it('selects separate public artwork for unlit, successful and corrupted towers', () => {
    const G = fixture(); G.quest = 3;
    G.questResults = [
      { quest: 1, team: ['0', '1'], successes: 2, fails: 0, succeeded: true },
      { quest: 2, team: ['0', '1', '2'], successes: 2, fails: 1, succeeded: false },
    ];
    const html = renderToStaticMarkup(createElement(FogTrack, { G }));
    expect(html).toContain('data-lighthouse-state="lit"');
    expect(html).toContain('data-lighthouse-state="corrupted"');
    expect(html).toContain('data-lighthouse-state="unlit"');
    expect(html).toContain('第 3 座燈塔・未點亮');
    expect(html).toContain('aria-current="step"');
  });
});
