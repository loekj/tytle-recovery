// SPDX-License-Identifier: GPL-3.0-only
//
// Copies the VERIFIED source of the deployed 14-day recovery module from
// Sourcify into contracts/, byte for byte, with the compiler settings it was
// verified with. Run once by hand; the files are committed.
//
//   node scripts/vendor-sources.ts          write contracts/
//   node scripts/vendor-sources.ts --check  compare contracts/ with Sourcify, write nothing
//
// Needs the network (Sourcify). CI does not run it: there the bytecode check
// proves the same thing offline, because every source's keccak256 is inside
// the contract's metadata hash, and that hash is inside the deployed bytes.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { keccak256, toBytes } from 'viem';
import { COMPILER_FILE, CONTRACTS_DIR, type CompilerFile } from './lib/solcInput.ts';
import { DEPLOYED_14_DAY_MODULE } from './lib/addresses.ts';

const SOURCIFY_URL =
  `https://sourcify.dev/server/v2/contract/100/${DEPLOYED_14_DAY_MODULE}` +
  '?fields=stdJsonInput,metadata,compilation,deployment';

interface SourcifyContract {
  match: string;
  creationMatch: string;
  runtimeMatch: string;
  matchId: string;
  verifiedAt: string;
  stdJsonInput: { language: string; sources: Record<string, { content: string }>; settings: CompilerFile['settings'] };
  metadata: { sources: Record<string, { keccak256: string; license?: string }> };
  compilation: { compilerVersion: string; fullyQualifiedName: string };
  deployment: { transactionHash: string; blockNumber: string; deployer: string };
}

const check = process.argv.includes('--check');

const res = await fetch(SOURCIFY_URL, { signal: AbortSignal.timeout(60_000) });
if (!res.ok) throw new Error(`Sourcify: HTTP ${res.status}`);
const sc = (await res.json()) as SourcifyContract;

if (sc.match !== 'exact_match' || sc.creationMatch !== 'exact_match' || sc.runtimeMatch !== 'exact_match') {
  throw new Error(`Sourcify does not report an exact match (match ${sc.match}, creation ${sc.creationMatch}, runtime ${sc.runtimeMatch})`);
}

const verified = new Map(Object.entries(sc.stdJsonInput.sources).map(([name, { content }]) => [name, content]));
const names = [...verified.keys()].sort();
const sources: CompilerFile['sources'] = {};
for (const name of names) {
  const content = verified.get(name) ?? '';
  const meta = sc.metadata.sources[name];
  if (!meta) throw new Error(`${name}: in the input but not in the metadata`);
  const hash = keccak256(toBytes(content));
  if (hash !== meta.keccak256) throw new Error(`${name}: keccak256 ${hash} is not the metadata's ${meta.keccak256}`);
  sources[name] = { keccak256: meta.keccak256, license: meta.license ?? null };
}

const compilerFile: CompilerFile = {
  _provenance: {
    what: 'The compiler input the deployed 14-day module was verified with (Sourcify exact match, creation and runtime).',
    sourcifyUrl: SOURCIFY_URL,
    sourcifyMatchId: sc.matchId,
    sourcifyVerifiedAt: sc.verifiedAt,
    deployment: sc.deployment,
  },
  compilerVersion: sc.compilation.compilerVersion,
  language: sc.stdJsonInput.language,
  compilationTarget: sc.compilation.fullyQualifiedName,
  settings: sc.stdJsonInput.settings,
  sources,
};

let differences = 0;
for (const name of names) {
  const file = path.join(CONTRACTS_DIR, name);
  const want = verified.get(name) ?? '';
  if (check) {
    const have = await readFile(file, 'utf8').catch(() => null);
    if (have !== want) {
      differences++;
      console.log(`DIFFERENT  ${name}`);
    } else console.log(`same       ${name}`);
  } else {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, want);
    console.log(`wrote      ${name}`);
  }
}

const compilerJson = JSON.stringify(compilerFile, null, 2) + '\n';
if (check) {
  const have = JSON.parse(await readFile(COMPILER_FILE, 'utf8')) as CompilerFile;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const key of ['compilerVersion', 'language', 'compilationTarget', 'settings', 'sources'] as const) {
    if (!same(have[key], compilerFile[key])) {
      differences++;
      console.log(`DIFFERENT  ${path.basename(COMPILER_FILE)}: ${key}`);
    }
  }
  console.log(differences === 0 ? 'contracts/ equals the verified source on Sourcify.' : `${differences} difference(s).`);
  process.exit(differences === 0 ? 0 : 1);
} else {
  await writeFile(COMPILER_FILE, compilerJson);
  console.log(`wrote      ${path.relative(process.cwd(), COMPILER_FILE)}`);
}
