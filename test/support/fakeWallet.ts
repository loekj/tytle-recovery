// SPDX-License-Identifier: GPL-3.0-only
//
// A browser wallet extension for the tests: an EIP-1193 provider that holds
// one key. Like some real wallets, it gives signatures in the forms Safe does
// not read as they are (v = 0 or 1, or 64 bytes), so the page must fix them.

import { hexToString, type Address, type EIP1193Provider, type Hex, type LocalAccount, type TypedDataDefinition } from 'viem';

type Form = 'v01' | 'compact' | 'standard';

function reshape(sig: Hex, form: Form): Hex {
  if (form === 'standard') return sig;
  const r = sig.slice(2, 66);
  const s = BigInt(`0x${sig.slice(66, 130)}`);
  const yParity = Number.parseInt(sig.slice(130, 132), 16) - 27;
  if (form === 'v01') return `0x${r}${s.toString(16).padStart(64, '0')}0${yParity}`;
  return `0x${r}${(s | (BigInt(yParity) << 255n)).toString(16).padStart(64, '0')}`;
}

/** JSON typed data (numbers as strings) back into what a viem account signs. */
function revive(json: string): TypedDataDefinition {
  const data = JSON.parse(json) as { domain: Record<string, unknown>; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown> };
  const { EIP712Domain: _domain, ...types } = data.types;
  const message: Record<string, unknown> = {};
  for (const field of types[data.primaryType] ?? []) {
    const v = data.message[field.name];
    message[field.name] = /^u?int\d*$/u.test(field.type) ? BigInt(v as string | number) : v;
  }
  const domain = { ...data.domain, chainId: data.domain.chainId === undefined ? undefined : Number(data.domain.chainId) };
  return { domain, types, primaryType: data.primaryType, message } as unknown as TypedDataDefinition;
}

export interface FakeWallet {
  provider: EIP1193Provider;
  calls: string[];
}

export function fakeWallet(account: LocalAccount, options: { typedForm?: Form; messageForm?: Form; chainId?: number } = {}): FakeWallet {
  const calls: string[] = [];
  let chainId = options.chainId ?? 100;
  const request = async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
    calls.push(method);
    const p = (params ?? []) as unknown[];
    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return [account.address];
      case 'eth_chainId':
        return `0x${chainId.toString(16)}`;
      case 'wallet_switchEthereumChain':
        chainId = Number.parseInt((p[0] as { chainId: string }).chainId, 16);
        return null;
      case 'personal_sign': {
        const [message, address] = p as [Hex, Address];
        if (address.toLowerCase() !== account.address.toLowerCase()) throw new Error('unknown address');
        return reshape(await account.signMessage!({ message: hexToString(message) }), options.messageForm ?? 'v01');
      }
      case 'eth_signTypedData_v4': {
        const [address, json] = p as [Address, string];
        if (address.toLowerCase() !== account.address.toLowerCase()) throw new Error('unknown address');
        const typed = revive(json);
        if (Number(typed.domain?.chainId) !== chainId) throw new Error('the wallet is on another chain');
        return reshape(await account.signTypedData!(typed), options.typedForm ?? 'compact');
      }
      default:
        throw new Error(`the fake wallet does not do ${method}`);
    }
  };
  return { provider: { request, on: () => undefined, removeListener: () => undefined } as unknown as EIP1193Provider, calls };
}
