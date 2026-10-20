type Props = {
  value: string;
  onChange: (value: string) => void;
  remember: boolean;
  saved: boolean;
  onRemember: (value: boolean) => void;
  onForget: () => void;
};

export function CreationPassword({ value, onChange, remember, saved, onRemember, onForget }: Props) {
  return <details className="key-details">
    <summary>{saved ? '已記住開房密碼 · 修改或清除' : '伺服器設有開房密碼？'}</summary>
    <label htmlFor="create-key">開房密碼</label>
    <input id="create-key" name="password" type="password" autoComplete="current-password"
      value={value} onChange={event => onChange(event.target.value)} placeholder="由伺服器管理者提供" />
    <label className="remember-key">
      <input type="checkbox" checked={remember} onChange={event => onRemember(event.target.checked)} />
      <span>在這個瀏覽器記住，之後直接開房</span>
    </label>
    <p className="small muted">只在開房成功後儲存。共用裝置請勿勾選；朋友用邀請連結加入，不需要這個密碼。</p>
    {remember && <button type="button" className="text-button" onClick={onForget}>清除此瀏覽器的開房密碼</button>}
  </details>;
}
