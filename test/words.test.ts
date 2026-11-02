// SPDX-License-Identifier: GPL-3.0-only
//
// The 12 words: each is checked against the BIP-39 English list and the
// checksum, the page says which word is wrong, and the two accounts come from
// the standard paths.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { checkWords, deriveAccounts, splitWords } from '../page/src/words.ts';
import { startLocalChain, type LocalChain } from './support/localChain.ts';
import { WORDS_A, WORDS_B } from './support/world.ts';

describe('the 12 words', () => {
  test('valid words pass', () => {
    assert.deepEqual(checkWords(WORDS_A), { kind: 'ok' });
    assert.deepEqual(checkWords(WORDS_B), { kind: 'ok' });
  });

  test('capital letters and spaces around a word do not matter', () => {
    assert.deepEqual(checkWords(WORDS_A.map((w, i) => (i === 0 ? `  ${w.toUpperCase()} ` : w))), { kind: 'ok' });
  });

  test('an empty box is named by its position', () => {
    const words = [...WORDS_A];
    words[2] = '';
    words[11] = ' ';
    assert.deepEqual(checkWords(words), { kind: 'missing', positions: [3, 12] });
  });

  test('a word that is not on the list is named by its position', () => {
    const words = [...WORDS_A];
    words[4] = 'wavee';
    assert.deepEqual(checkWords(words), { kind: 'not-on-list', positions: [5] });
  });

  test('words from the list that do not belong together fail the checksum', () => {
    const words = [...WORDS_A];
    [words[0], words[1]] = [words[1]!, words[0]!];
    assert.deepEqual(checkWords(words), { kind: 'do-not-fit' });
  });

  test('a pasted text is split into words, without list numbers', () => {
    assert.deepEqual(splitWords('1. legal 2. winner\n3) thank, year;\twave'), ['legal', 'winner', 'thank', 'year', 'wave']);
  });

  test('invalid words make no accounts', () => {
    assert.throws(() => deriveAccounts(WORDS_A.slice(0, 11)), /not valid/);
  });
});

describe('the two accounts from the words', () => {
  let chain: LocalChain;
  before(async () => {
    chain = await startLocalChain();
  });
  after(() => chain?.close());

  test("index 0 and 1 of m/44'/60'/0'/0/i: the local chain's own accounts from its words", () => {
    // Hardhat makes its test accounts from these public test words, on the same path. So the two are independent
    // derivations of the same keys.
    const words = 'test test test test test test test test test test test junk'.split(' ');
    const { guardian, newOwner } = deriveAccounts(words);
    assert.equal(guardian.address, chain.accounts[0]);
    assert.equal(newOwner.address, chain.accounts[1]);
  });
});
