import 'dotenv/config';
import { createApplication } from './app';

async function main() {
  const production = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 不正確');
  const app = await createApplication({
    dataDir: process.env.DATA_DIR || './data',
    publicOrigin: process.env.PUBLIC_ORIGIN || 'http://localhost:5173',
    host: process.env.HOST || '127.0.0.1', port, production,
    createRoomKey: process.env.CREATE_ROOM_KEY || '',
    testRoomKey: process.env.TEST_ROOM_KEY || '',
    adFreeRoomKey: process.env.ADFREE_ROOM_KEY || '',
    adsense: { client: process.env.ADSENSE_CLIENT || '', slot: process.env.ADSENSE_SLOT || '' },
    privacyContact: process.env.PRIVACY_CONTACT || '',
    clientDir: production ? './dist/client' : undefined,
  });
  const running = await app.listen();
  console.log(`Boardgame API：http://${app.config.host}:${running.port}`);
  const stop = async () => { await running.close(); process.exit(0); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
main().catch((error) => { console.error((error as Error).message); process.exitCode = 1; });
