// SPDX-License-Identifier: GPL-3.0-only
//
// The whole page, in a test browser (happy-dom), on a local chain reached over
// HTTP through the page's own "use my own node" field: words, account, start,
// 90 days, finish, send. No other host is called: every fetch is checked.
// And with a chain that cannot be read, the page says so and never shows a
// balance.

import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';
import { parseEther, type Address } from 'viem';
import safeAbi from '../abi/SafeL2.json' with { type: 'json' };
import { RECOVERY_PERIOD_90_DAYS } from '../scripts/lib/addresses.ts';
import { Chain, nodeFromProvider } from '../page/src/chain.ts';
import { EURE, EXIT_MODULE, EXPLORER, SAFE_APP } from '../page/src/config.ts';
import { LOCALES } from '../page/src/i18n/index.ts';
import { deriveAccounts } from '../page/src/words.ts';
import { startLocalChainOverHttp } from './support/localChain.ts';
import { deadNode } from './support/nodes.ts';
import { $, closePage, openPage, t, typeWords, waitFor, type Page } from './support/page.ts';
import { TEST_TOKEN_ABI, WORDS_A, fund, makeAccount, passTime, startWorld } from './support/world.ts';

describe('the exit page', () => {
  let page: Page | undefined;
  const realFetch = globalThis.fetch;
  afterEach(async () => {
    await closePage(page);
    page = undefined;
    globalThis.fetch = realFetch;
  });

  describe('the whole flow, against a local chain', () => {
    let w: Awaited<ReturnType<typeof startWorld<Awaited<ReturnType<typeof startLocalChainOverHttp>>>>>;
    before(async () => {
      w = await startWorld(startLocalChainOverHttp);
    });
    after(() => w?.close());

    test('words, account, start, 90 days, finish, send; and nothing but the local node is called', async () => {
      const keys = deriveAccounts(WORDS_A);
      const [owner, tytleGuardian, destination] = [w.accounts[2]!, w.accounts[3]!, w.accounts[8]!];
      const balance = parseEther('2340.12');
      const account = await makeAccount(w, { owner, exitGuardian: keys.guardian.address, tytleGuardian, eure: balance });

      const called: string[] = [];
      const elsewhere: string[] = [];
      globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!url.startsWith(w.url)) {
          elsewhere.push(url);
          return Promise.reject(new Error(`the page called ${url}`));
        }
        called.push(url);
        return realFetch(input, init);
      }) as typeof fetch;

      page = openPage({});
      const { root } = page;
      assert.equal($(root, 'page-address')?.textContent, 'https://exit.example/');

      // The user's own node.
      $<HTMLInputElement>(root, 'own-node-input')!.value = w.url;
      $(root, 'own-node-use')!.click();
      assert.ok(root.textContent?.includes(t('ownNodeInUse', { url: `${w.url}/` })));

      // 1. The 12 words.
      typeWords(root, WORDS_A);
      $(root, 'continue')!.click();
      await waitFor('the account screen', () => $(root, 'screen-account'));
      assert.equal(root.querySelectorAll('input[data-word]').length, 0, 'the word boxes are gone');

      // 2. The account, from the code sheet.
      $<HTMLInputElement>(root, 'account-input')!.value = account;
      $(root, 'check-account')!.click();
      const shown = await waitFor('the balance', () => $(root, 'balance'));
      assert.equal(shown.textContent, '€2,340.12');
      assert.equal($(root, 'new-owner')?.textContent, keys.newOwner.address);

      // A pasted new owner that is Tytle's guardian is refused, before anything is sent.
      $(root, 'use-own-wallet')!.click();
      $<HTMLInputElement>(root, 'own-wallet-input')!.value = tytleGuardian;
      $(root, 'own-wallet-use')!.click();
      await waitFor('the refusal', () => root.textContent?.includes(t('refusal_guardian_14_day_copy')));
      assert.ok($(root, 'screen-account'), 'still on the account screen');
      $(root, 'use-words-wallet')!.click();
      $(root, 'account-continue')!.click();

      // 3. Start: no fee yet, so Start waits; then the fee arrives.
      await waitFor('the start screen', () => $(root, 'screen-start'));
      assert.equal($(root, 'fee-address')?.textContent, keys.guardian.address);
      assert.ok(root.querySelector('svg.qr path'), 'a QR code of the fee address');
      await waitFor('the fee balance', () => $(root, 'fee-balance')?.textContent?.includes('xDAI'));
      assert.equal($<HTMLButtonElement>(root, 'start')!.disabled, true);
      await fund(w, keys.guardian.address, parseEther('0.01'));
      await waitFor('Start to turn on', () => !$<HTMLButtonElement>(root, 'start')!.disabled);
      $(root, 'start')!.click();

      // 4. Waiting.
      await waitFor('the waiting screen', () => $(root, 'screen-waiting'), 60_000);
      assert.ok($(root, 'come-back')?.textContent?.startsWith('Come back after'));
      assert.ok($(root, 'last-tx')?.querySelector('a')?.getAttribute('href')?.includes('/tx/0x'));

      // 90 days later.
      await passTime(w, RECOVERY_PERIOD_90_DAYS);
      await waitFor('the finish screen', () => $(root, 'screen-finish'));
      $(root, 'finish')!.click();

      // 6. Send.
      await waitFor('the send screen', () => $(root, 'screen-send'), 60_000);
      assert.ok(root.textContent?.includes(t('finished')));
      const to = await waitFor('the destination field', () => $<HTMLInputElement>(root, 'send-to'));
      to.value = destination;
      $(root, 'send')!.click();
      const confirm = await waitFor('the confirmation', () => $(root, 'send-confirm'));
      assert.equal(confirm.textContent, t('sendConfirm', { amount: '€2,340.12', address: destination }));
      $(root, 'send-yes')!.click();
      await waitFor('sent', () => $(root, 'sent'), 60_000);

      const read = (who: Address) => w.client.readContract({ address: EURE, abi: TEST_TOKEN_ABI, functionName: 'balanceOf', args: [who] });
      assert.equal(await read(account), 0n);
      assert.equal(await read(destination), balance);
      assert.deepEqual(await w.client.readContract({ address: account, abi: safeAbi, functionName: 'getOwners' }), [keys.newOwner.address]);

      // Clear: back to empty word boxes, nothing of the account left on the page.
      $(root, 'clear')!.click();
      assert.ok($(root, 'screen-words'));
      assert.ok([...root.querySelectorAll<HTMLInputElement>('input[data-word]')].every((i) => i.value === ''));
      assert.ok(!root.textContent?.includes(account));

      assert.deepEqual(elsewhere, [], 'no host but the local node');
      assert.ok(called.length > 0);
    });
  });

  test('a chain that cannot be read: "could not read", and no balance at all', async () => {
    page = openPage({ chainFor: () => new Chain([nodeFromProvider('dead 1', deadNode), nodeFromProvider('dead 2', deadNode)]) });
    const { root } = page;
    typeWords(root, WORDS_A);
    $(root, 'continue')!.click();
    await waitFor('the account screen', () => $(root, 'screen-account'));
    $<HTMLInputElement>(root, 'account-input')!.value = '0x0000000000000000000000000000000000001234';
    $(root, 'check-account')!.click();
    const status = await waitFor('the status', () => root.querySelector('section .status.error'));
    assert.ok(status.textContent?.startsWith(t('couldNotRead')));
    assert.ok(status.querySelector('[data-role="try-again"]'), 'and a way to try again');
    assert.equal($(root, 'balance'), null);
    assert.ok(!/€\s?0[.,]00|0,00\s?€/u.test(root.textContent ?? ''), 'no zero balance is shown');
  });

  test('wrong words: the page names the word, and goes nowhere', () => {
    page = openPage({});
    const { root } = page;
    const words = [...WORDS_A];
    words[6] = 'notaword';
    typeWords(root, words);
    $(root, 'continue')!.click();
    assert.ok($(root, 'screen-words'));
    assert.equal(root.querySelector('section .status')?.textContent, t('wordsNotOnList', { list: '7' }));
    assert.equal(root.querySelector('input[data-word="6"]')?.getAttribute('aria-invalid'), 'true');
  });

  test("the help, in each language, names the exit contract on the explorer and Safe's app, every value filled in", () => {
    page = openPage({});
    const { root } = page;
    const lang = $<HTMLSelectElement>(root, 'lang')!;
    for (const locale of Object.keys(LOCALES)) {
      lang.value = locale;
      lang.dispatchEvent(new page.window.Event('change') as unknown as Event);
      const help = [...root.querySelectorAll('details.box')].map((d) => d.textContent).join(' ');
      assert.ok(help.includes(`${EXPLORER}/address/${EXIT_MODULE}?tab=contract`), locale);
      assert.ok(help.includes('confirmRecovery') && help.includes('finalizeRecovery') && help.includes(SAFE_APP), locale);
      assert.ok(!/\{\w+\}/u.test(root.textContent ?? ''), `${locale}: a value is not filled in`);
    }
  });
});
