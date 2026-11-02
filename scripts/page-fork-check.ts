// SPDX-License-Identifier: GPL-3.0-only
//
// The exit, through the page's own code, on a local fork of Gnosis: the real
// Safe 1.4.1 contracts, the real 14-day copy, the real Safe 4337 module and the
// real EURe v2 token (not a test token). Sends nothing to Gnosis: the fork lives
// in this process.
//
//   node scripts/page-fork-check.ts [--rpc <url>] [--holder <address with EURe>]
//
// Steps: deploy the exit copy on the fork, make a Tytle-like account, move some
// real EURe into it from a holder (impersonated on the fork), start, wait 90
// days, finish, send the whole balance. Then compare the balances on EURe v2 and
// on the v1 address, which forwards to v2.

import { parseArgs } from 'node:util';
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  custom,
  formatUnits,
  getAddress,
  parseEther,
  parseUnits,
  type Address,
  type EIP1193Provider,
  type PublicClient,
} from 'viem';
import { gnosis } from 'viem/chains';
import { EURE_ABI } from '../page/src/abi.ts';
import { Chain, nodeFromProvider } from '../page/src/chain.ts';
import { EURE } from '../page/src/config.ts';
import { finishTakeOver, readAccount, startTakeOver } from '../page/src/exit.ts';
import { chooseSendPath, signWithKey } from '../page/src/send.ts';
import { deriveAccounts } from '../page/src/words.ts';
import { RECOVERY_PERIOD_90_DAYS } from './lib/addresses.ts';
import { readDeployState, sendDeploy } from './lib/deploy.ts';
import { exitModuleDeployment } from './lib/exitModule.ts';
import { PUBLIC_GNOSIS_NODES } from './lib/rpc.ts';
import { cachedModuleBuild, makeAccount, type World } from '../test/support/world.ts';

const EURE_V1 = getAddress('0xcB444e90D8198415266c6a2724b7900fb12FC56E');
const WORDS = 'legal winner thank year wave sausage worth useful legal winner thank yellow'.split(' ');

const { values: args } = parseArgs({
  options: {
    rpc: { type: 'string', default: PUBLIC_GNOSIS_NODES[0] },
    // A large public EURe holder on Gnosis (read on the chain before use).
    holder: { type: 'string', default: '0xBA12222222228d8Ba445958a75a0704d566BF2C8' },
  },
});

const { network } = await import('hardhat');
const connection = await network.create({ network: 'gnosisFork', override: { forking: { url: args.rpc! } } });
try {
  const provider = connection.provider as unknown as EIP1193Provider;
  const transport = custom(provider);
  const client = createPublicClient({ chain: gnosis, transport }) as PublicClient;
  const test = createTestClient({ chain: gnosis, mode: 'hardhat', transport });
  const accounts = ((await provider.request({ method: 'eth_accounts' })) as string[]).map((a) => getAddress(a));
  console.log(`fork of ${args.rpc} at block ${await client.getBlockNumber()}`);
  // The fork knows no hardfork history for Gnosis: mine one local block first (see deploy-exit-module.ts).
  await provider.request({ method: 'evm_mine' } as never);

  const build = await cachedModuleBuild();
  const d = exitModuleDeployment(build);
  const walletFor = (address: Address) => createWalletClient({ account: address, chain: gnosis, transport });
  if ((await readDeployState(client, d)).kind === 'not-deployed') await sendDeploy(client, walletFor(accounts[0]!), d);
  console.log(`exit copy on the fork at ${d.address}`);

  const w = {
    provider,
    client,
    test,
    accounts,
    walletFor,
    place: async () => {
      throw new Error('not on a fork');
    },
    close: async () => undefined,
    build,
    pageChain: new Chain([nodeFromProvider('fork A', provider), nodeFromProvider('fork B', provider)]),
  } as unknown as World;

  const keys = deriveAccounts(WORDS);
  const [owner, tytleGuardian, destination] = [accounts[2]!, accounts[3]!, accounts[8]!];
  const safe = await makeAccount(w, { owner, exitGuardian: keys.guardian.address, tytleGuardian });
  console.log(`a Tytle-like account on the fork: ${safe}`);

  // Real EURe into the account, from a holder impersonated on the fork.
  const holder = getAddress(args.holder!);
  const amount = parseUnits('123.45', 18);
  const held = (await client.readContract({ address: EURE, abi: EURE_ABI, functionName: 'balanceOf', args: [holder] })) as bigint;
  if (held < amount) throw new Error(`${holder} holds only ${formatUnits(held, 18)} EURe; pass --holder`);
  await test.impersonateAccount({ address: holder });
  await test.setBalance({ address: holder, value: parseEther('1') });
  const move = await walletFor(holder).writeContract({ address: EURE, abi: EURE_ABI, functionName: 'transfer', args: [safe, amount], account: holder });
  await client.waitForTransactionReceipt({ hash: move });
  await test.stopImpersonatingAccount({ address: holder });
  console.log(`moved ${formatUnits(amount, 18)} real EURe into it`);

  await test.setBalance({ address: keys.guardian.address, value: parseEther('0.01') });
  const started = await startTakeOver(w.pageChain, keys.guardian, safe, keys.newOwner.address);
  console.log(`start: ${started.transactionHash}`);
  await test.increaseTime({ seconds: Number(RECOVERY_PERIOD_90_DAYS) });
  await test.mine({ blocks: 1 });
  const finished = await finishTakeOver(w.pageChain, keys.guardian, safe, keys.guardian.address);
  console.log(`finish: owners now ${finished.owners.join(', ')}`);

  const facts = await readAccount(w.pageChain, safe, keys.guardian.address);
  const choice = chooseSendPath(w.pageChain, facts, keys.guardian, keys.guardian.address);
  if (choice.kind !== 'ready') throw new Error(`send path: ${choice.reason}`);
  const prepared = await choice.path.prepare(destination);
  const outcome = await choice.path.submit(prepared, await signWithKey(keys.newOwner, prepared));
  console.log(`send: ${outcome.transactionHash}`);

  const bal = async (token: Address, who: Address) => (await client.readContract({ address: token, abi: EURE_ABI, functionName: 'balanceOf', args: [who] })) as bigint;
  const results = {
    accountV2: await bal(EURE, safe),
    accountV1: await bal(EURE_V1, safe),
    destinationV2: await bal(EURE, destination),
    destinationV1: await bal(EURE_V1, destination),
  };
  const fee = parseEther('0.01') - (await client.getBalance({ address: keys.guardian.address }));
  console.log(`account: ${formatUnits(results.accountV2, 18)} EURe (v1 shows ${formatUnits(results.accountV1, 18)})`);
  console.log(`destination: ${formatUnits(results.destinationV2, 18)} EURe (v1 shows ${formatUnits(results.destinationV1, 18)})`);
  console.log(`fees paid by the words' first address for start + finish + send: ${formatUnits(fee, 18)} xDAI`);
  const ok = results.accountV2 === 0n && results.accountV1 === 0n && results.destinationV2 === amount && results.destinationV1 === amount;
  console.log(ok ? 'MATCH   the whole balance moved, on v2 and as seen through v1' : 'DIFFERS the balances are not as expected');
  if (!ok) process.exitCode = 1;
} finally {
  await connection.close();
}
