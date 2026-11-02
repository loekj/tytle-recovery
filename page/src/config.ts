// SPDX-License-Identifier: GPL-3.0-only
//
// The fixed facts the exit page uses. Each address is checked by a test against
// the build, the recorded chain data or the verified ABIs.

import { getAddress, type Address } from 'viem';
import { DEPLOYED_14_DAY_MODULE, EURE_TOKEN } from '../../scripts/lib/addresses.ts';
import { PUBLIC_GNOSIS_NODES } from '../../scripts/lib/rpc.ts';

export const CHAIN_ID = 100;

/**
 * The exit copy: Candide SocialRecoveryModule v0.0.1 with a 90-day wait, made by CREATE2 (see the README).
 * A test keeps this equal to the address our build predicts.
 */
export const EXIT_MODULE: Address = getAddress('0x3EBf48D76BA83afee8bC4606F3Cff65dBb0BaECf');

/** keccak256 of the exit copy's runtime code. The page checks the code at EXIT_MODULE against it before it acts. */
export const EXIT_MODULE_CODE_KECCAK256 = '0xb06d1b05023177507e6dc187da319f75e1c10beab3f2542851b865263f771bec';

/**
 * The account search reads the exit copy's records from this block on: the block of its deploy (2 November 2026).
 * Its address was still empty in the block before (both read from two nodes and recorded in fixtures/gnosis/), so
 * no record can be older. A test checks it against the fixture.
 */
export const EXIT_MODULE_SEARCH_FROM_BLOCK = 49_062_599n;

/**
 * keccak256 of a Safe 1.4.1 proxy's code: the code the canonical proxy factory gives every account it makes
 * (a test makes one with the recorded factory code and compares). An account keeps this code when its Safe
 * version changes: only the proxy's singleton address (storage slot 0) changes.
 */
export const SAFE_PROXY_CODE_KECCAK256 = '0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c';

/** The 14-day copy that Tytle uses. Its guardians may never become the new owner (a page rule). */
export const RECOVERY_MODULE_14_DAYS: Address = getAddress(DEPLOYED_14_DAY_MODULE);

/** Monerium EURe v2 on Gnosis: 18 decimals. */
export const EURE: Address = getAddress(EURE_TOKEN);
export const EURE_DECIMALS = 18;

/** The Safe versions whose send this page knows. A newer account kind gets a plain "not yet" (see send.ts). */
export const KNOWN_SAFE_VERSIONS = ['1.4.1'] as const;

/** Public Gnosis nodes, in order of preference. None needs a key. The page's CSP allows exactly these. */
export const NODES: readonly string[] = PUBLIC_GNOSIS_NODES;

/** "Use my own node" may point only at this device: the CSP allows nothing else. */
export const OWN_NODE_HOSTS = ['localhost', '127.0.0.1'] as const;

/**
 * Transaction and address links. A link only opens a new tab; the page itself never calls this host. Blockscout's
 * Gnosis explorer: gnosis.blockscout.com sends every request here (checked 1 November 2026).
 */
export const EXPLORER = 'https://gnosisscan.io';

/** Safe's public app, the fallback named in the help text. */
export const SAFE_APP = 'https://app.safe.global';
