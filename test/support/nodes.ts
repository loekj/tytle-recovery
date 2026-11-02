// SPDX-License-Identifier: GPL-3.0-only
//
// Nodes that behave badly, for the tests: one that refuses big log ranges (as
// public nodes do), one that never answers, one that answers wrongly.

import type { EIP1193Provider } from 'viem';

type Request = { method: string; params?: unknown };

function wrap(inner: EIP1193Provider, handle: (r: Request, next: () => Promise<unknown>) => Promise<unknown>): EIP1193Provider {
  return { ...inner, request: ((r: Request) => handle(r, () => inner.request(r as never))) as EIP1193Provider['request'] };
}

/** eth_getLogs over more than `maxBlocks` blocks fails, like a public node's range limit. Counts the calls. */
export function rangeLimited(inner: EIP1193Provider, maxBlocks: number): { provider: EIP1193Provider; logCalls: () => number } {
  let calls = 0;
  const provider = wrap(inner, async (r, next) => {
    if (r.method === 'eth_getLogs') {
      calls += 1;
      const [q] = r.params as [{ fromBlock: string; toBlock: string }];
      if (Number(BigInt(q.toBlock) - BigInt(q.fromBlock)) + 1 > maxBlocks) throw new Error(`range over ${maxBlocks} blocks`);
    }
    return next();
  });
  return { provider, logCalls: () => calls };
}

/** eth_getLogs always fails; everything else works. */
export function noLogs(inner: EIP1193Provider): EIP1193Provider {
  return wrap(inner, async (r, next) => {
    if (r.method === 'eth_getLogs') throw new Error('logs are not served here');
    return next();
  });
}

/** Never answers anything. */
export const deadNode: EIP1193Provider = {
  on: () => undefined,
  removeListener: () => undefined,
  request: (async () => {
    throw new Error('no answer');
  }) as EIP1193Provider['request'],
} as unknown as EIP1193Provider;

/** Answers eth_getBalance and the token's balanceOf (by its selector) with one more than the truth. */
export function liar(inner: EIP1193Provider, token: string, balanceOfSelector: string): EIP1193Provider {
  return wrap(inner, async (r, next) => {
    const result = await next();
    if (r.method === 'eth_getBalance') return `0x${(BigInt(result as string) + 1n).toString(16)}`;
    if (r.method === 'eth_call') {
      const [call] = r.params as [{ to?: string; data?: string }];
      if (call.to?.toLowerCase() === token.toLowerCase() && call.data?.startsWith(balanceOfSelector)) {
        return `0x${(BigInt(result as string) + 1n).toString(16).padStart(64, '0')}`;
      }
    }
    return result;
  });
}
