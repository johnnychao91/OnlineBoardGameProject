import { safeEqual } from './security';
export interface AdSettings { client: string; slot: string; }
export function validAdSettings(settings?: AdSettings): settings is AdSettings {
  return !!settings && /^ca-pub-\d{16}$/.test(settings.client) && /^\d{1,20}$/.test(settings.slot);
}
export interface RoomCodes { roomCode?: string; testRoomCode?: string; }
/** Existing deployments can upgrade before renaming their private settings. */
export function roomCodesFromEnvironment(env: Record<string, string | undefined>): RoomCodes {
  return { roomCode: env.ROOM_CODE ?? env.CREATE_ROOM_KEY ?? env.ADFREE_ROOM_KEY ?? '',
    testRoomCode: env.TEST_ROOM_CODE ?? env.TEST_ROOM_KEY ?? '' };
}
export function creationKind(code: unknown, config: RoomCodes) {
  if (code === undefined || code === '') return 'standard';
  if (config.testRoomCode && safeEqual(code, config.testRoomCode)) return 'test';
  if (config.roomCode && safeEqual(code, config.roomCode)) return 'adfree';
  return null;
}
export function roomAdvertising(room: { testRoom?: boolean; adsMode?: 'standard' | 'adfree' }, settings?: AdSettings, historical=false) {
  return !historical && !room.testRoom && room.adsMode !== 'adfree' && validAdSettings(settings)
    ? { enabled: true as const, client: settings.client, slot: settings.slot } : { enabled: false as const };
}
export function validateRoomCodes(config: RoomCodes) {
  if (config.roomCode && config.roomCode.length < 16) throw new Error('ROOM_CODE must be at least 16 characters.');
  if (config.testRoomCode && config.testRoomCode.length < 16) throw new Error('TEST_ROOM_CODE must be at least 16 characters.');
  if (config.roomCode && config.testRoomCode && safeEqual(config.roomCode, config.testRoomCode))
    throw new Error('ROOM_CODE and TEST_ROOM_CODE must be distinct.');
}
