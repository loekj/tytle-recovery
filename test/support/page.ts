// SPDX-License-Identifier: GPL-3.0-only
//
// The page's screens in a test browser (happy-dom), and small helpers to use
// them as a person would: type, tap, wait for what shows.

import { Window } from 'happy-dom';
import { Chain, nodeFromUrl } from '../../page/src/chain.ts';
import { NODES } from '../../page/src/config.ts';
import { text } from '../../page/src/i18n/index.ts';
import { mountApp, type AppEnv, type MountedApp } from '../../page/src/ui/app.ts';

export type Page = { window: Window; root: HTMLElement; app: MountedApp };

export function openPage(env: Partial<AppEnv>): Page {
  const window = new Window({ url: 'https://exit.example/' });
  const doc = window.document as unknown as Document;
  const root = doc.createElement('main');
  doc.body.append(root);
  const app = mountApp(root, {
    chainFor: (urls) => new Chain(urls.map(nodeFromUrl)),
    publicNodes: NODES,
    pageAddress: 'https://exit.example/',
    languages: ['en-GB'],
    wallets: async () => [],
    pollMs: { fee: 50, waiting: 50 },
    scan: { fromBlock: 0n },
    source: 'https://github.com/loekj/tytle-recovery',
    ...env,
  });
  return { window, root, app };
}

export async function closePage(page: Page | undefined): Promise<void> {
  if (!page) return;
  page.app.clear();
  await page.window.happyDOM.close();
}

export const $ = <T extends Element = HTMLElement>(root: HTMLElement, role: string) => root.querySelector<T & HTMLElement>(`[data-role="${role}"]`);

export async function waitFor<T>(what: string, probe: () => T | null | undefined | false, ms = 30_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = probe();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

export function typeWords(root: HTMLElement, words: readonly string[]): void {
  root.querySelectorAll<HTMLInputElement>('input[data-word]').forEach((input, i) => {
    input.value = words[i] ?? '';
  });
}

/** Words, then the account address, then "Check this account". */
export async function toAccount(root: HTMLElement, words: readonly string[], account: string): Promise<void> {
  typeWords(root, words);
  $(root, 'continue')!.click();
  await waitFor('the account screen', () => $(root, 'screen-account'));
  $<HTMLInputElement>(root, 'account-input')!.value = account;
  $(root, 'check-account')!.click();
}

export const t = (key: Parameters<typeof text>[1], values?: Record<string, string>) => text('en', key, values);
