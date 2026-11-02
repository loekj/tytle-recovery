// SPDX-License-Identifier: GPL-3.0-only
//
// The exit page in a browser: the public nodes, this page's own address, the
// browser's languages and wallet extension.

import { Chain, nodeFromUrl } from './chain.ts';
import { NODES } from './config.ts';
import { mountApp } from './ui/app.ts';
import { discoverWallets } from './wallet.ts';

const root = document.getElementById('app');
if (root) {
  root.replaceChildren();
  mountApp(root, {
    chainFor: (urls) => new Chain(urls.map(nodeFromUrl)),
    publicNodes: NODES,
    pageAddress: location.protocol === 'file:' ? location.href : `${location.origin}${location.pathname}`,
    languages: navigator.languages ?? [navigator.language],
    wallets: () => discoverWallets(window),
    pollMs: { fee: 15_000, waiting: 60_000 },
    source: 'https://github.com/loekj/tytle-recovery',
  });
}
