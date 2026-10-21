import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Async } from 'boardgame.io/internal';
import type { LogEntry, Server, State, StorageAPI } from 'boardgame.io';
import { hashToken, safeEqual, validRoomID } from './security';
import { atomicReplace } from './atomic-file';

/** 伺服器私有回放資料；對外提供前仍須另做觀看權限與遊戲資訊過濾。 */
export interface ReplayFrame {
  stateID: number;
  at: number;
  G: any;
}

interface StoredMatch extends StorageAPI.FetchFields {
  schemaVersion: 1;
  matchID: string;
  // 舊 schema 1 檔案沒有這兩欄，不得據其目前狀態補造過去歷史。
  replayFrames?: ReplayFrame[];
  replayComplete?: boolean;
  /** Revoked admissions must not be restored by retrying their original join request. */
  revokedAdmissions?: string[];
  /** Idempotent host requests, never included in public metadata or replay frames. */
  botAdmissions?: { requestHash: string; credentialHash: string }[];
}

/** 立即複製輸入，避免呼叫端在排隊期間修改尚未寫入的資料。 */
function jsonCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function validateStateID(state: State): void {
  if (!Number.isSafeInteger(state._stateID) || state._stateID < 0) throw new Error('對局狀態版本不正確');
}

function replayFrame(state: State): ReplayFrame {
  return { stateID: state._stateID, at: Date.now(), G: state.G };
}

function newRecord(matchID: string, options: StorageAPI.CreateMatchOpts): StoredMatch {
  validateStateID(options.initialState);
  return jsonCopy<StoredMatch>({
    schemaVersion: 1, matchID,
    initialState: options.initialState, state: options.initialState,
    metadata: options.metadata, log: [], replayComplete: true,
    replayFrames: options.initialState.G?.status === 'lobby' ? [] : [replayFrame(options.initialState)],
  });
}

function isReplayFrame(value: unknown): value is ReplayFrame {
  if (!value || typeof value !== 'object') return false;
  const frame = value as Partial<ReplayFrame>;
  return Number.isSafeInteger(frame.stateID) && frame.stateID! >= 0
    && typeof frame.at === 'number' && Number.isFinite(frame.at) && frame.at >= 0
    && Object.prototype.hasOwnProperty.call(frame, 'G');
}

/**
 * 單程序、單一 adapter instance 的本機儲存；每個對局使用一份完整 JSON。
 * flush + 同目錄 rename 避免讀到半份 JSON，但不保證斷電存活或跨檔案交易。
 * 目錄必須位於靜態網站之外，且僅允許服務帳號與管理者存取。
 */
export class FileStorage extends Async {
  /** Application lifecycle guard; standalone storage remains usable without it. */
  isMatchActive?: (matchID: string) => boolean;
  private readonly directory: string;
  private readonly queues = new Map<string, Promise<void>>();

  constructor({ dir }: { dir: string }) {
    super();
    this.directory = resolve(dir);
  }

  override async connect(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
  }

  private filename(matchID: string): string {
    if (!validRoomID(matchID)) throw new Error('對局識別碼格式錯誤');
    return join(this.directory, `${matchID}.json`);
  }

  private enqueue<T>(matchID: string, operation: () => Promise<T>): Promise<T> {
    this.filename(matchID);
    // Windows 檔案系統通常忽略大小寫；別讓同名大小寫變體繞過序列化。
    const key = matchID.toLowerCase();
    const previous = this.queues.get(key) || Promise.resolve();
    const result = previous.then(operation);
    const settled = result.then(() => undefined, () => undefined);
    this.queues.set(key, settled);
    void settled.then(() => {
      if (this.queues.get(key) === settled) this.queues.delete(key);
    });
    return result;
  }

