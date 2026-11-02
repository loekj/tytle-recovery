// SPDX-License-Identifier: GPL-3.0-only
//
// Finding the account from the words alone (the exit copy's GuardianAdded
// records), and reading the chain when nodes fail: the page says "could not
// read" and never shows a guessed value.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { encodeFunctionData, parseEther, toFunctionSelector, type AbiFunction, type Address } from 'viem';
import moduleAbi from '../abi/SocialRecoveryModule.json' with { type: 'json' };
import { EURE_ABI } from '../page/src/abi.ts';
import { Chain, CouldNotRead, NodesDisagree, nodeFromProvider } from '../page/src/chain.ts';
import { EURE, EXIT_MODULE } from '../page/src/config.ts';
import { accountProblems, findAccounts, readAccount, readLastTakeOverEvent, readXdaiBalance, startTakeOver } from '../page/src/exit.ts';
import { deriveAccounts, type WordAccounts } from '../page/src/words.ts';
import { deadNode, liar, noLogs, rangeLimited } from './support/nodes.ts';
import { WORDS_A, WORDS_B, execAsOwner, fund, makeAccount, startWorld, type World } from './support/world.ts';

const SENTINEL_GUARDIANS = '0x0000000000000000000000000000000000000001';

describe('the account search and unreadable chains', () => {
  let w: World;
  let a: WordAccounts;
  let b: WordAccounts;
  let ofA: Address[];
  let ofB: Address;
  let revoked: Address;

  before(async () => {
    w = await startWorld();
    a = deriveAccounts(WORDS_A);
    b = deriveAccounts(WORDS_B);
    const [owner, tytleGuardian] = [w.accounts[2]!, w.accounts[3]!];
    ofA = [
      await makeAccount(w, { owner, exitGuardian: a.guardian.address, tytleGuardian, eure: parseEther('1') }),
      await makeAccount(w, { owner: w.accounts[4]!, exitGuardian: a.guardian.address, tytleGuardian }),
    ];
    ofB = await makeAccount(w, { owner, exitGuardian: b.guardian.address, tytleGuardian });
    revoked = await makeAccount(w, { owner, exitGuardian: a.guardian.address, tytleGuardian });
    await execAsOwner(w, revoked, owner, EXIT_MODULE, encodeFunctionData({ abi: moduleAbi, functionName: 'revokeGuardianWithThreshold', args: [SENTINEL_GUARDIANS, a.guardian.address, 0n] }));
  });
  after(() => w?.close());

  test("the GuardianAdded search finds every account the words' first address was added to", async () => {
    const found = await findAccounts(w.pageChain, a.guardian.address, { fromBlock: 0n });
    assert.deepEqual(new Set(found), new Set([...ofA, revoked]));
    assert.deepEqual(await findAccounts(w.pageChain, b.guardian.address, { fromBlock: 0n }), [ofB]);
  });

  test('an account whose guardian was removed since is found, and then refused by the account check', async () => {
    assert.deepEqual(accountProblems(await readAccount(w.pageChain, revoked, a.guardian.address)), ['not-guardian']);
  });

  test("a node's range limit makes the steps smaller; the search still finds everything", async () => {
    const limited = rangeLimited(w.provider, 3);
    const chain = new Chain([nodeFromProvider('limited', limited.provider)]);
    const found = await findAccounts(chain, a.guardian.address, { fromBlock: 0n, maxStep: 64n, minStep: 2n });
    assert.deepEqual(new Set(found), new Set([...ofA, revoked]));
    assert.ok(limited.logCalls() > 3, 'it read in several steps');
  });

  test('a node that serves no records hands over to the next node', async () => {
    const chain = new Chain([nodeFromProvider('no logs', noLogs(w.provider)), nodeFromProvider('good', w.provider)]);
    const found = await findAccounts(chain, b.guardian.address, { fromBlock: 0n, maxStep: 16n, minStep: 4n });
    assert.deepEqual(found, [ofB]);
  });

  test("the account's last take-over record: started, then stopped", async () => {
    const [owner, tytleGuardian] = [w.accounts[2]!, w.accounts[3]!];
    const acct = await makeAccount(w, { owner, exitGuardian: a.guardian.address, tytleGuardian });
    assert.equal(await readLastTakeOverEvent(w.pageChain, acct, { fromBlock: 0n }), null);
    await fund(w, a.guardian.address, parseEther('1'));
    await startTakeOver(w.pageChain, a.guardian, acct, a.newOwner.address);
    assert.equal((await readLastTakeOverEvent(w.pageChain, acct, { fromBlock: 0n }))?.kind, 'started');
    await execAsOwner(w, acct, owner, EXIT_MODULE, encodeFunctionData({ abi: moduleAbi, functionName: 'cancelRecovery' }));
    const last = await readLastTakeOverEvent(w.pageChain, acct, { fromBlock: 0n });
    assert.equal(last?.kind, 'stopped');
    assert.equal(last?.time, (await w.client.getBlock()).timestamp);
  });

  test('no node answers: every read says "could not read", none returns a value', async () => {
    const chain = new Chain([nodeFromProvider('dead 1', deadNode), nodeFromProvider('dead 2', deadNode)]);
    await assert.rejects(readAccount(chain, ofA[0]!, a.guardian.address), CouldNotRead);
    await assert.rejects(readXdaiBalance(chain, a.guardian.address), CouldNotRead);
    await assert.rejects(findAccounts(chain, a.guardian.address, { fromBlock: 0n }), CouldNotRead);
  });

  test('one dead node and one good node: a read the user acts on needs two, so it fails', async () => {
    const chain = new Chain([nodeFromProvider('dead', deadNode), nodeFromProvider('good', w.provider)]);
    await assert.rejects(readAccount(chain, ofA[0]!, a.guardian.address), CouldNotRead);
    // With a third node that answers, the read goes ahead.
    const three = new Chain([nodeFromProvider('dead', deadNode), nodeFromProvider('good 1', w.provider), nodeFromProvider('good 2', w.provider)]);
    assert.equal((await readAccount(three, ofA[0]!, a.guardian.address)).eureBalance, parseEther('1'));
  });

  test('two nodes that answer differently: the page refuses to pick one', async () => {
    const balanceOf = toFunctionSelector(EURE_ABI.find((e) => e.type === 'function' && e.name === 'balanceOf') as AbiFunction);
    const chain = new Chain([nodeFromProvider('good', w.provider), nodeFromProvider('liar', liar(w.provider, EURE, balanceOf))]);
    await assert.rejects(readAccount(chain, ofA[0]!, a.guardian.address), NodesDisagree);
    await assert.rejects(readXdaiBalance(chain, a.guardian.address), NodesDisagree);
  });
});
