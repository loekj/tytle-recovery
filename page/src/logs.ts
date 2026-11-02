// SPDX-License-Identifier: GPL-3.0-only
//
// Reads the exit copy's records (event logs) over a long range of blocks.
// Public nodes limit how many blocks one request may cover, each its own way.
// So the range is read in steps: a step that a node refuses is made smaller,
// and when the smallest step fails too, the next node carries on from the same
// block. What this finds is checked again by direct reads before the page uses
// it, so a node can at worst hide a record, never add a valid one.

import type { PublicClient } from 'viem';
import { CouldNotRead, type Chain } from './chain.ts';

export interface ScanOptions {
  fromBlock: bigint;
  /** Default: the latest block of the first node that answers. */
  toBlock?: bigint;
  /** Blocks per request to start with. */
  maxStep?: bigint;
  /** Below this, a refusal means "try the next node". */
  minStep?: bigint;
  onProgress?: (scannedTo: bigint, toBlock: bigint) => void;
}

export async function scanLogs<T>(
  chain: Chain,
  what: string,
  query: (client: PublicClient, fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
  options: ScanOptions,
): Promise<T[]> {
  const maxStep = options.maxStep ?? 2_000_000n;
  const minStep = options.minStep ?? 5_000n;
  const toBlock = options.toBlock ?? (await chain.read('the latest block', (c) => c.getBlockNumber({ cacheTime: 0 })));
  const found: T[] = [];
  let cursor = options.fromBlock;
  let nodeIndex = 0;
  let step = maxStep;
  let ceiling = maxStep;
  let last: unknown;
  while (cursor <= toBlock) {
    const node = chain.nodes[nodeIndex];
    if (!node) throw new CouldNotRead(what, last);
    const end = cursor + step - 1n < toBlock ? cursor + step - 1n : toBlock;
    try {
      found.push(...(await query(node.client, cursor, end)));
      cursor = end + 1n;
      options.onProgress?.(end, toBlock);
      step = step * 2n < ceiling ? step * 2n : ceiling;
    } catch (err) {
      last = err;
      if (step > minStep) {
        ceiling = step / 2n > minStep ? step / 2n : minStep;
        step = step / 4n > minStep ? step / 4n : minStep;
      } else {
        nodeIndex += 1;
        step = maxStep;
        ceiling = maxStep;
      }
    }
  }
  return found;
}
