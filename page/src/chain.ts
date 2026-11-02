// SPDX-License-Identifier: GPL-3.0-only
//
// How the page talks to Gnosis: through public nodes (or the user's own node),
// never through a server of ours. A read that the user acts on is asked of two
// nodes at the same block, and the answers must be equal. A read that fails
// says so: the page never shows a guessed value, such as a balance of 0.

import { createPublicClient, custom, http, type EIP1193Provider, type PublicClient, type Transport } from 'viem';
import { gnosis } from 'viem/chains';
import { CHAIN_ID } from './config.ts';

/** No node answered, or no node is on Gnosis. The page says "could not read" and offers to try again. */
export class CouldNotRead extends Error {
  readonly what: string;

  constructor(what: string, cause?: unknown) {
    super(`could not read ${what}`, { cause });
    this.what = what;
  }
}

/** Two nodes gave different answers for the same block. The page does not pick one. */
export class NodesDisagree extends Error {
  readonly what: string;

  constructor(what: string) {
    super(`the nodes gave different answers for ${what}`);
    this.what = what;
  }
}

export interface ChainNode {
  /** Shown to the user: the node's address. */
  label: string;
  transport: Transport;
  client: PublicClient;
}

export function nodeFromUrl(url: string): ChainNode {
  const transport = http(url, { timeout: 15_000, retryCount: 1 });
  return { label: url, transport, client: createPublicClient({ chain: gnosis, transport }) };
}

/** A node behind an EIP-1193 provider (the tests' in-process chain). */
export function nodeFromProvider(label: string, provider: EIP1193Provider): ChainNode {
  const transport = custom(provider);
  return { label, transport, client: createPublicClient({ chain: gnosis, transport }) as PublicClient };
}

function sameJson(a: unknown, b: unknown): boolean {
  const json = (v: unknown) => JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? `${x}n` : x));
  return json(a) === json(b);
}

/** A node that failed is asked last for this long, so one slow node does not slow every read. */
const RESTING_MS = 60_000;

export class Chain {
  readonly nodes: readonly ChainNode[];
  /** Nodes that answered with another chain id: never used again in this page load. */
  private readonly wrongChain = new Set<ChainNode>();
  private readonly checked = new Set<ChainNode>();
  private readonly restingUntil = new Map<ChainNode, number>();

  constructor(nodes: readonly ChainNode[]) {
    if (nodes.length === 0) throw new Error('no node');
    this.nodes = nodes;
  }

  private failed(node: ChainNode): void {
    this.restingUntil.set(node, Date.now() + RESTING_MS);
  }

  /** The node is on Gnosis (asked once per node). */
  private async usable(node: ChainNode): Promise<boolean> {
    if (this.wrongChain.has(node)) return false;
    if (this.checked.has(node)) return true;
    const id = await node.client.getChainId();
    if (id !== CHAIN_ID) {
      this.wrongChain.add(node);
      return false;
    }
    this.checked.add(node);
    return true;
  }

  /** The nodes on Gnosis that answer, in order: nodes that failed in the last minute come last. */
  private async *answering(skip: ReadonlySet<ChainNode> = new Set()): AsyncGenerator<ChainNode> {
    const now = Date.now();
    const resting = (n: ChainNode) => (this.restingUntil.get(n) ?? 0) > now;
    const order = [...this.nodes.filter((n) => !resting(n)), ...this.nodes.filter(resting)];
    for (const node of order) {
      if (skip.has(node)) continue;
      try {
        if (await this.usable(node)) yield node;
      } catch {
        this.failed(node);
      }
    }
  }

  /** One read from the first node that answers it. */
  async read<T>(what: string, fn: (client: PublicClient) => Promise<T>): Promise<T> {
    let last: unknown;
    for await (const node of this.answering()) {
      try {
        return await fn(node.client);
      } catch (err) {
        last = err;
        this.failed(node);
      }
    }
    throw new CouldNotRead(what, last);
  }

  /**
   * A read the user acts on. With two or more nodes: two of them, at the same block (the lower of their two
   * latest blocks), and the answers must be equal. A node that fails is left out and the next node is paired
   * instead. With one node (the user's own): that node. `atLeast`: after a transaction, wait (a little) until
   * both nodes have its block, so the read sees it.
   */
  async readAgreed<T>(
    what: string,
    fn: (client: PublicClient, blockNumber: bigint) => Promise<T>,
    options: { atLeast?: bigint } = {},
  ): Promise<{ value: T; blockNumber: bigint }> {
    const want = Math.min(2, this.nodes.length);
    const left = new Set<ChainNode>();
    let last: unknown;
    let waits = 0;
    for (;;) {
      const heads: { node: ChainNode; head: bigint }[] = [];
      for await (const node of this.answering(left)) {
        try {
          heads.push({ node, head: await node.client.getBlockNumber({ cacheTime: 0 }) });
        } catch (err) {
          last = err;
          left.add(node);
          this.failed(node);
        }
        if (heads.length === want) break;
      }
      if (heads.length < want) throw new CouldNotRead(what, last);
      const blockNumber = heads.reduce((m, h) => (h.head < m ? h.head : m), heads[0]!.head);
      if (options.atLeast !== undefined && blockNumber < options.atLeast) {
        if (++waits > 15) throw new CouldNotRead(what, last);
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        continue;
      }
      const answers = await Promise.allSettled(heads.map((h) => fn(h.node.client, blockNumber)));
      const failedNodes = heads.filter((_, i) => answers[i]!.status === 'rejected');
      if (failedNodes.length > 0) {
        for (const h of failedNodes) {
          left.add(h.node);
          this.failed(h.node);
        }
        last = (answers.find((a) => a.status === 'rejected') as PromiseRejectedResult).reason;
        continue;
      }
      const values = answers.map((a) => (a as PromiseFulfilledResult<T>).value);
      if (values.length === 2 && !sameJson(values[0], values[1])) throw new NodesDisagree(what);
      return { value: values[0] as T, blockNumber };
    }
  }

  /** The node that gets the page's transactions: the first that answers. */
  async sendNode(): Promise<ChainNode> {
    for await (const node of this.answering()) {
      try {
        await node.client.getBlockNumber({ cacheTime: 0 });
        return node;
      } catch {
        this.failed(node);
      }
    }
    throw new CouldNotRead('the chain');
  }
}

/**
 * "Use my own node": an address on this device only (the page's CSP allows nothing else). Returns the URL, or
 * null when it is not one.
 */
export function ownNodeUrl(text: string, allowedHosts: readonly string[]): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!allowedHosts.includes(url.hostname)) return null;
  if (url.username || url.password) return null;
  return url.toString();
}
