import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { InitializeGame } from 'boardgame.io/internal';
import type { LogEntry, Server, State } from 'boardgame.io';
import { FileStorage } from './storage';

const directories: string[] = [];
const ID = 'AbCdEfGh1234_-56';
const SECOND_ID = 'ZyXwVuTs9876_-54';
const THIRD_ID = 'QqWwEeRr1122_-33';

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('boardgame-storage-test-')) {
      throw new Error('測試清理路徑不在預期暫存目錄內');
    }
    await rm(target, { recursive: true, force: true });
  }
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'boardgame-storage-test-'));
  directories.push(dir);
  const storage = new FileStorage({ dir });
  await storage.connect();
  return { storage, dir };
}

function initialState(value = 0): State {
  return JSON.parse(JSON.stringify(InitializeGame({
    game: { name: 'storage-test', setup: () => ({ value, secret: ['private'] }) }, numPlayers: 2,
  })));
}

function metadata(updatedAt = 100, gameName = 'storage-test'): Server.MatchData {
  return { gameName, players: { '0': { id: 0, name: '站長', credentials: 'private-seat' }, '1': { id: 1 } }, createdAt: 1, updatedAt };
}

function gameState(stateID: number, status: 'lobby' | 'briefing' | 'playing' | 'finished', value = stateID): State {
  const state = initialState(value);
  state._stateID = stateID;
  state.G.status = status;
  return state;
}

function entry(index: number): LogEntry {
  return { action: { type: 'MAKE_MOVE', payload: { type: 'set', args: [index], playerID: '0' } }, _stateID: index, turn: 1, phase: '' };
}

