// SPDX-License-Identifier: GPL-3.0-only
//
// Reads the chain before a deploy, and sends the deploy. The deploy script and
// the tests call these same functions, on Gnosis, on a local fork of it, or on
// an empty local chain.

import { getAddress, keccak256, slice, type Account, type Address, type Chain, type Hash, type PublicClient, type Transport, type WalletClient } from 'viem';
import { GNOSIS_CHAIN_ID } from './rpc.ts';
import { FACTORY_CODE_KECCAK256, type ExitModuleDeployment } from './exitModule.ts';

export type DeployState = { kind: 'not-deployed' } | { kind: 'deployed' };

/**
 * The chain is Gnosis, the factory holds the factory's code, and the address
 * holds nothing or exactly the exit copy. Anything else throws: never guess.
 */
export async function readDeployState(client: PublicClient, d: ExitModuleDeployment): Promise<DeployState> {
  const chainId = await client.getChainId();
  if (chainId !== GNOSIS_CHAIN_ID) throw new Error(`the node is chain ${chainId}, not Gnosis (${GNOSIS_CHAIN_ID})`);
  const factoryCode = await client.getCode({ address: d.factory });
  if (!factoryCode || keccak256(factoryCode) !== FACTORY_CODE_KECCAK256) {
    throw new Error(`the factory ${d.factory} does not hold the known factory code`);
  }
  const code = await client.getCode({ address: d.address });
  if (!code || code === '0x') return { kind: 'not-deployed' };
  if (code === d.runtimeCode) return { kind: 'deployed' };
  throw new Error(`${d.address} holds code that is not the exit copy`);
}

export interface DeployResult {
  transactionHash: Hash;
  blockNumber: bigint;
  gasUsed: bigint;
  from: Address;
}

/**
 * Sends salt ++ init code to the factory, then checks the new code byte for
 * byte. A dry call first: the factory returns the address it would create.
 */
export async function sendDeploy(
  client: PublicClient,
  wallet: WalletClient<Transport, Chain | undefined, Account>,
  d: ExitModuleDeployment,
): Promise<DeployResult> {
  const state = await readDeployState(client, d);
  if (state.kind === 'deployed') throw new Error(`${d.address} already holds the exit copy; nothing to send`);

  const account = wallet.account;
  const { data } = await client.call({ account, to: d.factory, data: d.factoryCallData });
  if (!data || data.length !== 42 || getAddress(slice(data, 0, 20)) !== d.address) {
    throw new Error(`the factory's dry call returned ${data}, not ${d.address}`);
  }
  const gas = await client.estimateGas({ account, to: d.factory, data: d.factoryCallData });
  const transactionHash = await wallet.sendTransaction({
    account,
    chain: wallet.chain,
    to: d.factory,
    data: d.factoryCallData,
    gas: gas + gas / 5n,
  });
  const receipt = await client.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== 'success') throw new Error(`deploy transaction ${transactionHash} failed`);
  const code = await client.getCode({ address: d.address, blockNumber: receipt.blockNumber });
  if (code !== d.runtimeCode) throw new Error(`after ${transactionHash}, ${d.address} does not hold the exit copy's code`);
  return { transactionHash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, from: getAddress(account.address) };
}
