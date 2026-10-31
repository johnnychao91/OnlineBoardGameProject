type Props = {
  value: string;
  onChange: (value: string) => void;
  remember: boolean;
  saved: boolean;
  onRemember: (value: boolean) => void;
  onForget: () => void;
};

export function RoomCode({ value, onChange, remember, saved, onRemember, onForget }: Props) {
  return <details className="key-details">
    <summary>{saved ? '已記住房間暗語 · 修改或清除' : '房間暗語（選填）'}</summary>
    <label htmlFor="room-code">房間暗語</label>
    <input id="room-code" name="roomCode" type="password" autoComplete="off" maxLength={256}
      value={value} onChange={event => onChange(event.target.value)} placeholder="留空即可建立一般房間" />
    <label className="remember-key">
      <input type="checkbox" checked={remember} onChange={event => onRemember(event.target.checked)} />
      <span>在這個瀏覽器記住暗語</span>
    </label>
    <p className="small muted">留空即可開房。暗語由管理者提供，受邀朋友不需輸入。勾選後只在開房成功時儲存。</p>
    {remember && <button type="button" className="text-button" onClick={onForget}>清除此瀏覽器的房間暗語</button>}
  </details>;
}
