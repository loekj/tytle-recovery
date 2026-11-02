// SPDX-License-Identifier: GPL-3.0-only
//
// The checks before the start, on a local chain with the real contract code.
// Every wrong new owner is refused by the page before any transaction: the
// exit copy refuses its own guardians only at the finish, 90 days later, and
// it never checks the other cases.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { encodeFunctionData, parseEther, zeroAddress, type Address } from 'viem';
import moduleAbi from '../abi/SocialRecoveryModule.json' with { type: 'json' };
import { EURE, EXIT_MODULE } from '../page/src/config.ts';
import {
  PageRefusal,
  accountProblems,
  newOwnerRefusals,
  readAccount,
  readExitCopyPresent,
  readNewOwnerFacts,
  startTakeOver,
  type NewOwnerRefusal,
} from '../page/src/exit.ts';
import { deriveAccounts, type WordAccounts } from '../page/src/words.ts';
import { WORDS_A, WORDS_B, execAsOwner, fund, makeAccount, startWorld, type World } from './support/world.ts';

describe('the checks before the start', () => {
  let w: World;
  let keys: WordAccounts;
  let other: WordAccounts;
  let owner: Address;
  let tytleGuardian: Address;
  let safe: Address;

  before(async () => {
    w = await startWorld();
    keys = deriveAccounts(WORDS_A);
    other = deriveAccounts(WORDS_B);
    [owner, tytleGuardian] = [w.accounts[2]!, w.accounts[3]!];
    await fund(w, keys.guardian.address, parseEther('1'));
    safe = await makeAccount(w, { owner, exitGuardian: keys.guardian.address, tytleGuardian, eure: parseEther('100') });
  });
  after(() => w?.close());

  test('the exit copy is found with its exact code', async () => {
    assert.equal(await readExitCopyPresent(w.pageChain), true);
  });

  test('a good account has no problem and its facts are read', async () => {
    const f = await readAccount(w.pageChain, safe, keys.guardian.address);
    assert.deepEqual(accountProblems(f), []);
    assert.equal(f.safeVersion, '1.4.1');
    assert.deepEqual(f.owners, [owner]);
    assert.equal(f.guard, zeroAddress);
    assert.equal(f.exitThreshold, 1n);
    assert.equal(f.eureBalance, parseEther('100'));
    assert.equal(f.request, null);
  });

  test('an address with no code, or with code that is not a Safe, is not an account', async () => {
    assert.deepEqual(accountProblems(await readAccount(w.pageChain, w.accounts[7]!, keys.guardian.address)), ['not-a-contract']);
    assert.deepEqual(accountProblems(await readAccount(w.pageChain, EURE, keys.guardian.address)), ['not-a-safe']);
  });

  test('the exit copy turned off; words that do not guard the account; a threshold above 1', async () => {
    const off = await makeAccount(w, { owner, tytleGuardian, enableExitCopy: false });
    assert.deepEqual(accountProblems(await readAccount(w.pageChain, off, keys.guardian.address)), ['exit-copy-off', 'not-guardian']);

    const notOurs = await makeAccount(w, { owner, exitGuardian: other.guardian.address, tytleGuardian });
    assert.deepEqual(accountProblems(await readAccount(w.pageChain, notOurs, keys.guardian.address)), ['not-guardian']);

    const two = await makeAccount(w, { owner, exitGuardian: keys.guardian.address, tytleGuardian });
    await execAsOwner(w, two, owner, EXIT_MODULE, encodeFunctionData({ abi: moduleAbi, functionName: 'addGuardianWithThreshold', args: [other.guardian.address, 2n] }));
    assert.deepEqual(accountProblems(await readAccount(w.pageChain, two, keys.guardian.address)), ['threshold-not-one']);
    await assert.rejects(startTakeOver(w.pageChain, keys.guardian, two, keys.newOwner.address), (e: unknown) => e instanceof PageRefusal && e.reasons.includes('threshold-not-one'));
  });

  describe('a wrong new owner is refused before any transaction', () => {
    const cases: [string, () => Address, NewOwnerRefusal][] = [
      ["the words' first address (a guardian of the exit copy)", () => keys.guardian.address, 'guardian-exit-copy'],
      ["Tytle's guardian on the 14-day copy", () => tytleGuardian, 'guardian-14-day-copy'],
      ['the account itself', () => safe, 'the-account'],
      ['the zero address', () => zeroAddress, 'zero-address'],
      ['the current owner', () => owner, 'current-owner'],
    ];
    for (const [name, candidate, reason] of cases) {
      test(name, async () => {
        const facts = await readAccount(w.pageChain, safe, keys.guardian.address);
        const refusals = newOwnerRefusals(facts, await readNewOwnerFacts(w.pageChain, facts, candidate()));
        assert.ok(refusals.includes(reason), `${refusals.join(', ')} includes ${reason}`);
        const nonce = await w.client.getTransactionCount({ address: keys.guardian.address });
        await assert.rejects(startTakeOver(w.pageChain, keys.guardian, safe, candidate()), (e: unknown) => e instanceof PageRefusal && e.reasons.includes(reason));
        assert.equal(await w.client.getTransactionCount({ address: keys.guardian.address }), nonce, 'no transaction was sent');
        assert.equal((await readAccount(w.pageChain, safe, keys.guardian.address)).request, null);
      });
    }

    test('the chain itself would start with those owners: the page is what stops them', async () => {
      // The exit copy's start does not check the new owner, so each of these would start and wait 90 days.
      for (const candidate of [keys.guardian.address, tytleGuardian, owner]) {
        await w.client.simulateContract({ address: EXIT_MODULE, abi: moduleAbi, functionName: 'confirmRecovery', args: [safe, [candidate], 1n, true], account: keys.guardian.address });
      }
    });

    test("the default new owner (the words' second address) is accepted", async () => {
      const facts = await readAccount(w.pageChain, safe, keys.guardian.address);
      assert.deepEqual(newOwnerRefusals(facts, await readNewOwnerFacts(w.pageChain, facts, keys.newOwner.address)), []);
    });
  });

  test('a live take-over is shown, and a second start is refused', async () => {
    const live = await makeAccount(w, { owner, exitGuardian: keys.guardian.address, tytleGuardian });
    await startTakeOver(w.pageChain, keys.guardian, live, keys.newOwner.address);
    const f = await readAccount(w.pageChain, live, keys.guardian.address);
    assert.deepEqual(f.request?.newOwners, [keys.newOwner.address]);
    await assert.rejects(startTakeOver(w.pageChain, keys.guardian, live, keys.newOwner.address), (e: unknown) => e instanceof PageRefusal && e.reasons.includes('already-started'));
  });
});
