// SPDX-License-Identifier: GPL-3.0-only
//
// The page without a chain: its pinned facts, its texts, its build and its
// security rules.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { keccak256, toFunctionSelector, toHex, type AbiFunction } from 'viem';
import { EXIT_MODULE_CREATION_TX, RECOVERY_PERIOD_90_DAYS } from '../scripts/lib/addresses.ts';
import { runtimeCode } from '../scripts/lib/build.ts';
import { buildPage } from '../scripts/build-page.ts';
import { exitModuleDeployment } from '../scripts/lib/exitModule.ts';
import { EURE_ABI } from '../page/src/abi.ts';
import { EXIT_MODULE, EXIT_MODULE_CODE_KECCAK256, EXIT_MODULE_SEARCH_FROM_BLOCK, NODES } from '../page/src/config.ts';
import { formatEuro } from '../page/src/format.ts';
import { LOCALES } from '../page/src/i18n/index.ts';
import { SAFE_TX_TYPES } from '../page/src/safeTx.ts';
import { loadGnosisFixture } from './support/fixtures.ts';
import { TEST_TOKEN_ABI, cachedModuleBuild } from './support/world.ts';

const PAGE_SRC = fileURLToPath(new URL('../page/src/', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = `${dir}${f}`;
    return statSync(p).isDirectory() ? files(`${p}/`) : [p];
  });
}

describe('the pinned facts', () => {
  test("the exit copy's address and code hash are the ones our build gives", async () => {
    const build = await cachedModuleBuild();
    assert.equal(exitModuleDeployment(build).address, EXIT_MODULE);
    assert.equal(keccak256(runtimeCode(build, RECOVERY_PERIOD_90_DAYS)), EXIT_MODULE_CODE_KECCAK256);
  });

  test('the account search starts at the recorded deploy block; the exit address was empty in the block before', () => {
    const fixture = loadGnosisFixture();
    const deployed = fixture.contracts.exitModule90Days;
    assert.ok(deployed?.creation, 'the fixture records the exit copy and its deploy');
    assert.equal(deployed.address, EXIT_MODULE);
    assert.equal(deployed.codeKeccak256, EXIT_MODULE_CODE_KECCAK256);
    assert.equal(deployed.creation.transactionHash, EXIT_MODULE_CREATION_TX);
    assert.equal(BigInt(deployed.creation.blockNumber), EXIT_MODULE_SEARCH_FROM_BLOCK);
    const empty = fixture.emptyAddresses.exitModule;
    assert.ok(empty, 'the fixture records the exit address as empty before the deploy');
    assert.equal(empty.address, EXIT_MODULE);
    assert.equal(BigInt(empty.blockNumber), EXIT_MODULE_SEARCH_FROM_BLOCK - 1n);
  });

  test("the test token has EURe's selectors for balanceOf and transfer", () => {
    for (const name of ['balanceOf', 'transfer']) {
      const eure = EURE_ABI.find((e) => e.type === 'function' && e.name === name) as AbiFunction;
      const token = TEST_TOKEN_ABI.find((e) => e.type === 'function' && e.name === name) as AbiFunction;
      assert.equal(toFunctionSelector(token), toFunctionSelector(eure));
    }
  });

  test("the SafeTx type hashes to Safe 1.4.1's SAFE_TX_TYPEHASH (verified Safe.sol)", () => {
    const fields = SAFE_TX_TYPES.SafeTx.map((f) => `${f.type} ${f.name}`).join(',');
    assert.equal(keccak256(toHex(`SafeTx(${fields})`)), '0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8');
    assert.equal(keccak256(toHex('EIP712Domain(uint256 chainId,address verifyingContract)')), '0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218');
  });
});

