// SPDX-License-Identifier: GPL-3.0-only
//
// A small JSON-RPC client for the scripts that read public chain data (fixtures,
// the address check, the deploy). Plain fetch, no key. A read that matters is
// asked of two nodes and must come back the same from both.

export const GNOSIS_CHAIN_ID = 100;

/** Public Gnosis nodes that answered without a key (checked 2026-10-22). Order = preference. */
export const PUBLIC_GNOSIS_NODES = [
  'https://rpc.gnosischain.com',
  'https://rpc.gnosis.gateway.fm',
  'https://gnosis-rpc.publicnode.com',
  'https://gnosis.drpc.org',
  'https://1rpc.io/gnosis',
] as const;

export class RpcError extends Error {
  readonly url: string;
  readonly method: string;

  constructor(url: string, method: string, message: string) {
    super(`${method} on ${url}: ${message}`);
    this.url = url;
    this.method = method;
  }
}

let nextId = 1;

export async function rpc<T>(url: string, method: string, params: unknown[] = []): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new RpcError(url, method, `no answer (${(err as Error).message})`);
  }
  if (!res.ok) throw new RpcError(url, method, `HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
  if (body.error) throw new RpcError(url, method, `${body.error.code} ${body.error.message}`);
  if (!('result' in body)) throw new RpcError(url, method, 'answer has no result');
  return body.result as T;
}

/**
 * The same read on two nodes. Both must answer, and the answers must be equal
 * (compared as JSON). A node that answers differently is a reason to stop, not
 * to pick one.
 */
export async function rpcOnTwo<T>(urls: readonly [string, string], method: string, params: unknown[] = []): Promise<T> {
  const [a, b] = await Promise.all([rpc<T>(urls[0], method, params), rpc<T>(urls[1], method, params)]);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${method}: ${urls[0]} and ${urls[1]} answered differently`);
  }
  return a;
}

export async function assertGnosis(url: string): Promise<void> {
  const chainId = await rpc<string>(url, 'eth_chainId');
  if (Number(chainId) !== GNOSIS_CHAIN_ID) throw new Error(`${url} is chain ${Number(chainId)}, not Gnosis (100)`);
}
