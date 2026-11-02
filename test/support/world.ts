// SPDX-License-Identifier: GPL-3.0-only
//
// A local Gnosis for the page's tests: the recorded Safe 1.4.1 contracts, the
// Safe 4337 module and the 14-day module at their real addresses, a test token
// at the EURe address, and the exit copy deployed from our own build through
// the factory (so at its real address). Accounts are set up the way a Tytle
// account is: one owner, threshold 1, the Safe 4337 module as module and
// fallback handler, the 14-day copy with Tytle's guardian, and the exit copy
// with the words' first address as its only guardian.

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodeFunctionData, getAddress, parseAbi, parseEventLogs, zeroAddress, type Address, type Hex } from 'viem';
import proxyFactoryAbi from '../../abi/SafeProxyFactory.json' with { type: 'json' };
import safeAbi from '../../abi/SafeL2.json' with { type: 'json' };
import moduleAbi from '../../abi/SocialRecoveryModule.json' with { type: 'json' };
import {
  DEPLOYED_14_DAY_MODULE,
  SAFE_4337_MODULE,
  SAFE_L2_SINGLETON_141,
  SAFE_PROXY_FACTORY_141,
} from '../../scripts/lib/addresses.ts';
import { buildModule, type ModuleBuild } from '../../scripts/lib/build.ts';
import { sendDeploy } from '../../scripts/lib/deploy.ts';
import { exitModuleDeployment } from '../../scripts/lib/exitModule.ts';
import { readStandardJsonInput } from '../../scripts/lib/solcInput.ts';
import { Chain, nodeFromProvider } from '../../page/src/chain.ts';
import { EURE, EXIT_MODULE } from '../../page/src/config.ts';
import { execTransactionArgs, plainCall, safeTxTypedData } from '../../page/src/safeTx.ts';
import { startLocalChain, type LocalChain } from './localChain.ts';

/** BIP-39 test vectors (valid checksums): never real money. */
export const WORDS_A = 'legal winner thank year wave sausage worth useful legal winner thank yellow'.split(' ');
export const WORDS_B = 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above'.split(' ');

const CACHE_DIR = fileURLToPath(new URL('../../cache/test-build/', import.meta.url));

/**
 * The module build, compiled once and kept in cache/ (ignored by git) under the hash of its exact compiler input.
 * The bytecode test always compiles fresh; these tests only need a deployable copy, and the deploy checks its code
 * against the build and the page checks it against its pinned hash.
 */
export async function cachedModuleBuild(): Promise<ModuleBuild> {
  const { input } = await readStandardJsonInput();
  const solcVersion = (createRequire(import.meta.url)('solc') as { version(): string }).version();
  const key = createHash('sha256').update(solcVersion).update(JSON.stringify(input)).digest('hex');
  const file = `${CACHE_DIR}${key}.json`;
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as ModuleBuild;
  const build = await buildModule();
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(build));
  return build;
}

const compiled = new Map<string, Hex>();

/** The runtime code of a test contract in test/contracts/ (no constructor runs: the tests place it with setCode). */
export function testContractCode(file: string, name: string): Hex {
  const key = `${file}:${name}`;
  const cached = compiled.get(key);
  if (cached) return cached;
  const solc = createRequire(import.meta.url)('solc') as { compile(input: string): string };
  const source = readFileSync(fileURLToPath(new URL(`../contracts/${file}`, import.meta.url)), 'utf8');
  const out = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: 'Solidity',
        sources: { [file]: { content: source } },
        settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['evm.deployedBytecode.object'] } } },
      }),
    ),
  ) as { errors?: { severity: string; formattedMessage: string }[]; contracts: Record<string, Record<string, { evm: { deployedBytecode: { object: string } } }>> };
  const errors = (out.errors ?? []).filter((e) => e.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((e) => e.formattedMessage).join('\n'));
  const code: Hex = `0x${out.contracts[file]![name]!.evm.deployedBytecode.object}`;
  compiled.set(key, code);
  return code;
}

/** The test token's runtime code (test/contracts/TestToken.sol). */
export function testTokenCode(): Hex {
  return testContractCode('TestToken.sol', 'TestToken');
}

