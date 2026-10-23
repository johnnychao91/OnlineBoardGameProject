import { execFileSync } from 'node:child_process';
import { isUtf8 } from 'node:buffer';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This is a guard against accidental publication, not a full secret scanner.
// Keep deployment addresses in private environment / Apache configuration files.
// Git history, remote caches, and text inside images need separate review.
const publicSourceHosts = new Set([
  'boardgame.io', 'github.com', 'httpd.apache.org', 'nodejs.org',
  'letsencrypt.org', 'eff-certbot.readthedocs.io', 'socket.io',
]);
// These hosts occur in npm package metadata. Do not permit them in deployment files.
const lockfileHosts = new Set([
  'registry.npmjs.org', 'opencollective.com', 'tidelift.com',
  'github.com', 'dotenvx.com', 'feross.org', 'ko-fi.com',
  'paulmillr.com', 'www.patreon.com',
]);
const metadataHostFiles = new Set([
  'package-lock.json', 'scripts/check-public-repo.mjs', 'scripts/check-public-repo.test.mjs',
]);

export function allowedHost(input, file) {
  const host = input.toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
  // Rules provenance only; this is never an allowed deployment target.
  if (['docs/BLACK_FOG.md', 'scripts/check-public-repo.mjs', 'scripts/check-public-repo.test.mjs'].includes(file)
    && host === 'indieboardsandcards.com') return true;
  if (['docs/TURING_TEST.md', 'scripts/check-public-repo.mjs', 'scripts/check-public-repo.test.mjs'].includes(file)
    && host === 'andyventure.com') return true;
  if (['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) return true;
  if (/(?:^|\.)example\.(?:com|org|net)$/.test(host)) return true;
  if (/(?:^|\.)(?:example|test|invalid|localhost)$/.test(host)) return true;
  return publicSourceHosts.has(host) || (metadataHostFiles.has(file) && lockfileHosts.has(host));
}

function privatePath(file) {
  const normalized = file.replaceAll('\\', '/');
  const name = path.posix.basename(normalized).toLowerCase();
  if (name !== '.env.example' && (/^\.env(?:\.|$)/.test(name) || /\.env$/.test(name))) return true;
  if (/^deploy\/.*\.local(?:\.|$)/i.test(normalized)) return true;
  if (/(?:^|\/)(?:data|backups?|credentials|secrets|\.ssh|\.aws|\.qa|\.git)(?:\/|$)/i.test(normalized)) return true;
  if (/(?:\.pem|\.key|\.p12|\.pfx|\.sqlite3?|\.db|\.log|\.tar|\.tgz|\.zip|\.gz)$/i.test(name)) return true;
  return /^(?:id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|credentials(?:\..*)?|private[-_]?key(?:\..*)?|service[-_]?account(?:\..*)?)$/i.test(name);
}

const secretRules = [
  ['private key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['Google API key', /\bAIza[A-Za-z0-9_-]{35}\b/],
  ['Google OAuth token', /\bya29\.[A-Za-z0-9_-]{40,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
];

/** Inspect a tracked file without including matched values in diagnostics. */
export function inspectFile(file, bytes) {
  const problems = new Set();
  if (privatePath(file)) problems.add('private/runtime file must not be tracked');
  if (bytes.includes(0) || !isUtf8(bytes)) return { problems: [...problems], binary: true };
  const content = bytes.toString('utf8');
  for (const [label, pattern] of secretRules) {
    if (pattern.test(content)) problems.add(label);
  }
  // Parse literal URL authorities only; runtime interpolation is deliberately
  // supplied through private configuration rather than a published hostname.
  for (const match of content.matchAll(/\bhttps?:\/\/([a-z0-9.:[\]@_%+-]+)/gi)) {
    const authority = match[1];
    if (authority.includes('@')) problems.add('URL contains credentials');
    try {
      if (!allowedHost(new URL(`https://${authority}`).hostname, file)) problems.add('non-public-example URL host');
    } catch {
      problems.add('unrecognized literal URL host');
    }
  }
  // Also catch bare addresses copied into prose, DNS examples, or shell commands.
  // The targeted contexts below cover any TLD in Apache/certificate settings.
  const proseOrConfig = /(?:\.(?:md|txt|html?|sh|ya?ml|toml|service)|\.conf(?:\.example)?|(?:^|\/)\.env(?:\.example)?)$/i.test(file);
  const bareContent = proseOrConfig
    ? content.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    : [...content.matchAll(/(['"`])([a-z0-9.-]+)\1/gi)].map((match) => match[2]).join('\n');
  // Object members such as instance.app and npm package names are not addresses.
  // Lockfile URLs remain covered above; bare package names are intentionally skipped.
  if (file !== 'package-lock.json') {
    for (const match of bareContent.matchAll(/\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|org|net|online|io|dev|app|co|tw|cn|uk|us|info|biz|xyz|site|cloud|tech|me|cc)\b/gi)) {
      if (!allowedHost(match[0], file)) problems.add('non-public-example bare hostname');
    }
  }
  for (const match of content.matchAll(/^\s*(?:ServerName|ServerAlias)\s+([^\r\n#]+)/gim)) {
    for (const candidate of match[1].trim().split(/\s+/)) {
      if (candidate.startsWith('${')) continue;
      const host = candidate.replace(/:\d+$/, '');
      if (!allowedHost(host, file)) problems.add('non-public-example Apache hostname');
    }
  }
  for (const match of content.matchAll(/\/etc\/letsencrypt\/live\/([^/\s"'`]+)/g)) {
    if (!match[1].startsWith('$') && !allowedHost(match[1], file)) problems.add('non-public-example certificate hostname');
  }
  return { problems: [...problems], binary: false };
}

/** Check current tracked working files, not ignored files or historical objects. */
export async function checkRepository(directory = process.cwd()) {
  const root = path.resolve(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: directory, encoding: 'utf8' }).trim());
  const tracked = execFileSync('git', ['ls-files', '-z', '--cached'], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  }).split('\0').filter(Boolean);
  const findings = [];
  const binaryFiles = [];
  let scanned = 0;
  for (const file of new Set(tracked)) {
    const absolute = path.resolve(root, file);
    if (!absolute.startsWith(`${root}${path.sep}`)) {
      findings.push({ file, problems: ['path is outside repository'] });
      continue;
    }
    try {
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) {
        findings.push({ file, problems: ['tracked symlink requires manual review'] });
        continue;
      }
      const result = inspectFile(file, await readFile(absolute));
      scanned += 1;
      if (result.problems.length) findings.push({ file, problems: result.problems });
      if (result.binary) binaryFiles.push(file);
    } catch (error) {
      // A tracked file deleted in the working tree has no contents to publish.
      if (error.code !== 'ENOENT') findings.push({ file, problems: ['could not inspect tracked file'] });
    }
  }
  return { scanned, findings, binaryFiles };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await checkRepository();
    for (const finding of result.findings) {
      console.error(`${JSON.stringify(finding.file)}: ${finding.problems.join('; ')}`);
    }
    console.log(`Public repository check: ${result.scanned} tracked files, ${result.findings.length} flagged files.`);
    console.log(`Binary contents skipped: ${result.binaryFiles.length}; inspect images manually (no OCR). This check does not scan Git history or remote caches.`);
    process.exitCode = result.findings.length ? 1 : 0;
  } catch {
    console.error('Could not inspect repository. Run this command inside a Git working tree.');
    process.exitCode = 1;
  }
}
