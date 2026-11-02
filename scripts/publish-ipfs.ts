// SPDX-License-Identifier: GPL-3.0-only
//
// Puts the built exit page on IPFS through Pinata, then reads it back and
// checks it, byte for byte. CI runs it after the tests pass, in a job that
// installs no npm package. The same bytes always give the same address, so a
// second run is safe.
//
//   PINATA_JWT=... node scripts/publish-ipfs.ts [page, default dist/index.html]
//
// The token comes from the environment only. It is never printed or written.

import { appendFileSync } from 'node:fs';
import { confirmOnGateways, pinPage, readPage, summary } from './lib/ipfs.ts';

const path = process.argv[2] ?? 'dist/index.html';
const jwt = process.env.PINATA_JWT?.trim();
if (!jwt) {
  console.error('PINATA_JWT is not set. In CI it is the repository secret of that name.');
  process.exit(1);
}

const page = readPage(path);
console.log(`${page.sha256}  ${path}`);
const cid = await pinPage(page, { jwt, name: `exit-page ${process.env.GITHUB_SHA?.slice(0, 12) ?? 'local'}` });
console.log(`uploaded: ${cid}`);
const results = await confirmOnGateways(cid, page);
for (const r of results) console.log(`${r.ok ? 'read back' : 'not read back'}: ${r.name}: ${r.note}`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(cid, page, results));
console.log(`ipfs://${cid}`);