export const TEST_TOKEN_ABI = parseAbi([
  'function mint(address to, uint256 amount)',
  'function balanceOf(address who) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);

export interface World extends LocalChain {
  /** The page's chain over the local chain, as two "nodes". */
  pageChain: Chain;
  build: ModuleBuild;
}

export async function startWorld<L extends LocalChain = LocalChain>(start: () => Promise<L> = startLocalChain as () => Promise<L>): Promise<World & L> {
  const local = await start();
  for (const name of ['safeSingletonFactory', 'recoveryModule14Days', 'safeL2Singleton141', 'safeProxyFactory141', 'compatibilityFallbackHandler141', 'safe4337Module']) {
    await local.place(name);
  }
  await local.test.setCode({ address: EURE, bytecode: testTokenCode() });
  const build = await cachedModuleBuild();
  const deployer = local.accounts[19] ?? local.accounts.at(-1)!;
  const d = exitModuleDeployment(build);
  if (d.address !== EXIT_MODULE) throw new Error('the build does not give the page configured exit copy address');
  await sendDeploy(local.client, local.walletFor(deployer), d);
  const provider = local.provider;
  return {
    ...local,
    build,
    pageChain: new Chain([nodeFromProvider('local node A', provider), nodeFromProvider('local node B', provider)]),
  };
}

/** Run one call as the account's owner: a Safe transaction signed by the owner (EIP-712) and sent by the owner. */
export async function execAsOwner(w: World, safe: Address, owner: Address, to: Address, data: Hex): Promise<void> {
  const nonce = (await w.client.readContract({ address: safe, abi: safeAbi, functionName: 'nonce' })) as bigint;
  const tx = plainCall(to, data, nonce);
  const signature = await w.walletFor(owner).signTypedData({ account: owner, ...safeTxTypedData(safe, tx) });
  const hash = await w.walletFor(owner).writeContract({ address: safe, abi: safeAbi, functionName: 'execTransaction', args: execTransactionArgs(tx, signature), account: owner });
  const receipt = await w.client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('owner transaction failed');
}

let saltNonce = 0n;

export interface AccountSetup {
  /** The passkey's stand-in: a local test account. */
  owner: Address;
  /** The words' first address, the exit copy's only guardian. Omit for an account without the exit copy. */
  exitGuardian?: Address;
  /** Tytle's guardian on the 14-day copy. */
  tytleGuardian: Address;
  eure?: bigint;
  /** false: leave the exit copy off (the account checks). */
  enableExitCopy?: boolean;
}

/** A Tytle-like account. Returns its address. */
export async function makeAccount(w: World, s: AccountSetup): Promise<Address> {
  const setup = encodeFunctionData({
    abi: safeAbi,
    functionName: 'setup',
    args: [[s.owner], 1n, zeroAddress, '0x', SAFE_4337_MODULE, zeroAddress, 0n, zeroAddress],
  });
  saltNonce += 1n;
  const hash = await w.walletFor(s.owner).writeContract({
    address: getAddress(SAFE_PROXY_FACTORY_141),
    abi: proxyFactoryAbi,
    functionName: 'createProxyWithNonce',
    args: [getAddress(SAFE_L2_SINGLETON_141), setup, saltNonce],
    account: s.owner,
  });
  const receipt = await w.client.waitForTransactionReceipt({ hash });
  const [created] = parseEventLogs({ abi: proxyFactoryAbi, eventName: 'ProxyCreation', logs: receipt.logs }) as unknown as { args: { proxy: Address } }[];
  if (!created) throw new Error('no ProxyCreation');
  const safe = getAddress(created.args.proxy);
  const call = (functionName: string, args: readonly unknown[], abi: unknown = safeAbi) =>
    encodeFunctionData({ abi: abi as typeof safeAbi, functionName, args } as Parameters<typeof encodeFunctionData>[0]);
  await execAsOwner(w, safe, s.owner, safe, call('enableModule', [SAFE_4337_MODULE]));
  await execAsOwner(w, safe, s.owner, safe, call('enableModule', [getAddress(DEPLOYED_14_DAY_MODULE)]));
  await execAsOwner(w, safe, s.owner, getAddress(DEPLOYED_14_DAY_MODULE), call('addGuardianWithThreshold', [s.tytleGuardian, 1n], moduleAbi));
  if (s.enableExitCopy !== false) {
    await execAsOwner(w, safe, s.owner, safe, call('enableModule', [EXIT_MODULE]));
    if (s.exitGuardian) await execAsOwner(w, safe, s.owner, EXIT_MODULE, call('addGuardianWithThreshold', [s.exitGuardian, 1n], moduleAbi));
  }
  if (s.eure) {
    const mint = await w.walletFor(s.owner).writeContract({ address: EURE, abi: TEST_TOKEN_ABI, functionName: 'mint', args: [safe, s.eure], account: s.owner });
    await w.client.waitForTransactionReceipt({ hash: mint });
  }
  return safe;
}

/** Give an address some xDAI on the local chain (the fee). */
export async function fund(w: World, to: Address, wei: bigint): Promise<void> {
  const hash = await w.walletFor(w.accounts[0]!).sendTransaction({ to, value: wei, account: w.accounts[0]! });
  await w.client.waitForTransactionReceipt({ hash });
}

/** Move the chain's clock and mine a block, so the new time is the latest block's time. */
export async function passTime(w: World, seconds: bigint): Promise<void> {
  await w.test.increaseTime({ seconds: Number(seconds) });
  await w.test.mine({ blocks: 1 });
}
