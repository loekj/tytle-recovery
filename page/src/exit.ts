// SPDX-License-Identifier: GPL-3.0-only
//
// The exit itself: find the account, check it, start the take-over, wait,
// finish it. Every check that can save the user a 90-day wait for nothing runs
// before the start. The contract checks some of them only at the finish.

import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  WaitForTransactionReceiptTimeoutError,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  isAddress,
  isAddressEqual,
  keccak256,
  pad,
  toEventSelector,
  zeroAddress,
  type AbiEvent,
  type Address,
  type Hex,
  type LocalAccount,
  type Log,
  type PublicClient,
} from 'viem';
import { gnosis } from 'viem/chains';
import { EURE_ABI, MODULE_ABI, SAFE_ABI, SAFE_GUARD_STORAGE_SLOT } from './abi.ts';
import { CouldNotRead, type Chain } from './chain.ts';
import {
  EURE,
  EXIT_MODULE,
  EXIT_MODULE_CODE_KECCAK256,
  EXIT_MODULE_SEARCH_FROM_BLOCK,
  RECOVERY_MODULE_14_DAYS,
  SAFE_PROXY_CODE_KECCAK256,
} from './config.ts';
import { scanLogs, type ScanOptions } from './logs.ts';

export interface RecoveryRequest {
  guardiansApprovalCount: bigint;
  newThreshold: bigint;
  /** Unix time (seconds) from which anyone may finish. */
  executeAfter: bigint;
  newOwners: Address[];
}

/** What the page knows about one account, all read at one block. */
export interface AccountFacts {
  account: Address;
  blockNumber: bigint;
  /** The block's time: the chain's clock, not this device's. */
  blockTime: bigint;
  hasCode: boolean;
  /** keccak256 of the account's code (null without code). A real account is a Safe proxy: SAFE_PROXY_CODE_KECCAK256. */
  codeHash: Hex | null;
  /** null when VERSION() does not answer: the address is not a Safe. */
  safeVersion: string | null;
  owners: Address[];
  /** A Safe transaction guard; zeroAddress when there is none. */
  guard: Address;
  exitModuleEnabled: boolean;
  /** The words' first address is a guardian on the exit copy. */
  isExitGuardian: boolean;
  exitThreshold: bigint;
  /** A live take-over on the exit copy, or null. */
  request: RecoveryRequest | null;
  /** A live recovery on the 14-day copy, or null. Once it is due, anyone may finish it, and it replaces the owner. */
  request14Day: RecoveryRequest | null;
  eureBalance: bigint;
}

export type AccountProblem = 'not-a-contract' | 'not-a-safe' | 'exit-copy-off' | 'not-guardian' | 'threshold-not-one';

export type NewOwnerRefusal =
  | 'zero-address'
  | 'the-account'
  | 'current-owner'
  | 'guardian-exit-copy'
  | 'guardian-14-day-copy'
  | 'contract-wallet'
  | 'owner-refused';

export type DestinationRefusal = 'zero-address' | 'the-account' | 'the-token' | 'a-recovery-copy';

/** The page refused an action before any transaction. */
export class PageRefusal extends Error {
  readonly reasons: readonly string[];

  constructor(reasons: readonly string[]) {
    super(`refused: ${reasons.join(', ')}`);
    this.reasons = reasons;
  }
}

/** A transaction was sent but is not confirmed yet. It may still go through: the page shows its link. */
export class TxStillPending extends Error {
  readonly transactionHash: Hex;

  constructor(transactionHash: Hex) {
    super(`the transaction ${transactionHash} is not confirmed yet`);
    this.transactionHash = transactionHash;
  }
}

/** Safe's own owner list marker (OwnerManager.sol, SENTINEL_OWNERS = address(0x1), in the verified source). */
const SENTINEL_OWNERS: Address = '0x0000000000000000000000000000000000000001';

/**
 * The contract said no (a revert, or no answer data), as opposed to a node that failed (a timeout, a rate
 * limit). Only the first means "this is not a Safe"; the second is "could not read".
 */
function contractSaidNo(err: unknown): boolean {
  return err instanceof BaseError && err.walk((e) => e instanceof ContractFunctionRevertedError || e instanceof ContractFunctionZeroDataError) !== null;
}

/** A typed address: valid, and with a correct checksum when it has capital letters. */
export function parseAddress(text: string): Address | null {
  const t = text.trim();
  return isAddress(t, { strict: true }) ? getAddress(t) : null;
}

