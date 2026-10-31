import { useEffect, useRef, useState } from 'react';
import { api, loadSeat, type RoomInfo } from './api';
import { loadAdSense, validAdUnit } from './adsense';
import './advertising.css';

export function Advertising({ settings }: { settings?: RoomInfo['advertising'] }) {
  const node = useRef<HTMLModElement>(null), submitted = useRef(false);
  const [failed, setFailed] = useState(false);
  const enabled = settings?.enabled && validAdUnit(settings.client, settings.slot);
  useEffect(() => {
    if (!enabled || !settings?.client || submitted.current || failed) return;
    let active = true;
    void loadAdSense(settings.client).then(() => {
      if (!active || !node.current?.isConnected || submitted.current) return;
      submitted.current = true;
      const target = window as Window & { adsbygoogle?: { push(value: object): void } };
      (target.adsbygoogle ??= [] as object[]).push({});
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [enabled, settings?.client, settings?.slot, failed]);
  if (!enabled || failed) return null;
  return <aside className="site-advertising" aria-label="廣告"><span className="advertising-label">廣告</span>
    <ins ref={node} className="adsbygoogle" data-ad-client={settings!.client} data-ad-slot={settings!.slot}
      data-ad-format="rectangle" data-full-width-responsive="false" />
  </aside>;
}

/** Rules and privacy pages inherit an explicit, authenticated room context. */
export function ContextAdvertising() {
  const [info, setInfo] = useState<RoomInfo>();
  useEffect(() => {
    const room = new URLSearchParams(location.search).get('room');
    if (!room || !/^[A-Za-z0-9_-]{16}$/.test(room)) return;
    const seat = loadSeat(room);
    if (!seat) return;
    const controller = new AbortController();
    void api<RoomInfo>(`/api/rooms/${room}`, { signal: controller.signal }, seat)
      .then(next => { if (!controller.signal.aborted) setInfo(next); }).catch(() => {});
    return () => controller.abort();
  }, []);
  return <Advertising settings={info?.advertising} />;
}
