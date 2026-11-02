// SPDX-License-Identifier: GPL-3.0-only
//
// The built page in a real browser engine (headless Chrome), with its
// Content-Security-Policy and Trusted Types on: the script runs and draws the
// first screen. The other tests use happy-dom, which ignores the CSP. Skipped
// when no Chrome is found (set CHROME_PATH to point at one).

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, test } from 'node:test';
import { buildPage } from '../scripts/build-page.ts';

function findChrome(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter((p): p is string => !!p);
  for (const p of candidates) if (existsSync(p)) return p;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const r = spawnSync('which', [name], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return null;
}

const chrome = findChrome();

describe('the built page in a real browser', { skip: chrome ? false : 'no Chrome found' }, () => {
  test('under its CSP and Trusted Types, the script runs and shows the 12 word boxes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'exit-page-'));
    const profile = join(dir, 'profile');
    mkdirSync(profile);
    const file = join(dir, 'index.html');
    writeFileSync(file, (await buildPage()).html);
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      `--user-data-dir=${profile}`,
      '--virtual-time-budget=5000',
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      '--dump-dom',
      pathToFileURL(file).href,
    ];
    const dom = execFileSync(chrome!, args, { encoding: 'utf8', timeout: 90_000, stdio: ['ignore', 'pipe', 'ignore'] });
    assert.equal((dom.match(/data-word="/gu) ?? []).length, 12, 'the first screen was drawn by the script');
    assert.ok(dom.includes('<h2>1. Type your 12 words</h2>'));
    assert.ok(!dom.includes('This page needs JavaScript'), 'the script replaced the fallback text');
  });
});