/** The exit copy is at its address with exactly the expected code. Before it is deployed: false. */
export async function readExitCopyPresent(chain: Chain): Promise<boolean> {
  const { value } = await chain.readAgreed('the exit contract', async (c, blockNumber) => {
    const code = await c.getCode({ address: EXIT_MODULE, blockNumber });
    return code && code !== '0x' ? keccak256(code) : null;
  });
  if (value === null) return false;
  if (value !== EXIT_MODULE_CODE_KECCAK256) throw new PageRefusal(['exit-copy-code-differs']);
  return true;
}

function asRequest(raw: unknown): RecoveryRequest | null {
  const r = raw as { guardiansApprovalCount: bigint; newThreshold: bigint; executeAfter: bigint; newOwners: readonly Address[] };
  if (r.executeAfter === 0n) return null;
  return { guardiansApprovalCount: r.guardiansApprovalCount, newThreshold: r.newThreshold, executeAfter: BigInt(r.executeAfter), newOwners: [...r.newOwners] };
}

async function readFactsAt(c: PublicClient, account: Address, guardian: Address, blockNumber: bigint): Promise<Omit<AccountFacts, 'account' | 'blockNumber'>> {
  const blockTime = (await c.getBlock({ blockNumber })).timestamp;
  const empty = {
    blockTime,
    codeHash: null,
    safeVersion: null,
    owners: [],
    guard: zeroAddress,
    exitModuleEnabled: false,
    isExitGuardian: false,
    exitThreshold: 0n,
    request: null,
    request14Day: null,
    eureBalance: 0n,
  };
  const code = await c.getCode({ address: account, blockNumber });
  if (!code || code === '0x') return { ...empty, hasCode: false };
  const codeHash = keccak256(code);
  let safeVersion: string;
  try {
    safeVersion = (await c.readContract({ address: account, abi: SAFE_ABI, functionName: 'VERSION', blockNumber })) as string;
  } catch (err) {
    if (contractSaidNo(err)) return { ...empty, hasCode: true, codeHash };
    throw err;
  }
  const read = (address: Address, abi: typeof SAFE_ABI, functionName: string, args: readonly unknown[] = []) =>
    c.readContract({ address, abi, functionName, args, blockNumber });
  const [owners, guardWord, exitModuleEnabled, isExitGuardian, exitThreshold, request, request14Day, eureBalance] = await Promise.all([
    read(account, SAFE_ABI, 'getOwners'),
    read(account, SAFE_ABI, 'getStorageAt', [SAFE_GUARD_STORAGE_SLOT, 1n]),
    read(account, SAFE_ABI, 'isModuleEnabled', [EXIT_MODULE]),
    read(EXIT_MODULE, MODULE_ABI, 'isGuardian', [account, guardian]),
    read(EXIT_MODULE, MODULE_ABI, 'threshold', [account]),
    read(EXIT_MODULE, MODULE_ABI, 'getRecoveryRequest', [account]),
    read(RECOVERY_MODULE_14_DAYS, MODULE_ABI, 'getRecoveryRequest', [account]),
    read(EURE, EURE_ABI, 'balanceOf', [account]),
  ]);
  return {
    blockTime,
    hasCode: true,
    codeHash,
    safeVersion,
    owners: (owners as readonly Address[]).map((a) => getAddress(a)),
    guard: getAddress(`0x${(guardWord as Hex).slice(-40)}`),
    exitModuleEnabled: exitModuleEnabled as boolean,
    isExitGuardian: isExitGuardian as boolean,
    exitThreshold: exitThreshold as bigint,
    request: asRequest(request),
    request14Day: asRequest(request14Day),
    eureBalance: eureBalance as bigint,
  };
}

/** Everything about the account, from two nodes at one block (`atLeast`: a block the read must include). */
export async function readAccount(chain: Chain, account: Address, guardian: Address, atLeast?: bigint): Promise<AccountFacts> {
  const { value, blockNumber } = await chain.readAgreed('the account', (c, b) => readFactsAt(c, account, guardian, b), { atLeast });
  return { account, blockNumber, ...value };
}

export function accountProblems(f: AccountFacts): AccountProblem[] {
  if (!f.hasCode) return ['not-a-contract'];
  if (f.safeVersion === null) return ['not-a-safe'];
  const problems: AccountProblem[] = [];
  if (!f.exitModuleEnabled) problems.push('exit-copy-off');
  if (!f.isExitGuardian) problems.push('not-guardian');
  else if (f.exitThreshold !== 1n) problems.push('threshold-not-one');
  return problems;
}

