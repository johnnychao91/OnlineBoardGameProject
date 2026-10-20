import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { platform, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atomicReplace } from './atomic-file';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, rename: vi.fn(original.rename) };
});
vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>();
  return { ...original, platform: vi.fn(original.platform) };
});
vi.mock('node:timers/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:timers/promises')>();
  return { ...original, setTimeout: vi.fn(async () => undefined) };
});

let directory: string;
let temporary: string;
let destination: string;
beforeEach(async () => {
  vi.clearAllMocks();
  const original = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(rename).mockReset().mockImplementation(original.rename);
  vi.mocked(platform).mockReturnValue('win32');
  directory = await mkdtemp(join(tmpdir(), 'boardgame-atomic-test-'));
  temporary = join(directory, 'pending.tmp');
  destination = join(directory, 'record.json');
  await writeFile(temporary, '{"version":2}');
  await writeFile(destination, '{"version":1}');
});
afterEach(async () => {
  if (directory) {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('boardgame-atomic-test-')) {
      throw new Error('Refusing cleanup outside the test temporary directory.');
    }
    await rm(directory, { recursive: true, force: true });
  }
});
const ioError = (code: string) => Object.assign(new Error(code), { code });

describe('原子替換暫時被 Windows 檔案鎖阻擋', () => {
  it.each(['EPERM', 'EACCES', 'EBUSY'])('%s 重試同一份已寫完的暫存檔即可完成替換', async (code) => {
    vi.mocked(rename).mockRejectedValueOnce(ioError(code));
    await atomicReplace(temporary, destination);
    expect(rename).toHaveBeenCalledTimes(2);
    expect(vi.mocked(rename).mock.calls).toEqual([[temporary, destination], [temporary, destination]]);
    expect(delay).toHaveBeenCalledExactlyOnceWith(20);
    expect(await readFile(destination, 'utf8')).toBe('{"version":2}');
    await expect(readFile(temporary)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('連續失敗只嘗試六次，回傳原錯誤並保留目的檔與暫存檔', async () => {
    const failure = ioError('EPERM');
    vi.mocked(rename).mockRejectedValue(failure);
    await expect(atomicReplace(temporary, destination)).rejects.toBe(failure);
    expect(rename).toHaveBeenCalledTimes(6);
    expect(vi.mocked(rename).mock.calls.every(([source, target]) => source === temporary && target === destination)).toBe(true);
    expect(vi.mocked(delay).mock.calls).toEqual([[20], [40], [80], [160], [320]]);
    expect(await readFile(destination, 'utf8')).toBe('{"version":1}');
    expect(await readFile(temporary, 'utf8')).toBe('{"version":2}');
  });

  it.each(['ENOENT', 'ENOSPC', 'EXDEV', 'EIO'])('其他 %s 錯誤立即拋出，不等待或刪除原檔', async (code) => {
    const failure = ioError(code);
    vi.mocked(rename).mockRejectedValue(failure);
    await expect(atomicReplace(temporary, destination)).rejects.toBe(failure);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
    expect(await readFile(destination, 'utf8')).toBe('{"version":1}');
  });

  it('成功的替換不延遲、不重試', async () => {
    await atomicReplace(temporary, destination);
    expect(rename).toHaveBeenCalledExactlyOnceWith(temporary, destination);
    expect(delay).not.toHaveBeenCalled();
    expect(await readFile(destination, 'utf8')).toBe('{"version":2}');
  });

  it.each(['EPERM', 'EACCES', 'EBUSY'])('Linux 上的 %s 不套用 Windows 重試', async (code) => {
    vi.mocked(platform).mockReturnValue('linux');
    const failure = ioError(code);
    vi.mocked(rename).mockRejectedValue(failure);
    await expect(atomicReplace(temporary, destination)).rejects.toBe(failure);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
    expect(await readFile(destination, 'utf8')).toBe('{"version":1}');
  });
});