describe('本機 JSON 對局儲存', () => {
  it('立即持久化完整對局，重新建立 adapter 後仍可讀取狀態、初始值、憑證與紀錄', async () => {
    const { storage, dir } = await fixture();
    const initial = initialState();
    await storage.createMatch(ID, { initialState: initial, metadata: metadata() });
    await storage.setState(ID, { ...initial, G: { value: 7 }, _stateID: 1 }, [entry(1)]);
    await storage.setMetadata(ID, { ...metadata(200), gameover: { winner: 'crew' } });
    const reopened = new FileStorage({ dir });
    await reopened.connect();
    const saved = await reopened.fetch(ID, { state: true, initialState: true, metadata: true, log: true });
    expect(saved.state.G).toEqual({ value: 7 });
    expect(saved.initialState.G).toEqual({ value: 0, secret: ['private'] });
    expect(saved.metadata.players['0'].credentials).toBe('private-seat');
    expect(saved.metadata.gameover).toEqual({ winner: 'crew' });
    expect(saved.log).toEqual([entry(1)]);
    expect(await readdir(dir)).toEqual([`${ID}.json`]);
    expect(JSON.parse(await readFile(join(dir, `${ID}.json`), 'utf8')).matchID).toBe(ID);
  });

  it('在呼叫時保存輸入快照，且每次 fetch 回傳獨立資料與指定欄位', async () => {
    const { storage } = await fixture();
    const state = initialState();
    const info = metadata();
    const pending = storage.createMatch(ID, { initialState: state, metadata: info });
    state.G.value = 99;
    info.players['0'].credentials = 'modified-input';
    await pending;
    const first = await storage.fetch(ID, { state: true, initialState: true, metadata: true, log: true });
    expect(first.state.G.value).toBe(0);
    first.state.G.secret[0] = 'modified-fetch';
    first.metadata.players['0'].credentials = 'modified-fetch';
    first.log.push(entry(2));
    expect(first.initialState.G.secret).toEqual(['private']);
    const next = await storage.fetch(ID, { state: true, metadata: true, log: true });
    expect(next.state.G.secret).toEqual(['private']);
    expect(next.metadata.players['0'].credentials).toBe('private-seat');
    expect(next.log).toEqual([]);
    expect(await storage.fetch(ID, { metadata: true })).toEqual({ metadata: metadata() });
    expect(await storage.fetch(ID, {})).toEqual({});
  });

  it('序列化同房並行狀態與 metadata 更新，不互相覆蓋且依順序追加 deltalog', async () => {
    const { storage } = await fixture();
    await storage.createMatch(ID, { initialState: initialState(), metadata: metadata() });
    const operations: Promise<void>[] = [];
    const state = initialState();
    const info = metadata();
    for (let index = 1; index <= 20; index++) {
      state.G.value = index; state._stateID = index;
      info.updatedAt = index;
      info.players['0'].name = `站長${index}`;
      operations.push(storage.setState(ID, state, [entry(index)]), storage.setMetadata(ID, info));
    }
    const latest = storage.fetch(ID, { state: true, metadata: true, log: true });
    await Promise.all(operations);
    const saved = await latest;
    expect(saved.state.G.value).toBe(20);
    expect(saved.metadata.players['0'].name).toBe('站長20');
    expect(saved.metadata.updatedAt).toBe(20);
    expect(saved.log.map((item) => item._stateID)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    await storage.setState(ID, saved.state);
    expect((await storage.fetch(ID, { log: true })).log).toHaveLength(20);
  });

  it('使用獨立目錄的 adapter 不共享全域資料', async () => {
    const first = await fixture(); const second = await fixture();
    await Promise.all([
      first.storage.createMatch(ID, { initialState: initialState(1), metadata: metadata() }),
      second.storage.createMatch(ID, { initialState: initialState(2), metadata: metadata() }),
    ]);
    expect((await first.storage.fetch(ID, { state: true })).state.G.value).toBe(1);
    expect((await second.storage.fetch(ID, { state: true })).state.G.value).toBe(2);
  });

  it('列出對局並以遊戲、結束狀態及嚴格時間邊界篩選，忽略暫存檔', async () => {
    const { storage, dir } = await fixture();
    const creating = [
      storage.createMatch(ID, { initialState: initialState(), metadata: metadata(100) }),
      storage.createMatch(SECOND_ID, { initialState: initialState(), metadata: { ...metadata(200), gameover: null } }),
      storage.createMatch(THIRD_ID, { initialState: initialState(), metadata: metadata(300, 'other-game') }),
    ];
    const listed = storage.listMatches();
    await Promise.all(creating);
    await writeFile(join(dir, '.interrupted.tmp'), '不完整資料');
    expect(await listed).toEqual([ID, SECOND_ID, THIRD_ID].sort());
    expect(await storage.listMatches({ gameName: 'storage-test' })).toEqual([ID, SECOND_ID].sort());
    expect(await storage.listMatches({ where: { isGameover: true } })).toEqual([SECOND_ID]);
    expect(await storage.listMatches({ where: { isGameover: false } })).toEqual([ID, THIRD_ID].sort());
    expect(await storage.listMatches({ where: { updatedAfter: 100, updatedBefore: 300 } })).toEqual([SECOND_ID]);
    expect(await storage.listMatches({ gameName: 'storage-test', where: { updatedBefore: 200, isGameover: false } })).toEqual([ID]);
  });

  it('拒絕所有檔案 API 的路徑與長度變體，不建立目錄外檔案', async () => {
    const { storage, dir } = await fixture();
    const invalidIDs = ['../outside', '..\\outside', '/tmp/elsewhere', 'C:\\Windows', 'a'.repeat(15), 'a'.repeat(17), '%2e%2e%2fsecret', 'bad:name12345678', '密'.repeat(16)];
    for (const id of invalidIDs) {
      await expect(storage.createMatch(id, { initialState: initialState(), metadata: metadata() })).rejects.toThrow('識別碼');
      await expect(storage.setState(id, initialState())).rejects.toThrow('識別碼');
      await expect(storage.setMetadata(id, metadata())).rejects.toThrow('識別碼');
      await expect(storage.fetch(id, { state: true })).rejects.toThrow('識別碼');
      await expect(storage.fetchReplay(id)).rejects.toThrow('識別碼');
      await expect(storage.startMatch(id, { initialState: initialState(), metadata: metadata() })).rejects.toThrow('識別碼');
      await expect(storage.wipe(id)).rejects.toThrow('識別碼');
    }
    expect(await readdir(dir)).toEqual([]);
  });

  it('刪除後的讀取回傳空值，拒絕無初始對局的更新，並可在失敗後繼續使用 queue', async () => {
    const { storage } = await fixture();
    await expect(storage.setState(ID, initialState())).rejects.toThrow('不存在');
    await expect(storage.setMetadata(ID, metadata())).rejects.toThrow('不存在');
    await storage.createMatch(ID, { initialState: initialState(), metadata: metadata() });
    await expect(storage.createMatch(ID, { initialState: initialState(999), metadata: metadata() })).rejects.toThrow('已存在');
    expect((await storage.fetch(ID, { state: true })).state.G.value).toBe(0);
    await storage.wipe(ID);
    await storage.wipe(ID);
    expect(await storage.fetch(ID, { state: true, metadata: true, initialState: true, log: true })).toEqual({ state: undefined, metadata: undefined, initialState: undefined, log: [] });
    expect(await storage.listMatches()).toEqual([]);
  });

  it('資料損壞或檔內房號不符時明確失敗，不把秘密資料當作其他房間回傳', async () => {
    const { storage, dir } = await fixture();
    await storage.createMatch(ID, { initialState: initialState(), metadata: metadata() });
    const filename = join(dir, `${ID}.json`);
    const good = await readFile(filename, 'utf8');
    await writeFile(filename, '{broken');
    await expect(storage.fetch(ID, { state: true })).rejects.toThrow();
    await writeFile(filename, JSON.stringify({ ...JSON.parse(good), matchID: SECOND_ID }));
    await expect(storage.fetch(ID, { metadata: true })).rejects.toThrow('資料格式');
    await expect(storage.wipe(ID)).rejects.toThrow('資料格式');
    await writeFile(filename, good);
    expect((await storage.fetch(ID, { state: true })).state.G.value).toBe(0);
  });

  it.runIf(process.platform === 'win32')('Windows 大小寫別名不能並行覆蓋、讀取或刪除原房間', async () => {
    const { storage } = await fixture();
    const results = await Promise.allSettled([
      storage.createMatch(ID, { initialState: initialState(1), metadata: metadata() }),
      storage.createMatch(ID.toLowerCase(), { initialState: initialState(2), metadata: metadata() }),
    ]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    await expect(storage.fetch(ID.toLowerCase(), { state: true })).rejects.toThrow('資料格式');
    await expect(storage.wipe(ID.toLowerCase())).rejects.toThrow('資料格式');
    expect((await storage.fetch(ID, { state: true })).state.G.value).toBe(1);
  });
});

describe('持久化回放與原子開局', () => {
  it('從非等待室的初始狀態記錄完整 G，重啟後保留畫面且不包含 metadata 或 plugins', async () => {
    const { storage, dir } = await fixture();
    const first = gameState(0, 'briefing');
    first.plugins.sensitive = { data: { randomSeed: 'server-plugin-only' } };
    first.G.private = { '0': { role: 'engineer' } };
    await storage.createMatch(ID, { initialState: first, metadata: metadata() });
    await storage.setState(ID, gameState(1, 'playing'));
    await storage.setState(ID, gameState(2, 'finished'));
    const reopened = new FileStorage({ dir });
    await reopened.connect();
    const replay = await reopened.fetchReplay(ID);
    expect(replay.complete).toBe(true);
    expect(replay.frames.map((frame) => frame.stateID)).toEqual([0, 1, 2]);
    expect(replay.frames.map((frame) => frame.G.status)).toEqual(['briefing', 'playing', 'finished']);
    expect(replay.frames[0].G.private).toEqual({ '0': { role: 'engineer' } });
    for (const frame of replay.frames) {
      expect(Object.keys(frame).sort()).toEqual(['G', 'at', 'stateID']);
      expect(Number.isFinite(frame.at) && frame.at > 0).toBe(true);
    }
    expect(JSON.stringify(replay)).not.toContain('private-seat');
    expect(JSON.stringify(replay)).not.toContain('server-plugin-only');
    expect(replay.frames[0]).not.toHaveProperty('ctx');
    expect(await reopened.fetch(ID, { state: true })).not.toHaveProperty('replayFrames');
    const disk = JSON.parse(await readFile(join(dir, `${ID}.json`), 'utf8'));
    expect(disk.state._stateID).toBe(disk.replayFrames.at(-1).stateID);
    expect(disk.replayFrames).toEqual(replay.frames);
    replay.frames[0].G.private['0'].role = 'changed';
    replay.frames.push({ stateID: 99, at: 1, G: {} });
    expect((await reopened.fetchReplay(ID)).frames).toHaveLength(3);
    expect((await reopened.fetchReplay(ID)).frames[0].G.private['0'].role).toBe('engineer');
  });

  it('等待室不記畫面，開局後才追加實際保存的版本', async () => {
    const { storage } = await fixture();
    await storage.createMatch(ID, { initialState: gameState(0, 'lobby'), metadata: metadata() });
    expect(await storage.fetchReplay(ID)).toEqual({ complete: true, frames: [] });
    await storage.setState(ID, gameState(1, 'lobby'));
    await storage.setState(ID, gameState(2, 'briefing'));
    await storage.setState(ID, gameState(3, 'playing'));
    const replay = await storage.fetchReplay(ID);
    expect(replay.complete).toBe(true);
    expect(replay.frames.map((frame) => frame.stateID)).toEqual([2, 3]);
  });

  it('並行重送同版或舊版不重複回放與操作紀錄，也不覆寫較新的狀態', async () => {
    const { storage } = await fixture();
    await storage.createMatch(ID, { initialState: gameState(0, 'briefing'), metadata: metadata() });
    await Promise.all([
      storage.setState(ID, gameState(1, 'playing', 1), [entry(1)]),
      storage.setState(ID, gameState(1, 'playing', 999), [entry(99)]),
      storage.setState(ID, gameState(2, 'finished', 2), [entry(2)]),
      storage.setState(ID, gameState(0, 'lobby', -1), [entry(98)]),
      storage.setState(ID, gameState(2, 'playing', 777), [entry(97)]),
      storage.setMetadata(ID, metadata(300)),
    ]);
    const replay = await storage.fetchReplay(ID);
    expect(replay.complete).toBe(true);
    expect(replay.frames.map((frame) => frame.stateID)).toEqual([0, 1, 2]);
    expect(replay.frames.map((frame) => frame.G.value)).toEqual([0, 1, 2]);
    const stored = await storage.fetch(ID, { state: true, log: true, metadata: true });
    expect(stored.state.G.status).toBe('finished');
    expect(stored.state.G.value).toBe(2);
    expect(stored.log).toEqual([entry(1), entry(2)]);
    expect(stored.metadata.updatedAt).toBe(300);
  });

  it('版本有缺口時不補造中間畫面，並保留歷史不完整標記', async () => {
    const { storage } = await fixture();
    await storage.createMatch(ID, { initialState: gameState(0, 'briefing'), metadata: metadata() });
    await storage.setState(ID, gameState(3, 'playing'));
    await storage.setState(ID, gameState(4, 'finished'));
    const replay = await storage.fetchReplay(ID);
    expect(replay.complete).toBe(false);
    expect(replay.frames.map((frame) => frame.stateID)).toEqual([0, 3, 4]);
  });

  it('舊 schema 1 對局可繼續讀寫，但缺失的回放不能被初始值或現況冒充', async () => {
    const { storage, dir } = await fixture();
    await storage.createMatch(ID, { initialState: gameState(0, 'briefing'), metadata: metadata() });
    const filename = join(dir, `${ID}.json`);
    const legacy = JSON.parse(await readFile(filename, 'utf8'));
    delete legacy.replayFrames;
    delete legacy.replayComplete;
    legacy.state = gameState(4, 'playing');
    await writeFile(filename, JSON.stringify(legacy));
    expect((await storage.fetch(ID, { state: true })).state._stateID).toBe(4);
    expect(await storage.fetchReplay(ID)).toEqual({ complete: false, frames: [] });
    await storage.setState(ID, gameState(5, 'finished'));
    const reopened = new FileStorage({ dir });
    await reopened.connect();
    const replay = await reopened.fetchReplay(ID);
    expect(replay.complete).toBe(false);
    expect(replay.frames.map((frame) => frame.stateID)).toEqual([5]);
    expect((await reopened.fetch(ID, { initialState: true })).initialState._stateID).toBe(0);
  });

  it('舊等待室可原子換成實際人數的初始對局，保留傳入憑證並重設 log 與完整回放', async () => {
    const { storage, dir } = await fixture();
    await storage.createMatch(ID, { initialState: gameState(0, 'lobby'), metadata: metadata() });
    await storage.setState(ID, gameState(3, 'lobby'), [entry(1), entry(2), entry(3)]);
    const filename = join(dir, `${ID}.json`);
    const legacy = JSON.parse(await readFile(filename, 'utf8'));
    delete legacy.replayFrames; delete legacy.replayComplete;
    await writeFile(filename, JSON.stringify(legacy));
    const actual = gameState(0, 'briefing', 10);
    actual.ctx.numPlayers = 4;
    actual.ctx.playOrder = ['0', '1', '2', '3'];
    const occupied = metadata(500);
    occupied.players['1'] = { id: 1, name: '朋友', credentials: 'guest-seat' };
    occupied.players['2'] = { id: 2, name: '朋友二', credentials: 'guest-two' };
    occupied.players['3'] = { id: 3, name: '朋友三', credentials: 'guest-three' };
    const expected = JSON.parse(JSON.stringify({ actual, occupied }));
    const starting = storage.startMatch(ID, { initialState: actual, metadata: occupied });
    actual.G.value = 999;
    occupied.players['1'].credentials = 'later-mutation';
    await starting;
    const reopened = new FileStorage({ dir });
    await reopened.connect();
    const saved = await reopened.fetch(ID, { initialState: true, state: true, log: true, metadata: true });
    expect(saved.initialState).toEqual(expected.actual);
    expect(saved.state).toEqual(expected.actual);
    expect(saved.metadata).toEqual(expected.occupied);
    expect(saved.log).toEqual([]);
    const replay = await reopened.fetchReplay(ID);
    expect(replay.complete).toBe(true);
    expect(replay.frames).toHaveLength(1);
    expect(replay.frames[0].G).toEqual(expected.actual.G);
    expect(replay.frames[0].stateID).toBe(0);
  });

  it('原子開局只接受存在的等待室，並行開始只有第一個成功', async () => {
    const { storage } = await fixture();
    await expect(storage.startMatch(ID, { initialState: gameState(0, 'briefing'), metadata: metadata() })).rejects.toThrow('不存在');
    await expect(storage.fetchReplay(ID)).rejects.toThrow('不存在');
    await storage.createMatch(ID, { initialState: gameState(0, 'lobby'), metadata: metadata() });
    const results = await Promise.allSettled([
      storage.startMatch(ID, { initialState: gameState(0, 'briefing', 1), metadata: metadata(1) }),
      storage.startMatch(ID, { initialState: gameState(0, 'briefing', 2), metadata: metadata(2) }),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect((await storage.fetch(ID, { state: true })).state.G.value).toBe(1);
    await storage.setState(ID, gameState(1, 'finished'));
    await expect(storage.startMatch(ID, { initialState: gameState(0, 'lobby'), metadata: metadata() })).rejects.toThrow('等待室');
    expect((await storage.fetchReplay(ID)).frames.map((frame) => frame.stateID)).toEqual([0, 1]);
  });

  it('移出原子保存席位、狀態與撤銷紀錄，拒絕過期請求且開局後仍保留撤銷', async () => {
    const { storage, dir } = await fixture();
    const occupied = metadata();
    occupied.players['1'] = { id: 1, name: '朋友', credentials: 'guest-removal-test', isConnected: true };
    const lobby = gameState(0, 'lobby');
    lobby.G.players = { '0': { ready: true }, '1': { ready: true } };
    await storage.createMatch(ID, { initialState: lobby, metadata: occupied });
    const filename = join(dir, `${ID}.json`);
    const before = await readFile(filename, 'utf8');
    const removed = structuredClone(lobby);
    removed._stateID = 1;
    removed.G.players['1'].ready = false;
    await expect(storage.removePlayer(ID, '1', 'wrong-credential', removed)).rejects.toThrow('無法移出');
    // Host authorization belongs to the room API because the host can move to
    // another seat. Storage still refuses an out-of-sequence membership update.
    await expect(storage.removePlayer(ID, '0', 'private-seat', {
      ...removed, _stateID: removed._stateID + 1,
    })).rejects.toThrow('無法移出');
    expect(await readFile(filename, 'utf8')).toBe(before);
    const writing = storage.removePlayer(ID, '1', 'guest-removal-test', removed);
    removed.G.players['1'].ready = true;
    await writing;
    const saved = await storage.fetch(ID, { metadata: true, state: true });
    expect(saved.metadata.players['1']).toEqual({ id: 1 });
    expect(saved.state.G.players['1'].ready).toBe(false);
    expect(saved.state._stateID).toBe(1);
    const raw = await readFile(filename, 'utf8');
    expect(raw).not.toContain('guest-removal-test');
    expect(JSON.parse(raw).revokedAdmissions).toEqual([expect.stringMatching(/^[a-f0-9]{64}$/)]);
    await storage.startMatch(ID, { initialState: gameState(2, 'briefing'), metadata: saved.metadata });
    const reopened = new FileStorage({ dir });
    await reopened.connect();
    expect(await reopened.isAdmissionRevoked(ID, 'guest-removal-test')).toBe(true);
    expect(await reopened.isAdmissionRevoked(ID, 'fresh-admission')).toBe(false);
  });

  it('拒絕非整數、負數或不安全的狀態版本，不破壞原對局與回放', async () => {
    const { storage } = await fixture();
    await storage.createMatch(ID, { initialState: gameState(0, 'briefing'), metadata: metadata() });
    for (const stateID of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(storage.setState(ID, gameState(stateID, 'playing'))).rejects.toThrow('狀態版本');
      await expect(storage.createMatch(SECOND_ID, { initialState: gameState(stateID, 'briefing'), metadata: metadata() })).rejects.toThrow('狀態版本');
    }
    expect((await storage.fetch(ID, { state: true })).state._stateID).toBe(0);
    expect((await storage.fetchReplay(ID)).frames.map((frame) => frame.stateID)).toEqual([0]);
  });
});