/**
 * Code that makes an address a contract wallet. A key wallet with an EIP-7702 delegation (live on Gnosis since
 * Pectra) holds 23 bytes of "code": 0xef0100 and the delegate's address. It still signs with its key, as Safe
 * needs, so it counts as a plain wallet. Wallet apps set such a delegation on their own.
 */
export function isContractCode(code: Hex | undefined): boolean {
  if (!code || code === '0x') return false;
  return !(code.length === 2 + 46 && code.toLowerCase().startsWith('0xef0100'));
}

/** A real account: a Safe proxy (its code), not a contract that only answers like one. */
export function isSafeProxy(f: AccountFacts): boolean {
  return f.codeHash === SAFE_PROXY_CODE_KECCAK256;
}

export interface NewOwnerFacts {
  candidate: Address;
  isExitGuardian: boolean;
  is14DayGuardian: boolean;
  /** The address is a contract wallet (isContractCode). The page can send only for a key wallet. */
  hasCode: boolean;
  /**
   * The account itself would take this owner: the owner change that Finish makes (swapOwner, run as the exit copy
   * through execTransactionFromModule), tried now with eth_call. It catches every refusal of Safe's own rules
   * (GS203, GS204), and of any guard on module calls.
   */
  accountAccepts: boolean;
}

export async function readNewOwnerFacts(chain: Chain, f: AccountFacts, candidate: Address): Promise<NewOwnerFacts> {
  const { value } = await chain.readAgreed('the new owner', async (c, blockNumber) => {
    const accepts = async (): Promise<boolean> => {
      const current = f.owners[0];
      if (!current) return false;
      const swap = encodeFunctionData({ abi: SAFE_ABI, functionName: 'swapOwner', args: [SENTINEL_OWNERS, current, candidate] });
      try {
        return (await c.readContract({
          address: f.account,
          abi: SAFE_ABI,
          functionName: 'execTransactionFromModule',
          args: [f.account, 0n, swap, 0],
          account: EXIT_MODULE,
          blockNumber,
        })) as boolean;
      } catch (err) {
        if (contractSaidNo(err)) return false;
        throw err;
      }
    };
    const [exit, fourteen, code, accountAccepts] = await Promise.all([
      c.readContract({ address: EXIT_MODULE, abi: MODULE_ABI, functionName: 'isGuardian', args: [f.account, candidate], blockNumber }),
      c.readContract({ address: RECOVERY_MODULE_14_DAYS, abi: MODULE_ABI, functionName: 'isGuardian', args: [f.account, candidate], blockNumber }),
      c.getCode({ address: candidate, blockNumber }),
      accepts(),
    ]);
    return { isExitGuardian: exit as boolean, is14DayGuardian: fourteen as boolean, hasCode: isContractCode(code), accountAccepts };
  });
  return { candidate, ...value };
}

/**
 * Why a new owner is refused. The exit copy refuses its own guardians only at the finish, 90 days later, and it
 * never checks the others: these are the page's rules, checked before the start.
 */
export function newOwnerRefusals(f: AccountFacts, n: NewOwnerFacts): NewOwnerRefusal[] {
  const r: NewOwnerRefusal[] = [];
  if (isAddressEqual(n.candidate, zeroAddress)) r.push('zero-address');
  if (isAddressEqual(n.candidate, f.account)) r.push('the-account');
  if (f.owners.some((o) => isAddressEqual(o, n.candidate))) r.push('current-owner');
  if (n.isExitGuardian) r.push('guardian-exit-copy');
  if (n.is14DayGuardian) r.push('guardian-14-day-copy');
  if (n.hasCode && !r.includes('the-account')) r.push('contract-wallet');
  if (!n.accountAccepts && r.length === 0) r.push('owner-refused');
  return r;
}

/** Where the euros may go. An address that cannot use them is refused. */
export function destinationRefusals(f: AccountFacts, to: Address): DestinationRefusal[] {
  const r: DestinationRefusal[] = [];
  if (isAddressEqual(to, zeroAddress)) r.push('zero-address');
  if (isAddressEqual(to, f.account)) r.push('the-account');
  if (isAddressEqual(to, EURE)) r.push('the-token');
  if (isAddressEqual(to, EXIT_MODULE) || isAddressEqual(to, RECOVERY_MODULE_14_DAYS)) r.push('a-recovery-copy');
  return r;
}

/** The take-over can be finished: the chain's time has reached executeAfter. */
export function canFinish(f: AccountFacts): boolean {
  return f.request !== null && f.blockTime >= f.request.executeAfter;
}

