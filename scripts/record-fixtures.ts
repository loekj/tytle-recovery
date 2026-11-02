// SPDX-License-Identifier: GPL-3.0-only
//
// Reads public chain data from Gnosis and writes it to fixtures/gnosis/, so the
// tests run with no network. Every read is asked of two public nodes, at one
// fixed block, and the two answers must be equal.
//
//   node scripts/record-fixtures.ts
//
// What it records, per contract: the address, its code at that block, the
// code's keccak256 and size. For the 14-day module and the exit copy also the
// transaction that created it. That transaction is a call to Safe's singleton
// factory (CREATE2): its input is a 32-byte salt, then the init code (creation
// code + constructor argument).

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getAddress, getCreate2Address, keccak256, numberToHex, slice, type Hex } from 'viem';
import {
  ARACHNID_DETERMINISTIC_DEPLOYER,
  COMPATIBILITY_FALLBACK_HANDLER_141,
  DEPLOYED_14_DAY_MODULE,
  DEPLOYED_14_DAY_MODULE_CREATION_TX,
  EXIT_MODULE_CREATION_TX,
  SAFE_4337_MODULE,
  SAFE_L2_SINGLETON_141,
  SAFE_PROXY_FACTORY_141,
  SAFE_SINGLETON_FACTORY,
} from './lib/addresses.ts';
import { PUBLIC_GNOSIS_NODES, assertGnosis, rpc, rpcOnTwo } from './lib/rpc.ts';
import type { GnosisFixture, RecordedContract } from '../test/support/fixtures.ts';
import { EXIT_MODULE } from '../page/src/config.ts';

const OUT = fileURLToPath(new URL('../fixtures/gnosis/contracts.json', import.meta.url));

/** Contracts to record, by name. The address is checked by having code. */
const CONTRACTS: Record<string, { address: string; what: string; creationTx?: Hex }> = {
  recoveryModule14Days: {
    address: DEPLOYED_14_DAY_MODULE,
    what: 'Candide SocialRecoveryModule v0.0.1, 14-day wait (the verified copy this repository reproduces)',
    creationTx: DEPLOYED_14_DAY_MODULE_CREATION_TX,
  },
  exitModule90Days: {
    address: EXIT_MODULE,
    what: 'The exit copy: Candide SocialRecoveryModule v0.0.1, 90-day wait (deployed by this repository)',
    creationTx: EXIT_MODULE_CREATION_TX,
  },
  safeSingletonFactory: {
    address: SAFE_SINGLETON_FACTORY,
    what: "Safe's singleton factory (CREATE2: input = salt + init code); it made the 14-day module",
  },
  arachnidDeterministicDeployer: {
    address: ARACHNID_DETERMINISTIC_DEPLOYER,
    what: 'The deterministic deployment proxy (same code as the Safe singleton factory); recorded for comparison',
  },
  safeL2Singleton141: {
    address: SAFE_L2_SINGLETON_141,
    what: 'Safe 1.4.1 SafeL2 singleton: the code a Tytle account runs through its proxy',
  },
  safeProxyFactory141: {
    address: SAFE_PROXY_FACTORY_141,
    what: 'Safe 1.4.1 proxy factory: the tests make accounts with it',
  },
  compatibilityFallbackHandler141: {
    address: COMPATIBILITY_FALLBACK_HANDLER_141,
    what: 'Safe 1.4.1 compatibility fallback handler (the Safe 4337 module inherits it)',
  },
  safe4337Module: {
    address: SAFE_4337_MODULE,
    what: "The Safe 4337 module: a Tytle account's module and fallback handler",
  },
};

const nodes = [PUBLIC_GNOSIS_NODES[0], PUBLIC_GNOSIS_NODES[1]] as const;
for (const url of nodes) await assertGnosis(url);

// A block both nodes surely have: a little behind the first node's head.
const head = Number(await rpc<Hex>(nodes[0], 'eth_blockNumber'));
const blockNumber = head - 20;
const block = numberToHex(blockNumber);

