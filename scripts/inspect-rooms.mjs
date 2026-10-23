import { lstat, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const validID = value => typeof value === 'string' && /^[A-Za-z0-9_-]{16}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const timestamp = value => Number.isFinite(value) && value >= 0 && value <= 8640000000000000
  ? new Date(value).toISOString() : null;
const label = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value) ? value : 'unknown';

// Never use RoomStore/FileStorage here: their initialization can create directories.
async function readPlainFile(filename) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('not-regular-file');
  return readFile(filename, 'utf8');
}

function parseIndex(text) {
  let rooms;
  try { rooms = JSON.parse(text); } catch { throw new Error('房間索引不是有效 JSON；沒有變更任何資料。'); }
  if (!Array.isArray(rooms) || rooms.some(room => !object(room) || !validID(room.roomId)
    || (room.currentMatchID !== undefined && !validID(room.currentMatchID)))
    || new Set(rooms.map(room => room.roomId)).size !== rooms.length) {
    throw new Error('房間索引格式不正確；沒有變更任何資料。');
  }
  return rooms;
}

function lastEnding(room) {
  const history = Array.isArray(room.history) ? room.history.filter(entry => object(entry)
    && ['completed', 'host-ended', 'empty'].includes(entry.ending) && timestamp(entry.endedAt)) : [];
  const last = history.reduce((latest, entry) => !latest || entry.endedAt > latest.endedAt ? entry : latest, null);
  return last ? { reason: last.ending, at: timestamp(last.endedAt) } : null;
}

async function inspectRoom(room, directory, read) {
  const matchID = room.currentMatchID ?? room.roomId;
  const base = { roomID: room.roomId, matchID, game: label(room.gameId), testRoom: room.testRoom === true,
    latestEnding: lastEnding(room) };
  try {
    const match = JSON.parse(await read(join(directory, 'matches', `${matchID}.json`)));
    if (!object(match) || match.schemaVersion !== 1 || match.matchID !== matchID
      || !object(match.state?.G) || !object(match.metadata?.players)
      || typeof match.state.G.status !== 'string') throw new Error('invalid-match');
    const phase = label(match.state.G.status);
    if (phase === 'unknown') throw new Error('invalid-match');
    const players = Object.values(match.metadata.players).filter(player => object(player)
      && typeof player.credentials === 'string' && player.credentials.length > 0);
    const bots = players.filter(player => player.data?.isBot === true).length;
    const observers = object(room.spectators) ? Object.values(room.spectators).filter(observer => object(observer)
      && typeof observer.credentialHash === 'string' && observer.credentialHash.length > 0).length : 0;
    // isConnected is persisted metadata, not an authoritative live connection count.
    return { ...base, state: phase === 'lobby' ? 'lobby'
      : phase === 'finished' || match.state.ctx?.gameover ? 'finished' : 'active', phase,
    admittedHumans: players.length - bots, admittedBots: bots, admittedObservers: observers };
  } catch (error) {
    return { ...base, state: 'unreadable', issue: error?.code === 'ENOENT' ? 'match-missing'
      : ['EACCES', 'EPERM'].includes(error?.code) ? 'permission-denied' : 'invalid-or-unreadable-match' };
  }
}

/** Read-only sampled inventory. Its admissions are never presented as live presence. */
export async function inspectRooms(dataDir, { roomID, activeOnly = false, read = readPlainFile } = {}) {
  if (roomID !== undefined && !validID(roomID)) throw new Error('房間 ID 格式不正確。');
  const directory = resolve(dataDir), index = join(directory, 'rooms.json');
  let rows, stableIndex = false;
  // Match files and the room pointer are each atomically replaced, but are not one
  // transaction. Re-read the index so a lobby transition cannot show the old match
  // as still active. A continuously changing index is explicitly reported.
  for (let attempt = 0; attempt < 3; attempt++) {
    let before;
    try { before = await read(index); }
    catch { throw new Error('無法讀取 rooms.json；請確認 --data-dir 與讀取權限。沒有變更任何資料。'); }
    const rooms = parseIndex(before).filter(room => roomID === undefined || room.roomId === roomID);
    rows = [];
    for (const room of rooms) rows.push(await inspectRoom(room, directory, read));
    let after;
    try { after = await read(index); } catch { continue; }
    if (before === after) { stableIndex = true; break; }
  }
  const summary = { savedRooms: rows.length, active: 0, lobby: 0, finished: 0, unreadable: 0 };
  for (const row of rows) summary[row.state]++;
  return { sampledAt: new Date().toISOString(), stableIndex, membershipCounts: 'persisted-admissions-not-live-presence', summary,
    rooms: activeOnly ? rows.filter(row => row.state === 'active' || row.state === 'unreadable') : rows };
}

const usage = `用法：node scripts/inspect-rooms.mjs --data-dir <資料目錄> [--active-only] [--room <房間ID>] [--json]
唯讀檢查目前對局；不啟動伺服器、不清理房間、不輸出暱稱或憑證。
--active-only  只列尚在進行及無法判讀的房間（摘要仍包含全部房間）。
--room         只檢查指定房間。
--json         輸出可供工具處理的 JSON。`;

export async function main(args = process.argv.slice(2), io = console) {
  if (args.length === 0 || args.includes('--help')) { io.log(usage); return args.length === 0 ? 2 : 0; }
  let dataDir, roomID, activeOnly = false, json = false;
  try {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--data-dir' || args[i] === '--room') {
        const option = args[i], value = args[++i];
        if (!value || value.startsWith('--')) throw new Error('選項缺少值。');
        if (option === '--data-dir') dataDir = value;
        else roomID = value;
      } else if (args[i] === '--active-only') activeOnly = true;
      else if (args[i] === '--json') json = true;
      else throw new Error('未知選項。');
    }
    if (!dataDir) throw new Error('請指定 --data-dir。');
    const report = await inspectRooms(dataDir, { roomID, activeOnly });
    if (json) io.log(JSON.stringify(report, null, 2));
    else {
      io.log(`讀取時間：${report.sampledAt}`);
      io.log('人數＝已登記席位，不是即時線上人數。等待室與歷史保留，不代表對局仍在執行。');
      io.log(`保留房間 ${report.summary.savedRooms}；進行中 ${report.summary.active}；等待室 ${report.summary.lobby}；結束畫面 ${report.summary.finished}；無法判讀 ${report.summary.unreadable}`);
      if (!report.stableIndex) io.log('房間索引持續變動；以下是讀取期間的快照，請稍後重查。');
      io.table(report.rooms.map(room => ({ 房間: room.roomID, 遊戲: room.game, 狀態: room.state, 階段: room.phase ?? '—',
        測試房: room.testRoom ? '是' : '否', 登記真人: room.admittedHumans ?? '—', 虛擬玩家: room.admittedBots ?? '—',
        登記觀戰: room.admittedObservers ?? '—', 上次結束: room.latestEnding?.reason ?? '—',
        上次結束時間: room.latestEnding?.at ?? '—', 問題: room.issue ?? '—' })));
    }
    return report.summary.unreadable || !report.stableIndex ? 1 : 0;
  } catch (error) {
    // All outward errors are our own generic messages, never JSON parser content.
    io.error(error.message);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
