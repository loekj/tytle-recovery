// SPDX-License-Identifier: GPL-3.0-only
//
// An empty local chain in this process (Hardhat's EDR) with Gnosis's chain id.
// No network: the tests put the recorded Gnosis code at its real addresses.

import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  custom,
  getAddress,
  http,
  type Address,
  type EIP1193Provider,
  type PublicClient,
  type TestClient,
} from 'viem';
import { gnosis } from 'viem/chains';
import { recorded } from './fixtures.ts';

export interface LocalChain {
  provider: EIP1193Provider;
  client: PublicClient;
  test: TestClient<'hardhat'>;
  /** Local test accounts, unlocked and funded by the local chain. */
  accounts: Address[];
  walletFor(address: Address): ReturnType<typeof createWalletClient<ReturnType<typeof custom>, typeof gnosis, Address>>;
  /** Put a recorded Gnosis contract's code at its real address. */
  place(name: string): Promise<Address>;
  close(): Promise<void>;
}

export async function startLocalChain(): Promise<LocalChain> {
  const { network } = await import('hardhat');
  const connection = await network.create('localGnosis');
  return chainOver(connection.provider as unknown as EIP1193Provider, () => connection.close());
}

/**
 * The same local chain behind a JSON-RPC server on 127.0.0.1, as a user's own node would be. The page reaches it
 * over HTTP, through its own "use my own node" field.
 */
export async function startLocalChainOverHttp(): Promise<LocalChain & { url: string }> {
  const { network } = await import('hardhat');
  const server = await network.createServer('localGnosis', '127.0.0.1', 0);
  const { address, port } = await server.listen();
  const url = `http://${address}:${port}`;
  const { request } = http(url, { retryCount: 0 })({ chain: gnosis, retryCount: 0 });
  const provider = { request, on: () => undefined, removeListener: () => undefined } as unknown as EIP1193Provider;
  return { ...(await chainOver(provider, () => server.close())), url };
}

async function chainOver(provider: EIP1193Provider, close: () => Promise<void>): Promise<LocalChain> {
  const transport = custom(provider);
  const client = createPublicClient({ chain: gnosis, transport }) as PublicClient;
  const test = createTestClient({ chain: gnosis, mode: 'hardhat', transport });
  const accounts = ((await provider.request({ method: 'eth_accounts' })) as string[]).map((a) => getAddress(a));
  return {
    provider,
    client,
    test,
    accounts,
    walletFor: (address) => createWalletClient({ account: address, chain: gnosis, transport }),
    async place(name) {
      const c = recorded(name);
      const address = getAddress(c.address);
      await test.setCode({ address, bytecode: c.code });
      return address;
    },
    close,
  };
}
