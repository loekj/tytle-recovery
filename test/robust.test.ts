// SPDX-License-Identifier: GPL-3.0-only
//
// The page's logic where real life is rough: odd signature forms, fake
// accounts in the search, new owners Safe refuses, nodes that fail half-way,
// a transaction that is slow, and the account's other (14-day) recovery.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { getAddress, keccak256, parseEther, toFunctionSelector, type AbiFunction, type Address, type EIP1193Provider } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import moduleAbi from '../abi/SocialRecoveryModule.json' with { type: 'json' };
import { DEPLOYED_14_DAY_MODULE } from '../scripts/lib/addresses.ts';
import { SAFE_ABI } from '../page/src/abi.ts';
import { Chain, CouldNotRead, nodeFromProvider } from '../page/src/chain.ts';
import { EURE, EXIT_MODULE, SAFE_PROXY_CODE_KECCAK256 } from '../page/src/config.ts';
import {
  PageRefusal,
  TxStillPending,
  accountProblems,
  findAccounts,
  isContractCode,
  isSafeProxy,
  newOwnerRefusals,
  readAccount,
  readNewOwnerFacts,
  readSearchCandidates,
  startTakeOver,
} from '../page/src/exit.ts';
import { normalizeSignature } from '../page/src/safeTx.ts';
import { deriveAccounts, type WordAccounts } from '../page/src/words.ts';
import { WORDS_A, fund, makeAccount, startWorld, testContractCode, type World } from './support/world.ts';

describe('signatures in every form a wallet gives', () => {
  test('v = 0 or 1, and 64-byte compact signatures, become the 65-byte v = 27/28 form', async () => {
    const key = privateKeyToAccount(generatePrivateKey());
    const sig = await key.signMessage({ message: 'x' });
    const r = sig.slice(2, 66);
    const s = BigInt(`0x${sig.slice(66, 130)}`);
    const yParity = Number.parseInt(sig.slice(130), 16) - 27;
    const v01 = `0x${r}${s.toString(16).padStart(64, '0')}0${yParity}` as const;
    const compact = `0x${r}${(s | (BigInt(yParity) << 255n)).toString(16).padStart(64, '0')}` as const;
    assert.equal(normalizeSignature(sig), sig);
    assert.equal(normalizeSignature(v01), sig);
    assert.equal(normalizeSignature(compact), sig);
    assert.ok(['1b', '1c'].includes(normalizeSignature(v01).slice(-2)));
  });
});