const contracts: Record<string, RecordedContract> = {};
for (const [name, c] of Object.entries(CONTRACTS)) {
  const address = getAddress(c.address);
  const code = await rpcOnTwo<Hex>(nodes, 'eth_getCode', [address, block]);
  if (code === '0x') throw new Error(`${name}: no code at ${address} on Gnosis at block ${blockNumber}`);
  const recorded: RecordedContract = {
    what: c.what,
    address,
    codeKeccak256: keccak256(code),
    codeBytes: (code.length - 2) / 2,
    code,
  };
  if (c.creationTx) {
    const tx = await rpcOnTwo<{ input: Hex; to: string | null; from: string; blockNumber: Hex }>(nodes, 'eth_getTransactionByHash', [c.creationTx]);
    const receipt = await rpcOnTwo<{ contractAddress: string | null; status: Hex }>(nodes, 'eth_getTransactionReceipt', [c.creationTx]);
    if (receipt.status !== '0x1') throw new Error(`${name}: ${c.creationTx} failed`);
    // Which address the transaction made: a direct creation names it in the receipt; a call to a CREATE2
    // factory does not, so compute it from the factory, the salt and the init code.
    let created: string | null;
    if (tx.to === null) created = receipt.contractAddress;
    else if ([SAFE_SINGLETON_FACTORY, ARACHNID_DETERMINISTIC_DEPLOYER].includes(getAddress(tx.to))) {
      created = getCreate2Address({ from: getAddress(tx.to), salt: slice(tx.input, 0, 32), bytecode: slice(tx.input, 32) });
    } else throw new Error(`${name}: ${c.creationTx} calls ${tx.to}, which is not a known CREATE2 factory`);
    if (!created || getAddress(created) !== address) throw new Error(`${name}: ${c.creationTx} made ${created}, not ${address}`);
    recorded.creation = {
      transactionHash: c.creationTx,
      blockNumber: Number(tx.blockNumber),
      from: getAddress(tx.from),
      to: tx.to === null ? null : getAddress(tx.to),
      input: tx.input,
      inputKeccak256: keccak256(tx.input),
    };
  }
  contracts[name] = recorded;
  console.log(`${name.padEnd(24)} ${address}  ${recorded.codeBytes} bytes  ${recorded.codeKeccak256}`);
}

// The exit copy's address was empty in the block before its deploy. So the page's account search starts at the
// deploy block: no record of the exit copy can be older.
const emptyAddresses: GnosisFixture['emptyAddresses'] = {};
const deployBlock = contracts.exitModule90Days!.creation!.blockNumber;
const before = await rpcOnTwo<Hex>(nodes, 'eth_getCode', [EXIT_MODULE, numberToHex(deployBlock - 1)]);
if (before !== '0x') throw new Error(`exitModule: ${EXIT_MODULE} already held code at block ${deployBlock - 1}`);
emptyAddresses.exitModule = { address: EXIT_MODULE, blockNumber: deployBlock - 1 };
console.log(`${'exitModule'.padEnd(24)} ${EXIT_MODULE}  empty at block ${deployBlock - 1}, deployed in block ${deployBlock}`);

const fixture: GnosisFixture = {
  _provenance: {
    what: 'Public chain data read from Gnosis with eth_getCode / eth_getTransactionByHash; written by scripts/record-fixtures.ts',
    recordedAt: new Date().toISOString(),
    chainId: 100,
    blockNumber,
    nodes: [...nodes],
  },
  contracts,
  emptyAddresses,
};

await mkdir(fileURLToPath(new URL('../fixtures/gnosis/', import.meta.url)), { recursive: true });
await writeFile(OUT, JSON.stringify(fixture, null, 2) + '\n');
console.log(`wrote fixtures/gnosis/contracts.json (block ${blockNumber})`);