// ---- Finding the account from the words ----

const GUARDIAN_ADDED = MODULE_ABI.find((e) => e.type === 'event' && e.name === 'GuardianAdded') as AbiEvent;

/**
 * Accounts where the words' first address was ever added as a guardian of the exit copy (its GuardianAdded
 * records). Each one still needs readAccount: a guardian may have been removed since.
 */
export async function findAccounts(chain: Chain, guardian: Address, options: Partial<ScanOptions> = {}): Promise<Address[]> {
  const logs = await scanLogs(
    chain,
    'the account search',
    (c, fromBlock, toBlock) => c.getLogs({ address: EXIT_MODULE, event: GUARDIAN_ADDED, args: { guardian }, fromBlock, toBlock, strict: true }),
    { fromBlock: EXIT_MODULE_SEARCH_FROM_BLOCK, ...options },
  );
  const wallets = logs.map((l) => getAddress((l.args as { wallet: Address }).wallet));
  return [...new Set(wallets)];
}

/**
 * The search's finds that are real accounts the words can take over, with their facts (to show their balances).
 * Any contract can write a GuardianAdded record with any guardian, so a find counts only when it is a Safe proxy
 * and passes every account check.
 */
export async function readSearchCandidates(chain: Chain, found: readonly Address[], guardian: Address): Promise<AccountFacts[]> {
  const facts: AccountFacts[] = [];
  for (const account of found) {
    const f = await readAccount(chain, account, guardian);
    if (isSafeProxy(f) && accountProblems(f).length === 0) facts.push(f);
  }
  return facts;
}

export type TakeOverEvent = { kind: 'started' | 'stopped' | 'finished'; blockNumber: bigint; time: bigint };

const HISTORY_EVENTS = ['RecoveryExecuted', 'RecoveryCanceled', 'RecoveryFinalized'] as const;
const HISTORY_KIND = { RecoveryExecuted: 'started', RecoveryCanceled: 'stopped', RecoveryFinalized: 'finished' } as const;

/**
 * The account's last take-over record on the exit copy: so a user who comes back after the owner stopped the
 * take-over reads that plainly, with the date. Nothing is stored on the device for this.
 */
