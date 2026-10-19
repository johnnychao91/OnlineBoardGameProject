import { SocketIO } from 'boardgame.io/server';
import { getFilterPlayerView } from 'boardgame.io/internal';
import type { IncomingMessage } from 'node:http';
import type { Game } from 'boardgame.io';
import { RateLimiter, safeEqual, validCredential, validRoomID } from './security';
import type { RoomStore } from './rooms';

/** Guard the wire protocol, not only the buttons exposed by the browser client. */
export class GuardedTransport extends SocketIO {
  constructor(private rooms: RoomStore, private origins: string[]) {
    super({ socketOpts: {
      maxHttpBufferSize: 16384,
      cors: { origin: origins, methods: ['GET', 'POST'] },
      // Same-origin polling may omit Origin. Seat authentication is still mandatory
      // for every sync; when a browser supplies Origin it must match our allowlist.
      allowRequest: (req: IncomingMessage, callback: (error: string | null, allowed: boolean) => void) => callback(null, !req.headers.origin || origins.includes(req.headers.origin)),
    } as any }); // Upstream v0.50.2 types require options that Socket.IO defaults internally.
  }
  // HTTP admissions share this queue. Upstream deletes it on the last disconnect,
  // which could otherwise create two queues for an in-flight admission.
  override deleteMatchQueue(_matchID: string): void {}
  async drain(): Promise<void> {
    await Promise.all([...this.perMatchQueue.values()].map((queue) => queue.onIdle()));
  }
  override init(app: any, games: Game[], origins: any) {
    super.init(app, games, origins);
    for (const game of games) {
      const allowedMoves = new Set(Object.keys(game.moves || {}));
      app._io.of(game.name).on('connection', (socket: any) => {
        const rate = new RateLimiter();
        let binding: { matchID: string; playerID: string; credentials: string } | undefined;
        const originalEmit = socket.emit.bind(socket);
        const filter = getFilterPlayerView(game);
        socket.emit = (event: string, ...args: any[]) => {
          if (event === 'sync' && args[1]?.initialState && binding) {
            // v0.50.2 filters the live state but leaves initialState (including RNG
            // seed) untouched. Apply the same server-side player view to both.
            const filtered = filter(binding.playerID, { type: 'update', args: [args[0], args[1].initialState] });
            args[1] = { ...args[1], initialState: filtered.args[1] };
          }
          return originalEmit(event, ...args);
        };
        for (const event of ['sync', 'disconnect', 'update']) {
          const listeners = socket.listeners(event);
          socket.removeAllListeners(event);
          socket.on(event, (...args: any[]) => {
            const execute = async () => { for (const listener of listeners) await listener(...args); };
            // The upstream update listener already queues moves. sync/disconnect
            // also write metadata, so serialize those with admissions and moves.
            const work = event !== 'update' && binding
              ? this.getMatchQueue(binding.matchID).add(execute) : execute();
            void work.catch(() => { socket.emit('error', '連線處理失敗，請重新連線'); });
          });
        }
        socket.on('error', () => {});
        socket.use(async (packet: unknown[], next: (error?: Error) => void) => {
          try {
            if (!rate.allow('packets', 180, 60000)) throw new Error('操作過於頻繁');
            const [event, ...args] = packet;
            if (event === 'sync') {
              const [matchID, playerID, credentials] = args;
              if (!validRoomID(matchID) || typeof playerID !== 'string' || !/^\d$/.test(playerID) || !validCredential(credentials)) throw new Error('未授權');
              if (binding && (binding.matchID !== matchID || binding.playerID !== playerID || !safeEqual(binding.credentials, credentials))) throw new Error('不可切換座位');
              const room = this.rooms.rooms.get(matchID);
              if (!room || room.gameId !== game.name) throw new Error('房間不存在');
              const { metadata } = await app.context.db.fetch(matchID, { metadata: true });
              if (!metadata || !safeEqual(metadata.players[playerID]?.credentials, credentials)) throw new Error('未授權');
              if (binding && (binding.matchID !== matchID || binding.playerID !== playerID || !safeEqual(binding.credentials, credentials))) throw new Error('不可切換座位');
              binding = { matchID, playerID, credentials };
            } else if (event === 'update') {
              const [action, stateID, matchID, playerID] = args as any[];
              if (!binding || matchID !== binding.matchID || playerID !== binding.playerID || !Number.isSafeInteger(stateID) || stateID < 0) throw new Error('未授權');
              if (!action || action.type !== 'MAKE_MOVE' || !action.payload || !allowedMoves.has(action.payload.type)
                || action.payload.type === 'startGame'
                || action.payload.playerID !== binding.playerID || !safeEqual(action.payload.credentials, binding.credentials)
                || !Array.isArray(action.payload.args) || action.payload.args.length > 8) throw new Error('不允許的操作');
            } else {
              // No generic framework events, chat, undo, redo, reset or plugin messages.
              throw new Error('不允許的操作');
            }
            next();
          } catch { next(new Error('未授權或不允許的操作')); }
        });
      });
    }
  }
}
