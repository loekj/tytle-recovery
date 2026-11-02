// SPDX-License-Identifier: GPL-3.0-only
//
// Hardhat runs only the local chains here. It does not build the contract: see
// scripts/lib/build.ts.

import { defineConfig } from 'hardhat/config';

// Gnosis block headers carry `requestsHash` (EIP-7685), so Gnosis runs Prague rules or later (read from the chain,
// 2026-10-22). The local chains run Prague. The contract is built for Paris and uses no newer opcode.
const hardfork = 'prague';

export default defineConfig({
  networks: {
    // An empty local chain with Gnosis's chain id (EIP-712 domains name the chain id). The tests put the
    // recorded Gnosis code at its real addresses.
    localGnosis: { type: 'edr-simulated', chainId: 100, hardfork },
    // A local fork of Gnosis for the deploy dry run. The fork URL is set at run time.
    gnosisFork: { type: 'edr-simulated', chainId: 100, hardfork, forking: { url: 'https://rpc.gnosischain.com' } },
  },
});