export async function readLastTakeOverEvent(chain: Chain, account: Address, options: Partial<ScanOptions> = {}): Promise<TakeOverEvent | null> {
  const events = HISTORY_EVENTS.map((name) => MODULE_ABI.find((e) => e.type === 'event' && e.name === name) as AbiEvent);
  const topics = events.map((e) => toEventSelector(e));
  const logs = await scanLogs(
    chain,
    'the account history',
    async (c, fromBlock, toBlock) =>
      (await c.request({
        method: 'eth_getLogs',
        params: [{ address: EXIT_MODULE, topics: [topics, pad(account)], fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${toBlock.toString(16)}` }],
      })) as { topics: [Hex, ...Hex[]]; data: Hex; blockNumber: Hex; logIndex: Hex }[],
    { fromBlock: EXIT_MODULE_SEARCH_FROM_BLOCK, ...options },
  );
  const last = logs.at(-1);
  if (!last) return null;
  const decoded = decodeEventLog({ abi: events, topics: last.topics, data: last.data });
  const blockNumber = BigInt(last.blockNumber);
  const time = await chain.read('a block time', async (c) => (await c.getBlock({ blockNumber })).timestamp);
  return { kind: HISTORY_KIND[decoded.eventName as (typeof HISTORY_EVENTS)[number]], blockNumber, time };
}

// ---- Fees ----

/** The fee one transaction needs at today's price, with a margin: gas x max fee per gas. */
export async function feeFor(chain: Chain, estimateGas: (c: PublicClient) => Promise<bigint>): Promise<bigint> {
  return chain.read('the fee', async (c) => {
    const [gas, fees] = await Promise.all([estimateGas(c), c.estimateFeesPerGas()]);
    return ((gas * 12n) / 10n) * fees.maxFeePerGas;
  });
}

export async function readXdaiBalance(chain: Chain, address: Address): Promise<bigint> {
  const { value } = await chain.readAgreed('the fee balance', (c, blockNumber) => c.getBalance({ address, blockNumber }));
  return value;
}

export function startGas(account: Address, newOwner: Address, guardian: Address) {
  return (c: PublicClient) =>
    c.estimateContractGas({ address: EXIT_MODULE, abi: MODULE_ABI, functionName: 'confirmRecovery', args: [account, [newOwner], 1n, true], account: guardian });
}

export function finishGas(account: Address, sender: Address) {
  return (c: PublicClient) => c.estimateContractGas({ address: EXIT_MODULE, abi: MODULE_ABI, functionName: 'finalizeRecovery', args: [account], account: sender });
}

// ---- Transactions ----

export interface Sent {
  transactionHash: Hex;
  blockNumber: bigint;
}

export interface SendOptions {
  /** Called as soon as the transaction is sent, before it is confirmed: the page shows its link at once. */
  onSent?: (transactionHash: Hex) => void;
  /** How long to wait for the confirmation. Default 3 minutes. */
  timeoutMs?: number;
}

/**
 * Simulate, send from a key on this device, wait, and require success. Refused while an earlier transaction of
 * the same key is still on its way, so a second tap never sends a second transaction.
 */
export async function sendCall(
  chain: Chain,
  from: LocalAccount,
  call: { address: Address; abi: typeof MODULE_ABI; functionName: string; args: readonly unknown[] },
  options: SendOptions = {},
): Promise<Sent & { logs: Log[] }> {
  const node = await chain.sendNode();
  const [confirmed, pending] = await Promise.all([
    node.client.getTransactionCount({ address: from.address, blockTag: 'latest' }),
    node.client.getTransactionCount({ address: from.address, blockTag: 'pending' }),
  ]);
  if (pending > confirmed) throw new PageRefusal(['transaction-pending']);
  const { request } = await node.client.simulateContract({ ...call, account: from });
  const wallet = createWalletClient({ account: from, chain: gnosis, transport: node.transport });
  const hash = await wallet.writeContract(request);
  options.onSent?.(hash);
  let receipt;
  try {
    receipt = await node.client.waitForTransactionReceipt({ hash, pollingInterval: 2_000, timeout: options.timeoutMs ?? 180_000 });
  } catch (err) {
    if (err instanceof WaitForTransactionReceiptTimeoutError) throw new TxStillPending(hash);
    throw err;
  }
  if (receipt.status !== 'success') throw new Error(`the transaction ${hash} failed`);
  return { transactionHash: hash, blockNumber: receipt.blockNumber, logs: receipt.logs };
}

/**
 * Start: the words' first address, the guardian, sends confirmRecovery(account, [newOwner], 1, true). With
 * threshold 1 that one call is the approval and the start. Every page check runs again first, on fresh reads.
 */
export async function startTakeOver(
  chain: Chain,
  guardian: LocalAccount,
  account: Address,
  newOwner: Address,
  options: SendOptions = {},
): Promise<Sent & { request: RecoveryRequest }> {
  const facts = await readAccount(chain, account, guardian.address);
  const problems = accountProblems(facts);
  if (problems.length > 0) throw new PageRefusal(problems);
  if (facts.request) throw new PageRefusal(['already-started']);
  const refusals = newOwnerRefusals(facts, await readNewOwnerFacts(chain, facts, newOwner));
  if (refusals.length > 0) throw new PageRefusal(refusals);
  const sent = await sendCall(chain, guardian, { address: EXIT_MODULE, abi: MODULE_ABI, functionName: 'confirmRecovery', args: [account, [newOwner], 1n, true] }, options);
  const after = await readAccount(chain, account, guardian.address, sent.blockNumber);
  if (!after.request || after.request.newOwners.length !== 1 || !isAddressEqual(after.request.newOwners[0]!, newOwner)) {
    throw new CouldNotRead('the started take-over');
  }
  return { ...sent, request: after.request };
}

/** Finish: anyone may send finalizeRecovery once the chain's time has reached executeAfter. */
export async function finishTakeOver(
  chain: Chain,
  sender: LocalAccount,
  account: Address,
  guardian: Address,
  options: SendOptions = {},
): Promise<Sent & { owners: Address[] }> {
  const facts = await readAccount(chain, account, guardian);
  if (!facts.request) throw new PageRefusal(['no-take-over']);
  if (!canFinish(facts)) throw new PageRefusal(['too-early']);
  const sent = await sendCall(chain, sender, { address: EXIT_MODULE, abi: MODULE_ABI, functionName: 'finalizeRecovery', args: [account] }, options);
  const after = await readAccount(chain, account, guardian, sent.blockNumber);
  const want = facts.request.newOwners;
  if (after.owners.length !== want.length || !want.every((o, i) => isAddressEqual(o, after.owners[i]!))) {
    throw new CouldNotRead('the new owner');
  }
  return { ...sent, owners: after.owners };
}
