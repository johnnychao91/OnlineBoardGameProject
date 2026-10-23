import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const command = promisify(execFile);
const script = resolve('scripts/inspect-rooms.mjs');
const { inspectRooms } = await import(pathToFileURL(script).href);
const directories: string[] = [];
const ids = ['inspectionRoom01', 'inspectionRoom02', 'inspectionMatch2', 'inspectionRoom03'];
const secret = 'private-fixture-not-for-report';
const room = (id: string, extra = {}) => ({ roomId: id, gameId: 'turing-test', inviteHash: secret, ...extra });
const match = (id: string, status: string, extra = {}) => ({ schemaVersion: 1, matchID: id,
  state: { G: { status, secretCards: secret }, ctx: {} },
  metadata: { players: { '0': { name: secret, credentials: secret, isConnected: true },
    '1': { name: secret, credentials: secret, data: { isBot: true } }, '2': { name: secret } } }, ...extra });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'boardgame-room-inspection-'));
  directories.push(directory);
  await mkdir(join(directory, 'matches'));
  return directory;
}

async function save(directory: string, rooms: object[], matches: any[]) {
  await writeFile(join(directory, 'rooms.json'), JSON.stringify(rooms));
  for (const entry of matches) await writeFile(join(directory, 'matches', `${entry.matchID}.json`), JSON.stringify(entry));
}

async function cli(directory: string, ...args: string[]) {
  try {
    const result = await command(process.execPath, [script, '--data-dir', directory, ...args]);
    return { ...result, code: 0 };
  } catch (error: any) {
    return { stdout: error.stdout as string, stderr: error.stderr as string, code: error.code as number };
  }
}

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('boardgame-room-inspection-')) {
      throw new Error('Unexpected test directory');
    }
    await rm(directory, { recursive: true, force: true });
  }
});

describe('Read-only room inventory', () => {
  it('follows the current match pointer, handles legacy rooms, and reports admissions without leaking secrets or writing files', async () => {
    const directory = await fixture();
    await save(directory, [room(ids[0]), room(ids[1], { currentMatchID: ids[2], testRoom: true,
      spectators: { observer: { name: secret, credentialHash: secret } },
      history: [{ endedAt: 10, ending: 'empty' }] }), room(ids[3])],
    [match(ids[0], 'lobby'), match(ids[1], 'lobby'), match(ids[2], 'table'), match(ids[3], 'finished')]);
    const files = ['rooms.json', ...ids.map(id => `matches/${id}.json`)];
    const before = await Promise.all(files.map(async file => ({ text: await readFile(join(directory, file), 'utf8'),
      modified: (await stat(join(directory, file))).mtimeMs })));
    const result = await cli(directory, '--json');
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain(secret);
    const report = JSON.parse(result.stdout);
    expect(report.membershipCounts).toBe('persisted-admissions-not-live-presence');
    expect(report.summary).toEqual({ savedRooms: 3, active: 1, lobby: 1, finished: 1, unreadable: 0 });
    expect(report.rooms[1]).toMatchObject({ roomID: ids[1], matchID: ids[2], game: 'turing-test', testRoom: true,
      state: 'active', phase: 'table', admittedHumans: 1, admittedBots: 1, admittedObservers: 1,
      latestEnding: { reason: 'empty', at: '1970-01-01T00:00:00.010Z' } });
    expect(JSON.stringify(report)).not.toMatch(/isConnected|credentials|inviteHash|secretCards/);
    expect(await Promise.all(files.map(async file => ({ text: await readFile(join(directory, file), 'utf8'),
      modified: (await stat(join(directory, file))).mtimeMs })))).toEqual(before);
    const table = await cli(directory);
    expect(table.stdout).toContain('不是即時線上人數');
    expect(table.stdout).not.toContain(secret);
  });

  it('keeps unreadable rooms visible in the active filter and returns a nonzero result instead of claiming all rooms ended', async () => {
    const directory = await fixture();
    await save(directory, [room(ids[0]), room(ids[1]), room(ids[3])], [match(ids[0], 'lobby'), match(ids[1], 'table')]);
    const result = await cli(directory, '--active-only', '--json');
    expect(result.code).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.summary).toEqual({ savedRooms: 3, active: 1, lobby: 1, finished: 0, unreadable: 1 });
    expect(report.rooms.map((entry: any) => entry.roomID)).toEqual([ids[1], ids[3]]);
    expect(report.rooms[1].issue).toBe('match-missing');
    const filtered = JSON.parse((await cli(directory, '--room', ids[0], '--json')).stdout);
    expect(filtered.summary).toMatchObject({ savedRooms: 1, lobby: 1, unreadable: 0 });
    expect(filtered.rooms).toHaveLength(1);
  });

  it('fails safely for malformed index/match data and invalid identifiers without echoing file contents', async () => {
    const directory = await fixture();
    await save(directory, [room(ids[0])], []);
    await writeFile(join(directory, 'matches', `${ids[0]}.json`), `invalid-${secret}`);
    const badMatch = await cli(directory, '--json');
    expect(badMatch.code).toBe(1);
    expect(badMatch.stdout + badMatch.stderr).not.toContain(secret);
    await writeFile(join(directory, 'rooms.json'), `invalid-${secret}`);
    const badIndex = await cli(directory, '--json');
    expect(badIndex.code).toBe(2);
    expect(badIndex.stdout + badIndex.stderr).not.toContain(secret);
    await save(directory, [room(ids[0], { currentMatchID: '../outside-file' })], []);
    expect((await cli(directory, '--json')).code).toBe(2);
    expect((await cli(directory, '--room', '../outside-file')).code).toBe(2);
  });

  it('does not create a missing data directory', async () => {
    const directory = join(await fixture(), 'not-created');
    expect((await cli(directory)).code).toBe(2);
    await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retries a room-pointer change so an archived active match is not reported as the current game', async () => {
    const directory = resolve('inspection-fixture');
    let indexReads = 0;
    const oldIndex = JSON.stringify([room(ids[0])]);
    const nextIndex = JSON.stringify([room(ids[0], { currentMatchID: ids[2] })]);
    const read = async (file: string) => {
      if (file === join(directory, 'rooms.json')) return ++indexReads === 1 ? oldIndex : nextIndex;
      if (file === join(directory, 'matches', `${ids[0]}.json`)) return JSON.stringify(match(ids[0], 'table'));
      if (file === join(directory, 'matches', `${ids[2]}.json`)) return JSON.stringify(match(ids[2], 'lobby'));
      throw new Error('Unexpected file');
    };
    const report = await inspectRooms(directory, { read });
    expect(report.stableIndex).toBe(true);
    expect(report.summary).toMatchObject({ active: 0, lobby: 1 });
    expect(report.rooms[0].matchID).toBe(ids[2]);
    expect(indexReads).toBe(4);
  });

  it('labels a continuously changing index as a sampled result rather than a consistent snapshot', async () => {
    const directory = resolve('inspection-fixture');
    let indexReads = 0;
    const read = async (file: string) => file === join(directory, 'rooms.json')
      ? JSON.stringify([room(ids[0], { createdAt: ++indexReads })]) : JSON.stringify(match(ids[0], 'table'));
    const report = await inspectRooms(directory, { read });
    expect(report.stableIndex).toBe(false);
    expect(indexReads).toBe(6);
    expect(report.rooms[0].state).toBe('active');
  });
});
