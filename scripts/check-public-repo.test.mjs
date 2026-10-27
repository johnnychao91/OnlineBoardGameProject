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
  for (const host of ['www.gen42.com', 'www.met.police.uk']) {
    assert.equal(allowedHost(host, 'docs/BAKER_STREET.md'), true);
    assert.equal(allowedHost(host, 'deploy/apache.conf.example'), false);
    assert.equal(allowedHost(host, 'README.md'), false);
  }
  assert.equal(allowedHost('indieboardsandcards.com', 'docs/BLACK_FOG.md'), true);
  assert.equal(allowedHost('indieboardsandcards.com', 'deploy/apache.conf.example'), false);
  assert.equal(allowedHost('indieboardsandcards.com', 'README.md'), false);
  assert.equal(allowedHost('andyventure.com', 'docs/TURING_TEST.md'), true);
  assert.equal(allowedHost('andyventure.com', 'deploy/apache.conf.example'), false);
  assert.equal(allowedHost('andyventure.com', 'README.md'), false);
  for (const host of ['alderac.com', 'cdn.svc.asmodee.net']) {
    assert.equal(allowedHost(host, 'docs/MIDNIGHT_POST.md'), true);
    assert.equal(allowedHost(host, 'deploy/apache.conf.example'), false);
    assert.equal(allowedHost(host, 'README.md'), false);
  }
  assert.equal(allowedHost('www.w3.org', 'src/client/assets/post/roles/seal-1.svg'), true);
  assert.equal(allowedHost('www.w3.org', 'deploy/apache.conf.example'), false);
  assert.equal(allowedHost('www.w3.org', 'src/client/assets/post/roles/unexpected.svg'), false);
  assert.equal(allowedHost('registry.npmjs.org', 'package-lock.json'), true);
  assert.equal(allowedHost('registry.npmjs.org', 'deploy/apache.conf.example'), false);
  assert.equal(allowedHost(`example.com.${privateHost}`, 'README.md'), false);
  assert.deepEqual(inspect('test.ts', 'http://127.0.0.1:${port}/api https://station.example').problems, []);
});

test('rejects private filenames even when empty or binary', () => {
  for (const name of ['.env', '.env.production', 'deploy/site.local.conf', 'config/boardgame.env', 'backups/save.tar.gz', 'data/match.json', 'credentials/service.json', '.ssh/id_ed25519', 'server.key']) {
    assert.ok(inspect(name, '').problems.includes('private/runtime file must not be tracked'), name);
  }
  assert.deepEqual(inspect('.env.example', 'PUBLIC_ORIGIN=http://localhost:5173').problems, []);
  assert.equal(inspectFile('server.p12', Buffer.from([0, 1, 2])).problems.length, 1);
});

test('limits firewall provenance to its source content and rulebook', async () => {
  const host = 'blog.amigo-spiele.de';
  for (const file of ['src/games/firewall/content.ts', 'docs/FIREWALL_BREACH.md']) {
    assert.equal(allowedHost(host, file), true);
    assert.deepEqual(inspectFile(file, await readFile(new URL(`../${file}`, import.meta.url))).problems, [], file);
  }
  for (const file of ['README.md', 'deploy/apache.conf.example', 'src/server/app.ts', 'src/games/firewall/game.ts']) {
    assert.equal(allowedHost(host, file), false);
  }
});

test('limits star provenance to its source content and rulebook', async () => {
  const host = 'cdn.svc.asmodee.net';
  for (const file of ['src/games/star/content.ts', 'docs/STAR_WORKSHOP.md']) {
    assert.equal(allowedHost(host, file), true);
    assert.deepEqual(inspectFile(file, await readFile(new URL(`../${file}`, import.meta.url))).problems, [], file);
  }
  for (const file of ['README.md', 'deploy/apache.conf.example', 'src/server/app.ts', 'src/games/star/game.ts']) assert.equal(allowedHost(host, file), false);
});

test('limits heist provenance to its source content and rulebook', async () => {
  for (const host of ['www.eagle-gryphon.com', 'drive.google.com', 'faidutti.com']) {
    assert.equal(allowedHost(host, 'src/games/heist/content.ts'), true);
    assert.equal(allowedHost(host, 'docs/CURTAIN_HEIST.md'), host !== 'faidutti.com');
    for (const file of ['README.md', 'deploy/apache.conf.example', 'src/server/app.ts', 'src/games/heist/game.ts']) {
      assert.equal(allowedHost(host, file), false);
    }
  }
  for (const file of ['src/games/heist/content.ts', 'docs/CURTAIN_HEIST.md']) {
    assert.deepEqual(inspectFile(file, await readFile(new URL(`../${file}`, import.meta.url))).problems, [], file);
  }
});

test('limits banquet rules provenance to the exact source files and official hosts', async () => {
  const contentFile = 'src/games/banquet/content.ts', documentFile = 'docs/HUNDRED_GHOSTS.md';
  const publisher = 'www.rprod.com', distributor = 'cdn.svc.asmodee.net';
  for (const host of [publisher, distributor]) {
    assert.equal(allowedHost(host, contentFile), true);
    assert.deepEqual(inspect(contentFile, `const source = 'https://${host}/rules';`).problems, []);
    for (const file of ['README.md', 'docs/FOUR_GAME_ROLLOUT.md', 'deploy/apache.conf.example',
      'src/games/banquet/rules.ts', 'src/games/banquet/game.ts', 'src/games/post/content.ts',
      'src/client/BanquetRules.tsx', 'src/server/app.ts', `${contentFile}.backup`, `copy/${contentFile}`]) {
      assert.equal(allowedHost(host, file), false, `${host} must remain denied in ${file}`);
      assert.ok(inspect(file, `https://${host}/rules`).problems.includes('non-public-example URL host'));
    }
    for (const otherHost of [`mirror.${host}`, `${host}.${privateHost}`]) {
      assert.equal(allowedHost(otherHost, contentFile), false);
      assert.ok(inspect(contentFile, `https://${otherHost}/rules`).problems.includes('non-public-example URL host'));
    }
  }
  assert.equal(allowedHost(distributor, documentFile), true);
  assert.equal(allowedHost(publisher, documentFile), false);
  assert.deepEqual(inspect(documentFile, `Official rules: https://${distributor}/rules`).problems, []);
  assert.ok(inspect(contentFile, `https://${['person', 'password'].join(':')}@${publisher}/rules`).problems.includes('URL contains credentials'));
  for (const file of [contentFile, documentFile]) {
    const bytes = await readFile(new URL(`../${file}`, import.meta.url));
    assert.deepEqual(inspectFile(file, bytes).problems, [], file);
  }
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
