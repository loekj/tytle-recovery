// SPDX-License-Identifier: GPL-3.0-only
//
// When the new owner is the user's own wallet ("use my own wallet address"),
// the page holds no key for it. The user's wallet signs instead, through a
// wallet extension in the browser (EIP-1193). The page asks it for two things
// only: before the start, a signed short message (it proves the wallet is the
// user's and can sign); at the send, a signature over the Safe transaction
// (EIP-712). The words' first address still submits and pays the fees.

import { createWalletClient, custom, getAddress, isAddressEqual, verifyMessage, type Address, type EIP1193Provider, type Hex } from 'viem';
import { gnosis } from 'viem/chains';
import { normalizeSignature } from './safeTx.ts';
import type { PreparedSend } from './send.ts';

export class WalletProblem extends Error {
  readonly reason: 'no-wallet' | 'other-address' | 'refused';

  constructor(reason: 'no-wallet' | 'other-address' | 'refused', cause?: unknown) {
    super(reason, { cause });
    this.reason = reason;
  }
}

export interface WalletChoice {
  name: string;
  provider: EIP1193Provider;
}

function isProvider(p: unknown): p is EIP1193Provider {
  return typeof p === 'object' && p !== null && typeof (p as { request?: unknown }).request === 'function';
}

export function injectedWallet(w: { ethereum?: unknown }): EIP1193Provider | null {
  return isProvider(w.ethereum) ? w.ethereum : null;
}

/**
 * The browser's wallet extensions: each announces itself (EIP-6963); an older extension only sets
 * window.ethereum. With two extensions, the user picks one.
 */
export function discoverWallets(win: Window, waitMs = 400): Promise<WalletChoice[]> {
  return new Promise((resolve) => {
    const found: WalletChoice[] = [];
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<{ info?: { name?: unknown }; provider?: unknown }>).detail;
      if (!detail || !isProvider(detail.provider) || found.some((f) => f.provider === detail.provider)) return;
      found.push({ name: typeof detail.info?.name === 'string' ? detail.info.name : 'Wallet', provider: detail.provider });
    };
    win.addEventListener('eip6963:announceProvider', onAnnounce);
    win.dispatchEvent(new Event('eip6963:requestProvider'));
    setTimeout(() => {
      win.removeEventListener('eip6963:announceProvider', onAnnounce);
      const legacy = injectedWallet(win as unknown as { ethereum?: unknown });
      if (found.length === 0 && legacy) found.push({ name: 'Wallet', provider: legacy });
      resolve(found);
    }, waitMs);
  });
}

async function connect(provider: EIP1193Provider, owner: Address) {
  const wallet = createWalletClient({ chain: gnosis, transport: custom(provider) });
  let addresses: Address[];
  try {
    addresses = (await wallet.requestAddresses()).map((a) => getAddress(a));
  } catch (err) {
    throw new WalletProblem('refused', err);
  }
  if (!addresses.some((a) => isAddressEqual(a, owner))) throw new WalletProblem('other-address');
  return wallet;
}

/** The short message the wallet signs before the start. It names the account; it moves nothing. */
export function proofMessage(account: Address): string {
  return `Tytle account exit: this wallet will own the account ${account}.`;
}

/** The wallet signs the proof message as `owner`; the page checks the signature. */
export async function proveControl(provider: EIP1193Provider, owner: Address, account: Address): Promise<void> {
  const wallet = await connect(provider, owner);
  const message = proofMessage(account);
  let signature: Hex;
  try {
    signature = await wallet.signMessage({ account: owner, message });
  } catch (err) {
    throw new WalletProblem('refused', err);
  }
  if (!(await verifyMessage({ address: owner, message, signature: normalizeSignature(signature) }))) throw new WalletProblem('other-address');
}

/** Ask the wallet for the new owner's signature over the Safe transaction. The wallet must show the new owner. */
export async function signWithWallet(provider: EIP1193Provider, newOwner: Address, prepared: PreparedSend): Promise<Hex> {
  const wallet = await connect(provider, newOwner);
  try {
    // Wallets sign typed data only for the chain they are on.
    if ((await wallet.getChainId()) !== gnosis.id) {
      try {
        await wallet.switchChain({ id: gnosis.id });
      } catch {
        await wallet.addChain({ chain: gnosis });
      }
    }
    return normalizeSignature(await wallet.signTypedData({ account: newOwner, ...prepared.typedData }));
  } catch (err) {
    throw new WalletProblem('refused', err);
  }
}
