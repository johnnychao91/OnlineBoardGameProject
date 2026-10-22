import { useEffect, useState } from 'react';
import { moonObserverView, type MoonState } from '../games/moon/game';
import { MoonHeading, MoonLog, MoonParticipants, MoonPrivatePanel, MoonPublicPhase, MoonRuleSummary, MoonStatus, useMoonPrivacy } from './MoonBoard';
import type { SnapshotProps } from './game-types';
import { SnapshotPlayerSelect, useInspectedPlayer } from './SnapshotPlayerSelect';
import { BattleReport } from './BattleReport';

/** Reproject on every render; a cached god payload never survives a blind-view switch. */
export function moonSnapshotState(state: MoonState, perspective: SnapshotProps['perspective']) {
  return moonObserverView(state, perspective);
}

export function MoonSnapshot({ G: state, info, perspective, replay = false }: SnapshotProps) {
  const G = moonSnapshotState(state as MoonState, perspective);
  const ids = Object.keys(G.players);
  const [selected, setSelected] = useInspectedPlayer(ids);
  const [expanded, setExpanded] = useState(true);
  const visible = useMoonPrivacy();
  useEffect(() => { if (!visible) setExpanded(false); }, [visible]);
  const nameOf = (id: string) => info.players.find(player => String(player.id) === id)?.name || `乘客 ${Number(id) + 1}`;
  return <div className={`game-layout moon-layout moon-snapshot ${G.status === 'night' ? 'moon-night' : ''}`}>
    <section className="game-main moon-main"><MoonHeading G={G} subtitle={replay ? 'JOURNEY REPLAY' : 'OBSERVATION CARRIAGE'} /><MoonStatus G={G} nameOf={nameOf} replay={replay} /><MoonParticipants G={G} nameOf={nameOf} concealed={!visible || !expanded} omniscient={perspective === 'god'} /><section className="panel moon-action-panel"><MoonPublicPhase G={G} nameOf={nameOf} /><p className="small muted">{replay ? '歷史畫面 · 唯讀復盤' : '觀戰席 · 不占參與席位'}。{perspective === 'god' ? '右側可以查看各乘客當時的私人情報，請勿轉告玩家。' : '只顯示公開事件，不顯示秘密技能與投票。'}</p></section></section>
    <aside className="moon-personal-aside"><MoonPrivatePanel G={G} playerID={selected} nameOf={nameOf} observer expanded={expanded} onExpandedChange={setExpanded} concealed={!visible}><div className="moon-inspector"><SnapshotPlayerSelect playerIDs={ids} value={selected} onChange={setSelected} nameOf={nameOf} label={`查看乘客情報（${perspective === 'god' ? '上帝視角' : '盲視角'}）`} /></div></MoonPrivatePanel></aside>
    <aside className="game-aside moon-history-aside"><MoonLog G={G} nameOf={nameOf} /><details className="panel rules-details"><summary>乘車規則速查</summary><MoonRuleSummary G={G} /></details>{G.status === 'finished' && !replay && <BattleReport G={G} info={info} perspective={perspective} label="製作列車戰報" />}</aside>
  </div>;
}
