import 'dotenv/config';
import { createApplication } from './app';
import { roomCodesFromEnvironment } from './advertising';

async function main() {
  const production = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 不正確');
  const app = await createApplication({
    dataDir: process.env.DATA_DIR || './data',
    publicOrigin: process.env.PUBLIC_ORIGIN || 'http://localhost:5173',
    host: process.env.HOST || '127.0.0.1', port, production,
    ...roomCodesFromEnvironment(process.env),
    adsense: { client: process.env.ADSENSE_CLIENT || '', slot: process.env.ADSENSE_SLOT || '' },
    privacyContact: process.env.PRIVACY_CONTACT || '',
    analyticsMeasurementId: process.env.GA_MEASUREMENT_ID || '',
    clientDir: production ? './dist/client' : undefined,
  });
  const running = await app.listen();
  console.log(`Boardgame API：http://${app.config.host}:${running.port}`);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void running.close().then(() => process.exit(0), () => {
      console.error('Boardgame could not shut down cleanly.');
      process.exit(1);
    });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
main().catch((error) => { console.error((error as Error).message); process.exitCode = 1; });
