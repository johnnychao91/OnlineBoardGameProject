import { safeEqual } from './security';
export interface AdSettings { client: string; slot: string; }
export function validAdSettings(settings?: AdSettings): settings is AdSettings {
  return !!settings && /^ca-pub-\d{16}$/.test(settings.client) && /^\d{1,20}$/.test(settings.slot);
}
export function creationKind(key: unknown, config: { createRoomKey: string; testRoomKey?: string; adFreeRoomKey?: string }) {
  if (config.testRoomKey && safeEqual(key, config.testRoomKey)) return 'test';
  if (config.adFreeRoomKey && safeEqual(key, config.adFreeRoomKey)) return 'adfree';
  if (!config.createRoomKey || safeEqual(key, config.createRoomKey)) return 'standard';
  return null;
}
export function roomAdvertising(room: { testRoom?: boolean; adsMode?: 'standard' | 'adfree' }, settings?: AdSettings, historical=false) {
  return !historical && !room.testRoom && room.adsMode !== 'adfree' && validAdSettings(settings)
    ? { enabled: true as const, client: settings.client, slot: settings.slot } : { enabled: false as const };
}
export function validateAdFreeKey(config: { createRoomKey: string; testRoomKey?: string; adFreeRoomKey?: string }) {
  const key=config.adFreeRoomKey;
  if (key && (key.length<16 || safeEqual(key,config.createRoomKey) || safeEqual(key,config.testRoomKey))) {
    throw new Error('ADFREE_ROOM_KEY must be distinct from other room keys and at least 16 characters.');
  }
}