describe('the logic on a local chain, when things go wrong', () => {
  let w: World;
  let keys: WordAccounts;
  let owner: Address;
  let tytleGuardian: Address;
  let safe: Address;

  before(async () => {
    w = await startWorld();
    keys = deriveAccounts(WORDS_A);
    [owner, tytleGuardian] = [w.accounts[2]!, w.accounts[3]!];
    await fund(w, keys.guardian.address, parseEther('1'));
    safe = await makeAccount(w, { owner, exitGuardian: keys.guardian.address, tytleGuardian, eure: parseEther('50') });
  });
  after(() => w?.close());

  test("a real account has a Safe proxy's code: the page's pinned hash", async () => {
    const code = await w.client.getCode({ address: safe });
    assert.equal(keccak256(code!), SAFE_PROXY_CODE_KECCAK256);
    assert.equal(isSafeProxy(await readAccount(w.pageChain, safe, keys.guardian.address)), true);
  });

  test('a contract that only answers like an account is found by the record search, but never offered', async () => {
    const fake: Address = getAddress('0x00000000000000000000000000000000000fa4e1');
    await w.test.setCode({ address: fake, bytecode: testContractCode('FakeAccount.sol', 'FakeAccount') });
    const hash = await w.walletFor(w.accounts[9]!).writeContract({
      address: fake,
      abi: [{ type: 'function', name: 'addGuardian', inputs: [{ name: 'module', type: 'address' }, { name: 'guardian', type: 'address' }], outputs: [], stateMutability: 'nonpayable' }],
      functionName: 'addGuardian',
      args: [EXIT_MODULE, keys.guardian.address],
      account: w.accounts[9]!,
    });
    await w.client.waitForTransactionReceipt({ hash });
    const found = await findAccounts(w.pageChain, keys.guardian.address, { fromBlock: 0n });
    assert.ok(found.includes(fake) && found.includes(safe));
    // Why the code check is needed: the fake passes every check that only asks it questions.
    assert.deepEqual(accountProblems(await readAccount(w.pageChain, fake, keys.guardian.address)), []);
    const offered = await readSearchCandidates(w.pageChain, found, keys.guardian.address);
    assert.deepEqual(offered.map((f) => f.account), [safe]);
    assert.equal(offered[0]!.eureBalance, parseEther('50'));
  });

  test("Safe's own owner marker (0x...01) and a contract are refused as new owner, before any transaction", async () => {
    const facts = await readAccount(w.pageChain, safe, keys.guardian.address);
    const sentinel: Address = '0x0000000000000000000000000000000000000001';
    assert.deepEqual(newOwnerRefusals(facts, await readNewOwnerFacts(w.pageChain, facts, sentinel)), ['owner-refused']);
    assert.deepEqual(newOwnerRefusals(facts, await readNewOwnerFacts(w.pageChain, facts, EURE)), ['contract-wallet']);
    const nonce = await w.client.getTransactionCount({ address: keys.guardian.address });
    await assert.rejects(startTakeOver(w.pageChain, keys.guardian, safe, sentinel), (e: unknown) => e instanceof PageRefusal && e.reasons.includes('owner-refused'));
    assert.equal(await w.client.getTransactionCount({ address: keys.guardian.address }), nonce);
  });

  test('a key wallet with an EIP-7702 delegation is a plain wallet, not a contract: it is accepted as new owner', async () => {
    const delegated = privateKeyToAccount(generatePrivateKey()).address;
    // 0xef0100 + a delegate's address: the 23-byte designator such a wallet holds on Gnosis.
    await w.test.setCode({ address: delegated, bytecode: `0xef0100${EXIT_MODULE.slice(2).toLowerCase()}` });
    assert.equal(isContractCode(await w.client.getCode({ address: delegated })), false);
    assert.equal(isContractCode(testContractCode('FakeAccount.sol', 'FakeAccount')), true);
    const facts = await readAccount(w.pageChain, safe, keys.guardian.address);
    assert.deepEqual(newOwnerRefusals(facts, await readNewOwnerFacts(w.pageChain, facts, delegated)), []);
  });

  test('the account accepts the default new owner (the owner change Finish makes, tried now)', async () => {
    const facts = await readAccount(w.pageChain, safe, keys.guardian.address);
    const n = await readNewOwnerFacts(w.pageChain, facts, keys.newOwner.address);
    assert.equal(n.accountAccepts, true);
    assert.equal(n.hasCode, false);
  });

  test('a node that fails on VERSION() with a node error: "could not read", never "not a Tytle account"', async () => {
    const version = toFunctionSelector(SAFE_ABI.find((e) => e.type === 'function' && e.name === 'VERSION') as AbiFunction);
    const flaky = {
      request: async (r: { method: string; params?: unknown }) => {
        if (r.method === 'eth_call' && (r.params as [{ data?: string }])[0].data?.startsWith(version)) throw new Error('429 Too Many Requests');
        return w.provider.request(r as never);
      },
      on: () => undefined,
      removeListener: () => undefined,
    } as unknown as EIP1193Provider;
    const chain = new Chain([nodeFromProvider('flaky 1', flaky), nodeFromProvider('flaky 2', flaky)]);
    await assert.rejects(readAccount(chain, safe, keys.guardian.address), CouldNotRead);
    // A third, good node is paired in place of a failing one.
    const mixed = new Chain([nodeFromProvider('flaky', flaky), nodeFromProvider('good 1', w.provider), nodeFromProvider('good 2', w.provider)]);
    assert.equal((await readAccount(mixed, safe, keys.guardian.address)).safeVersion, '1.4.1');
  });

  test('a slow start: its link comes at once, a second tap sends nothing, and the start lands later', async () => {
    const acct = await makeAccount(w, { owner, exitGuardian: keys.guardian.address, tytleGuardian });
    await w.test.setAutomine(false);
    try {
      let shown: string | undefined;
      await assert.rejects(
        startTakeOver(w.pageChain, keys.guardian, acct, keys.newOwner.address, { onSent: (h) => (shown = h), timeoutMs: 300 }),
        (e: unknown) => e instanceof TxStillPending && e.transactionHash === shown,
      );
      assert.ok(shown, 'the link was given before the wait');
      await assert.rejects(startTakeOver(w.pageChain, keys.guardian, acct, keys.newOwner.address), (e: unknown) => e instanceof PageRefusal && e.reasons.includes('transaction-pending'));
      await w.test.mine({ blocks: 1 });
      assert.deepEqual((await readAccount(w.pageChain, acct, keys.guardian.address)).request?.newOwners, [keys.newOwner.address]);
    } finally {
      await w.test.setAutomine(true);
    }
  });

  test("the account's 14-day recovery, when one runs, is read and shown", async () => {
    const acct = await makeAccount(w, { owner, exitGuardian: keys.guardian.address, tytleGuardian });
    assert.equal((await readAccount(w.pageChain, acct, keys.guardian.address)).request14Day, null);
    const hash = await w.walletFor(tytleGuardian).writeContract({
      address: DEPLOYED_14_DAY_MODULE,
      abi: moduleAbi,
      functionName: 'confirmRecovery',
      args: [acct, [w.accounts[11]!], 1n, true],
      account: tytleGuardian,
    });
    await w.client.waitForTransactionReceipt({ hash });
    const f = await readAccount(w.pageChain, acct, keys.guardian.address);
    assert.deepEqual(f.request14Day?.newOwners, [w.accounts[11]]);
    assert.equal(f.request, null);
  });

  test('a removed owner list never counts as accepted: an address with no account gives no owner change', async () => {
    const facts = await readAccount(w.pageChain, w.accounts[12]!, keys.guardian.address);
    const n = await readNewOwnerFacts(w.pageChain, { ...facts, account: safe, owners: [] }, keys.newOwner.address);
    assert.equal(n.accountAccepts, false);
    assert.deepEqual(newOwnerRefusals({ ...facts, account: safe, owners: [] }, n), ['owner-refused']);
  });
});
