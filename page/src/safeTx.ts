// SPDX-License-Identifier: GPL-3.0-only
//
// A Safe transaction (EIP-712 "SafeTx", Safe's own format) that an owner
// signs. The type and domain are as in Safe 1.4.1's verified source
// (Safe.sol: SAFE_TX_TYPEHASH and DOMAIN_SEPARATOR_TYPEHASH, with their type
// strings in the comments). A test checks both hashes against the source's
// constants, and the page compares its hash with the account's own
// getTransactionHash before anybody signs.

import {
  compactSignatureToSignature,
  parseCompactSignature,
  parseSignature,
  serializeSignature,
  size,
  zeroAddress,
  type Address,
  type Hex,
  type TypedDataDomain,
} from 'viem';
import { CHAIN_ID } from './config.ts';

export const SAFE_TX_TYPES = {
  SafeTx: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'operation', type: 'uint8' },
    { name: 'safeTxGas', type: 'uint256' },
    { name: 'baseGas', type: 'uint256' },
    { name: 'gasPrice', type: 'uint256' },
    { name: 'gasToken', type: 'address' },
    { name: 'refundReceiver', type: 'address' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

export interface SafeTx {
  to: Address;
  value: bigint;
  data: Hex;
  /** 0 = call. The page never asks for a delegate call. */
  operation: 0;
  safeTxGas: bigint;
  baseGas: bigint;
  gasPrice: bigint;
  gasToken: Address;
  refundReceiver: Address;
  nonce: bigint;
}

/**
 * A plain call with no gas refund: the account pays nobody back, and the sender pays its own fee. With safeTxGas
 * and gasPrice both 0, Safe requires the inner call to succeed, or the whole transaction fails ("GS013").
 */
export function plainCall(to: Address, data: Hex, nonce: bigint): SafeTx {
  return { to, value: 0n, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: zeroAddress, refundReceiver: zeroAddress, nonce };
}

export function safeTxDomain(account: Address): TypedDataDomain {
  return { chainId: CHAIN_ID, verifyingContract: account };
}

export function safeTxTypedData(account: Address, tx: SafeTx) {
  return { domain: safeTxDomain(account), types: SAFE_TX_TYPES, primaryType: 'SafeTx' as const, message: tx };
}

/** The arguments of execTransaction, in its order, with the owners' signatures. */
export function execTransactionArgs(tx: SafeTx, signatures: Hex) {
  return [tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, signatures] as const;
}

/** The arguments of getTransactionHash, in its order. */
export function transactionHashArgs(tx: SafeTx) {
  return [tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, tx.nonce] as const;
}

/**
 * An owner's signature in the one form Safe reads as a plain key signature: 65 bytes, v = 27 or 28. Some wallets
 * give v = 0 or 1, or a 64-byte compact signature. Safe would read v = 0 as a contract signature and v = 1 as an
 * approved hash, and refuse the send.
 */
export function normalizeSignature(signature: Hex): Hex {
  const sig = size(signature) === 64 ? compactSignatureToSignature(parseCompactSignature(signature)) : parseSignature(signature);
  const yParity = sig.yParity ?? (sig.v === 28n || sig.v === 1n ? 1 : 0);
  return serializeSignature({ r: sig.r, s: sig.s, yParity });
}
