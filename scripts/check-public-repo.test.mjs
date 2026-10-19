import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { allowedHost, checkRepository, inspectFile } from './check-public-repo.mjs';

const inspect = (file, text) => inspectFile(file, Buffer.from(text));
// Construct deliberately forbidden fixtures so the fixture itself has no live URL.
const privateHost = ['private-fixture', 'unregistered'].join('.');

test('permits reserved examples, loopback and narrowly scoped public sources', () => {
  for (const host of ['game.example.com', 'example.org', 'example.net', 'station.example', 'example.test', 'test.invalid', 'localhost', '127.0.0.1', '[::1]']) {
    assert.equal(allowedHost(host, 'README.md'), true);
  }
  assert.equal(allowedHost('github.com', 'README.md'), true);
  assert.equal(allowedHost('registry.npmjs.org', 'package-lock.json'), true);
  assert.equal(allowedHost('registry.npmjs.org', 'deploy/apache.conf.example'), false);
  assert.equal(allowedHost(`example.com.${privateHost}`, 'README.md'), false);
  assert.deepEqual(inspect('test.ts', 'http://127.0.0.1:${port}/api https://station.example').problems, []);
});

test('rejects private filenames even when empty or binary', () => {
  for (const name of ['.env', '.env.production', 'deploy/site.local.conf', 'config/space-station.env', 'backups/save.tar.gz', 'data/match.json', 'credentials/service.json', '.ssh/id_ed25519', 'server.key']) {
    assert.ok(inspect(name, '').problems.includes('private/runtime file must not be tracked'), name);
  }
  assert.deepEqual(inspect('.env.example', 'PUBLIC_ORIGIN=http://localhost:5173').problems, []);
  assert.equal(inspectFile('server.p12', Buffer.from([0, 1, 2])).problems.length, 1);
});

test('rejects non-example URLs, Apache names and certificate names without exposing values', () => {
  for (const content of [`https://${privateHost}/api`, `ServerName ${privateHost}`, `ServerAlias game.example.com ${privateHost}`, `/etc/letsencrypt/live/${privateHost}/fullchain.pem`]) {
    const result = inspect('deploy/apache.conf.example', content);
    assert.ok(result.problems.length > 0);
    assert.equal(JSON.stringify(result).includes(privateHost), false);
  }
  assert.deepEqual(inspect('deploy/apache.conf.example', 'ServerName game.example.com\n/etc/letsencrypt/live/game.example.com/fullchain.pem').problems, []);
  assert.deepEqual(inspect('deploy/apache.conf.example', 'ServerName ${GAME_DOMAIN}\n/etc/letsencrypt/live/${GAME_DOMAIN}/fullchain.pem').problems, []);
  assert.ok(inspect('README.md', ['private-fixture', 'online'].join('.')).problems.length);
});

test('flags common credentials, without reporting credential contents', () => {
  const tokens = [
    ['-----BEGIN ', 'PRIVATE KEY-----'].join(''),
    ['ghp_', 'a'.repeat(36)].join(''),
    ['github_pat_', 'A'.repeat(70)].join(''),
    ['AKIA', 'A'.repeat(16)].join(''),
    ['AIza', 'a'.repeat(35)].join(''),
    ['ya29.', 'a'.repeat(50)].join(''),
    ['xoxb-', '1'.repeat(24)].join(''),
  ];
  for (const token of tokens) {
    const result = inspect('accidental.txt', token);
    assert.ok(result.problems.length > 0);
    assert.equal(JSON.stringify(result).includes(token), false);
  }
  assert.ok(inspect('README.md', `https://${['person', 'password'].join(':')}@github.com/`).problems.includes('URL contains credentials'));
});

test('reports binary content as skipped, and never claims to OCR it', () => {
  assert.deepEqual(inspectFile('docs/assets/image.png', Buffer.from([137, 80, 78, 71, 0, 0])), { problems: [], binary: true });
});

test('scanner and its intentional fixtures comply with the same guard', async () => {
  for (const filename of ['check-public-repo.mjs', 'check-public-repo.test.mjs']) {
    const contents = await readFile(new URL(filename, import.meta.url));
    assert.deepEqual(inspectFile(`scripts/${filename}`, contents).problems, []);
  }
});

test('inspects tracked files including whitespace names, leaving ignored private config alone', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'public-repo-check-'));
  try {
    execFileSync('git', ['init', '--quiet', root]);
    await mkdir(path.join(root, 'docs'));
    await writeFile(path.join(root, '.gitignore'), '.env\n');
    await writeFile(path.join(root, '.env'), `PUBLIC_ORIGIN=https://${privateHost}`);
    await writeFile(path.join(root, 'docs', 'example file.md'), `https://${privateHost}/`);
    execFileSync('git', ['add', '.'], { cwd: root });
    const result = await checkRepository(root);
    assert.equal(result.scanned, 2);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].file, 'docs/example file.md');
    assert.equal(JSON.stringify(result).includes(privateHost), false);
  } finally {
    // mkdtemp creates this exact, task-owned directory; no repository is removed.
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('public-repo-check-'));
    await rm(root, { recursive: true, force: true });
  }
});
