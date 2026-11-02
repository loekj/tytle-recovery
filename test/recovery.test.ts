// SPDX-License-Identifier: GPL-3.0-only
//
// The exit on a local chain with the real contract code, through the page's
// own functions:
// - the words alone start a take-over; an address that is not a guardian cannot;
// - the owner stops it (cancelRecovery + invalidateNonce), and an old approval
//   cannot start it again;
// - Finish fails before 90 days and works after: the new owner is then the only owner;
// - the new owner's signed EURe transfer, sent by the words' first address,
//   moves the whole balance.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { encodeFunctionData, parseEther, zeroAddress, type Address } from 'viem';
import moduleAbi from '../abi/SocialRecoveryModule.json' with { type: 'json' };
import safeAbi from '../abi/SafeL2.json' with { type: 'json' };
import { RECOVERY_PERIOD_90_DAYS } from '../scripts/lib/addresses.ts';
import { EURE, EXIT_MODULE } from '../page/src/config.ts';
import { PageRefusal, canFinish, finishTakeOver, readAccount, startTakeOver } from '../page/src/exit.ts';
import { chooseSendPath, signWithKey } from '../page/src/send.ts';
import { deriveAccounts, type WordAccounts } from '../page/src/words.ts';
import { TEST_TOKEN_ABI, WORDS_A, execAsOwner, fund, makeAccount, passTime, startWorld, type World } from './support/world.ts';

