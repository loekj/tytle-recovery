// SPDX-License-Identifier: GPL-3.0-only
//
// The exit copy's deterministic deploy (CREATE2 through Safe's singleton factory).
//
//   node scripts/deploy-exit-module.ts --offline
//       Print the factory, salt, init code hash and address. No network.
//   node scripts/deploy-exit-module.ts [--rpc <url>]
//       The same, and read Gnosis (two public nodes, or the one given): is the
//       factory there, is the address still empty. Sends nothing.
//   node scripts/deploy-exit-module.ts --dry-run-fork [--rpc <url>]
//       Deploy on a local fork of Gnosis, in this process, with a local test
//       account, and check the result byte for byte. Sends nothing to Gnosis.
//   DEPLOYER_PRIVATE_KEY=0x... node scripts/deploy-exit-module.ts --send --confirm <address> [--rpc <url>]
//       The real deploy. The key comes only from the environment. --confirm must
//       repeat the printed address. Costs a little xDAI.
//
// One copy serves every account. It has no owner and no admin. Anybody may send
// this same deploy: the result is the same contract at the same address.

import { parseArgs } from 'node:util';
import { createPublicClient, createWalletClient, custom, formatEther, getAddress, http, type Hex, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis } from 'viem/chains';
import { buildModule } from './lib/build.ts';
import { readDeployState, sendDeploy, type DeployState } from './lib/deploy.ts';
import { exitModuleDeployment, type ExitModuleDeployment } from './lib/exitModule.ts';
import { PUBLIC_GNOSIS_NODES } from './lib/rpc.ts';

const { values: args } = parseArgs({
  options: {
    offline: { type: 'boolean', default: false },
    rpc: { type: 'string' },
    'dry-run-fork': { type: 'boolean', default: false },
    send: { type: 'boolean', default: false },
    confirm: { type: 'string' },
  },
});

const build = await buildModule();
const d = exitModuleDeployment(build);
printDeployment(d);

if (args.offline) process.exit(0);

if (args['dry-run-fork']) {
  await dryRunOnFork(d, args.rpc ?? PUBLIC_GNOSIS_NODES[0]);
  process.exit(0);
}

// Read Gnosis: the given node, or two public nodes that must agree.
const urls = args.rpc ? [args.rpc] : [PUBLIC_GNOSIS_NODES[0], PUBLIC_GNOSIS_NODES[1]];
const states: DeployState[] = [];
for (const url of urls) {
  const state = await readDeployState(createPublicClient({ chain: gnosis, transport: http(url) }), d);
  console.log(`  ${url}: factory ok, address ${state.kind === 'deployed' ? 'holds the exit copy' : 'is empty (not deployed yet)'}`);
  states.push(state);
}
if (new Set(states.map((s) => s.kind)).size !== 1) throw new Error('the nodes disagree; stop');

if (!args.send) process.exit(0);

// The real deploy.
if (urls.length !== 1) throw new Error('--send needs --rpc <url>: the node that gets the transaction');
if (!args.confirm || getAddress(args.confirm) !== d.address) {
  throw new Error(`--confirm must repeat the address printed above (${d.address})`);
}
const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('DEPLOYER_PRIVATE_KEY is not set (0x + 64 hex digits)');
const url = urls[0] as string;
const account = privateKeyToAccount(key as Hex);
const client = createPublicClient({ chain: gnosis, transport: http(url) });
const wallet = createWalletClient({ account, chain: gnosis, transport: http(url) });
console.log(`\nSending from ${account.address} (balance ${formatEther(await client.getBalance({ address: account.address }))} xDAI) to ${url}`);
const result = await sendDeploy(client, wallet, d);
console.log(`Deployed. Transaction ${result.transactionHash}, block ${result.blockNumber}, gas used ${result.gasUsed}.`);
console.log(`${d.address} holds the exit copy's code, byte for byte.`);

function printDeployment(x: ExitModuleDeployment): void {
  console.log('Exit copy: Candide SocialRecoveryModule v0.0.1, 90-day recovery period');
  console.log(`  factory          ${x.factory} (Safe singleton factory)`);
  console.log(`  salt             keccak256("${x.saltText}") = ${x.salt}`);
  console.log(`  recovery period  ${x.recoveryPeriodSeconds} s = ${Number(x.recoveryPeriodSeconds) / 86_400} days`);
  console.log(`  init code        ${(x.initCode.length - 2) / 2} bytes, keccak256 ${x.initCodeHash}`);
  console.log(`  address          ${x.address}`);
}

async function dryRunOnFork(x: ExitModuleDeployment, forkUrl: string): Promise<void> {
  console.log(`\nDry run on a local fork of Gnosis (${forkUrl})`);
  const { network } = await import('hardhat');
  const connection = await network.create({ network: 'gnosisFork', override: { forking: { url: forkUrl } } });
  try {
    const transport = custom(connection.provider);
    const client = createPublicClient({ chain: gnosis, transport }) as PublicClient;
    const [from] = (await connection.provider.request({ method: 'eth_accounts' })) as Hex[];
    if (!from) throw new Error('the fork has no local test account');
    const wallet = createWalletClient({ account: getAddress(from), chain: gnosis, transport });
    const forkBlock = await client.getBlockNumber();
    // The fork's own block is a remote block, and the fork knows no hardfork history for Gnosis. One local block
    // first, so every call and transaction below runs on a local block, under the configured hardfork.
    await connection.provider.request({ method: 'evm_mine' });
    const before = await readDeployState(client, x);
    console.log(`  fork at block ${forkBlock}: factory ok, address ${before.kind === 'deployed' ? 'already holds the exit copy' : 'is empty'}`);
    if (before.kind === 'deployed') return;
    const result = await sendDeploy(client, wallet, x);
    console.log(`  deployed on the fork: block ${result.blockNumber}, gas used ${result.gasUsed}`);
    console.log(`  ${x.address} holds the exit copy's code, byte for byte (${(x.runtimeCode.length - 2) / 2} bytes)`);
  } finally {
    await connection.close();
  }
}
