// SPDX-License-Identifier: GPL-3.0-only
//
// The 12 recovery words: BIP-39, English list, 12 words. Two accounts come from
// them (the standard Ethereum path m/44'/60'/0'/0/i):
// - index 0, the "code guardian": the only guardian on the exit copy. It
//   starts and finishes the take-over and pays the fees.
// - index 1, the new owner. The contract refuses a guardian as new owner, so
//   it cannot be index 0.
// The words and keys stay in this page's memory only. Nothing here stores or
// sends them.

import { validateMnemonic } from '@scure/bip39';
import { english, mnemonicToAccount, type HDAccount } from 'viem/accounts';

export const WORD_COUNT = 12;

const LIST = new Set(english);

export type WordsCheck =
  | { kind: 'ok' }
  /** 1-based positions of empty boxes. */
  | { kind: 'missing'; positions: number[] }
  /** 1-based positions of words that are not on the list. */
  | { kind: 'not-on-list'; positions: number[] }
  /** Every word is on the list, but the 12 do not belong together (the checksum fails). */
  | { kind: 'do-not-fit' };

/** One word as typed: no spaces, lower case. */
export function cleanWord(typed: string): string {
  return typed.normalize('NFKD').trim().toLowerCase();
}

/**
 * A pasted text as words: split on spaces, new lines and commas, and drop list numbers ("1." or "1)") that some
 * people copy with the words.
 */
export function splitWords(text: string): string[] {
  return text
    .normalize('NFKD')
    .split(/[\s,;]+/u)
    .map((w) => w.replace(/^\d+[.)]?$/u, '').trim().toLowerCase())
    .filter((w) => w.length > 0);
}

export function checkWords(typed: readonly string[]): WordsCheck {
  const words = typed.map(cleanWord);
  const missing = [...Array(WORD_COUNT).keys()].filter((i) => !words[i]).map((i) => i + 1);
  if (missing.length > 0) return { kind: 'missing', positions: missing };
  const notOnList = words.flatMap((w, i) => (LIST.has(w) ? [] : [i + 1]));
  if (notOnList.length > 0) return { kind: 'not-on-list', positions: notOnList };
  if (!validateMnemonic(words.join(' '), english)) return { kind: 'do-not-fit' };
  return { kind: 'ok' };
}

export interface WordAccounts {
  /** m/44'/60'/0'/0/0: the guardian on the exit copy, and the account that pays the fees. */
  guardian: HDAccount;
  /** m/44'/60'/0'/0/1: the default new owner. */
  newOwner: HDAccount;
}

/** The two accounts. Call only after checkWords said ok. */
export function deriveAccounts(typed: readonly string[]): WordAccounts {
  const check = checkWords(typed);
  if (check.kind !== 'ok') throw new Error(`the words are not valid (${check.kind})`);
  const mnemonic = typed.map(cleanWord).join(' ');
  return {
    guardian: mnemonicToAccount(mnemonic, { addressIndex: 0 }),
    newOwner: mnemonicToAccount(mnemonic, { addressIndex: 1 }),
  };
}