describe('the exit on a local chain', () => {
  let w: World;
  let keys: WordAccounts;
  let owner: Address;
  let tytleGuardian: Address;

  before(async () => {
    w = await startWorld();
    keys = deriveAccounts(WORDS_A);
    [owner, tytleGuardian] = [w.accounts[2]!, w.accounts[3]!];
    await fund(w, keys.guardian.address, parseEther('1'));
  });
  after(() => w?.close());

  test('the words alone start a take-over; an address that is not a guardian cannot', async () => {
    const safe = await makeAccount(w, { owner, exitGuardian: keys.guardian.address, tytleGuardian, eure: parseEther('10') });
    const stranger = w.accounts[4]!;
    await assert.rejects(
      w.client.simulateContract({ address: EXIT_MODULE, abi: moduleAbi, functionName: 'confirmRecovery', args: [safe, [stranger], 1n, true], account: stranger }),
      /SM: sender not a guardian/,
    );
    // Tytle's guardian guards the 14-day copy, not the exit copy.
    await assert.rejects(
      w.client.simulateContract({ address: EXIT_MODULE, abi: moduleAbi, functionName: 'confirmRecovery', args: [safe, [stranger], 1n, true], account: tytleGuardian }),
      /SM: sender not a guardian/,
    );
    const started = await startTakeOver(w.pageChain, keys.guardian, safe, keys.newOwner.address);
    const block = await w.client.getBlock({ blockNumber: started.blockNumber });
    assert.deepEqual(started.request.newOwners, [keys.newOwner.address]);
    assert.equal(started.request.executeAfter, block.timestamp + RECOVERY_PERIOD_90_DAYS);
  });

  test('the owner stops it with cancelRecovery + invalidateNonce, and an old approval cannot start it again', async () => {
    const safe = await makeAccount(w, { owner, exitGuardian: keys.guardian.address, tytleGuardian });
    await startTakeOver(w.pageChain, keys.guardian, safe, keys.newOwner.address);
    // A second approval with execute=false, made while the request is live, so a "shadow" approval exists.
    const confirmOnly = await w.walletFor(keys.guardian.address).writeContract({
      address: EXIT_MODULE,
      abi: moduleAbi,
      functionName: 'confirmRecovery',
      args: [safe, [keys.newOwner.address], 1n, false],
      account: keys.guardian,
    });
    await w.client.waitForTransactionReceipt({ hash: confirmOnly });

    await execAsOwner(w, safe, owner, EXIT_MODULE, encodeFunctionData({ abi: moduleAbi, functionName: 'cancelRecovery' }));
    await execAsOwner(w, safe, owner, EXIT_MODULE, encodeFunctionData({ abi: moduleAbi, functionName: 'invalidateNonce' }));
    assert.equal((await readAccount(w.pageChain, safe, keys.guardian.address)).request, null);

    // Anyone may call executeRecovery with existing approvals: the old ones no longer count.
    await assert.rejects(
      w.client.simulateContract({ address: EXIT_MODULE, abi: moduleAbi, functionName: 'executeRecovery', args: [safe, [keys.newOwner.address], 1n], account: w.accounts[5]! }),
      /SM: confirmed signatures less than threshold/,
    );
  });

  test('without invalidateNonce, that shadow approval would start it again (why the stop needs both calls)', async () => {
    const safe = await makeAccount(w, { owner, exitGuardian: keys.guardian.address, tytleGuardian });
    await startTakeOver(w.pageChain, keys.guardian, safe, keys.newOwner.address);
    const confirmOnly = await w.walletFor(keys.guardian.address).writeContract({
      address: EXIT_MODULE,
      abi: moduleAbi,
      functionName: 'confirmRecovery',
      args: [safe, [keys.newOwner.address], 1n, false],
      account: keys.guardian,
    });
    await w.client.waitForTransactionReceipt({ hash: confirmOnly });
    await execAsOwner(w, safe, owner, EXIT_MODULE, encodeFunctionData({ abi: moduleAbi, functionName: 'cancelRecovery' }));
    await w.client.simulateContract({ address: EXIT_MODULE, abi: moduleAbi, functionName: 'executeRecovery', args: [safe, [keys.newOwner.address], 1n], account: w.accounts[5]! });
  });

  test('Finish fails before 90 days and works after; then the new owner is the only owner', async () => {
    const safe = await makeAccount(w, { owner, exitGuardian: keys.guardian.address, tytleGuardian });
    const started = await startTakeOver(w.pageChain, keys.guardian, safe, keys.newOwner.address);
    await assert.rejects(finishTakeOver(w.pageChain, keys.guardian, safe, keys.guardian.address), (e: unknown) => e instanceof PageRefusal && e.reasons.includes('too-early'));
    // The contract refuses too, not only the page.
    await assert.rejects(
      w.client.simulateContract({ address: EXIT_MODULE, abi: moduleAbi, functionName: 'finalizeRecovery', args: [safe], account: keys.guardian.address }),
      /SM: recovery period still pending/,
    );
    const now = (await w.client.getBlock()).timestamp;
    await passTime(w, started.request.executeAfter - now - 5n);
    assert.equal(canFinish(await readAccount(w.pageChain, safe, keys.guardian.address)), false, 'five seconds before the end: not yet');
    await passTime(w, 10n);
    const done = await finishTakeOver(w.pageChain, keys.guardian, safe, keys.guardian.address);
    assert.deepEqual(done.owners, [keys.newOwner.address]);
    assert.equal(await w.client.readContract({ address: safe, abi: safeAbi, functionName: 'getThreshold' }), 1n);
  });

  test("the new owner's signed transfer, sent by the words' first address, moves the whole balance", async () => {
    const balance = parseEther('2340.12');
    const safe = await makeAccount(w, { owner, exitGuardian: keys.guardian.address, tytleGuardian, eure: balance });
    const started = await startTakeOver(w.pageChain, keys.guardian, safe, keys.newOwner.address);
    await passTime(w, RECOVERY_PERIOD_90_DAYS);
    await finishTakeOver(w.pageChain, keys.guardian, safe, keys.guardian.address);
    assert.ok(started.request);

    const facts = await readAccount(w.pageChain, safe, keys.guardian.address);
    const choice = chooseSendPath(w.pageChain, facts, keys.guardian, keys.guardian.address);
    assert.equal(choice.kind, 'ready');
    if (choice.kind !== 'ready') return;
    const to = w.accounts[6]!;
    const prepared = await choice.path.prepare(to);
    assert.equal(prepared.amount, balance);
    // The page's EIP-712 hash is the account's own getTransactionHash (prepare refuses otherwise).
    assert.equal(
      await w.client.readContract({
        address: safe,
        abi: safeAbi,
        functionName: 'getTransactionHash',
        args: [prepared.tx.to, 0n, prepared.tx.data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, prepared.tx.nonce],
      }),
      prepared.hash,
    );
    const newOwnerBefore = await w.client.getBalance({ address: keys.newOwner.address });
    const outcome = await choice.path.submit(prepared, await signWithKey(keys.newOwner, prepared));
    assert.equal(outcome.kind, 'sent');
    assert.equal(await w.client.readContract({ address: EURE, abi: TEST_TOKEN_ABI, functionName: 'balanceOf', args: [safe] }), 0n);
    assert.equal(await w.client.readContract({ address: EURE, abi: TEST_TOKEN_ABI, functionName: 'balanceOf', args: [to] }), balance);
    // Only the words' first address paid fees: the new owner never needed xDAI.
    assert.equal(await w.client.getBalance({ address: keys.newOwner.address }), newOwnerBefore);
  });

  test('a signature from anyone but the owner is refused before any transaction', async () => {
    const safe = await makeAccount(w, { owner, exitGuardian: keys.guardian.address, tytleGuardian, eure: parseEther('5') });
    await startTakeOver(w.pageChain, keys.guardian, safe, keys.newOwner.address);
    await passTime(w, RECOVERY_PERIOD_90_DAYS);
    await finishTakeOver(w.pageChain, keys.guardian, safe, keys.guardian.address);
    const facts = await readAccount(w.pageChain, safe, keys.guardian.address);
    const choice = chooseSendPath(w.pageChain, facts, keys.guardian, keys.guardian.address);
    assert.equal(choice.kind, 'ready');
    if (choice.kind !== 'ready') return;
    const prepared = await choice.path.prepare(w.accounts[6]!);
    const nonceBefore = await w.client.getTransactionCount({ address: keys.guardian.address });
    await assert.rejects(choice.path.submit(prepared, await signWithKey(keys.guardian, prepared)), (e: unknown) => e instanceof PageRefusal && e.reasons.includes('signer-not-owner'));
    assert.equal(await w.client.getTransactionCount({ address: keys.guardian.address }), nonceBefore, 'no transaction was sent');
  });
});
