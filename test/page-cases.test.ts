// SPDX-License-Identifier: GPL-3.0-only
//
// The page's screens in the harder cases, in a test browser, on a local chain:
// the user's own wallet through a wallet extension, no extension, two
// extensions; a take-over started by someone else with the same words; coming
// back after Finish when the account's records cannot be read; two nodes that
// disagree; leaving the page; and a phone keyboard that types all 12 words
// into one box.

import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';
import { parseEther, toFunctionSelector, type AbiFunction, type Address } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { RECOVERY_PERIOD_90_DAYS } from '../scripts/lib/addresses.ts';
import { EURE_ABI } from '../page/src/abi.ts';
import { Chain, nodeFromProvider } from '../page/src/chain.ts';
import { EURE } from '../page/src/config.ts';
import { finishTakeOver, startTakeOver } from '../page/src/exit.ts';
import { deriveAccounts, type WordAccounts } from '../page/src/words.ts';
import { fakeWallet } from './support/fakeWallet.ts';
import { liar, noLogs } from './support/nodes.ts';
import { $, closePage, openPage, t, toAccount, waitFor, type Page } from './support/page.ts';
import { TEST_TOKEN_ABI, WORDS_A, fund, makeAccount, passTime, startWorld, type World } from './support/world.ts';

describe('the page in the harder cases', () => {
  let w: World;
  let keys: WordAccounts;
  let owner: Address;
  let tytleGuardian: Address;
  let page: Page | undefined;
  const local = () => w.pageChain;

  before(async () => {
    w = await startWorld();
    keys = deriveAccounts(WORDS_A);
    [owner, tytleGuardian] = [w.accounts[2]!, w.accounts[3]!];
    await fund(w, keys.guardian.address, parseEther('10'));
  });
  afterEach(async () => {
    await closePage(page);
    page = undefined;
  });
  after(() => w?.close());

  const balanceOf = (who: Address) => w.client.readContract({ address: EURE, abi: TEST_TOKEN_ABI, functionName: 'balanceOf', args: [who] });

  test('own wallet: it proves itself before the start, signs the send in an odd form, and the euros move', async () => {
    const mine = privateKeyToAccount(generatePrivateKey());
    const wallet = fakeWallet(mine, { messageForm: 'v01', typedForm: 'compact', chainId: 1 });
    const account = await makeAccount(w, { owner, exitGuardian: keys.guardian.address, tytleGuardian, eure: parseEther('70') });
    page = openPage({ chainFor: local, wallets: async () => [{ name: 'Test wallet', provider: wallet.provider }] });
    const { root } = page;
    await toAccount(root, WORDS_A, account);
    await waitFor('the balance', () => $(root, 'balance'));
    $(root, 'use-own-wallet')!.click();
    $<HTMLInputElement>(root, 'own-wallet-input')!.value = mine.address;
    $(root, 'own-wallet-use')!.click();
    await waitFor('the start screen', () => $(root, 'screen-start'));
    assert.equal($(root, 'notice')?.textContent, t('proveDone'));
    assert.ok(wallet.calls.includes('personal_sign'), 'the wallet signed the proof');
    await waitFor('Start to turn on', () => !$<HTMLButtonElement>(root, 'start')!.disabled);
    $(root, 'start')!.click();
    await waitFor('the waiting screen', () => $(root, 'screen-waiting'));
    assert.equal($(root, 'other-owner'), null, 'no warning: the user proved this wallet');
    await passTime(w, RECOVERY_PERIOD_90_DAYS);
    await waitFor('the finish screen', () => $(root, 'screen-finish'));
    $(root, 'finish')!.click();
    await waitFor('the send screen', () => $(root, 'screen-send'));
    assert.equal($(root, 'notice')?.textContent, t('finishedOwn', { address: mine.address }));
    const to = await waitFor('the destination field', () => $<HTMLInputElement>(root, 'send-to'));
    to.value = w.accounts[13]!;
    $(root, 'send')!.click();
    await waitFor('the confirmation', () => $(root, 'send-confirm'));
    $(root, 'sign-wallet')!.click();
    await waitFor('sent', () => $(root, 'sent'));
    assert.ok(wallet.calls.includes('wallet_switchEthereumChain'), 'the wallet was moved to Gnosis to sign');
    assert.equal(await balanceOf(w.accounts[13]!), parseEther('70'));
    assert.equal(await balanceOf(account), 0n);
  });

  test('own wallet with no wallet extension: the page says so and does not start', async () => {
    const account = await makeAccount(w, { owner, exitGuardian: keys.guardian.address, tytleGuardian });
    page = openPage({ chainFor: local });
    const { root } = page;
    await toAccount(root, WORDS_A, account);
    await waitFor('the chooser', () => $(root, 'use-own-wallet'));
    $(root, 'use-own-wallet')!.click();
    $<HTMLInputElement>(root, 'own-wallet-input')!.value = privateKeyToAccount(generatePrivateKey()).address;
    $(root, 'own-wallet-use')!.click();
    await waitFor('the message', () => root.textContent?.includes(t('walletNone')));
    assert.ok($(root, 'screen-account'));
  });

  test('two wallet extensions: the user picks one; a wallet that shows another address is refused', async () => {
    const mine = privateKeyToAccount(generatePrivateKey());
    const other = fakeWallet(privateKeyToAccount(generatePrivateKey()));
    const right = fakeWallet(mine);
    const account = await makeAccount(w, { owner, exitGuardian: keys.guardian.address, tytleGuardian });
    page = openPage({ chainFor: local, wallets: async () => [{ name: 'Other', provider: other.provider }, { name: 'Mine', provider: right.provider }] });
    const { root } = page;
    await toAccount(root, WORDS_A, account);
    await waitFor('the chooser', () => $(root, 'use-own-wallet'));
    $(root, 'use-own-wallet')!.click();
    $<HTMLInputElement>(root, 'own-wallet-input')!.value = mine.address;
    $(root, 'own-wallet-use')!.click();
    const choices = await waitFor('the wallet list', () => {
      const all = root.querySelectorAll<HTMLButtonElement>('[data-role="wallet-choice"]');
      return all.length === 2 ? all : null;
    });
    choices[0]!.click();
    await waitFor('the refusal', () => root.textContent?.includes(t('walletOther', { address: mine.address })));
    $(root, 'own-wallet-use')!.click();
    const again = await waitFor('the wallet list', () => {
      const all = root.querySelectorAll<HTMLButtonElement>('[data-role="wallet-choice"]');
      return all.length === 2 ? all : null;
    });
    again[1]!.click();
    await waitFor('the start screen', () => $(root, 'screen-start'));
  });

  test('a take-over started by someone else with these words: a plain warning, and no Finish without that wallet', async () => {
    const thief = privateKeyToAccount(generatePrivateKey());
    const account = await makeAccount(w, { owner, exitGuardian: keys.guardian.address, tytleGuardian, eure: parseEther('5') });
    await startTakeOver(w.pageChain, keys.guardian, account, thief.address);
    page = openPage({ chainFor: local });
    const { root } = page;
    await toAccount(root, WORDS_A, account);
    const warning = await waitFor('the warning', () => $(root, 'other-owner'));
    assert.ok(warning.textContent?.includes(thief.address));
    await passTime(w, RECOVERY_PERIOD_90_DAYS);
    await waitFor('the finish screen', () => $(root, 'screen-finish'));
    assert.ok($(root, 'finish-needs-proof')?.textContent?.includes(thief.address));
    assert.equal($(root, 'finish'), null, 'no Finish button');
    $(root, 'prove-wallet')!.click();
    await waitFor('the message', () => root.textContent?.includes(t('walletNone')));
    assert.ok(!root.textContent?.includes(t('finished')), 'never "yours alone"');
  });

  test('back after Finish, when no node serves the records: the words\' wallet goes straight to Send', async () => {
    const account = await makeAccount(w, { owner, exitGuardian: keys.guardian.address, tytleGuardian, eure: parseEther('3') });
    await startTakeOver(w.pageChain, keys.guardian, account, keys.newOwner.address);
    await passTime(w, RECOVERY_PERIOD_90_DAYS);
    await finishTakeOver(w.pageChain, keys.guardian, account, keys.guardian.address);
    const blind = new Chain([nodeFromProvider('no logs 1', noLogs(w.provider)), nodeFromProvider('no logs 2', noLogs(w.provider))]);
    page = openPage({ chainFor: () => blind });
    const { root } = page;
    await toAccount(root, WORDS_A, account);
    await waitFor('the send screen', () => $(root, 'screen-send'));
    await waitFor('the destination field', () => $(root, 'send-to'));
  });

  test('back after Finish to an own wallet, when no node serves the records: "could not read" and Try again, never a new start', async () => {
    const mine = privateKeyToAccount(generatePrivateKey());
    const account = await makeAccount(w, { owner, exitGuardian: keys.guardian.address, tytleGuardian });
    await startTakeOver(w.pageChain, keys.guardian, account, mine.address);
    await passTime(w, RECOVERY_PERIOD_90_DAYS);
    await finishTakeOver(w.pageChain, keys.guardian, account, keys.guardian.address);
    const blind = new Chain([nodeFromProvider('no logs 1', noLogs(w.provider)), nodeFromProvider('no logs 2', noLogs(w.provider))]);
    page = openPage({ chainFor: () => blind });
    const { root } = page;
    await toAccount(root, WORDS_A, account);
    const status = await waitFor('the status', () => root.querySelector('section .status.error'));
    assert.ok(status.textContent?.startsWith(t('couldNotRead')));
    assert.ok(status.querySelector('[data-role="try-again"]'));
    assert.equal($(root, 'account-continue'), null, 'no way to start a second take-over from here');
    // With the records readable, the page goes to Send for that wallet.
    await closePage(page);
    page = openPage({ chainFor: local });
    await toAccount(page.root, WORDS_A, account);
    await waitFor('the send screen', () => $(page!.root, 'screen-send'));
    const shown = await waitFor('the owner line', () => $(page!.root, 'owner'));
    assert.equal(shown.textContent, mine.address);
  });

  test('two nodes that disagree: the page says so, and shows no balance', async () => {
    const account = await makeAccount(w, { owner, exitGuardian: keys.guardian.address, tytleGuardian, eure: parseEther('8') });
    const selector = toFunctionSelector(EURE_ABI.find((e) => e.type === 'function' && e.name === 'balanceOf') as AbiFunction);
    const split = new Chain([nodeFromProvider('good', w.provider), nodeFromProvider('liar', liar(w.provider, EURE, selector))]);
    page = openPage({ chainFor: () => split });
    const { root } = page;
    await toAccount(root, WORDS_A, account);
    const status = await waitFor('the status', () => root.querySelector('section .status.error'));
    assert.ok(status.textContent?.startsWith(t('nodesDisagree')));
    assert.equal($(root, 'balance'), null);
  });

  test('leaving the page clears the words and the account', async () => {
    const account = await makeAccount(w, { owner, exitGuardian: keys.guardian.address, tytleGuardian });
    page = openPage({ chainFor: local });
    const { root, window } = page;
    await toAccount(root, WORDS_A, account);
    await waitFor('the chooser', () => $(root, 'new-owner'));
    window.dispatchEvent(new window.Event('pagehide'));
    assert.ok($(root, 'screen-words'));
    assert.equal($(root, 'notice')?.textContent, t('cleared'));
    assert.ok(!root.textContent?.includes(account));
    assert.ok(!root.textContent?.includes(keys.newOwner.address));
  });

  test('a phone keyboard that types all 12 words into the first box: one word per box', () => {
    page = openPage({ chainFor: local });
    const { root, window } = page;
    const first = root.querySelector<HTMLInputElement>('input[data-word="0"]')!;
    first.value = WORDS_A.join(' ');
    first.dispatchEvent(new window.Event('input') as unknown as Event);
    const values = [...root.querySelectorAll<HTMLInputElement>('input[data-word]')].map((i) => i.value);
    assert.deepEqual(values, WORDS_A);
  });
});
