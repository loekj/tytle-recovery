// SPDX-License-Identifier: GPL-3.0-only
//
// Puts the built exit page on IPFS through Pinata, and proves that IPFS holds
// exactly that file: Pinata's address must be the one computed here from the
// built bytes, and every block is read back and compared. CI runs it after the
// tests pass, in a job that installs no npm package. The same bytes always give
// the same address, so a second run is safe.
//
//   PINATA_JWT=... node scripts/publish-ipfs.ts [page, default dist/index.html]
//   node scripts/publish-ipfs.ts --cid [page]     only print the page's IPFS address (no token, no network)
//
// The token comes from the environment only. It is never printed or written.

import { appendFileSync } from 'node:fs';
import { confirmBlocks, findProviders, pinPage, readPage, summary } from './lib/ipfs.ts';

const onlyCid = process.argv[2] === '--cid';
const path = process.argv[onlyCid ? 3 : 2] ?? 'dist/index.html';
const page = readPage(path);
console.log(`${page.sha256}  ${path}`);
console.log(`IPFS address (computed from the file): ${page.cid}`);
if (onlyCid) process.exit(0);

const jwt = process.env.PINATA_JWT?.trim();
if (!jwt) {
  console.error('PINATA_JWT is not set. In CI it is the repository secret of that name.');
  process.exit(1);
}

const cid = await pinPage(page, { jwt, name: `exit-page ${process.env.GITHUB_SHA?.slice(0, 12) ?? 'local'}` });
console.log(`uploaded: ${cid}, the same address`);
const blocks = await confirmBlocks(page);
console.log(`read back: ${blocks}`);
const routing = await findProviders(cid);
console.log(`IPFS routing: ${routing.note}`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(page, blocks, routing));
console.log(`ipfs://${cid}`);
console.log(`https://inbrowser.link/ipfs/${cid}`);