describe('the texts', () => {
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/gu)].map((m) => m[1]).sort();

  test('every language has every text, with the same {values}', () => {
    const keys = Object.keys(LOCALES.en).sort();
    for (const [locale, messages] of Object.entries(LOCALES)) {
      assert.deepEqual(Object.keys(messages).sort(), keys, locale);
      for (const k of keys) {
        const s = messages[k as keyof typeof messages];
        assert.ok(s.trim().length > 0, `${locale}.${k} is empty`);
        assert.deepEqual(placeholders(s), placeholders(LOCALES.en[k as keyof typeof LOCALES.en]), `${locale}.${k}`);
      }
    }
  });

  test('no text has an em-dash', () => {
    for (const [locale, messages] of Object.entries(LOCALES)) {
      for (const [k, s] of Object.entries(messages)) assert.ok(!s.includes('—'), `${locale}.${k}`);
    }
  });

  test('money in each language, rounded down to the cent', () => {
    const amount = 2_340_009_999_999_999_999_999n; // 2340.009999... EURe
    const plain = (s: string) => s.replace(/\s/gu, ' ');
    assert.equal(plain(formatEuro(amount, 'en-GB')), '€2,340.00');
    assert.equal(plain(formatEuro(amount, 'pt-PT')), '2340,00 €');
    assert.equal(plain(formatEuro(amount, 'pt-BR')), '€ 2.340,00');
    assert.equal(plain(formatEuro(amount, 'es-ES')), '2340,00 €');
  });
});

describe('the build and its security rules', () => {
  test('the page is one file: script and style inline, allowed only by their hashes', async () => {
    const { html, csp } = await buildPage();
    const script = /<script>([\s\S]*)<\/script>/u.exec(html)?.[1];
    const style = /<style>([\s\S]*?)<\/style>/u.exec(html)?.[1];
    assert.ok(script && style);
    const b64 = (s: string) => createHash('sha256').update(s, 'utf8').digest('base64');
    assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="${csp}">`));
    assert.ok(csp.includes(`script-src 'sha256-${b64(script)}'`));
    assert.ok(csp.includes(`style-src 'sha256-${b64(style)}'`));
    assert.match(csp, /^default-src 'none'; /u);
    for (const rule of ["form-action 'none'", "base-uri 'none'", "img-src 'none'", "require-trusted-types-for 'script'"]) assert.ok(csp.includes(rule), rule);
    assert.ok(!csp.includes('frame-src') && !csp.includes('unsafe'), 'no frames, nothing unsafe');
    assert.equal(/connect-src ([^;]*)/u.exec(csp)?.[1], [...NODES, 'http://localhost:*', 'https://localhost:*', 'http://127.0.0.1:*', 'https://127.0.0.1:*'].join(' '));
    assert.ok(!/<script[^>]+src=|<link\b|<img\b|<iframe\b/iu.test(html), 'no file from anywhere else');
  });

  test('every copy of the one file carries the licences: in a comment at its end, the same text as licenses.txt', async () => {
    const { html, licenses, packages } = await buildPage();
    assert.ok(html.endsWith(`<!--\n${licenses}-->\n</body>\n</html>\n`));
    for (const p of packages) assert.ok(licenses.includes(`\n${p} (`), p);
  });

  test('two builds are byte for byte the same', async () => {
    const [a, b] = [await buildPage(), await buildPage()];
    assert.equal(a.html, b.html);
    assert.equal(a.sha256, b.sha256);
  });

  test('the bundled packages are exactly these', async () => {
    const { packages } = await buildPage();
    assert.deepEqual(
      packages.map((p) => p.replace(/@[^@]+$/u, '')),
      ['@noble/curves', '@noble/hashes', '@scure/base', '@scure/bip32', '@scure/bip39', 'abitype', 'ox', 'uqr', 'viem'],
    );
  });

  test('the page code never stores, sends or evaluates anything itself', () => {
    const forbidden = /localStorage|sessionStorage|indexedDB|document\.cookie|\.innerHTML|outerHTML|insertAdjacentHTML|\beval\(|new Function|\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|navigator\.clipboard/u;
    for (const f of files(PAGE_SRC)) {
      const src = readFileSync(f, 'utf8');
      assert.ok(!forbidden.test(src), `${f.slice(PAGE_SRC.length)}: ${forbidden.exec(src)?.[0]}`);
    }
  });
});
