import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

const URL = 'https://github.com/cli/cli/releases/download/v2.65.0/gh_2.65.0_windows_amd64.zip';

console.log('Downloading GitHub CLI...');
const r = await fetch(URL, { redirect: 'follow' });
console.log('HTTP', r.status);
if (!r.ok) { console.error('Failed:', r.status, r.statusText); process.exit(1); }

const buf = Buffer.from(await r.arrayBuffer());
const zipPath = join(tmpdir(), 'gh-cli.zip');
writeFileSync(zipPath, buf);
console.log('Downloaded', buf.length, 'bytes to', zipPath);

// Extract using PowerShell Expand-Archive
import { execSync } from 'node:child_process';
const dest = join(tmpdir(), 'gh-cli-extracted');
if (existsSync(dest)) rmSync(dest, { recursive: true });
mkdirSync(dest, { recursive: true });
execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${dest}' -Force"`, { stdio: 'inherit' });

// Find gh.exe
import { readdirSync, statSync } from 'node:fs';
function findExe(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      const found = findExe(full);
      if (found) return found;
    } else if (entry === 'gh.exe') {
      return full;
    }
  }
  return null;
}
const ghExe = findExe(dest);
if (ghExe) {
  console.log('Found gh.exe at:', ghExe);
  // Copy to a stable location
  const binDir = join(homedir(), '.dsh', 'bin');
  mkdirSync(binDir, { recursive: true });
  const target = join(binDir, 'gh.exe');
  writeFileSync(target, await readFile(ghExe));
  console.log('Copied gh.exe to:', target);
} else {
  console.error('gh.exe not found in extracted archive');
  process.exit(1);
}

async function readFile(path) {
  const { readFileSync } = await import('node:fs');
  return readFileSync(path);
}
