import { useEffect, useRef, useState } from 'react';
import { normalizeMailOptions, validateMailOptions, type MailOptions as Options } from '../games/post/rules';
import { api, isRoomHost, type RoomInfo } from './api';
import type { LobbyOptionsProps } from './game-types';
import { ErrorMessage } from './ui';
import './mail.css';

export function MailOptions({ seat, info, disabled, onBusy, onUpdate }: LobbyOptionsProps) {
  const options = normalizeMailOptions(info.gameOptions);
  const players = info.players.filter(player => player.name && !player.departed);
  const host = isRoomHost(seat, info);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Options | null>(null);
  const sending = useRef(false);
  const mounted = useRef(true);
  const latest = useRef({ info, onBusy, onUpdate });
  const request = useRef<AbortController | null>(null);
  latest.current = { info, onBusy, onUpdate };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); latest.current.onBusy(false); };
  }, []);
  async function update(next: Options) {
    if (!host || disabled || sending.current || info.status !== 'lobby') return;
    const matchID = info.matchID;
    sending.current = true; setBusy(true); setPending(next); setError(''); onBusy(true);
    const controller = new AbortController(); request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const result = await api<RoomInfo>(`/api/rooms/${seat.roomId}/options`, {
        method: 'POST', body: JSON.stringify({ matchID, options: next }), signal: controller.signal,
      }, seat);
      if (mounted.current && latest.current.info.matchID === matchID) latest.current.onUpdate(result);
    } catch (cause) {
      if (mounted.current && latest.current.info.matchID === matchID) setError(controller.signal.aborted
        ? '尚未確認設定已儲存，請確認連線後重試。' : (cause as Error).message);
    } finally {
      window.clearTimeout(timeout); request.current = null; sending.current = false;
      if (mounted.current) { setBusy(false); setPending(null); latest.current.onBusy(false); }
    }
  }
  const shown = pending ?? options;
  const directorMode = shown.mode === 'black-letter' || shown.mode === 'auto' && players.length === 2;
  const blocked = disabled || busy || !host || info.status !== 'lobby';
  const validation = players.length >= 2 ? validateMailOptions(shown, players.length) : undefined;
  return <section className="panel mail-options" aria-label="午夜郵局本局設定">
    <h3>今晚，郵局如何營業？</h3>
    <p className="mail-options-story">城市入睡後，不存在於地圖上的郵局亮起一盞燈。把密函交給值得信任的人，也留意那些不願讓信件送達的影子。</p>
    <label>投遞玩法<select value={shown.mode} disabled={blocked}
      onChange={event => void update({ ...options, mode: event.target.value as Options['mode'] })}>
      <option value="auto">依人數選擇 · 開局時決定</option>
      <option value="classic">密函投遞 · 3～4 人</option>
      <option value="premium">全城夜遞 · 5～8 人</option>
      <option value="black-letter">黑函局長 · 2～6 人 · 一對多</option>
    </select></label>
    <p>{shown.mode === 'auto' ? '2 人採黑函局長；3～4 人採密函投遞；5～8 人採全城夜遞。玩法在開局後固定。'
      : shown.mode === 'classic' ? '16 張人物牌。輪到你時抽一張、打出一張，推理對手留下的密函；累積足夠郵印的人獲勝。'
      : shown.mode === 'premium' ? '32 張人物牌，加入斷郵客、紅印主事、夜巡督察等九位新人物。特殊能力、郵戳獎勵與最終比牌讓全城信使各有盤算。'
      : '一位黑函局長對抗其餘午夜信使。局長保留兩張牌並蒐集六枚封印，信使共享生命、合作阻止黑函封城。'}</p>
    {directorMode && <label>黑函局長由誰擔任？<select value={shown.directorID} disabled={blocked}
      onChange={event => void update({ ...options, directorID: event.target.value })}>
      <option value="random">開局隨機選一人</option>
      {players.map(player => <option key={player.id} value={String(player.id)}>{player.name}</option>)}
      {shown.directorID !== 'random' && !players.some(player => String(player.id) === shown.directorID)
        && <option value={shown.directorID}>原指定成員尚未入座</option>}
    </select></label>}
    {shown.mode === 'auto' && !directorMode && <p className="small muted">若改為兩人開局，黑函局長將採目前保存的指定方式；也可先選黑函局長玩法調整。</p>}
    <p className="small muted mail-options-note">{host ? '變更即時儲存，並清除全員準備。參與玩家人數在開局時檢查，觀戰者不占名額。' : '由房主在開局前設定；變更後請重新準備。'}{busy && ' 正在儲存…'}</p>
    <ErrorMessage>{error || validation}</ErrorMessage>
  </section>;
}
