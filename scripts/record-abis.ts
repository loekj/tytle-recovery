// SPDX-License-Identifier: GPL-3.0-only
//
// Reads the verified ABIs of the public contracts the exit page calls, from
// Sourcify, and writes them to abi/. No ABI here is written by hand.
//
//   node scripts/record-abis.ts
//
// The exit copy's own ABI (abi/SocialRecoveryModule.json) comes from our build
// instead (scripts/build-abi.ts).

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getAddress } from 'viem';
import { EURE_TOKEN, SAFE_L2_SINGLETON_141, SAFE_PROXY_FACTORY_141 } from './lib/addresses.ts';
import { abiJson } from './build-abi.ts';

interface SourcifyContract {
  match: string | null;
  abi?: unknown[];
  compilation?: { fullyQualifiedName: string; compilerVersion: string };
  proxyResolution?: { isProxy: boolean; proxyType: string | null; implementations: { address: string; name?: string }[] } | null;
}

/** What to record, by file name. A proxy's ABI is its implementation's. */
const ABIS: Record<string, { address: string; what: string; expectName: string }> = {
  SafeL2: {
    address: SAFE_L2_SINGLETON_141,
    what: 'Safe 1.4.1 SafeL2 singleton: the code every Tytle account runs (through a proxy)',
    expectName: 'contracts/SafeL2.sol:SafeL2',
  },
  SafeProxyFactory: {
    address: SAFE_PROXY_FACTORY_141,
    what: 'Safe 1.4.1 proxy factory (the tests make accounts with it)',
    expectName: 'contracts/proxies/SafeProxyFactory.sol:SafeProxyFactory',
  },
  EURe: {
    address: EURE_TOKEN,
    what: "Monerium EURe v2 on Gnosis (an ERC-1967 proxy): the token the accounts' euros are",
    expectName: 'src/GnosisControllerToken.sol:GnosisControllerToken',
  },
};

async function sourcify(address: string): Promise<SourcifyContract> {
  const url = `https://sourcify.dev/server/v2/contract/100/${address}?fields=abi,compilation,proxyResolution`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Sourcify ${address}: HTTP ${res.status}`);
  return (await res.json()) as SourcifyContract;
}

const sources: Record<string, unknown> = {};
for (const [name, c] of Object.entries(ABIS)) {
  const address = getAddress(c.address);
  let contract = await sourcify(address);
  let abiFrom = address;
  if (contract.proxyResolution?.isProxy) {
    const [impl, ...more] = contract.proxyResolution.implementations;
    if (!impl || more.length > 0) throw new Error(`${name}: expected one implementation behind ${address}`);
    abiFrom = getAddress(impl.address);
    contract = await sourcify(abiFrom);
  }
  if (contract.match !== 'exact_match') throw new Error(`${name}: ${abiFrom} is not an exact match on Sourcify (${contract.match})`);
  if (contract.compilation?.fullyQualifiedName !== c.expectName) {
    throw new Error(`${name}: ${abiFrom} is ${contract.compilation?.fullyQualifiedName}, expected ${c.expectName}`);
  }
  if (!contract.abi) throw new Error(`${name}: Sourcify gave no ABI`);
  await writeFile(fileURLToPath(new URL(`../abi/${name}.json`, import.meta.url)), abiJson(contract.abi));
  sources[name] = {
    what: c.what,
    address,
    ...(abiFrom !== address ? { implementation: abiFrom } : {}),
    sourcify: { match: contract.match, fullyQualifiedName: c.expectName, compilerVersion: contract.compilation.compilerVersion },
  };
  console.log(`${name.padEnd(17)} ${address}${abiFrom !== address ? ` (implementation ${abiFrom})` : ''}  ${contract.abi.length} entries`);
}

await writeFile(
  fileURLToPath(new URL('../abi/sources.json', import.meta.url)),
  JSON.stringify(
    {
      _provenance: 'Verified ABIs from Sourcify (chain 100), written by scripts/record-abis.ts. SocialRecoveryModule.json comes from our build.',
      abis: sources,
    },
    null,
    2,
  ) + '\n',
);
console.log('wrote abi/sources.json');
