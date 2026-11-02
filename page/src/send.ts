// SPDX-License-Identifier: GPL-3.0-only
//
// "Send my euros": one transfer of the account's whole EURe balance, after the
// take-over. The new owner signs a Safe transaction (EURe.transfer(to, all));
// the words' first address submits it and pays the fee, so only that one
// address ever needs xDAI.
//
// The send sits behind one small adapter (SendPath), because a later account
// kind will queue a send to a new address first and run it a day later, and
// may see it cancelled (within a cap) and queued again. The page picks the path
// from what it reads on the account. Today it knows one path: a Safe 1.4.1
// with no guard, where the transfer runs at once. Any other account gets a
// plain "this page cannot send from it yet", and the help text's fallback.

import {
  encodeFunctionData,
  hashTypedData,
  isAddressEqual,
  parseEventLogs,
  recoverTypedDataAddress,
  zeroAddress,
  type Address,
  type Hex,
  type LocalAccount,
} from 'viem';
import { EURE_ABI, SAFE_ABI } from './abi.ts';
import { CouldNotRead, type Chain } from './chain.ts';
import { EURE, KNOWN_SAFE_VERSIONS } from './config.ts';
import { PageRefusal, destinationRefusals, readAccount, sendCall, type AccountFacts, type SendOptions, type Sent } from './exit.ts';
import { execTransactionArgs, normalizeSignature, plainCall, safeTxTypedData, transactionHashArgs, type SafeTx } from './safeTx.ts';

/** What the new owner signs. */
export interface PreparedSend {
  account: Address;
  to: Address;
  /** The whole balance, read just now. */
  amount: bigint;
  tx: SafeTx;
  /** The account's own getTransactionHash for tx; equal to the page's EIP-712 hash. */
  hash: Hex;
  typedData: ReturnType<typeof safeTxTypedData>;
}

/**
 * What a send became. 'sent': the euros moved. 'queued' is for the later account kind: the send waits until
 * readyAt, then anyone runs it; it may be cancelled and queued again.
 */
export type SendOutcome = ({ kind: 'sent' } & Sent) | { kind: 'queued'; id: Hex; readyAt: bigint; transactionHash: Hex };

export interface SendPath {
  readonly kind: 'direct';
  prepare(to: Address): Promise<PreparedSend>;
  submit(prepared: PreparedSend, signature: Hex, options?: SendOptions): Promise<SendOutcome>;
}

export type SendPathChoice =
  | { kind: 'ready'; path: SendPath }
  | { kind: 'not-supported'; reason: 'safe-version' | 'guard'; detail: string };

/** The path for this account, from what the page read on it. `submitter` pays the fee (the words' first address). */
export function chooseSendPath(chain: Chain, facts: AccountFacts, submitter: LocalAccount, guardian: Address): SendPathChoice {
  if (!facts.safeVersion || !(KNOWN_SAFE_VERSIONS as readonly string[]).includes(facts.safeVersion)) {
    return { kind: 'not-supported', reason: 'safe-version', detail: facts.safeVersion ?? 'unknown' };
  }
  if (!isAddressEqual(facts.guard, zeroAddress)) return { kind: 'not-supported', reason: 'guard', detail: facts.guard };
  return { kind: 'ready', path: directPath(chain, facts.account, submitter, guardian) };
}

function directPath(chain: Chain, account: Address, submitter: LocalAccount, guardian: Address): SendPath {
  return {
    kind: 'direct',
    async prepare(to) {
      const facts = await readAccount(chain, account, guardian);
      const refused = destinationRefusals(facts, to);
      if (refused.length > 0) throw new PageRefusal(refused);
      if (facts.request) throw new PageRefusal(['take-over-not-finished']);
      if (facts.eureBalance === 0n) throw new PageRefusal(['nothing-to-send']);
      const data = encodeFunctionData({ abi: EURE_ABI, functionName: 'transfer', args: [to, facts.eureBalance] });
      const { value: nonce } = await chain.readAgreed('the account nonce', (c, blockNumber) =>
        c.readContract({ address: account, abi: SAFE_ABI, functionName: 'nonce', blockNumber }),
      );
      const tx = plainCall(EURE, data, nonce as bigint);
      const typedData = safeTxTypedData(account, tx);
      const ours = hashTypedData(typedData);
      const { value: theirs } = await chain.readAgreed('the transaction hash', (c, blockNumber) =>
        c.readContract({ address: account, abi: SAFE_ABI, functionName: 'getTransactionHash', args: transactionHashArgs(tx), blockNumber }),
      );
      if (theirs !== ours) throw new PageRefusal(['hash-differs']);
      return { account, to, amount: facts.eureBalance, tx, hash: ours, typedData };
    },
    async submit(prepared, signature, options) {
      const sig = normalizeSignature(signature);
      // The signer must be the account's only owner.
      const signer = await recoverTypedDataAddress({ ...prepared.typedData, signature: sig });
      const facts = await readAccount(chain, account, guardian);
      if (facts.owners.length !== 1 || !isAddressEqual(facts.owners[0]!, signer)) throw new PageRefusal(['signer-not-owner']);
      const sent = await sendCall(chain, submitter, { address: account, abi: SAFE_ABI, functionName: 'execTransaction', args: execTransactionArgs(prepared.tx, sig) }, options);
      // Done means: the account ran the transaction, and the token moved exactly this amount to exactly this address.
      const ran = parseEventLogs({ abi: SAFE_ABI, eventName: 'ExecutionSuccess', logs: sent.logs }).filter((l) => isAddressEqual(l.address, account));
      const moved = parseEventLogs({ abi: EURE_ABI, eventName: 'Transfer', logs: sent.logs }).filter((l) => {
        const a = l.args as { from: Address; to: Address; value: bigint };
        return isAddressEqual(l.address, EURE) && isAddressEqual(a.from, account) && isAddressEqual(a.to, prepared.to) && a.value === prepared.amount;
      });
      if (ran.length !== 1 || moved.length !== 1) throw new CouldNotRead('the send');
      return { kind: 'sent', transactionHash: sent.transactionHash, blockNumber: sent.blockNumber };
    },
  };
}

/** The new owner's signature, when the page holds its key (made from the words). */
export async function signWithKey(owner: LocalAccount, prepared: PreparedSend): Promise<Hex> {
  if (!owner.signTypedData) throw new Error('this key cannot sign typed data');
  return owner.signTypedData(prepared.typedData);
}