  private async readMatch(matchID: string): Promise<StoredMatch | undefined> {
    const filename = this.filename(matchID);
    try {
      const info = await lstat(filename);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('對局資料必須是一般檔案');
      const record: unknown = JSON.parse(await readFile(filename, 'utf8'));
      if (!record || typeof record !== 'object') throw new Error('對局資料格式錯誤');
      const match = record as Partial<StoredMatch>;
      if (match.schemaVersion !== 1 || match.matchID !== matchID || !Array.isArray(match.log)
        || !match.state || typeof match.state !== 'object'
        || !match.initialState || typeof match.initialState !== 'object'
        || !match.metadata || typeof match.metadata !== 'object') {
        throw new Error('對局資料格式錯誤');
      }
      if (match.replayComplete !== undefined && typeof match.replayComplete !== 'boolean') {
        throw new Error('回放資料格式錯誤');
      }
      if (match.revokedAdmissions !== undefined && (!Array.isArray(match.revokedAdmissions)
        || match.revokedAdmissions.some((hash) => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)))) {
        throw new Error('已撤銷的入座資料格式錯誤');
      }
      if (match.replayFrames !== undefined) {
        if (!Array.isArray(match.replayFrames)) throw new Error('回放資料格式錯誤');
        let previousID = -1;
        for (const frame of match.replayFrames) {
          if (!isReplayFrame(frame) || frame.stateID <= previousID || frame.stateID > match.state._stateID) {
            throw new Error('回放資料格式錯誤');
          }
          previousID = frame.stateID;
        }
      }
      return match as StoredMatch;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private async writeMatch(matchID: string, record: StoredMatch): Promise<void> {
    const filename = this.filename(matchID);
    const temporary = join(this.directory, `.${matchID}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(record), {
        encoding: 'utf8', flag: 'wx', mode: 0o600, flush: true,
      });
      await atomicReplace(temporary, filename);
    } finally {
      // 只處理本次產生的單一暫存檔；不刪除目錄，也不隱藏原本的 I/O 錯誤。
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  override async createMatch(matchID: string, options: StorageAPI.CreateMatchOpts): Promise<void> {
    const record = newRecord(matchID, options);
    return this.enqueue(matchID, async () => {
      if (await this.readMatch(matchID)) throw new Error('對局已存在');
      await this.writeMatch(matchID, record);
    });
  }

  /** Publish revocations with a fresh lobby, without changing the still-active previous file. */
  async createNextMatch(previousMatchID: string, matchID: string, options: StorageAPI.CreateMatchOpts, revokedCredentials: string[] = []): Promise<void> {
    const previous = await this.enqueue(previousMatchID, () => this.readMatch(previousMatchID));
    if (!previous) throw new Error('對局不存在');
    const record = newRecord(matchID, options);
    record.revokedAdmissions = [...new Set([...(previous.revokedAdmissions || []), ...revokedCredentials.map(hashToken)])];
    await this.enqueue(matchID, async () => {
      if (await this.readMatch(matchID)) throw new Error('對局已存在');
      await this.writeMatch(matchID, record);
    });
  }

  async revokeAdmission(matchID: string, credentials: string): Promise<void> {
    await this.enqueue(matchID, async () => {
      const record = await this.readMatch(matchID);
      if (!record) throw new Error('對局不存在');
      record.revokedAdmissions = [...new Set([...(record.revokedAdmissions || []), hashToken(credentials)])];
      await this.writeMatch(matchID, record);
    });
  }

  /** 等待室的人數確定後，以呼叫者提供的完整狀態與已入座 metadata 原子開局。 */
  async startMatch(matchID: string, options: StorageAPI.CreateMatchOpts): Promise<void> {
    const replacement = newRecord(matchID, options);
    return this.enqueue(matchID, async () => {
      const record = await this.readMatch(matchID);
      if (!record) throw new Error('對局不存在');
      if (record.state.G?.status !== 'lobby') throw new Error('僅能從等待室開始對局');
      replacement.revokedAdmissions = record.revokedAdmissions;
      await this.writeMatch(matchID, replacement);
    });
  }

  /** Clear membership, ready state, and its retry credential in one file replacement. */
  async removePlayer(matchID: string, playerID: string, credentials: string, state: State): Promise<void> {
    const incoming = jsonCopy(state);
    validateStateID(incoming);
    return this.enqueue(matchID, async () => {
      const record = await this.readMatch(matchID);
      if (!record) throw new Error('對局不存在');
      if (record.state.G?.status !== 'lobby' || incoming.G?.status !== 'lobby'
        || incoming._stateID !== record.state._stateID + 1
        || !safeEqual(record.metadata.players[Number(playerID)]?.credentials, credentials)) {
        throw new Error('無法移出此席位');
      }
      record.metadata.players[Number(playerID)] = { id: Number(playerID) };
      record.metadata.updatedAt = Date.now();
      record.state = incoming;
      record.revokedAdmissions = [...(record.revokedAdmissions || []), hashToken(credentials)];
      await this.writeMatch(matchID, record);
    });
  }

  async isAdmissionRevoked(matchID: string, credentials: string): Promise<boolean> {
    return this.enqueue(matchID, async () => {
      const record = await this.readMatch(matchID);
      if (!record) throw new Error('對局不存在');
      return record.revokedAdmissions?.includes(hashToken(credentials)) ?? false;
    });
  }

  async findBotAdmission(matchID: string, requestHash: string): Promise<'present' | 'removed' | undefined> {
    return this.enqueue(matchID, async () => {
      const record = await this.readMatch(matchID);
      if (!record) throw new Error('對局不存在');
      const receipt = record.botAdmissions?.find(entry => entry.requestHash === requestHash);
      if (!receipt) return undefined;
      return Object.values(record.metadata.players).some(player => player.data?.isBot && player.credentials
        && safeEqual(hashToken(player.credentials), receipt.credentialHash)) ? 'present' : 'removed';
    });
  }

  /** Publish membership, automatic readiness and retry receipt in one atomic file update. */
  async addBot(matchID: string, playerID: string, credentials: string, requestHash: string, state: State): Promise<void> {
    const incoming = jsonCopy(state);
    validateStateID(incoming);
    return this.enqueue(matchID, async () => {
      const record = await this.readMatch(matchID);
      if (!record || record.state.G?.status !== 'lobby' || incoming.G?.status !== 'lobby'
        || record.metadata.players[Number(playerID)]?.credentials
        || incoming._stateID !== record.state._stateID + 1
        || record.botAdmissions?.some(entry => entry.requestHash === requestHash)) throw new Error('無法新增虛擬玩家');
      record.metadata.players[Number(playerID)] = { id: Number(playerID), name: `虛擬玩家 ${Number(playerID) + 1}`,
        credentials, isConnected: false, data: { isBot: true } };
      record.metadata.updatedAt = Date.now();
      record.state = incoming;
      record.botAdmissions = [...(record.botAdmissions || []), { requestHash, credentialHash: hashToken(credentials) }];
      await this.writeMatch(matchID, record);
    });
  }

  override async setState(matchID: string, state: State, deltalog?: LogEntry[]): Promise<void> {
    validateStateID(state);
    const incoming = jsonCopy({ state, deltalog: deltalog || [] });
    return this.enqueue(matchID, async () => {
      if (this.isMatchActive && !this.isMatchActive(matchID)) return;
      const record = await this.readMatch(matchID);
      if (!record) throw new Error('對局不存在');
      // 同版本重送與較舊的更新不得覆寫現況，也不重複追加操作或回放紀錄。
      if (incoming.state._stateID <= record.state._stateID) return;
      const hadReplay = Array.isArray(record.replayFrames);
      record.replayComplete = hadReplay && record.replayComplete === true;
      record.replayFrames ||= [];
      // 缺少進行中狀態的版本時，只保留真正觀察到的畫面並標記歷史不完整。
      if (incoming.state._stateID > record.state._stateID + 1
        && (record.state.G?.status !== 'lobby' || incoming.state.G?.status !== 'lobby')) {
        record.replayComplete = false;
      }
      if (incoming.state.G?.status !== 'lobby') record.replayFrames.push(replayFrame(incoming.state));
      record.state = incoming.state;
      record.log.push(...incoming.deltalog);
      await this.writeMatch(matchID, record);
    });
  }

  async fetchReplay(matchID: string): Promise<{ complete: boolean; frames: ReplayFrame[] }> {
    return this.enqueue(matchID, async () => {
      const record = await this.readMatch(matchID);
      if (!record) throw new Error('對局不存在');
      return {
        complete: record.replayComplete === true && Array.isArray(record.replayFrames),
        // 限定輸出三個欄位，不帶出對局 metadata、憑證、ctx 或 plugins。
        frames: (record.replayFrames || []).map(({ stateID, at, G }) => ({ stateID, at, G })),
      };
    });
  }

  override async setMetadata(matchID: string, metadata: Server.MatchData): Promise<void> {
    const incoming = jsonCopy(metadata);
    return this.enqueue(matchID, async () => {
      if (this.isMatchActive && !this.isMatchActive(matchID)) return;
      const record = await this.readMatch(matchID);
      if (!record) throw new Error('對局不存在');
      record.metadata = incoming;
      await this.writeMatch(matchID, record);
    });
  }

  override async fetch<O extends StorageAPI.FetchOpts>(matchID: string, options: O): Promise<StorageAPI.FetchResult<O>> {
    const selected = { ...options };
    return this.enqueue(matchID, async () => {
      // 每次從 JSON 解析全新物件；回傳資料不會與其他請求共享可變參照。
      const record = await this.readMatch(matchID);
      const result: Partial<StorageAPI.FetchFields> = {};
      if (selected.state) result.state = record?.state;
      if (selected.initialState) result.initialState = record?.initialState;
      if (selected.metadata) result.metadata = record?.metadata;
      if (selected.log) result.log = record?.log || [];
      return result as StorageAPI.FetchResult<O>;
    });
  }

  override async wipe(matchID: string): Promise<void> {
    return this.enqueue(matchID, async () => {
      // 先核對檔內 ID，避免 Windows 大小寫別名刪掉另一個對局。
      if (await this.readMatch(matchID)) await rm(this.filename(matchID));
    });
  }

  override async listMatches(options?: StorageAPI.ListMatchesOpts): Promise<string[]> {
    const selected = options ? jsonCopy(options) : undefined;
    await Promise.all([...this.queues.values()]);
    const files = await readdir(this.directory, { withFileTypes: true });
    const ids = files.filter((file) => file.isFile() && /^[A-Za-z0-9_-]{16}\.json$/.test(file.name))
      .map((file) => file.name.slice(0, -5)).sort();
    const matches = await Promise.all(ids.map(async (matchID) => {
      const { metadata } = await this.fetch(matchID, { metadata: true });
      if (!metadata) return undefined;
      if (selected?.gameName !== undefined && metadata.gameName !== selected.gameName) return undefined;
      const where = selected?.where;
      if (where?.isGameover !== undefined && (metadata.gameover !== undefined) !== where.isGameover) return undefined;
      if (where?.updatedBefore !== undefined && metadata.updatedAt >= where.updatedBefore) return undefined;
      if (where?.updatedAfter !== undefined && metadata.updatedAt <= where.updatedAfter) return undefined;
      return matchID;
    }));
    return matches.filter((id): id is string => id !== undefined);
  }
}
